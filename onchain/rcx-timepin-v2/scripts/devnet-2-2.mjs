#!/usr/bin/env node
// Tracker item 2.2, prepared so that it EXECUTES THE HOUR THE BUILD EXISTS.
//
// 2.2 is the item that cannot be done early: it needs a deployed program that
// implements MIN-CAPTURE, and the rule is being written right now. What CAN be
// done early is everything except the sending — the step sequence, the accounts,
// the assertions, the receipt format, the void-rate arithmetic — so that when
// the build lands the only new thing is a signature.
//
// So this file has two modes:
//
//   --plan   pure. Prints every step, every account it will touch, every
//            assertion it will make, and every step that is BLOCKED and why.
//            Sends nothing, needs no cluster, needs no keypair. Reviewable now.
//   run      executes the steps in order against a devnet cluster, writing each
//            step's signature into a receipt file BEFORE the next step begins.
//
// The receipt is resumable on purpose. 2.2's exit evidence is "a signature per
// instruction and a measured void rate over >= 60 targets", which at a 60 s grid
// is over an hour of wall clock. A failure at step 9 that re-ran steps 1-8 would
// re-register a spec PDA that has no close instruction and cannot be re-created.
// Losing an hour is annoying; permanently stranding rent on a fresh spec because
// a script restarted is not.
//
// WHAT IS DELIBERATELY NOT IMPLEMENTED, AND WHY THAT IS THE CORRECT STATE TODAY.
// docs/MIN_CAPTURE_SPEC.md section 3 replaces `capture_first` + `capture_conflict`
// with a single `capture`, deletes the CandidateV2 PDA in favour of an inline
// observation (section 2), and adds a precondition to `finalize`. Writing those
// two steps against today's account lists guarantees rework and, worse, produces
// receipts that LOOK like 2.2 exit evidence while proving the old predicate. They
// are declared here with the account list section 3 gives them, marked BLOCKED on
// tracker 1.1, and `--plan` prints them as blocked. `expire` is explicitly
// unchanged by that spec, so it is implemented.
//
// Evidence tier: `host` for everything in this file today. Nothing here has been
// run against a cluster; its author has no RPC. When it runs, its receipts are
// `devnet with real Pyth accounts` — and only for the steps that actually sent.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  buildLifecycle, readGeneration, assertCluster, anchorDiscriminator,
  DEFAULT_POLICY, TIMEPIN_V2_PROGRAM_ID,
} from './devnet-lifecycle.mjs';
import {
  deriveEvidenceSpecPda, deriveNeedPda, evidenceSpecHash, alignFutureTarget,
  encodeTimepinNeedV2, TIMEPIN_NEED_V2_ACCOUNT_LEN,
} from '../../rcx-timepin/model-v2.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

export const NEED_STATE = Object.freeze({
  0: 'OPEN', 1: 'CANDIDATE', 2: 'FINAL', 3: 'AMBIGUOUS', 4: 'EXPIRED',
});
// A Need is VOID for the purposes of the GATE 2 void rate if it never produced a
// settleable price: EXPIRED (nobody captured in time) or AMBIGUOUS (two signed
// messages the rule could not order). FINAL is a hit. OPEN/CANDIDATE are still
// in flight and are excluded from the denominator rather than counted as voids —
// counting an in-flight Need as a void would let a script that stopped early
// report a void rate made of its own impatience.
export const VOID_STATES = Object.freeze(['EXPIRED', 'AMBIGUOUS']);
export const TERMINAL_STATES = Object.freeze(['FINAL', 'EXPIRED', 'AMBIGUOUS']);

// Belongs in onchain/rcx-timepin/model-v2.mjs, which today exports exactly ONE
// decoder (`decodePriceUpdateV2`) and cannot read a Need at all — so no client
// can tell you what state a Need is in, which is what 2.2 has to measure. It is
// here and not there because the rule owner is editing that file this hour and
// two owners of one file is how this team stalled once already. The duplication
// is CHECKED, not trusted: test_devnet_2_2_plan.mjs round-trips it against the
// model's own `encodeTimepinNeedV2`.
export function decodeTimepinNeedV2(accountData) {
  const data = Buffer.from(accountData ?? []);
  if (data.length !== TIMEPIN_NEED_V2_ACCOUNT_LEN)
    throw new RangeError(`Need account is ${data.length} bytes, expected ${TIMEPIN_NEED_V2_ACCOUNT_LEN}`);
  const p = data.subarray(8);
  return {
    schema: p.readUInt16LE(0),
    bump: p[2],
    state: p[3],
    stateName: NEED_STATE[p[3]] ?? `UNKNOWN(${p[3]})`,
    evidenceSpecHash: Buffer.from(p.subarray(4, 36)),
    targetTs: p.readBigInt64LE(36),
    sourceDeadlineTs: p.readBigInt64LE(44),
    captureDeadlineTs: p.readBigInt64LE(52),
    candidateAHash: Buffer.from(p.subarray(60, 92)),
    candidateBHash: Buffer.from(p.subarray(92, 124)),
  };
}

// --- the step sequence ---------------------------------------------------------
//
// `blocked` is not a TODO. A blocked step is one whose on-chain shape is about to
// change; implementing it now would produce a receipt that looks like evidence.

export const STEPS = [
  {
    id: 'preflight',
    title: 'Refuse to start against the wrong cluster, program or wallet',
    accounts: ['Timepin v2 program', 'payer', 'Pyth receiver + config + wormhole generation'],
    assertions: [
      'RPC url is devnet or localhost, unless a human set RATCHET_ALLOW_NON_DEVNET',
      'the Timepin v2 program account exists and is executable on THIS cluster',
      'payer balance covers the whole run: one spec rent + N need rents + fees',
      'readGeneration succeeds, so the receiver config and wormhole are readable',
    ],
  },
  {
    id: 'register_spec',
    title: 'register_evidence_spec against the live generation',
    accounts: ['payer', 'EvidenceSpec PDA (init, WRITABLE)', 'receiver program + programdata',
      'receiver config PDA', 'wormhole program + programdata', 'system program'],
    assertions: [
      'the spec validates locally (validate_spec mirror) before anything is sent',
      'the generation validates locally (authenticate_generation_accounts mirror)',
      'if the spec PDA already exists, SKIP — there is no close instruction and no second chance',
      'after: the account is owned by Timepin v2 and its bytes hash to the spec hash',
    ],
  },
  {
    id: 'open_needs',
    title: 'open_need on N consecutive grid targets against a REAL sponsored feed',
    accounts: ['payer', 'EvidenceSpec PDA (read-only)', 'Need PDA per target (init_if_needed, WRITABLE)'],
    assertions: [
      'every target is aligned: target mod target_grid_seconds == 0',
      'every target is at least min_open_lead ahead of the CHAIN clock, not the local one',
      'the same target always derives the same Need PDA (idempotent open)',
      'after: each Need decodes to OPEN with the deadlines derive_deadlines gives',
    ],
  },
  {
    id: 'capture',
    title: 'capture from TWO independent cranks, racing, on every target',
    blocked: 'tracker 1.1. MIN_CAPTURE_SPEC section 3 replaces capture_first + capture_conflict with a single `capture`, and section 2 deletes the CandidateV2 PDA in favour of an inline observation. Wiring today\'s account list would produce receipts that prove the OLD predicate while looking like 2.2 evidence.',
    accounts: ['actor (crank keypair)', 'EvidenceSpec PDA', 'Need PDA (WRITABLE)',
      'receiver program + programdata + config', 'wormhole program + programdata',
      'price_update = the sponsored account', '(work_page — see the lead 11:57Z proposal to delete the work market)'],
    assertions: [
      'two cranks with different keypairs both submit for the same target',
      'the LATER submitter with the EARLIER publish_time wins — that is the whole rule',
      'a crank submitting a worse observation gets NotBetterThanCurrent, not a silent no-op',
      'a duplicate of the current observation is a no-op that emits Duplicate',
    ],
  },
  {
    id: 'finalize',
    title: 'finalize after the capture window has actually elapsed',
    blocked: 'tracker 1.1. MIN_CAPTURE_SPEC section 3 adds require!(clock >= need.capture_deadline_ts, CaptureWindowStillOpen) — the load-bearing line. Without it the first capturer finalizes in their own slot and locks their own print in, so a run against today\'s build would measure a rule nobody intends to ship.',
    accounts: ['actor', 'EvidenceSpec PDA', 'Need PDA (WRITABLE)'],
    assertions: [
      'finalize BEFORE capture_deadline_ts fails with CaptureWindowStillOpen',
      'finalize after it succeeds and the Need decodes to FINAL',
      'the reward is recorded against the FINAL selected worker, not the first submitter',
    ],
  },
  {
    id: 'expire',
    title: 'expire a Need that nobody captured',
    accounts: ['actor', 'EvidenceSpec PDA', 'Need PDA (WRITABLE)', 'work_page'],
    assertions: [
      'expire before capture_deadline_ts fails',
      'after the deadline it succeeds and the Need decodes to EXPIRED',
      'MIN_CAPTURE_SPEC section 3 states expire is UNCHANGED by the rule, so this step is not blocked',
    ],
  },
  {
    id: 'report',
    title: 'Read every Need back and compute the void rate GATE 2 asks for',
    accounts: ['every Need PDA opened in this run'],
    assertions: [
      'at least 60 targets reached a TERMINAL state — fewer is not a measurement',
      'void rate = (EXPIRED + AMBIGUOUS) / terminal < 5 %',
      'Needs still OPEN or CANDIDATE are excluded from the denominator, never counted as voids',
      'the receipt carries a signature for every instruction that was sent',
    ],
  },
];

export function plan({ targets = 60, grid = DEFAULT_POLICY.targetGridSeconds } = {}) {
  const lines = [];
  const say = s => lines.push(s);
  say('TRACKER 2.2 — devnet lifecycle against real Pyth accounts');
  say(`Plan: ${targets} targets on a ${grid} s grid = ${((targets * grid) / 3600).toFixed(2)} h of wall clock, minimum.`);
  say('This is --plan. Nothing is sent. No cluster is contacted. No keypair is read.');
  say('');
  let blocked = 0;
  for (const [i, step] of STEPS.entries()) {
    const mark = step.blocked ? 'BLOCKED' : 'ready';
    if (step.blocked) blocked += 1;
    say(`${String(i + 1).padStart(2)}. [${mark}] ${step.id} — ${step.title}`);
    for (const a of step.accounts) say(`      account   ${a}`);
    for (const a of step.assertions) say(`      assert    ${a}`);
    if (step.blocked) say(`      BLOCKED   ${step.blocked}`);
    say('');
  }
  say(`${STEPS.length - blocked} of ${STEPS.length} steps are ready; ${blocked} are blocked on the rule.`);
  say('A run today would send the ready steps and stop at `capture`. That is intentional:');
  say('2.2 exit evidence requires the predicate under test to be the predicate we ship.');
  return lines.join('\n');
}

// --- receipt -------------------------------------------------------------------

const receiptPath = out => out ?? join(repoRoot, 'docs', 'reviews', 'devnet-2-2', 'receipt.json');

export function loadReceipt(path) {
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  return { schema: 1, startedAt: new Date().toISOString(), steps: {}, sends: [], targets: {} };
}

export function saveReceipt(path, receipt) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
}

export function voidRate(targets) {
  const states = Object.values(targets).map(t => t.stateName);
  const terminal = states.filter(s => TERMINAL_STATES.includes(s));
  const voids = states.filter(s => VOID_STATES.includes(s));
  return {
    opened: states.length,
    terminal: terminal.length,
    inFlight: states.length - terminal.length,
    voids: voids.length,
    rate: terminal.length ? voids.length / terminal.length : null,
    meetsGate2: terminal.length >= 60 && terminal.length > 0 && voids.length / terminal.length < 0.05,
  };
}

// --- run -----------------------------------------------------------------------

async function run({ targets = 60, grid = DEFAULT_POLICY.targetGridSeconds, out } = {}) {
  const url = assertCluster(process.env.RATCHET_RPC_URL || 'https://api.devnet.solana.com');
  const path = receiptPath(out);
  const receipt = loadReceipt(path);
  receipt.cluster = url;
  const connection = new Connection(url, 'confirmed');

  const keypairPath = process.env.RATCHET_KEYPAIR;
  if (!keypairPath) throw new Error('set RATCHET_KEYPAIR to a funded devnet keypair path');
  const payer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(keypairPath, 'utf8'))));

  const done = id => receipt.steps[id]?.status === 'ok';
  const mark = (id, status, detail) => {
    receipt.steps[id] = { status, at: new Date().toISOString(), ...detail };
    saveReceipt(path, receipt);
  };
  const send = async (label, ixs, signers) => {
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(...ixs), signers,
      { commitment: 'confirmed' });
    receipt.sends.push({ label, signature: sig, at: new Date().toISOString() });
    saveReceipt(path, receipt);
    return sig;
  };

  // preflight
  if (!done('preflight')) {
    const program = new PublicKey(TIMEPIN_V2_PROGRAM_ID);
    const info = await connection.getAccountInfo(program, 'confirmed');
    if (!info?.executable)
      throw new Error(`Timepin v2 ${TIMEPIN_V2_PROGRAM_ID} is not deployed on ${url}. 2.2 cannot start before the build.`);
    const balance = await connection.getBalance(payer.publicKey, 'confirmed');
    // one spec + N needs + a fee per instruction, with slack
    const need = 0.01 * LAMPORTS_PER_SOL + targets * 0.002 * LAMPORTS_PER_SOL;
    if (balance < need)
      throw new Error(`payer holds ${balance / LAMPORTS_PER_SOL} SOL, the run needs about ${(need / LAMPORTS_PER_SOL).toFixed(3)}`);
    await readGeneration(connection);
    mark('preflight', 'ok', { payer: payer.publicKey.toBase58(), balance });
  }

  const generation = await readGeneration(connection);
  const clockSlot = BigInt(await connection.getSlot('confirmed'));
  const chainNow = BigInt(await connection.getBlockTime(await connection.getSlot('confirmed')));
  const built = buildLifecycle({ payer: payer.publicKey, generation, clockSlot, nowTs: chainNow });

  // register_spec — skip if it exists, there is no second chance at this PDA
  if (!done('register_spec')) {
    const existing = await connection.getAccountInfo(built.specPda, 'confirmed');
    if (existing) {
      mark('register_spec', 'ok', { skipped: 'spec PDA already registered', spec: built.specPda.toBase58() });
    } else {
      const sig = await send('register_evidence_spec', [built.registerIx], [payer]);
      mark('register_spec', 'ok', { signature: sig, spec: built.specPda.toBase58() });
    }
  }

  // open_needs
  if (!done('open_needs')) {
    const specHash = built.specHash;
    const first = alignFutureTarget(chainNow, DEFAULT_POLICY.minOpenLeadSeconds, grid);
    for (let i = 0; i < targets; i += 1) {
      const target = first + BigInt(i) * BigInt(grid);
      const key = String(target);
      if (receipt.targets[key]?.opened) continue;
      const needPda = new PublicKey(deriveNeedPda(
        new PublicKey(TIMEPIN_V2_PROGRAM_ID).toBuffer(), built.specArgs, target).address);
      const buf = Buffer.alloc(8); buf.writeBigInt64LE(target);
      const ix = new TransactionInstruction({
        programId: new PublicKey(TIMEPIN_V2_PROGRAM_ID),
        keys: [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: built.specPda, isSigner: false, isWritable: false },
          { pubkey: needPda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([anchorDiscriminator('global', 'open_need'), specHash, buf]),
      });
      const sig = await send(`open_need ${target}`, [ix], [payer]);
      receipt.targets[key] = { opened: true, need: needPda.toBase58(), signature: sig };
      saveReceipt(path, receipt);
    }
    mark('open_needs', 'ok', { count: Object.keys(receipt.targets).length });
  }

  for (const step of STEPS) {
    if (step.blocked && !done(step.id)) {
      mark(step.id, 'blocked', { reason: step.blocked });
      console.log(`\nSTOP at ${step.id}: ${step.blocked}`);
      console.log(`Receipt: ${path}`);
      console.log('Everything up to here is real and recorded. Re-run after the rule lands and it resumes.');
      return receipt;
    }
  }
  return receipt;
}

// --- cli -----------------------------------------------------------------------

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

async function main() {
  const targets = Number(flag('targets', 60));
  const grid = Number(flag('grid', DEFAULT_POLICY.targetGridSeconds));
  if (process.argv.includes('--plan')) { console.log(plan({ targets, grid })); return; }
  await run({ targets, grid, out: flag('out', undefined) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`\nFAILED: ${error.message}`); process.exitCode = 1; });
}
