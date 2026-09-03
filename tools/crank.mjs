#!/usr/bin/env node
// RatchetX public settlement crank — anyone can run this. Zero dependencies.
//
//   node tools/crank.mjs                    # crank the live game + ledger, forever
//   node tools/crank.mjs --once             # one pass, then exit
//   RATCHET_API=http://localhost:8301/api/game node tools/crank.mjs
//
// WHY THIS EXISTS
// Settlement on RatchetX is lazy and permissionless: the exit price of a shot
// is the first oracle sample recorded at or after its window closed, so
// settling early or late produces the same number and no runner gets to choose
// it. What a runner does decide is whether a shot settles at all: one that
// nobody touches inside the window voids and refunds. Any request that touches
// a wallet settles that wallet's expired shots. This script just touches
// wallets — which means ANYONE, not only us, can keep the game settling, and
// that openness is the entire answer to "what if the operator stops". It is not
// a promise that somebody always will. If our servers ever stop cranking, run
// this and the game keeps paying out. (The v3 program moves this crank on-chain; see docs/UNKILLABLE.md.)
//
// It is polite by design: it stays far under the public rate limit
// (80 GET/min per address) and backs off on 429s.

const API = (process.env.RATCHET_API || 'https://ratchetx.xyz/api/game').replace(/\/$/, '');
const ORIGIN = API.replace(/\/api\/game$/, '');
const ONCE = process.argv.includes('--once');
const PASS_EVERY_MS = Number(process.env.CRANK_INTERVAL_MS || 60_000);
const TOUCH_GAP_MS = 1_500;               // ~40 touches/min, half the limit
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url, timeoutMs = 20_000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (r.status === 429) { console.log('  429 — backing off 90s'); await sleep(90_000); return getJSON(url, timeoutMs); }
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

/** The player map, from the cheapest endpoint the server offers.
 *
 *  TWO BUGS LIVED HERE. The full snapshot builds the entire hash-chained log
 *  before it answers, and this timed out at twenty seconds against a real one --
 *  so the permissionless crank, the thing that keeps the game settling if we
 *  stop, could not complete a single pass. And when it did answer, this read
 *  `snap.players`, which does not exist: the full export nests everything under
 *  `state`. So it found zero players, reported "0 with expired shots", and
 *  touched nothing, forever, without ever failing.
 *
 *  `?only=players` is the cheap answer. The fallbacks are for a server that has
 *  not been redeployed yet, and the shape check is because a crank that silently
 *  finds nobody is worse than one that stops. */
async function loadPlayers() {
  try {
    const light = await getJSON(`${ORIGIN}/api/snapshot?only=players`, 30_000);
    if (light && light.players && typeof light.players === 'object') return light.players;
  } catch (e) { console.log(`  players-only snapshot unavailable (${e.message}) — falling back to the full one`); }
  const full = await getJSON(`${ORIGIN}/api/snapshot`, 120_000);
  const players = (full && full.state && full.state.players) || full.players;
  if (!players || typeof players !== 'object')
    throw new Error('snapshot carried no player map — the shape changed and this crank would touch nothing');
  return players;
}

async function pass() {
  const now = Date.now();
  const players = await loadPlayers();
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

  // The Coinflip Ledger advances on the same permissionless crank. It is
  // rate-guarded server-side, so calling it every pass is free and calling it
  // from ten machines at once changes nothing. If we stop running this, the
  // scoreboard that grades us alongside everyone else keeps advancing anyway —
  // which is the only version of it worth publishing.
  try {
    const t = await getJSON(`${ORIGIN}/api/ledger?action=tick`);
    const k = t && t.ticked;
    if (k && !k.skipped)
      console.log(`  ledger — +${k.added} observed, ${k.resolved} scored, ${k.voided} voided, ${k.pending} pending`);
  } catch (e) { console.log(`  ledger skipped — ${e.message}`); }
}

(async () => {
  console.log(`RatchetX crank → ${API}${ONCE ? ' (single pass)' : ''}`);
  for (;;) {
    // A single pass that failed must not exit 0. SETTLE_EXPIRED.cmd, and any
    // other caller, is entitled to know the difference between "nothing to do"
    // and "it could not look".
    try { await pass(); }
    catch (e) { console.log('pass failed:', e.message); if (ONCE) process.exitCode = 1; }
    if (ONCE) break;
    await sleep(PASS_EVERY_MS);
  }
})();
