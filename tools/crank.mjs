#!/usr/bin/env node
// RatchetX public settlement crank — anyone can run this. Zero dependencies.
//
//   node tools/crank.mjs                    # crank the live game, forever
//   node tools/crank.mjs --once             # one pass, then exit
//   RATCHET_API=http://localhost:8301/api/game node tools/crank.mjs
//
// WHY THIS EXISTS
// Settlement on RatchetX is lazy and permissionless: the exit price of a shot
// is the first oracle sample recorded at or after its window closed, so
// settling early, late, or by a stranger produces the same number. Any request
// that touches a wallet settles that wallet's expired shots. This script just
// touches wallets — which means ANYONE, not only us, can keep the game
// settling. If our servers ever stop cranking, run this and the game keeps
// paying out. (The v3 program moves this crank on-chain; see docs/UNKILLABLE.md.)
//
// It is polite by design: it stays far under the public rate limit
// (80 GET/min per address) and backs off on 429s.

const API = (process.env.RATCHET_API || 'https://ratchetx.xyz/api/game').replace(/\/$/, '');
const ORIGIN = API.replace(/\/api\/game$/, '');
const ONCE = process.argv.includes('--once');
const PASS_EVERY_MS = Number(process.env.CRANK_INTERVAL_MS || 60_000);
const TOUCH_GAP_MS = 1_500;               // ~40 touches/min, half the limit
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (r.status === 429) { console.log('  429 — backing off 90s'); await sleep(90_000); return getJSON(url); }
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function pass() {
  const now = Date.now();
  const snap = await getJSON(`${ORIGIN}/api/snapshot`);
  const players = snap.players || {};
  const due = [];
  for (const [wallet, p] of Object.entries(players)) {
    const open = Array.isArray(p.open) ? p.open : [];
    if (open.some(s => s && typeof s.exp === 'number' && s.exp <= now)) due.push(wallet);
  }
  console.log(`[${new Date().toISOString()}] ${Object.keys(players).length} players, ${due.length} with expired shots`);
  let touched = 0;
  for (const wallet of due) {
    try {
      const st = await getJSON(`${API}?action=state&wallet=${encodeURIComponent(wallet)}`);
      const left = (st.player && st.player.open ? st.player.open : []).filter(s => s.exp <= now).length;
      touched++;
      console.log(`  settled-touch ${wallet.slice(0, 6)}…  (${left} still pending an oracle sample)`);
    } catch (e) {
      console.log(`  skip ${wallet.slice(0, 6)}… — ${e.message}`);
    }
    await sleep(TOUCH_GAP_MS);
  }
  console.log(`  pass done — touched ${touched}/${due.length}`);
}

(async () => {
  console.log(`RatchetX crank → ${API}${ONCE ? ' (single pass)' : ''}`);
  for (;;) {
    try { await pass(); } catch (e) { console.log('pass failed:', e.message); }
    if (ONCE) break;
    await sleep(PASS_EVERY_MS);
  }
})();
