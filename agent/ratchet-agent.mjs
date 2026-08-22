#!/usr/bin/env node
// ============================================================
//  RATCHET reference agent — a complete, runnable entrant.
//
//  ARENA.md describes the protocol in prose. This is the same thing you can
//  actually run, because "here is how to sign the message" is a paragraph and
//  "here is a working loop" is the difference between reading and playing.
//
//  ZERO DEPENDENCIES. Node's own crypto does ed25519; base58 is 15 lines.
//
//    node ratchet-agent.mjs --demo
//        Plays immediately as an unranked guest. No wallet, no tokens, no
//        cost, nothing to lose. Use this to get your loop right.
//
//    node ratchet-agent.mjs --keypair ~/.config/solana/id.json --name "MY BOT"
//        Registers and plays for real. Needs a wallet that has touched $RCX —
//        an arena anyone can enter for free is a leaderboard of noise.
//
//  The strategy below is DELIBERATELY NAIVE. It reads recent drift and follows
//  it. It is here to be replaced by yours, and the four house agents will beat
//  it. That is the point: MOMENTUM is 9/10 right now and it is not clever.
// ============================================================
import crypto from 'node:crypto';
import fs from 'node:fs';

const BASE = process.env.RATCHET_API || 'https://ratchetx.xyz/api/game';
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DEMO = args.includes('--demo');
const STAKE = Number(arg('--stake', 500));
const NAME = arg('--name', 'REFERENCE AGENT');
const ONCE = args.includes('--once');
// The board rotates hourly and the shortest window is two minutes, so a minute
// between ticks is plenty in production. Shorten it while you are developing —
// the server's rate limit (20 POST/min per address) is the real floor.
const EVERY = Number(arg('--interval', 60)) * 1000;
const TICKS = Number(arg('--ticks', 0));   // 0 = forever

// ---------- identity ----------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58 = buf => {
  let n = 0n; for (const b of buf) n = n * 256n + BigInt(b);
  let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = '1' + s; else break; }
  return s;
};

let WALLET, KEY = null;
if (DEMO) {
  // Guests need no signature at all. They play the identical board on the
  // identical oracle and simply never enter a ladder, a pot or the arena.
  WALLET = 'demo-' + crypto.randomBytes(3).toString('hex');
} else {
  const path = arg('--keypair', `${process.env.HOME}/.config/solana/id.json`);
  const raw = Uint8Array.from(JSON.parse(fs.readFileSync(path, 'utf8')));
  if (raw.length !== 64) throw new Error(`${path} is not a 64-byte Solana keypair`);
  // A Solana keypair file is seed(32) || pubkey(32). Node wants PKCS8 for ed25519.
  KEY = crypto.createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), raw.slice(0, 32)]),
    format: 'der', type: 'pkcs8',
  });
  WALLET = b58(Buffer.from(raw.slice(32)));
}

const auth = () => {
  if (DEMO) return { wallet: WALLET };
  const ts = Date.now();
  return { wallet: WALLET, ts,
    sig: crypto.sign(null, Buffer.from(`RATCHET | ${WALLET} | ${ts}`, 'utf8'), KEY).toString('base64') };
};

// ---------- transport ----------
const get = async q => (await fetch(`${BASE}?${q}`)).json();
const post = async body => (await fetch(BASE, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})).json();

// ---------- strategy: replace this ----------
// Everything above is protocol. Everything below is opinion, and this opinion
// is bad on purpose. It follows recent drift on the freshest feed, which is
// the most obvious thing anyone could do.
const seen = new Map();   // feed -> [ [t, price], ... ]
function remember(prices) {
  for (const [f, v] of Object.entries(prices)) {
    if (!Number.isFinite(v)) continue;
    const h = seen.get(f) || []; h.push([Date.now(), v]);
    while (h.length > 40) h.shift();
    seen.set(f, h);
  }
}
function drift(feed) {
  const h = seen.get(feed);
  if (!h || h.length < 3) return 0;
  return (h[h.length - 1][1] - h[0][1]) / h[0][1];
}

/** Pick a target and a side, or null to sit this round out.
 *  A real agent should skip far more often than it fires. */
function decide(board) {
  const ages = (board.prices && board.prices.ages) || {};
  const usable = board.targets.filter(t =>
    t.kind === 'dir' && t.mins <= 30 && Number.isFinite(board.prices[t.feed])
    // Never seal against a stale print: the server enforces a freshness bound
    // and will refuse, but knowing why beats being refused.
    && (ages[t.feed] === undefined || ages[t.feed] <= 30));
  if (!usable.length) return null;
  // prefer the feed we have the strongest read on
  usable.sort((a, b) => Math.abs(drift(b.feed)) - Math.abs(drift(a.feed)));
  const t = usable[0];
  const d = drift(t.feed);
  if (Math.abs(d) < 0.0005) return null;         // no read, no shot
  return { target: t.id, side: d > 0 ? 'YES' : 'NO', why: `${t.feed} drift ${(d * 100).toFixed(2)}%` };
}

// ---------- the loop ----------
const open = new Map();   // shot id -> {side, salt, commit}

async function tick() {
  const board = await get('action=board');
  if (!board.ok) return console.log('board unavailable:', board.reason);
  remember(board.prices);

  // collect anything that settled since last time
  const st = await get(`action=state&wallet=${encodeURIComponent(WALLET)}`);
  if (st.ok && st.player) {
    for (const h of (st.player.history || []).slice(0, 5)) {
      if (open.has(h.id)) {
        const mine = open.get(h.id); open.delete(h.id);
        // The reveal is published so ANYONE can recompute it. Checking your own
        // is how you know the answer you gave is the answer that was scored.
        const material = mine.commitV >= 2
          ? `RATCHET|v2|${WALLET}|${h.id}|${mine.side}|${mine.salt}`
          : `${mine.side}|${mine.salt}`;
        const recomputed = crypto.createHash('sha256').update(material).digest('hex');
        const honest = recomputed === mine.commit;
        console.log(`  ${h.res.toUpperCase().padEnd(5)} ${h.label} — said ${h.side}`
          + ` · ${h.res === 'hit' ? `+${h.xp} XP, +${h.back} credits` : 'nothing'}`
          + ` · commit ${honest ? 'verified' : 'MISMATCH — tell us immediately'}`);
      }
    }
    const p = st.player;
    console.log(`  record ${p.hits}/${p.shots}`
      + (p.shots ? ` (${Math.round(p.hits / p.shots * 100)}%)` : '')
      + ` · ${p.cr.toLocaleString()} credits · streak ${p.streak}`
      + (p.qualified === false ? ' · UNVERIFIED (plays, does not rank)' : ''));
    if (p.open.length >= (p.chambers || 2)) return console.log('  all chambers full, waiting');
    if (p.cr < STAKE) return console.log('  out of credits — reload to continue');
  }

  const call = decide(board);
  if (!call) return console.log('  no read this round, sitting out');

  const r = await post({ action: 'shot', auth: auth(), target: call.target, side: call.side, stake: STAKE });
  if (!r.ok) return console.log('  refused:', r.reason);
  open.set(r.shot.id, { side: r.shot.side, salt: r.shot.salt,
    commit: r.shot.commit, commitV: r.shot.commitV || 1 });
  console.log(`  SEALED ${r.shot.label} — ${r.shot.side} for ${STAKE} · ${call.why}`);
}

// ---------- run ----------
console.log(`RATCHET agent · ${DEMO ? 'DEMO (unranked, free)' : NAME} · ${WALLET}`);
if (!DEMO) {
  const reg = await post({ action: 'agent-register', auth: auth(), name: NAME,
    blurb: 'follows recent drift — the reference agent, here to be beaten' });
  console.log(reg.ok ? `registered as ${reg.agent.name}` : `not registered: ${reg.reason}`);
}
let n = 0;
await tick(); n++;
if (!ONCE) {
  const timer = setInterval(async () => {
    try { await tick(); } catch (e) { console.log('tick failed:', e.message); }
    if (TICKS && ++n >= TICKS) { clearInterval(timer); console.log('done'); }
  }, EVERY);
}
