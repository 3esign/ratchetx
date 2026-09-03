// RatchetX Core v1 — the client library. Instruction builders, PDAs, account
// parsers and the commit, function for function against
// programs/ratchet-core/src/lib.rs, checked offline by test/test_core_client.mjs
// against vectors/core-rules-v1.json (printed by the program itself).
//
// Only @solana/web3.js is used (PublicKey / TransactionInstruction); no Anchor
// client, no IDL at runtime. Everything here is public data: a stranger with an
// RPC and this file can seal, reveal, reload, crank and read the whole game.
import { createHash } from 'node:crypto';
import { PublicKey, TransactionInstruction, SystemProgram } from '@solana/web3.js';

export const PROGRAM_ID = new PublicKey('6sJn9CfSwD3Jt8V6vYyHq5hYmLKdDmaTgqwHY5czpPBv');
export const RCX_MINT = new PublicKey('FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump');
// RCX is a Token-2022 mint on mainnet. Deriving an ATA or building reload with
// the classic Token Program produces a different account and can never spend
// the real token, even though the on-chain program accepts TokenInterface.
export const TOKEN_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const PYTH_RECEIVER = new PublicKey('rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp');
export const PYTH_PUSH_ORACLE = new PublicKey('pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou');
export const UPGRADEABLE_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

// The referee table, compiled into the program. Index = feed_index.
export const FEEDS = [
  { index: 0, symbol: 'SOL', feedId: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d' },
  { index: 1, symbol: 'BTC', feedId: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43' },
  { index: 2, symbol: 'ETH', feedId: 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace' },
  { index: 3, symbol: 'BONK', feedId: '72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419' },
  { index: 4, symbol: 'WIF', feedId: '4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc' },
  { index: 5, symbol: 'JUP', feedId: '0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996' },
  { index: 6, symbol: 'PUMP', feedId: '7a01fca212788bba7c5bf8c9efd576a8a722f070d2c17596ff7bb609b8d5c3b9' },
];
export const HORIZONS = [[5, 10], [10, 11], [15, 12], [30, 14], [60, 16], [360, 20], [1440, 24]];
export const SETTLE_DEADLINE_SECS = 120;
export const REVEAL_DEADLINE_SECS = 3600;
export const STATE = { SEALED: 1, SETTLED: 2, REVEALED: 3, VOIDED: 4, FORFEITED: 5 };
export const STATE_NAME = { 1: 'Sealed', 2: 'Settled', 3: 'Revealed', 4: 'Voided', 5: 'Forfeited' };
export const VOID_REASON = { 0: 'none', 1: 'equality', 2: 'deadline' };
// Ruleset 2: Shot grew by 29 bytes (the settlement's own numbers) and each
// clock observation by 8 (confidence). These are RPC filters as well as sanity
// checks -- a stale size here does not mis-parse, it finds nothing at all.
export const ACCOUNT_SIZE = { Shot: 254, PlayerLedger: 139, Podium: 136, FeedClock: 2614, DelegateGrant: 113, LegacyClaim: 9 };

const sha256 = (...parts) => { const h = createHash('sha256'); for (const p of parts) h.update(p); return h.digest(); };
export const ixDiscriminator = name => sha256(`global:${name}`).subarray(0, 8);
export const accountDiscriminator = name => sha256(`account:${name}`).subarray(0, 8);

// ---- Borsh (little-endian) --------------------------------------------------
const big = v => { const b = BigInt(v); if (b < 0n) throw new RangeError('unsigned expected'); return b; };
const u8 = v => Buffer.from([Number(v) & 0xff]);
const u16 = v => { const b = Buffer.alloc(2); b.writeUInt16LE(Number(v)); return b; };
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(Number(v)); return b; };
const u64 = v => { const b = Buffer.alloc(8); b.writeBigUInt64LE(big(v)); return b; };
const i64 = v => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b; };
const bytes32 = v => { const b = Buffer.from(typeof v === 'string' ? Buffer.from(v, 'hex') : v); if (b.length !== 32) throw new RangeError('32 bytes expected'); return b; };
const str = v => { const b = Buffer.from(String(v), 'utf8'); return Buffer.concat([u32(b.length), b]); };

// ---- PDAs -----------------------------------------------------------------
const pk = v => (v instanceof PublicKey ? v : new PublicKey(v));
export const ledgerPda = player => PublicKey.findProgramAddressSync([Buffer.from('player'), pk(player).toBuffer()], PROGRAM_ID)[0];
export const shotPda = (player, nonce) => PublicKey.findProgramAddressSync([Buffer.from('shot'), pk(player).toBuffer(), u64(nonce)], PROGRAM_ID)[0];
export const clockPda = feedIndex => PublicKey.findProgramAddressSync([Buffer.from('clock'), u8(feedIndex)], PROGRAM_ID)[0];
export const podiumPda = () => PublicKey.findProgramAddressSync([Buffer.from('podium')], PROGRAM_ID)[0];
export const grantPda = (player, delegate) => PublicKey.findProgramAddressSync([Buffer.from('grant'), pk(player).toBuffer(), pk(delegate).toBuffer()], PROGRAM_ID)[0];
export const claimPda = player => PublicKey.findProgramAddressSync([Buffer.from('claim'), pk(player).toBuffer()], PROGRAM_ID)[0];
// The sponsored Pyth push account for a feed: shard 0 of the push oracle.
export const pushAccount = feedIndex => PublicKey.findProgramAddressSync([u16(0), Buffer.from(FEEDS[feedIndex].feedId, 'hex')], PYTH_PUSH_ORACLE)[0];
export const ata = (owner, mint = RCX_MINT, tokenProgram = TOKEN_PROGRAM) =>
  PublicKey.findProgramAddressSync([pk(owner).toBuffer(), pk(tokenProgram).toBuffer(), pk(mint).toBuffer()], ATA_PROGRAM)[0];

// ---- Commit -----------------------------------------------------------------
export const SALT_RE = /^[0-9a-f]{32}$/;
export function commitPreimage({ wallet, nonce, side, pBps = 0, salt }) {
  if (!SALT_RE.test(salt)) throw new RangeError('salt must be 32 lower-case hex chars');
  const s = side === 1 || side === 'YES' ? 'YES' : side === 0 || side === 'NO' ? 'NO' : null;
  if (s === null) throw new RangeError('side must be YES/1 or NO/0');
  return `RATCHET|v3|${pk(wallet).toBase58()}|${big(nonce)}|${s}|${Number(pBps)}|${salt}`;
}
export const commitHash = input => sha256(commitPreimage(input));

// ---- Instructions ---------------------------------------------------------
const meta = (pubkey, isSigner = false, isWritable = false) => ({ pubkey: pk(pubkey), isSigner, isWritable });
const ix = (name, keys, ...args) => new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.concat([ixDiscriminator(name), ...args]) });

/** Burn 70% / pay the live podium 30% / credit 1 per whole token. `seats` are
 *  the podium seat owners whose ATAs already exist (from readPodium). */
export function reloadIx({ player, amount, seats = [] }) {
  const keys = [
    meta(player, true, true), meta(ledgerPda(player), false, true), meta(podiumPda(), false, true),
    meta(RCX_MINT, false, true), meta(ata(player), false, true), meta(TOKEN_PROGRAM), meta(SystemProgram.programId),
    ...seats.map(s => meta(ata(s), false, true)),
  ];
  return ix('reload', keys, u64(amount));
}
export function sealIx({ player, nonce, commit, feedIndex, minutes, stake }) {
  const keys = [
    meta(shotPda(player, nonce), false, true), meta(ledgerPda(player), false, true), meta(player, true, true),
    meta(pushAccount(feedIndex)), meta(SystemProgram.programId),
  ];
  return ix('seal', keys, u64(nonce), bytes32(commit), u8(feedIndex), u16(minutes), u64(stake));
}
export function sealDelegatedIx({ delegate, player, nonce, commit, feedIndex, minutes, stake }) {
  const keys = [
    meta(grantPda(player, delegate), false, true), meta(shotPda(player, nonce), false, true), meta(ledgerPda(player), false, true),
    meta(delegate, true, true), meta(pushAccount(feedIndex)), meta(SystemProgram.programId),
  ];
  return ix('seal_delegated', keys, u64(nonce), bytes32(commit), u8(feedIndex), u16(minutes), u64(stake));
}
export function checkpointIx({ cranker, feedIndex }) {
  const keys = [meta(clockPda(feedIndex), false, true), meta(cranker, true, true), meta(pushAccount(feedIndex)), meta(SystemProgram.programId)];
  return ix('checkpoint', keys, u8(feedIndex));
}
export function settleIx({ cranker, shot, player, feedIndex }) {
  return ix('settle', [meta(shot, false, true), meta(ledgerPda(player), false, true), meta(clockPda(feedIndex)), meta(cranker, true)]);
}
/** Freeze the crossing print into the shot. Permissionless and idempotent:
 *  send it as soon as the shot expires and the ring can wrap all it likes. */
export const bindCrossingIx = ({ cranker, shot, feedIndex }) =>
  ix('bind_crossing', [meta(shot, false, true), meta(clockPda(feedIndex)), meta(cranker, true)]);
export function revealIx({ revealer, shot, player, side, pBps = 0, salt }) {
  if (!SALT_RE.test(salt)) throw new RangeError('salt must be 32 lower-case hex chars');
  const s = side === 1 || side === 'YES' ? 1 : 0;
  const keys = [meta(shot, false, true), meta(ledgerPda(player), false, true), meta(podiumPda(), false, true), meta(revealer, true, true), meta(SystemProgram.programId)];
  return ix('reveal', keys, u8(s), u16(pBps), str(salt));
}
export const forfeitIx = ({ cranker, shot, player }) => ix('forfeit', [meta(shot, false, true), meta(ledgerPda(player), false, true), meta(cranker, true)]);
export const voidShotIx = ({ cranker, shot, player }) => ix('void_shot', [meta(shot, false, true), meta(ledgerPda(player), false, true), meta(cranker, true)]);
export const closeShotIx = ({ cranker, shot, player }) => ix('close_shot', [meta(shot, false, true), meta(player, false, true), meta(cranker, true)]);
export function grantDelegateIx({ player, delegate, allowance, maxStake, expiryTs }) {
  const keys = [meta(grantPda(player, delegate), false, true), meta(player, true, true), meta(delegate), meta(SystemProgram.programId)];
  return ix('grant_delegate', keys, u64(allowance), u64(maxStake), i64(expiryTs));
}
export const revokeDelegateIx = ({ player, delegate }) => ix('revoke_delegate', [meta(grantPda(player, delegate), false, true), meta(player, true, true), meta(delegate)]);
export function claimLegacyIx({ player, credits, xp, proof }) {
  const keys = [meta(claimPda(player), false, true), meta(ledgerPda(player), false, true), meta(player, true, true), meta(SystemProgram.programId)];
  return ix('claim_legacy', keys, u64(credits), u64(xp), u32(proof.length), ...proof.map(bytes32));
}

// ---- Account parsers ------------------------------------------------------
class Reader {
  constructor(buf, name) {
    this.b = Buffer.from(buf); this.o = 8;
    if (this.b.length < 8 || !this.b.subarray(0, 8).equals(accountDiscriminator(name))) throw new TypeError(`not a ${name} account`);
  }
  u8() { return this.b.readUInt8(this.o++); }
  u16() { const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  u32() { const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  u64() { const v = this.b.readBigUInt64LE(this.o); this.o += 8; return v; }
  i64() { const v = this.b.readBigInt64LE(this.o); this.o += 8; return v; }
  key() { const v = new PublicKey(this.b.subarray(this.o, this.o + 32)); this.o += 32; return v; }
  hex32() { const v = this.b.subarray(this.o, this.o + 32).toString('hex'); this.o += 32; return v; }
}
export function parseShot(data) {
  const r = new Reader(data, 'Shot');
  return {
    player: r.key(), delegate: r.key(), nonce: r.u64(), commit: r.hex32(), feedId: r.hex32(), feedIndex: r.u8(), minutes: r.u16(),
    stake: r.u64(), xpBase: r.u64(), xpAwarded: r.u64(), sealedTs: r.i64(), expiryTs: r.i64(), settledTs: r.i64(),
    entryE12: r.i64(), exitE12: r.i64(), exitPublishTime: r.i64(),
    exitConfE12: r.i64(), exitPrevPublishTime: r.i64(), exitPostedSlot: r.u64(),
    ruleset: r.u16(), bandKBps: r.u16(), crossingBound: r.u8(),
    pBps: r.u16(), side: r.u8(), hit: r.u8(), state: r.u8(), voidReason: r.u8(),
  };
}
export function parseLedger(data) {
  const r = new Reader(data, 'PlayerLedger');
  return {
    player: r.key(), credits: r.u64(), xp: r.u64(), streak: r.u32(), best: r.u32(), hits: r.u64(), shots: r.u64(), voids: r.u64(),
    forfeits: r.u64(), sealed: r.u64(), open: r.u16(), day: r.u64(), dailyXp: r.u64(), burned: r.u64(), reloaded: r.u64(), bump: r.u8(),
  };
}
export function parsePodium(data) {
  const r = new Reader(data, 'Podium');
  const day = r.u64();
  const seats = [0, 1, 2].map(() => ({ player: r.key(), dailyXp: r.u64() })).filter(s => !s.player.equals(PublicKey.default));
  return { day, seats };
}
export function parseClock(data) {
  const r = new Reader(data, 'FeedClock');
  const out = { feedId: r.hex32(), latestPublishTime: r.i64(), head: r.u8(), bump: r.u8(), observations: [] };
  const n = r.u32();
  for (let i = 0; i < n; i++) out.observations.push({ prevPublishTime: r.i64(), publishTime: r.i64(), priceE12: r.i64(), confE12: r.i64(), postedSlot: r.u64() });
  return out;
}
export function parseGrant(data) {
  const r = new Reader(data, 'DelegateGrant');
  return { player: r.key(), delegate: r.key(), allowance: r.u64(), maxStake: r.u64(), used: r.u64(), shots: r.u64(), expiryTs: r.i64(), bump: r.u8() };
}
/** The sponsored Pyth PriceUpdateV2 account, enough of it to plan a crank. */
export function parsePriceUpdate(data) {
  const b = Buffer.from(data);
  let o = 8 + 32;                       // discriminator, write_authority
  const level = b.readUInt8(o++);        // VerificationLevel: 0 Partial{num_signatures}, 1 Full
  if (level === 0) o++;
  const feedId = b.subarray(o, o + 32).toString('hex'); o += 32;
  const price = b.readBigInt64LE(o); o += 8;
  const conf = b.readBigUInt64LE(o); o += 8;
  const exponent = b.readInt32LE(o); o += 4;
  const publishTime = b.readBigInt64LE(o); o += 8;
  const prevPublishTime = b.readBigInt64LE(o); o += 8;
  o += 16;                               // ema_price, ema_conf
  const postedSlot = b.readBigUInt64LE(o);
  return { full: level === 1, feedId, price, conf, exponent, publishTime, prevPublishTime, postedSlot };
}
/** The first checkpointed observation at/after expiry with a predecessor before it. */
export function crossing(clock, expiryTs) {
  const e = BigInt(expiryTs);
  return clock.observations.filter(o => o.prevPublishTime < e && o.publishTime >= e).sort((a, b) => (a.publishTime < b.publishTime ? -1 : 1))[0] ?? null;
}

// ---- The open runner's plan (pure; the crank executes it) ------------------
/** shots: [{pubkey, ...parseShot}], clocks: Map feedIndex -> parseClock|null,
 *  pushes: Map feedIndex -> parsePriceUpdate|null, now: unix seconds (chain).
 *  Returns actions in the order they should be sent. */
export function planActions({ shots, clocks, pushes, now, close = false, warmSecs = 300 }) {
  const t = BigInt(now);
  const actions = [];
  const warmed = new Set();
  for (const s of shots) {
    const clock = clocks.get(s.feedIndex) ?? null;
    const push = pushes.get(s.feedIndex) ?? null;
    const pushIsNew = push && push.full && (!clock || push.publishTime > clock.latestPublishTime);
    if (s.state === STATE.SEALED) {
      const deadline = s.expiryTs + BigInt(SETTLE_DEADLINE_SECS);
      if (t < s.expiryTs) {
        // Keep a predecessor in the clock so the first post-expiry checkpoint forms the crossing.
        const stale = !clock || clock.latestPublishTime < t - BigInt(warmSecs);
        if (stale && pushIsNew && !warmed.has(s.feedIndex)) { warmed.add(s.feedIndex); actions.push({ kind: 'checkpoint', feedIndex: s.feedIndex, reason: 'warm' }); }
      } else if (s.crossingBound) {
        // Ruleset 2: a bound shot owns its answer. The settle deadline was a
        // deadline for CAPTURING the crossing, and that already happened, so
        // this settles whenever a cranker gets to it -- never voids.
        actions.push({ kind: 'settle', shot: s.pubkey, player: s.player, feedIndex: s.feedIndex });
      } else if (t < deadline) {
        // `settle` binds from the ring itself, atomically, so there is nothing
        // to gain by planning a separate `bind_crossing` in front of it. The
        // instruction exists for anyone who wants to freeze an answer without
        // being the one to settle it; the runner simply never needs to.
        if (clock && crossing(clock, s.expiryTs)) actions.push({ kind: 'settle', shot: s.pubkey, player: s.player, feedIndex: s.feedIndex });
        else if (pushIsNew && push.publishTime >= s.expiryTs) actions.push({ kind: 'checkpoint+settle', shot: s.pubkey, player: s.player, feedIndex: s.feedIndex });
        // else: Pyth has not pushed a post-expiry update yet; try again next tick.
      } else {
        actions.push({ kind: 'void', shot: s.pubkey, player: s.player });
      }
    } else if (s.state === STATE.SETTLED) {
      if (t >= s.expiryTs + BigInt(REVEAL_DEADLINE_SECS)) actions.push({ kind: 'forfeit', shot: s.pubkey, player: s.player });
    } else if (close) {
      actions.push({ kind: 'close', shot: s.pubkey, player: s.player });
    }
  }
  return actions;
}
export function instructionsFor(action, cranker) {
  switch (action.kind) {
    case 'checkpoint': return [checkpointIx({ cranker, feedIndex: action.feedIndex })];
    case 'settle': return [settleIx({ cranker, shot: action.shot, player: action.player, feedIndex: action.feedIndex })];
    case 'checkpoint+settle': return [checkpointIx({ cranker, feedIndex: action.feedIndex }), settleIx({ cranker, shot: action.shot, player: action.player, feedIndex: action.feedIndex })];
    case 'bind': return [bindCrossingIx({ cranker, shot: action.shot, feedIndex: action.feedIndex })];
    case 'void': return [voidShotIx({ cranker, shot: action.shot, player: action.player })];
    case 'forfeit': return [forfeitIx({ cranker, shot: action.shot, player: action.player })];
    case 'close': return [closeShotIx({ cranker, shot: action.shot, player: action.player })];
    default: throw new Error(`unknown action ${action.kind}`);
  }
}

// ---- Reads over an RPC connection -----------------------------------------
const ownerEquals = (account, owner) => account?.owner && pk(account.owner).equals(pk(owner));

/** Validate a Core-owned account before parsing it. This deliberately checks
 * more than the discriminator: a hostile RPC response must also have the
 * expected owner, exact allocation, non-executable flag and PDA. */
export function assertCoreAccount(pubkey, account, name, expectedPda = pubkey) {
  const address = pk(pubkey);
  if (!account) throw new TypeError(`${name} account ${address.toBase58()} is missing`);
  if (!ownerEquals(account, PROGRAM_ID)) throw new TypeError(`${name} account ${address.toBase58()} has wrong owner`);
  if (account.executable) throw new TypeError(`${name} account ${address.toBase58()} must not be executable`);
  if (!address.equals(pk(expectedPda))) throw new TypeError(`${name} account ${address.toBase58()} is not the expected PDA`);
  const data = Buffer.from(account.data);
  if (data.length !== ACCOUNT_SIZE[name]) throw new TypeError(`${name} account has ${data.length} bytes, expected ${ACCOUNT_SIZE[name]}`);
  if (!data.subarray(0, 8).equals(accountDiscriminator(name))) throw new TypeError(`not a ${name} account`);
  return data;
}

function checkedShot(pubkey, account, expectedPlayer = null) {
  const address = pk(pubkey);
  const data = assertCoreAccount(address, account, 'Shot');
  const shot = parseShot(data);
  if (!address.equals(shotPda(shot.player, shot.nonce))) throw new TypeError(`Shot account ${address.toBase58()} is not its canonical PDA`);
  if (expectedPlayer && !shot.player.equals(pk(expectedPlayer))) throw new TypeError(`Shot account ${address.toBase58()} belongs to another player`);
  return { pubkey: address, ...shot };
}

export async function readShots(connection) {
  const filters = [{ dataSize: ACCOUNT_SIZE.Shot }, { memcmp: { offset: 0, bytes: toBase58(accountDiscriminator('Shot')) } }];
  const list = await connection.getProgramAccounts(PROGRAM_ID, { filters });
  return list.map(({ pubkey, account }) => checkedShot(pubkey, account));
}

/** Every shot the program holds, discovered by discriminator and size alone --
 * no wallet, no indexer, no list of players from anywhere. This is what lets a
 * stranger reconstruct the game from a program id and a public RPC, which is the
 * whole claim. readShots above does the same discovery but without a commitment
 * or a context slot, so it cannot say WHEN what it saw was true; that makes it
 * useful for a script and not useful for evidence. */
export async function readAllShotsWithContext(connection, commitment = 'finalized') {
  const filters = [
    { dataSize: ACCOUNT_SIZE.Shot },
    { memcmp: { offset: 0, bytes: toBase58(accountDiscriminator('Shot')) } },
  ];
  const response = await connection.getProgramAccounts(PROGRAM_ID, { commitment, filters, withContext: true });
  if (!response || Array.isArray(response) || !response.context || !Array.isArray(response.value))
    throw new TypeError('RPC did not return program accounts with context');
  return { contextSlot: response.context.slot, shots: response.value.map(({ pubkey, account }) => checkedShot(pubkey, account)) };
}

/** Read one wallet's shots with the exact server-side memcmp and an RPC
 * context slot. No indexer or application database participates. */
export async function readPlayerShots(connection, player, commitment = 'finalized') {
  const playerKey = pk(player);
  const filters = [
    { dataSize: ACCOUNT_SIZE.Shot },
    { memcmp: { offset: 0, bytes: toBase58(accountDiscriminator('Shot')) } },
    { memcmp: { offset: 8, bytes: playerKey.toBase58() } },
  ];
  const response = await connection.getProgramAccounts(PROGRAM_ID, { commitment, filters, withContext: true });
  if (!response || Array.isArray(response) || !response.context || !Array.isArray(response.value)) throw new TypeError('RPC did not return program accounts with context');
  return { contextSlot: response.context.slot, shots: response.value.map(({ pubkey, account }) => checkedShot(pubkey, account, playerKey)) };
}

export async function readLedger(connection, player) {
  const playerKey = pk(player); const address = ledgerPda(playerKey);
  const a = await connection.getAccountInfo(address);
  if (!a) return null;
  const ledger = parseLedger(assertCoreAccount(address, a, 'PlayerLedger', address));
  if (!ledger.player.equals(playerKey)) throw new TypeError('PlayerLedger stores the wrong player');
  return ledger;
}
export async function readLedgerWithContext(connection, player, commitment = 'finalized') {
  const playerKey = pk(player); const address = ledgerPda(playerKey);
  const response = await connection.getAccountInfoAndContext(address, commitment);
  if (!response?.context) throw new TypeError('RPC did not return ledger context');
  if (!response.value) return { contextSlot: response.context.slot, ledger: null };
  const ledger = parseLedger(assertCoreAccount(address, response.value, 'PlayerLedger', address));
  if (!ledger.player.equals(playerKey)) throw new TypeError('PlayerLedger stores the wrong player');
  return { contextSlot: response.context.slot, ledger };
}
export async function readPodium(connection) {
  const address = podiumPda(); const a = await connection.getAccountInfo(address);
  return a ? parsePodium(assertCoreAccount(address, a, 'Podium', address)) : null;
}
export async function readPodiumWithContext(connection, commitment = 'finalized') {
  const address = podiumPda(); const response = await connection.getAccountInfoAndContext(address, commitment);
  if (!response?.context) throw new TypeError('RPC did not return podium context');
  return { contextSlot: response.context.slot, podium: response.value ? parsePodium(assertCoreAccount(address, response.value, 'Podium', address)) : null };
}
export async function readClocks(connection, indices = FEEDS.map(f => f.index)) {
  const addresses = indices.map(clockPda);
  const infos = await connection.getMultipleAccountsInfo(addresses);
  return new Map(indices.map((i, k) => {
    if (!infos[k]) return [i, null];
    const clock = parseClock(assertCoreAccount(addresses[k], infos[k], 'FeedClock', addresses[k]));
    if (clock.feedId !== FEEDS[i]?.feedId) throw new TypeError(`FeedClock ${i} stores the wrong feed id`);
    return [i, clock];
  }));
}
export async function readPushes(connection, indices = FEEDS.map(f => f.index)) {
  const infos = await connection.getMultipleAccountsInfo(indices.map(pushAccount));
  return new Map(indices.map((i, k) => [i, infos[k] && infos[k].owner.equals(PYTH_RECEIVER) ? parsePriceUpdate(infos[k].data) : null]));
}
/** Podium seats whose RCX ATA exists — the only ones `reload` can pay. */
export async function payableSeats(connection) {
  const podium = await readPodium(connection);
  if (!podium || !podium.seats.length) return [];
  const infos = await connection.getMultipleAccountsInfo(podium.seats.map(s => ata(s.player)));
  return podium.seats.filter((s, i) => infos[i] && infos[i].owner.equals(TOKEN_PROGRAM)).map(s => s.player);
}

export function parseUpgradeableProgram(data, expectedProgramData = null) {
  const b = Buffer.from(data);
  if (b.length !== 36) throw new TypeError(`upgradeable Program account has ${b.length} bytes, expected 36`);
  if (b.readUInt32LE(0) !== 2) throw new TypeError('upgradeable loader account is not a Program');
  const programData = new PublicKey(b.subarray(4, 36));
  if (expectedProgramData && !programData.equals(pk(expectedProgramData))) throw new TypeError('Program points at a non-canonical ProgramData account');
  return { programData };
}

export function parseUpgradeableProgramData(data) {
  const b = Buffer.from(data);
  if (b.length < 45) throw new TypeError('ProgramData account is shorter than its 45-byte metadata header');
  if (b.readUInt32LE(0) !== 3) throw new TypeError('upgradeable loader account is not ProgramData');
  const option = b.readUInt8(12);
  if (option !== 0 && option !== 1) throw new TypeError('ProgramData has an invalid authority option');
  return {
    deployedSlot: b.readBigUInt64LE(4),
    upgradeAuthority: option === 1 ? new PublicKey(b.subarray(13, 45)) : null,
  };
}

/** Inspect the deployed program and its authority from one finalized RPC
 * snapshot. Reads only; never creates a signer or transaction. */
export async function readProgramDeployment(connection, commitment = 'finalized') {
  const [programDataPda] = PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], UPGRADEABLE_LOADER);
  const response = await connection.getMultipleAccountsInfoAndContext([PROGRAM_ID, programDataPda], commitment);
  if (!response?.context || !Array.isArray(response.value)) throw new TypeError('RPC did not return deployment accounts with context');
  const [program, programDataAccount] = response.value;
  if (!program) throw new TypeError(`program ${PROGRAM_ID.toBase58()} is missing`);
  const loader = pk(program.owner);
  if (!program.executable) throw new TypeError(`program ${PROGRAM_ID.toBase58()} is not executable`);
  if (!loader.equals(UPGRADEABLE_LOADER)) throw new TypeError(`program ${PROGRAM_ID.toBase58()} has the wrong loader owner`);
  const { programData } = parseUpgradeableProgram(program.data, programDataPda);
  if (!programDataAccount) throw new TypeError(`ProgramData ${programData.toBase58()} is missing`);
  if (!ownerEquals(programDataAccount, UPGRADEABLE_LOADER)) throw new TypeError('ProgramData has the wrong owner');
  if (programDataAccount.executable) throw new TypeError('ProgramData must not be executable');
  const decoded = parseUpgradeableProgramData(programDataAccount.data);
  return {
    contextSlot: response.context.slot, programId: PROGRAM_ID, loader, executable: true, programData,
    deployedSlot: decoded.deployedSlot, upgradeAuthority: decoded.upgradeAuthority, immutable: decoded.upgradeAuthority === null,
  };
}

function toBase58(buf) {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n; for (const b of buf) n = n * 256n + BigInt(b);
  let out = ''; while (n > 0n) { out = A[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = '1' + out; else break; }
  return out;
}
