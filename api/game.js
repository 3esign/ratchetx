// ============================================================
//  api/game.js — the whole backend in one endpoint.
//    GET  ?action=state[&wallet=..]   world + your player + ladder
//    POST {action:'shot',   auth, target, side, stake}
//    POST {action:'duel',   auth, side, stake}      vs the Warden
//
//  Economy (operator decision 2026-08-18, FROZEN in Wave 1 paper
//  mode and carried verbatim into Wave 2 real burns):
//    every stake -> 70% BURN · 30% SEASON POT · 0% creator.
//    The creator takes trading fees on the token only. Wallet:
//    HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM  (fees, never funds)
//
//  Settlement is LAZY: every state call settles whatever expired.
//  No cron, no daemon, nothing to forget to run.
// ============================================================
const { getJSON, setJSON, setnxJSON, durable } = require('../lib/kv.js');
const { verifyAuth, isDemo } = require('../lib/verify.js');
const { getPrices } = require('../lib/prices.js');
const { getTx, decideBurn, INCINERATOR } = require('../lib/burn.js');
const { append, decideAnchor } = require('../lib/log.js');
const MINT = process.env.RATCHET_MINT || '';       // set on token day -> real burns go live
const CREDIT_PER_TOKEN = +(process.env.CREDIT_PER_TOKEN || 1);

const SPLIT = { burn: 0.70, pot: 0.30, creator: 0.0 };
const STAKES = { 100: 1, 500: 2, 2500: 5 };
const TARGETS = {
  SOL5:  { feed: 'SOL', mins: 5,    baseXp: 10, label: 'SOL higher in 5 minutes' },
  BTC60: { feed: 'BTC', mins: 60,   baseXp: 16, label: 'BTC higher in 1 hour' },
  ETH24: { feed: 'ETH', mins: 1440, baseXp: 24, label: 'ETH higher in 24 hours' },
};
const RANKS = [['COG',0],['PISTON',300],['FLYWHEEL',900],['TURBINE',2200],['REACTOR',5000]];
const DAILY_ALLOWANCE = 5000;
// Season pot prize curve: top 5 by XP take 40/25/15/12/8 percent of the pot.
// If fewer than 5 played, unclaimed shares ROLL OVER into next season's pot.
const PRIZE = [0.40, 0.25, 0.15, 0.12, 0.08];
const EPS = 0.0004; // |move| under 4bp = void -> stake refunded, no XP

const seasonKey = () => {
  const d = new Date(); const onejan = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const wk = Math.ceil((((d - onejan) / 86400000) + onejan.getUTCDay() + 1) / 7);
  return `s${d.getUTCFullYear()}w${wk}`;
};
const rankOf = xp => { let r = 0; RANKS.forEach((k,i)=>{ if (xp >= k[1]) r = i; }); return r; };
const today = () => new Date().toISOString().slice(0,10);

async function loadPlayer(w) {
  let p = await getJSON(`u:${w}`);
  if (!p) p = { w, xp:0, streak:0, best:0, hits:0, shots:0, bal:DAILY_ALLOWANCE, cr:0, burned:0, day:today(), open:[], closed:[] };
  if (p.cr == null) { p.cr = 0; p.burned = 0; }
  if (p.day !== today()) { p.day = today(); p.bal = Math.max(p.bal, DAILY_ALLOWANCE); }
  return p;
}
async function loadStats() {
  return (await getJSON('g:stats')) || { burned:0, pot:0, floor:0.004180, shots:0 };
}
async function bumpFeed(entry) {
  const f = (await getJSON('g:feed')) || [];
  f.unshift({ t: Date.now(), ...entry });
  await setJSON('g:feed', f.slice(0, 24));
}
async function bumpLadder(w, xp) {
  const k = `lb:${seasonKey()}`;
  const lb = (await getJSON(k)) || {};
  lb[w] = (lb[w] || 0) + xp;
  await setJSON(k, lb);
}

// ---- season rollover: LAZY and automatic. The first request that arrives
// after Sunday 00:00 UTC notices the season key changed, takes a one-shot
// lock, pays the pot to last season's top 5 as game credits, and records
// the results. No cron, no operator, nothing to forget. Ties on XP resolve
// by ladder order (insertion), which is stable enough at this scale.
async function rolloverSeason() {
  const cur = seasonKey();
  const ptr = await getJSON('g:season');
  if (!ptr) { await setJSON('g:season', cur); return; }
  if (ptr === cur) return;
  if (!(await setnxJSON(`season:paid:${ptr}`, { t: Date.now() }))) { await setJSON('g:season', cur); return; }
  const lb = (await getJSON(`lb:${ptr}`)) || {};
  const ranked = Object.entries(lb).sort((a, b) => b[1] - a[1]).slice(0, PRIZE.length);
  const st = await loadStats();
  const pot = Math.floor(st.pot || 0);
  let paid = 0; const winners = [];
  for (let i = 0; i < ranked.length; i++) {
    const share = Math.floor(pot * PRIZE[i]);
    if (share <= 0) continue;
    const [w, xp] = ranked[i];
    const p = await loadPlayer(w);
    p.cr += share;
    await setJSON(`u:${w}`, p);
    paid += share;
    winners.push({ w: w.slice(0,4)+'…'+w.slice(-4), xp, share });
    await bumpFeed({ w: w.slice(0,4)+'…'+w.slice(-4), a: `SEASON #${i+1} · won ${share.toLocaleString()} credits`, c: 'hit' });
  }
  st.pot = pot - paid;                       // rollover: unclaimed shares stay in the pot
  await setJSON('g:stats', st);
  await setJSON('g:seasonResults', { season: ptr, pot, paid, rolled: pot - paid, winners, t: Date.now() });
  await append({ k:'season', season: ptr, pot, paid, winners });
  await setJSON('g:season', cur);
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

async function settle(p, prices) {
  if (!p.open.length) return false;
  const now = Date.now(); let changed = false;
  const still = [];
  for (const s of p.open) {
    if (now < s.exp) { still.push(s); continue; }
    changed = true; p.shots++;
    const px = prices[s.feed];
    let outcome;
    if (s.kind === 'thr') outcome = px > s.thresh ? 'YES' : 'NO';
    else {
      const chg = (px - s.entry) / s.entry;
      if (Math.abs(chg) < EPS) outcome = 'VOID';
      else outcome = chg > 0 ? 'YES' : 'NO';
    }
    if (outcome === 'VOID') { if (s.src === 'cr') p.cr += s.stake; else p.bal += s.stake; s.res = 'void'; }
    else if (outcome === s.side) {
      s.res = 'hit'; p.hits++; p.streak++; p.best = Math.max(p.best, p.streak);
      p.xp += s.xp; await bumpLadder(p.w, s.xp);
      await bumpFeed({ w: p.w.slice(0,4)+'…'+p.w.slice(-4), a: `HIT +${s.xp} XP`, c: 'hit' });
    } else {
      s.res = 'miss'; p.streak = 0;
      await bumpFeed({ w: p.w.slice(0,4)+'…'+p.w.slice(-4), a: 'MISS - streak reset', c: 'miss' });
    }
    s.settledAt = now; s.exitPx = px;
    await append({ k:'settle', w: p.w, id: s.id, res: s.res, exitPx: px });
    p.closed.unshift(s); p.closed = p.closed.slice(0, 20);
  }
  p.open = still;
  return changed;
}

async function takeStake(p, stake) {
  if (!STAKES[stake]) return 'bad stake';
  if (p.cr >= stake) { p.cr -= stake; p._src = 'cr'; }
  else if (p.bal >= stake) { p.bal -= stake; p._src = 'bal'; }
  else return `not enough - credits ${p.cr}, paper ${p.bal} (paper refills daily${MINT ? ', or burn to reload' : ''})`;
  const st = await loadStats();
  st.burned += stake * SPLIT.burn; st.pot += stake * SPLIT.pot; st.shots++;
  st.floor = 0.004180 + st.burned * 1e-9;
  await setJSON('g:stats', st);
  return null;
}

module.exports = async (req, res) => {
  try {
    const action = (req.method === 'GET' ? req.query.action : (req.body||{}).action) || 'state';
    const prices = await getPrices();

    if (action === 'state') {
      await rolloverSeason();
      const w = req.query.wallet;
      let player = null;
      if (w) {
        const p = await loadPlayer(w);
        if (await settle(p, prices)) {}
        await setJSON(`u:${w}`, p);
        player = { ...p, rank: RANKS[rankOf(p.xp)][0], rankIdx: rankOf(p.xp),
          next: RANKS[rankOf(p.xp)+1] || null, chambers: Math.min(4, rankOf(p.xp)+1) + 1 };
      }
      const st = await loadStats();
      const lb = (await getJSON(`lb:${seasonKey()}`)) || {};
      const ladder = Object.entries(lb).sort((a,b)=>b[1]-a[1]).slice(0,20)
        .map(([wl,xp])=>({ w: wl.slice(0,4)+'…'+wl.slice(-4), xp, me: wl===w }));
      return res.json({ ok:true, durable, prices:{src:prices.src,SOL:prices.SOL,BTC:prices.BTC,ETH:prices.ETH},
        stats: st, feed: (await getJSON('g:feed')) || [], ladder,
        warden: wardenLine(prices), targets: TARGETS, split: SPLIT, season: seasonKey(),
        mint: MINT || null, incinerator: MINT ? INCINERATOR : null,
        lastSeason: await getJSON('g:seasonResults'),
        log: (await getJSON('g:log:head')) || null, player });
    }

    if (action === 'shot' || action === 'duel') {
      const b = req.body || {};
      const w = b.auth && b.auth.wallet;
      if (!w) return res.status(400).json({ ok:false, reason:'no wallet' });
      if (!isDemo(w)) {
        const v = verifyAuth(b.auth);
        if (!v.ok) return res.status(401).json({ ok:false, reason:v.reason });
      }
      const p = await loadPlayer(w);
      await settle(p, prices);
      const cap = Math.min(4, rankOf(p.xp)+1) + 1;
      if (p.open.length >= cap) { await setJSON(`u:${w}`, p); return res.status(409).json({ ok:false, reason:`all ${cap} chambers full` }); }
      const stake = +b.stake;
      if (action === 'shot') {
        const t0 = TARGETS[b.target];
        if (!t0 || (b.side!=='YES' && b.side!=='NO')) { await setJSON(`u:${w}`, p); return res.status(400).json({ ok:false, reason:'bad target/side' }); }
      } else if (b.side!=='with' && b.side!=='against') { await setJSON(`u:${w}`, p); return res.status(400).json({ ok:false, reason:'bad side' }); }
      const err = await takeStake(p, stake);
      if (err) { await setJSON(`u:${w}`, p); return res.status(400).json({ ok:false, reason: err }); }

      let shot;
      if (action === 'shot') {
        const t = TARGETS[b.target];
        shot = { id: Math.random().toString(36).slice(2,10), kind:'dir', feed:t.feed, side:b.side,
          entry: prices[t.feed], exp: Date.now()+t.mins*60e3, stake,
          xp: Math.round(t.baseXp * STAKES[stake]), label: t.label };
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
      await setJSON(`u:${w}`, p);
      await append({ k:'seal', w, id: shot.id, feed: shot.feed, side: shot.side, stake, exp: shot.exp, entry: shot.entry });
      await bumpFeed({ w: w.slice(0,4)+'…'+w.slice(-4), a: `sealed a shot · ${stake} 🔥`, c:'seal' });
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
      if (await getJSON(`sig:${sig}`)) return res.status(409).json({ ok:false, reason:'that burn was already credited' });
      const tx = await getTx(sig);
      const d = decideBurn(tx, { wallet: w, mint: MINT, minAmount: 1 });
      if (!d.ok) return res.status(400).json({ ok:false, reason: d.reason });
      await setJSON(`sig:${sig}`, { w, amount: d.amount, t: Date.now() });   // replay gate FIRST
      const p = await loadPlayer(w);
      const credit = Math.floor(d.amount * CREDIT_PER_TOKEN);
      p.cr += credit; p.burned += d.amount;
      await setJSON(`u:${w}`, p);
      const st = await loadStats();
      st.realBurned = (st.realBurned || 0) + d.amount;
      await setJSON('g:stats', st);
      await append({ k:'reload', w, sig, amount: d.amount });
      await bumpFeed({ w: w.slice(0,4)+'…'+w.slice(-4), a: `BURNED ${d.amount.toLocaleString()} RATCHET · reloaded`, c: 'seal' });
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
      if (await getJSON(`sig:${sig}`)) return res.status(409).json({ ok:false, reason:'that anchor was already credited' });
      const heads = (await getJSON('g:log:heads')) || {};
      const tx = await getTx(sig);
      const d = decideAnchor(tx, { wallet: w, heads });
      if (!d.ok) return res.status(400).json({ ok:false, reason: d.reason });
      await setJSON(`sig:${sig}`, { w, anchor: d.i, t: Date.now() });
      const anchors = (await getJSON('g:anchors')) || [];
      anchors.unshift({ i: d.i, h: d.h, sig, slot: d.slot, w: w.slice(0,4)+'…'+w.slice(-4), t: Date.now() });
      await setJSON('g:anchors', anchors.slice(0, 30));
      const p = await loadPlayer(w);
      p.xp += 25; await bumpLadder(w, 25);
      await setJSON(`u:${w}`, p);
      await append({ k:'anchor', w, i: d.i, sig });
      await bumpFeed({ w: w.slice(0,4)+'…'+w.slice(-4), a: `ANCHORED the log on-chain · entry #${d.i} · +25 XP`, c:'hit' });
      return res.json({ ok:true, i: d.i, xp: 25 });
    }

    return res.status(400).json({ ok:false, reason:'unknown action' });
  } catch (e) {
    return res.status(500).json({ ok:false, reason: String(e.message || e) });
  }
};
