// Proves the instruction shape that `onchain/rcx-timepin-v2/scripts/devnet-lifecycle.mjs`
// sends, on a machine with no RPC and no cluster.
//
// Why this test exists. That script had five defects and every one of them was
// only observable by running it against devnet, because the whole thing was one
// `main()` that opens a socket on its first line — and its final `catch` printed
// "Transaction failed (expected if Timepin v2 is not deployed on devnet)", which
// turns a real defect into an expected outcome. Four of the five defects are
// decidable with arithmetic and a Buffer. This file decides them.
//
// The fixture below is a synthetic Loader-v3 / Pyth-Receiver generation: three
// account layouts built by hand so the model's `validateGeneration` — which is a
// field-for-field mirror of the program's `authenticate_generation_accounts` —
// has something real to accept or reject. It is a FIXTURE, not a cluster. This
// test is host tier and can never be more than host tier: it proves what the
// script builds, never what a validator accepts.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  buildLifecycle, assertCluster, anchorDiscriminator,
  DEFAULT_POLICY, TIMEPIN_V2_PROGRAM_ID, BPF_LOADER_UPGRADEABLE,
} from '../onchain/rcx-timepin-v2/scripts/devnet-lifecycle.mjs';
import {
  OFFICIAL_PYTH_RECEIVER_PROGRAM, deriveReceiverConfigPda,
  EVIDENCE_SPEC_V2_CANONICAL_LEN,
} from '../onchain/rcx-timepin/model-v2.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const LIB_RS = join(here, '..', 'onchain', 'rcx-timepin-v2', 'programs', 'rcx-timepin-v2', 'src', 'lib.rs');

const sha256 = data => createHash('sha256').update(data).digest();
const loader = new PublicKey(BPF_LOADER_UPGRADEABLE);
let checks = 0;
const check = (fn, label) => { fn(); checks += 1; return label; };

// --- fixture -----------------------------------------------------------------

const programAccount = programDataKey => {
  const out = Buffer.alloc(36);
  out.writeUInt32LE(2, 0);                       // Loader-v3 Program variant
  new PublicKey(programDataKey).toBuffer().copy(out, 4);
  return out;
};

const programDataAccount = slot => {
  const out = Buffer.alloc(45);
  out.writeUInt32LE(3, 0);                       // Loader-v3 ProgramData variant
  out.writeBigUInt64LE(BigInt(slot), 4);
  out[12] = 1;                                   // Some(upgrade authority)
  Keypair.generate().publicKey.toBuffer().copy(out, 13);
  return out;
};

const receiverConfigAccount = wormholeKey => {
  const out = Buffer.alloc(370);                 // ReceiverConfig::LEN, fixed
  sha256(Buffer.from('account:Config', 'utf8')).subarray(0, 8).copy(out, 0);
  Keypair.generate().publicKey.toBuffer().copy(out, 8);   // governance_authority
  out[40] = 0;                                   // None(target_governance_authority)
  new PublicKey(wormholeKey).toBuffer().copy(out, 41);    // wormhole
  out.writeUInt32LE(1, 73);                      // one data source
  out.writeUInt16LE(26, 77);                     // chain 26
  Keypair.generate().publicKey.toBuffer().copy(out, 79);  // emitter
  out.writeBigUInt64LE(1n, 113);                 // single_update_fee_in_lamports
  out[121] = 3;                                  // minimum_signatures
  return out;
};

const RECEIVER_PD = Keypair.generate().publicKey;
const WORMHOLE = Keypair.generate().publicKey;
const WORMHOLE_PD = Keypair.generate().publicKey;
const RECEIVER_SLOT = 300_000_000n;
const WORMHOLE_SLOT = 200_000_000n;

const generationFixture = (over = {}) => {
  const wormhole = over.wormhole ?? WORMHOLE;
  const configData = over.configData ?? receiverConfigAccount(wormhole);
  return {
    receiverProgram: OFFICIAL_PYTH_RECEIVER_PROGRAM,
    receiverProgramExecutable: true,
    receiverProgramOwner: loader.toBuffer(),
    receiverProgramAccountData: programAccount(RECEIVER_PD),
    receiverProgramdata: RECEIVER_PD.toBuffer(),
    receiverProgramdataOwner: loader.toBuffer(),
    receiverProgramdataExecutable: false,
    receiverProgramdataAccountData: programDataAccount(RECEIVER_SLOT),
    receiverProgramdataSlot: over.receiverProgramdataSlot ?? RECEIVER_SLOT,
    receiverConfigKey: new PublicKey(
      deriveReceiverConfigPda(OFFICIAL_PYTH_RECEIVER_PROGRAM).address).toBuffer(),
    receiverConfigOwner: Buffer.from(OFFICIAL_PYTH_RECEIVER_PROGRAM),
    receiverConfigExecutable: false,
    receiverConfigData: configData,
    wormholeProgram: (over.declaredWormhole ?? wormhole).toBuffer(),
    wormholeProgramExecutable: true,
    wormholeProgramOwner: loader.toBuffer(),
    wormholeProgramAccountData: programAccount(WORMHOLE_PD),
    wormholeProgramdata: WORMHOLE_PD.toBuffer(),
    wormholeProgramdataOwner: loader.toBuffer(),
    wormholeProgramdataExecutable: false,
    wormholeProgramdataAccountData: programDataAccount(WORMHOLE_SLOT),
    wormholeProgramdataSlot: over.wormholeProgramdataSlot ?? WORMHOLE_SLOT,
  };
};

const PAYER = Keypair.generate().publicKey;
const CLOCK = 400_000_000n;
const NOW = 1_800_000_000n;                      // deliberately not on a 60 s grid
const build = (over = {}) => buildLifecycle({
  payer: PAYER,
  generation: over.generation ?? generationFixture(),
  clockSlot: over.clockSlot ?? CLOCK,
  nowTs: over.nowTs ?? NOW,
  policy: over.policy ?? DEFAULT_POLICY,
});

// --- defect 1: the `const`s scoped inside `try`, read outside it --------------
//
// The old file declared receiverPd/wormholePd at :52,:56 inside a try block and
// read them at :101,:104 outside it, so any run that got past the fetch died with
// a ReferenceError. The builder is pure now, so this is simply: does it return.

check(() => {
  const b = build();
  assert.ok(b.registerIx && b.openIx, 'both instructions built');
}, 'no ReferenceError');
const built = build();

// --- defect 2: the `init` account was passed read-only ------------------------
//
// lib.rs:226-233 declares `evidence_spec` as `init, payer = payer`. A created
// account must be writable or the runtime refuses before the handler runs.

check(() => {
  const keys = built.registerIx.keys;
  assert.equal(keys.length, 8, 'RegisterEvidenceSpec takes exactly 8 accounts');
  assert.deepEqual(
    keys.map(k => `${k.isSigner ? 's' : '-'}${k.isWritable ? 'w' : '-'}`),
    ['sw', '-w', '--', '--', '--', '--', '--', '--'],
    'payer signer+writable, evidence_spec writable, the rest read-only',
  );
  assert.ok(keys[1].pubkey.equals(built.specPda), 'account 1 is the EvidenceSpec PDA');
  assert.ok(keys[4].pubkey.equals(built.receiverConfigPda), 'account 4 is the Receiver Config PDA');
}, 'evidence_spec is writable');

check(() => {
  const keys = built.openIx.keys;
  assert.equal(keys.length, 4, 'OpenNeed takes exactly 4 accounts');
  assert.deepEqual(
    keys.map(k => `${k.isSigner ? 's' : '-'}${k.isWritable ? 'w' : '-'}`),
    ['sw', '--', '-w', '--'],
    'actor signer+writable, evidence_spec read-only, need writable (init_if_needed)',
  );
  assert.ok(keys[2].pubkey.equals(built.needPda), 'account 2 is the Need PDA');
}, 'need is writable, spec is not');

// --- defect 3: the target was not grid-aligned --------------------------------
//
// validate_open (lib.rs:605-621) requires lead >= min_open_lead, lead <=
// max_target_ahead, and target_ts.rem_euclid(target_grid_seconds) == 0.

check(() => {
  const grid = BigInt(DEFAULT_POLICY.targetGridSeconds);
  const lead = BigInt(DEFAULT_POLICY.minOpenLeadSeconds);
  assert.equal(built.targetTs % grid, 0n, 'target is on the grid');
  assert.ok(built.targetTs - NOW >= lead, 'target is at least min_open_lead ahead');
  assert.ok(built.targetTs - NOW <= BigInt(DEFAULT_POLICY.maxTargetAheadSeconds),
    'target is inside max_target_ahead');
  assert.ok(built.targetTs - NOW < lead + grid, 'target is the FIRST admissible grid point');
  assert.equal(built.targetTs, 1_800_000_060n, 'exact ceiling for now=1800000000');
}, 'target is aligned and minimal');

check(() => {
  // The boundary that a `now + 1200` style constant can never hit: every second
  // of one full grid period must still produce an aligned, admissible target.
  const grid = BigInt(DEFAULT_POLICY.targetGridSeconds);
  const lead = BigInt(DEFAULT_POLICY.minOpenLeadSeconds);
  for (let i = 0n; i < grid; i += 1n) {
    const now = 1_800_000_000n + i;
    const t = build({ nowTs: now }).targetTs;
    assert.equal(t % grid, 0n, `aligned at now+${i}`);
    assert.ok(t - now >= lead, `lead respected at now+${i}`);
    assert.ok(t - now < lead + grid, `minimal at now+${i}`);
  }
  // And the old behaviour is genuinely rejected: now + 1200 is aligned only when
  // now happens to be, which is 1 second in 60.
  let alignedByLuck = 0;
  for (let i = 0n; i < grid; i += 1n)
    if ((1_800_000_000n + i + 1200n) % grid === 0n) alignedByLuck += 1;
  assert.equal(alignedByLuck, 1, 'the old now+1200 rule was aligned in 1 of 60 seconds');
}, 'alignment holds across a whole grid period');

// --- defect 4: the Wormhole program was hardcoded ------------------------------
//
// lib.rs:566-570 requires receiver_config.wormhole == args.wormhole_program. The
// script must READ it from the config on whatever cluster it is pointed at.

check(() => {
  const other = Keypair.generate().publicKey;
  const b = build({ generation: generationFixture({ wormhole: other }) });
  assert.ok(Buffer.from(b.specArgs.wormholeProgram).equals(other.toBuffer()),
    'the spec follows the config, whatever the config says');
  assert.ok(!Buffer.from(b.specArgs.wormholeProgram).equals(WORMHOLE.toBuffer()),
    'and is not the previous hardcoded constant');
}, 'wormhole comes from the receiver config');

check(() => {
  // A generation that DECLARES a wormhole the config does not select is exactly
  // the "Adjust if devnet wormhole differs" failure. It must be named locally.
  const g = generationFixture({ declaredWormhole: Keypair.generate().publicKey });
  assert.throws(() => build({ generation: g }), /WRONG_CONFIGURED_WORMHOLE/,
    'a hand-adjusted wormhole is rejected before the send');
}, 'a mismatched wormhole is refused locally');

// --- defect 5: every failure was swallowed as "expected" -----------------------

check(() => {
  assert.throws(
    () => build({ generation: generationFixture({ receiverProgramdataSlot: RECEIVER_SLOT + 1n }) }),
    /RECEIVER_GENERATION_MISMATCH/, 'a stale receiver slot is named, not sent');
  assert.throws(
    () => build({ generation: generationFixture({ wormholeProgramdataSlot: 1n }) }),
    /WORMHOLE_GENERATION_MISMATCH/, 'a stale wormhole slot is named, not sent');
  assert.throws(
    () => build({ clockSlot: RECEIVER_SLOT - 1n }),
    /GENERATION_NOT_OBSERVABLE_YET/, 'an unobservable generation is named, not sent');
  assert.throws(
    () => build({ generation: generationFixture({ configData: Buffer.alloc(370) }) }),
    /BAD_RECEIVER_CONFIG/, 'a config that is not a Receiver Config is named, not sent');
}, 'generation failures are named before the send');

check(() => {
  assert.throws(() => build({ policy: { ...DEFAULT_POLICY, targetGridSeconds: 0 } }),
    /SPEC REJECTED LOCALLY/, 'a zero grid is refused');
  // 2 became a REAL adapter on 2026-09-05 (MIN-CAPTURE) and is now the one this
  // script rehearses, so it is no longer an example of an unknown one. 3 is the
  // ghost the room called "adapter 3" for an hour before the numbering was
  // settled in code, and it has never existed.
  assert.throws(() => build({ policy: { ...DEFAULT_POLICY, adapter: 3 } }),
    /SPEC REJECTED LOCALLY/, 'a non-registered adapter is refused');
  assert.throws(() => build({ policy: { ...DEFAULT_POLICY, maxPostTargetLagSeconds: 60 } }),
    /SPEC REJECTED LOCALLY/, 'a lag at or above the grid is refused');
  assert.throws(() => build({ policy: { ...DEFAULT_POLICY, minOpenLeadSeconds: 30 } }),
    /SPEC REJECTED LOCALLY/, 'a lead that only equals the skew is refused');
  assert.throws(() => build({ policy: { ...DEFAULT_POLICY, maxFutureSkewSeconds: 301 } }),
    /SPEC REJECTED LOCALLY/, 'skew above MAX_FUTURE_SKEW_SECS is refused');
}, 'spec failures are named before the send');

// --- the payload, against the Rust source ---------------------------------------

check(() => {
  const source = readFileSync(LIB_RS, 'utf8');
  for (const name of ['register_evidence_spec', 'open_need'])
    assert.ok(source.includes(`pub fn ${name}(`), `lib.rs declares ${name}`);
  assert.ok(
    built.registerIx.data.subarray(0, 8)
      .equals(anchorDiscriminator('global', 'register_evidence_spec')),
    'register discriminator');
  assert.ok(
    built.openIx.data.subarray(0, 8).equals(anchorDiscriminator('global', 'open_need')),
    'open discriminator');
  assert.equal(built.canonicalBytes.length, EVIDENCE_SPEC_V2_CANONICAL_LEN, '214 canonical bytes');
  assert.equal(built.registerIx.data.length, 8 + 32 + 214, 'disc + spec_hash + args');
  assert.ok(built.registerIx.data.subarray(8, 40).equals(built.specHash), 'spec_hash is arg 1');
  assert.ok(built.registerIx.data.subarray(40).equals(built.canonicalBytes), 'args follow');
  assert.equal(built.openIx.data.length, 8 + 32 + 8, 'disc + spec_hash + target_ts');
  assert.ok(built.openIx.data.subarray(8, 40).equals(built.specHash), 'open names the same spec');
  assert.equal(built.openIx.data.readBigInt64LE(40), built.targetTs, 'target_ts is i64 LE');
  assert.equal(built.registerIx.programId.toBase58(), TIMEPIN_V2_PROGRAM_ID, 'Timepin v2 C8ww');
}, 'payload matches the Rust entrypoints');

// --- the cluster guard -----------------------------------------------------------

check(() => {
  assert.equal(assertCluster('https://api.devnet.solana.com'), 'https://api.devnet.solana.com');
  assert.equal(assertCluster('http://127.0.0.1:8899'), 'http://127.0.0.1:8899');
  const saved = process.env.RATCHET_ALLOW_NON_DEVNET;
  delete process.env.RATCHET_ALLOW_NON_DEVNET;
  assert.throws(() => assertCluster('https://api.mainnet-beta.solana.com'), /refusing to run/,
    'a rehearsal script does not point at mainnet by accident');
  if (saved !== undefined) process.env.RATCHET_ALLOW_NON_DEVNET = saved;
}, 'cluster guard');

console.log(`devnet lifecycle shape: ${checks} checks passed (host tier; fixture, not a cluster)`);
