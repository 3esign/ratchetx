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
const { getJSON, getJSONStrict, setJSON, setnxJSON, delKey, durable } = require('../lib/kv.js');
const { verifyAuth, isDemo, isWalletShaped } = require('../lib/verify.js');
const { getPrices } = require('../lib/prices.js');
const { getTx, decideBurn, rpcCall, INCINERATOR } = require('../lib/burn.js');
const { append, decideAnchor } = require('../lib/log.js');
const MINT = process.env.RATCHET_MINT || '';       // set on token day -> real burns go live
const CREDIT_PER_TOKEN = +(process.env.CREDIT_PER_TOKEN || 1);
const VERSION = 'h1-2026-08-19';

const SPLIT = { burn: 0.70, pot: 0.30, creator: 0.0 };   // frozen headline
const POT_DAY_SHARE = 0.5;                               // of the pot share: half daily, half weekly
const STAKES = { 100: 1, 500: 2, 2500: 5 };
// Targets settle on EXTERNAL majors only — markets no player can move.
// RCX-priced shots were removed 2026-08-19: at this market's depth a
// player could settle their own sealed bet with a $50 trade. Sealing
// hides your side from others, not from yourself.
const TARGETS = {
  SOL5:    { feed: 'SOL',  mins: 5,    baseXp: 10, label: 'SOL higher in 5 minutes' },
  WIF15:   { feed: 'WIF',  mins: 15,   baseXp: 13, label: 'WIF higher in 15 minutes' },
  BONK30:  { feed: 'BONK', mins: 30,   baseXp: 14, label: 'BONK higher in 30 minutes' },
  BTC60:   { feed: 'BTC',  mins: 60,   baseXp: 16, label: 'BTC higher in 1 hour' },
  JUP60:   { feed: 'JUP',  mins: 60,   baseXp: 18, label: 'JUP higher in 1 hour' },
  ETH24:   { feed: 'ETH',  mins: 1440, baseXp: 24, label: 'ETH higher in 24 hours' },
  // threshold shots settle on entry*(1+pct). YES is the hard side and pays
  // full XP; NO pays 35% — otherwise farming easy NOs would print rank.
  SOL_THR: { feed: 'SOL',  mins: 60,   baseXp: 22, pct: 0.01, label: 'SOL pumps +1% within 1 hour' },
  WIF_THR: { feed: 'WIF',  mins: 60,   baseXp: 26, pct: 0.02, label: 'WIF pumps +2% within 1 hour' },
};
const RANKS = [['COG',0],['PISTON',300],['FLYWHEEL',900],['TURBINE',2200],['REACTOR',5000]];
const DAILY_ALLOWANCE = 5000;
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
  if (!p) p = { w, xp:0, streak:0, best:0, hits:0, shots:0, bal:DAILY_ALLOWANCE, cr:0, burned:0, day:today(), open:[], closed:[] };
  if (p.cr == null) { p.cr = 0; p.burned = 0; }
  if (p.day !== today()) { p.day = today(); p.bal = Math.max(p.bal, DAILY_ALLOWANCE); }
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
  await setJSON('g:feed', f.slice(0, 24));
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

function refund(p, s) { if (s.src === 'cr') p.cr += s.stake; else p.bal += s.stake; }

async function settle(p, prices) {
  if (!p.open.length) return false;
  const now = Date.now(); let changed = false;
  const still = [];
  for (const s of p.open) {
    if (now < s.exp) { still.push(s); continue; }
    const px = prices[s.feed];
    if (!Number.isFinite(px)) {
      // feed missing this tick — stay open, unless it has been gone a
      // full day past expiry (e.g. a delisted feed): then VOID-refund
      // so no shot can hang forever.
      if (now - s.exp < STALE_VOID_MS) { still.push(s); continue; }
      changed = true;
      refund(p, s); s.res = 'void'; s.settledAt = now; s.exitPx = null;
      await reverseStake(s.stake);
      await append({ k:'settle', w: p.w, id: s.id, res: 'void', reason: 'feed-gone' });
      p.closed.unshift(s); p.closed = p.closed.slice(0, 20);
      continue;
    }
    changed = true;
    let outcome;
    if (s.kind === 'thr') outcome = px > s.thresh ? 'YES' : 'NO';
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
    await append({ k:'settle', w: p.w, id: s.id, res: s.res, exitPx: px });
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
  if (p.cr >= stake) { p.cr -= stake; p._src = 'cr'; }
  else if (p.bal >= stake) { p.bal -= stake; p._src = 'bal'; }
  else return `not enough - credits ${p.cr}, paper ${p.bal} (paper refills daily${MINT ? ', or burn to reload' : ''})`;
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
        delete player._existed; delete player._src;
      }
      const st = await loadStats();
      const lb = (await getJSON(`lb:${seasonKey()}`)) || {};
      const ladder = Object.entries(lb).filter(([wl]) => !isDemo(wl)).sort((a,b)=>b[1]-a[1]).slice(0,20)
        .map(([wl,xp])=>({ w: shortW(wl), xp, me: wl===w }));
      const lbd = (await getJSON(`lbd:${today()}`)) || {};
      const ladderDay = Object.entries(lbd).filter(([wl]) => !isDemo(wl)).sort((a,b)=>b[1]-a[1]).slice(0,10)
        .map(([wl,xp])=>({ w: shortW(wl), xp, me: wl===w }));
      return res.json({ ok:true, v: VERSION, durable,
        prices:{src:prices.src,SOL:prices.SOL,BTC:prices.BTC,ETH:prices.ETH,BONK:prices.BONK,WIF:prices.WIF,JUP:prices.JUP},
        stats: st, feed: (await getJSON('g:feed')) || [], ladder, ladderDay,
        warden: wardenLine(prices), wardenRec,
        wardenHist: (await getJSON('g:warden:hist')) || [],
        targets: Object.fromEntries(Object.entries(TARGETS).filter(([,t]) => Number.isFinite(prices[t.feed]))),
        split: SPLIT, potSplit: { day: POT_DAY_SHARE, week: 1 - POT_DAY_SHARE },
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

      // ---- validate EVERYTHING before any money moves.
      let spec = null;
      if (action === 'shot') {
        const t = TARGETS[b.target];
        if (!t || (b.side!=='YES' && b.side!=='NO')) { await savePlayer(p); return res.status(400).json({ ok:false, reason:'bad target/side' }); }
        if (!Number.isFinite(prices[t.feed])) { await savePlayer(p); return res.status(409).json({ ok:false, reason:'that feed is offline right now - try another target' }); }
        spec = t;
      } else if (b.side!=='with' && b.side!=='against') { await savePlayer(p); return res.status(400).json({ ok:false, reason:'bad side' }); }

      const err = await takeStake(p, stake);
      if (err) { await savePlayer(p); return res.status(400).json({ ok:false, reason: err }); }

      let shot;
      if (action === 'shot') {
        const t = spec;
        const isThr = Number.isFinite(t.pct);
        const xpMult = isThr ? (b.side === 'YES' ? 1 : 0.35) : 1;
        shot = { id: Math.random().toString(36).slice(2,10),
          kind: isThr ? 'thr' : 'dir', feed:t.feed, side:b.side,
          entry: prices[t.feed], exp: Date.now()+t.mins*60e3, stake,
          xp: Math.max(1, Math.round(t.baseXp * STAKES[stake] * xpMult)), label: t.label };
        if (isThr) shot.thresh = prices[t.feed] * (1 + t.pct);
      } else {
        const wl = wardenLine(prices);
        const withW = b.side === 'with';
        shot = { id: Math.random().toString(36).slice(2,10), kind:'thr', feed:wl.feed, thresh:wl.thresh,
          side: withW ? (wl.p >= 50 ? 'YES':'NO') : (wl.p >= 50 ? 'NO':'YES'),
          entry: prices[wl.feed], exp: Date.now()+wl.mins*60e3, stake,
          xp: Math.round(14 * STAKES[stake] * (withW ? 0.8 : 3.4)), label: (withW?'WITH':'AGAINST')+' the Warden: '+wl.q, duel:true };
      }
      shot.src = p._src || 'bal'; delete p._src;
      p.open.unshift(shot);
      await savePlayer(p);
      await append({ k:'seal', w, id: shot.id, feed: shot.feed, side: shot.side, stake, exp: shot.exp, entry: shot.entry });
      if (!isDemo(w)) await bumpFeed({ w: shortW(w), a: `sealed a shot · ${stake} 🔥`, c:'seal' });
      return res.json({ ok:true, shot, bal: p.bal });
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
      const d = decideBurn(tx, { wallet: w, mint: MINT, minAmount: 1 });
      if (!d.ok) return res.status(400).json({ ok:false, reason: d.reason });
      // ATOMIC replay gate: exactly one concurrent submission of this
      // signature can win the SET NX; every other sees "already credited".
      if (!(await setnxJSON(`sig:${sig}`, { w, amount: d.amount, t: Date.now() })))
        return res.status(409).json({ ok:false, reason:'that burn was already credited' });
      const p = await loadPlayer(w);
      const credit = Math.floor(d.amount * CREDIT_PER_TOKEN);
      p.cr += credit; p.burned += d.amount;
      await savePlayer(p);
      const st = await loadStats();
      st.realBurned = (st.realBurned || 0) + d.amount;
      await setJSON('g:stats', st);
      await append({ k:'reload', w, sig, amount: d.amount });
      await bumpFeed({ w: shortW(w), a: `BURNED ${d.amount.toLocaleString()} RCX · reloaded`, c: 'seal' });
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
      await bumpFeed({ w: shortW(w), a: `ANCHORED the log on-chain · entry #${d.i}${paidXp ? ' · +25 XP' : ''}`, c:'hit' });
      return res.json({ ok:true, i: d.i, xp: paidXp, note: paidXp ? null : 'anchored - XP pays once per wallet per day' });
    }

    return res.status(400).json({ ok:false, reason:'unknown action' });
  } catch (e) {
    return res.status(500).json({ ok:false, reason: String(e.message || e) });
  }
};
