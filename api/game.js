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
const playerWrites = require('../lib/player_writes.js');
const { hashCommit } = require('../lib/commit.js');
// The frozen Core v1 rules in integers (XP, payout): the float shortcuts below
// stay only for display and for shot kinds the program does not score.
const coreRules = require('../lib/core_rules.js');
const { getJSON, getCached, getJSONStrict, getManyJSON, setJSON, setManyJSONAtomic, setnxJSON,
  acquireLease, releaseLease, delKey, scanKeys, durable, backend, zincr, zmax, ztop, incrFloat,
  takeNum, hincr, hincrMany, zincrManyOnce, applyOnce, hall, hseed, sweepExpired} = require('../lib/kv.js');
const { verifyAuth, isDemo, isWalletShaped, b58decode } = require('../lib/verify.js');
const rankedAuth = require('../lib/ranked.js');
const sessionGame = require('../lib/play_session_game.js');
const sessionHttp = require('../lib/play_session_http.js');
const { getPrices } = require('../lib/prices.js');
const { priceAt, priceCrossing, pathFor, evidencePathFor, latestSnapshot,
  sample: samplePx, ingestUpdate: ingestPxUpdate,
  streamHealth: pxStreamHealth } = require('../lib/pxlog.js');
const { report: feedReport, cachedReport: cachedFeedReport,
  noteSettle, ensureRollups } = require('../lib/feedhealth.js');
const { buildContext: buildPythContext, cleanFeed: cleanPythFeed,
  cleanHours: cleanPythHours, parsePathRequest, pathResponse } =
  require('../lib/pyth_context.js');
const { realisedVol, sigmaOver, probAbove } = require('../lib/vol.js');
const { ACCOUNTS: PX_ACCOUNTS, PYTH_OWNERS, decode: decodePx,
  MAX_AGE_S: PX_MAX_AGE_S, MAX_CONF_BPS: PX_MAX_CONF_BPS } = require('../lib/onchain_px.js');
const { getTx, decideBurn, rpcCall, INCINERATOR } = require('../lib/burn.js');
const { append, appendOnce, decideAnchor } = require('../lib/log.js');
const { publicSpec, publicSpecAsync, cleanHandle, progressFromState } = require('../lib/gauntlet.js');
const { OUTCOME_RULE, SETTLE_RULE, PRIOR_SETTLE_RULE, LEGACY_EPS,
  usesPythTransition, order, questionOutcome } = require('../lib/outcome.js');
const agentReport = require('../lib/agent_report.js');
const proofBundle = require('../lib/proof_bundle.js');
const MINT = process.env.RATCHET_MINT || '';       // set on token day -> real burns go live
const CREDIT_PER_TOKEN = +(process.env.CREDIT_PER_TOKEN || 1);
const { RELEASE: VERSION } = require('../lib/release.js');
const MIRROR_PROGRAM_ID = process.env.RATCHET_SEAL_PROGRAM_ID || '';
const LEGACY_V2_PROGRAM_ID = '23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX';
const MIRROR_RPC_URL = process.env.RATCHET_SEAL_RPC_URL || process.env.SOLANA_RPC || process.env.SOLANA_RPC_URL || '';
const MIRROR_CLUSTER = process.env.RATCHET_SEAL_CLUSTER || 'devnet';
const MIRROR_FEEDS = new Set(String(process.env.RATCHET_SEAL_FEEDS || 'SOL').split(',').map(x => x.trim().toUpperCase()).filter(Boolean));
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
// expiry, kind or threshold could still be accepted as a receipt. Treat every field as
// part of the receipt or keep the feature disabled.
function parseMirrorSeal(data) {
  if (!Buffer.isBuffer(data) || data.length < 138) return null;
  if (!data.subarray(0, 8).equals(Buffer.from('66caaba31b9869f2', 'hex'))) return null;
  let o = 48;
  const readString = max => {
    if (o + 4 > data.length) return null;
    const len = data.readUInt32LE(o); o += 4;
    if (!len || len > max || o + len > data.length) return null;
    const value = data.subarray(o, o + len).toString('utf8'); o += len;
    return value;
  };
  const shotId = readString(32);
  if (!shotId || !/^[a-z0-9]{1,32}$/.test(shotId)) return null;
  const feed = readString(64);
  if (!feed || !/^[0-9a-f]{64}$/.test(feed) || o + 17 !== data.length) return null;
  const expiry = Number(data.readBigInt64LE(o)); o += 8;
  const kind = data[o++];
  const thresholdE12 = data.readBigInt64LE(o);
  return {
    nonce: data.readBigUInt64LE(8),
    commit: data.subarray(16, 48).toString('hex'),
    shotId, feed, expiry, kind, thresholdE12,
  };
}

const anchorString = value => {
  const bytes = Buffer.from(String(value), 'utf8');
  const len = Buffer.alloc(4); len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
};

// Convert the decimal text, not `number * 1e12`: BTC-sized values exceed
// JavaScript's safe integer range after scaling and would silently change the
// terms signed by the player.
function priceToE12(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('invalid threshold');
  const [whole, fraction = ''] = n.toFixed(12).split('.');
  return BigInt(whole) * 1_000_000_000_000n
    + BigInt(fraction.padEnd(12, '0').slice(0, 12));
}

const SPLIT = { burn: 0.70, pot: 0.30, creator: 0.0 };   // frozen headline
const POT_DAY_SHARE = 0.5;                               // of the pot share: half daily, half weekly
// THE CHAMPION'S CUT: 30% of each reload routes to the LIVE daily top three
// (50/30/20). A settled HIT can move a seat immediately; the board resets at
// 00:00 UTC. The all-time ladder never resets but does not control RCX payout.
// Replaced snapshots remain valid only for a short signing grace, so a wallet
// already approving a transaction is never raced by a leaderboard update.
const CHAMP = { pct:0.30, curve:[0.5,0.3,0.2], receiptDays:7,
  seatRule:'live-daily-xp', signingGraceMs:10*60e3 };
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
// Shot ids go on-chain (seal v2 requires ^[a-z0-9]{1,32}$) and gate replay keys,
// so they come from the CSPRNG, not Math.random(). 12 hex chars. (h70)
const newShotId = () => crypto.randomBytes(6).toString('hex');
// v2 binds a reveal to the wallet and shot id as well as the side and salt.
// Legacy v1 (`side|salt`) remains verifiable in the public record, but a v1
// commitment can be copied between shots without the hash itself proving
// which identity and round it belonged to.
// A salt the player can rebuild, instead of one only we hold.
//
// The server invented the salt and kept it until settlement, which made this
// process the ONLY place it existed. An unrevealed settled shot forfeits, so
// losing our copy did not just lose a record -- it lost the player's stake, and
// nothing they could do would recover it, because there was nothing to recover
// from. That is a founder dependence sitting in the middle of the one promise
// the product makes.
//
// A wallet can do better. Ed25519 signing is deterministic by spec, so a wallet
// signing one fixed sentence reproduces the same bytes forever, on any device.
// The client hashes that into a seed, derives this shot's salt from the seed
// and a per-shot nonce, and sends us the salt plus the nonce. We publish the
// nonce on the shot. From then on the player can rebuild the salt from their
// wallet and a public field, on a machine they have not bought yet.
//
// We still hold the salt so settlement stays automatic and nothing about the
// game changes. We simply stop being the only copy. We cannot derive it
// ourselves -- deriving needs the private key -- which is exactly the point.
//
// A weak salt only exposes the sender's own side, so the format bound is all
// the validation this needs; and a client that sends nothing still gets the old
// random salt, which is what every agent, Bankr and MCP seal does.
const SALT_RE = /^[0-9a-f]{32}$/;
const SALT_NONCE_RE = /^[0-9a-f]{8,64}$/;
const shotCommit = (w, id, side, salt) => hashCommit({
  version: 2, wallet: w, shotId: id, side, salt,
});
// FREE STAKING (h11). The old three tiers — 100 x1, 500 x2, 2500 x5 — were three
// points on a square root: sqrt(stake/100). Making the curve continuous lets a
// player stake ANY amount in range without touching the design law, because the
// law lives in the shape of the curve, not in the tiers:
//
//   sublinear, so 25x the stake earns 5x the XP, never 25x — the ladder cannot
//   be bought. Every valid HIT/MISS gets fixed settlement XP; only the HIT's
//   additional skill XP follows this stake curve. VOID gets zero.
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
// Every deterministically settled human play leaves a small progression mark.
// Fixed, never stake-scaled: HIT earns this plus skill XP; MISS earns this;
// VOID earns zero because no outcome was established.
const SETTLE_XP = 1;
const XP_MULT_CAP = 20;
const XP_CAP_AT = STAKE_MIN * XP_MULT_CAP * XP_MULT_CAP;   // 40,000
const stakeMult = st => Math.min(XP_MULT_CAP, Math.sqrt(st / STAKE_MIN));
const badStake = st => !Number.isInteger(st) || st < STAKE_MIN || st > STAKE_MAX;
const STAKES = { 500: 2.24, 2500: 5, 10000: 10, 50000: 20 };   // presets the UI offers
// THE BOARD (h4): targets are GENERATED, not hardcoded — a fresh mix
// every hour, deterministic from the clock (seeded PRNG), so every
// player and every server instance derives the same board with no
// coordination and no KV. Seven directional windows assign every feed
// exactly once per hour; four structural slots add volatility-sized PUMPs
// and DUMPs, a head-to-head RACE, and THE BOX
// (breakout-or-not). Everything settles at expiry on the exit price —
// labels say "after", never "within", because honesty is the aesthetic.
// A sealed shot carries its own settlement spec, so board rotation can
// never touch an open bet. All feeds are external Pyth majors that no
// player can move.
const BOARD_MODEL = 'v3-keyless-hourly';
const ROTFEEDS = ['SOL', 'BTC', 'ETH', 'BONK', 'WIF', 'JUP', 'PUMP'];
// Typical hourly move, used only to size THE PUMP and THE DUMP thresholds.
const TYPVOL = { SOL: 0.0075, BTC: 0.0045, ETH: 0.0065, BONK: 0.02, WIF: 0.018, JUP: 0.012, PUMP: 0.014 }; // typical hourly move
const DIRECTION_WINDOWS = [
  { mins:5,    tag:'FLASH', baseXp:10 },
  { mins:10,   tag:'QUICK', baseXp:11 },
  { mins:15,   tag:'PULSE', baseXp:12 },
  { mins:30,   tag:'',      baseXp:14 },
  { mins:60,   tag:'',      baseXp:16 },
  { mins:360,  tag:'',      baseXp:20 },
  { mins:1440, tag:'',      baseXp:24 },
];
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const winTxt = m => m >= 60 ? (m === 60 ? '1 hour' : (m / 60) + ' hours') : m + ' minutes';
function targetBoard(hour) {
  const rnd = mulberry32((hour * 2654435761) % 2147483647);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const feeds = [...ROTFEEDS];
  for (let i = feeds.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [feeds[i], feeds[j]] = [feeds[j], feeds[i]];
  }
  const board = {};
  for (let i = 0; i < DIRECTION_WINDOWS.length; i++) {
    const f = feeds[i], q = DIRECTION_WINDOWS[i];
    const prefix = q.tag ? q.tag + ': ' : '';
    board[`H${hour}Q${i}`] = { kind:'dir', feed:f, mins:q.mins, baseXp:q.baseXp,
      label:`${prefix}${f} higher in ${winTxt(q.mins)}` };
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
  // h112 used four RNG draws to shuffle dormant stock slots before building
  // THE BOX. Consume those draws without publishing stocks so every existing
  // H{hour}B id keeps exactly the same feed and threshold through deployment
  // and the previous-board grace window.
  for (let legacyStockDraw = 0; legacyStockDraw < 4; legacyStockDraw++) rnd();
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
const FLOOR_BASE = 0.004180;
const STALE_VOID_MS = 24 * 3600e3;  // feed gone 24h past expiry -> auto-void
// Integer allocation, with every unit accounted for.  Floating 0.70/0.15
// increments left fractional credit dust for arbitrary whole-number stakes.
const stakeAllocation = stake => {
  const burn = Math.floor(stake * 70 / 100);
  const potTotal = stake - burn;
  const potD = Math.floor(potTotal / 2);
  return { burn, potD, pot: potTotal - potD };
};

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
// Automatic Blink discovery is a convenience, not a reason to scan Solana on
// every six-second UI poll. The explicit anchor endpoint remains immediate.
const AUTO_ANCHOR_SCAN = globalThis.__ratchet_anchor_scan || (globalThis.__ratchet_anchor_scan = new Map());
function rateLimitRetrySeconds(ip, isPost) {
  const now = Date.now(), win = 60e3, cap = isPost ? 60 : 120;
  const e = RL.get(ip) || { t: now, n: 0 };
  if (now - e.t > win) { e.t = now; e.n = 0; }
  e.n++; RL.set(ip, e);
  if (RL.size > 5000) RL.clear();          // crude memory bound
  return e.n > cap ? Math.max(1, Math.ceil((e.t + win - now) / 1000)) : 0;
}

async function loadPlayer(w) {
  let p = await getJSONStrict(`u:${w}`);   // strict: a flaky read must NOT mint a fresh record
  const expected = p == null ? null : JSON.parse(JSON.stringify(p));
  const existed = !!p;
  if (!p) p = { w, xp:0, streak:0, best:0, hits:0, shots:0, bal:0, cr:WELCOME_GRANT, granted:true, burned:0, day:today(), open:[], closed:[] };
  playerWrites.track(p, expected);
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
  // Reading a player never consumes queued value. Its snapshot is deducted
  // only in the SAME guarded transaction that saves the credited player.
  const amounts = await getManyJSON([`pend:${w}`, `c7:${w}`, `cs7:${w}`]);
  if (!Array.isArray(amounts) || amounts.length !== 3) throw new Error('credit queue read incomplete');
  playerWrites.creditSnapshot(p, amounts);
  const [owed, owed7, self7] = amounts.map(v => v == null ? 0 : Number(v));
  if (owed > 0) { p.cr = (p.cr || 0) + owed; p._drained = (p._drained || 0) + owed; }
  if (owed7 > 0) {
    // Actual incoming RCX from somebody else's reload.
    p.champ7 = p.champ7 || {};
    p.champ7[today()] = (p.champ7[today()] || 0) + owed7;
    p._drained7 = (p._drained7 || 0) + owed7;
  }
  if (self7 > 0) {
    // A champion reloading their own wallet keeps their seat's route. It is
    // not an incoming transfer and never earns extra credits, but it is real
    // podium value and must not be displayed as "earned 0".
    p.champSelf7 = p.champSelf7 || {};
    p.champSelf7[today()] = (p.champSelf7[today()] || 0) + self7;
    p._drainedSelf7 = (p._drainedSelf7 || 0) + self7;
  }
  // Receipt totals are a display window, not an eligibility condition.
  for (const bag of [p.champ7, p.champSelf7]) if (bag) for (const k of Object.keys(bag))
    if (Date.now() - new Date(k + 'T00:00:00Z').getTime() > (CHAMP.receiptDays + 1) * 86400e3) delete bag[k];
  p._existed = existed;
  return p;
}
/** Lease, expected player and queued credits are checked in the database. */
async function savePlayer(p, extras=[]) {
  await playerWrites.save([p],extras);
  await flushSettlements(p);
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
      champPaid: +legacy.champPaid || 0, champRetained: +legacy.champRetained || 0, stakePaid: +legacy.stakePaid || 0,
      stakers: +legacy.stakers || 0 });
  } catch { statsSeeded = false; }        // let the next request try again
}
// The board figures every player sees are identical for all of them, and they
// change when a shot settles -- not when somebody polls. Reading them per
// request is how one settled shot became thousands of identical reads: a
// connected client polls every ten seconds, and each poll re-read the stats
// hash and all three ladders from scratch.
//
// This memo is deliberately NOT applied inside loadStats or ladderTop
// themselves. Those are also called from the podium and payout paths, where a
// figure that is eight seconds old could be written back as if it were current.
// The cache lives at the call site that only displays, so the money paths keep
// reading the store exactly as before.
const shared = globalThis.__ratchet_shared || (globalThis.__ratchet_shared = new Map());
const SHARED_MAX = 32;
async function sharedRead(key, ttlMs, produce) {
  const now = Date.now(), hit = shared.get(key);
  if (hit && now - hit.t < ttlMs) return hit.v;
  const value = await produce();
  if (shared.size >= SHARED_MAX) shared.delete(shared.keys().next().value);
  shared.set(key, { v: value, t: now });
  return value;
}

async function loadStats() {
  await seedStats();
  const st = await hall(STATS);
  for (const f of ['burned','pot','potD','shots','realBurned','champPaid','champRetained','stakePaid','stakers','hitPaid'])
    if (!Number.isFinite(st[f])) st[f] = 0;
  // derived, not stored: a stored high-water mark could be stepped BACKWARDS
  // by a stale write, which is exactly what "monotone by construction" must
  // never allow. Computing it from the burn total makes it monotone for real.
  st.floor = Math.max(FLOOR_BASE, FLOOR_BASE + (st.realBurned || 0) * 1e-9);
  st.floorMode = 'simulation';
  return st;
}
/** Apply a set of deltas atomically, field by field. */
async function bumpStats(deltas) {
  await hincrMany(STATS, deltas);
}
async function bumpFeed(entry) {
  return require('../lib/activity_feed.js').bumpFeed(entry);
}

/** Persist a verified Solana memo anchor without a replay/list split-brain.
 *
 * The signature gate used to land before `g:anchors`.  A process death in
 * between made the transaction permanently "already credited" while the
 * proof page could never discover it.  Write the de-duplicated list first
 * under a per-signature lease, then close the replay gate.  A retry repairs
 * either partial state safely. */
async function claimAnchor(w, sig, d) {
  const lockKey = `lock:anchor:${sig}`;
  const lease = await acquireLease(lockKey, 30);
  if (!lease) return { ok:false, busy:true };
  try {
    if (await getJSONStrict(`sig:${sig}`)) return { ok:false, duplicate:true };
    const now = Date.now();
    const row = { i:d.i, h:d.h, sig, slot:d.slot, w:shortW(w), t:now };
    const anchors = (await getJSONStrict('g:anchors')) || [];
    await setJSON('g:anchors', [row, ...anchors.filter(a => a && a.sig !== sig)].slice(0, 30));
    const won = await setnxJSON(`sig:${sig}`, { w, anchor:d.i, t:now });
    if (!won) {
      if (await getJSONStrict(`sig:${sig}`)) return { ok:false, duplicate:true };
      throw new Error('anchor replay gate could not be persisted');
    }
    return { ok:true, row };
  } finally {
    try { await releaseLease(lockKey, lease); } catch {}
  }
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

async function warmLadderMigrations(defs) {
  const keys = defs.map(([pfx, period]) => zkey(pfx, period)).filter(k => !migSeen.has(k));
  if (!keys.length) return;
  const gates = await getManyJSON(keys.map(k => `mig:${k}`));
  for (let i = 0; i < keys.length; i++) if (gates[i]) migSeen.add(keys[i]);
}

/** Ranked [wallet, xp] descending. n omitted = the whole board. */
async function ladderTop(pfx, period, n) {
  await migrateLadder(pfx, period);
  return (await ztop(zkey(pfx, period), n)).filter(([w]) => !isDemo(w));
}

const ALLTIME_BOARD = zkey('lba:', 'all');
let allTimeReady = false;

/** Backfill lifetime XP without pausing live settlements. zmax makes every
 * row monotonic, so a concurrent ZINCRBY can never be overwritten or doubled. */
async function ensureAllTimeBoard() {
  if (allTimeReady) return true;
  if (await getJSONStrict('g:alltime:seeded')) { allTimeReady = true; return true; }
  const lease = await acquireLease('lock:g:alltime:seed', 120);
  if (!lease) return false;
  try {
    if (!(await getJSONStrict('g:alltime:seeded'))) {
      for (const key of await scanKeys('u:*')) {
        const p = await getJSONStrict(key);
        if (p && isWalletShaped(p.w) && Number.isFinite(+p.xp) && +p.xp > 0)
          await zmax(ALLTIME_BOARD, +p.xp, p.w);
      }
      await setJSON('g:alltime:seeded', { t:Date.now(), rule:'max-player-xp' });
    }
    allTimeReady = true; return true;
  } finally {
    try { await releaseLease('lock:g:alltime:seed', lease); } catch {}
  }
}

async function bumpLadder(w, xp, qualified) {
  if (isDemo(w)) return;
  if (qualified === false) return;      // unverified wallet: plays, does not rank
  await ensureAllTimeBoard();
  await migrateLadder('lb:', seasonKey());
  await migrateLadder('lbd:', today());
  await zincr(zkey('lb:', seasonKey()), xp, w);
  await zincr(zkey('lbd:', today()), xp, w);
  await zincr(ALLTIME_BOARD, xp, w);
  try { await refreshLivePodium(true); } catch {}
}
/** Credit one settlement to daily, season and all-time ladders exactly once. */
async function bumpLadderOnce(w, xp, qualified, shotId, period) {
  if (isDemo(w) || qualified === false) return false;
  const season = period?.season || seasonKey(), day = period?.day || today();
  await ensureAllTimeBoard();
  await migrateLadder('lb:', season);
  await migrateLadder('lbd:', day);
  const won = await zincrManyOnce(`ladder:${w}:${shotId}`,
    { w, shotId, xp, season, day, t:Date.now() }, [
      [zkey('lb:', season), w, xp],
      [zkey('lbd:', day), w, xp],
    ]);
  // The player is committed before delivery. Bootstrap may already have read
  // its new XP, so adding XP again would double-count the first delivery.
  await zmax(ALLTIME_BOARD,period.totalXp,w);
  if (won) try { await refreshLivePodium(true); } catch {}
  return won;
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
// fed to the staking payout and earlier eligibility logic as if it were a fact.
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

// Sum recent receipt buckets for display; never used to decide a seat.
function champWindowSum(champ7, nowMs, days) {
  if (!champ7) return 0;
  let s = 0;
  for (const [k, v] of Object.entries(champ7)) {
    const t = new Date(k + 'T00:00:00Z').getTime();
    if (Number.isFinite(t) && nowMs - t <= days * 86400e3) s += +v || 0;
  }
  return s;
}

let podiumRefreshAt = 0;
/** Publish the live DAILY top three. Empty live seats inherit yesterday's
 * podium from the top down: the prior #3, then #2, then #1 are displaced as
 * today's first, second and third distinct ranked wallets appear. */
async function refreshLivePodium(force = false) {
  if (!MINT) return { period:today(), list:[] };
  const now = Date.now();
  if (!force && now - podiumRefreshAt < 1500)
    return (await getJSONStrict('g:podium')) || { period:today(), list:[] };
  podiumRefreshAt = now;
  const lease = await acquireLease('lock:g:podium:live', 30);
  if (!lease) return (await getJSONStrict('g:podium')) || { period:today(), list:[] };
  try {
    const day = today();
    await migrateLadder('lbd:', day);
    const ranked = await ladderTop('lbd:', day, CHAMP.curve.length);
    const current = await getJSONStrict('g:podium');
    let fallback = await getJSONStrict('g:podium:fallback');
    let fallbackChanged = false;
    if (!fallback || fallback.day !== day) {
      const prior = current && current.period !== day
        ? current
        : (await getJSONStrict('g:podium:prev'));
      fallback = { day, from:prior && prior.period || null,
        list:((prior && prior.list) || []).slice(0, CHAMP.curve.length) };
      fallbackChanged = true;
    }

    const live = ranked.map(([w, xp]) => ({ w, xp, source:'today' }));
    const liveOwners = new Set(live.map(x => x.w));
    const inherited = (fallback.list || []).filter(x => x && x.w && !liveOwners.has(x.w))
      .map(x => ({ ...x, source:'previous' }));
    const merged = [...live, ...inherited].slice(0, CHAMP.curve.length);
    const owners = merged.map(x => x.w);
    const same = current && current.period === day
      && (current.list || []).map(x => x.w).join('|') === owners.join('|');
    if (same && !fallbackChanged) return current;

    const list = [];
    for (let i = 0; i < merged.length; i++) {
      const row = merged[i], read = row.ata ? { ata:row.ata } : await findAta(row.w);
      list.push({ w:row.w, xp:Number.isFinite(+row.xp) ? +row.xp : null,
        source:row.source, ata:read && read.ata ? read.ata : null, pct:CHAMP.curve[i] });
    }
    const t = Date.now();
    const next = { v:2, id:sha256hex(JSON.stringify({ day, owners, t })).slice(0,16),
      rule:CHAMP.seatRule, period:day, t, list };
    const oldHistory = (await getJSONStrict('g:podium:history')) || [];
    const history = [
      ...(current ? [{ ...current, until:t + CHAMP.signingGraceMs }] : []),
      ...oldHistory,
    ].filter((x, i, a) => x && Number(x.until) >= t
      && a.findIndex(y => (y.id || y.t) === (x.id || x.t)) === i).slice(0,20);
    await setManyJSONAtomic([
      ['g:podium', next],
      ['g:podium:prev', current || null],
      ['g:podium:fallback', fallback],
      ['g:podium:history', history],
    ]);
    await append({ k:'podium', rule:CHAMP.seatRule, period:day,
      id:next.id, list:list.map(x => ({ w:x.w, xp:x.xp, pct:x.pct, source:x.source })) });
    return next;
  } finally {
    try { await releaseLease('lock:g:podium:live', lease); } catch {}
  }
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
async function challengeLease() {
  for (let a = 0; a < 30; a++) {
    const token = await acquireLease('lock:g:chal', 20);
    if (token) { playerWrites.lease('lock:g:chal', token, 20); return token; }
    await new Promise(r => setTimeout(r, 20 + a * 5));
  }
  return null;
}

async function sweepChallenges() {
  const lease = await challengeLease();
  if (!lease) return;
  try {
    const expected = await getJSONStrict('g:chal');
    const list = expected || [];
    const now = Date.now();
    const dead = list.filter(c => c && c.expiresAt <= now);
    if (!dead.length) return;
    for (const c of dead) {
      // one refund per challenge, ever, whoever happens to sweep it. Deposit
      // into the atomic queue instead of racing a live player-record update.
      const a = stakeAllocation(c.stake);
      await applyOnce(`chalref:${c.id}`, { t: now }, {
        counters: [[`pend:${c.by}`, c.stake]],
        hashKey: STATS,
        deltas: c.allocationRule === 'on-settle-v2'
          ? {} : { burned:-a.burn, potD:-a.potD, pot:-a.pot },
      });
      await appendOnce(`chalexpire:${c.id}`, { k:'chalexpire', id: c.id, by: c.by, stake: c.stake, refunded: true });
    }
    // Refund receipts are durable BEFORE removal. A failed delivery keeps the
    // offer recoverable, while CAS prevents a late sweep erasing new offers.
    const result = await require('../lib/kv.js').commitGuarded({
      id:crypto.randomBytes(16).toString('hex'),debits:[],
      leases:[{key:'lock:g:chal',token:lease,expiresAt:Number(lease.split('-')[0])+20000}],
      entries:[{key:'g:chal',expected,value:list.filter(c => c && c.expiresAt > now)}],
    });
    if (!result.ok) throw Object.assign(new Error('challenge board changed'),{code:result.code});
  } finally {
    try { await releaseLease('lock:g:chal', lease); } catch {}
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
    const rollLock = `lock:roll:${d.k}:${ptr}`;
    const lease = await acquireLease(rollLock, 60);
    if (!lease) continue; // another request is finishing it; never advance the pointer early
    try {
      const planKey = `rollplan:${d.k}:${ptr}`;
      let plan = await getJSONStrict(planKey);
      if (!plan) {
        const board0 = await ladderTop(d.pfx, ptr);
        const ranked = board0.slice(0, d.prizes.length);
        const st = await loadStats();
        const pot0 = Math.floor(st[d.potF] || 0);
        const winners0 = [];
        for (let i = 0; i < ranked.length; i++) {
          const share = Math.floor(pot0 * d.prizes[i]);
          if (share <= 0) continue;
          const [owner, xp] = ranked[i];
          winners0.push({ owner, w: shortW(owner), xp, share, rank:i+1 });
        }
        plan = { period:ptr, pot:pot0, board:board0, winners:winners0,
          paid:winners0.reduce((n,x)=>n+x.share,0), t:Date.now() };
        await setJSON(planKey, plan); // immutable payout terms before the first credit moves
      }
      const { board, pot, paid, winners } = plan;
      for (const x of winners) {
        const won = await applyOnce(`rollpay:${d.k}:${ptr}:${x.rank}`, { owner:x.owner, share:x.share }, {
          counters:[[ `pend:${x.owner}`, x.share ]],
        });
        if (won) await bumpFeed({ w:x.w, a:`${d.tag} #${x.rank} · won ${x.share.toLocaleString()} credits`, c:'hit' });
      }
      // Exactly one debit for the frozen plan. Concurrent new stakes remain
      // in the live pot and belong to the new period.
      await applyOnce(`rolldebit:${d.k}:${ptr}`, { paid }, {
        hashKey:STATS, deltas:{ [d.potF]:-paid },
      });
      const publicWinners = winners.map(({ owner, ...x }) => x);
      await setJSON(d.res, { period: ptr, pot, paid, rolled: pot - paid, winners:publicWinners, t: Date.now() });
      if (!plan.logged) {
        await append({ k: d.k, period: ptr, pot, paid, winners:publicWinners });
        plan.logged = true; await setJSON(planKey, plan);
      }

      if (d.k === 'daypot' && !plan.rootDone) {
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
            if (pu && pu.w) {
              const queued = Number(await getJSON(`pend:${pu.w}`)) || 0;
              rows.push([pu.w, Math.floor((pu.cr || 0) + queued), Math.floor(pu.xp || 0), Math.floor(pu.burned || 0)]);
            }
          }
          rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
          const st2 = await loadStats();
          const root = sha256hex(JSON.stringify({ day: ptr, rows,
            burned: st2.burned, realBurned: st2.realBurned || 0, champPaid: st2.champPaid || 0,
            pot: st2.pot, potD: st2.potD }));
          await append({ k: 'root', day: ptr, root, players: rows.length });
          await setJSON('g:lastRoot', { day: ptr, root, players: rows.length, t: Date.now() });
          plan.rootDone = true; await setJSON(planKey, plan);
        } catch {}
      }
      plan.done = true; await setJSON(planKey, plan);
      await setJSON(d.ptr, d.cur);
    } catch (e) {
      throw e;
    } finally {
      try { await releaseLease(rollLock, lease); } catch {}
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

const publicWarden = r => {
  const q = { ...(r || { n:0, hits:0, brier:0 }) };
  delete q.applied;
  return q;
};

const wardenTickCache = globalThis.__ratchet_wardentick
  || (globalThis.__ratchet_wardentick = { t:0, v:null });

async function wardenTick(prices) {
  if (wardenTickCache.v && Date.now() - wardenTickCache.t < 30_000)
    return wardenTickCache.v;
  const lease = await acquireLease('lock:g:warden', 45);
  if (!lease) return publicWarden(await getCached('g:warden:rec', 5_000));
  try {
    await wardenRollover();
    const wl = await wardenLine(prices);
    if (wl.p == null || !Number.isFinite(wl.thresh))
      return publicWarden(await getCached('g:warden:rec', 5_000));

    const wAge = (prices.ages || {})[wl.feed];
    const sealReady = prices.src === 'pyth-onchain'
      && Number.isFinite(wAge) && wAge <= maxSealAge(wl.mins)
      && Number.isFinite((prices.pubs || {})[wl.feed])
      && Number.isFinite((prices.prevPubs || {})[wl.feed])
      && Number.isFinite((prices.confs || {})[wl.feed])
      && (prices.confs || {})[wl.feed] <= 200;
    if (!sealReady) return publicWarden(await getCached('g:warden:rec', 5_000));

    const open = (await getJSONStrict('g:warden:open')) || [];
    let changed = false;
    if (!open.some(o => o.id === wl.id)) {
      const sealKey = `wseal:${wl.id}`;
      let sealed = await getJSONStrict(sealKey);
      if (!sealed) {
        const sealedAt = Date.now();
        const candidate = { id:wl.id, feed:wl.feed, thresh:wl.thresh, p:wl.p,
          q:wl.q, entry:prices[wl.feed], t:sealedAt, exp:sealedAt + wl.mins * 60e3,
          settleRule:SETTLE_RULE, outcomeRule:OUTCOME_RULE, oracleSrc:'pyth-onchain' };
        if (await setnxJSON(sealKey, candidate)) sealed = candidate;
        else sealed = await getJSONStrict(sealKey);
      }
      if (sealed) {
        if (usesPythTransition(sealed.settleRule))
          await appendOnce(`wseal:${sealed.id}`, { k:'wseal', id:sealed.id, feed:sealed.feed,
            thresh:sealed.thresh, p:sealed.p, exp:sealed.exp, settleRule:sealed.settleRule,
            outcomeRule:sealed.outcomeRule || 'dead-zone-4bp-v1' });
        open.push(sealed);
        changed = true;
      }
    }

    const now = Date.now(); const still = [];
    const rec = (await getJSONStrict('g:warden:rec')) || { n:0, hits:0, brier:0 };
    const hist = (await getJSONStrict('g:warden:hist')) || [];
    rec.applied = Array.isArray(rec.applied) ? rec.applied : [];
    for (const s of open) {
      if (now < s.exp) { still.push(s); continue; }
      if (!usesPythTransition(s.settleRule)) {
        await appendOnce(`wvoid:${s.id}`, { k:'wvoid', id:s.id,
          reason:'legacy-nondeterministic-settlement' });
        changed = true; continue;
      }
      const at = await priceCrossing(s.feed, s.exp, now, s.oracleSrc || 'pyth-onchain');
      if (at.wait) { still.push(s); continue; }
      if (at.expired || !Number.isFinite(at.price)) {
        await appendOnce(`wvoid:${s.id}`, { k:'wvoid', id:s.id,
          reason:at.reason || 'no-observed-update-in-window' });
        changed = true; continue;
      }
      const comparison = s.outcomeRule === OUTCOME_RULE
        ? order(at.price, s.thresh)
        : (Math.abs(at.price - s.thresh) / s.thresh < LEGACY_EPS ? 0 : order(at.price, s.thresh));
      if (comparison === 0) {
        await appendOnce(`wvoid:${s.id}`, { k:'wvoid', id:s.id,
          reason:'threshold-tie', exitPx:at.price, exitAt:at.publishTime });
        changed = true; continue;
      }
      const outcome = comparison > 0;
      const said = s.p >= 50;
      const hit = said === outcome;
      await appendOnce(`wsettle:${s.id}`, { k:'wsettle', id:s.id, outcome, hit,
        exitPx:at.price, exitAt:at.publishTime, prevExitAt:at.prevPublishTime,
        confBps:at.confBps, outcomeRule:s.outcomeRule || 'dead-zone-4bp-v1' });
      if (!rec.applied.includes(s.id)) {
        rec.n++; if (hit) rec.hits++;
        rec.brier += Math.pow(s.p / 100 - (outcome ? 1 : 0), 2);
        rec.applied.unshift(s.id);
        rec.applied = rec.applied.slice(0, 500);
        hist.unshift({ id:s.id, q:s.q, p:s.p, outcome, hit, exitPx:at.price,
          exitAt:at.publishTime, t:now });
      }
      changed = true;
    }
    if (changed || still.length !== open.length)
      await setManyJSONAtomic([
        ['g:warden:rec', rec],
        ['g:warden:hist', hist.slice(0, 20)],
        ['g:warden:open', still],
      ]);
    const out = publicWarden(rec);
    wardenTickCache.t = Date.now(); wardenTickCache.v = out;
    return out;
  } finally {
    try { await releaseLease('lock:g:warden', lease); } catch {}
  }
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
function fleetPayload(recs = {}, open = []) {
  return {
    fleet: AGENTS.map(a => {
      const r = recs[a.id] || { n:0, hits:0, streak:0, best:0 };
      return { id:a.id, name:a.name, blurb:a.blurb, n:r.n, hits:r.hits,
        streak:r.streak, best:r.best,
        acc:r.n ? Math.round((r.hits / r.n) * 100) : null,
        last:r.last || null, listed:r.n >= ARENA_MIN_CALLS,
        minCalls:ARENA_MIN_CALLS };
    }).sort((x, y) => (y.listed - x.listed)
      || ((y.acc ?? -1) - (x.acc ?? -1)) || y.n - x.n),
    open: open.map(o => ({ agent:o.agent, label:o.label, side:o.side,
      exp:o.exp, entry:o.entry, feed:o.feed, feed2:o.feed2 || null,
      entry2:o.entry2 == null ? null : o.entry2 })),
  };
}

const agentsTickCache = globalThis.__ratchet_agenttick
  || (globalThis.__ratchet_agenttick = { t:0, v:null });

// The Fleet is part of the published evidence, so it uses the same exact
// first-crossing oracle rule and tie/void policy as a human shot.
async function agentsTick(prices) {
  if (agentsTickCache.v && Date.now() - agentsTickCache.t < 30_000)
    return agentsTickCache.v;
  const lease = await acquireLease('lock:g:agents', 45);
  if (!lease) return fleetPayload(
    (await getCached('g:agents:rec', 5_000)) || {},
    (await getCached('g:agents:open', 3_000)) || []);
  try {
    const wLine = await wardenLine(prices);
    const wardenUp = !!(wLine && wLine.p != null && wLine.p >= 50);
    const hour = boardHour();
    const telemetryReady = f => prices.src === 'pyth-onchain'
      && Number.isFinite(prices[f])
      && Number.isFinite((prices.ages || {})[f])
      && (prices.ages || {})[f] <= maxSealAge(60)
      && Number.isFinite((prices.pubs || {})[f])
      && Number.isFinite((prices.prevPubs || {})[f])
      && Number.isFinite((prices.confs || {})[f])
      && (prices.confs || {})[f] <= 200;
    const board = Object.entries(targetBoard(hour)).filter(([, t]) => {
      const lim = maxSealAge(t.mins);
      const ok = f => prices.src === 'pyth-onchain'
        && Number.isFinite(prices[f])
        && Number.isFinite((prices.ages || {})[f])
        && (prices.ages || {})[f] <= lim
        && Number.isFinite((prices.pubs || {})[f])
        && Number.isFinite((prices.prevPubs || {})[f])
        && Number.isFinite((prices.confs || {})[f])
        && (prices.confs || {})[f] <= 200;
      return ok(t.feed) && (!t.feed2 || ok(t.feed2));
    });
    const recs = (await getJSONStrict('g:agents:rec')) || {};
    let open = (await getJSONStrict('g:agents:open')) || [];
    const now = Date.now();
    const still = []; let changed = false;
    const feedRows = [];

    for (const o of open) {
      if (now < o.exp) { still.push(o); continue; }
      if (!usesPythTransition(o.settleRule)) {
        if (!(await getJSONStrict(`asettled:${o.id}`)))
          await appendOnce(`avoid:${o.id}`, { k:'avoid', agent:o.agent, id:o.id,
            reason:'legacy-nondeterministic-settlement' });
        changed = true; continue;
      }
      const at = await priceCrossing(o.feed, o.exp, now, o.oracleSrc || 'pyth-onchain');
      const at2 = o.kind === 'race'
        ? await priceCrossing(o.feed2, o.exp, now, o.oracleSrc || 'pyth-onchain')
        : null;
      if (at.wait || (at2 && at2.wait)) { still.push(o); continue; }
      if (at.expired || (at2 && at2.expired)
          || !Number.isFinite(at.price) || (at2 && !Number.isFinite(at2.price))) {
        await appendOnce(`avoid:${o.id}`, { k:'avoid', agent:o.agent, id:o.id,
          reason:at.reason || (at2 && at2.reason) || 'no-observed-update-in-window' });
        changed = true; continue;
      }

      const px = at.price, px2 = at2 && at2.price;
      const outcome = questionOutcome(o, px, px2);
      if (outcome === 'VOID') {
        await appendOnce(`avoid:${o.id}`, { k:'avoid', agent:o.agent, id:o.id,
          reason:'tie', exitPx:px, exitPx2:px2 || null, exitAt:at.publishTime });
        changed = true; continue;
      }

      const hit = o.side === outcome;
      await appendOnce(`asettle:${o.id}`, { k:'agent', agent:o.agent, id:o.id,
        res:hit ? 'hit' : 'miss', side:o.side, outcome, exitPx:px,
        exitPx2:px2 || null, exitAt:at.publishTime,
        exitAt2:at2 ? at2.publishTime : null });
      const r = recs[o.agent] || (recs[o.agent] = {
        n:0, hits:0, streak:0, best:0, applied:[] });
      r.applied = Array.isArray(r.applied) ? r.applied : [];
      if (!r.applied.includes(o.id)) {
        r.n++;
        if (hit) { r.hits++; r.streak++; r.best = Math.max(r.best, r.streak); }
        else r.streak = 0;
        r.last = { label:o.label, side:o.side, hit, t:now };
        r.applied.unshift(o.id);
        r.applied = r.applied.slice(0, 500);
        const nm = (AGENTS.find(a => a.id === o.agent) || {}).name || o.agent;
        feedRows.push({ w:nm,
          a:`${hit ? 'HIT' : 'MISS'} - ${o.label} - called ${o.side}`,
          c:hit ? 'hit' : 'miss', agent:1 });
      }
      changed = true;
    }
    open = still;

    let prev = {};
    if (board.length) {
      const pxKey = `g:agents:pxh:${hour}`;
      let hourPx = await getJSONStrict(pxKey);
      if (!hourPx) {
        const snap = Object.fromEntries(PXFEEDS.filter(telemetryReady).map(f => [f, prices[f]]));
        if (await setnxJSON(pxKey, snap, 12 * 86400)) hourPx = snap;
        else hourPx = await getJSONStrict(pxKey);
      }
      if (!hourPx) throw new Error('could not persist the Fleet hour-price snapshot');
      prev = (await getJSONStrict(`g:agents:pxh:${hour - 1}`))
        || (await getJSONStrict('g:agents:px')) || {};

      for (let i = 0; i < AGENTS.length; i++) {
        const a = AGENTS[i];
        const id = `${a.id}-${hour}`;
        if (open.some(o => o.id === id)) continue;
        const seedN = Math.abs(mulberry32(hour * 31 + i * 7)() * 1e9 | 0);
        const [, t] = board[seedN % board.length];
        const p0 = prev[t.feed], p1 = prices[t.feed];
        const drift = Number.isFinite(p0) && p0 > 0 ? (p1 - p0) / p0 : 0;
        const side = agentSide(a.id, t, prices, drift, seedN, wardenUp);
        const candidate = { id, agent:a.id, label:t.label, kind:t.kind,
          feed:t.feed, feed2:t.feed2 || null, side, entry:p1,
          entry2:t.feed2 ? prices[t.feed2] : null, pct:t.pct == null ? null : t.pct,
          t:now, exp:now + t.mins * 60e3,
          settleRule:SETTLE_RULE, outcomeRule:OUTCOME_RULE, oracleSrc:'pyth-onchain' };
        if (t.kind === 'thr') candidate.thresh = p1 * (1 + t.pct);
        else if (t.kind === 'thrDown') candidate.thresh = p1 * (1 - t.pct);
        else if (t.kind === 'range') {
          candidate.lo = p1 * (1 - t.pct); candidate.hi = p1 * (1 + t.pct);
        }
        const sealKey = `aseal:${id}`;
        let sealed = await getJSONStrict(sealKey);
        if (!sealed) {
          if (await setnxJSON(sealKey, candidate)) sealed = candidate
          else sealed = await getJSONStrict(sealKey);
        }
        if (sealed) {
          if (usesPythTransition(sealed.settleRule))
            await appendOnce(`aseal:${id}`, { k:'aseal', agent:a.id, id,
              label:sealed.label, kind:sealed.kind, feed:sealed.feed,
              feed2:sealed.feed2 || null, side:sealed.side, entry:sealed.entry,
              entry2:sealed.entry2, pct:sealed.pct, exp:sealed.exp,
              settleRule:sealed.settleRule,
              outcomeRule:sealed.outcomeRule || 'dead-zone-4bp-v1' });
          open.push(sealed); changed = true;
        }
      }
    }

    if (changed)
      await setManyJSONAtomic([
        ['g:agents:rec', recs],
        ['g:agents:open', open],
      ]);
    for (const row of feedRows) await bumpFeed(row);
    const out = fleetPayload(recs, open);
    agentsTickCache.t = Date.now(); agentsTickCache.v = out;
    return out;
  } finally {
    try { await releaseLease('lock:g:agents', lease); } catch {}
  }
}

function refund(p, s) { p.cr += s.stake; }

// full per-player shot history — every settled shot, capped at 200,
// served to the client and exported by the Black Box. The hash-chained
// log stays the ground truth; this is the readable per-wallet view.
async function pushHist(w, rec) {
  const k = `hist:${w}`;
  const {commitGuarded} = require('../lib/kv.js');
  for (let attempt=0; attempt<4; attempt++) {
    const expected = await getJSONStrict(k);
    const h = expected || [];
    if (h.some(x => x && x.id === rec.id)) return false;
    const result = await commitGuarded({id:crypto.randomBytes(16).toString('hex'),
      entries:[{key:k,expected,value:[rec,...h].sort((a,b)=>b.t-a.t).slice(0,200)}],debits:[],leases:[]});
    if (result.ok) return true;
    if (result.code !== 'WRITE_CONFLICT') throw new Error('history commit unavailable');
  }
  throw new Error('history commit busy');
}

// Human-readable, per-wallet receipts for every reload/podium effect. Several
// reloaders may pay the same champion concurrently, so this list has its own
// ownership-safe writer lease and a signature+kind de-duplication key.
async function pushChampionReceipt(w, rec) {
  const lock = `lock:chist:${w}`;
  let lease = null;
  for (let i=0; i<60 && !lease; i++) {
    lease = await acquireLease(lock, 20);
    if (!lease) await new Promise(r => setTimeout(r, 20 + Math.min(i,20)*5));
  }
  if (!lease) throw new Error('champion receipt history busy - retry');
  try {
    const key = `chist:${w}`;
    const h = (await getJSONStrict(key)) || [];
    const rid = `${rec.id}:${rec.kind}`;
    if (h.some(x => x && `${x.id}:${x.kind}` === rid)) return false;
    h.unshift(rec);
    await setJSON(key, h.slice(0, 100));
    return true;
  } finally {
    try { await releaseLease(lock, lease); } catch {}
  }
}

/** Repair the public/account-level receipt after the atomic economic gate.
 * New signature gates contain the full verified breakdown, so a retry can
 * recreate log, feed and readable histories without moving value again. */
async function repairReloadReceipt(sig, g) {
  if (!g || g.v !== 2 || !isWalletShaped(g.w)) return false;
  const legs = Array.isArray(g.champLegs) ? g.champLegs : [];
  await appendOnce(`reload:${sig}`, { k:'reload', w:g.w, sig,
    amount:g.amount, credited:g.credit, burned:g.burned,
    champs:g.champPaid || 0, retained:g.selfRouted || 0,
    legs:legs.map(x => ({ w:x.w, amt:x.amt })) });
  await pushChampionReceipt(g.w, { id:sig, t:g.t, kind:'reload',
    credits:g.credit, burned:g.burned, podiumPaid:g.champPaid || 0,
    retained:g.selfRouted || 0 });
  for (const leg of legs) if (isWalletShaped(leg.w) && leg.amt > 0)
    await pushChampionReceipt(leg.w, { id:sig, t:g.t, kind:'received',
      rcx:leg.amt, from:shortW(g.w) });
  await bumpFeed({ id:`reload:${sig}`, w:shortW(g.w), actorWallet:g.w,
    a:`BURNED ${Number(g.burned||0).toLocaleString()} RCX`
      + (g.champPaid ? ` - ${Number(g.champPaid).toLocaleString()} RCX paid to other champions` : '')
      + (g.selfRouted ? ` - ${Number(g.selfRouted).toLocaleString()} RCX stayed with this champion` : '')
      + ` - ${Number(g.credit||0).toLocaleString()} credits`, c:'seal', sig });
  return true;
}

// Brier bookkeeping for shots that carried a stated probability. The score is
// (p - outcome)^2 against the player's OWN side, so 0 is clairvoyance, 0.25 is
// coin-flip confidence, 1 is confident wrongness. Voids score nothing.
// Aggregates live on the player (bsum/bn) plus a 10-bin reliability histogram
// for the public calibration curve. Everything here is recomputable from the
// hash-chained log, which publishes sp in every reveal.
function scoreStated(p, s, hit) {
  if (!Number.isFinite(s.sp)) return;
  const e = s.sp - (hit ? 1 : 0);
  p.bn = (p.bn || 0) + 1;
  p.bsum = +(((p.bsum || 0) + e * e).toFixed(6));
  const bin = Math.min(9, Math.floor(s.sp * 10));
  p.calib = p.calib || {};
  const c = p.calib[bin] || { n: 0, h: 0 };
  c.n++; if (hit) c.h++;
  p.calib[bin] = c;
}
// The Coinflip Ledger's own row. Only calls the player made INSIDE the same
// difficulty band we hold Kalshi and Polymarket to — a stated probability
// between 0.35 and 0.65 — so our number is produced by the same filter as
// theirs. Scoring ourselves on our easy calls while scoring them on their
// hard ones would make the whole board worthless, and ours is the one row we
// control. Counters start empty and accumulate forward; the page says since
// when. See lib/ledger.js and docs/LEDGER.md.
const LDG_LO = 0.35, LDG_HI = 0.65;
async function ledgerBand(s, hit, w) {
  if (!Number.isFinite(s.sp) || s.sp < LDG_LO || s.sp > LDG_HI) return;
  const e = s.sp - (hit ? 1 : 0);
  await applyOnce(`ledger:${w}:${s.id}`, {w,id:s.id}, {hashKey:'ldg:rx', deltas:{ n: 1, sum: +(e * e).toFixed(6), hits: hit ? 1 : 0,
      [`b${Math.min(9, Math.floor(s.sp * 10))}n`]: 1,
      ...(hit ? { [`b${Math.min(9, Math.floor(s.sp * 10))}h`]: 1 } : {}) }});
}

// The player result and its delivery intent commit together. A process death
// never requires re-deciding the oracle outcome; replay these exact effects.
function queueSettlement(p, s, log, history) {
  p.settlementOutbox = p.settlementOutbox || [];
  if (!p.settlementOutbox.some(e => e.s.id === s.id))
    p.settlementOutbox.push(JSON.parse(JSON.stringify({s,qualified:!!p.qualified,log,history,
      period:{day:today(),season:seasonKey(),totalXp:p.xp}})));
}
async function flushSettlements(p) {
  const pending = p.settlementOutbox || [];
  if (!pending.length) return;
  const delivered = new Set();
  for (const e of pending) {
    try {
      const s = e.s, eventId = `${p.w}:${s.id}`;
      if (s.res === 'void') {
        if (s.allocationRule !== 'on-settle-v2') await reverseStake(s.stake,p.w,s.id);
      } else {
        await fundSettledStake(s,p.w);
        await ledgerBand(s,s.res === 'hit',p.w);
        await bumpLadderOnce(p.w,s.xp,e.qualified,s.id,e.period);
        if (!isDemo(p.w)) {
          if (s.res === 'hit') {
            await seedStats();
            await applyOnce(`hitpay:${eventId}`,{w:p.w,id:s.id,back:s.back,t:s.settledAt},
              {hashKey:STATS,deltas:{hitPaid:s.back}});
          }
          await bumpFeed({id:`settle:${eventId}`,w:shortW(p.w),actorWallet:p.w,
            a:s.res === 'hit' ? `HIT +${s.xp} XP - +${s.back.toLocaleString()} credits`
              : `MISS - streak reset - +${s.xp} XP`,c:s.res});
        }
      }
      await noteSettle(s.feed,s.res === 'void' ? 'void' : 'set',eventId);
      if (s.feed2) await noteSettle(s.feed2,s.res === 'void' ? 'void' : 'set',eventId);
      await appendOnce(`settle:${eventId}`,e.log);
      await pushHist(p.w,e.history);
      delivered.add(s.id);
    } catch { /* Keep durable intent; the next player read retries it. */ }
  }
  if (!delivered.size) return;
  p.settlementOutbox = pending.filter(e => !delivered.has(e.s.id));
  try { await playerWrites.save([p]); }
  catch { p.settlementOutbox = pending; } // safe at-least-once delivery
}

function brierOf(p) {
  const bn = p.bn || 0;
  if (!bn) return { stated: 0, brier: null, brierIndex: null, calibration: null };
  const b = p.bsum / bn;
  return { stated: bn, brier: +b.toFixed(4),
    brierIndex: Math.round((1 - Math.sqrt(b)) * 100),
    calibration: Array.from({ length: 10 }, (_, i) => {
      const c = (p.calib || {})[i];
      return c ? { lo: i / 10, hi: (i + 1) / 10, n: c.n, hits: c.h } : null;
    }) };
}

async function settle(p, prices) {
  if (!p.open.length) return false;
  const now = Date.now(); let changed = false;
  const still = [];
  for (const s of p.open) {
    // A saved shot is authoritative. Repair any interruption between saving
    // it and publishing/accounting for the seal before doing anything else.
    if (s.sealAccountingV === 2) await recordSealedShot(s, p.w);
    if (now < s.exp) { still.push(s); continue; }

    const strict = usesPythTransition(s.settleRule);
    const at = strict
      ? await priceCrossing(s.feed, s.exp, now, s.oracleSrc || 'pyth-onchain')
      : await priceAt(s.exp, now, s.oracleSrc || null);
    const at2 = strict && s.kind === 'race'
      ? await priceCrossing(s.feed2, s.exp, now, s.oracleSrc || 'pyth-onchain')
      : null;
    const eventId = `${p.w}:${s.id}`;

    if (at.wait || (at2 && at2.wait)) {
      await noteSettle(s.feed, 'wait', eventId);
      if (at2) await noteSettle(s.feed2, 'wait', eventId);
      still.push(s); continue;
    }

    const px = strict ? at.price : (at.row ? at.row[s.feed] : undefined);
    const px2 = s.kind === 'race'
      ? (strict ? at2 && at2.price : (at.row ? at.row[s.feed2] : undefined)) : 1;
    if (at.expired || (at2 && at2.expired)
        || !Number.isFinite(px) || !Number.isFinite(px2)) {
      changed = true;
      refund(p, s); s.res = 'void'; s.settledAt = now; s.exitPx = null;
      s.skillXp = 0; s.settleXp = 0; s.xp = 0;
      // A race needs two comparable diagnostics; do not mislabel one feed as the other.
      const indicative = s.kind === 'race' ? null : (at.indicative || null);
      if (indicative) {
        s.indicativePx = indicative.price;
        s.indicativeAt = indicative.publishTime;
        s.indicativeGapSec = Math.round(indicative.gapMs / 1000);
      }
      const voidReason = strict
        ? (at.reason || (at2 && at2.reason) || 'no-observed-update-in-window')
        : (at.expired ? 'no-oracle-sample-in-window' : 'feed-gone');
      const appliedSettleRule = strict
        ? SETTLE_RULE
        : (s.settleRule || 'observed-sample-v1');
      s.voidReason = voidReason;
      s.settleRuleApplied = appliedSettleRule;
      const log = { k:'settle', w:p.w, id:s.id,
        res:'void', reason:voidReason, commitV:s.commitV || 1,
        settleRuleApplied:appliedSettleRule,
        indicativePx:s.indicativePx ?? null, indicativeAt:s.indicativeAt ?? null,
        indicativeGapSec:s.indicativeGapSec ?? null };
      const history = { id:s.id, t:now, label:s.label, side:s.side,
        res:'void', xp:0, stake:s.stake, entry:s.entry, exit:null,
        kind:s.kind, thresh:s.thresh, pct:s.pct,
        reason:voidReason, settleRuleApplied:appliedSettleRule,
        indicativePx:s.indicativePx ?? null, indicativeAt:s.indicativeAt ?? null,
        indicativeGapSec:s.indicativeGapSec ?? null };
      queueSettlement(p,s,log,history);
      p.closed.unshift(s); p.closed = p.closed.slice(0, 20);
      continue;
    }

    changed = true;
    const outcome = questionOutcome(s, px, px2);
    if (outcome === 'VOID') {
      refund(p, s); s.res = 'void';
      s.skillXp = 0; s.settleXp = 0; s.xp = 0;
    } else if (outcome === s.side) {
      p.shots++; s.res = 'hit'; p.hits++;
      const sm = streakMult(p.streak);
      s.xpBase = s.xp;
      s.streakMult = +sm.toFixed(2);
      s.skillXp = coreRules.skillXp(s.xp, p.streak);
      s.settleXp = SETTLE_XP;
      s.xp = s.skillXp + s.settleXp;
      p.streak++; p.best = Math.max(p.best, p.streak);
      scoreStated(p, s, true);
      p.xp += s.xp;
      s.back = coreRules.hitPayout(s.stake);
      p.cr += s.back;
    } else {
      p.shots++; s.res = 'miss'; p.streak = 0;
      scoreStated(p, s, false);
      s.skillXp = 0; s.settleXp = SETTLE_XP; s.xp = SETTLE_XP;
      p.xp += s.xp;
    }

    s.settleRuleApplied = strict ? SETTLE_RULE : (s.settleRule || 'observed-sample-v1');
    s.settledAt = now; s.exitPx = px;
    s.exitAt = strict ? at.publishTime : at.row.t;
    if (strict) {
      s.prevExitAt = at.prevPublishTime;
      s.exitConfBps = at.confBps;
      s.exitObservedAt = Number(at.row && at.row.t) || null;
      s.exitSlot = Number(at.row && at.row.slot) || 0;
      s.exitPostedSlot = Number(at.row && at.row.postedSlot) || 0;
      s.exitSource = (at.row && at.row.src) || 'pyth-onchain';
      if (at2) {
        s.exitPx2 = px2; s.exitAt2 = at2.publishTime;
        s.prevExitAt2 = at2.prevPublishTime;
        s.exitConfBps2 = at2.confBps;
        s.exitObservedAt2 = Number(at2.row && at2.row.t) || null;
        s.exitSlot2 = Number(at2.row && at2.row.slot) || 0;
        s.exitPostedSlot2 = Number(at2.row && at2.row.postedSlot) || 0;
        s.exitSource2 = (at2.row && at2.row.src) || 'pyth-onchain';
      }
    }
    const log = { k:'settle', w:p.w, id:s.id,
      res:s.res, exitPx:px, exitAt:s.exitAt, exitPx2:s.exitPx2,
      exitAt2:s.exitAt2, prevExitAt:s.prevExitAt == null ? null : s.prevExitAt,
      prevExitAt2:s.prevExitAt2 == null ? null : s.prevExitAt2,
      exitConfBps:s.exitConfBps == null ? null : s.exitConfBps,
      exitConfBps2:s.exitConfBps2 == null ? null : s.exitConfBps2,
      exitObservedAt:s.exitObservedAt == null ? null : s.exitObservedAt,
      exitObservedAt2:s.exitObservedAt2 == null ? null : s.exitObservedAt2,
      exitSlot:s.exitSlot == null ? null : s.exitSlot,
      exitSlot2:s.exitSlot2 == null ? null : s.exitSlot2,
      exitPostedSlot:s.exitPostedSlot == null ? null : s.exitPostedSlot,
      exitPostedSlot2:s.exitPostedSlot2 == null ? null : s.exitPostedSlot2,
      exitSource:s.exitSource || null, exitSource2:s.exitSource2 || null,
      side:s.side, salt:s.salt, sp:s.sp ?? null, commit:s.commit,
      // How the salt was made, and the public half of the recipe. A reader who
      // wants to check the commit needs only side and salt, exactly as before.
      // These two are for the PLAYER: with them, the wallet that sealed the
      // shot can rebuild the salt years later on a machine it has never used,
      // which is the whole reason the salt stopped being ours alone.
      saltV:s.saltV || null, saltNonce:s.saltNonce || null,
      commitV:s.commitV || 1, settleRule:s.settleRule || 'observed-sample-v1',
      settleRuleApplied:s.settleRuleApplied,
      outcomeRule:s.outcomeRule || 'dead-zone-4bp-v1',
      allocationRule:s.allocationRule || 'upfront-v1', xp:s.xp || 0,
      settleXp:s.settleXp || 0, skillXp:s.skillXp || 0 };
    const history = { id:s.id, t:now, label:s.label, side:s.side,
      sp:s.sp, res:s.res, xp:s.res === 'void' ? 0 : (s.xp || 0), back:s.back || 0,
      settleXp:s.settleXp || 0, skillXp:s.skillXp || 0,
      stake:s.stake, entry:s.entry, exit:px, kind:s.kind,
      thresh:s.thresh, pct:s.pct };
    queueSettlement(p,s,log,history);
    p.closed.unshift(s); p.closed = p.closed.slice(0, 20);
  }
  p.open = still;
  return changed;
}

// Reserve credits only after every seal validation has passed. Global shot
// accounting happens after the durable player record exists; 70/30 allocation
// happens exactly once only when a shot reaches HIT or MISS.
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
function feedSealReady(prices, feed, mins) {
  const age = (prices.ages || {})[feed];
  const conf = (prices.confs || {})[feed];
  return prices.src === 'pyth-onchain'
    && Number.isFinite(prices[feed])
    && Number.isFinite(age) && age >= 0 && age <= maxSealAge(mins)
    && Number.isFinite(conf) && conf >= 0 && conf <= PX_MAX_CONF_BPS
    && Number.isFinite((prices.pubs || {})[feed])
    && Number.isFinite((prices.prevPubs || {})[feed]);
}
const targetSealReady = (prices, target) =>
  !!target && [target.feed, target.feed2].filter(Boolean)
    .every(feed => feedSealReady(prices, feed, target.mins));

// Freeze the exact validated Pyth state that admitted an economic shot. The
// fingerprint excludes request time and age (both move while the underlying
// update stays the same) and binds the PriceUpdateV2 identity, price,
// confidence, EMA, publish cadence and slots. This is evidence of what
// Ratchet accepted; it is not a second oracle or a trading signal.
function oracleSealSnapshot(prices, feeds) {
  const value = (map, feed) => {
    if (!map || map[feed] == null || map[feed] === '') return null;
    const n = Number(map[feed]);
    return Number.isFinite(n) ? n : null;
  };
  const body = {
    schema:'ratchetx-oracle-seal-v1',
    provider:'Pyth Network',
    product:'PriceUpdateV2',
    network:'Solana mainnet',
    source:String(prices && prices.src || ''),
    feeds:Object.fromEntries(feeds.map(feed => {
      const account = PX_ACCOUNTS[feed] || [];
      return [feed, {
        account:account[0] || null,
        feedId:account[1] || null,
        price:value(prices, feed),
        confidenceBps:value(prices && prices.confs, feed),
        emaPrice:value(prices && prices.emaPrices, feed),
        emaConfidenceBps:value(prices && prices.emaConfs, feed),
        publishTime:value(prices && prices.pubs, feed),
        previousPublishTime:value(prices && prices.prevPubs, feed),
        rpcSlot:value(prices && prices.slots, feed),
        postedSlot:value(prices && prices.postedSlots, feed),
      }];
    })),
  };
  return { ...body,
    snapshotHash:crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex') };
}

async function takeStake(p, stake, structured = false) {
  // Existing challenge callers still receive prose; the shot adapter needs a
  // stable code from this SAME validation, not a second copy of the credit rules.
  const refuse = (code, reason) => structured ? {code, reason} : reason;
  if ((p.settlementOutbox || []).length >= 32) return refuse('SETTLEMENT_DELIVERY_PENDING', 'settlement delivery is pending; read state before opening another shot');
  if (badStake(stake)) return refuse('INVALID_STAKE', `stake must be a whole number between ${STAKE_MIN} and ${STAKE_MAX.toLocaleString()}`);
  if (p.cr < stake) return refuse('INSUFFICIENT_CREDITS', `not enough credits - you have ${Math.floor(p.cr).toLocaleString()}${MINT ? '. Reload: burn RCX for credits, 1 for 1.' : '.'}`);
  p.cr -= stake; p._src = 'cr';
  return null;
}

/** Publish and account for a shot only after its player record exists.
 *
 * The old path incremented the global shot count before saving the player. A
 * failed save left a public shot with no owner and no possible settlement.
 * New seals carry this version marker; every later state read repairs an
 * interrupted post-save log/accounting step with the same replay gate. */
async function recordSealedShot(s, w) {
  if (!s || s.sealAccountingV !== 2) return false;
  if (!isDemo(w)) {
    await seedStats();
    await applyOnce(`shotseal:${w}:${s.id}`, { w, id:s.id, t:Date.now() }, {
      hashKey:STATS, deltas:{ shots:1 },
    });
  }
  await appendOnce(`seal:${w}:${s.id}`, { k:'seal', w, id:s.id,
    feed:s.feed, feed2:s.feed2 || null, stake:s.stake, exp:s.exp,
    entry:s.entry, entry2:s.entry2, kind:s.kind || 'dir',
    thresh:s.thresh == null ? null : s.thresh, pct:s.pct == null ? null : s.pct,
    label:s.label || null, commit:s.commit, commitV:s.commitV,
    settleRule:s.settleRule, outcomeRule:s.outcomeRule || 'dead-zone-4bp-v1',
    allocationRule:s.allocationRule, economyRule:s.economyRule || null,
    economyMode:s.economyMode || null,
    oracleSeal:s.oracleSeal || null, challenge:s.chal || null });
  return true;
}

/** Allocate a new-rule stake exactly once, when it becomes hit/miss. */
async function fundSettledStake(s, w) {
  if (isDemo(w) || s.allocationRule !== 'on-settle-v2') return;
  await seedStats();
  const a = stakeAllocation(s.stake);
  await applyOnce(`stakefund:${w}:${s.id}`, { t:Date.now(), stake:s.stake }, {
    hashKey:STATS, deltas:{ burned:a.burn, potD:a.potD, pot:a.pot },
  });
  s.allocated = true;
}

/** Reverse a legacy upfront allocation once.  New-rule shots allocate only
 * on hit/miss, so their VOID path has nothing to unwind. */
async function reverseStake(stake, w, shotId = null) {
  if (w && isDemo(w)) return;
  await seedStats();
  const a = stakeAllocation(stake);
  const deltas = { burned:-a.burn, potD:-a.potD, pot:-a.pot };
  if (shotId) {
    await applyOnce(`stakereverse:${w}:${shotId}`,
      { t:Date.now(), stake }, { hashKey:STATS, deltas });
  } else {
    await bumpStats(deltas);
  }
}

function captureAuthorized(req, secret) {
  if (!secret) return false;
  const got = Buffer.from(String(req.headers.authorization || ''), 'utf8');
  const want = Buffer.from(`Bearer ${secret}`, 'utf8');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

async function oracleIngest(req, res) {
  const secret = process.env.RATCHET_CAPTURE_SECRET || '';
  if (!secret) return res.status(503).json({ ok:false, reason:'capture service is not configured' });
  if (req.method !== 'POST') return res.status(405).json({ ok:false, reason:'POST required' });
  if (!captureAuthorized(req, secret))
    return res.status(401).json({ ok:false, reason:'unauthorized capture service' });

  const updates = Array.isArray(req.body && req.body.updates) ? req.body.updates : [];
  if (!updates.length || updates.length > 32)
    return res.status(400).json({ ok:false, reason:'updates must contain 1-32 account events' });

  const byAccount = new Map(Object.entries(PX_ACCOUNTS)
    .map(([feed, spec]) => [spec[0], { feed, feedId:spec[1] }]));
  const now = Math.floor(Date.now() / 1000);
  const validated = [];
  try {
    for (const update of updates) {
      const spec = byAccount.get(String(update && update.account || ''));
      if (!spec) throw new Error('unknown sponsored account');
      if (!PYTH_OWNERS.has(String(update.owner || ''))) throw new Error('wrong Pyth owner');
      if (typeof update.data !== 'string' || update.data.length > 4096)
        throw new Error('invalid account data');
      const slot = Number(update.slot);
      if (!Number.isSafeInteger(slot) || slot < 0) throw new Error('invalid slot');
      const decoded = decodePx(update.data, spec.feedId);
      if (decoded.postedSlot > slot) throw new Error('Pyth posted slot is ahead of notification');
      const age = now - decoded.publishTime;
      if (decoded.prevPublishTime > decoded.publishTime)
        throw new Error('invalid Pyth publish interval');
      if (age < -5 || age > PX_MAX_AGE_S) throw new Error('stale or future Pyth update');
      const confBps = decoded.px > 0 ? decoded.conf / decoded.px * 10000 : Infinity;
      const emaConfBps = decoded.emaPx > 0
        ? decoded.emaConf / decoded.emaPx * 10000 : Infinity;
      if (!Number.isFinite(confBps) || confBps > PX_MAX_CONF_BPS)
        throw new Error('Pyth confidence too wide');
      if (!Number.isFinite(emaConfBps)) throw new Error('invalid Pyth EMA confidence');
      validated.push({ feed:spec.feed, slot, postedSlot:decoded.postedSlot, price:decoded.px,
        publishTime:decoded.publishTime, prevPublishTime:decoded.prevPublishTime,
        confBps:+confBps.toFixed(3), emaPrice:decoded.emaPx,
        emaConfidenceBps:+emaConfBps.toFixed(3) });
    }
  } catch (error) {
    return res.status(400).json({ ok:false, reason:String(error.message || error) });
  }

  let accepted = 0, duplicates = 0;
  const receivedAt = Date.now();
  for (const update of validated) {
    const kept = await ingestPxUpdate(update.feed, { ...update, receivedAt });
    kept ? accepted++ : duplicates++;
  }
  return res.json({ ok:true, v:VERSION, accepted, duplicates, receivedAt });
}

module.exports = async (req, res) => playerWrites.run(async () => {
  const sessionSurface=req.query?.action==='play-session';
  // Public agent wallets may call the signed JSON API from a browser origin.
  // There are no cookie credentials to expose: every state-changing player
  // action verifies its own wallet signature. Keep x402's custom headers both
  // allowed on preflight and visible to the client.
  if (typeof res.setHeader === 'function') {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'Content-Type, PAYMENT-SIGNATURE');
    res.setHeader('access-control-expose-headers', 'PAYMENT-REQUIRED, PAYMENT-RESPONSE');
  }
  if(sessionSurface && !sessionHttp.privateHeaders(req,res))
    return res.status(403).json({ok:false,code:'ORIGIN_REFUSED'});
  if (req.method === 'OPTIONS') {
    res.status(204);
    return typeof res.end === 'function' ? res.end() : res.json({});
  }
  const heldPlayerLocks = [];
  // WAIT FOR IT, do not refuse it.
  // This used to be a single attempt: one acquireLease, and a 409 to the user
  // if anyone else held the lock. But the site polls `state` in the background
  // and `state` takes this same lock (it settles lazily, so it can write). A
  // player clicking ANCHOR while their own poll was in flight collided with
  // themselves and got told to retry — for a button that is supposed to always
  // work. lib/log.js already had the right shape; the handler did not use it.
  //
  // ~2.4s of bounded backoff turns a collision into a short wait. A 409 now
  // means genuinely stuck, not merely busy.
  const LOCK_TRIES = 24, LOCK_GAP_MS = 100;
  const acquirePlayerLock = async w => {
    if (!(isWalletShaped(w) || isDemo(w))) return false;
    const key = `lock:u:${w}`;
    if (heldPlayerLocks.some(x => x.key === key)) return true;
    for (let a = 0; a < LOCK_TRIES; a++) {
      const token = await acquireLease(key, 30);
      if (token) { heldPlayerLocks.push({ key, token }); playerWrites.lease(key, token, 30); return true; }
      await new Promise(r => setTimeout(r, LOCK_GAP_MS));
    }
    return false;
  };
  try {
    const query = req.query || {};
    // /api/gauntlet rewrites here so it does not consume a thirteenth Vercel
    // function slot. Preserve that destination action for every method; a
    // POST to the public GET-only route must not fall through to state.
    const routed = new Set(['gauntlet', 'agent-report', 'agent-proof-bundle', 'activity-feed', 'play-session']);
    const action = routed.has(query.action)
      ? query.action
      : (req.method === 'GET' ? query.action : (req.body||{}).action) || 'state';
    // The stream has its own strong service authentication and can legitimately
    // burst when several Pyth accounts update in the same Solana slot. Keep it
    // outside the public per-IP limiter; every byte is validated again here.
    if (action === 'oracle-ingest') return oracleIngest(req, res);

    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const isPost = req.method !== 'GET';
    const retryAfterSeconds = rateLimitRetrySeconds(ip, isPost);
    if (retryAfterSeconds) {
      res.setHeader('retry-after', String(retryAfterSeconds));
      return res.status(429).json({ ok:false, code:'RATE_LIMITED', retryAfterSeconds,
        reason:'slow down - too many requests from this address' });
    }
    if(action==='play-session')return await sessionHttp.handle(req,res,{
      acquirePlayerLock,trackPlayer:playerWrites.track,game:module.exports,
      resolvePlayer:async w=>{
        // Same canonical settlement, without the broad state route's optional
        // anchor scans, staking yield, enrollment or other unrelated effects.
        const p=await loadPlayer(w);
        if(!p._existed)throw Object.assign(new Error('existing agent required'),{code:'AGENT_ADMISSION_REQUIRED'});
        await settle(p,await getPrices());await savePlayer(p);
        return {wallet:w,credits:p.cr,...brierOf(p),
          xp:p.xp||0,chambers:Math.min(4, rankOf(p.xp)+1) + 1,open:(p.open||[]).map(({side,salt,xp,sp,...s})=>s),closed:p.closed||[]};
      }});
    // These public agent routes can scan durable history and, for a new proof,
    // query Pyth Benchmarks. Keep their stable public URLs, but do not let an
    // unauthenticated caller bypass the same per-IP budget as the core API.
    if (action === 'agent-report') return agentReport.handler(req, res);
    if (action === 'agent-proof-bundle') return proofBundle(req, res);
    if (action === 'activity-feed') {
      if (req.method !== 'GET') return res.status(405).json({ok:false,v:VERSION,reason:'GET only'});
      const activity = await require('../lib/activity_feed.js').peekFeed();
      res.setHeader('cache-control','public, max-age=3, s-maxage=3');
      return res.json({ok:true,v:VERSION,readOnly:true,...activity,
        feed:await require('../lib/activity_agents.js').combine(activity.feed),
        feedPolicy:{playerLimit:100,agentDemoLimit:20,demoPaysPrizes:false}});
    }
    // Player records are JSON blobs. Without a per-wallet mutex, two shots
    // can load the same credit balance, both spend it, then last-write-wins
    // the balance while retaining economic effects from both requests.
    let gauntletHandle = null;
    if (action === 'gauntlet') {
      if (req.method !== 'GET')
        return res.status(405).json({ ok:false, v:VERSION, reason:'GET only' });
      const raw = query.handle;
      if (raw == null || raw === '') {
        res.setHeader('cache-control', 'public, max-age=30, s-maxage=60');
        return res.json({ ok:true, v:VERSION, gauntlet: await publicSpecAsync(), progress:null,
          next:'call ratchet_new_demo through https://ratchetx.xyz/api/mcp' });
      }
      try { gauntletHandle = cleanHandle(Array.isArray(raw) ? raw[0] : raw); }
      catch (error) {
        return res.status(400).json({ ok:false, v:VERSION,
          code:error.code || 'BAD_HANDLE', reason:error.message,
          next:'call ratchet_new_demo and pass its returned handle' });
      }
    }

    const playerActions = new Set(['state','gauntlet','shot','duel','stake','challenge','accept',
      'agent-register','reload','mirror_confirm','anchor']);
    const lockWallet = gauntletHandle ? 'demo-' + gauntletHandle
      : req.method === 'GET' ? query.wallet
      : req.body && req.body.auth && req.body.auth.wallet;
    if (playerActions.has(action) && (isWalletShaped(lockWallet) || isDemo(lockWallet))) {
      if (!(await acquirePlayerLock(lockWallet)))
        return res.status(409).json({ ok:false, code:'PLAYER_BUSY', reason:'that player already has an update in flight — retry in a moment' });
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
    if (action === 'stream-health') {
      const stream = await pxStreamHealth();
      res.setHeader('access-control-allow-origin', '*');
      return res.json({ ok:true, v:VERSION, t:Date.now(), source:'solana-accountSubscribe',
        settlementFallback:'one-minute direct Solana RPC sampler', stream });
    }

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
      try { rep.stream = await pxStreamHealth(); } catch {}
      rep.what = 'third-party measurement of Pyth sponsored push feeds on Solana, taken by a consumer that settles real bets on them';
      rep.method = 'Solana accountSubscribe captures each sponsored-account transition; one-minute JSON-RPC polling remains as fallback; PriceUpdateV2 is decoded locally and owner, discriminator, verification level, feed id, age and confidence are checked before a number is kept';
      rep.reproduce = 'GET /api/game?action=path&feed=SOL&from=<ms>&to=<ms> returns the same samples these statistics are computed from';
      res.setHeader('access-control-allow-origin', '*');
      return res.json(rep);
    }

    // Agent-readable Pyth layer. Both routes stop before getPrices(), so an
    // agent read never creates a fresh Solana RPC request. The capture worker
    // writes one shared validated snapshot and every client sees that state.
    if (action === 'pyth-context') {
      let feed;
      try { feed = cleanPythFeed(query.feed); }
      catch (error) { return res.status(400).json({ ok:false, v:VERSION, reason:error.message }); }
      const hours = cleanPythHours(query.hours);
      const [snapshot, health] = await Promise.all([
        latestSnapshot(),
        cachedFeedReport(hours),
      ]);
      const targets = Object.entries(targetBoard(boardHour())).map(([id, t]) => ({
        id, kind:t.kind || 'dir', feed:t.feed, feed2:t.feed2 || null,
        mins:t.mins, label:t.label,
      }));
      res.setHeader('cache-control', 'public, max-age=15, s-maxage=30');
      return res.json({ ...buildPythContext({ snapshot, health, targets, feed }), v:VERSION });
    }

    if (action === 'pyth-path') {
      let request;
      try { request = parsePathRequest(query); }
      catch (error) { return res.status(400).json({ ok:false, v:VERSION, reason:error.message }); }
      const points = await evidencePathFor(request.feed, request.from, request.to,
        request.sourceValue);
      res.setHeader('cache-control', 'public, max-age=15, s-maxage=30');
      return res.json({ ...pathResponse(request, points), v:VERSION });
    }

    // A blockhash is a pure RPC passthrough for the reload signer — it needs
    // no oracle read, no sampling, no challenge sweep. It used to sit below
    // all three, so the hottest wallet-flow request paid for a full price
    // fetch it never looked at. (h70)
    if (action === 'blockhash') {
      const r = await rpcCall('getLatestBlockhash', [{ commitment: 'confirmed' }]);
      const bh = r && r.value && r.value.blockhash;
      if (!bh) return res.status(502).json({ ok: false, reason: 'RPC unavailable - try again' });
      return res.json({ ok: true, blockhash: bh });
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
    let sampled = false;
    try { sampled = await samplePx(prices); } catch {}

    // A scheduler needs only to wake the sampler. Unlike blockhash, this does
    // not perform a second RPC operation after the evidence write succeeds.
    // sample() is lease-gated and minute-throttled, so duplicate invocations
    // are harmless and cannot create duplicate settlement rows.
    if (action === 'heartbeat') {
      // Housekeeping rides the minute heartbeat: one instance per hour wins a
      // lease and deletes a bounded batch of expired KV rows (Postgres never
      // removes them on its own). Guarded — a missing SQL function or a stub
      // backend must never fail the heartbeat that keeps the sampler honest.
      let swept = 0;
      try { if (typeof sweepExpired === 'function') swept = await sweepExpired(); } catch {}
      return res.json({ ok:true, v:VERSION, t:Date.now(), src:prices.src,
        sampled, swept, durable, storage:backend });
    }

    // Expiry moves credits, so it completes before the request continues.
    // Fire-and-forget is unsafe on serverless (the function may freeze after
    // the response) and made a refund appear only nondeterministically.
    try { await sweepChallenges(); } catch {}

    if (action === 'gauntlet') {
      const wallet = 'demo-' + gauntletHandle;
      const p = await loadPlayer(wallet);
      const changed = await settle(p, prices);
      if (p._existed || changed || p._drained > 0 || p._drained7 > 0 || p._drainedSelf7 > 0)
        await savePlayer(p);
      const history = ((await getCached('hist:' + wallet, 10_000)) || []).slice(0, 200);
      const latestScored = history.find(row => row
        && (row.res === 'hit' || row.res === 'miss')
        && row.sp !== null && row.sp !== undefined && row.sp !== ''
        && Number.isFinite(Number(row.sp)));
      let closed = p.closed || [];
      if (latestScored && latestScored.id) {
        try {
          // appendOnce persists this receipt atomically with the seal entry.
          // It is an exact O(1) pointer to the hash-chain timestamp, including
          // for older shots whose player object did not retain a createdAt.
          const seal = await getJSONStrict(
            `g:log:once:seal:${wallet}:${latestScored.id}`);
          if (seal && Number.isFinite(Number(seal.t))) {
            closed = closed.map(shot => shot && shot.id === latestScored.id
              ? { ...shot, sealedAt:Number(seal.t), sealLogIndex:Number(seal.i) || null }
              : shot);
          }
        } catch {}
      }
      // Gauntlet progress is a projection, not the raw player object. Give the
      // projector the retained closed shots so it can join compact history
      // rows to their real seal/expiry/oracle evidence without exposing salt,
      // side or any other hidden shot field in the response.
      const state = { player:{
        ...brierOf(p), open:p.open || [], closed, history,
      } };
      res.setHeader('cache-control', 'no-store');
      return res.json({ ok:true, v:VERSION, gauntlet: await publicSpecAsync(),
        progress:progressFromState(state, gauntletHandle),
        derivedFrom:'canonical game state for ' + wallet });
    }

    if (action === 'state') {
      // The daily cron lands here at 00:05 UTC, which is exactly when the
      // previous day has just closed and its buckets are freshest. Rolling
      // the observatory's history from the same tick that rolls the pots
      // means the record survives even if nobody ever opens /api/feeds.
      try { await ensureRollups(); } catch {}
      await rolloverPots();
      await ensureAllTimeBoard();
      let podNow = null;
      try { podNow = await refreshLivePodium(); } catch {}
      const wardenRec = await wardenTick(prices);
      const fleet = await agentsTick(prices);
      if (!podNow) podNow = (await getJSONStrict('g:podium')) || { period:today(), list: [] };
      const wRaw = req.query.wallet;
      const w = (typeof wRaw === 'string' && (isWalletShaped(wRaw) || isDemo(wRaw))) ? wRaw : null;
      let player = null;
      if (w) {
        const p = await loadPlayer(w);
        const changed = await settle(p, prices);
        if (changed) podNow = (await getJSONStrict('g:podium')) || podNow;
        // Only persist players that already exist or actually changed —
        // a bare state?wallet=<anything> must not mint KV records.
        if (p._existed || changed || p._drained > 0 || p._drained7 > 0 || p._drainedSelf7 > 0) await savePlayer(p);
        // BLINK AUTO-CREDIT. Bounded to one discovery scan per wallet/30s;
        // explicit anchor submissions are never delayed by this convenience.
          if (!isDemo(w) && Date.now() - (AUTO_ANCHOR_SCAN.get(w) || 0) >= 30_000) {
            AUTO_ANCHOR_SCAN.set(w, Date.now());
            if (AUTO_ANCHOR_SCAN.size > 5000) AUTO_ANCHOR_SCAN.clear();
            try {
              const { rpcCall, getTx } = require('../lib/burn.js');
              const { decideAnchor } = require('../lib/log.js');
              const sigs = await rpcCall('getSignaturesForAddress', [w, { limit: 5 }]);
              if (Array.isArray(sigs) && sigs.length) {
                const heads = (await getJSON('g:log:heads')) || {};
                for (const s of sigs) {
                  if (s.err) continue;
                  const sig = s.signature;
                  if (await getJSONStrict('sig:'+sig)) continue;
                  const tx = await getTx(sig);
                  if (!tx) continue;
                  const d = decideAnchor(tx, { wallet: w, heads });
                  if (d.ok) {
                    const claimed = await claimAnchor(w, sig, d);
                    if (!claimed.ok) continue;
                    // Use the exact same cooldown as the explicit anchor path.
                    // Two independent cooldowns allowed one Blink reward plus
                    // one site reward per day. `best` is best STREAK, not XP.
                    const paidXp = await setnxJSON(`anch:${w}`, { t: Date.now() }, 86400) ? 25 : 0;
                    if (paidXp) {
                      p.xp += paidXp;
                      await bumpLadder(w, paidXp, p.qualified);
                    }
                    // One log entry per signature, even across a crash-retry. (h70)
                    await appendOnce(`anchor:${sig}`, { k:'anchor', w, i: d.i, sig, xp: paidXp });
                    await bumpFeed({ w: shortW(w), actorWallet:w, a: `ANCHORED the log via Blink · entry #${d.i}${paidXp ? ' · +25 XP' : ''}`, c:'hit', sig });
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
        player.open = (p.open || []).map(({ side, salt, xp, sp, ...rest }) => rest);
        delete player._existed; delete player._src;
        // CALIBRATION IS PUBLIC, LIKE EVERYTHING ELSE THAT SETTLED.
        // brierIndex is (1 - sqrt(brier)) * 100: 100 = clairvoyant, 50 = the
        // score of always saying 50%, 0 = maximally confident and wrong.
        Object.assign(player, brierOf(p));
        player.history = ((await getCached(`hist:${w}`, 10_000)) || []).slice(0, 200);
        player.qualified = !!p.qualified;
        // CHAMPION CONSOLE: live seat/share, separate RCX receipts and balance.
        let changed2 = false;
        const seat = (podNow.list || []).find(x => x.w === w);
        // A wallet can qualify once by verifiable participation, including an
        // RCX balance. Qualification prevents free-key Sybil farming; podium
        // order itself is live daily XP and has no continuing hold/sell test.
        // An unreadable balance RPC never demotes anyone.
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
          const received7 = champWindowSum(p.champ7, Date.now(), CHAMP.receiptDays);
          const retained7 = champWindowSum(p.champSelf7, Date.now(), CHAMP.receiptDays);
          const champHistory = ((await getCached(`chist:${w}`, 10_000)) || []).slice(0, 100);
          if (seat || received7 || retained7 || champHistory.length) {
            const known = Number.isFinite(cb.bal);
            player.champion = { active:!!seat, pct:seat ? seat.pct : 0, source:seat ? seat.source : null,
              received7:Math.floor(received7), retained7:Math.floor(retained7),
              total7:Math.floor(received7 + retained7), history:champHistory,
              bal:known ? Math.floor(cb.bal) : null,
              balStale:!known || !!cb.stale };
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
      await warmLadderMigrations([['lb:', seasonKey()], ['lbd:', today()], ['lba:', 'all']]);
      const [st, lbRows, dayRanked, allRanked] = await Promise.all([
        sharedRead('display:stats', 5_000, () => loadStats()),
        sharedRead('display:lb:' + seasonKey(), 8_000, () => ladderTop('lb:', seasonKey())),
        sharedRead('display:lbd:' + today(), 8_000, () => ladderTop('lbd:', today())),
        sharedRead('display:lba', 8_000, () => ladderTop('lba:', 'all')),
      ]);
      const ladder = lbRows.slice(0,20).map(([wl,xp])=>({ w: shortW(wl), xp, me: wl===w }));
      const ladderDay = dayRanked.slice(0,10).map(([wl,xp])=>({ w: shortW(wl), xp, me: wl===w }));
      const ladderAll = allRanked.slice(0,20).map(([wl,xp])=>({ w:shortW(wl), xp, me:wl===w }));
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
      const [playerFeed, warden, wardenPrev, wardenHist, mcap, tokenProgram,
        lastSeason, lastDay, logHead] = await Promise.all([
        require('../lib/activity_feed.js').readFeed(), wardenLine(prices),
        getCached('g:warden:rec:prev', 60_000), getCached('g:warden:hist', 15_000),
        getMcap(), getMintProgram(), getCached('g:seasonResults', 30_000),
        getCached('g:dayResults', 30_000), getCached('g:log:head', 10_000),
      ]);
      const feed = await require('../lib/activity_agents.js').combine(playerFeed);
      return res.json({ ok:true, v: VERSION, durable, storage:backend,
        truthPlane: {
          canonicalSettlement: 'ratchet-server',
          oracleInput: 'pyth-price-update-v2-accounts-read-from-solana',
          rule: SETTLE_RULE,
          onchainSeal: MIRROR_ENABLED ? 'optional-mainnet-beta' : 'disabled',
        },
        // Every finite price, not a hand-written list of seven. The list was
        // silently authoritative: a feed missing from it was priced on the
        // board, offered as a target and then rendered with a blank level,
        // because the card reads its number from here.
        prices:{src:prices.src,degraded:prices.degraded||null,ages:prices.ages||null,
          // Stocks come from a different road than crypto, so they get their own
          // two words: which host answered, or why none did. A missing stock
          // target must be readable as a fact, not inferred from a short menu.
          equitySrc:prices.equitySrc||null, equityOff:prices.equityOff||null,
          ...Object.fromEntries(Object.entries(prices).filter(([, x]) => Number.isFinite(x)))},
        // House Fleet stays in Arena/log. Actual registered agents and proven
        // demo attempts are visible, with separate demo retention and labels.
        stats: st, feed: (feed || []).filter(x => !x.agent), ladder, ladderDay,
        warden, wardenRec,
        wardenModel: WARDEN_MODEL,
        wardenPrev, agents: fleet,
        wardenHist: wardenHist || [],
        boardModel: BOARD_MODEL,
        targets: Object.fromEntries(Object.entries(targetBoard(boardHour()))
          .filter(([,t]) => targetSealReady(prices, t))),
        boardFlip: (boardHour() + 1) * 3600e3,
        split: SPLIT, potSplit: { day: POT_DAY_SHARE, week: 1 - POT_DAY_SHARE },
        prizes: { day: PRIZE_D, week: PRIZE_W },
        dayEnds: Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1),
        stakeRule: { min: STAKE_MIN, max: STAKE_MAX, presets: Object.keys(STAKES).map(Number), hitPayout: HIT_PAYOUT, xpMultCap: XP_MULT_CAP, xpCapAt: XP_CAP_AT, streakStep: STREAK_STEP, streakCap: STREAK_CAP, settleXp: SETTLE_XP },
        champ: { pct:CHAMP.pct, curve:CHAMP.curve, receiptDays:CHAMP.receiptDays,
          seatRule:CHAMP.seatRule, snapshot:podNow.id || null,
          signingGraceSec:Math.floor(CHAMP.signingGraceMs/1000),
          // `owner` is full so the page can derive an ATA; source says whether
          // the seat is live today or inherited while today's board fills.
          podium: (podNow.list || []).map(x => ({ w:shortW(x.w), owner:x.w, ata:x.ata,
            pct:x.pct, xp:x.xp, source:x.source || 'previous' })) },
        season: seasonKey(), day: today(), ladderAll,
        mint: MINT || null, incinerator: MINT ? INCINERATOR : null, mcap,
        tokenProgram,
        mirror: { enabled: MIRROR_ENABLED, version: process.env.RATCHET_SEAL_VERSION || 'seal-v3', mode:'optional-seal',
          programId: MIRROR_ENABLED ? MIRROR_PROGRAM_ID : null,
          cluster: MIRROR_ENABLED ? MIRROR_CLUSTER : null, feeds: MIRROR_ENABLED ? [...MIRROR_FEEDS] : [] },
        lastSeason,
        lastDay,
        log: logHead || null, player });
    }

    if (action === 'shot' || action === 'duel') {
      const b = req.body || {};
      const w = b.auth && b.auth.wallet;
      if (!w || typeof w !== 'string') return res.status(400).json({ ok:false, reason:'no wallet' });
      const verifiedRanked = action === 'shot' && rankedAuth.isVerifiedRequest(req, b);
      const verifiedSession = action === 'shot' && sessionGame.isVerifiedRequest(req,b);
      if (!isDemo(w) && !verifiedRanked && !verifiedSession) {
        const v = verifyAuth(b.auth);
        if (!v.ok) return res.status(401).json({ ok:false, reason:v.reason });
      }
      const p = await loadPlayer(w);
      if(verifiedSession && (!p._existed || !sessionHttp.admitted(p,w)))
        return res.status(403).json({ok:false,code:'AGENT_ADMISSION_REQUIRED'});
      await settle(p, prices);
      const requestId = verifiedRanked || verifiedSession ? String(b.requestId) : null;
      if (requestId) {
        const prior = [...(p.open || []), ...(p.closed || []), ...(p.history || [])]
          .find(row => row && row.requestId === requestId);
        if (prior) {
          await savePlayer(p);
          return res.json({ ok:true, shot:prior, cr:p.cr, idempotent:true });
        }
      }
      const cap = Math.min(4, rankOf(p.xp)+1) + 1;
      if (p.open.length >= cap) { await savePlayer(p); return res.status(409).json({ ok:false, code:'CHAMBERS_FULL', reason:`all ${cap} chambers full` }); }
      const stake = +b.stake;

      // ---- validate EVERYTHING before any money moves. The previous
      // hour's board stays valid as a grace window, so a click that
      // lands just after the hourly flip still seals.
      let spec = null, duelLine = null;
      if (action === 'shot') {
        const board = { ...targetBoard(boardHour() - 1), ...targetBoard(boardHour()) };
        const t = board[b.target];
        if (!t || (b.side!=='YES' && b.side!=='NO')) { await savePlayer(p); return res.status(400).json({ ok:false, code:'TARGET_UNAVAILABLE', reason:'that question left the board - pick from the current mix' }); }
        if (!Number.isFinite(prices[t.feed]) || (t.feed2 && !Number.isFinite(prices[t.feed2]))) { await savePlayer(p); return res.status(409).json({ ok:false, code:'FEED_UNAVAILABLE', reason:'that feed is offline right now - try another target' }); }
        // refuse to seal against a print that is stale relative to the window
        const ages = prices.ages || {};
        const lim = maxSealAge(t.mins);
        const stale = [t.feed, t.feed2].filter(Boolean)
          .map(f => ({ f, a:ages[f] }))
          .find(x => !Number.isFinite(x.a) || x.a < 0 || x.a > lim);
        if (stale) { await savePlayer(p); return res.status(409).json({ ok:false, code:'ORACLE_STALE',
          reason: Number.isFinite(stale.a)
            ? `the oracle's last ${stale.f} print is ${stale.a}s old and this window needs one under ${lim}s — the feed updates on a 60s heartbeat or a 0.5% move, so try again in a moment`
            : `the oracle did not expose a verified publish age for ${stale.f} — no credits were debited` }); }
        spec = t;
      } else {
        if (b.side!=='with' && b.side!=='against') { await savePlayer(p); return res.status(400).json({ ok:false, reason:'bad side' }); }
        // Validate the Warden before touching credits or global counters.
        // Previously an empty line returned after takeStake(), inflating the
        // 70/30 totals even though no shot was ever created.
        duelLine = await wardenLine(prices);
        if (duelLine.p == null || !Number.isFinite(duelLine.thresh)) {
          await savePlayer(p);
          return res.status(400).json({ ok:false, reason:'the Warden has no line this hour — not enough price history to measure volatility' });
        }
      }

      // STATED PROBABILITY (optional): the player's confidence that their OWN
      // side wins, 0.01-0.99. It powers the Brier / calibration record and
      // changes no payout, no XP, no rule. It is sealed with the shot — hidden
      // like side and salt until settlement, then published in the reveal so a
      // stated number can never be edited after the fact.
      let sp = null;
      if (b.p !== undefined && b.p !== null && b.p !== '') {
        sp = Number(b.p);
        if (!Number.isFinite(sp) || sp < 0.01 || sp > 0.99) {
          await savePlayer(p);
          return res.status(400).json({ ok:false, code:'INVALID_PROBABILITY',
            reason:'stated probability p must be a number from 0.01 to 0.99 — your confidence that your own side wins' });
        }
        sp = Math.round(sp * 100) / 100;
      }

      const requiredFeeds = action === 'shot'
        ? [spec.feed, spec.feed2].filter(Boolean) : [duelLine.feed];
      const uncertain = requiredFeeds.map(f => ({
        feed:f, confidenceBps:(prices.confs || {})[f],
      })).find(row => Number.isFinite(row.confidenceBps)
        && row.confidenceBps > PX_MAX_CONF_BPS);
      if (uncertain) {
        await savePlayer(p);
        return res.status(409).json({ ok:false, code:'ORACLE_CONFIDENCE_TOO_WIDE',
          reason:`the Pyth confidence interval for ${uncertain.feed} is ${uncertain.confidenceBps}bps; ranked sealing requires ${PX_MAX_CONF_BPS}bps or less — no credits were debited` });
      }
      const readinessMins = action === 'shot' ? spec.mins : duelLine.mins;
      const crossingReady = requiredFeeds.every(f => feedSealReady(prices, f, readinessMins));
      if (!crossingReady) {
        await savePlayer(p);
        // Definite pre-debit refusal, not an uncertain server failure. The
        // session wrapper terminalizes recognized 4xx codes; a 5xx here would
        // strand a reserved attempt until owner-signed recovery.
        return res.status(409).json({ ok:false, code:'FEED_UNAVAILABLE',
          reason:'new shots pause until the on-chain Pyth feed exposes a verifiable publish-time crossing — fallback quotes remain display-only' });
      }

      const err = await takeStake(p, stake, true);
      if (err) { await savePlayer(p); return res.status(400).json({ ok:false, ...err }); }

      let shot;
      const oracleSeal = oracleSealSnapshot(prices, requiredFeeds);
      if (action === 'shot') {
        const t = spec;
        const kind = t.kind || 'dir';
        const xpMult = b.side === 'YES' ? (t.yesMult != null ? t.yesMult : 1)
                                        : (t.noMult != null ? t.noMult : 1);
        shot = { id: newShotId(),
          kind, feed:t.feed, side:b.side,
          entry: prices[t.feed], entryAge: (prices.ages || {})[t.feed], oracleSrc: prices.src,
          exp: Date.now()+t.mins*60e3, stake, settleRule:SETTLE_RULE,
          outcomeRule:OUTCOME_RULE, allocationRule:'on-settle-v2', sealAccountingV:2,
          economyRule:'credits-at-valid-oracle-seal-v1',
          economyMode:isDemo(w) ? 'demo' : 'ranked', oracleSeal,
          xp: xpMult === 1 ? coreRules.sealXp(t.baseXp, stake) : Math.max(1, Math.round(t.baseXp * stakeMult(stake) * xpMult)), label: t.label };
        if (kind === 'thr') shot.thresh = prices[t.feed] * (1 + t.pct);
        if (kind === 'thrDown') shot.thresh = prices[t.feed] * (1 - t.pct);
        if (kind === 'range') shot.pct = t.pct;
        if (kind === 'race') { shot.feed2 = t.feed2; shot.entry2 = prices[t.feed2]; }
      } else {
        const wl = duelLine;
        const withW = b.side === 'with';
        shot = { id: newShotId(), kind:'thr', feed:wl.feed, thresh:wl.thresh,
          side: withW ? (wl.p >= 50 ? 'YES':'NO') : (wl.p >= 50 ? 'NO':'YES'),
          entry: prices[wl.feed], oracleSrc: prices.src, exp: Date.now()+wl.mins*60e3, stake,
          settleRule:SETTLE_RULE, outcomeRule:OUTCOME_RULE,
          allocationRule:'on-settle-v2', sealAccountingV:2,
          economyRule:'credits-at-valid-oracle-seal-v1',
          economyMode:isDemo(w) ? 'demo' : 'ranked', oracleSeal,
          xp: Math.max(1, Math.round(14 * stakeMult(stake) * (withW ? 0.8 : 3.4))), label: 'DUEL vs the Warden: '+wl.q, duel:true };
      }
      if (SALT_RE.test(String(b.salt || '')) && SALT_NONCE_RE.test(String(b.saltNonce || ''))) {
        shot.salt = String(b.salt);
        shot.saltNonce = String(b.saltNonce);   // public: it is half of the recipe, useless without the wallet
        shot.saltV = 'wallet-seed-v1';
      } else {
        shot.salt = crypto.randomBytes(16).toString('hex');
      }
      shot.commitV = 2;
      shot.commit = shotCommit(w, shot.id, shot.side, shot.salt);
      if (requestId) shot.requestId = requestId;
      if (sp != null) shot.sp = sp;
      shot.src = p._src || 'bal'; delete p._src;
      p.open.unshift(shot);
      await savePlayer(p,verifiedSession?[await sessionGame.acceptanceExtra(req,shot)]:[]);
      await recordSealedShot(shot, w);
      // Crowd odds: count the sealed SIDE per board target, aggregate only —
      // bucketed by ten-minute window. A LIVE counter would leak: the public
      // feed announces who just sealed, so a +1 on YES the same second would
      // deanonymize that one commit. Buckets publish only after they close
      // (see the board handler), so sealed means sealed even in aggregate.
      if (action === 'shot') await hincr(`odds:${boardHour()}`,
        `${Math.floor(Date.now() / 600e3)}:${b.target}:${shot.side}`, 1).catch(() => {});
      if (!isDemo(w)) await bumpFeed({ id:`seal:${w}:${shot.id}`, actorWallet:w,
        w: shortW(w), a: `sealed a shot - ${stake} credits`, c:'seal' });
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
          outcomeRule: c.outcomeRule || 'dead-zone-4bp-v1',
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

      const lease = await challengeLease();
      if (!lease) return res.status(409).json({ ok:false, reason:'the challenge board is updating — retry' });
      try {
        const expectedBoard = await getJSONStrict('g:chal');
        const list = (expectedBoard || []).filter(c => c && c.expiresAt > Date.now());
        if (list.length >= CHAL_MAX_OPEN) return res.status(429).json({ ok:false, reason:'the challenge board is full — take one instead' });
        if (list.some(c => c.by === w)) return res.status(409).json({ ok:false, reason:'you already have a challenge waiting — one at a time' });

        const p = await loadPlayer(w);
        const cap = Math.min(4, rankOf(p.xp)+1) + 1;
        if (p.open.length >= cap) { await savePlayer(p); return res.status(409).json({ ok:false, reason:`all ${cap} chambers full` }); }
        const bad = await takeStake(p, stake);          // held now; not a shot until accepted
        if (bad) { await savePlayer(p); return res.status(400).json({ ok:false, reason: bad }); }

        const label = kind === 'dir' ? `${feed} higher in ${winTxt(mins)}`
          : kind === 'thr' ? `${feed} up +${(pct*100).toFixed(2)}% after ${winTxt(mins)}`
          : `${feed} down -${(pct*100).toFixed(2)}% after ${winTxt(mins)}`;
        const c = { id: 'c' + crypto.randomBytes(5).toString('hex'), by: w, kind, feed, mins,
          pct: kind === 'dir' ? null : pct, side, stake, label,
          createdAt: Date.now(), expiresAt: Date.now() + CHAL_OPEN_MS,
          allocationRule:'on-settle-v2', outcomeRule:OUTCOME_RULE };
        await playerWrites.save([p], [{key:'g:chal', expected:expectedBoard,
          value:[c,...(expectedBoard || [])]}]);
        await appendOnce(`chal:${c.id}`, { k:'chal', id: c.id, by: w, label, side, stake, mins });
        await bumpFeed({ id:`chal:${c.id}`, w: shortW(w), actorWallet:w,
          a: `challenges the room: ${label} - ${side}`, c: 'seal' });
        return res.json({ ok:true, challenge: { ...c, by: shortW(w) },
          note: 'the level is struck when someone accepts, not now' });
      } finally {
        try { await releaseLease('lock:g:chal', lease); } catch {}
      }
    }

    // ---- take the other side ----
    if (action === 'accept') {
      const b = req.body || {};
      const w = b.auth && b.auth.wallet;
      if (!w || isDemo(w)) return res.status(400).json({ ok:false, reason:'challenges need a real wallet' });
      const v = verifyAuth(b.auth);
      if (!v.ok) return res.status(401).json({ ok:false, reason:v.reason });

      const id = String(b.id || '');
      const peek = ((await getJSONStrict('g:chal')) || []).filter(c => c && c.expiresAt > Date.now());
      const c0 = peek.find(x => x.id === id);
      if (!c0) return res.status(404).json({ ok:false, reason:'that challenge is gone — taken or expired' });
      if (c0.by === w) return res.status(400).json({ ok:false, reason:'you cannot take your own side of your own challenge' });
      // All player locks are acquired before the shared-board lease. Every
      // challenge mutation uses this order, so two wallets cannot deadlock.
      if (!(await acquirePlayerLock(c0.by)))
        return res.status(409).json({ ok:false, reason:'the other side is updating — retry' });
      const lease = await challengeLease();
      if (!lease) return res.status(409).json({ ok:false, reason:'the challenge board is updating — retry' });
      try {
      const expectedBoard = await getJSONStrict('g:chal');
      const list = (expectedBoard || []).filter(c => c && c.expiresAt > Date.now());
      const c = list.find(x => x.id === id);
      if (!c) return res.status(404).json({ ok:false, reason:'that challenge is gone — taken or expired' });
      if (c.by === w) return res.status(400).json({ ok:false, reason:'you cannot take your own side of your own challenge' });
      const px = prices[c.feed];
      if (!Number.isFinite(px)) return res.status(503).json({ ok:false, reason:`${c.feed} is not priced right now` });
      const age = (prices.ages || {})[c.feed];
      const lim = Math.min(60, Math.max(30, 0.15 * c.mins * 60));
      if (!Number.isFinite(age) || age < 0 || age > lim)
        return res.status(503).json({ ok:false, reason:Number.isFinite(age)
          ? `${c.feed} last printed ${age}s ago — too stale to strike a level on`
          : `${c.feed} has no verified publish age — no level was struck` });
      if (!feedSealReady(prices, c.feed, c.mins))
        return res.status(503).json({ ok:false,
          reason:'new challenges pause until the on-chain Pyth feed exposes a verifiable publish-time crossing' });

      const taker = await loadPlayer(w);
      const author = await loadPlayer(c.by);
      const takerCap = Math.min(4, rankOf(taker.xp)+1) + 1;
      const authorCap = Math.min(4, rankOf(author.xp)+1) + 1;
      if (taker.open.length >= takerCap) {
        return res.status(409).json({ ok:false, reason:`your ${takerCap} chambers are full` });
      }
      if (author.open.length >= authorCap) {
        return res.status(409).json({ ok:false, reason:`the author's ${authorCap} chambers are full — retry after one settles` });
      }

      // Legacy replay gates remain respected. New gates are committed WITH
      // both players and board removal, never consumed ahead of the debit.
      if (await getJSONStrict(`chaltaken:${id}`)) {
        return res.status(409).json({ ok:false, reason:'somebody just took it' });
      }

      const bad = await takeStake(taker, c.stake);
      if (bad) {
        // No acceptance gate is written for an underfunded request.
        await savePlayer(taker);
        return res.status(400).json({ ok:false, reason: bad });
      }

      const exp = Date.now() + c.mins * 60e3;
      const xp = chalXp(c.kind, c.mins);
      const mk = (owner, side, srcTag) => {
        const sh = { id: newShotId(), kind: c.kind, feed: c.feed,
          side, entry: px, oracleSrc: prices.src, exp, stake: c.stake,
          xp: coreRules.sealXp(xp, c.stake), label: c.label,
          chal: c.id, src: srcTag, settleRule:SETTLE_RULE,
          outcomeRule:c.outcomeRule || 'dead-zone-4bp-v1',
          allocationRule:c.allocationRule || 'upfront-v1', sealAccountingV:2 };
        if (c.kind === 'thr') sh.thresh = px * (1 + c.pct);
        if (c.kind === 'thrDown') sh.thresh = px * (1 - c.pct);
        sh.salt = crypto.randomBytes(16).toString('hex');
        sh.commitV = 2;
        sh.commit = shotCommit(owner, sh.id, sh.side, sh.salt);
        return sh;
      };
      const takerShot = mk(w, c.side === 'YES' ? 'NO' : 'YES', 'cr');
      taker.open.unshift(takerShot);

      // the author's side, on the author's record
      const authorShot = mk(c.by, c.side, 'cr');
      author.open.unshift(authorShot);
      // One accepted challenge owns three records. Commit them together: a
      // failed request cannot debit the taker while omitting one side, or
      // leave an already-taken offer visible in the room.
      await playerWrites.save([taker, author], [
        {key:'g:chal', expected:expectedBoard, value:(expectedBoard || []).filter(x => x.id !== id)},
        {key:`chaltaken:${id}`, expected:null, value:{w,t:Date.now()}},
      ]);
      await appendOnce(`chaltake:${c.id}`, { k:'chaltake', id: c.id, by: c.by, taker: w, label: c.label,
        entry: px, exp, stake: c.stake });
      await recordSealedShot(authorShot, c.by);
      await recordSealedShot(takerShot, w);
      await bumpFeed({ id:`chaltake:${c.id}`, w: shortW(w), actorWallet:w,
        a: `took ${shortW(c.by)}'s challenge: ${c.label}`, c: 'seal' });
      return res.json({ ok:true, shot: takerShot, against: shortW(c.by),
        struckAt: px, note: 'both sides were struck on this price, at this moment' });
      } finally {
        try { await releaseLease('lock:g:chal', lease); } catch {}
      }
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
      const x402lib = require('../lib/x402.js');
      let x402Entry = null;
      let settleInsideArenaLease = false;
      let claimInsideArenaLease = false;
      const denyUnqualified = () => res.status(403).json({ ok:false,
          reason:'this wallet has not touched RCX yet. Hold or burn some first — an arena anyone can enter for free is a leaderboard of noise',
          // A refusal an autonomous caller cannot act on is a dead end. The
          // sentence above is for a human reading a log; `doors` is the same
          // refusal in a form a program can branch on, and it stays correct
          // whether or not the x402 door is armed.
          doors: [
            { id:'rcx', open:true,
              how:'acquire or burn any amount of $RCX with this wallet, then retry' },
            { id:'x402', open:x402lib.enabled(),
              resource:x402lib.enabled() ? '/api/agent-entry' : null,
              how:x402lib.enabled()
                ? 'POST /api/agent-entry for a payer-bound claim, then retry this signed registration with entryClaim; a direct retry without PAYMENT-SIGNATURE also returns a wallet/name-bound quote'
                : 'not armed on this deployment' },
            { id:'demo', open:true, ranked:false,
              how:'play unranked immediately with a demo wallet — no token, no payment' },
          ],
          see:'/api/game?action=board → arena' });
      if (!p.qualified && !p.x402Entry) {
        // A missing payment header only creates a durable quote; no money can
        // move. A paid retry is deferred until the global arena lease has
        // proved the requested name is free. This prevents the worst possible
        // registration outcome: facilitator settlement followed by "name taken".
        if (b.entryClaim) {
          // A canonical Bazaar payment does not choose an arena name. Consume
          // its payer-bound capability only after the global arena lease has
          // proved this signed wallet's requested name is available.
          claimInsideArenaLease = true;
        } else {
          if (!x402lib.enabled()) return denyUnqualified();
          if (x402lib.paymentHeader(req)) settleInsideArenaLease = true;
          else {
            const gate = await x402lib.entryGate(req, res, { wallet:w, name });
            if (gate === 'responded') return;
            return denyUnqualified();
          }
        }
      }
      // Optional public provenance: if this operational wallet is already
      // linked in Solana Agent Registry / ERC-8004, carry that identity onto
      // the Ratchet record.  This is read-only and deliberately fail-open:
      // indexer availability must never become game availability.  A registry
      // identity proves continuity, not forecasting quality, so it does not
      // qualify entry or affect Brier ranking.
      const priorIdentity = p.agent && p.agent.identity;
      let linkedIdentity = null;
      try {
        const found = await require('../lib/agent_registry.js').lookupAgentByWallet(w);
        if (found.status === 'verified') linkedIdentity = found.identity;
        else if (found.status === 'unavailable') linkedIdentity = priorIdentity || null;
      } catch {
        linkedIdentity = priorIdentity || null;
      }
      // Names and the bounded registry are shared state.  Serialize them so
      // two simultaneous registrations cannot both claim one name or erase
      // one another from the arena list.
      const arenaLease = await acquireLease('lock:g:arena', 30);
      if (!arenaLease) return res.status(409).json({ ok:false, reason:'the arena registry is updating — retry' });
      try {
        let taken = await getJSONStrict(`agentname:${name}`);
        if (taken && taken.w !== w) return res.status(409).json({ ok:false, reason:'that name is taken' });
        if (claimInsideArenaLease) {
          const claim = await x402lib.consumeEntryClaim(b.entryClaim, { wallet:w, name });
          if (!claim || !claim.granted)
            return res.status(claim && claim.status || 403).json({ ok:false,
              reason: claim && claim.reason || 'entryClaim was not accepted',
              doors: [{ id:'rcx', open:true },
                { id:'x402', open:x402lib.enabled(), resource:'/api/agent-entry' }],
              see:'/api/game?action=board → arena' });
          x402Entry = claim;
        } else if (settleInsideArenaLease) {
          const gate = await x402lib.entryGate(req, res, { wallet:w, name });
          if (gate === 'responded') return;
          if (gate && gate.granted) x402Entry = gate;
          else return denyUnqualified();
        }
        if (!taken) {
          const won = await setnxJSON(`agentname:${name}`, { w, t: Date.now() });
          if (!won) {
            taken = await getJSONStrict(`agentname:${name}`);
            if (!taken || taken.w !== w) return res.status(409).json({ ok:false, reason:'that name is taken' });
          }
        }
        const first = !p.agent;
        p.agent = { name, blurb, since: (p.agent && p.agent.since) || Date.now(),
          ...(linkedIdentity ? { identity: linkedIdentity } : {}) };
        if (x402Entry) p.x402Entry = { sig: x402Entry.sig, paidTo: x402Entry.payTo,
          amount: x402Entry.amountAtomic, payer: x402Entry.payer,
          network: x402Entry.network, t: Date.now() };
        await savePlayer(p);
        const reg = (await getJSONStrict('g:arena')) || [];
        if (!reg.includes(w)) { reg.push(w); await setJSON('g:arena', reg.slice(0, 500)); }
        if (first) {
          await append({ k:'agentjoin', w, name });
          await bumpFeed({ w: name, actorWallet:w, a: 'entered THE ARENA', c: 'seal' });
        }
        return res.json({ ok:true, agent: p.agent, admitted: true, qualified: !!p.qualified,
          entry: p.x402Entry ? 'x402-toll-to-champion' : 'rcx',
          x402: p.x402Entry ? { paidTo: p.x402Entry.paidTo, sig: p.x402Entry.sig,
            network: p.x402Entry.network || x402lib.SOLANA_MAINNET } : undefined,
          howToPlay: '/api/game?action=board  then  POST {action:"shot", auth, target, side, stake}' });
      } finally {
        try { await releaseLease('lock:g:arena', arenaLease); } catch {}
      }
    }

    // A machine-readable board: everything an agent needs to make a call,
    // and nothing it would have to scrape out of the page.
    if (action === 'board') {
      const hour = boardHour();
      const board = targetBoard(hour);
      // CROWD ODDS. How the sealed flow split on each target this hour.
      // Information, not a payout curve: the 1.7x is flat either way — the
      // split changes nothing about your shot, it only lets the board read
      // like a market (a price of opinion). Privacy of the individual commit
      // beats freshness of the aggregate, so: only CLOSED ten-minute buckets
      // are summed (a live counter would pin a side on whoever the feed says
      // just sealed), and a target shows nothing under five counted shots.
      const crowdRaw = (await hall(`odds:${hour}`)) || {};
      delKey(`odds:${hour - 2}`).catch(() => {});   // self-cleaning, two keys max
      const nowBucket = Math.floor(Date.now() / 600e3);
      const crowdFor = (id) => {
        let yes = 0, no = 0;
        for (const [f, v] of Object.entries(crowdRaw)) {
          const [bkt, tid, side] = String(f).split(':');
          if (tid !== id || Number(bkt) >= nowBucket) continue;
          if (side === 'YES') yes += Number(v) || 0;
          if (side === 'NO') no += Number(v) || 0;
        }
        const n = yes + no;
        return n >= 5 ? { n, pctYes: Math.round(yes / n * 20) * 5, lagMin: 10 } : null;
      };
      // Machine-readable arena advertisement. Everything here is already true
      // elsewhere in this file; the point is that an agent no longer has to
      // guess it, and that the toll's recipient is named rather than implied.
      const x402lib = require('../lib/x402.js');
      const x402On = x402lib.enabled();
      let champion = null;
      if (x402On) { try { champion = await x402lib.championWallet(getJSONStrict); } catch { } }
      const arena = {
        what: 'a ranked leaderboard scored by Brier, not by profit — a sealed probability, '
          + 'settled by an oracle, recomputable from the public hash-chained log',
        register: { http: 'POST /api/game { action:"agent-register", auth, name, entryClaim? }',
          remoteDemoMcp: 'https://ratchetx.xyz/api/mcp',
          rankedLocalMcpTool: 'ratchet_register_agent', reference: 'agent/ratchet-agent.mjs',
          paidEntryResource: '/api/agent-entry' },
        doors: [
          { id: 'rcx', requires: 'the wallet has held or burned $RCX at least once',
            cost: 'whatever you paid for the token; nothing is paid to us' },
          { id: 'x402', enabled: x402On,
            available: x402On && !!champion,
            requires: 'a standard x402 v2 exact SVM USDC toll, for a wallet that has never touched $RCX',
            protocolStatus: x402On
              ? 'live: funded mainnet settlement and idempotent replay proved; standard v2 facilitator flow'
              : 'standard v2 facilitator flow shipped dark; production arming waits on a funded mainnet smoke',
            protocolVersion: 2,
            requestHeader: 'PAYMENT-SIGNATURE', responseHeaders: ['PAYMENT-REQUIRED','PAYMENT-RESPONSE'],
            amountAtomic: x402On ? String(x402lib.entryAmountAtomic()) : null,
            asset: x402lib.USDC_MINT, network: x402lib.SOLANA_MAINNET,
            payTo: champion,
            payToIs: 'the wallet currently on top of the daily podium — a player, never us; '
              + '0% to the team, resolved and fixed for the lifetime of each durable quote',
            recipientSelection: {
              source: 'g:podium.list[0]',
              primary: 'highest settled XP on the current UTC daily qualified leaderboard',
              fallback: 'previous UTC day #1 only while the current daily leaderboard has no ranked wallet',
              resolvedAt: 'quote issuance',
              fixedForQuoteSeconds: x402lib.QUOTE_SECONDS,
              teamSharePct: 0,
            },
            armingBlocker: x402On ? null : 'funded mainnet facilitator smoke and explicit production configuration',
            unavailableReason: x402On && !champion ? 'no daily champion exists; no recipient can be quoted' : null,
            howTo: 'POST /api/agent-entry for a Bazaar-compatible payer-bound claim, then include entryClaim in the normal signed agent-register request; the direct wallet/name-bound 402 flow also remains supported' },
        ],
        scoring: { metric: 'Brier over calls that carried a stated probability p',
          index: '(1 - sqrt(brier)) * 100 — 100 clairvoyant, 50 is "always says 50%"',
          minCallsToRank: ARENA_MIN_CALLS,
          note: 'no stated probability, no score — a prior is never invented for you' },
        identity: { optional: true, standard: 'Solana Agent Registry / ERC-8004',
          lookup: 'automatic read-only match on the same operational wallet at registration',
          effect: 'public provenance only — it does not qualify entry or affect Ratchet score or rank',
          registry: 'https://solana.com/agent-registry' },
        free: { mode: 'demo', ranked: false,
          how: 'connect https://ratchetx.xyz/api/mcp and play unranked with no install, token or payment' },
        read: { leaderboard: '/api/game?action=arena', corpus: '/api/record?format=ndjson',
          proof: '/api/proof' },
      };
      return res.json({ ok:true, v: VERSION, hour, generator:BOARD_MODEL,
        flipsAt: (hour + 1) * 3600e3,
        prices: { src: prices.src, ages: prices.ages || null,
          equitySrc: prices.equitySrc || null, equityOff: prices.equityOff || null,
          ...Object.fromEntries(Object.entries(prices).filter(([, x]) => Number.isFinite(x))) },
        stakeRule: { min: STAKE_MIN, max: STAKE_MAX, hitPayout: HIT_PAYOUT, xpMultCap: XP_MULT_CAP, xpCapAt: XP_CAP_AT, streakStep: STREAK_STEP, streakCap: STREAK_CAP, settleXp: SETTLE_XP },
        // Token facts as data, not prose: agents that refuse to repeat an
        // unverified contract address can cite this field and the mint URL.
        token: MINT ? { symbol:'RCX', mint:MINT, chain:'solana:mainnet', standard:'Token-2022',
          launch:'pump.fun', launchUrl:'https://pump.fun/coin/'+MINT,
          explorerUrl:'https://solscan.io/token/'+MINT, source:'https://ratchetx.xyz/api/game?action=board' } : null,
        rankedEconomy: {
          oracleRead:'shared Pyth context is read-only and never consumes RCX',
          stakeUnit:'Ratchet play credits',
          debitAt:'only after target, signature and fresh fully validated Pyth seal all pass',
          settlement:'HIT/MISS finalizes the stake; VOID returns the full credit stake',
          rcxRole:'RCX is the ranked reload rail, not an oracle access fee',
          reload:'verified RCX reloads credit play-rights 1:1 and route 70% to destruction, 30% directly to the live champion podium, 0% to RatchetX',
          perShotTransaction:false,
        },
        sealRule: 'entry price must be fresher than min(60, max(30, 0.15 * windowSeconds)) seconds',
        settleRule: 'the first fully validated Pyth account transition observed with publish_time >= expiry; no valid transition observed inside 15 minutes voids and refunds',
        settlementEvidence: {
          canonicalAuthority: 'ratchet-server',
          oracleInput: 'Pyth PriceUpdateV2 sponsored accounts read from Solana',
          publicReplay: 'the public path reproduces the exact transition Ratchet captured and selected',
          independentPythReplay: false,
          limitation: 'the public server-capture path cannot prove Ratchet did not omit an earlier qualifying Pyth update outside that capture',
          optionalOnchainSeal: 'SOL-only beta reads Pyth in the program; it does not replace canonical server settlement during the soak period',
          proof: '/api/proof',
        },
        tieRule: 'strict numerical comparison; only true equality voids and refunds — there is no economic dead zone',
        crowdRule: 'aggregated sealed-side split per target, published only for closed 10-minute buckets and only from 5 shots up, percentage rounded to 5 — sealed means sealed even in aggregate; information only, the payout stays flat',
        // The board is the first call any agent makes, and until now it did not
        // mention that a ranked arena exists. An agent could only discover the
        // arena by already knowing to POST agent-register and reading the
        // refusal. An invitation nobody can find is not an invitation, so the
        // doors, the toll, its recipient and the credential are stated here.
        arena,
        gauntlet: await publicSpecAsync(),
        // Advertise only targets that pass the same source, age, confidence and
        // crossing-metadata predicate the final economic boundary enforces.
        // Coinbase may still keep the display alive; it can never look playable.
        targets: Object.entries(board)
          .filter(([, t]) => targetSealReady(prices, t))
          .map(([id, t]) => ({
          id, kind: t.kind || 'dir', feed: t.feed, feed2: t.feed2 || null,
          mins: t.mins, pct: t.pct || null, baseXp: t.baseXp,
          yesMult: t.yesMult != null ? t.yesMult : 1,
          noMult: t.noMult != null ? t.noMult : 1,
          label: t.label,
          crowd: crowdFor(id),
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
        // THE BRIER SCORE IS REAL NOW.
        //
        // Its predecessor was a constant-0.25 fake over a flat 50% prior and
        // was removed for being decoration. The rule that replaced it: a
        // Brier score exists ONLY over calls that carried a stated
        // probability (the optional `p` on a shot), scored (p - outcome)^2
        // against the agent's own side at settlement, published in the
        // reveal, recomputable from the hash-chained log. No stated
        // probability, no score — never a made-up prior. brierIndex is the
        // Forecasting Research Institute's consumer scale:
        // (1 - sqrt(brier)) * 100, where 50 is "always says 50%".
        const bn = ap.bn || 0;
        const bmean = bn ? (ap.bsum || 0) / bn : null;
        const ranked = bn >= ARENA_MIN_CALLS;
        rows.push({ name: ap.agent.name, blurb: ap.agent.blurb || '',
          identity: ap.agent.identity || null,
          since: ap.agent.since, w: shortW(aw), n, hits,
          acc: n ? +(hits / n * 100).toFixed(1) : null,
          stated: bn,
          brier: ranked ? +bmean.toFixed(4) : null,
          brierIndex: ranked ? Math.round((1 - Math.sqrt(bmean)) * 100) : null,
          brierWhy: ranked ? undefined : (bn
            ? `a Brier ranking needs ${ARENA_MIN_CALLS} stated-probability calls; this agent has ${bn}`
            : 'no stated probabilities yet — pass p (0.01-0.99) on your shots to build a calibration record'),
          xp: ap.xp || 0, streak: ap.streak || 0,
          // The public contract says this is a Brier leaderboard. A settled
          // side with no stated probability is still part of the accuracy
          // record, but it is not a Brier observation and cannot qualify an
          // agent for this ranking.
          listed: ranked });
      }
      rows.sort((a, b) => (b.listed - a.listed)
        || ((a.brier ?? Infinity) - (b.brier ?? Infinity))
        || ((b.acc || 0) - (a.acc || 0)) || (b.n - a.n));
      return res.json({ ok:true, v: VERSION, minCalls: ARENA_MIN_CALLS,
        note: `an agent is ranked after ${ARENA_MIN_CALLS} settled calls with a stated probability — before that its record is published but unranked, because a 3-for-3 streak is not evidence`,
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
      if (turnOn) await bumpFeed({ w: shortW(w), actorWallet:w, a: 'joined the STAKERS · holding pays daily', c: 'seal' });
      return res.json({ ok: true, on: turnOn });
    }

    if (action === 'reload_build') {
      if (!MINT) return res.status(400).json({ ok:false, reason:'token not launched yet - paper mode only' });
      const b = req.body || {};
      const w = b.wallet || req.query.wallet;
      if (!w) return res.status(400).json({ ok:false, reason:'wallet address required' });
      
      const solAmount = Number(b.solAmount || req.query.solAmount);
      if (!solAmount || solAmount <= 0) return res.status(400).json({ ok:false, reason:'valid solAmount required' });
      
      const slippage = Number(b.slippage || req.query.slippage || 0.05);

      try {
        const { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, AddressLookupTableAccount, TransactionInstruction } = require('@solana/web3.js');
        const ATA_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
        
        const playerPubkey = new PublicKey(w);
        const mintPubkey = new PublicKey(MINT);
        const incinPubkey = new PublicKey(INCINERATOR);
        const tokenProgramId = new PublicKey(await getMintProgram() || 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
        
        const userAta = PublicKey.findProgramAddressSync([playerPubkey.toBuffer(), tokenProgramId.toBuffer(), mintPubkey.toBuffer()], ATA_PROGRAM_ID)[0];
        const incinAta = PublicKey.findProgramAddressSync([incinPubkey.toBuffer(), tokenProgramId.toBuffer(), mintPubkey.toBuffer()], ATA_PROGRAM_ID)[0];
        
        const solInLamports = Math.floor(solAmount * 1e9);
        
        // Fetch player's SOL balance and verify sufficient funds
        const balanceRes = await rpcCall('getBalance', [w]);
        const balance = (balanceRes && Number(balanceRes.value)) || 0;
        if (balance < solInLamports + 5000) {
          return res.status(200).json({ ok: false, reason: `Insufficient SOL balance: you have ${(balance / 1e9).toFixed(5)} SOL, but need ${solAmount} SOL (plus a small fee).` });
        }
        
        // Fetch quote from Jupiter API
        const quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${MINT}&amount=${solInLamports}&slippageBps=${Math.floor(slippage * 10000)}`;
        const quoteRes = await fetch(quoteUrl);
        const quote = await quoteRes.json();
        if (quote.error) throw new Error(quote.error || 'Failed to fetch quote from Jupiter');
        
        const tokensOut = BigInt(quote.outAmount);
        
        // Fetch swap transaction from Jupiter (v0 versioned transaction)
        const swapRes = await fetch('https://api.jup.ag/swap/v1/swap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quoteResponse: quote,
            userPublicKey: w,
            wrapAndUnwrapSol: true
          })
        });
        const swapResult = await swapRes.json();
        if (swapResult.error) throw new Error(swapResult.error || 'Failed to fetch swap transaction from Jupiter');
        
        // Deserialize the versioned transaction returned by Jupiter
        const tx = VersionedTransaction.deserialize(Buffer.from(swapResult.swapTransaction, 'base64'));
        
        // Fetch address lookup table accounts to decompile
        const lookupTableAddresses = tx.message.addressTableLookups.map(l => l.accountKey);
        const lookupTableAccounts = [];
        if (lookupTableAddresses.length > 0) {
          const tableKeys = lookupTableAddresses.map(k => k.toBase58());
          const getTables = await rpcCall('getMultipleAccounts', [tableKeys, { encoding: 'base64' }]);
          if (getTables && getTables.value) {
            for (let i = 0; i < lookupTableAddresses.length; i++) {
              const info = getTables.value[i];
              if (!info || !info.data || !Array.isArray(info.data)) continue;
              const data = Buffer.from(info.data[0], 'base64');
              lookupTableAccounts.push(new AddressLookupTableAccount({
                key: lookupTableAddresses[i],
                state: AddressLookupTableAccount.deserialize(data)
              }));
            }
          }
        }
        
        // Decompile the versioned message into a TransactionMessage
        const decompiled = TransactionMessage.decompile(tx.message, {
          addressLookupTableAccounts: lookupTableAccounts
        });
        
        // Add idempotent ATA creation for the incinerator (burn destination)
        decompiled.instructions.push(new TransactionInstruction({
          programId: ATA_PROGRAM_ID,
          keys: [
            { pubkey: playerPubkey, isSigner: true, isWritable: true },
            { pubkey: incinAta, isSigner: false, isWritable: true },
            { pubkey: incinPubkey, isSigner: false, isWritable: false },
            { pubkey: mintPubkey, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: tokenProgramId, isSigner: false, isWritable: false },
          ],
          data: Buffer.from([1]), // createIdempotent
        }));
        
        // Split 70% burn and 30% podium
        const burnAmt = (tokensOut * 70n) / 100n;
        
        // Transfer 70% to incinerator
        const transferData = Buffer.alloc(9);
        transferData.writeUInt8(3, 0); // Transfer instruction index
        transferData.writeBigUInt64LE(burnAmt, 1);
        
        decompiled.instructions.push(new TransactionInstruction({
          programId: tokenProgramId,
          keys: [
            { pubkey: userAta, isSigner: false, isWritable: true },
            { pubkey: incinAta, isSigner: false, isWritable: true },
            { pubkey: playerPubkey, isSigner: true, isWritable: false },
          ],
          data: transferData,
        }));
        
        // Transfer 30% split to podium seats
        const podiumAmt = tokensOut - burnAmt;
        if (podiumAmt > 0n) {
          const podNow = await refreshLivePodium();
          const cl = (podNow && podNow.list) || [];
          if (cl.length > 0) {
            let distributed = 0n;
            for (let i = 0; i < cl.length; i++) {
              const seat = cl[i];
              if (!seat || !seat.w) continue;
              const sharePct = seat.pct; // e.g. 0.5, 0.3, 0.2
              const seatShare = (podiumAmt * BigInt(Math.floor(sharePct * 1000))) / 1000n;
              if (seatShare > 0n) {
                distributed += seatShare;
                if (seat.w === w) continue;
                const seatPubkey = new PublicKey(seat.w);
                const seatAta = seat.ata ? new PublicKey(seat.ata) : PublicKey.findProgramAddressSync([seatPubkey.toBuffer(), tokenProgramId.toBuffer(), mintPubkey.toBuffer()], ATA_PROGRAM_ID)[0];
                
                // Idempotent ATA creation for champion
                decompiled.instructions.push(new TransactionInstruction({
                  programId: ATA_PROGRAM_ID,
                  keys: [
                    { pubkey: playerPubkey, isSigner: true, isWritable: true },
                    { pubkey: seatAta, isSigner: false, isWritable: true },
                    { pubkey: seatPubkey, isSigner: false, isWritable: false },
                    { pubkey: mintPubkey, isSigner: false, isWritable: false },
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                    { pubkey: tokenProgramId, isSigner: false, isWritable: false },
                  ],
                  data: Buffer.from([1]),
                }));
                
                // Transfer to champion
                const champTransfer = Buffer.alloc(9);
                champTransfer.writeUInt8(3, 0);
                champTransfer.writeBigUInt64LE(seatShare, 1);
                
                decompiled.instructions.push(new TransactionInstruction({
                  programId: tokenProgramId,
                  keys: [
                    { pubkey: userAta, isSigner: false, isWritable: true },
                    { pubkey: seatAta, isSigner: false, isWritable: true },
                    { pubkey: playerPubkey, isSigner: true, isWritable: false },
                  ],
                  data: champTransfer,
                }));
              }
            }
            
            // Leftover dust to incinerator
            const leftover = podiumAmt - distributed;
            if (leftover > 0n) {
              const leftoverTransfer = Buffer.alloc(9);
              leftoverTransfer.writeUInt8(3, 0);
              leftoverTransfer.writeBigUInt64LE(leftover, 1);
              decompiled.instructions.push(new TransactionInstruction({
                programId: tokenProgramId,
                keys: [
                  { pubkey: userAta, isSigner: false, isWritable: true },
                  { pubkey: incinAta, isSigner: false, isWritable: true },
                  { pubkey: playerPubkey, isSigner: true, isWritable: false },
                ],
                data: leftoverTransfer,
              }));
            }
          } else {
            // No podium, burn all 100%
            const allTransfer = Buffer.alloc(9);
            allTransfer.writeUInt8(3, 0);
            allTransfer.writeBigUInt64LE(podiumAmt, 1);
            decompiled.instructions.push(new TransactionInstruction({
              programId: tokenProgramId,
              keys: [
                { pubkey: userAta, isSigner: false, isWritable: true },
                { pubkey: incinAta, isSigner: false, isWritable: true },
                { pubkey: playerPubkey, isSigner: true, isWritable: false },
              ],
              data: allTransfer,
            }));
          }
        }
        
        // Refresh blockhash for a full transaction lifespan
        const getBH = await rpcCall('getLatestBlockhash', [{ commitment:'confirmed' }]);
        if (!getBH || !getBH.value || !getBH.value.blockhash) throw new Error('Failed to get latest blockhash');
        decompiled.recentBlockhash = getBH.value.blockhash;
        
        const newV0Message = decompiled.compileToV0Message(lookupTableAccounts);
        const newTx = new VersionedTransaction(newV0Message);
        
        const serialized = newTx.serialize();
        
        return res.json({
          ok: true,
          tokensOut: tokensOut.toString(),
          maxSolCost: solInLamports.toString(),
          transaction: Buffer.from(serialized).toString('base64'),
        });
      } catch (e) {
        console.error(e);
        return res.status(500).json({ ok: false, reason: String(e.message || e) });
      }
    }

    if (action === 'reload') {
      if (!MINT) return res.status(200).json({ ok:false, reason:'token not launched yet - paper mode only' });
      const b = req.body || {};
      const w = b.auth && b.auth.wallet;
      if (!w || isDemo(w)) return res.status(200).json({ ok:false, reason:'connect a real wallet to reload' });
      const v = verifyAuth(b.auth);
      if (!v.ok) return res.status(200).json({ ok:false, reason:v.reason });
      const sig = String(b.sig || '').trim();
      if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(sig)) return res.status(200).json({ ok:false, reason:'that does not look like a transaction signature' });
      const prior = await getJSONStrict(`sig:${sig}`);
      if (prior) {
        await repairReloadReceipt(sig, prior);
        return res.status(200).json({ ok:false, reason:'that burn was already credited' });
      }
      const tx = await getTx(sig);
      const pod = (await getJSONStrict('g:podium')) || { t:0, list:[] };
      const podHistory = (await getJSONStrict('g:podium:history')) || [];
      const d = decideBurn(tx, { wallet:w, mint:MINT, minAmount:1,
        podiumSets:[pod, ...podHistory], podiumPct:CHAMP.pct });
      if (!d.ok) return res.status(200).json({ ok:false, reason: d.reason });
      const p = await loadPlayer(w);
      // Persist any older queued payout before applying this reload. The new
      // credit deliberately stays in `pend:` until the next player read, so a
      // process death cannot take it out of the queue before saving it.
      await savePlayer(p);
      const credit = Math.floor(d.amount * CREDIT_PER_TOKEN);
      await seedStats();
      const burnAmt = d.burned != null ? d.burned : d.amount;
      const counters = [[`pend:${w}`, credit],
        ...((d.champLegs || []).map(leg => [`c7:${leg.w}`, leg.amt])),
        ...((d.selfRouted || 0) > 0 ? [[`cs7:${w}`, d.selfRouted]] : [])];
      const gate = { v:2, w, amount:d.amount, credit, burned:burnAmt,
        champPaid:d.champPaid || 0, champLegs:d.champLegs || [],
        selfRouted:d.selfRouted || 0, podiumVersion:d.podiumVersion || null, t:Date.now() };
      // Gate + player credits + incoming/retained podium totals + public
      // totals are one Lua operation. Readable receipts repair from `gate`.
      if (!(await applyOnce(`sig:${sig}`, gate, {
        counters, hashKey:STATS,
        deltas:{ realBurned:burnAmt, champPaid:d.champPaid || 0,
          champRetained:d.selfRouted || 0 },
      }))) {
        const winner = await getJSONStrict(`sig:${sig}`);
        await repairReloadReceipt(sig, winner);
        return res.status(200).json({ ok:false, reason:'that burn was already credited' });
      }

      p.burned += burnAmt;
      p.realBurned = (p.realBurned || 0) + burnAmt;
      p.qualified = true;         // you burned RCX: you are in the ladders
      // Metadata is useful but not the money path; if this write fails the
      // atomic queues and totals above remain correct and the reload is safe.
      try { await savePlayer(p); } catch {}
      await repairReloadReceipt(sig, gate);
      return res.json({ ok:true, credited:credit, retained:d.selfRouted || 0,
        podiumPaid:d.champPaid || 0, burned:burnAmt,
        cr:p.cr + credit, pending:true });
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
      if (shot.commitV !== 2) return res.status(400).json({ ok:false,
        reason:'only wallet-and-shot-bound v2 commitments can be sealed on-chain' });
      if (!/^[a-z0-9]{1,32}$/.test(shot.id)) return res.status(400).json({ ok:false,
        reason:'shot id is not canonical for the v2 program' });
      if (!MIRROR_FEEDS.has(String(shot.feed).toUpperCase())) return res.status(400).json({ ok:false,
        reason:`on-chain seal beta is not enabled for ${shot.feed}` });
      const kindMap = { dir:0, thr:1, thrDown:2 };
      if (!(shot.kind in kindMap)) return res.status(400).json({ ok:false,
        reason:`${shot.kind} shots are not supported by the current on-chain program` });
      
      // Anchor instruction discriminator = sha256("global:seal")[..8].
      const disc = Buffer.from("66caaba31b9869f2", "hex");
      // A random u64 prevents PDA collisions between tabs and concurrent shots.
      const nonceBuf = crypto.randomBytes(8);
      
      const commitBuf = Buffer.from(shot.commit, "hex");
      
      const feed = PX_ACCOUNTS[shot.feed];
      if (!feed) return res.status(400).json({ ok:false, reason:'feed not mapped' });
      const feedIdHex = feed[1];
      const shotIdBuf = anchorString(shot.id);
      const feedStrBuf = anchorString(feedIdHex);
      
      const expBuf = Buffer.alloc(8);
      // Browser/game timestamps are milliseconds; the program uses Unix seconds.
      const expiry = Math.floor(shot.exp / 1000);
      if (expiry <= Math.floor(Date.now() / 1000)) return res.status(409).json({ ok:false,
        reason:'this shot has already reached expiry and can no longer be sealed' });
      expBuf.writeBigInt64LE(BigInt(expiry), 0);
      
      const kindByte = Buffer.from([kindMap[shot.kind]]);
      
      const threshBuf = Buffer.alloc(8);
      let thresholdE12;
      try { thresholdE12 = shot.kind === 'dir' ? 0n : priceToE12(shot.thresh); }
      catch { return res.status(400).json({ ok:false, reason:'invalid shot threshold' }); }
      if (shot.kind !== 'dir' && thresholdE12 <= 0n)
        return res.status(400).json({ ok:false, reason:'threshold shot must have a positive threshold' });
      if (thresholdE12 > 9_223_372_036_854_775_807n)
        return res.status(400).json({ ok:false, reason:'threshold exceeds the on-chain i64 range' });
      threshBuf.writeBigInt64LE(thresholdE12, 0);
      
      const data = Buffer.concat([disc, nonceBuf, commitBuf, shotIdBuf, feedStrBuf, expBuf, kindByte, threshBuf]);
      
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
      if (shot.mirrored) {
        if (shot.mirrorSig === sig) return res.json({ ok:true, xp:0, already:true });
        return res.status(409).json({ ok:false, reason:'already mirrored' });
      }
      
      const tx = await getMirrorTx(sig);
      if (tx === undefined) return res.status(503).json({ ok:false, reason:'RPC unreachable' });
      if (!tx || !tx.meta) return res.status(400).json({ ok:false, reason:'tx not found yet' });
      if (tx.meta.err != null) return res.status(400).json({ ok:false, reason:'tx failed' });
      
      const msg = tx.transaction && tx.transaction.message;
      const signedByPlayer = ((msg && msg.accountKeys) || []).some(k => k.signer && k.pubkey === w);
      if (!signedByPlayer) return res.status(400).json({ ok:false, reason:'not signed by you' });

      // Verify the whole instruction, not merely one attractive field.
      const PROGRAM_ID = MIRROR_PROGRAM_ID;
      let seal = null, sealIx = null;
      for (const ix of (msg && msg.instructions) || []) {
        if ((ix.programId === PROGRAM_ID || ix.programId === LEGACY_V2_PROGRAM_ID) && ix.data) {
          try { seal = parseMirrorSeal(b58decode(ix.data)); } catch { seal = null; }
          if (seal) { sealIx = ix; break; }
        }
      }

      if (!seal) return res.status(400).json({ ok:false, reason:'valid seal instruction not found' });
      const feed = PX_ACCOUNTS[shot.feed];
      const accounts = (sealIx && sealIx.accounts) || [];
      if (!feed || accounts.length < 4 || accounts[1] !== w || accounts[2] !== feed[0]
          || accounts[3] !== '11111111111111111111111111111111')
        return res.status(400).json({ ok:false, reason:'seal accounts do not match this shot' });
      const kindMap = { dir:0, thr:1, thrDown:2 };
      let expectedThreshold;
      try { expectedThreshold = shot.kind === 'dir' ? 0n : priceToE12(shot.thresh); }
      catch { return res.status(400).json({ ok:false, reason:'invalid shot threshold' }); }
      if (seal.commit !== shot.commit || seal.shotId !== shot.id || !feed || seal.feed !== feed[1]
          || seal.expiry !== Math.floor(shot.exp / 1000)
          || seal.kind !== kindMap[shot.kind]
          || seal.thresholdE12 !== expectedThreshold)
        return res.status(400).json({ ok:false, reason:'seal terms do not match this shot' });

      // One receipt per shot, not merely per transaction signature. Sealing is
      // proof, not a way to buy ladder position, so it awards no XP.
      const mirrorKey = `mirshot:${w}:${shotId}`;
      if (!(await setnxJSON(mirrorKey, { sig, t: Date.now() }))) {
        const prior = await getJSONStrict(mirrorKey);
        if (!prior || prior.sig !== sig)
          return res.status(409).json({ ok:false, reason:'already credited by another transaction' });
        // Same verified signature after an interrupted response/save: repair the
        // player receipt below instead of trapping the UI in a false failure.
      }
        
      shot.mirrored = true;
      shot.mirrorSig = sig;
      await savePlayer(p);
      await append({ k:'mirror', w, sig, id: shotId, commit: shot.commit });
      return res.json({ ok:true, xp: 0 });
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
      const claimed = await claimAnchor(w, sig, d);
      if (!claimed.ok) return res.status(claimed.busy ? 409 : 409).json({ ok:false,
        reason: claimed.busy ? 'that anchor is being verified — retry' : 'that anchor was already credited' });
      // XP pays at most once per wallet per 24h — anchoring stays open
      // to everyone always; the cooldown just stops memo-spam from being
      // the cheapest XP in the game.
      const paidXp = await setnxJSON(`anch:${w}`, { t: Date.now() }, 86400) ? 25 : 0;
      if (paidXp) {
        const p = await loadPlayer(w);
        p.xp += paidXp; await bumpLadder(w, paidXp, p.qualified);
        await savePlayer(p);
      }
      // One log entry per signature, even across a crash-retry. (h70)
      await appendOnce(`anchor:${sig}`, { k:'anchor', w, i: d.i, sig, xp: paidXp });
      await bumpFeed({ w: shortW(w), actorWallet:w, a: `ANCHORED the log on-chain · entry #${d.i}${paidXp ? ' · +25 XP' : ''}`, c:'hit', sig });
      return res.json({ ok:true, i: d.i, xp: paidXp, note: paidXp ? null : 'anchored - XP pays once per wallet per day' });
    }

    return res.status(400).json({ ok:false, reason:'unknown action' });
  } catch (e) {
    if (['WRITE_CONFLICT','WRITE_LEASE_EXPIRED','CREDIT_QUEUE_CONFLICT'].includes(e.code))
      return res.status(409).json({ok:false,code:e.code,reason:'player state changed; read state before retrying'});
    return res.status(500).json({ ok:false, reason: String(e.message || e) });
  } finally {
    for (const x of heldPlayerLocks.reverse()) {
      try { await releaseLease(x.key, x.token); } catch {}
    }
  }
});
module.exports.champWindowSum = champWindowSum;   // pure, for the test harness
module.exports.refreshLivePodium = refreshLivePodium;
module.exports.parseMirrorSeal = parseMirrorSeal;
