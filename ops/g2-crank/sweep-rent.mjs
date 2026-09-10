#!/usr/bin/env node
// Give the evidence rent back. Read-only by default.
//
// Timepin's hold/release/close instructions exist so that the rent for a Need
// and for the captured price is a float rather than a fire. Nothing calls them
// on its own, and a keeper that never calls them never gets its capture rent
// back - measured on devnet 2026-09-10, that was 1,254,760 lamports per target
// captured, against 90,000 earned per shot.
//
// So this is maintenance, and it is permissionless like every other step here:
//   release   a hold whose Shot is gone. The proof is the ABSENCE of that
//             account - system-owned, empty, no lamports - which only the
//             program that owned it could have produced. The hold's own rent
//             returns to whoever paid for the seal, not to the caller.
//   close     a Need that is terminal, unheld, and more than a week past its
//             capture deadline. Its rent returns to whoever opened it and the
//             candidate's to whoever captured it - again, not to the caller.
//
// THE CALLER IS PAID NOTHING AND THAT IS DELIBERATE. Every refund is pinned on
// chain to the address that paid. The operator's reason to run this is that one
// of those addresses is usually its own.
//
//   node ops/g2-crank/sweep-rent.mjs --rpc <URL> --operator <PUBKEY>
//   node ops/g2-crank/sweep-rent.mjs --rpc <URL> --operator <PUBKEY> \
//        --keypair <PATH> --send
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as web3 from '@solana/web3.js';
import bs58 from 'bs58';
import { PROGRAMS, DEVNET_GENESIS } from './public-pins.mjs';
import { createCoreG2Client } from '../../onchain/ratchet-core-g2/client/client-v2.mjs';

const NEED_LEN = 168;
const NEED_DISCRIMINATOR = 'e1f8cc821015586c';
const HOLD_DISCRIMINATOR = 'ffc51204836f5eb9';
const NEED_STATE = { 0: 'OPEN', 1: 'CANDIDATE', 2: 'FINAL', 3: 'AMBIGUOUS', 4: 'EXPIRED' };
const TERMINAL = new Set([2, 3, 4]);
const CLOSE_DELAY_SECONDS = 7 * 24 * 60 * 60;

const meta = (pubkey, isSigner = false, isWritable = false) =>
  ({ pubkey: new web3.PublicKey(pubkey), isSigner, isWritable });

const discriminator = name =>
  crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);

const timepinIx = (name, keys) => new web3.TransactionInstruction({
  programId: new web3.PublicKey(PROGRAMS.timepin),
  keys,
  data: discriminator(name),
});

const candidateAddress = (need, messageHash) => web3.PublicKey.findProgramAddressSync(
  [Buffer.from('candidate'), new web3.PublicKey(need).toBuffer(), Buffer.from(messageHash)],
  new web3.PublicKey(PROGRAMS.timepin),
)[0];

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--send') { out.send = true; continue; }
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    out[a.slice(2)] = argv[++i];
  }
  if (!out.rpc) throw new Error('--rpc is required; this tool never guesses a cluster');
  if (!out.operator) throw new Error('--operator is required, as a public key');
  if (out.send && !out.keypair) throw new Error('--send requires --keypair');
  return out;
}

// A hold is releasable exactly when its holder account is gone. Nothing else -
// not age, not the Need's state - is allowed to stand in for that fact.
export function holdIsReleasable(holderInfo) {
  return holderInfo === null
    || (holderInfo.lamports === 0
      && holderInfo.data.length === 0
      && holderInfo.owner.equals(web3.SystemProgram.programId));
}

export function needIsClosable(need, nowTs) {
  if (!TERMINAL.has(need.state)) return { ok: false, why: `state ${NEED_STATE[need.state] ?? need.state}` };
  if (need.openRefs !== 0) return { ok: false, why: `${need.openRefs} hold(s)` };
  const earliest = need.captureDeadlineTs + BigInt(CLOSE_DELAY_SECONDS);
  if (BigInt(nowTs) < earliest) return { ok: false, why: `${earliest - BigInt(nowTs)}s of the delay left` };
  return { ok: true };
}

const decodeNeed = (address, info) => ({
  address,
  state: info.data[11],
  targetTs: info.data.readBigInt64LE(44),
  captureDeadlineTs: info.data.readBigInt64LE(60),
  candidateAHash: info.data.subarray(68, 100),
  openRefs: info.data.readUInt32LE(132),
  rentPayer: new web3.PublicKey(info.data.subarray(136, 168)),
  lamports: info.lamports,
});

const decodeHold = (address, info) => ({
  address,
  need: new web3.PublicKey(info.data.subarray(11, 43)),
  holder: new web3.PublicKey(info.data.subarray(43, 75)),
  rentPayer: new web3.PublicKey(info.data.subarray(75, 107)),
  lamports: info.lamports,
});

// A Need that expired unanswered has no captured price, and the caller says so by
// passing the Need itself in the candidate slot. When there IS one, the refund
// address is read out of the candidate account rather than assumed: the whole
// point is that the money goes back to whoever actually paid.
async function closeNeedInstruction(connection, operator, need) {
  const empty = need.candidateAHash.every(b => b === 0);
  if (empty) {
    return timepinIx('close_need', [
      meta(operator, true, true), meta(need.address, false, true),
      meta(need.rentPayer, false, true),
      meta(need.address, false, true), meta(need.rentPayer, false, true),
    ]);
  }
  const candidate = candidateAddress(need.address, need.candidateAHash);
  const info = await connection.getAccountInfo(candidate, 'confirmed');
  if (!info) throw new Error(`Need ${need.address.toBase58()} names a candidate that is not there`);
  const candidateRentPayer = new web3.PublicKey(Buffer.from(info.data).subarray(43, 75));
  return timepinIx('close_need', [
    meta(operator, true, true), meta(need.address, false, true),
    meta(need.rentPayer, false, true),
    meta(candidate, false, true), meta(candidateRentPayer, false, true),
  ]);
}

export async function sweep({ connection, client, operator, signer = null, send = false, log = console.log }) {
  const timepin = new web3.PublicKey(PROGRAMS.timepin);
  const genesis = await connection.getGenesisHash();
  if (genesis !== DEVNET_GENESIS) throw new Error(`refusing to act on cluster ${genesis}`);
  const nowTs = (await connection.getBlockTime(await connection.getSlot('confirmed'))) ?? Math.floor(Date.now() / 1000);

  // Filtered on chain by the Anchor discriminator, and filtered again here on the
  // bytes that came back. The second pass is not paranoia about the RPC: memcmp
  // is a server-side convenience and the account is the only authority for what
  // it is.
  const byDiscriminator = async (hex, size) => connection.getProgramAccounts(timepin, {
    commitment: 'confirmed',
    filters: [
      ...(size ? [{ dataSize: size }] : []),
      { memcmp: { offset: 0, bytes: bs58.encode(Buffer.from(hex, 'hex')) } },
    ],
  }).then(rows => rows
    .filter(r => Buffer.from(r.account.data).subarray(0, 8).toString('hex') === hex)
    .map(r => ({ pubkey: r.pubkey, account: { ...r.account, data: Buffer.from(r.account.data) } })));

  const holds = (await byDiscriminator(HOLD_DISCRIMINATOR, null))
    .map(r => decodeHold(r.pubkey, r.account));
  const needs = (await byDiscriminator(NEED_DISCRIMINATOR, NEED_LEN))
    .map(r => decodeNeed(r.pubkey, r.account));

  const actions = [];
  for (const hold of holds) {
    const holder = await connection.getAccountInfo(hold.holder, 'confirmed');
    if (!holdIsReleasable(holder)) continue;
    actions.push({ kind: 'release', hold, refundTo: hold.rentPayer, lamports: hold.lamports });
  }
  for (const need of needs) {
    // A Need this sweep is about to release a hold on is not closable in the
    // same pass: the count on chain is still above zero until that lands.
    if (actions.some(a => a.kind === 'release' && a.hold.need.equals(need.address))) continue;
    const verdict = needIsClosable(need, nowTs);
    if (!verdict.ok) continue;
    actions.push({ kind: 'close', need, refundTo: need.rentPayer, lamports: need.lamports });
  }

  log(JSON.stringify({
    scope: 'TIMEPIN_RENT_SWEEP', operator: operator.toBase58(), nowTs,
    holds: holds.length, needs: needs.length, actions: actions.length, send,
  }));
  for (const action of actions) {
    log(JSON.stringify({
      action: action.kind,
      subject: (action.hold?.address ?? action.need.address).toBase58(),
      refundTo: action.refundTo.toBase58(),
      lamports: action.lamports,
    }));
  }
  if (!send) return { actions, sent: [] };

  const sent = [];
  for (const action of actions) {
    const ix = action.kind === 'release'
      ? timepinIx('release_hold', [
        meta(operator, true, true), meta(action.hold.need, false, true),
        meta(action.hold.holder), meta(action.hold.address, false, true),
        meta(action.hold.rentPayer, false, true),
      ])
      : await closeNeedInstruction(connection, operator, action.need);
    const tx = new web3.Transaction().add(ix);
    const signature = await web3.sendAndConfirmTransaction(connection, tx, [signer], { commitment: 'confirmed' });
    sent.push({ action: action.kind, signature });
    log(JSON.stringify({ action: action.kind, signature }));
  }
  return { actions, sent };
}

if (process.argv[1] && process.argv[1].endsWith('sweep-rent.mjs')) {
  const opt = parseArgs(process.argv.slice(2));
  const connection = new web3.Connection(opt.rpc, { commitment: 'confirmed' });
  const client = createCoreG2Client({ web3, coreProgramId: PROGRAMS.core, timepinProgramId: PROGRAMS.timepin });
  const operator = new web3.PublicKey(opt.operator);
  const signer = opt.keypair
    ? web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(opt.keypair, 'utf8'))))
    : null;
  if (signer && !signer.publicKey.equals(operator))
    throw new Error('the keypair does not match --operator');
  await sweep({ connection, client, operator, signer, send: Boolean(opt.send) });
}
