// Shared public chain reads and authenticated Pyth capture selection.
// The original bootstrap/play tools re-export these functions; keep one algorithm.
import { createHash } from 'node:crypto';
import * as web3 from '@solana/web3.js';
import { decodePriceUpdateV2, evaluateCapture, validateCandidate, encodeCandidateV2,
  derivePushSourcePda, hashPriceMessage } from '../../onchain/rcx-timepin/model-v2.mjs';
import { PROGRAMS } from './public-pins.mjs';

const pk = value => new web3.PublicKey(value), bytes = value => value?.toBuffer ? value.toBuffer() : Buffer.from(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const fact = (ok, why) => { if (!ok) throw new Error(why); };
const requireFact = fact;
const same = (a, b, why) => fact(bytes(a).equals(bytes(b)), why);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function readClock(connection) {
  const info = await connection.getAccountInfo(web3.SYSVAR_CLOCK_PUBKEY, 'confirmed');
  requireFact(info && info.data.length === 40 && !info.executable && info.owner.toBase58() === 'Sysvar1111111111111111111111111111111111111', 'invalid real Clock sysvar');
  const b = Buffer.from(info.data); const out = { slot: b.readBigUInt64LE(0), nowTs: b.readBigInt64LE(32) };
  requireFact(out.slot > 0n && out.nowTs > 0n, 'invalid real Clock values'); return out;
}

// The public devnet RPC answers a burst with 429 and web3.js turns that into a thrown error. A
// keeper that dies on one such answer voids everybody's shot (2026-09-09: capture_first at the entry
// target was lost to a 429 and the game was voided). Every RPC method - reads, simulations, sends,
// confirmations, airdrops - retries with a real backoff before giving up.
export function withReadRetries(connection, pause = sleep, { attempts = 6 } = {}) {
  return new Proxy(connection, { get(target, name) {
    const value = target[name]; if (typeof value !== 'function') return value;
    if (!/^(get|send|simulate|confirm|request)/.test(String(name))) return value.bind(target);
    return async (...args) => {
      for (let attempt = 0; ; attempt++) {
        try { return await value.apply(target, args); }
        catch (error) {
          const throttled = /\b429\b|too many requests|rate.?limit|fetch failed|ECONNRESET|ETIMEDOUT/i.test(String(error?.message || error));
          if (attempt >= attempts - 1 || !throttled) throw error;
          await pause(Math.min(30000, 1500 * 2 ** attempt));
        }
      }
    };
  } });
}

export function authenticateSource(spec, address, info) {
  same(pk(address).toBuffer(), derivePushSourcePda(spec).address, 'SOL source PDA mismatch');
  fact(info && !info.executable && info.owner.equals(pk(spec.receiverProgram)), 'SOL source owner/executable mismatch');
  const decoded = decodePriceUpdateV2(info); fact(decoded.ok, 'SOL source: ' + decoded.code);
  same(decoded.writeAuthority, pk(address).toBuffer(), 'SOL source write authority mismatch');
  same(decoded.feedId, spec.feedId, 'SOL source feed mismatch');
  return decoded;
}

export function decodeCandidateAccount(spec, need, hash, address, info) {
  fact(info && !info.executable && info.owner.equals(pk(PROGRAMS.timepin)), 'Candidate owner/executable mismatch');
  const b = Buffer.from(info.data); fact(b.length === 119, 'Candidate exact length mismatch');
  same(b.subarray(0, 8), Buffer.from(sha('account:CandidateV2').slice(0, 16), 'hex'), 'Candidate discriminator mismatch');
  let o = 8;
  const u8 = () => b[o++], u16 = () => { const n = b.readUInt16LE(o); o += 2; return n; };
  const take = n => { const v = b.subarray(o, o + n); o += n; return v; };
  const i64 = () => { const n = b.readBigInt64LE(o); o += 8; return n; };
  const u64 = () => { const n = b.readBigUInt64LE(o); o += 8; return n; };
  const i32 = () => { const n = b.readInt32LE(o); o += 4; return n; };
  const c = { address: pk(address).toBuffer(), schema: u16(), bump: u8(), need: take(32), price: i64(), conf: u64(), exponent: i32(),
    publishTime: i64(), prevPublishTime: i64(), emaPrice: i64(), emaConf: u64(), postedSlot: u64(), captureSlot: u64(), captureTs: i64() };
  fact(o === b.length, 'Candidate trailing bytes');
  const valid = validateCandidate(spec, need, c, hash, pk(PROGRAMS.timepin).toBuffer()); fact(valid.ok, 'Candidate invalid: ' + valid.code);
  same(encodeCandidateV2(c), b, 'Candidate decoded bytes mismatch');
  return c;
}

// Mirrors lifecycle.rs capture_order_key. The older model transition helper
// still treats equal publication times as ambiguous and is deliberately unused.
export function compareCapture(a, aHash, b, bHash) {
  for (const key of ['publishTime', 'postedSlot']) if (BigInt(a[key]) !== BigInt(b[key])) return BigInt(a[key]) < BigInt(b[key]) ? -1 : 1;
  return Buffer.compare(bytes(aHash), bytes(bHash));
}

export function chooseCapture(spec, need, candidate, source, clock, generation) {
  const checked = evaluateCapture(spec, need, source, { slot: clock.slot, unixTimestamp: clock.nowTs, generation }, pk(PROGRAMS.timepin).toBuffer());
  if (!checked.ok) return { action: null, reason: checked.code };
  same(checked.messageHash, hashPriceMessage(checked.message), 'canonical message hash disagreement');
  if (need.state === 'Open') return { action: 'capture_first', ...checked };
  fact(need.state === 'Candidate' && candidate, 'candidate Need has no authenticated incumbent');
  if (bytes(need.candidateAHash).equals(checked.messageHash)) return { action: null, reason: 'DUPLICATE' };
  return compareCapture(checked.message, checked.messageHash, candidate, need.candidateAHash) < 0
    ? { action: 'capture_conflict', ...checked } : { action: null, reason: 'NOT_EARLIER' };
}
