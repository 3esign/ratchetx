// ============================================================
//  api/game.js — the whole backend in one endpoint.
//    GET  ?action=state[&wallet=..]   world + your player + ladders
//    POST {action:'shot',   auth, target, side, stake}
//    POST {action:'duel',   auth, side, stake}      vs the Warden
//    POST {action:'reload', auth, sig}              burn -> credits
//    POST {action:'anchor', auth, sig}              notarize the log
//
//  Economy (operator decisions, published):
//    every stake -> 70% BURN · 30% POTS · 0% creator.  [frozen 2026-08-18]
//    of the pot share: half feeds the DAILY pot (top 3, 50/30/20,
//    pays at 00:00 UTC), half the WEEKLY season pot (top 5,
//    40/25/15/12/8, pays Sunday 00:00 UTC).  [operator, 2026-08-19 —
//    announced in CHANGES, applies to stakes from this deploy on,
//    never retroactively. The 70/30/0 headline is unchanged.]
//    The creator takes trading fees on the token only. Wallet:
//    HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM  (fees, never funds)
//
//  Settlement is LAZY: every state call settles whatever expired.
//  No cron, no daemon, nothing to forget to run.
//
//  HARDENED 2026-08-19 (deep-dive fixes, all announced):
//    · demo-* identities never reach any ladder, pot, or the public
//      feed — "unranked" is now enforced server-side, not just labeled
//    · burn/anchor replay gates are atomic (SET NX), closing a race
//      that could double-credit one signature
//    · feed availability is checked BEFORE the stake is taken, and
//      every refund returns to the source it was paid from
//    · VOID refunds reverse their burn/pot contributions (the floor
//      is monotone by construction and never steps back)
//    · pot payouts release their one-shot lock on failure, so a
//      crashed payout retries instead of silently vanishing
//    · anchor XP pays at most once per wallet per 24h (anchoring
//      stays open to all — the cooldown only meters the XP)
//    · shots whose feed disappears for good auto-VOID 24h after
//      expiry instead of hanging open forever
//    · per-IP rate limiting; state?wallet= no longer creates
//      records for arbitrary strings
//    · the Warden now keeps its own PUBLIC RECORD: each hourly line
//      is sealed once (SET NX) and settled on the same oracle,
//      hits and misses alike. v0 heuristic, scored like everyone.
// ============================================================
const crypto = require('node:crypto');
const { getJSON, getCached, getJSONStrict, setJSON, setManyJSONAtomic, setnxJSON, delKey, scanKeys, durable, zincr, ztop, incrFloat, takeNum, hincr, hall, hseed} = require('../lib/kv.js');
const { verifyAuth, isDemo, isWalletShaped, b58decode } = require('../lib/verify.js');
const { getPrices } = require('../lib/prices.js');
const { priceAt, pathFor, sample: samplePx } = require('../lib/pxlog.js');
const { report: feedReport, noteSettle, ensureRollups } = require('../lib/feedhealth.js');
const { realisedVol, sigmaOver, probAbove } = require('../lib/vol.js');
const { ACCOUNTS: PX_ACCOUNTS } = require('../lib/onchain_px.js');
const { getTx, decideBurn, rpcCall, INCINERATOR } = require('../lib/burn.js');
const { append, decideAnchor } = require('../lib/log.js');
const MINT = process.env.RATCHET_MINT || '';       // set on token day -> real burns go live
const CREDIT_PER_TOKEN = +(process.env.CREDIT_PER_TOKEN || 1);
const VERSION = 'h51-2026-08-21';
const MIRROR_PROGRAM_ID = process.env.RATCHET_SEAL_PROGRAM_ID || '';
const MIRROR_RPC_URL = process.env.RATCHET_SEAL_RPC_URL || '';
const MIRROR_CLUSTER = process.env.RATCHET_SEAL_CLUSTER || 'devnet';
const MIRROR_ENABLED = !!(MIRROR_PROGRAM_ID && MIRROR_RPC_URL);

async function mirrorRpc(method, params) {
  if (!MIRROR_ENABLED) return undefined;
  try {
    const r = await fetch(MIRROR_RPC_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(6000),
      body: JSON.stringify({ jsonrpc:'2.0', id:1, method, params }),
    });
    const j = await r.json();
    return j && 'result' in j ? j.result : undefined;
  } catch { return undefined; }
}

async function getMirrorTx(sig) {
  return mirrorRpc('getTransaction', [sig, { encoding:'jsonParsed',
    maxSupportedTransactionVersion:0, commitment:'confirmed' }]);
}

// Decode the exact Anchor `seal` instruction shape. Confirmation used to
// compare only the commitment, which meant a transaction with altered feed,
// expiry, kind or threshold could still earn mirror XP. Treat every field as
// part of the receipt or keep the feature disabled.
function parseMirrorSeal(data) {
  if (!Buffer.isBuffer(data) || data.length < 69) return null;
  if (!data.subarray(0, 8).equals(Buffer.from('66caaba31b9869f2', 'hex'))) return null;
  const feedLen = data.readUInt32LE(48);
  if (feedLen !== 64 || data.length !== 69 + feedLen) return null;
  const feed = data.subarray(52, 52 + feedLen).toString('utf8');
  if (!/^[0-9a-f]{64}$/.test(feed)) return null;
  let o = 52 + feedLen;
  const expiry = Number(data.readBigInt64LE(o)); o += 8;
  const kind = data[o++];
  const thresholdE6 = data.readBigInt64LE(o);
  return {
    nonce: data.readBigUInt64LE(8),
    commit: data.subarray(16, 48).toString('hex'),
    feed, expiry, kind, thresholdE6,
  };
}

const SPLIT = { burn: 0.70, pot: 0.30, creator: 0.0 };   // frozen headline
const POT_DAY_SHARE = 0.5;                               // of the pot share: half daily, half weekly
// THE CHAMPION'S CUT (h3): the same 70/30/0 rule, enforced at the one
// door where REAL tokens move. Every RELOAD: 70% burns, 30% goes
// straight to the last completed day's top-3 wallets (50/30/20) inside
// the payer's own signed transaction. No pool, no custody, no key, no
// claim button. A podium wallet with no RCX account forfeits its leg to
// the burn. Announced in CHANGES; never retroactive.
const CHAMP = { pct: 0.30, curve: [0.5, 0.3, 0.2],
  // THE HOLDER RULE — keyless anti-dump: to be eligible for the podium a
  // wallet must still HOLD >= holdPct of the champion RCX it was paid in
  // the last holdDays days (balances are public; the chain enforces
  // nothing, the PODIUM SEAT does). Sell your winnings -> the next
  // player up takes your seat and your income stream. Nobody's tokens
  // are ever locked; dumping just has a published price.
  holdPct: 0.5, holdDays: 7 };
// SOFT-STAKING (h3): "staking" with NO deposit, NO custody, NO contract.
// A wallet registers (one signature), keeps its RCX exactly where it is,
// and earns daily PLAY-CREDITS on its verified on-chain balance — read
// from the chain, never held by us. Tokens never move; unregistering is
// instant; there is nothing to withdraw because nothing was deposited.
// Yield is deliberately modest (credits are play-rights, not tokens).
const STAKE = { rate: 0.001, minBal: 1000, capBal: 1_000_000 };   // ≤1,000 credits/day
const stakeYield = bal => (bal >= STAKE.minBal ? Math.floor(Math.min(bal, STAKE.capBal) * STAKE.rate) : 0);
// COMMIT-REVEAL SEALING (h6). The log and the API used to record a
// shot's side in plaintext at seal time — which meant an open shot's
// side was technically readable before settlement through the recent-log
// view and state?wallet=. That contradicted the one promise this game is
// named for. Now: the log's seal entry carries only
// sha256(`side|salt`); the side and salt are revealed in the settle
// entry, so anyone can verify every seal after the fact and nobody can
// read one before. This is also Stage 2 of the on-chain path: the same
// commitment can be anchored on-chain per shot.
const sha256hex = s => crypto.createHash('sha256').update(s).digest('hex');
// FREE STAKING (h11). The old three tiers — 100 x1, 500 x2, 2500 x5 — were three
// points on a square root: sqrt(stake/100). Making the curve continuous lets a
// player stake ANY amount in range without touching the design law, because the
// law lives in the shape of the curve, not in the tiers:
//
//   sublinear, so 25x the stake earns 5x the XP, never 25x — the ladder cannot
//   be bought — and XP is still only ever awarded on a HIT, so a bigger stake
//   buys leverage on being right and nothing whatsoever on being right.
// BEING RIGHT HAS TO PAY (h12). Until now a HIT awarded XP and nothing else, so
// a player's credit balance only ever fell — a perfect predictor still ran to
// zero, and after the one-time grant there was no way back except buying RCX.
//
// A hit now returns HIT_PAYOUT x the stake in credits. At 1.7x, break-even sits
// around 59% accuracy: beat the market consistently and you play forever, guess
// and you run down. It is a skill filter, not a faucet — you can only ever win
// credits by risking credits you already hold, and no token is ever minted.
//
// The frozen 70/30/0 split is untouched: every stake is still divided exactly as
// published. This is what the game DOES for winners, not a change to the rule.
const HIT_PAYOUT = 1.7;
const STAKE_MIN = 100;
// ONE CEILING, AT BOTH DOORS, AND IT IS ONLY FAT-FINGER PROTECTION.
// This used to be 100,000 to stop anyone buying rank with a big balance. That
// job now belongs to XP_MULT_CAP below — XP stops growing at 40,000, so a
// larger stake buys more risk and not one point more standing. With the
// rank-buying answer handled somewhere better, a cap on how much of YOUR OWN
// credits you may put at risk is just us deciding for you. The real limit is
// your balance, and the server already enforces that.
const STAKE_MAX = 1000000000;
// XP GROWS WITH THE SQUARE ROOT OF THE STAKE, AND THEN STOPS.
// Raising the cap to 100,000 lets a player actually spend a big reload
// instead of grinding it out 2,500 at a time. But the ladder pays real RCX
// through the podium, so if XP kept climbing with the stake, rank would be
// purchasable — the richest wallet would out-earn the most accurate one
// without being right more often. The multiplier therefore caps at x20,
// reached at 40,000. Above that you are risking more for the same rank:
// playing for credits, not for standing. Stated on the page, not buried.
// A STREAK HAS TO PAY SOMETHING.
// p.streak was tracked and displayed and did nothing, which makes it decoration.
// It now multiplies XP — never credits, so the frozen economics are untouched —
// and it rewards exactly what the ladder is supposed to reward: being right
// repeatedly. Capped, and reset by a single miss, which is what makes it worth
// protecting. Loss aversion is the strongest retention mechanic there is and
// this is the honest version of it.
const STREAK_STEP = 0.15, STREAK_CAP = 2.0;
const streakMult = k => Math.min(STREAK_CAP, 1 + Math.max(0, k) * STREAK_STEP);
const XP_MULT_CAP = 20;
const XP_CAP_AT = STAKE_MIN * XP_MULT_CAP * XP_MULT_CAP;   // 40,000
const stakeMult = st => Math.min(XP_MULT_CAP, Math.sqrt(st / STAKE_MIN));
const badStake = st => !Number.isInteger(st) || st < STAKE_MIN || st > STAKE_MAX;
const STAKES = { 500: 2.24, 2500: 5, 10000: 10, 50000: 20 };   // presets the UI offers
// THE BOARD (h4): targets are GENERATED, not hardcoded — a fresh mix
// every hour, deterministic from the clock (seeded PRNG), so every
// player and every server instance derives the same board with no
// coordination and no KV. Three evergreen anchors keep the rhythm;
// five rotating slots keep it alive: PUMPs and DUMPs sized to each
// feed's typical volatility, a head-to-head RACE, and THE BOX
// (breakout-or-not). Everything settles at expiry on the exit price —
// labels say "after", never "within", because honesty is the aesthetic.
// A sealed shot carries its own settlement spec, so board rotation can
// never touch an open bet. All feeds are external Pyth majors that no
// player can move.
const EVERGREEN = {
  // A first-time visitor used to have to wait five minutes to find out anything,
  // which is longer than most people stay. FLASH is the shortest window the
  // oracle can honestly settle: the sponsored feeds heartbeat at 60s, so two
  // minutes guarantees at least one print inside the window and usually several.
  // Anything shorter would void more often than it settled.
  SOL2:   { kind: 'dir', feed: 'SOL',  mins: 2,    baseXp: 8,  label: 'FLASH: SOL higher in 2 minutes' },
  SOL5:   { kind: 'dir', feed: 'SOL',  mins: 5,    baseXp: 10, label: 'SOL higher in 5 minutes' },
  PUMP30: { kind: 'dir', feed: 'PUMP', mins: 30,   baseXp: 14, label: 'PUMP higher in 30 minutes' },
  BTC60:  { kind: 'dir', feed: 'BTC',  mins: 60,   baseXp: 16, label: 'BTC higher in 1 hour' },
  ETH24:  { kind: 'dir', feed: 'ETH',  mins: 1440, baseXp: 24, label: 'ETH higher in 24 hours' },
    JUP15:  { kind: 'dir', feed: 'JUP',  mins: 15,   baseXp: 12, label: 'JUP higher in 15 minutes' },
    BONK30: { kind: 'dir', feed: 'BONK', mins: 30,   baseXp: 14, label: 'BONK higher in 30 minutes' },
};
const ROTFEEDS = ['SOL', 'BTC', 'ETH', 'BONK', 'WIF', 'JUP', 'PUMP'];
const TYPVOL = { SOL: 0.0075, BTC: 0.0045, ETH: 0.0065, BONK: 0.02, WIF: 0.018, JUP: 0.012, PUMP: 0.014 }; // typical hourly move
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const winTxt = m => m >= 60 ? (m === 60 ? '1 hour' : (m / 60) + ' hours') : m + ' minutes';
function targetBoard(hour) {
  const rnd = mulberry32((hour * 2654435761) % 2147483647);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const board = { ...EVERGREEN };
  { // rotator: a fast directional on a rotating meme feed
    const f = pick(['BONK', 'WIF', 'JUP']); const m = pick([10, 15, 30]);
    board[`H${hour}A`] = { kind: 'dir', feed: f, mins: m, baseXp: 12 + Math.round(m / 10), label: `${f} higher in ${m} minutes` };
  }
  { // THE PUMP: up-threshold sized to the feed's volatility
    const f = pick(ROTFEEDS); const m = pick([30, 60]); const mult = pick([1.2, 1.8, 2.5]);
    const pct = +(TYPVOL[f] * Math.sqrt(m / 60) * mult).toFixed(4);
    board[`H${hour}P`] = { kind: 'thr', feed: f, mins: m, pct, baseXp: Math.round(15 + mult * 4), noMult: 0.35, label: `THE PUMP: ${f} up +${(pct * 100).toFixed(1)}% after ${winTxt(m)}` };
  }
  { // THE DUMP: down-threshold — YES (it dumped) is the hard side
    const f = pick(ROTFEEDS); const m = pick([30, 60]); const mult = pick([1.2, 1.8]);
    const pct = +(TYPVOL[f] * Math.sqrt(m / 60) * mult).toFixed(4);
    board[`H${hour}D`] = { kind: 'thrDown', feed: f, mins: m, pct, baseXp: Math.round(15 + mult * 4), noMult: 0.35, label: `THE DUMP: ${f} down -${(pct * 100).toFixed(1)}% after ${winTxt(m)}` };
  }
  { // THE RACE: two feeds, relative performance, pure skill read
    const a = pick(ROTFEEDS); let b = pick(ROTFEEDS);
    if (b === a) b = ROTFEEDS[(ROTFEEDS.indexOf(a) + 1) % ROTFEEDS.length];
    const m = pick([30, 60]);
    board[`H${hour}R`] = { kind: 'race', feed: a, feed2: b, mins: m, baseXp: 20, label: `THE RACE: ${a} beats ${b} over ${winTxt(m)}` };
  }
  { // THE BOX: does the hour end outside the band, or trapped inside?
    const f = pick(['SOL', 'BTC', 'ETH']); const mult = pick([1.0, 1.5]);
    const pct = +(TYPVOL[f] * mult).toFixed(4);
    board[`H${hour}B`] = { kind: 'range', feed: f, mins: 60, pct, noMult: 0.6, baseXp: 18, label: `THE BOX: ${f} ends the hour OUTSIDE ±${(pct * 100).toFixed(1)}%` };
  }
  return board;
}
const boardHour = () => Math.floor(Date.now() / 3600e3);
const RANKS = [['COG',0],['PISTON',300],['FLYWHEEL',900],['TURBINE',2200],['REACTOR',5000]];
// ONE CURRENCY (h9). There is no second 'paper' balance and no daily handout:
// a wallet is granted credits ONCE, and after that credits come only from
// reloads (burned RCX), pot wins and the Gearbox. Every shot on the ladder
// therefore costs something real or something earned.
const WELCOME_GRANT = 5000;
const ARENA_MIN_CALLS = 10;
const PXFEEDS = ['SOL','BTC','ETH','BONK','WIF','JUP','PUMP'];   // below this an agent is published but not ranked
// Prize curves. Unclaimed shares ROLL OVER into the next pot of the same cadence.
const PRIZE_W = [0.40, 0.25, 0.15, 0.12, 0.08];   // weekly season: top 5
const PRIZE_D = [0.50, 0.30, 0.20];               // daily pot: top 3
const EPS = 0.0004; // |move| under 4bp = void -> stake refunded, no XP
const FLOOR_BASE = 0.004180;
const STALE_VOID_MS = 24 * 3600e3;  // feed gone 24h past expiry -> auto-void

// ============================================================
//  CHALLENGES — a question a player writes, that only counts if
//  somebody takes the other side.
//
//  The board asks everyone the same thing, which is what makes one
//  player's XP comparable to another's. Letting a player invent their own
//  question breaks that the moment they can invent one they expect to win:
//  a market of one is not a market.
//
//  So a challenge is not a solo shot. It is an offer. It sits on a public
//  board with its full terms, and it scores nothing until another wallet
//  takes the opposite side at the same stake. A bad offer simply never gets
//  taken, which is the market doing the refereeing.
//
//  THE PRICE IS STRUCK ON ACCEPTANCE, NOT ON AUTHORING. Terms are written
//  in relative form — "SOL up +0.5% in 30 minutes" — and the entry and the
//  threshold are both fixed at the moment the second player commits. If the
//  level were struck when the challenge was written, every minute it sat
//  unaccepted would hand one side a free option on a stale number.
//
//  Economically it is two ordinary shots. Both stakes go through takeStake,
//  so the frozen 70/30/0 rule applies exactly as it does everywhere else,
//  and the winner is paid the same 1.7x any hit pays. Nothing new to trust,
//  and acceptance simply produces two normal shots that the existing
//  settlement path resolves — same oracle, same price log, same proof page.
// ============================================================
const CHAL_MIN_MINS = 2, CHAL_MAX_MINS = 1440;
const CHAL_MAX_PCT = 0.25;                 // a 25% move is not a prediction
const CHAL_OPEN_MS = 30 * 60e3;            // unaccepted offers expire and refund
const CHAL_MAX_OPEN = 60;                  // board size
const CHAL_KINDS = ['dir', 'thr', 'thrDown'];
const chalXp = (kind, mins) =>
  Math.max(6, Math.round((kind === 'dir' ? 11 : 15) + mins / 12));

const seasonKey = () => {
  const d = new Date(); const onejan = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const wk = Math.ceil((((d - onejan) / 86400000) + onejan.getUTCDay() + 1) / 7);
  return `s${d.getUTCFullYear()}w${wk}`;
};
const rankOf = xp => { let r = 0; RANKS.forEach((k,i)=>{ if (xp >= k[1]) r = i; }); return r; };
const today = () => new Date().toISOString().slice(0,10);
const shortW = w => w.slice(0,4)+'…'+w.slice(-4);

// ---- per-IP rate limit: in-memory token window per instance. Not a
// fortress — serverless scales out — but it prices out naive loops, and
// the KV quota is the thing being protected.
const RL = globalThis.__ratchet_rl || (globalThis.__ratchet_rl = new Map());
function rateLimited(ip, isPost) {
  const now = Date.now(), win = 60e3, cap = isPost ? 20 : 80;
  const e = RL.get(ip) || { t: now, n: 0 };
  if (now - e.t > win) { e.t = now; e.n = 0; }
  e.n++; RL.set(ip, e);
  if (RL.size > 5000) RL.clear();          // crude memory bound
  return e.n > cap;
}

async function loadPlayer(w) {
  let p = await getJSONStrict(`u:${w}`);   // strict: a flaky read must NOT mint a fresh record
  const existed = !!p;
  if (!p) p = { w, xp:0, streak:0, best:0, hits:0, shots:0, bal:0, cr:WELCOME_GRANT, granted:true, burned:0, day:today(), open:[], closed:[] };
  if (p.cr == null) { p.cr = 0; p.burned = 0; }
  // migration: fold any legacy paper balance into credits, once, keeping what they had
  if (p.bal) { p.cr = (p.cr || 0) + p.bal; p.bal = 0; p.granted = true; }
  if (!p.granted) { p.cr = (p.cr || 0) + WELCOME_GRANT; p.granted = true; }
  // QUALIFICATION — the anti-Sybil rule.
  // The welcome grant is free and a keypair costs nothing to generate, so a
  // script could mint unlimited fully-ranked players and farm the ladder that
  // pays real RCX to the podium. Guests were already blocked; free keypairs
  // were not, which made the guest guard mostly decorative.
  //
  // Playing stays free for everyone. RANKING is what now costs what an honest
  // player already spent: a wallet enters the paying ladders once it has
  // touched RCX — burned some, or simply been seen holding some. Everyone who
  // was already playing is grandfathered, so nobody loses standing to this.
  if (p.qualified == null) p.qualified = !!(p.shots > 0 || p.xp > 0 || p.burned > 0);
  if (p.day !== today()) p.day = today();
  // OUT-OF-BAND CREDITS.
  // A reload or a pot payout used to write straight into the player blob. A
  // concurrent request holding an older snapshot would then save over it, and
  // for a reload the burn signature was already consumed — real RCX destroyed
  // with no way to reclaim it. Those credits are now deposited into an atomic
  // counter and drained here, so a lost race delays a credit by one request
  // instead of erasing it.
  const owed = await takeNum(`pend:${w}`);
  if (owed > 0) { p.cr = (p.cr || 0) + owed; p._drained = (p._drained || 0) + owed; }
  const owed7 = await takeNum(`c7:${w}`);
  if (owed7 > 0) {
    // champion pay lands on the day it is drained, which is the champion's
    // next request — effectively same-day, and never lost.
    p.champ7 = p.champ7 || {};
    p.champ7[today()] = (p.champ7[today()] || 0) + owed7;
    p._drained7 = (p._drained7 || 0) + owed7;
  }
  // keep the holder window from growing without bound
  if (p.champ7) for (const k of Object.keys(p.champ7))
    if (Date.now() - new Date(k + 'T00:00:00Z').getTime() > (CHAMP.holdDays + 1) * 86400e3) delete p.champ7[k];
  p._existed = existed;
  return p;
}
/** If the write fails after loadPlayer drained a queue, put it back rather
 *  than swallowing it. The deposit is atomic in both directions. */
async function savePlayer(p) {
  const q = playerRecord(p);
  try {
    await setJSON(`u:${p.w}`, q);
  } catch (e) {
    if (p._drained > 0)  { try { await incrFloat(`pend:${p.w}`, p._drained); } catch {} }
    if (p._drained7 > 0) { try { await incrFloat(`c7:${p.w}`, p._drained7); } catch {} }
    throw e;
  }
}
function playerRecord(p) {
  const q = { ...p };
  delete q._existed; delete q._src; delete q._drained; delete q._drained7;
  return q;
}
async function restoreDrains(players) {
  for (const p of players) {
    if (p._drained > 0)  { try { await incrFloat(`pend:${p.w}`, p._drained); } catch {} }
    if (p._drained7 > 0) { try { await incrFloat(`c7:${p.w}`, p._drained7); } catch {} }
  }
}
// TOTALS ARE ATOMIC.
// They were a JSON blob: read, mutate, write. Two stakes landing together
// counted as one, and at a period boundary a payout could be undone by a
// stake that had read the pot before it was paid — resurrecting a pot that
// had just been distributed in full. They are a Redis hash now: every
// increment is server-side atomic, and HGETALL still costs one round trip.
const STATS = 'h:stats';
let statsSeeded = false;
async function seedStats() {
  if (statsSeeded) return;
  statsSeeded = true;
  try {
    const legacy = await getJSONStrict('g:stats');
    if (legacy) await hseed(STATS, {
      burned: +legacy.burned || 0, pot: +legacy.pot || 0, potD: +legacy.potD || 0,
      shots: +legacy.shots || 0, realBurned: +legacy.realBurned || 0,
      champPaid: +legacy.champPaid || 0, stakePaid: +legacy.stakePaid || 0,
      stakers: +legacy.stakers || 0 });
  } catch { statsSeeded = false; }        // let the next request try again
}
async function loadStats() {
  await seedStats();
  const st = await hall(STATS);
  for (const f of ['burned','pot','potD','shots','realBurned','champPaid','stakePaid','stakers'])
    if (!Number.isFinite(st[f])) st[f] = 0;
  // derived, not stored: a stored high-water mark could be stepped BACKWARDS
  // by a stale write, which is exactly what "monotone by construction" must
  // never allow. Computing it from the burn total makes it monotone for real.
  st.floor = Math.max(FLOOR_BASE, FLOOR_BASE + (st.realBurned || 0) * 1e-9);
  return st;
}
/** Apply a set of deltas atomically, field by field. */
async function bumpStats(deltas) {
  for (const [f, v] of Object.entries(deltas)) if (v) await hincr(STATS, f, v);
}
async function bumpFeed(entry) {
  const f = (await getJSON('g:feed')) || [];
  f.unshift({ t: Date.now(), ...entry });
  await setJSON('g:feed', f.slice(0, 100));
}
// Ranked boards only ever see real, signature-verified wallets.
// LADDERS ARE ATOMIC.
// They used to be a JSON hash updated read-modify-write. Two settles landing
// together lost one player's XP, and — far worse — a single timed-out GET
// returned null, so the very next write replaced the ENTIRE board with one
// row. These are the keys that decide the daily pot and seat the podium, so
// they now live in a Redis sorted set: ZINCRBY is server-side atomic and no
// reader can rewrite the whole ladder from a stale snapshot.
const zkey = (pfx, period) => `z:${pfx}${period}`;
const migSeen = globalThis.__ratchet_mig || (globalThis.__ratchet_mig = new Set());

/** One-time lift of a legacy JSON ladder into its sorted set. Idempotent
 *  across instances via SETNX, and skipped entirely once this instance has
 *  seen the period. */
async function migrateLadder(pfx, period) {
  const k = zkey(pfx, period);
  if (migSeen.has(k)) return;
  migSeen.add(k);
  try {
    if (!(await setnxJSON(`mig:${k}`, { t: Date.now() }))) return;   // already lifted
    const old = await getJSON(`${pfx}${period}`);
    if (!old) return;
    for (const [w, xp] of Object.entries(old)) {
      if (!isDemo(w) && Number.isFinite(xp) && xp > 0) await zincr(k, xp, w);
    }
  } catch { migSeen.delete(k); }        // let the next request try again
}

/** Ranked [wallet, xp] descending. n omitted = the whole board. */
async function ladderTop(pfx, period, n) {
  await migrateLadder(pfx, period);
  return (await ztop(zkey(pfx, period), n)).filter(([w]) => !isDemo(w));
}

async function bumpLadder(w, xp, qualified) {
  if (isDemo(w)) return;
  if (qualified === false) return;      // unverified wallet: plays, does not rank
  await migrateLadder('lb:', seasonKey());
  await migrateLadder('lbd:', today());
  await zincr(zkey('lb:', seasonKey()), xp, w);
  await zincr(zkey('lbd:', today()), xp, w);
}

// ---- which token program owns the mint (classic vs Token-2022), cached 1h.
// The ATA derivation AND the burn instruction must both use this - guessing
// it wrong yields InvalidAccountData, which is exactly the bug this fixes.
async function getMintProgram() {
  if (!MINT) return null;
  const c = await getCached('g:mintprog', 30_000);
  if (c && Date.now() - c.t < 3600_000) return c.v;
  let v = null;
  const r = await rpcCall('getAccountInfo', [MINT, { encoding: 'base64' }]);
  if (r && r.value && r.value.owner) v = r.value.owner;
  if (v) await setJSON('g:mintprog', { v, t: Date.now() });
  return v;
}

// ---- pump.fun market cap, cached 60s; never allowed to break state
async function getMcap() {
  if (!MINT) return null;
  const c = await getCached('g:mcap', 15_000);
  if (c && Date.now() - c.t < 60_000) return c.v;
  let v = null;
  for (const base of ['https://frontend-api-v3.pump.fun', 'https://frontend-api.pump.fun']) {
    try {
      const r = await fetch(`${base}/coins/${MINT}`, { signal: AbortSignal.timeout(3500), headers: { 'accept': 'application/json' } });
      if (!r.ok) continue;
      const j = await r.json();
      const m = Number(j.usd_market_cap ?? j.market_cap);
      if (Number.isFinite(m) && m > 0) { v = Math.round(m); break; }
    } catch {}
  }
  await setJSON('g:mcap', { v, t: Date.now() });
  return v;
}

// ---- first existing RCX token account for a wallet — champions must
// hold an RCX account to be paid; a missing account forfeits to the burn.
// THREE OUTCOMES, NOT TWO.
//   { ata, bal }  the wallet's token account, read successfully
//   null          the chain answered: this wallet has no account for the mint
//   undefined     we could not read the chain at all
//
// It used to collapse the last two into null, and every caller turned that
// into `bal: 0`. So a dead RPC and an empty wallet produced the identical
// number — cached for a minute, shown to the holder as "0 RCX", and, worse,
// fed to the staking payout and the podium holder rule as if it were a fact.
// A balance we could not read is not a balance of zero.
async function findAta(owner) {
  const r = await rpcCall('getTokenAccountsByOwner', [owner, { mint: MINT }, { encoding: 'jsonParsed' }]);
  if (r == null) return undefined;                    // every endpoint failed
  const a = r.value && r.value[0];
  if (!a) return null;                                 // the chain says: no account
  const bal = +(a.account && a.account.data && a.account.data.parsed && a.account.data.parsed.info
    && a.account.data.parsed.info.tokenAmount && a.account.data.parsed.info.tokenAmount.uiAmount) || 0;
  return { ata: a.pubkey, bal };
}

// sum of champion RCX received inside the holder window — pure, tested.
function champWindowSum(champ7, nowMs, days) {
  if (!champ7) return 0;
  let s = 0;
  for (const [k, v] of Object.entries(champ7)) {
    const t = new Date(k + 'T00:00:00Z').getTime();
    if (Number.isFinite(t) && nowMs - t <= days * 86400e3) s += +v || 0;
  }
  return s;
}

// ---- pot rollovers: LAZY and automatic, daily and weekly. The first
// request after a boundary notices the period key changed, takes a
// one-shot lock, pays the pot as game credits, and records the result.
// No cron, no operator, nothing to forget. If the payout loop throws,
// the lock is RELEASED so the next request retries instead of the pot
// silently vanishing. Ties resolve by board order (insertion) — stable
// enough at this scale.
// An offer nobody took is not a bet. The author paid on writing it, so the
// stake comes back — and the burn/pot contribution is unwound with it, or the
// counters would record a shot that never happened. Lazy, like everything
// else: the next request that passes by does the work.
async function sweepChallenges() {
  const list = (await getCached('g:chal', 5_000)) || [];
  const now = Date.now();
  const dead = list.filter(c => c && c.expiresAt <= now);
  if (!dead.length) return;
  await setJSON('g:chal', list.filter(c => c && c.expiresAt > now));
  for (const c of dead) {
    // one refund per challenge, ever, whoever happens to sweep it
    if (!(await setnxJSON(`chalref:${c.id}`, { t: now }, 7 * 86400))) continue;
    try {
      const p = await loadPlayer(c.by);
      p.cr = (p.cr || 0) + c.stake;
      await reverseStake(c.stake, c.by);
      await savePlayer(p);
      await append({ k:'chalexpire', id: c.id, by: c.by, stake: c.stake, refunded: true });
    } catch {}
  }
}

async function rolloverPots() {
  const defs = [
    { ptr:'g:day',    cur: today(),     pfx:'lbd:', potF:'potD', prizes: PRIZE_D, res:'g:dayResults',    lock:'day:paid:',    tag:'DAILY',  k:'daypot' },
    { ptr:'g:season', cur: seasonKey(), pfx:'lb:',  potF:'pot',  prizes: PRIZE_W, res:'g:seasonResults', lock:'season:paid:', tag:'SEASON', k:'season' },
  ];
  for (const d of defs) {
    // NOT CACHED, DELIBERATELY. This pointer is what decides that a day or a
    // season has ended and the pot must pay out. Caching it to save two reads
    // means the payout can fire late by however long the TTL is — and a test
    // caught exactly that. Everything else on this page can be a few seconds
    // stale; the thing that moves money cannot.
    const ptr = await getJSON(d.ptr);
    if (!ptr) { await setJSON(d.ptr, d.cur); continue; }
    if (ptr === d.cur) continue;
    if (!(await setnxJSON(`${d.lock}${ptr}`, { t: Date.now() }))) { await setJSON(d.ptr, d.cur); continue; }
    try {
      const board = await ladderTop(d.pfx, ptr);
      const ranked = board.slice(0, d.prizes.length);
      const st = await loadStats();
      const pot = Math.floor(st[d.potF] || 0);
      let paid = 0; const winners = [];
      for (let i = 0; i < ranked.length; i++) {
        const share = Math.floor(pot * d.prizes[i]);
        if (share <= 0) continue;
        const [w, xp] = ranked[i];
        // The winner may be mid-request elsewhere; depositing cannot be
        // clobbered by their concurrent save the way a direct write could.
        await incrFloat(`pend:${w}`, share);
        paid += share;
        winners.push({ w: shortW(w), xp, share });
        await bumpFeed({ w: shortW(w), a: `${d.tag} #${i+1} · won ${share.toLocaleString()} credits`, c: 'hit' });
      }
      // Debit exactly what was paid. Writing the whole blob back here could
      // resurrect a pot that a concurrent stake had already re-inflated from a
      // pre-payout snapshot — the same pot then paid out twice.
      await bumpStats({ [d.potF]: -paid });   // unclaimed shares stay in the pot
      await setJSON(d.res, { period: ptr, pot, paid, rolled: pot - paid, winners, t: Date.now() });
      await append({ k: d.k, period: ptr, pot, paid, winners });
      if (d.k === 'daypot' && MINT) {
        // refresh the CHAMPION PODIUM: the day's top 3 earn 50/30/20 of
        // every reload's 30% cut until the next rollover. The outgoing
        // podium is kept one period as a grace window, so a reload built
        // moments before midnight still verifies against the list it was
        // built from.
        // Eligibility is the HOLDER RULE only — still holding >= 50% of the
        // last seven days' champion pay. A dumper is skipped silently and
        // the next player up is seated. Simply never having held any is not
        // dumping, and no longer forfeits a seat.
        const podRanked = board;
        const list = [];
        for (const [pw] of podRanked) {
          if (list.length >= CHAMP.curve.length) break;
          // NOT HAVING A TOKEN ACCOUNT IS NOT A REASON TO FORFEIT A SEAT.
          // This used to `continue` whenever findAta came back empty, which
          // sounds cautious and was in fact the single line keeping the
          // podium permanently empty: the reload flow asks you to BURN your
          // RCX, and a player who burns all of it has no token account left.
          // The mechanism selected against exactly the behaviour it rewards.
          // A missing account is a zero balance, nothing more — the holder
          // rule below still catches an actual dumper, because a dumper has
          // earned7 > 0 while a newcomer has earned7 == 0.
          // A seat is forfeited for DUMPING, not for our RPC being down. If we
          // cannot read the balance we cannot prove the rule was broken, and
          // the champion keeps the seat until we can.
          const read = await findAta(pw);
          const unreadable = read === undefined;
          const acc = read || { ata: null, bal: 0 };
          const cp = await getJSONStrict(`u:${pw}`);
          // Count what is banked but not yet drained too — a champion who has
          // not opened the site since being paid must not look like they
          // earned less, which would make the seat EASIER to keep.
          const banked = Number(await getJSON(`c7:${pw}`)) || 0;
          const earned7 = champWindowSum(cp && cp.champ7, Date.now(), CHAMP.holdDays) + banked;
          if (!unreadable && acc.bal + 1e-9 < earned7 * CHAMP.holdPct) continue; // dumped -> seat forfeited
          list.push({ w: pw, ata: acc.ata, pct: CHAMP.curve[list.length] });
        }
        const prevPod = await getJSON('g:podium');
        if (prevPod) await setJSON('g:podium:prev', prevPod);
        await setJSON('g:podium', { period: ptr, t: Date.now(), list });
        await append({ k: 'podium', period: ptr, list: list.map(x => ({ w: x.w, pct: x.pct })) });
      }
      if (d.k === 'daypot') {
        // STAGE 1a of the on-chain path: fold a daily BALANCE ROOT into
        // the hash-chained log — sha256 over every player's (wallet,
        // credits, xp, burned), sorted, plus the machine stats. Any
        // player-anchored log head AFTER this entry notarizes the root on
        // Solana itself — so a future on-chain migration can PROVE the
        // imported balances match a fingerprint that existed before the
        // migration was ever announced. Airdrop fairness, solved early.
        try {
          const rows = [];
          for (const uk of await scanKeys('u:*')) {
            const pu = await getJSON(uk);
            if (pu && pu.w) rows.push([pu.w, Math.floor(pu.cr || 0), Math.floor(pu.xp || 0), Math.floor(pu.burned || 0)]);
          }
          rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
          const st2 = await loadStats();
          const root = sha256hex(JSON.stringify({ day: ptr, rows,
            burned: st2.burned, realBurned: st2.realBurned || 0, champPaid: st2.champPaid || 0,
            pot: st2.pot, potD: st2.potD }));
          await append({ k: 'root', day: ptr, root, players: rows.length });
          await setJSON('g:lastRoot', { day: ptr, root, players: rows.length, t: Date.now() });
        } catch {}
      }
      await setJSON(d.ptr, d.cur);
    } catch (e) {
      await delKey(`${d.lock}${ptr}`);       // release: next request retries the payout
      throw e;
    }
  }
}

// ---- the Warden v0: a deterministic heuristic over live prices.
// Marked v0 on the page. The LLM brain replaces reasoning generation
// in Wave 3; the sealing/settlement machinery here does not change.
// ============================================================
//  THE WARDEN — the house's own line, and now an actual forecast.
//
//  WHAT THIS REPLACED, AND WHY.
//  The previous version computed its confidence from a hardcoded volatility
//  table. Every input was a constant, so the output was one too: 36% on SOL,
//  35% on BTC, 35% on ETH — the same three numbers every hour since launch.
//  It could not change its mind, it never looked at the market, and because
//  all three sit under 50 it always leaned the same way. Over thirty settled
//  calls it was right six times, which is roughly a 1-in-1,400 result for a
//  coin flip. It was not unlucky. It was a lookup table wearing a percentage.
//
//  Worse, the reason it showed players said the number came from "this pair's
//  typical realised volatility". Nothing realised was being measured.
//
//  It also asked a question it did not settle. The line read "trades above $X
//  WITHIN 6 hours" — a touch — while settlement compared the price at expiry
//  only. Touching is strictly easier than finishing above, so the Warden was
//  being graded on a harder event than the one it was asked. Since our own
//  sampling is not dense enough to detect every touch honestly, the fix is to
//  ask the terminal question we can actually settle, not to fake a touch test.
//
//  NOW: volatility is measured from the same per-minute price record that
//  settles every shot in the game, the line sits a fixed distance from spot,
//  and the probability follows from the two. A calm market and a violent one
//  produce different numbers for the same question, which is the entire point.
//  The distances rotate through both signs, so the Warden leans both ways.
//
//  And it can decline. If there is not enough price history to estimate
//  volatility, there is no line this hour — the same rule the rest of this
//  codebase follows about publishing statistics it cannot support.
// ============================================================
const WPOOL = [
  { feed: 'SOL', pct:  0.006, mins: 360 },
  { feed: 'BTC', pct: -0.004, mins: 360 },
  { feed: 'ETH', pct:  0.008, mins: 720 },
  { feed: 'SOL', pct: -0.005, mins: 720 },
  { feed: 'BTC', pct:  0.005, mins: 360 },
  { feed: 'ETH', pct: -0.006, mins: 360 },
];
const VOL_LOOKBACK_H = 24;
// One measurement per hour per instance: the line only changes on the hour,
// and estimating volatility means reading the price log.
const wcache = globalThis.__ratchet_wcache || (globalThis.__ratchet_wcache = { hour: -1, v: null });

async function wardenLine(prices) {
  const hour = Math.floor(Date.now() / 3600e3);
  const now = Date.now();
  if (wcache.hour === hour && wcache.v && prices[wcache.v.feed]
      && !(wcache.retryAt && now >= wcache.retryAt)) return wcache.v;

  const c = WPOOL[hour % WPOOL.length];
  const spot = prices[c.feed];
  const windowMs = c.mins * 60e3;
  const base = { id: `w${hour}`, feed: c.feed, mins: c.mins };

  if (!Number.isFinite(spot) || spot <= 0) {
    return { ...base, p: null, thresh: null, q: `${c.feed} has no usable price this hour`,
      r: 'The oracle did not give us a price for this feed, so the Warden has nothing to call.' };
  }

  let v = null;
  try { v = await realisedVol(c.feed, VOL_LOOKBACK_H, Date.now()); } catch { v = null; }

  if (!v || !v.ok) {
    // CACHED FOR A MINUTE, NOT FOR THE HOUR, AND NOT FOR ZERO SECONDS.
    //
    // Caching a refusal for the full hour would silence the Warden even after
    // the price log became sufficient. But NOT caching it at all — which is
    // what this did first — means every failed estimate re-walks 24 hours of
    // hourly buckets, and wardenLine is reached three times per request. On an
    // empty price log that took one state request from 21 reads to 97: a read
    // storm that fires hardest exactly when the store is already in trouble.
    //
    // A minute is the honest middle. It retries within the hour it becomes
    // ready, and a degraded log costs one extra walk per minute rather than
    // three per request.
    const line = { ...base, p: null, thresh: null,
      q: `${c.feed} — no line this hour`,
      r: `The Warden prices its own line off measured volatility, and there is not enough price `
       + `history yet to measure it (${(v && v.reason) || 'no estimate'}). It would rather post `
       + `nothing than quote a number it made up — which is exactly what the previous version did.` };
    wcache.hour = hour; wcache.v = line; wcache.retryAt = now + 60_000;
    return line;
  }

  const sigma = sigmaOver(v, windowMs);
  const thresh = +(spot * (1 + c.pct)).toFixed(c.feed === 'BTC' ? 0 : c.feed === 'ETH' ? 2 : 3);
  const prob = probAbove(spot, thresh, sigma);
  const p = prob == null ? null : Math.max(1, Math.min(99, Math.round(prob * 100)));

  const line = { ...base, thresh, p,
    sigmaPct: +(sigma * 100).toFixed(2),
    volHourlyPct: +v.hourlyPct.toFixed(3),
    volPairs: v.pairs,
    q: `${c.feed} is above $${thresh.toLocaleString(undefined, { maximumFractionDigits: 3 })} `
     + `at the ${c.mins / 60}-hour mark`,
    r: `Spot ${c.feed} is $${spot.toLocaleString(undefined, { maximumFractionDigits: 3 })} and the line `
     + `sits ${(c.pct * 100).toFixed(1)}% away. Realised volatility measured from ${v.pairs} of our own `
     + `price samples over the last ${VOL_LOOKBACK_H}h is ${v.hourlyPct.toFixed(2)}% per hour, which is `
     + `${(sigma * 100).toFixed(2)}% across a ${c.mins / 60}-hour window — so the line is `
     + `${Math.abs(Math.log(thresh / spot) / sigma).toFixed(2)} standard deviations `
     + `${c.pct >= 0 ? 'above' : 'below'} spot. Assuming no drift, that puts it at ${p}%. `
     + `This is backward-looking volatility: it says what the market has been doing, and it will be `
     + `wrong precisely when conditions change. Settled on the price at expiry, from the same samples `
     + `you can download.` };
  wcache.hour = hour; wcache.v = line; wcache.retryAt = 0;   // a real line holds for the hour
  return line;
}

// ---- the Warden's public record. Each hourly line is sealed exactly
// once (SET NX — first request of the hour wins, all others read it),
// then settled on the same oracle at its window's end. The record is
// aggregate hits + Brier over every settled call, misses included.
// An oracle that only shows you its wins is a horoscope with a UI.
// The record belongs to a MODEL, not to a name.
//
// The Warden's public record was 6 right out of 30 — earned entirely by the
// previous version, which quoted one of three hardcoded constants and could
// not change its mind. That predictor no longer exists. Carrying its record
// forward would slander the new one; deleting it would launder the old one.
//
// So the record resets at a model boundary and the retired one is KEPT and
// shown beside it, labelled with what it was. The reset is also appended to
// the hash-chained log, which is the part that matters: a scoreboard an
// operator can quietly zero is not a scoreboard, so the zeroing itself has to
// be a public event that breaks every hash after it if anyone edits it later.
const WARDEN_MODEL = 'v1-measured-volatility';

async function wardenRollover(now = Date.now()) {
  const meta = await getCached('g:warden:model', 60_000);
  if (meta && meta.model === WARDEN_MODEL) return false;
  const old = await getJSON('g:warden:rec');
  const from = (meta && meta.model) || 'v0-constant-probability';
  if (old && old.n > 0) {
    await setJSON('g:warden:rec:prev', { ...old, model: from, retiredAt: now,
      why: 'its stated probability was a hardcoded constant — 36% on SOL, 35% on BTC and ETH, every hour, '
         + 'so it always leaned the same way and never read the market' });
  }
  await setJSON('g:warden:rec', { n: 0, hits: 0, brier: 0 });
  await setJSON('g:warden:model', { model: WARDEN_MODEL, since: now });
  await append({ k: 'wardenmodel', from, to: WARDEN_MODEL,
    retired: old ? { n: old.n, hits: old.hits } : null });
  return true;
}

async function wardenTick(prices) {
  await wardenRollover();
  const wl = await wardenLine(prices);
  // No line, no seal. A Warden that cannot measure volatility has nothing to
  // say this hour, and saying nothing must not become a record of saying zero.
  if (wl.p == null || !Number.isFinite(wl.thresh)) return (await getCached('g:warden:rec', 5_000)) || { n:0, hits:0, brier:0 };
  const open = (await getCached('g:warden:open', 3_000)) || [];
  if (!open.some(o => o.id === wl.id)) {
    const sealed = { id: wl.id, feed: wl.feed, thresh: wl.thresh, p: wl.p,
      q: wl.q, entry: prices[wl.feed], t: Date.now(), exp: Date.now() + wl.mins * 60e3 };
    if (await setnxJSON(`wseal:${wl.id}`, sealed)) {
      open.push(sealed);
      await setJSON('g:warden:open', open);
      await append({ k:'wseal', id: sealed.id, feed: sealed.feed, thresh: sealed.thresh, p: sealed.p, exp: sealed.exp });
    }
  }
  const now = Date.now(); const still = []; let changed = false;
  const rec = (await getCached('g:warden:rec', 5_000)) || { n:0, hits:0, brier:0 };
  const hist = (await getCached('g:warden:hist', 5_000)) || [];
  for (const s of open) {
    const px = prices[s.feed];
    if (now < s.exp || !Number.isFinite(px)) { still.push(s); continue; }
    // ONE SETTLEMENT PER LINE, EVER.
    // Two requests arriving together both read the same open list, both find
    // the same expired line, and both increment the record — so one call could
    // count as two, in the public record, on the page that claims a Warden's
    // score is honest. Sealing was already guarded this way; settling was not.
    // It is also what makes the open list safe to read from a short cache.
    if (!(await setnxJSON(`wsettled:${s.id}`, { t: now }, 7 * 86400))) { changed = true; continue; }
    const outcome = px > s.thresh;                       // did it cross?
    const said = s.p >= 50;                              // what the Warden leaned
    const hit = said === outcome;
    rec.n++; if (hit) rec.hits++;
    rec.brier += Math.pow(s.p / 100 - (outcome ? 1 : 0), 2);
    hist.unshift({ id: s.id, q: s.q, p: s.p, outcome, hit, exitPx: px, t: now });
    changed = true;
    await append({ k:'wsettle', id: s.id, outcome, hit, exitPx: px });
  }
  if (changed) {
    await setJSON('g:warden:rec', rec);
    await setJSON('g:warden:hist', hist.slice(0, 20));
  }
  if (changed || still.length !== open.length) await setJSON('g:warden:open', still);
  return rec;
}


// ============================================================
//  THE FLEET (h14) — the Machine's own agents.
//
//  A prediction arcade with three players has nothing to watch and nobody
//  to beat. These four fix that WITHOUT faking anything: each is a named
//  character with a published method, each fires one real call an hour on
//  the same board every player sees, each settles on the same oracle, and
//  each accrues a public record including its losses.
//
//  Hard rules, so the counters stay honest:
//    · agents NEVER enter a ladder, a pot, the podium or the burn counter
//    · agents stake nothing — they cost the machine nothing and feed it nothing
//    · every call is published at seal time and written to the log, so an
//      agent cannot quietly change its mind before the window closes
//
//  They exist to be beaten. The page says so.
// ============================================================
const AGENTS = [
  { id:'mom', name:'MOMENTUM',   blurb:'rides the last hour of drift — strength continues, weakness continues' },
  { id:'rev', name:'REVERSION',  blurb:'expects less than the board does — fades stretched moves, bets ranges hold' },
  { id:'vol', name:'VOLATILITY', blurb:'plays for movement, never direction — takes the outside of every band' },
  { id:'con', name:'CONTRARIAN', blurb:'fights the Warden — takes the other side of the house AI, every hour' },
];

// drift = how the feed moved over the previous hour, the only history an
// agent gets. Stored once per hour when the fleet seals.
function agentSide(agentId, t, prices, drift, seedN, wardenUp) {
  const d = Number.isFinite(drift) ? drift : 0;
  const k = t.kind;
  if (agentId === 'mom') {
    if (k === 'dir')      return d >= 0 ? 'YES' : 'NO';
    if (k === 'thr')      return d > (t.pct || 0) * 0.35 ? 'YES' : 'NO';
    if (k === 'thrDown')  return d < -(t.pct || 0) * 0.35 ? 'YES' : 'NO';
    if (k === 'range')    return Math.abs(d) > (t.pct || 0) * 0.5 ? 'YES' : 'NO';
    return d >= 0 ? 'YES' : 'NO';                       // race: leader keeps leading
  }
  if (agentId === 'rev') {
    // REVERSION used to be the strict inverse of MOMENTUM. That is not a
    // strategy, it is a sign flip: the two records were complementary by
    // construction, so the fleet had four names and three opinions. (It
    // showed: 7/8 against 0/6 over the same calls.)
    //
    // It now has its own falsifiable thesis — the market travels LESS far
    // than the board is asking, and stretched moves get given back. That
    // agrees with MOMENTUM on quiet hours and splits from it on loud ones,
    // which is what an independent opinion looks like.
    const typ = TYPVOL[t.feed] || 0.01;
    const stretched = Math.abs(d) > typ * 1.3;     // an overshoot worth fading
    if (k === 'dir')      return stretched ? (d > 0 ? 'NO' : 'YES') : (d >= 0 ? 'YES' : 'NO');
    if (k === 'thr')      return 'NO';             // it will not clear the level
    if (k === 'thrDown')  return 'NO';             // it will not fall that far
    if (k === 'range')    return 'NO';             // the band holds
    return d >= 0 ? 'NO' : 'YES';                  // race: the laggard closes the gap
  }
  if (agentId === 'vol') {
    if (k === 'range')    return 'YES';                 // always bets the band breaks
    if (k === 'thr' || k === 'thrDown') return Math.abs(d) > (t.pct || 0) * 0.3 ? 'YES' : 'NO';
    return (seedN & 1) ? 'YES' : 'NO';                  // no directional view at all
  }
  if (agentId === 'con') {
    // fights the house AI: whatever the Warden leans, this takes the other side
    const up = !!wardenUp;
    if (k === 'thrDown') return up ? 'YES' : 'NO';   // Warden up -> bet the drop
    if (k === 'range')   return up ? 'YES' : 'NO';   // Warden confident -> bet the break
    return up ? 'NO' : 'YES';
  }
  return 'YES';
}

// ---- the fleet's lazy tick: settle what expired, then seal this hour once.
async function agentsTick(prices) {
  const wLine = await wardenLine(prices);
  const wardenUp = !!(wLine && wLine.p != null && wLine.p >= 50);
  const hour = boardHour();
  const board = Object.entries(targetBoard(hour))
    .filter(([, t]) => Number.isFinite(prices[t.feed]) && (!t.feed2 || Number.isFinite(prices[t.feed2])));
  const recs = (await getCached('g:agents:rec', 5_000)) || {};
  let open = (await getCached('g:agents:open', 3_000)) || [];
  const now = Date.now();

  // ---- settle
  const still = []; let changed = false;
  for (const o of open) {
    const px = prices[o.feed];
    if (now < o.exp || !Number.isFinite(px)) { still.push(o); continue; }
    // Same guard as the Warden, for the same reason: two requests arriving
    // together would both settle this call and count it twice in a record the
    // page publishes as an accuracy figure. It also makes the open list safe
    // to read from a short cache instead of on every single request.
    if (!(await setnxJSON(`asettled:${o.id}`, { t: now }, 7 * 86400))) { changed = true; continue; }
    let outcome;
    // Same question, same rule as a human gets. THE BOX was scored strictly
    // outside for agents and inclusively for players — two rules for one board.
    if (o.kind === 'thr')          outcome = px > o.thresh;
    else if (o.kind === 'thrDown') outcome = px < o.thresh;
    else if (o.kind === 'range')   outcome = Math.abs((px - o.entry) / o.entry) >= o.pct;
    else                           outcome = px > o.entry;
    const said = o.side === 'YES';
    const hit = said === outcome;
    const r = recs[o.agent] || (recs[o.agent] = { n:0, hits:0, streak:0, best:0 });
    r.n++; if (hit) { r.hits++; r.streak++; r.best = Math.max(r.best, r.streak); } else r.streak = 0;
    r.last = { label: o.label, side: o.side, hit, t: now };
    const nm = (AGENTS.find(a => a.id === o.agent) || {}).name || o.agent;
    await bumpFeed({ w: nm, a: `${hit ? 'HIT' : 'MISS'} — ${o.label} · called ${o.side}`, c: hit ? 'hit' : 'miss', agent: 1 });
    await append({ k:'agent', agent: o.agent, id: o.id, res: hit ? 'hit' : 'miss', side: o.side, exitPx: px });
    changed = true;
  }
  open = still;

  // ---- seal one call per agent per hour, exactly once, published openly
  if (board.length) {
    for (let i = 0; i < AGENTS.length; i++) {
      const a = AGENTS[i];
      const id = `${a.id}-${hour}`;
      if (open.some(o => o.id === id)) continue;
      const seedN = Math.abs(mulberry32(hour * 31 + i * 7)() * 1e9 | 0);
      const [, t] = board[seedN % board.length];
      const prev = (await getJSON('g:agents:px')) || {};
      const p0 = prev[t.feed], p1 = prices[t.feed];
      const drift = Number.isFinite(p0) && p0 > 0 ? (p1 - p0) / p0 : 0;
      const side = agentSide(a.id, t, prices, drift, seedN, wardenUp);
      const call = { id, agent: a.id, label: t.label, kind: t.kind, feed: t.feed, side,
        entry: p1, t: now, exp: now + t.mins * 60e3 };
      if (t.kind === 'thr')          call.thresh = p1 * (1 + t.pct);
      else if (t.kind === 'thrDown') call.thresh = p1 * (1 - t.pct);
      else if (t.kind === 'range')   { call.lo = p1 * (1 - t.pct); call.hi = p1 * (1 + t.pct); }
      if (await setnxJSON(`aseal:${id}`, call)) {
        open.push(call); changed = true;
        await append({ k:'aseal', agent: a.id, id, label: t.label, side, entry: p1, exp: call.exp });
      }
    }
    // remember this hour's prices so next hour has a drift to reason about
    await setJSON('g:agents:px', { SOL:prices.SOL, BTC:prices.BTC, ETH:prices.ETH,
      BONK:prices.BONK, WIF:prices.WIF, JUP:prices.JUP, PUMP:prices.PUMP });
  }

  if (changed) { await setJSON('g:agents:rec', recs); await setJSON('g:agents:open', open); }
  return {
    fleet: AGENTS.map(a => {
      const r = recs[a.id] || { n:0, hits:0, streak:0, best:0 };
      // ONE EVIDENCE STANDARD PER PAGE.
      // The ARENA panel thirty lines below this one refuses to rank an agent
      // under ARENA_MIN_CALLS settled calls, and says out loud that a 3-for-3
      // streak is not evidence. THE FLEET sat directly above it publishing
      // 88% from eight calls in green, and SORTING BY IT — so a one-for-one
      // agent outranked a twenty-for-thirty one. Same page, opposite
      // standards. The house holds itself to the standard it sets for guests.
      return { id:a.id, name:a.name, blurb:a.blurb, n:r.n, hits:r.hits, streak:r.streak, best:r.best,
        acc: r.n ? Math.round((r.hits / r.n) * 100) : null, last: r.last || null,
        listed: r.n >= ARENA_MIN_CALLS, minCalls: ARENA_MIN_CALLS };
    }).sort((x, y) => (y.listed - x.listed) || ((y.acc ?? -1) - (x.acc ?? -1)) || y.n - x.n),
    open: open.map(o => ({ agent:o.agent, label:o.label, side:o.side, exp:o.exp, entry:o.entry })),
  };
}

function refund(p, s) { p.cr += s.stake; }

// full per-player shot history — every settled shot, capped at 200,
// served to the client and exported by the Black Box. The hash-chained
// log stays the ground truth; this is the readable per-wallet view.
async function pushHist(w, rec) {
  const k = `hist:${w}`;
  const h = (await getJSON(k)) || [];
  h.unshift(rec);
  await setJSON(k, h.slice(0, 200));
}

async function settle(p, prices) {
  if (!p.open.length) return false;
  const now = Date.now(); let changed = false;
  const still = [];
  for (const s of p.open) {
    if (now < s.exp) { still.push(s); continue; }
    // THE EXIT PRICE IS NOT "THE PRICE NOW".
    // It is the first oracle sample we recorded at or after this shot's
    // expiry — the same first-crossing rule the on-chain program enforces.
    // That is what stops an expired shot being a free option: it no longer
    // matters who triggers the settle, or when.
    // New shots pin the oracle lane used at seal. A Pyth outage may void a
    // shot, but it may never quietly turn a Pyth entry into a Coinbase exit.
    // Legacy shots predate `oracleSrc` and retain their old behaviour so an
    // upgrade cannot strand already-open positions.
    const at = await priceAt(s.exp, now, s.oracleSrc || null);
    // Every deferral and every void is a measured consequence of the oracle
    // being late. We count them per feed and publish the totals — a late
    // publish is not a log line here, it is somebody's refunded stake.
    if (at.wait) { await noteSettle(s.feed, 'wait'); still.push(s); continue; }
    const px  = at.row ? at.row[s.feed] : undefined;
    const px2 = s.kind === 'race' ? (at.row ? at.row[s.feed2] : undefined) : 1;
    if (at.expired || !Number.isFinite(px) || !Number.isFinite(px2)) {
      // The grace window closed with no usable sample, or the feed was gone
      // when it closed. Refund rather than invent a number.
      changed = true;
      if (at.expired) await noteSettle(s.feed, 'void');
      refund(p, s); s.res = 'void'; s.settledAt = now; s.exitPx = null;
      await reverseStake(s.stake, p.w);
      await append({ k:'settle', w: p.w, id: s.id, res: 'void',
        reason: at.expired ? 'no-oracle-sample-in-window' : 'feed-gone' });
      await pushHist(p.w, { id: s.id, t: now, label: s.label, side: s.side, res: 'void', xp: 0, stake: s.stake, entry: s.entry, exit: null });
      p.closed.unshift(s); p.closed = p.closed.slice(0, 20);
      continue;
    }
    changed = true;
    let outcome;
    // A non-event must not pay a side. thr/thrDown/range used to resolve NO
    // on an exact standstill, handing the discounted-XP side a full 1.7x for
    // a market that did nothing. They now void on a tie like dir and race do.
    if (s.kind === 'thr') outcome = Math.abs(px - s.thresh) / s.thresh < EPS ? 'VOID' : (px > s.thresh ? 'YES' : 'NO');
    else if (s.kind === 'thrDown') outcome = Math.abs(px - s.thresh) / s.thresh < EPS ? 'VOID' : (px < s.thresh ? 'YES' : 'NO');
    else if (s.kind === 'range') {
      const d = Math.abs((px - s.entry) / s.entry);
      outcome = Math.abs(d - s.pct) < EPS ? 'VOID' : (d >= s.pct ? 'YES' : 'NO');
    }
    else if (s.kind === 'race') {
      const a = (px - s.entry) / s.entry, b2 = (px2 - s.entry2) / s.entry2;
      if (Math.abs(a - b2) < EPS) outcome = 'VOID';
      else outcome = a > b2 ? 'YES' : 'NO';
    }
    else {
      const chg = (px - s.entry) / s.entry;
      if (Math.abs(chg) < EPS) outcome = 'VOID';
      else outcome = chg > 0 ? 'YES' : 'NO';
    }
    if (outcome === 'VOID') {
      refund(p, s); s.res = 'void';
      await reverseStake(s.stake, p.w);           // a refunded stake feeds nothing
    }
    else if (outcome === s.side) {
      p.shots++; s.res = 'hit'; p.hits++;
      const sm = streakMult(p.streak);          // the run you had BEFORE this shot
      s.xpBase = s.xp;
      s.streakMult = +sm.toFixed(2);
      s.xp = Math.max(1, Math.round(s.xp * sm));
      p.streak++; p.best = Math.max(p.best, p.streak);
      p.xp += s.xp; await bumpLadder(p.w, s.xp, p.qualified);
      s.back = Math.floor(s.stake * HIT_PAYOUT);      // being right pays
      p.cr += s.back;
      if (!isDemo(p.w)) await bumpFeed({ w: shortW(p.w),
        a: `HIT +${s.xp} XP · +${s.back.toLocaleString()} credits`, c: 'hit' });
    } else {
      p.shots++; s.res = 'miss'; p.streak = 0;
      if (!isDemo(p.w)) await bumpFeed({ w: shortW(p.w), a: 'MISS - streak reset', c: 'miss' });
    }
    s.settledAt = now; s.exitPx = px; s.exitAt = at.row.t;
    await noteSettle(s.feed, 'set');
    await append({ k:'settle', w: p.w, id: s.id, res: s.res, exitPx: px, exitAt: at.row.t,
      side: s.side, salt: s.salt, commit: s.commit });   // the reveal: sha256(side|salt) must equal the seal's commit
    await pushHist(p.w, { id: s.id, t: now, label: s.label, side: s.side, res: s.res,
      xp: s.res === 'hit' ? s.xp : 0, back: s.back || 0, stake: s.stake, entry: s.entry, exit: px });
    p.closed.unshift(s); p.closed = p.closed.slice(0, 20);
  }
  p.open = still;
  return changed;
}

// Take the stake AFTER all validation has passed. 70% burn, 30% pots
// (split half daily / half weekly). The floor is monotone by
// construction: it only ever ratchets to a new maximum.
// ENTRY FRESHNESS.
// The sponsored feeds print on a 60s heartbeat or a 0.5% move, so in a quiet
// market the price we hold can lag the real market by most of a heartbeat.
// Settlement is immune to that now (it reads the recorded sample), but SEALING
// was not: a player watching a live feed could open a position against a stale
// print and start ahead. On a five-minute chamber, a 55-second-old entry is a
// fifth of the window.
//
// The bound is proportionate to the window, because that is where the harm
// scales — 55 seconds means nothing to a 24-hour call. We refuse the seal
// rather than invent a fresher price; the next print is never far away.
//
// Note this is deliberately stricter than the 120s we accept for DISPLAYING a
// price. Showing a slightly old number is honest (the age is printed next to
// it). Letting someone open a position against it is not.
const maxSealAge = mins => Math.min(60, Math.max(30, Math.round(0.15 * mins * 60)));

async function takeStake(p, stake) {
  if (badStake(stake)) return `stake must be a whole number between ${STAKE_MIN} and ${STAKE_MAX.toLocaleString()}`;
  if (p.cr < stake) return `not enough credits — you have ${Math.floor(p.cr).toLocaleString()}${MINT ? '. Reload: burn RCX for credits, 1 for 1.' : '.'}`;
  p.cr -= stake; p._src = 'cr';
  // A guest identity is free and unlimited, so guest stakes must not touch
  // any published total. They already never reach a ladder, the feed or the
  // podium; the pots and the burn counter were the hole. The guest still
  // pays the credits and plays the identical game.
  if (isDemo(p.w)) return null;
  await seedStats();
  await bumpStats({
    burned: stake * SPLIT.burn,
    potD:   stake * SPLIT.pot * POT_DAY_SHARE,
    pot:    stake * SPLIT.pot * (1 - POT_DAY_SHARE),
    shots:  1,
  });
  return null;
}

// A VOIDed shot gives the stake back — so its contribution to the burn
// and pot counters is reversed too (clamped at zero; the shots-fired
// count and the floor's high-water mark stay, both deliberately).
async function reverseStake(stake, w) {
  if (w && isDemo(w)) return;          // never took it; never give it back
  await seedStats();
  await bumpStats({
    burned: -stake * SPLIT.burn,
    potD:   -stake * SPLIT.pot * POT_DAY_SHARE,
    pot:    -stake * SPLIT.pot * (1 - POT_DAY_SHARE),
  });
}

module.exports = async (req, res) => {
  const heldPlayerLocks = [];
  const acquirePlayerLock = async w => {
    if (!(isWalletShaped(w) || isDemo(w))) return false;
    const key = `lock:u:${w}`;
    if (heldPlayerLocks.includes(key)) return true;
    if (!(await setnxJSON(key, { t:Date.now() }, 30))) return false;
    heldPlayerLocks.push(key); return true;
  };
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const isPost = req.method !== 'GET';
    if (rateLimited(ip, isPost)) return res.status(429).json({ ok:false, reason:'slow down - too many requests from this address' });

    const action = (req.method === 'GET' ? req.query.action : (req.body||{}).action) || 'state';
    // Player records are JSON blobs. Without a per-wallet mutex, two shots
    // can load the same credit balance, both spend it, then last-write-wins
    // the balance while retaining economic effects from both requests.
    const playerActions = new Set(['state','shot','duel','stake','challenge','accept',
      'agent-register','reload','mirror_confirm','anchor']);
    const lockWallet = req.method === 'GET' ? req.query.wallet
      : req.body && req.body.auth && req.body.auth.wallet;
    if (playerActions.has(action) && (isWalletShaped(lockWallet) || isDemo(lockWallet))) {
      if (!(await acquirePlayerLock(lockWallet)))
        return res.status(409).json({ ok:false, reason:'that player already has an update in flight — retry' });
    }

    // ============================================================
    //  THE OBSERVATORY.
    //  We settle real bets off Pyth's sponsored push feeds, which makes us a
    //  consumer that cannot look away when one misbehaves. The measurements
    //  are a by-product of settlement sampling we were already doing. Nobody
    //  publishes third-party numbers on sponsored feed behaviour, so we do,
    //  including the ones that make us look bad (ourDutyPct) and the limits
    //  that stop any of it being over-quoted.
    //  Public, unauthenticated, JSON. Read it, disagree with it, reproduce it.
    //
    //  IT SITS ABOVE THE PRICE FETCH ON PURPOSE. Everything below this line
    //  needs a live oracle read first. This endpoint reports on the ORACLE'S
    //  OWN HEALTH from samples already recorded — so it must still answer on
    //  the day every price source is down, which is the day someone actually
    //  wants to look at it. A health page that goes dark with the thing it
    //  monitors is not a health page.
    // ============================================================
    if (action === 'feeds') {
      // Summarise any completed day whose raw buckets are still alive. This
      // is the deadline nobody sees: the buckets carry a four-day TTL, so a
      // day not folded before then is gone permanently. Throttled to one
      // pass per instance per ten minutes, and never allowed to fail the page.
      try { await ensureRollups(); } catch {}
      const rep = await feedReport(Number(req.query.hours) || 24);
      for (const f of Object.keys(rep.feeds)) {
        rep.feeds[f].account = (PX_ACCOUNTS[f] || [])[0] || null;
        rep.feeds[f].feedId  = (PX_ACCOUNTS[f] || [])[1] || null;
      }
      rep.ok = true; rep.v = VERSION;
      rep.what = 'third-party measurement of Pyth sponsored push feeds on Solana, taken by a consumer that settles real bets on them';
      rep.method = 'one read of each sponsored price account per minute over plain JSON-RPC; PriceUpdateV2 decoded locally; owner, discriminator, verification level and feed id all checked before a number is kept';
      rep.reproduce = 'GET /api/game?action=path&feed=SOL&from=<ms>&to=<ms> returns the same samples these statistics are computed from';
      res.setHeader('access-control-allow-origin', '*');
      return res.json(rep);
    }

    const prices = await getPrices();

    // AWAITED, DELIBERATELY, AND THIS WAS A BUG FOR A LONG TIME.
    //
    // This used to be fire-and-forget: `samplePx(prices).catch(() => {})`,
    // on the reasoning that a statistic must never fail a request. But a
    // serverless function can be frozen the instant it sends its response,
    // and any promise still in flight dies with it. So the write raced the
    // reply and lost often enough to be measurable — a heartbeat calling
    // once a minute was landing roughly three samples in five.
    //
    // A lost sample is not a lost statistic. It is a minute with no oracle
    // record, which means a shot expiring in that minute settles on a print
    // further from its expiry than it should have. This is settlement
    // evidence, not telemetry, and it has to actually reach the store.
    //
    // Awaiting costs nothing in the ordinary case: sample() returns on the
    // throttle without touching the network unless a minute has passed, so
    // only the one request per instance per minute that genuinely samples
    // pays for the round trip. The try/catch keeps the original promise
    // intact — a failed write still never fails the request.
    try { await samplePx(prices); } catch {}

    // Left unawaited on purpose, and it is a different case: a missed sweep
    // costs nothing permanent because the next request sweeps again, while
    // awaiting it would put a Redis read in front of every single response.
    sweepChallenges().catch(() => {});

    if (action === 'blockhash') {
      const r = await rpcCall('getLatestBlockhash', [{ commitment: 'confirmed' }]);
      const bh = r && r.value && r.value.blockhash;
      if (!bh) return res.status(502).json({ ok: false, reason: 'RPC unavailable - try again' });
      return res.json({ ok: true, blockhash: bh });
    }

    if (action === 'state') {
      // The daily cron lands here at 00:05 UTC, which is exactly when the
      // previous day has just closed and its buckets are freshest. Rolling
      // the observatory's history from the same tick that rolls the pots
      // means the record survives even if nobody ever opens /api/feeds.
      try { await ensureRollups(); } catch {}
      await rolloverPots();
      const wardenRec = await wardenTick(prices);
      const fleet = await agentsTick(prices);
      const podNow = (await getCached('g:podium', 15_000)) || { list: [] };
      const wRaw = req.query.wallet;
      const w = (typeof wRaw === 'string' && (isWalletShaped(wRaw) || isDemo(wRaw))) ? wRaw : null;
      let player = null;
      if (w) {
        const p = await loadPlayer(w);
        const changed = await settle(p, prices);
        // Only persist players that already exist or actually changed —
        // a bare state?wallet=<anything> must not mint KV records.
        if (p._existed || changed) await savePlayer(p);
        // BLINK AUTO-CREDIT
          if (!isDemo(w)) {
            try {
              const { rpcCall, getTx } = require('../lib/burn.js');
              const { decideAnchor } = require('../lib/log.js');
              const heads = (await getJSON('g:log:heads')) || {};
              const sigs = await rpcCall('getSignaturesForAddress', [w, { limit: 5 }]);
              if (Array.isArray(sigs)) {
                for (const s of sigs) {
                  if (s.err) continue;
                  const sig = s.signature;
                  if (await getJSONStrict('sig:'+sig)) continue;
                  const tx = await getTx(sig);
                  if (!tx) continue;
                  const d = decideAnchor(tx, { wallet: w, heads });
                  if (d.ok && await setnxJSON('sig:'+sig, { w, anchor:d.i, t:Date.now() })) {
                    // Use the exact same cooldown as the explicit anchor path.
                    // Two independent cooldowns allowed one Blink reward plus
                    // one site reward per day. `best` is best STREAK, not XP.
                    const paidXp = await setnxJSON(`anch:${w}`, { t: Date.now() }, 86400) ? 25 : 0;
                    if (paidXp) {
                      p.xp += paidXp;
                      await bumpLadder(w, paidXp, p.qualified);
                    }
                    await append({ k:'anchor', w, i: d.i, sig, xp: paidXp });
                    await bumpFeed({ w: shortW(w), a: `ANCHORED the log via Blink · entry #${d.i}${paidXp ? ' · +25 XP' : ''}`, c:'hit', sig });
                    await savePlayer(p);
                  }
                }
              }
            } catch (e) { console.error('blink credit fail', e); }
          }
          player = { ...p, rank: RANKS[rankOf(p.xp)][0], rankIdx: rankOf(p.xp),
          next: RANKS[rankOf(p.xp)+1] || null, chambers: Math.min(4, rankOf(p.xp)+1) + 1 };
        // SEALED means sealed: state?wallet= is an open spectator view, so
        // open shots are served WITHOUT side/salt (commit only). The owner
        // gets the side back in the fire response and keeps it locally.
        // xp is computed from the side (yesMult vs noMult), so shipping it on
        // an open shot leaks the very thing the commit is meant to hide. The
        // owner already got it in the fire response.
        player.open = (p.open || []).map(({ side, salt, xp, ...rest }) => rest);
        delete player._existed; delete player._src;
        player.history = ((await getCached(`hist:${w}`, 3_000)) || []).slice(0, 200);
        player.qualified = !!p.qualified;
        // CHAMPION CONSOLE data: seat share, 7d earnings, live balance
        // (cached 60s), and the exact amount sellable without losing the
        // seat — so champions can exit smart instead of dumping blind.
        let changed2 = false;
        const seat = (podNow.list || []).find(x => x.w === w);
        // An unverified wallet is checked too: simply HOLDING RCX qualifies
        // you, so a player who bought on pump.fun enters the ladders without
        // having to burn anything. Cached 60s, and once you qualify we never
        // look again.
        // A read we could not make is never written to the cache and never
        // overwrites a number we already knew. bal === null means unknown.
        const readBal = async (prev) => {
          const acc = await findAta(w);
          if (acc === undefined) {
            return prev ? { ...prev, stale: true }      // keep the last true figure
                        : { bal: null, t: Date.now(), stale: true };
          }
          const fresh = { bal: acc ? acc.bal : 0, t: Date.now() };
          await setJSON(`champbal:${w}`, fresh);
          return fresh;
        };
        // ONE BALANCE READ, FOR EVERY CONNECTED WALLET.
        // It used to happen only for champions, stakers, or the unqualified —
        // so a connected holder with 148,702 RCX saw no balance anywhere on the
        // page, and the header showed CREDITS 0 next to nothing at all. Holding
        // the token is the whole on-ramp; not showing it was the gap.
        // Still one RPC read per wallet per minute, cached, and still never
        // allowed to write a zero it could not verify.
        if (MINT && !isDemo(w)) {
          let cb = await getCached(`champbal:${w}`, 20_000);
          if (!cb || Date.now() - cb.t > 60_000) cb = await readBal(cb);
          if (cb.bal > 0 && !p.qualified) { p.qualified = true; changed2 = true; }
          player.rcx = { bal: Number.isFinite(cb.bal) ? Math.floor(cb.bal) : null,
                         stale: !Number.isFinite(cb.bal) || !!cb.stale };
          if (seat) {
            const earned7 = champWindowSum(p.champ7, Date.now(), CHAMP.holdDays);
            const known = Number.isFinite(cb.bal);
            player.champion = { pct: seat.pct, earned7: Math.floor(earned7),
              bal: known ? Math.floor(cb.bal) : null,
              balStale: !known || !!cb.stale,
              safeSell: known ? Math.max(0, Math.floor(cb.bal - earned7 * CHAMP.holdPct)) : null };
          }
          // lazy hold-yield: once per UTC day, on touch, on the live balance
          // A DAY IS ONLY SPENT IF WE ACTUALLY READ THE BALANCE.
          // stakeDay used to advance unconditionally, so one failed RPC read
          // marked the day as paid, paid zero, and cost the staker that day's
          // yield permanently. An unknown balance now simply waits.
          if (p.stakeOn && p.stakeDay !== today() && Number.isFinite(cb.bal)) {
            const y = stakeYield(cb.bal);
            p.stakeDay = today();
            if (y > 0) {
              p.cr += y; p.stakeEarned = (p.stakeEarned || 0) + y;
              await bumpStats({ stakePaid: y });
              await append({ k: 'stakeyield', w, bal: Math.floor(cb.bal), y });
            }
            await savePlayer(p);
          }
          if (p.stakeOn) player.stakeInfo = { on: true,
            bal: Number.isFinite(cb.bal) ? Math.floor(cb.bal) : null,
            balStale: !Number.isFinite(cb.bal) || !!cb.stale,
            perDay: Number.isFinite(cb.bal) ? stakeYield(cb.bal) : null, earned: p.stakeEarned || 0,
            rate: STAKE.rate, minBal: STAKE.minBal, capBal: STAKE.capBal };
        }
        if (changed2) { player.qualified = true; await savePlayer(p); }
      }
      const st = await loadStats();
      const lbRows = await ladderTop('lb:', seasonKey());
      const ladder = lbRows.slice(0,20).map(([wl,xp])=>({ w: shortW(wl), xp, me: wl===w }));
      const dayRanked = await ladderTop('lbd:', today());
      const ladderDay = dayRanked.slice(0,10).map(([wl,xp])=>({ w: shortW(wl), xp, me: wl===w }));
      // YOUR LIVE POSITION: where you stand today, what today would pay you if it
      // ended right now, and what it would take to move up. The ladder is only
      // motivating when you can see yourself on it — including from outside the
      // top ten, which the public board never shows.
      if (player) {
        const myIdx = dayRanked.findIndex(([wl]) => wl === w);
        player.dayXp = myIdx >= 0 ? dayRanked[myIdx][1] : 0;
        player.dayRank = myIdx >= 0 ? myIdx + 1 : null;
        player.dayField = dayRanked.length;
        // XP needed to take the last paying seat (0 if you already hold one)
        const seats = PRIZE_D.length;
        const cut = dayRanked[seats - 1];
        player.dayToSeat = (player.dayRank && player.dayRank <= seats) ? 0
          : Math.max(1, ((cut ? cut[1] : 0) + 1) - player.dayXp);
      }
      return res.json({ ok:true, v: VERSION, durable,
        prices:{src:prices.src,degraded:prices.degraded||null,ages:prices.ages||null,SOL:prices.SOL,BTC:prices.BTC,ETH:prices.ETH,BONK:prices.BONK,WIF:prices.WIF,JUP:prices.JUP,PUMP:prices.PUMP},
        stats: st, feed: (await getCached('g:feed', 3_000)) || [], ladder, ladderDay,
        warden: await wardenLine(prices), wardenRec,
        wardenModel: WARDEN_MODEL,
        wardenPrev: await getCached('g:warden:rec:prev', 60_000), agents: fleet,
        wardenHist: (await getCached('g:warden:hist', 5_000)) || [],
        targets: Object.fromEntries(Object.entries(targetBoard(boardHour()))
          .filter(([,t]) => Number.isFinite(prices[t.feed]) && (!t.feed2 || Number.isFinite(prices[t.feed2])))),
        boardFlip: (boardHour() + 1) * 3600e3,
        split: SPLIT, potSplit: { day: POT_DAY_SHARE, week: 1 - POT_DAY_SHARE },
        prizes: { day: PRIZE_D, week: PRIZE_W },
        dayEnds: Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1),
        stakeRule: { min: STAKE_MIN, max: STAKE_MAX, presets: Object.keys(STAKES).map(Number), hitPayout: HIT_PAYOUT, xpMultCap: XP_MULT_CAP, xpCapAt: XP_CAP_AT, streakStep: STREAK_STEP, streakCap: STREAK_CAP },
        champ: { pct: CHAMP.pct, curve: CHAMP.curve, holdPct: CHAMP.holdPct, holdDays: CHAMP.holdDays,
          // `owner` is the full address so the page can derive a token account
          // for a champion who does not have one yet; `w` stays short for display.
          podium: (podNow.list || []).map(x => ({ w: shortW(x.w), owner: x.w, ata: x.ata, pct: x.pct })) },
        season: seasonKey(), day: today(),
        mint: MINT || null, incinerator: MINT ? INCINERATOR : null, mcap: await getMcap(),
        tokenProgram: await getMintProgram(),
        mirror: { enabled: MIRROR_ENABLED, programId: MIRROR_ENABLED ? MIRROR_PROGRAM_ID : null,
          cluster: MIRROR_ENABLED ? MIRROR_CLUSTER : null },
        lastSeason: await getCached('g:seasonResults', 30_000),
        lastDay: await getCached('g:dayResults', 15_000),
        log: (await getCached('g:log:head', 3_000)) || null, player });
    }

    if (action === 'shot' || action === 'duel') {
      const b = req.body || {};
      const w = b.auth && b.auth.wallet;
      if (!w || typeof w !== 'string') return res.status(400).json({ ok:false, reason:'no wallet' });
      if (!isDemo(w)) {
        const v = verifyAuth(b.auth);
        if (!v.ok) return res.status(401).json({ ok:false, reason:v.reason });
      }
      const p = await loadPlayer(w);
      await settle(p, prices);
      const cap = Math.min(4, rankOf(p.xp)+1) + 1;
      if (p.open.length >= cap) { await savePlayer(p); return res.status(409).json({ ok:false, reason:`all ${cap} chambers full` }); }
      const stake = +b.stake;

      // ---- validate EVERYTHING before any money moves. The previous
      // hour's board stays valid as a grace window, so a click that
      // lands just after the hourly flip still seals.
      let spec = null;
      if (action === 'shot') {
        const board = { ...targetBoard(boardHour() - 1), ...targetBoard(boardHour()) };
        const t = board[b.target];
        if (!t || (b.side!=='YES' && b.side!=='NO')) { await savePlayer(p); return res.status(400).json({ ok:false, reason:'that question left the board - pick from the current mix' }); }
        if (!Number.isFinite(prices[t.feed]) || (t.feed2 && !Number.isFinite(prices[t.feed2]))) { await savePlayer(p); return res.status(409).json({ ok:false, reason:'that feed is offline right now - try another target' }); }
        // refuse to seal against a print that is stale relative to the window
        const ages = prices.ages || {};
        const lim = maxSealAge(t.mins);
        const stale = [t.feed, t.feed2].filter(Boolean)
          .map(f => ({ f, a: ages[f] })).filter(x => Number.isFinite(x.a) && x.a > lim);
        if (stale.length) { await savePlayer(p); return res.status(409).json({ ok:false,
          reason: `the oracle's last ${stale[0].f} print is ${stale[0].a}s old and this window needs one under ${lim}s — the feed updates on a 60s heartbeat or a 0.5% move, so try again in a moment` }); }
        spec = t;
      } else if (b.side!=='with' && b.side!=='against') { await savePlayer(p); return res.status(400).json({ ok:false, reason:'bad side' }); }

      const err = await takeStake(p, stake);
      if (err) { await savePlayer(p); return res.status(400).json({ ok:false, reason: err }); }

      let shot;
      if (action === 'shot') {
        const t = spec;
        const kind = t.kind || 'dir';
        const xpMult = b.side === 'YES' ? (t.yesMult != null ? t.yesMult : 1)
                                        : (t.noMult != null ? t.noMult : 1);
        shot = { id: Math.random().toString(36).slice(2,10),
          kind, feed:t.feed, side:b.side,
          entry: prices[t.feed], entryAge: (prices.ages || {})[t.feed], oracleSrc: prices.src,
          exp: Date.now()+t.mins*60e3, stake,
          xp: Math.max(1, Math.round(t.baseXp * stakeMult(stake) * xpMult)), label: t.label };
        if (kind === 'thr') shot.thresh = prices[t.feed] * (1 + t.pct);
        if (kind === 'thrDown') shot.thresh = prices[t.feed] * (1 - t.pct);
        if (kind === 'range') shot.pct = t.pct;
        if (kind === 'race') { shot.feed2 = t.feed2; shot.entry2 = prices[t.feed2]; }
      } else {
        const wl = await wardenLine(prices);
        // You cannot duel a Warden that has not spoken.
        if (wl.p == null || !Number.isFinite(wl.thresh))
          return res.status(400).json({ ok:false, reason:'the Warden has no line this hour — not enough price history to measure volatility' });
        const withW = b.side === 'with';
        shot = { id: Math.random().toString(36).slice(2,10), kind:'thr', feed:wl.feed, thresh:wl.thresh,
          side: withW ? (wl.p >= 50 ? 'YES':'NO') : (wl.p >= 50 ? 'NO':'YES'),
          entry: prices[wl.feed], oracleSrc: prices.src, exp: Date.now()+wl.mins*60e3, stake,
          xp: Math.max(1, Math.round(14 * stakeMult(stake) * (withW ? 0.8 : 3.4))), label: 'DUEL vs the Warden: '+wl.q, duel:true };
      }
      shot.salt = crypto.randomBytes(8).toString('hex');
      shot.commit = sha256hex(`${shot.side}|${shot.salt}`);
      shot.src = p._src || 'bal'; delete p._src;
      p.open.unshift(shot);
      await savePlayer(p);
      await append({ k:'seal', w, id: shot.id, feed: shot.feed, stake, exp: shot.exp, entry: shot.entry, commit: shot.commit });
      if (!isDemo(w)) await bumpFeed({ w: shortW(w), a: `sealed a shot · ${stake} 🔥`, c:'seal' });
      return res.json({ ok:true, shot, cr: p.cr });
    }

    // ============================================================
    //  THE ARENA — open the game to other people's agents.
    //
    //  Deliberately NOT a new surface. An agent registers, then fires
    //  through the exact same signed endpoints a human uses, settles on the
    //  exact same oracle, under the exact same sealing rules. There is no
    //  agent fast-path to exploit because there is no agent path at all —
    //  only a label and a separate board.
    //
    //  Registration requires a QUALIFIED wallet, which means the operator
    //  has touched RCX. That is the whole anti-spam design: an arena of free
    //  identities would be a leaderboard of noise, and accuracy rankings are
    //  only worth reading if entering costs something.
    //
    //  What makes this worth building is not the API. It is that a public,
    //  oracle-settled, tamper-evident accuracy record for a trading agent
    //  does not really exist anywhere — and anyone writing a bot wants a
    //  neutral place to prove it works.
    // ============================================================
    // THE PATH A SHOT ACTUALLY TOOK.
    // The price log exists so settlement cannot be gamed. Serving it back also
    // makes a settled shot legible: you see every oracle print between your
    // seal and your exit, including the one that decided it. Evidence and
    // entertainment happen to be the same bytes here.
    if (action === 'path') {
      const feed = String(req.query.feed || '').toUpperCase();
      const from = Number(req.query.from), to = Number(req.query.to);
      if (!PXFEEDS.includes(feed)) return res.status(400).json({ ok:false, reason:'unknown feed' });
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from)
        return res.status(400).json({ ok:false, reason:'bad window' });
      if (to - from > 26 * 3600e3) return res.status(400).json({ ok:false, reason:'window too wide' });
      const pad = 60e3;
      const rows = await pathFor(feed, from - pad, to + pad);
      return res.json({ ok:true, feed, from, to, n: rows.length, path: rows });
    }

    // ---- the open challenge board ----
    if (action === 'challenges') {
      const raw = (await getJSON('g:chal')) || [];
      const now2 = Date.now();
      return res.json({ ok:true, v: VERSION,
        rule: 'the level is struck when someone accepts, never when the challenge is written',
        limits: { minMins: CHAL_MIN_MINS, maxMins: CHAL_MAX_MINS, maxPct: CHAL_MAX_PCT,
                  openFor: CHAL_OPEN_MS, kinds: CHAL_KINDS },
        open: raw.filter(c => c && c.expiresAt > now2).map(c => ({
          id: c.id, by: shortW(c.by), kind: c.kind, feed: c.feed, pct: c.pct || null,
          mins: c.mins, side: c.side, stake: c.stake, label: c.label,
          expiresAt: c.expiresAt })) });
    }

    // ---- write one ----
    if (action === 'challenge') {
      const b = req.body || {};
      const w = b.auth && b.auth.wallet;
      // Demo credits are free and a challenge is zero-sum against a real
      // player's earned ones. Guests keep the main board.
      if (!w || isDemo(w)) return res.status(400).json({ ok:false, reason:'challenges need a real wallet — guests play the open board' });
      const v = verifyAuth(b.auth);
      if (!v.ok) return res.status(401).json({ ok:false, reason:v.reason });

      const kind = String(b.kind || 'dir');
      const feed = String(b.feed || '').toUpperCase();
      const mins = Math.round(Number(b.mins));
      const side = b.side === 'NO' ? 'NO' : 'YES';
      const stake = Math.round(Number(b.stake));
      const pct = b.pct == null ? null : Number(b.pct);
      if (!CHAL_KINDS.includes(kind)) return res.status(400).json({ ok:false, reason:'kind must be dir, thr or thrDown' });
      if (!PXFEEDS.includes(feed)) return res.status(400).json({ ok:false, reason:'unknown feed' });
      if (!Number.isFinite(mins) || mins < CHAL_MIN_MINS || mins > CHAL_MAX_MINS)
        return res.status(400).json({ ok:false, reason:`window must be ${CHAL_MIN_MINS}-${CHAL_MAX_MINS} minutes` });
      if (kind !== 'dir' && (!Number.isFinite(pct) || pct <= 0 || pct > CHAL_MAX_PCT))
        return res.status(400).json({ ok:false, reason:`move must be above 0 and at most ${(CHAL_MAX_PCT*100)}%` });
      if (badStake(stake)) return res.status(400).json({ ok:false, reason:`stake must be a whole number between ${STAKE_MIN} and ${STAKE_MAX.toLocaleString()}` });

      const list = ((await getJSON('g:chal')) || []).filter(c => c && c.expiresAt > Date.now());
      if (list.length >= CHAL_MAX_OPEN) return res.status(429).json({ ok:false, reason:'the challenge board is full — take one instead' });
      if (list.some(c => c.by === w)) return res.status(409).json({ ok:false, reason:'you already have a challenge waiting — one at a time' });

      const p = await loadPlayer(w);
      const bad = await takeStake(p, stake);          // the author pays now, or it is not an offer
      if (bad) { await savePlayer(p); return res.status(400).json({ ok:false, reason: bad }); }

      const label = kind === 'dir' ? `${feed} higher in ${winTxt(mins)}`
        : kind === 'thr' ? `${feed} up +${(pct*100).toFixed(2)}% within ${winTxt(mins)}`
        : `${feed} down -${(pct*100).toFixed(2)}% within ${winTxt(mins)}`;
      const c = { id: 'c' + Math.random().toString(36).slice(2,9), by: w, kind, feed, mins,
        pct: kind === 'dir' ? null : pct, side, stake, label,
        createdAt: Date.now(), expiresAt: Date.now() + CHAL_OPEN_MS };
      list.unshift(c);
      await setJSON('g:chal', list.slice(0, CHAL_MAX_OPEN));
      await savePlayer(p);
      await append({ k:'chal', id: c.id, by: w, label, side, stake, mins });
      await bumpFeed({ w: shortW(w), a: `challenges the room: ${label} — ${side}`, c: 'seal' });
      return res.json({ ok:true, challenge: { ...c, by: shortW(w) },
        note: 'the level is struck when someone accepts, not now' });
    }

    // ---- take the other side ----
    if (action === 'accept') {
      const b = req.body || {};
      const w = b.auth && b.auth.wallet;
      if (!w || isDemo(w)) return res.status(400).json({ ok:false, reason:'challenges need a real wallet' });
      const v = verifyAuth(b.auth);
      if (!v.ok) return res.status(401).json({ ok:false, reason:v.reason });

      const id = String(b.id || '');
      const list = ((await getJSON('g:chal')) || []).filter(c => c && c.expiresAt > Date.now());
      const c = list.find(x => x.id === id);
      if (!c) return res.status(404).json({ ok:false, reason:'that challenge is gone — taken or expired' });
      if (c.by === w) return res.status(400).json({ ok:false, reason:'you cannot take your own side of your own challenge' });
      if (!(await acquirePlayerLock(c.by)))
        return res.status(409).json({ ok:false, reason:'the other side is updating — retry' });
      const px = prices[c.feed];
      if (!Number.isFinite(px)) return res.status(503).json({ ok:false, reason:`${c.feed} is not priced right now` });
      const age = (prices.ages || {})[c.feed];
      const lim = Math.min(60, Math.max(30, 0.15 * c.mins * 60));
      if (Number.isFinite(age) && age > lim)
        return res.status(503).json({ ok:false, reason:`${c.feed} last printed ${age}s ago — too stale to strike a level on` });

      // ATOMIC: exactly one acceptance wins, however many arrive together.
      if (!(await setnxJSON(`chaltaken:${id}`, { w, t: Date.now() }, 86400)))
        return res.status(409).json({ ok:false, reason:'somebody just took it' });

      const taker = await loadPlayer(w);
      const bad = await takeStake(taker, c.stake);
      if (bad) {
        // The acceptance gate was won before the balance check. Leaving it in
        // place turns an underfunded click into a permanent denial of service
        // against the author's offer.
        await delKey(`chaltaken:${id}`);
        await savePlayer(taker);
        return res.status(400).json({ ok:false, reason: bad });
      }

      const exp = Date.now() + c.mins * 60e3;
      const xp = chalXp(c.kind, c.mins);
      const mk = (side, srcTag) => {
        const sh = { id: Math.random().toString(36).slice(2,10), kind: c.kind, feed: c.feed,
          side, entry: px, oracleSrc: prices.src, exp, stake: c.stake,
          xp: Math.max(1, Math.round(xp * stakeMult(c.stake))), label: c.label,
          chal: c.id, src: srcTag };
        if (c.kind === 'thr') sh.thresh = px * (1 + c.pct);
        if (c.kind === 'thrDown') sh.thresh = px * (1 - c.pct);
        sh.salt = crypto.randomBytes(8).toString('hex');
        sh.commit = sha256hex(`${sh.side}|${sh.salt}`);
        return sh;
      };
      const takerShot = mk(c.side === 'YES' ? 'NO' : 'YES', 'cr');
      taker.open.unshift(takerShot);

      // the author's side, on the author's record
      const author = await loadPlayer(c.by);
      const authorShot = mk(c.side, 'cr');
      author.open.unshift(authorShot);
      // One accepted challenge owns three records. Commit them together: a
      // failed request cannot debit the taker while omitting one side, or
      // leave an already-taken offer visible in the room.
      try {
        await setManyJSONAtomic([
          [`u:${taker.w}`, playerRecord(taker)],
          [`u:${author.w}`, playerRecord(author)],
          ['g:chal', list.filter(x => x.id !== id)],
        ]);
      } catch (e) {
        await restoreDrains([taker, author]);
        await delKey(`chaltaken:${id}`);
        throw e;
      }
      await append({ k:'chaltake', id: c.id, by: c.by, taker: w, label: c.label,
        entry: px, exp, stake: c.stake });
      await bumpFeed({ w: shortW(w), a: `took ${shortW(c.by)}'s challenge: ${c.label}`, c: 'seal' });
      return res.json({ ok:true, shot: takerShot, against: shortW(c.by),
        struckAt: px, note: 'both sides were struck on this price, at this moment' });
    }

    if (action === 'agent-register') {
      const b = req.body || {};
      const w = b.auth && b.auth.wallet;
      if (!w || isDemo(w)) return res.status(400).json({ ok:false, reason:'an agent needs a real wallet — guests cannot enter the arena' });
      const v = verifyAuth(b.auth);
      if (!v.ok) return res.status(401).json({ ok:false, reason:v.reason });
      const name = String(b.name || '').trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9 _-]{1,22}$/.test(name))
        return res.status(400).json({ ok:false, reason:'name must be 2-23 characters: letters, digits, space, hyphen or underscore' });
      const blurb = String(b.blurb || '').trim().slice(0, 120);
      const p = await loadPlayer(w);
      if (!p.qualified) return res.status(403).json({ ok:false,
        reason:'this wallet has not touched RCX yet. Hold or burn some first — an arena anyone can enter for free is a leaderboard of noise' });
      // names are first-come, and a name cannot be stolen from a live agent
      const taken = await getJSON(`agentname:${name}`);
      if (taken && taken.w !== w) return res.status(409).json({ ok:false, reason:'that name is taken' });
      if (!taken) await setJSON(`agentname:${name}`, { w, t: Date.now() });
      const first = !p.agent;
      p.agent = { name, blurb, since: (p.agent && p.agent.since) || Date.now() };
      await savePlayer(p);
      const reg = (await getJSON('g:arena')) || [];
      if (!reg.includes(w)) { reg.push(w); await setJSON('g:arena', reg.slice(0, 500)); }
      if (first) {
        await append({ k:'agentjoin', w, name });
        await bumpFeed({ w: name, a: 'entered THE ARENA', c: 'seal' });
      }
      return res.json({ ok:true, agent: p.agent, qualified: true,
        howToPlay: '/api/game?action=board  then  POST {action:"shot", auth, target, side, stake}' });
    }

    // A machine-readable board: everything an agent needs to make a call,
    // and nothing it would have to scrape out of the page.
    if (action === 'board') {
      const hour = boardHour();
      const board = targetBoard(hour);
      return res.json({ ok:true, v: VERSION, hour,
        flipsAt: (hour + 1) * 3600e3,
        prices: { src: prices.src, ages: prices.ages || null,
          ...Object.fromEntries(Object.entries(prices).filter(([, x]) => Number.isFinite(x))) },
        stakeRule: { min: STAKE_MIN, max: STAKE_MAX, hitPayout: HIT_PAYOUT, xpMultCap: XP_MULT_CAP, xpCapAt: XP_CAP_AT, streakStep: STREAK_STEP, streakCap: STREAK_CAP },
        sealRule: 'entry price must be fresher than min(60, max(30, 0.15 * windowSeconds)) seconds',
        settleRule: 'first recorded oracle sample at or after expiry; no sample within 15 minutes voids and refunds',
        targets: Object.entries(board).map(([id, t]) => ({
          id, kind: t.kind || 'dir', feed: t.feed, feed2: t.feed2 || null,
          mins: t.mins, pct: t.pct || null, baseXp: t.baseXp,
          yesMult: t.yesMult != null ? t.yesMult : 1,
          noMult: t.noMult != null ? t.noMult : 1,
          label: t.label,
        })) });
    }

    // The arena board itself: every registered agent, scored the same way
    // the Warden is — hits AND Brier, because an oracle that only shows you
    // its wins is a horoscope with a UI.
    if (action === 'arena') {
      const reg = (await getJSON('g:arena')) || [];
      const rows = [];
      for (const aw of reg.slice(0, 200)) {
        const ap = await getJSON(`u:${aw}`);
        if (!ap || !ap.agent) continue;
        const hist = (await getJSON(`hist:${aw}`)) || [];
        const scored = hist.filter(h => h.res === 'hit' || h.res === 'miss');
        const n = scored.length;
        const hits = scored.filter(h => h.res === 'hit').length;
        // NO BRIER SCORE, AND THIS USED TO BE ONE.
        //
        // It was computed as mean((0.5 - outcome)^2) over a flat 50% prior,
        // described in this very comment as "the honest floor until the API
        // carries a probability". It is not a floor. (0.5-1)^2 and (0.5-0)^2
        // are both exactly 0.25, so the mean is 0.25 for every agent, at
        // every record, forever — a constant, published to four decimal
        // places, on a CORS-open endpoint we advertise as a record that is
        // "not self-reported". A number carrying no information while
        // looking precise is worse than no number.
        //
        // A Brier score needs a stated probability, and the agent API does
        // not carry one yet. So it is null, with the reason attached, until
        // agents can say how sure they are. Accuracy is a real measurement
        // and stays.
        rows.push({ name: ap.agent.name, blurb: ap.agent.blurb || '',
          since: ap.agent.since, w: shortW(aw), n, hits,
          acc: n ? +(hits / n * 100).toFixed(1) : null,
          brier: null,
          brierWhy: 'a Brier score needs a stated probability; the agent API does not carry one yet',
          xp: ap.xp || 0, streak: ap.streak || 0,
          listed: n >= ARENA_MIN_CALLS });
      }
      rows.sort((a, b) => (b.listed - a.listed) || ((b.acc || 0) - (a.acc || 0)) || (b.n - a.n));
      return res.json({ ok:true, v: VERSION, minCalls: ARENA_MIN_CALLS,
        note: `an agent is ranked after ${ARENA_MIN_CALLS} settled calls — before that its record is published but unranked, because a 3-for-3 streak is not evidence`,
        house: await agentsTick(prices),
        agents: rows });
    }

    if (action === 'stake') {
      if (!MINT) return res.status(400).json({ ok:false, reason:'token not launched yet' });
      const b = req.body || {};
      const w = b.auth && b.auth.wallet;
      if (!w || isDemo(w)) return res.status(400).json({ ok:false, reason:'connect a real wallet to stake' });
      const v = verifyAuth(b.auth);
      if (!v.ok) return res.status(401).json({ ok:false, reason:v.reason });
      const p = await loadPlayer(w);
      const turnOn = b.on !== false;
      const was = !!p.stakeOn;
      p.stakeOn = turnOn;
      if (turnOn && !p.stakeDay) p.stakeDay = today();   // first yield lands TOMORROW — no same-day flash-hold
      await savePlayer(p);
      // Only a real transition moves the counter. Re-sending the same value
      // used to increment it every time, so one wallet could report itself as
      // five hundred "wallets meshed" — and flood the feed and the log doing it.
      if (was !== turnOn) {
        await bumpStats({ stakers: turnOn ? 1 : -1 });
        await append({ k: 'stake', w, on: turnOn });
      }
      if (turnOn) await bumpFeed({ w: shortW(w), a: 'joined the STAKERS · holding pays daily', c: 'seal' });
      return res.json({ ok: true, on: turnOn });
    }

    if (action === 'reload') {
      if (!MINT) return res.status(400).json({ ok:false, reason:'token not launched yet - paper mode only' });
      const b = req.body || {};
      const w = b.auth && b.auth.wallet;
      if (!w || isDemo(w)) return res.status(400).json({ ok:false, reason:'connect a real wallet to reload' });
      const v = verifyAuth(b.auth);
      if (!v.ok) return res.status(401).json({ ok:false, reason:v.reason });
      const sig = String(b.sig || '').trim();
      if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(sig)) return res.status(400).json({ ok:false, reason:'that does not look like a transaction signature' });
      if (await getJSONStrict(`sig:${sig}`)) return res.status(409).json({ ok:false, reason:'that burn was already credited' });
      const tx = await getTx(sig);
      const pod = (await getJSON('g:podium')) || { list: [] };
      const podPrev = (await getJSON('g:podium:prev')) || { list: [] };
      const allowed = [...new Set([...(pod.list || []), ...(podPrev.list || [])].map(x => x.w))];
      const d = decideBurn(tx, { wallet: w, mint: MINT, minAmount: 1, podium: allowed, podiumPct: CHAMP.pct });
      if (!d.ok) return res.status(400).json({ ok:false, reason: d.reason });
      // ATOMIC replay gate: exactly one concurrent submission of this
      // signature can win the SET NX; every other sees "already credited".
      if (!(await setnxJSON(`sig:${sig}`, { w, amount: d.amount, t: Date.now() })))
        return res.status(409).json({ ok:false, reason:'that burn was already credited' });
      const p = await loadPlayer(w);
      const credit = Math.floor(d.amount * CREDIT_PER_TOKEN);
      // deposit atomically first: from here the credit cannot be lost, even if
      // this request dies before it saves
      await incrFloat(`pend:${w}`, credit);
      // claim whatever is banked — which may be more than we just put in, if a
      // pot payout landed in the meantime. Add exactly what we took.
      const got = await takeNum(`pend:${w}`);
      p.cr += got; p._drained = (p._drained || 0) + got;
      p.burned += (d.burned != null ? d.burned : d.amount);
      p.realBurned = (p.realBurned || 0) + (d.burned != null ? d.burned : d.amount);
      p.qualified = true;         // you burned RCX: you are in the ladders
      await savePlayer(p);
      await bumpStats({
        realBurned: (d.burned != null ? d.burned : d.amount),
        champPaid: d.champPaid || 0,
      });
      // record each champion's take in their 7-day holder window
      if (d.champLegs && d.champLegs.length) {
        for (const leg of d.champLegs) {
          // Deposit into the champion's queue instead of loading, mutating and
          // saving THEIR record from inside someone else's request. That
          // read-modify-write could roll back a shot they were firing at the
          // same moment, or drop the credit entirely.
          await incrFloat(`c7:${leg.w}`, leg.amt);
        }
      }
      await append({ k:'reload', w, sig, amount: d.amount, burned: d.burned, champs: d.champPaid || 0 });
      await bumpFeed({ w: shortW(w), a: `BURNED ${(d.burned != null ? d.burned : d.amount).toLocaleString()} RCX${d.champPaid ? ` · +${d.champPaid.toLocaleString()} RCX to the podium` : ''} · reloaded`, c: 'seal', sig });
      return res.json({ ok:true, credited: credit, cr: p.cr });
    }



    if (action === 'mirror_build') {
      if (!MIRROR_ENABLED) return res.status(503).json({ ok:false,
        reason:'on-chain mirroring is disabled until a program and matching RPC are configured' });
      const b = req.body || {};
      const w = b.auth && b.auth.wallet;
      if (!w || isDemo(w)) return res.status(400).json({ ok:false, reason:'connect a real wallet' });
      const v = verifyAuth(b.auth);
      if (!v.ok) return res.status(401).json({ ok:false, reason:v.reason });
      
      const shotId = String(b.id || '');
      const p = await loadPlayer(w);
      const shot = p.open.find(s => s.id === shotId) || p.closed.find(s => s.id === shotId);
      if (!shot) return res.status(404).json({ ok:false, reason:'shot not found' });
      if (shot.mirrored) return res.status(409).json({ ok:false, reason:'already mirrored' });
      if (!shot.commit || !/^[0-9a-f]{64}$/.test(shot.commit))
        return res.status(400).json({ ok:false, reason:'this legacy shot has no mirrorable commitment' });
      const kindMap = { dir:0, thr:1, thrDown:2 };
      if (!(shot.kind in kindMap)) return res.status(400).json({ ok:false,
        reason:`${shot.kind} shots are not supported by the current on-chain program` });
      
      // Anchor instruction discriminator = sha256("global:seal")[..8].
      const disc = Buffer.from("66caaba31b9869f2", "hex");
      const nonce = Date.now();
      const nonceBuf = Buffer.alloc(8);
      nonceBuf.writeBigUInt64LE(BigInt(nonce));
      
      const commitBuf = Buffer.from(shot.commit, "hex");
      
      const feed = PX_ACCOUNTS[shot.feed];
      if (!feed) return res.status(400).json({ ok:false, reason:'feed not mapped' });
      const feedIdHex = feed[1];
      const feedStrBuf = Buffer.from(feedIdHex, "utf8");
      const strLenBuf = Buffer.alloc(4);
      strLenBuf.writeUInt32LE(feedStrBuf.length, 0);
      
      const expBuf = Buffer.alloc(8);
      // Browser/game timestamps are milliseconds; the program uses Unix seconds.
      expBuf.writeBigInt64LE(BigInt(Math.floor(shot.exp / 1000)), 0);
      
      const kindByte = Buffer.from([kindMap[shot.kind]]);
      
      const threshBuf = Buffer.alloc(8);
      threshBuf.writeBigInt64LE(BigInt(Math.floor((shot.thresh||0)*1e6)), 0);
      
      const data = Buffer.concat([disc, nonceBuf, commitBuf, strLenBuf, feedStrBuf, expBuf, kindByte, threshBuf]);
      
      const latest = await mirrorRpc('getLatestBlockhash', [{ commitment:'confirmed' }]);
      const blockhash = latest && latest.value && latest.value.blockhash;
      if (!blockhash) return res.status(503).json({ ok:false, reason:'mirror RPC unavailable' });
      return res.json({ 
        ok:true, 
        ixData: data.toString('hex'),
        nonceHex: nonceBuf.toString('hex'),
        feedKey: feed[0],
        programId: MIRROR_PROGRAM_ID,
        cluster: MIRROR_CLUSTER,
        blockhash,
      });
    }
    if (action === 'mirror_confirm') {
      if (!MIRROR_ENABLED) return res.status(503).json({ ok:false, reason:'on-chain mirroring is disabled' });
      const b = req.body || {};
      const w = b.auth && b.auth.wallet;
      if (!w || isDemo(w)) return res.status(400).json({ ok:false, reason:'connect a real wallet' });
      const v = verifyAuth(b.auth);
      if (!v.ok) return res.status(401).json({ ok:false, reason:v.reason });
      
      const shotId = String(b.id || '');
      const sig = String(b.sig || '').trim();
      if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(sig))
        return res.status(400).json({ ok:false, reason:'that does not look like a transaction signature' });
      
      const p = await loadPlayer(w);
      const shot = p.open.find(s => s.id === shotId) || p.closed.find(s => s.id === shotId);
      if (!shot) return res.status(404).json({ ok:false, reason:'shot not found' });
      if (shot.mirrored) return res.status(409).json({ ok:false, reason:'already mirrored' });
      
      const tx = await getMirrorTx(sig);
      if (tx === undefined) return res.status(503).json({ ok:false, reason:'RPC unreachable' });
      if (!tx || !tx.meta) return res.status(400).json({ ok:false, reason:'tx not found yet' });
      if (tx.meta.err != null) return res.status(400).json({ ok:false, reason:'tx failed' });
      
      const msg = tx.transaction && tx.transaction.message;
      const signedByPlayer = ((msg && msg.accountKeys) || []).some(k => k.signer && k.pubkey === w);
      if (!signedByPlayer) return res.status(400).json({ ok:false, reason:'not signed by you' });

      // Verify the whole instruction, not merely one attractive field.
      const PROGRAM_ID = MIRROR_PROGRAM_ID;
      let seal = null;
      for (const ix of (msg && msg.instructions) || []) {
        if (ix.programId === PROGRAM_ID && ix.data) {
          try { seal = parseMirrorSeal(b58decode(ix.data)); } catch { seal = null; }
          if (seal) break;
        }
      }

      if (!seal) return res.status(400).json({ ok:false, reason:'valid seal instruction not found' });
      const feed = PX_ACCOUNTS[shot.feed];
      const kindMap = { dir:0, thr:1, thrDown:2 };
      const expectedThreshold = BigInt(Math.floor((shot.thresh || 0) * 1e6));
      if (seal.commit !== shot.commit || !feed || seal.feed !== feed[1]
          || seal.expiry !== Math.floor(shot.exp / 1000)
          || seal.kind !== kindMap[shot.kind]
          || seal.thresholdE6 !== expectedThreshold)
        return res.status(400).json({ ok:false, reason:'seal terms do not match this shot' });

      // One reward per shot, not merely per transaction signature. Otherwise
      // a retry or alternate valid transaction can race the non-atomic player
      // blob and credit the same shot twice.
      if (!(await setnxJSON(`mirshot:${w}:${shotId}`, { sig, t: Date.now() })))
        return res.status(409).json({ ok:false, reason:'already credited' });
        
      shot.mirrored = true;
      p.xp += 100;
      await bumpLadder(w, 100, p.qualified);
      await savePlayer(p);
      await append({ k:'mirror', w, sig, id: shotId, commit: shot.commit });
      return res.json({ ok:true, xp: 100 });
    }

    if (action === 'anchor') {
      const b = req.body || {};
      const w = b.auth && b.auth.wallet;
      if (!w || isDemo(w)) return res.status(400).json({ ok:false, reason:'connect a real wallet to anchor' });
      const v = verifyAuth(b.auth);
      if (!v.ok) return res.status(401).json({ ok:false, reason:v.reason });
      const sig = String(b.sig || '').trim();
      if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(sig)) return res.status(400).json({ ok:false, reason:'that does not look like a transaction signature' });
      if (await getJSONStrict(`sig:${sig}`)) return res.status(409).json({ ok:false, reason:'that anchor was already credited' });
      const heads = (await getJSON('g:log:heads')) || {};
      const tx = await getTx(sig);
      const d = decideAnchor(tx, { wallet: w, heads });
      if (!d.ok) return res.status(400).json({ ok:false, reason: d.reason });
      if (!(await setnxJSON(`sig:${sig}`, { w, anchor: d.i, t: Date.now() })))
        return res.status(409).json({ ok:false, reason:'that anchor was already credited' });
      const anchors = (await getJSON('g:anchors')) || [];
      anchors.unshift({ i: d.i, h: d.h, sig, slot: d.slot, w: shortW(w), t: Date.now() });
      await setJSON('g:anchors', anchors.slice(0, 30));
      // XP pays at most once per wallet per 24h — anchoring stays open
      // to everyone always; the cooldown just stops memo-spam from being
      // the cheapest XP in the game.
      const paidXp = await setnxJSON(`anch:${w}`, { t: Date.now() }, 86400) ? 25 : 0;
      if (paidXp) {
        const p = await loadPlayer(w);
        p.xp += paidXp; await bumpLadder(w, paidXp, p.qualified);
        await savePlayer(p);
      }
      await append({ k:'anchor', w, i: d.i, sig, xp: paidXp });
      await bumpFeed({ w: shortW(w), a: `ANCHORED the log on-chain · entry #${d.i}${paidXp ? ' · +25 XP' : ''}`, c:'hit', sig });
      return res.json({ ok:true, i: d.i, xp: paidXp, note: paidXp ? null : 'anchored - XP pays once per wallet per day' });
    }

    return res.status(400).json({ ok:false, reason:'unknown action' });
  } catch (e) {
    return res.status(500).json({ ok:false, reason: String(e.message || e) });
  } finally {
    for (const key of heldPlayerLocks.reverse()) await delKey(key);
  }
};
module.exports.champWindowSum = champWindowSum;   // pure, for the test harness
module.exports.parseMirrorSeal = parseMirrorSeal;


