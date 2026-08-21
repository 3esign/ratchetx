// ============================================================
//  api/supply.js — THE SUPPLY CLOCK.
//
//  WHY THIS EXISTS.
//  $RCX launched on pump.fun. Almost every launchpad token has the same
//  shape: a fixed supply, a pool, and nothing that ever removes a token from
//  circulation. The only force acting on supply is selling.
//
//  RATCHET is the other thing. Seventy percent of every stake is burned —
//  not sent to a treasury, not locked, not "allocated to the ecosystem":
//  destroyed, inside the player's own signed transaction, with a signature
//  anyone can look up. The supply of this token falls as a direct function
//  of how much the game is played, and it can never go back up because the
//  mint authority is revoked.
//
//  That is a claim, and claims are cheap. This page is the arithmetic: the
//  mint's own supply field read off Solana, one reading a day, drawn as a
//  line, with the burn transactions underneath and an honest split between
//  what players destroyed and what the launchpad destroyed at graduation.
//
//  It is also the answer to "what does RATCHET actually give pump.fun?" A
//  launch venue gets a token. This gives that token a reason to shrink.
// ============================================================
const { getJSON, hall } = require('../lib/kv.js');
const { rpcCall, INCINERATOR } = require('../lib/burn.js');
const { series } = require('../lib/supplylog.js');

const VERSION = 'h48-2026-08-21';
const SITE = 'https://ratchetx.vercel.app';
const SOLSCAN = 'https://solscan.io';
const MINT = process.env.RATCHET_MINT || '';
// Complete days required before a burn rate is published at all.
const MIN_RATE_DAYS = 3;
const PUMP = MINT ? `https://pump.fun/coin/${MINT}` : 'https://pump.fun';

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const n0 = v => (v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString());
const pctS = v => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(v < 1 ? 3 : 2) + '%');
const short = s => String(s).slice(0, 4) + '…' + String(s).slice(-4);
const when = t => {
  if (!t) return '';
  const d = Math.max(0, Date.now() - t);
  return d < 3600e3 ? `${Math.round(d / 60e3)}m ago`
    : d < 86400e3 ? `${Math.round(d / 3600e3)}h ago` : `${Math.round(d / 86400e3)}d ago`;
};

/** The supply curve. Deliberately not a sparkline — the whole point is that
 *  it only ever goes one way, so the axis starts at the launch reading and
 *  the eye can see the slope. */
function curve(rows) {
  if (!rows || rows.length < 2) return '';
  const W = 900, H = 220, padL = 8, padR = 8, padT = 12, padB = 22;
  // THE AXIS IS ZOOMED, AND THE PAGE SAYS SO.
  // Scaled against the launch supply this line is flat: a few million out of
  // a billion is nothing to a pixel. Drawing it flat would understate a real
  // effect; drawing it zoomed without saying so would overstate one. So we
  // zoom to the observed range and print both endpoint values on the axis,
  // where a reader can see exactly how much of the token this picture covers.
  const ys = rows.map(r => r.supply);
  const hi = Math.max(...ys), lo = Math.min(...ys);
  const span = (hi - lo) || Math.max(1, hi * 0.001);
  const X = i => padL + (i / Math.max(1, rows.length - 1)) * (W - padL - padR);
  const Y = v => padT + (1 - (v - (lo - span * 0.15)) / (span * 1.3)) * (H - padT - padB);
  const lab = (v, y, anchor) => `<text x="${W - padR}" y="${y}" fill="#69707d" font-size="9.5"
    font-family="ui-monospace,monospace" text-anchor="end" dominant-baseline="${anchor}">${Math.round(v).toLocaleString()}</text>`;
  const d = rows.map((r, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(r.supply).toFixed(1)).join(' ');
  const area = d + ` L ${X(rows.length - 1).toFixed(1)} ${H - padB} L ${X(0).toFixed(1)} ${H - padB} Z`;
  const ticks = rows.length > 6
    ? [0, Math.floor(rows.length / 2), rows.length - 1]
    : rows.map((_, i) => i);
  return `<svg viewBox="0 0 ${W} ${H}" class="curve" preserveAspectRatio="none" role="img" aria-label="supply over time">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f5b83d" stop-opacity=".18"/>
      <stop offset="1" stop-color="#f5b83d" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#g)"/>
    <path d="${d}" fill="none" stroke="#f5b83d" stroke-width="2" stroke-linejoin="round"/>
    ${rows.map((r, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(r.supply).toFixed(1)}" r="2.4" fill="#f5b83d" opacity=".55"/>`).join('')}
    ${ticks.map(i => `<text x="${X(i).toFixed(1)}" y="${H - 6}" fill="#69707d" font-size="9" font-family="ui-monospace,monospace"
      text-anchor="${i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}">${esc(rows[i].d)}</text>`).join('')}
    <line x1="${padL}" y1="${Y(hi).toFixed(1)}" x2="${W - padR}" y2="${Y(hi).toFixed(1)}" stroke="#242830" stroke-width="1" stroke-dasharray="3 5"/>
    <line x1="${padL}" y1="${Y(lo).toFixed(1)}" x2="${W - padR}" y2="${Y(lo).toFixed(1)}" stroke="#242830" stroke-width="1" stroke-dasharray="3 5"/>
    ${lab(hi, Y(hi) - 5, 'auto')}${lab(lo, Y(lo) + 12, 'auto')}
  </svg>`;
}

module.exports = async (req, res) => {
  const send = (code, html) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'public, max-age=120');
    res.status(code).end(html);
  };

  let base = null, cur = null, incBal = 0, incAcct = null, decimals = 6;
  let mintAuth = 'unknown', freezeAuth = 'unknown', recent = [], rows = [], st = {};
  let err = null;

  try {
    rows = await series(180);
    st = (await hall('h:stats')) || {};
    if (!Object.keys(st).length) st = (await getJSON('g:stats')) || {};
    base = await getJSON('g:supply0');

    if (MINT) {
      const acc = await rpcCall('getAccountInfo', [MINT, { encoding: 'jsonParsed' }]);
      const info = acc && acc.value && acc.value.data && acc.value.data.parsed && acc.value.data.parsed.info;
      if (info) {
        decimals = info.decimals;
        cur = +info.supply / 10 ** decimals;
        mintAuth = info.mintAuthority == null ? 'revoked' : info.mintAuthority;
        freezeAuth = info.freezeAuthority == null ? 'revoked' : info.freezeAuthority;
      }
      const inc = await rpcCall('getTokenAccountsByOwner', [INCINERATOR, { mint: MINT }, { encoding: 'jsonParsed' }]);
      for (const a of (inc && inc.value) || []) {
        incBal += +a.account.data.parsed.info.tokenAmount.uiAmount || 0;
        incAcct = a.pubkey;
      }
      if (incAcct) {
        const sigs = await rpcCall('getSignaturesForAddress', [incAcct, { limit: 12 }]);
        recent = ((sigs || []).filter(s => !s.err) || []).map(s => ({
          sig: s.signature, t: s.blockTime ? s.blockTime * 1000 : null }));
      }
    }
  } catch (e) { err = String(e.message || e).slice(0, 160); }

  const initial = base && Number.isFinite(base.supply) ? base.supply : null;
  const destroyed = (initial != null && cur != null) ? Math.max(0, initial - cur) : null;
  const destroyedPct = (destroyed != null && initial) ? destroyed / initial * 100 : null;
  const playerBurned = Number(st.realBurned) || 0;
  const playerSupply = Math.max(0, playerBurned - incBal);
  const otherDestroyed = destroyed != null ? Math.max(0, destroyed - playerSupply) : null;

  // Burn rate from the last seven complete days — never the partial one, and
  // never at all below MIN_RATE_DAYS.
  //
  // One complete day is not a rate. On the first day this page ran it read
  // 49 tokens burned and confidently reported "49/day — half of what is left
  // is gone in 26,238 years", which is not a projection, it is arithmetic
  // performed on noise. The same rule the observatory uses applies here:
  // withhold the figure and say how many days are still needed.
  const complete = rows.filter(r => !r.partial);
  const last7 = complete.slice(-7);
  const rate = last7.length >= MIN_RATE_DAYS
    ? last7.reduce((a, r) => a + r.burned, 0) / last7.length : null;
  const yearsTo = (rate && cur && rate > 0) ? (cur * 0.5) / rate / 365 : null;

  if (!MINT) {
    return send(200, page('THE SUPPLY CLOCK', 'The token has not launched yet.',
      `<div class="card"><h1>The clock has not started.</h1>
       <p>No mint is configured yet. Every number on this page reads straight off the
       Token-2022 mint account, so it stays empty until there is one.</p>
       <p><a href="${SITE}">Back to RATCHET</a></p></div>`));
  }

  const desc = destroyed != null
    ? `${Math.round(destroyed).toLocaleString()} $RCX destroyed — ${pctS(destroyedPct)} of the supply this pump.fun token launched with. Read off the mint account, one reading a day.`
    : 'Supply destruction on a pump.fun token, read off the mint account daily.';

  const body = `
<div class="k">RATCHET · THE SUPPLY CLOCK</div>
<h1>A pump.fun token that gets smaller every time somebody plays.</h1>
<p class="lede">$RCX launched on <a href="${PUMP}">pump.fun</a>. What happens after a launch is
usually the same everywhere: a fixed supply, a pool, and nothing that ever removes a token from
circulation. Here, <b>70% of every stake is burned</b> — not sent to a treasury, not locked, not
allocated to anything. Destroyed, inside the player's own signed transaction, with a signature you
can open. The mint authority is revoked, so the number below has exactly one direction it can go.
This page is the arithmetic, not the pitch: the mint's own supply field, read off Solana once a day.</p>

<div class="strip">
  <div class="c"><u>SUPPLY NOW</u><b>${n0(cur)}</b><i>read from the mint account just now${err ? ' (last good read)' : ''}</i></div>
  <div class="c"><u>DESTROYED</u><b class="gold">${n0(destroyed)}</b><i>${pctS(destroyedPct)} of the supply at our first reading${initial ? ` (${n0(initial)})` : ''}</i></div>
  <div class="c"><u>BURNED BY PLAYERS</u><b class="grn">${n0(playerBurned)}</b><i>verified by signature and credited in-game — the part the game itself caused</i></div>
  <div class="c"><u>BURN RATE · 7d</u><b>${rate == null ? '—' : n0(rate) + '/day'}</b>
    <i>${rate == null
        ? `withheld until ${MIN_RATE_DAYS} complete days have been measured — ${complete.length} so far. A rate drawn from one day is not a rate.`
        : `at this rate, half of what is left is gone in ${yearsTo < 1 ? Math.round(yearsTo * 12) + ' months' : yearsTo < 500 ? yearsTo.toFixed(1) + ' years' : 'longer than anyone should extrapolate'}`}</i></div>
</div>

${rows.length >= 2 ? `<div class="card">
  <h2>SUPPLY · ${esc(rows[0].d)} → ${esc(rows[rows.length - 1].d)}</h2>
  ${curve(rows)}
  <p class="note"><b style="color:var(--gold)">The vertical axis is zoomed</b> to the range actually
  observed — the two dashed lines are ${n0(Math.max(...rows.map(r => r.supply)))} and
  ${n0(Math.min(...rows.map(r => r.supply)))}, a move of
  ${pctS((Math.max(...rows.map(r => r.supply)) - Math.min(...rows.map(r => r.supply))) / (initial || Math.max(...rows.map(r => r.supply))) * 100)}
  of the launch supply. Against the full billion this line would be flat, and a flat line would
  understate a real effect as badly as an unlabelled zoom would overstate one. One reading per day,
  taken from the mint account itself — not from our own counters. The last point is today and is
  still moving. Days we never woke up for are simply absent; the line joins what we actually saw
  rather than inventing what we did not.</p>
</div>` : `<div class="card"><h2>SUPPLY CURVE</h2>
  <p class="note">The curve needs at least two daily readings. It starts drawing itself tomorrow.</p></div>`}

<div class="card">
  <h2>WHO DESTROYED WHAT</h2>
  <p>Two very different things reduce this supply, and bundling them into one number would flatter us.
  So they are separate.</p>
  <div class="split">
    <div><u>PLAYERS · ${n0(playerSupply)}</u>
      <p>Burned by people using the game. Every one of these was signed by the player's own wallet,
      verified against the chain, and replay-gated by signature before it credited anything. This is the
      number that grows when the game is used, and the only one we take any credit for.</p></div>
    <div><u>LAUNCHPAD &amp; OTHER · ${n0(otherDestroyed)}</u>
      <p>Everything else that left the supply. For $RCX this is dominated by pump.fun burning the unsold
      remainder of the bonding curve at graduation — a one-time event that had nothing to do with the game.
      We report it rather than absorb it.</p></div>
  </div>
  ${incBal > 0 ? `<p class="note">A further <b>${n0(incBal)}</b> sits at the incinerator address, which no
  one holds a key to. Manual reloads land there; one-click reloads burn straight from the player's account.
  Either way it is gone, but only the second kind has already left the supply field above.</p>` : ''}
</div>

<div class="card">
  <h2>THE LAST BURNS, ON CHAIN</h2>
  ${recent.length ? `<div class="sigs">${recent.map(r => `<a href="${SOLSCAN}/tx/${esc(r.sig)}" target="_blank" rel="noopener">
    <code>${esc(short(r.sig))}</code><span>${esc(when(r.t))}</span></a>`).join('')}</div>`
    : '<p class="note">No burn transactions read back yet. This list is pulled live from the incinerator account, so it fills itself in.</p>'}
  <p class="note">Pulled from <code>getSignaturesForAddress</code> on the incinerator token account. Not our
  record of the burns — the chain's.</p>
</div>

<div class="card">
  <h2>WHY THIS MATTERS FOR A LAUNCHPAD TOKEN</h2>
  <ul>
    <li><b>The sink is usage, not a promise.</b> Nobody has to decide to burn anything. It happens because
      someone took a shot, at the same fixed 70/30/0 split, in their own transaction.</li>
    <li><b>Nobody can undo it.</b> Mint authority: <span class="${mintAuth === 'revoked' ? 'grn' : 'red'}">${esc(mintAuth)}</span>.
      Freeze authority: <span class="${freezeAuth === 'revoked' ? 'grn' : 'red'}">${esc(freezeAuth)}</span>.
      Supply has one direction available to it.</li>
    <li><b>The creator earns from pump.fun, not from players.</b> Trading fees on the pool are the only
      revenue that exists. The game takes zero percent of stakes, pots, or burns — there is no treasury
      wallet to take it into.</li>
    <li><b>It is checkable by a stranger.</b> Everything on this page comes from the mint account, the
      incinerator account, and signatures. You do not have to believe the site to check the token.</li>
  </ul>
</div>

<div class="card">
  <h2>LIMITS</h2>
  <ul>
    <li>"Destroyed" is measured against the first supply reading this site ever took, not against the mint's
      genesis supply. Anything burned before we started looking is not in the number.</li>
    <li>Daily readings are taken by a serverless function that only runs when someone visits. A quiet day
      can be missing, and a missing day is drawn as a gap, never as a flat line.</li>
    <li>The 7-day burn rate excludes today, because today is incomplete and would drag the average down,
      and is withheld entirely below ${MIN_RATE_DAYS} complete days. Early on, the honest answer to "how fast
      is it burning" is that we do not know yet.</li>
    <li>Player burns come from our own verified counter; total destruction comes from the chain. They are
      published side by side on purpose — if we ever miscount, the two will disagree in public.</li>
  </ul>
</div>`;

  return send(200, page('THE SUPPLY CLOCK · $RCX', desc, body));

  function page(title, description, inner) {
    return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}">
<style>
:root{--bg:#07080a;--card:#101216;--card2:#161920;--line:#242830;--ink:#e9ecf1;--ink2:#aab2c0;
  --dim:#69707d;--gold:#f5b83d;--grn:#3ddc84;--red:#ff5c5c;--ice:#7fd4ff;
  --mono:ui-monospace,SFMono-Regular,Menlo,monospace;--sans:system-ui,-apple-system,Segoe UI,sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 var(--sans);
  display:flex;justify-content:center;padding:28px 16px}
.w{width:100%;max-width:900px}
.k{font:700 9.5px var(--mono);letter-spacing:.16em;color:var(--dim);margin-bottom:10px}
h1{font:800 27px/1.2 var(--sans);margin:0 0 10px;letter-spacing:-.01em}
h2{font:700 9.5px var(--mono);letter-spacing:.16em;color:var(--dim);margin:0 0 12px}
.lede{color:var(--ink2);font-size:14.5px;max-width:78ch;margin:0 0 22px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin-bottom:16px}
.strip{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--line);
  border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:16px}
@media(min-width:760px){.strip{grid-template-columns:repeat(4,minmax(0,1fr))}}
.c{background:var(--card2);padding:13px 14px}
.c u{display:block;font:700 8.5px var(--mono);letter-spacing:.14em;color:var(--dim);text-decoration:none;margin-bottom:5px}
.c b{font:800 20px var(--mono);word-break:break-all}
.c i{font-style:normal;font:400 11px/1.45 var(--sans);color:var(--dim);display:block;margin-top:5px}
.curve{display:block;width:100%;height:220px;margin:2px 0 6px}
.split{display:grid;grid-template-columns:1fr;gap:1px;background:var(--line);border:1px solid var(--line);
  border-radius:12px;overflow:hidden;margin:14px 0 0}
@media(min-width:680px){.split{grid-template-columns:1fr 1fr}}
.split>div{background:var(--card2);padding:14px 15px}
.split u{display:block;font:800 12px var(--mono);letter-spacing:.06em;color:var(--gold);text-decoration:none;margin-bottom:7px}
.split p{margin:0;font-size:12.5px}
.sigs{display:flex;flex-wrap:wrap;gap:7px}
.sigs a{display:flex;align-items:center;gap:8px;background:var(--card2);border:1px solid var(--line);
  border-radius:9px;padding:8px 11px;text-decoration:none}
.sigs code{font:700 11px var(--mono);color:var(--ice)}
.sigs span{font:600 9px var(--mono);color:var(--dim)}
.note{color:var(--dim);font-size:12px;margin:12px 0 0}
p{color:var(--ink2);font-size:13.5px}
ul{margin:0;padding-left:18px;color:var(--ink2);font-size:13px}
li{margin-bottom:8px}
code{font:600 11.5px var(--mono);color:var(--ice)}
.gold{color:var(--gold)}.grn{color:var(--grn)}.red{color:var(--red)}
a{color:var(--gold)}
.f{margin:20px 0 6px;font:600 10px var(--mono);letter-spacing:.08em;color:var(--dim);text-align:center;line-height:2}
</style></head><body><div class="w">${inner}
<div class="f"><a href="${SITE}">RATCHET</a> · <a href="${PUMP}">pump.fun</a> ·
<a href="${SOLSCAN}/token/${esc(MINT)}">mint</a> · <a href="/api/feeds">observatory</a> · <a href="/api/record">the record</a> ·
<a href="https://github.com/3esign/ratchetx">source</a> · ${esc(VERSION)}${err ? ' · partial read: ' + esc(err) : ''}</div>
</div></body></html>`;
  }
};
