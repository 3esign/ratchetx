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
const { getJSON, getJSONStrict, setJSON, setnxJSON, delKey, scanKeys, durable } = require('../lib/kv.js');
const { verifyAuth, isDemo, isWalletShaped } = require('../lib/verify.js');
const { getPrices } = require('../lib/prices.js');
const { getTx, decideBurn, rpcCall, INCINERATOR } = require('../lib/burn.js');
const { append, decideAnchor } = require('../lib/log.js');
const MINT = process.env.RATCHET_MINT || '';       // set on token day -> real burns go live
const CREDIT_PER_TOKEN = +(process.env.CREDIT_PER_TOKEN || 1);
const VERSION = 'h9-2026-08-20';

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
const STAKES = { 100: 1, 500: 2, 2500: 5 };
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
  SOL5:   { kind: 'dir', feed: 'SOL',  mins: 5,    baseXp: 10, label: 'SOL higher in 5 minutes' },
  PUMP30: { kind: 'dir', feed: 'PUMP', mins: 30,   baseXp: 14, label: 'PUMP higher in 30 minutes' },
  BTC60:  { kind: 'dir', feed: 'BTC',  mins: 60,   baseXp: 16, label: 'BTC higher in 1 hour' },
  ETH24:  { kind: 'dir', feed: 'ETH',  mins: 1440, baseXp: 24, label: 'ETH higher in 24 hours' },
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
// Prize curves. Unclaimed shares ROLL OVER into the next pot of the same cadence.
const PRIZE_W = [0.40, 0.25, 0.15, 0.12, 0.08];   // weekly season: top 5
const PRIZE_D = [0.50, 0.30, 0.20];               // daily pot: top 3
const EPS = 0.0004; // |move| under 4bp = void -> stake refunded, no XP
const FLOOR_BASE = 0.004180;
const STALE_VOID_MS = 24 * 3600e3;  // feed gone 24h past expiry -> auto-void

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
  if (p.day !== today()) p.day = today();
  p._existed = existed;
  return p;
}
async function savePlayer(p) { const q = { ...p }; delete q._existed; delete q._src; await setJSON(`u:${p.w}`, q); }
async function loadStats() {
  const st = (await getJSONStrict('g:stats')) || { burned:0, pot:0, floor:FLOOR_BASE, shots:0 };
  if (st.potD == null) st.potD = 0;
  return st;
}
async function bumpFeed(entry) {
  const f = (await getJSON('g:feed')) || [];
  f.unshift({ t: Date.now(), ...entry });
  await setJSON('g:feed', f.slice(0, 40));
}
// Ranked boards only ever see real, signature-verified wallets.
async function bumpLadder(w, xp) {
  if (isDemo(w)) return;
  for (const k of [`lb:${seasonKey()}`, `lbd:${today()}`]) {
    const lb = (await getJSON(k)) || {};
    lb[w] = (lb[w] || 0) + xp;
    await setJSON(k, lb);
  }
}

// ---- which token program owns the mint (classic vs Token-2022), cached 1h.
// The ATA derivation AND the burn instruction must both use this - guessing
// it wrong yields InvalidAccountData, which is exactly the bug this fixes.
async function getMintProgram() {
  if (!MINT) return null;
  const c = await getJSON('g:mintprog');
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
  const c = await getJSON('g:mcap');
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
async function findAta(owner) {
  const r = await rpcCall('getTokenAccountsByOwner', [owner, { mint: MINT }, { encoding: 'jsonParsed' }]);
  const a = r && r.value && r.value[0];
  if (!a) return null;
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
async function rolloverPots() {
  const defs = [
    { ptr:'g:day',    cur: today(),     pfx:'lbd:', potF:'potD', prizes: PRIZE_D, res:'g:dayResults',    lock:'day:paid:',    tag:'DAILY',  k:'daypot' },
    { ptr:'g:season', cur: seasonKey(), pfx:'lb:',  potF:'pot',  prizes: PRIZE_W, res:'g:seasonResults', lock:'season:paid:', tag:'SEASON', k:'season' },
  ];
  for (const d of defs) {
    const ptr = await getJSON(d.ptr);
    if (!ptr) { await setJSON(d.ptr, d.cur); continue; }
    if (ptr === d.cur) continue;
    if (!(await setnxJSON(`${d.lock}${ptr}`, { t: Date.now() }))) { await setJSON(d.ptr, d.cur); continue; }
    try {
      const lb = (await getJSON(`${d.pfx}${ptr}`)) || {};
      const ranked = Object.entries(lb).filter(([w]) => !isDemo(w))
        .sort((a, b) => b[1] - a[1]).slice(0, d.prizes.length);
      const st = await loadStats();
      const pot = Math.floor(st[d.potF] || 0);
      let paid = 0; const winners = [];
      for (let i = 0; i < ranked.length; i++) {
        const share = Math.floor(pot * d.prizes[i]);
        if (share <= 0) continue;
        const [w, xp] = ranked[i];
        const p = await loadPlayer(w);
        p.cr += share;
        await savePlayer(p);
        paid += share;
        winners.push({ w: shortW(w), xp, share });
        await bumpFeed({ w: shortW(w), a: `${d.tag} #${i+1} · won ${share.toLocaleString()} credits`, c: 'hit' });
      }
      st[d.potF] = pot - paid;               // rollover: unclaimed shares stay in the pot
      await setJSON('g:stats', st);
      await setJSON(d.res, { period: ptr, pot, paid, rolled: pot - paid, winners, t: Date.now() });
      await append({ k: d.k, period: ptr, pot, paid, winners });
      if (d.k === 'daypot' && MINT) {
        // refresh the CHAMPION PODIUM: the day's top 3 with an existing
        // RCX account earn 50/30/20 of every reload's 30% cut until the
        // next rollover. The outgoing podium is kept one period as a
        // grace window, so a reload built moments before midnight still
        // verifies against the list it was built from.
        // top 3 ELIGIBLE by XP: must have an RCX account AND satisfy the
        // HOLDER RULE (still holding >= 50% of last-7-days champion pay).
        // A dumper is skipped silently and the next player up is seated.
        const podRanked = Object.entries(lb).filter(([pw]) => !isDemo(pw)).sort((a, b) => b[1] - a[1]);
        const list = [];
        for (const [pw] of podRanked) {
          if (list.length >= CHAMP.curve.length) break;
          const acc = await findAta(pw);
          if (!acc) continue;                                   // no RCX account -> not payable
          const cp = await getJSONStrict(`u:${pw}`);
          const earned7 = champWindowSum(cp && cp.champ7, Date.now(), CHAMP.holdDays);
          if (acc.bal + 1e-9 < earned7 * CHAMP.holdPct) continue; // dumped -> seat forfeited
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
function wardenLine(prices) {
  const hour = Math.floor(Date.now() / 3600e3);
  const pool = [
    { feed:'SOL', pct: 0.006, mins: 360 },
    { feed:'BTC', pct: 0.004, mins: 360 },
    { feed:'ETH', pct: 0.008, mins: 720 },
  ];
  const c = pool[hour % pool.length];
  const spot = prices[c.feed];
  const thresh = +(spot * (1 + c.pct)).toFixed(c.feed === 'BTC' ? 0 : 2);
  // crude prob: distance in "typical hourly moves" -> logistic squash
  const typicalHourly = { SOL: 0.0075, BTC: 0.0045, ETH: 0.0065 }[c.feed];
  const zed = c.pct / (typicalHourly * Math.sqrt(c.mins / 60));
  const p = Math.round(100 / (1 + Math.exp(1.7 * zed)));
  return {
    id: `w${hour}`, feed: c.feed, thresh, mins: c.mins, p,
    q: `${c.feed} trades above $${thresh.toLocaleString()} within ${c.mins / 60} hours`,
    r: `Spot ${c.feed} is $${spot.toLocaleString(undefined,{maximumFractionDigits:2})}. The line sits ${(c.pct*100).toFixed(1)}% away; at this pair's typical realised volatility that is ${zed.toFixed(1)} standard hourly moves over the window. Warden v0 is a stated heuristic - its record accrues like anything else here.`,
  };
}

// ---- the Warden's public record. Each hourly line is sealed exactly
// once (SET NX — first request of the hour wins, all others read it),
// then settled on the same oracle at its window's end. The record is
// aggregate hits + Brier over every settled call, misses included.
// An oracle that only shows you its wins is a horoscope with a UI.
async function wardenTick(prices) {
  const wl = wardenLine(prices);
  const open = (await getJSON('g:warden:open')) || [];
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
  const rec = (await getJSON('g:warden:rec')) || { n:0, hits:0, brier:0 };
  const hist = (await getJSON('g:warden:hist')) || [];
  for (const s of open) {
    const px = prices[s.feed];
    if (now < s.exp || !Number.isFinite(px)) { still.push(s); continue; }
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
    const px = prices[s.feed];
    const px2 = s.kind === 'race' ? prices[s.feed2] : 1;
    if (!Number.isFinite(px) || !Number.isFinite(px2)) {
      // feed missing this tick — stay open, unless it has been gone a
      // full day past expiry (e.g. a delisted feed): then VOID-refund
      // so no shot can hang forever.
      if (now - s.exp < STALE_VOID_MS) { still.push(s); continue; }
      changed = true;
      refund(p, s); s.res = 'void'; s.settledAt = now; s.exitPx = null;
      await reverseStake(s.stake);
      await append({ k:'settle', w: p.w, id: s.id, res: 'void', reason: 'feed-gone' });
      await pushHist(p.w, { id: s.id, t: now, label: s.label, side: s.side, res: 'void', xp: 0, stake: s.stake, entry: s.entry, exit: null });
      p.closed.unshift(s); p.closed = p.closed.slice(0, 20);
      continue;
    }
    changed = true;
    let outcome;
    if (s.kind === 'thr') outcome = px > s.thresh ? 'YES' : 'NO';
    else if (s.kind === 'thrDown') outcome = px < s.thresh ? 'YES' : 'NO';
    else if (s.kind === 'range') outcome = Math.abs((px - s.entry) / s.entry) >= s.pct ? 'YES' : 'NO';
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
      await reverseStake(s.stake);           // a refunded stake feeds nothing
    }
    else if (outcome === s.side) {
      p.shots++; s.res = 'hit'; p.hits++; p.streak++; p.best = Math.max(p.best, p.streak);
      p.xp += s.xp; await bumpLadder(p.w, s.xp);
      if (!isDemo(p.w)) await bumpFeed({ w: shortW(p.w), a: `HIT +${s.xp} XP`, c: 'hit' });
    } else {
      p.shots++; s.res = 'miss'; p.streak = 0;
      if (!isDemo(p.w)) await bumpFeed({ w: shortW(p.w), a: 'MISS - streak reset', c: 'miss' });
    }
    s.settledAt = now; s.exitPx = px;
    await append({ k:'settle', w: p.w, id: s.id, res: s.res, exitPx: px,
      side: s.side, salt: s.salt, commit: s.commit });   // the reveal: sha256(side|salt) must equal the seal's commit
    await pushHist(p.w, { id: s.id, t: now, label: s.label, side: s.side, res: s.res,
      xp: s.res === 'hit' ? s.xp : 0, stake: s.stake, entry: s.entry, exit: px });
    p.closed.unshift(s); p.closed = p.closed.slice(0, 20);
  }
  p.open = still;
  return changed;
}

// Take the stake AFTER all validation has passed. 70% burn, 30% pots
// (split half daily / half weekly). The floor is monotone by
// construction: it only ever ratchets to a new maximum.
async function takeStake(p, stake) {
  if (!STAKES[stake]) return 'bad stake';
  if (p.cr < stake) return `not enough credits — you have ${Math.floor(p.cr).toLocaleString()}${MINT ? '. Reload: burn RCX for credits, 1 for 1.' : '.'}`;
  p.cr -= stake; p._src = 'cr';
  const st = await loadStats();
  st.burned += stake * SPLIT.burn;
  st.potD  += stake * SPLIT.pot * POT_DAY_SHARE;
  st.pot   += stake * SPLIT.pot * (1 - POT_DAY_SHARE);
  st.shots++;
  st.floor = Math.max(st.floor || FLOOR_BASE, FLOOR_BASE + st.burned * 1e-9);
  await setJSON('g:stats', st);
  return null;
}

// A VOIDed shot gives the stake back — so its contribution to the burn
// and pot counters is reversed too (clamped at zero; the shots-fired
// count and the floor's high-water mark stay, both deliberately).
async function reverseStake(stake) {
  const st = await loadStats();
  st.burned = Math.max(0, st.burned - stake * SPLIT.burn);
  st.potD   = Math.max(0, st.potD   - stake * SPLIT.pot * POT_DAY_SHARE);
  st.pot    = Math.max(0, st.pot    - stake * SPLIT.pot * (1 - POT_DAY_SHARE));
  await setJSON('g:stats', st);
}

module.exports = async (req, res) => {
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const isPost = req.method !== 'GET';
    if (rateLimited(ip, isPost)) return res.status(429).json({ ok:false, reason:'slow down - too many requests from this address' });

    const action = (req.method === 'GET' ? req.query.action : (req.body||{}).action) || 'state';
    const prices = await getPrices();

    if (action === 'blockhash') {
      const r = await rpcCall('getLatestBlockhash', [{ commitment: 'confirmed' }]);
      const bh = r && r.value && r.value.blockhash;
      if (!bh) return res.status(502).json({ ok: false, reason: 'RPC unavailable - try again' });
      return res.json({ ok: true, blockhash: bh });
    }

    if (action === 'state') {
      await rolloverPots();
      const wardenRec = await wardenTick(prices);
      const podNow = (await getJSON('g:podium')) || { list: [] };
      const wRaw = req.query.wallet;
      const w = (typeof wRaw === 'string' && (isWalletShaped(wRaw) || isDemo(wRaw))) ? wRaw : null;
      let player = null;
      if (w) {
        const p = await loadPlayer(w);
        const changed = await settle(p, prices);
        // Only persist players that already exist or actually changed —
        // a bare state?wallet=<anything> must not mint KV records.
        if (p._existed || changed) await savePlayer(p);
        player = { ...p, rank: RANKS[rankOf(p.xp)][0], rankIdx: rankOf(p.xp),
          next: RANKS[rankOf(p.xp)+1] || null, chambers: Math.min(4, rankOf(p.xp)+1) + 1 };
        // SEALED means sealed: state?wallet= is an open spectator view, so
        // open shots are served WITHOUT side/salt (commit only). The owner
        // gets the side back in the fire response and keeps it locally.
        player.open = (p.open || []).map(({ side, salt, ...rest }) => rest);
        delete player._existed; delete player._src;
        player.history = ((await getJSON(`hist:${w}`)) || []).slice(0, 60);
        // CHAMPION CONSOLE data: seat share, 7d earnings, live balance
        // (cached 60s), and the exact amount sellable without losing the
        // seat — so champions can exit smart instead of dumping blind.
        const seat = (podNow.list || []).find(x => x.w === w);
        if ((seat || p.stakeOn) && MINT && !isDemo(w)) {
          let cb = await getJSON(`champbal:${w}`);
          if (!cb || Date.now() - cb.t > 60_000) {
            const acc = await findAta(w);
            cb = { bal: acc ? acc.bal : 0, t: Date.now() };
            await setJSON(`champbal:${w}`, cb);
          }
          if (seat) {
            const earned7 = champWindowSum(p.champ7, Date.now(), CHAMP.holdDays);
            player.champion = { pct: seat.pct, earned7: Math.floor(earned7), bal: Math.floor(cb.bal),
              safeSell: Math.max(0, Math.floor(cb.bal - earned7 * CHAMP.holdPct)) };
          }
          // lazy hold-yield: once per UTC day, on touch, on the live balance
          if (p.stakeOn && p.stakeDay !== today()) {
            const y = stakeYield(cb.bal);
            p.stakeDay = today();
            if (y > 0) {
              p.cr += y; p.stakeEarned = (p.stakeEarned || 0) + y;
              const st0 = await loadStats();
              st0.stakePaid = (st0.stakePaid || 0) + y;
              await setJSON('g:stats', st0);
              await append({ k: 'stakeyield', w, bal: Math.floor(cb.bal), y });
            }
            await savePlayer(p);
          }
          if (p.stakeOn) player.stakeInfo = { on: true, bal: Math.floor(cb.bal),
            perDay: stakeYield(cb.bal), earned: p.stakeEarned || 0,
            rate: STAKE.rate, minBal: STAKE.minBal, capBal: STAKE.capBal };
        }
      }
      const st = await loadStats();
      const lb = (await getJSON(`lb:${seasonKey()}`)) || {};
      const ladder = Object.entries(lb).filter(([wl]) => !isDemo(wl)).sort((a,b)=>b[1]-a[1]).slice(0,20)
        .map(([wl,xp])=>({ w: shortW(wl), xp, me: wl===w }));
      const lbd = (await getJSON(`lbd:${today()}`)) || {};
      const ladderDay = Object.entries(lbd).filter(([wl]) => !isDemo(wl)).sort((a,b)=>b[1]-a[1]).slice(0,10)
        .map(([wl,xp])=>({ w: shortW(wl), xp, me: wl===w }));
      return res.json({ ok:true, v: VERSION, durable,
        prices:{src:prices.src,SOL:prices.SOL,BTC:prices.BTC,ETH:prices.ETH,BONK:prices.BONK,WIF:prices.WIF,JUP:prices.JUP,PUMP:prices.PUMP},
        stats: st, feed: (await getJSON('g:feed')) || [], ladder, ladderDay,
        warden: wardenLine(prices), wardenRec,
        wardenHist: (await getJSON('g:warden:hist')) || [],
        targets: Object.fromEntries(Object.entries(targetBoard(boardHour()))
          .filter(([,t]) => Number.isFinite(prices[t.feed]) && (!t.feed2 || Number.isFinite(prices[t.feed2])))),
        boardFlip: (boardHour() + 1) * 3600e3,
        split: SPLIT, potSplit: { day: POT_DAY_SHARE, week: 1 - POT_DAY_SHARE },
        champ: { pct: CHAMP.pct, curve: CHAMP.curve, holdPct: CHAMP.holdPct, holdDays: CHAMP.holdDays,
          podium: (podNow.list || []).map(x => ({ w: shortW(x.w), ata: x.ata, pct: x.pct })) },
        season: seasonKey(), day: today(),
        mint: MINT || null, incinerator: MINT ? INCINERATOR : null, mcap: await getMcap(),
        tokenProgram: await getMintProgram(),
        lastSeason: await getJSON('g:seasonResults'),
        lastDay: await getJSON('g:dayResults'),
        log: (await getJSON('g:log:head')) || null, player });
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
          entry: prices[t.feed], exp: Date.now()+t.mins*60e3, stake,
          xp: Math.max(1, Math.round(t.baseXp * STAKES[stake] * xpMult)), label: t.label };
        if (kind === 'thr') shot.thresh = prices[t.feed] * (1 + t.pct);
        if (kind === 'thrDown') shot.thresh = prices[t.feed] * (1 - t.pct);
        if (kind === 'range') shot.pct = t.pct;
        if (kind === 'race') { shot.feed2 = t.feed2; shot.entry2 = prices[t.feed2]; }
      } else {
        const wl = wardenLine(prices);
        const withW = b.side === 'with';
        shot = { id: Math.random().toString(36).slice(2,10), kind:'thr', feed:wl.feed, thresh:wl.thresh,
          side: withW ? (wl.p >= 50 ? 'YES':'NO') : (wl.p >= 50 ? 'NO':'YES'),
          entry: prices[wl.feed], exp: Date.now()+wl.mins*60e3, stake,
          xp: Math.round(14 * STAKES[stake] * (withW ? 0.8 : 3.4)), label: 'DUEL vs the Warden: '+wl.q, duel:true };
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

    if (action === 'stake') {
      if (!MINT) return res.status(400).json({ ok:false, reason:'token not launched yet' });
      const b = req.body || {};
      const w = b.auth && b.auth.wallet;
      if (!w || isDemo(w)) return res.status(400).json({ ok:false, reason:'connect a real wallet to stake' });
      const v = verifyAuth(b.auth);
      if (!v.ok) return res.status(401).json({ ok:false, reason:v.reason });
      const p = await loadPlayer(w);
      const turnOn = b.on !== false;
      p.stakeOn = turnOn;
      if (turnOn && !p.stakeDay) p.stakeDay = today();   // first yield lands TOMORROW — no same-day flash-hold
      await savePlayer(p);
      const st = await loadStats();
      st.stakers = Math.max(0, (st.stakers || 0) + (turnOn ? 1 : -1));
      await setJSON('g:stats', st);
      await append({ k: 'stake', w, on: turnOn });
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
      p.cr += credit; p.burned += (d.burned != null ? d.burned : d.amount);
      await savePlayer(p);
      const st = await loadStats();
      st.realBurned = (st.realBurned || 0) + (d.burned != null ? d.burned : d.amount);
      if (d.champPaid) st.champPaid = (st.champPaid || 0) + d.champPaid;
      // record each champion's take in their 7-day holder window
      if (d.champLegs && d.champLegs.length) {
        for (const leg of d.champLegs) {
          const cp = await loadPlayer(leg.w);
          cp.champ7 = cp.champ7 || {};
          cp.champ7[today()] = (cp.champ7[today()] || 0) + leg.amt;
          for (const k of Object.keys(cp.champ7))
            if (Date.now() - new Date(k + 'T00:00:00Z').getTime() > (CHAMP.holdDays + 1) * 86400e3) delete cp.champ7[k];
          await savePlayer(cp);
        }
      }
      await setJSON('g:stats', st);
      await append({ k:'reload', w, sig, amount: d.amount, burned: d.burned, champs: d.champPaid || 0 });
      await bumpFeed({ w: shortW(w), a: `BURNED ${(d.burned != null ? d.burned : d.amount).toLocaleString()} RCX${d.champPaid ? ` · +${d.champPaid.toLocaleString()} RCX to the podium` : ''} · reloaded`, c: 'seal', sig });
      return res.json({ ok:true, credited: credit, cr: p.cr });
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
        p.xp += paidXp; await bumpLadder(w, paidXp);
        await savePlayer(p);
      }
      await append({ k:'anchor', w, i: d.i, sig, xp: paidXp });
      await bumpFeed({ w: shortW(w), a: `ANCHORED the log on-chain · entry #${d.i}${paidXp ? ' · +25 XP' : ''}`, c:'hit', sig });
      return res.json({ ok:true, i: d.i, xp: paidXp, note: paidXp ? null : 'anchored - XP pays once per wallet per day' });
    }

    return res.status(400).json({ ok:false, reason:'unknown action' });
  } catch (e) {
    return res.status(500).json({ ok:false, reason: String(e.message || e) });
  }
};
module.exports.champWindowSum = champWindowSum;   // pure, for the test harness
