#!/usr/bin/env node
// Timepin v2 lifecycle opener: `register_evidence_spec` + `open_need` against a
// live cluster.
//
// The previous version of this file could not run at all, and — worse — could
// not be *shown* to be broken without a devnet RPC, because every defect lived
// inside one 100-line `main()` that begins by opening a socket. Four of its five
// defects are decidable with no network whatsoever. So the file is now split:
//
//   buildLifecycle()  pure. No I/O. Takes the live generation as data and returns
//                     the two instructions plus everything they were derived from.
//   readGeneration()  the only function that touches the network.
//   main()            wiring, guards, and the send.
//
// `test/test_devnet_lifecycle_shape.mjs` proves the pure half on a machine with
// zero egress. That is the whole point of the split.
//
// Defects fixed here, each against the on-chain rule that punishes it
// (`programs/rcx-timepin-v2/src/lib.rs`):
//
//   1. `receiverPd` / `wormholePd` were `const`-declared inside a `try` block and
//      read outside it -> ReferenceError on every run that got past the fetch.
//      Gone: the pure builder receives them, it does not close over them.
//   2. The `evidence_spec` account was passed `isWritable: false`. `lib.rs:226-233`
//      declares it `init, payer = payer` — a created account must be writable.
//   3. The target was `now + 1200`, not grid-aligned. `validate_open` (`lib.rs:617`)
//      requires `target_ts.rem_euclid(target_grid_seconds) == 0` or
//      `TargetMisaligned`. Now `alignFutureTarget()` from the model, which is the
//      same ceiling the program computes.
//   4. The Wormhole program was a hardcoded constant with the comment "Adjust if
//      devnet wormhole differs". It is not adjustable by hand:
//      `authenticate_generation_accounts` (`lib.rs:566-570`) requires
//      `receiver_config.wormhole == args.wormhole_program`. It is now READ FROM
//      THE RECEIVER CONFIG on whatever cluster we are pointed at. This defect is
//      not in Fable's list and it is the one that would have kept the script red
//      after the other four were fixed.
//   5. The script sent the transaction and printed "Transaction failed (expected
//      if Timepin v2 is not deployed on devnet)" on any error — a catch that
//      turns every real defect into an expected outcome. The generation is now
//      checked locally with the model's `validateGeneration`, which mirrors
//      `authenticate_generation_accounts` field for field, so a mismatch is named
//      before a lamport is spent, and a send failure is a failure.
//
// Not a defect, checked and stated so nobody re-opens it: the instruction payload
// `discriminator || spec_hash || canonical_spec_bytes` is correct. Anchor Borsh of
// `EvidenceSpecArgs` (`lib.rs:271-295`) is byte-identical to `canonical_spec_bytes`
// (`lib.rs:401-412`) — same field order, all fixed-size, all little-endian.
//
// Evidence tier: host. Nothing in this file has been run against a cluster by its
// author, who has no RPC. `readGeneration` and the send are unproven.

import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  TIMEPIN_SCHEMA_V2, ADAPTER_PYTH_MIN_CAPTURE_V2, VERIFICATION_FULL,
  OFFICIAL_PYTH_RECEIVER_PROGRAM, OFFICIAL_PYTH_PUSH_ORACLE_PROGRAM,
  BPF_UPGRADEABLE_LOADER_PROGRAM,
  deriveReceiverConfigPda, deriveEvidenceSpecPda, deriveNeedPda,
  encodeEvidenceSpec, evidenceSpecHash, evidencePolicyHash,
  validateEvidenceSpec, validateGeneration, alignFutureTarget,
} from '../../rcx-timepin/model-v2.mjs';

export const TIMEPIN_V2_PROGRAM_ID = 'C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp';
export const BPF_LOADER_UPGRADEABLE = 'BPFLoaderUpgradeab1e11111111111111111111111';

// Crypto.SOL/USD, the control row of docs/STOCK_FEEDS.json — the one feed the
// live program already settles on. Pinned here so the script has a real target
// instead of the previous Buffer.alloc(32, 3) placeholder, which derives to a
// push-source account that does not exist on any cluster.
export const SOL_USD_FEED_ID =
  'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';

// Generation-independent policy. Every bound here is inside `validate_spec`
// (`lib.rs:422-489`); the values are a rehearsal policy, NOT the mainnet economy,
// which is Semir's decision 2 in docs/ROAD_TO_MAINNET.md section 4.
//
// maxFutureSkewSeconds is 30, not the previous 5: tracker item 1.3 proposes a
// floor of 30 s and the program today enforces only the 300 s ceiling. A
// rehearsal spec written under the old value would have to be re-registered the
// day 1.3 lands, and an EvidenceSpec PDA has no edit and no close instruction.
export const DEFAULT_POLICY = Object.freeze({
  schema: TIMEPIN_SCHEMA_V2,
  adapter: ADAPTER_PYTH_MIN_CAPTURE_V2,
  receiverProgram: OFFICIAL_PYTH_RECEIVER_PROGRAM,
  pushOracleProgram: OFFICIAL_PYTH_PUSH_ORACLE_PROGRAM,
  shardId: 0,
  feedId: Buffer.from(SOL_USD_FEED_ID, 'hex'),
  requiredVerification: VERIFICATION_FULL,
  targetGridSeconds: 60,
  // Must strictly clear maxFutureSkewSeconds below, or an admissible print for
  // the target can already exist when the Need is opened and the settling price
  // is knowable before the shot is committed. 31 is the minimum that clears 30.
  minOpenLeadSeconds: 31,
  maxTargetAheadSeconds: 3600,
  // Zero under MIN-CAPTURE: prev_publish_time is not in the predicate, so any
  // other value is a dead number inside every spec hash and validate_spec
  // refuses it. Was 120, which was correct under the strict-bracket adapter.
  maxPreTargetGapSeconds: 0,
  // grid - 1. Was 120 against a grid of 60 - at or above the grid, one print
  // settles two consecutive targets, and validate_spec now refuses it.
  maxPostTargetLagSeconds: 59,
  captureGraceSeconds: 60,
  maxFutureSkewSeconds: 30,
  minExponent: -12,
  maxExponent: 2,
  maxConfidenceBps: 1000,
});

const sha256 = data => createHash('sha256').update(data).digest();

// Anchor's global instruction discriminator. The two names are read straight off
// `lib.rs`: `pub fn register_evidence_spec(` at :57 and `pub fn open_need(` at :118.
export const anchorDiscriminator = (namespace, name) =>
  sha256(Buffer.from(`${namespace}:${name}`, 'utf8')).subarray(0, 8);

// ---------------------------------------------------------------------------
// Pre-read decoders.
//
// These exist only so `readGeneration` knows which accounts to FETCH. Not one of
// them is trusted: `buildLifecycle` hands the same raw bytes to the model's
// `validateGeneration`, which decodes them again with its own implementation and
// fails closed on any disagreement. If you are tempted to use these three
// functions as an authority anywhere else, use the model instead.
// ---------------------------------------------------------------------------

const preReadProgramDataAddress = accountData => {
  const data = Buffer.from(accountData ?? []);
  if (data.length !== 36 || data.readUInt32LE(0) !== 2)
    throw new RangeError('not a Loader-v3 Program account');
  return new PublicKey(data.subarray(4, 36));
};

const preReadProgramDataSlot = accountData => {
  const data = Buffer.from(accountData ?? []);
  if (data.length < 13 || data.readUInt32LE(0) !== 3)
    throw new RangeError('not a Loader-v3 ProgramData account');
  return data.readBigUInt64LE(4);
};

const preReadConfiguredWormhole = configData => {
  const data = Buffer.from(configData ?? []);
  if (data.length !== 370) throw new RangeError('Receiver Config is not 370 bytes');
  let offset = 8 + 32;                       // discriminator + governance_authority
  const targetAuthorityTag = data[offset]; offset += 1;
  if (targetAuthorityTag !== 0 && targetAuthorityTag !== 1)
    throw new RangeError('Receiver Config has an invalid target-authority Option');
  if (targetAuthorityTag === 1) offset += 32;
  return new PublicKey(data.subarray(offset, offset + 32));
};

// ---------------------------------------------------------------------------
// The pure half. No network, no clock, no filesystem: everything variable is an
// argument, which is why a zero-egress machine can prove it.
// ---------------------------------------------------------------------------

export function buildLifecycle({
  programId = TIMEPIN_V2_PROGRAM_ID,
  payer,
  generation,
  clockSlot,
  nowTs,
  policy = DEFAULT_POLICY,
}) {
  if (!payer) throw new TypeError('payer is required');
  if (!generation) throw new TypeError('generation is required');
  const program = new PublicKey(programId);
  const payerKey = new PublicKey(payer);

  const receiverConfigData = Buffer.from(generation.receiverConfigData ?? []);
  const specArgs = {
    ...policy,
    receiverProgramdataSlot: generation.receiverProgramdataSlot,
    receiverConfigHash: sha256(receiverConfigData),
    wormholeProgram: Buffer.from(generation.wormholeProgram),
    wormholeProgramdataSlot: generation.wormholeProgramdataSlot,
  };

  // Two independent gates before a single byte is encoded. The first mirrors
  // `validate_spec`, the second mirrors `authenticate_generation_accounts`. A
  // failure here is a named code, on this machine, for free.
  const shape = validateEvidenceSpec(specArgs);
  if (!shape.ok)
    throw new Error(`SPEC REJECTED LOCALLY: ${shape.code}${shape.detail ? ` (${shape.detail})` : ''}`);
  const gen = validateGeneration(specArgs, generation, clockSlot);
  if (!gen.ok)
    throw new Error(`GENERATION REJECTED LOCALLY: ${gen.code}${gen.detail ? ` (${gen.detail})` : ''}`);

  const specHash = evidenceSpecHash(specArgs);
  const policyHash = evidencePolicyHash(specArgs);
  const canonicalBytes = encodeEvidenceSpec(specArgs);
  const specPda = new PublicKey(deriveEvidenceSpecPda(program.toBuffer(), specArgs).address);
  const receiverConfigPda =
    new PublicKey(deriveReceiverConfigPda(specArgs.receiverProgram).address);

  const registerIx = new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: payerKey, isSigner: true, isWritable: true },
      // `init` (lib.rs:226-233). Writable, or ConstraintMut before anything else.
      { pubkey: specPda, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(specArgs.receiverProgram), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(generation.receiverProgramdata), isSigner: false, isWritable: false },
      { pubkey: receiverConfigPda, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(specArgs.wormholeProgram), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(generation.wormholeProgramdata), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDiscriminator('global', 'register_evidence_spec'), specHash, canonicalBytes,
    ]),
  });

  // ceil((now + minOpenLead) / grid) * grid — the same ceiling the program checks.
  const targetTs = alignFutureTarget(nowTs, policy.minOpenLeadSeconds, policy.targetGridSeconds);
  const needPda = new PublicKey(deriveNeedPda(program.toBuffer(), specArgs, targetTs).address);
  const targetBuf = Buffer.alloc(8);
  targetBuf.writeBigInt64LE(BigInt(targetTs));

  const openIx = new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: payerKey, isSigner: true, isWritable: true },
      { pubkey: specPda, isSigner: false, isWritable: false },
      // `init_if_needed` (lib.rs:254-266).
      { pubkey: needPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([anchorDiscriminator('global', 'open_need'), specHash, targetBuf]),
  });

  return {
    specArgs, specHash, policyHash, canonicalBytes,
    specPda, needPda, receiverConfigPda, targetTs,
    registerIx, openIx,
  };
}

// ---------------------------------------------------------------------------
// The only function that touches the network.
// ---------------------------------------------------------------------------

export async function readGeneration(connection, {
  receiverProgram = OFFICIAL_PYTH_RECEIVER_PROGRAM,
} = {}) {
  const receiverKey = new PublicKey(receiverProgram);
  const mustGet = async (key, label) => {
    const info = await connection.getAccountInfo(key, 'confirmed');
    if (!info) throw new Error(`${label} not found at ${key.toBase58()} on this cluster`);
    return info;
  };

  const receiverProgramInfo = await mustGet(receiverKey, 'Receiver program');
  const receiverPd = preReadProgramDataAddress(receiverProgramInfo.data);
  const receiverPdInfo = await mustGet(receiverPd, 'Receiver ProgramData');

  const configPda = new PublicKey(deriveReceiverConfigPda(receiverProgram).address);
  const configInfo = await mustGet(configPda, 'Receiver Config');

  // Never hardcoded: the program requires args.wormhole_program to equal the one
  // this exact config selects (lib.rs:566-570).
  const wormholeKey = preReadConfiguredWormhole(configInfo.data);
  const wormholeProgramInfo = await mustGet(wormholeKey, 'Wormhole program');
  const wormholePd = preReadProgramDataAddress(wormholeProgramInfo.data);
  const wormholePdInfo = await mustGet(wormholePd, 'Wormhole ProgramData');

  return {
    receiverProgram: receiverKey.toBuffer(),
    receiverProgramExecutable: receiverProgramInfo.executable,
    receiverProgramOwner: receiverProgramInfo.owner.toBuffer(),
    receiverProgramAccountData: receiverProgramInfo.data,
    receiverProgramdata: receiverPd.toBuffer(),
    receiverProgramdataOwner: receiverPdInfo.owner.toBuffer(),
    receiverProgramdataExecutable: receiverPdInfo.executable,
    receiverProgramdataAccountData: receiverPdInfo.data,
    receiverProgramdataSlot: preReadProgramDataSlot(receiverPdInfo.data),
    receiverConfigKey: configPda.toBuffer(),
    receiverConfigOwner: configInfo.owner.toBuffer(),
    receiverConfigExecutable: configInfo.executable,
    receiverConfigData: configInfo.data,
    wormholeProgram: wormholeKey.toBuffer(),
    wormholeProgramExecutable: wormholeProgramInfo.executable,
    wormholeProgramOwner: wormholeProgramInfo.owner.toBuffer(),
    wormholeProgramAccountData: wormholeProgramInfo.data,
    wormholeProgramdata: wormholePd.toBuffer(),
    wormholeProgramdataOwner: wormholePdInfo.owner.toBuffer(),
    wormholeProgramdataExecutable: wormholePdInfo.executable,
    wormholeProgramdataAccountData: wormholePdInfo.data,
    wormholeProgramdataSlot: preReadProgramDataSlot(wormholePdInfo.data),
  };
}

// ---------------------------------------------------------------------------

const DEVNET_URL = 'https://api.devnet.solana.com';

// A rehearsal script that will happily point at mainnet if an env var says so is
// one typo away from the hard stop in AGENT_ONBOARD.md section 4.
export function assertCluster(url) {
  const ok = /devnet|localhost|127\.0\.0\.1/i.test(url);
  if (!ok && !process.env.RATCHET_ALLOW_NON_DEVNET)
    throw new Error(
      `refusing to run against ${url}: this is a devnet rehearsal script. ` +
      'Set RATCHET_ALLOW_NON_DEVNET=1 only with an explicit human decision.',
    );
  return url;
}

function loadPayer() {
  const home = process.env.HOME || process.env.USERPROFILE;
  const keypairPath = process.env.RATCHET_KEYPAIR || join(home ?? '.', '.config', 'solana', 'id.json');
  try {
    return {
      payer: Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(keypairPath, 'utf8')))),
      source: keypairPath,
    };
  } catch {
    return { payer: Keypair.generate(), source: 'generated (unfunded)' };
  }
}

async function main() {
  const url = assertCluster(process.env.RATCHET_RPC_URL || DEVNET_URL);
  const dryRun = process.argv.includes('--dry-run');
  const connection = new Connection(url, 'confirmed');
  const { payer, source } = loadPayer();
  console.log(`cluster        ${url}`);
  console.log(`payer          ${payer.publicKey.toBase58()}  (${source})`);

  const generation = await readGeneration(connection);
  const clockSlot = BigInt(await connection.getSlot('confirmed'));
  const nowTs = BigInt(Math.floor(Date.now() / 1000));

  const built = buildLifecycle({
    payer: payer.publicKey, generation, clockSlot, nowTs,
  });

  console.log(`receiver slot  ${generation.receiverProgramdataSlot}`);
  console.log(`wormhole       ${new PublicKey(generation.wormholeProgram).toBase58()} @ slot ${generation.wormholeProgramdataSlot}`);
  console.log(`config hash    ${built.specArgs.receiverConfigHash.toString('hex')}`);
  console.log(`spec hash      ${built.specHash.toString('hex')}`);
  console.log(`spec pda       ${built.specPda.toBase58()}`);
  console.log(`target         ${built.targetTs}  (grid ${DEFAULT_POLICY.targetGridSeconds}s, lead ${DEFAULT_POLICY.minOpenLeadSeconds}s, now ${nowTs})`);
  console.log(`need pda       ${built.needPda.toBase58()}`);

  if (dryRun) {
    console.log('\n--dry-run: both instructions built and locally validated, nothing sent.');
    return;
  }

  const tx = new Transaction().add(built.registerIx, built.openIx);
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: 'confirmed',
  });
  console.log(`\nsignature      ${sig}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`\nFAILED: ${error.message}`);
    process.exitCode = 1;
  });
}
