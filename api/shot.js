// ============================================================
//  api/shot.js — one settled shot, as a public, checkable page.
//
//  WHY THIS EXISTS.
//  Everything the game does is verifiable and none of it leaves the site. A
//  player who calls a hard move has a row in a list; the only way to show
//  anyone is a screenshot, and a screenshot of a claim is worth nothing.
//
//  This turns a settled shot into a URL. It carries the sealed commitment,
//  the revealed side and salt, both prices, and the exact oracle sample that
//  decided it — so the person you send it to can recompute the hash and
//  check the arithmetic without trusting either of us.
//
//  ONLY SETTLED SHOTS. An open shot's side is sealed and this route must
//  never be the hole in that.
// ============================================================
const { getJSON } = require('../lib/kv.js');
const { pathFor } = require('../lib/pxlog.js');
const { isWalletShaped, isDemo } = require('../lib/verify.js');
const crypto = require('node:crypto');

const VERSION = 'h57-2026-08-22';
const SITE = (process.env.PUBLIC_ORIGIN || 'https://ratchetx.xyz').replace(/\/$/, '');
const sha256hex = s => crypto.createHash('sha256').update(s).digest('hex');
const esc = s => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const short = w => String(w).slice(0,4) + '…' + String(w).slice(-4);
const money = n => !Number.isFinite(n) ? '—'
  : Math.abs(n) >= 1000 ? n.toLocaleString(undefined,{maximumFractionDigits:0})
  : Math.abs(n) >= 1 ? n.toFixed(2) : Math.abs(n) >= 0.01 ? n.toFixed(4)
  : Number(n.toPrecision(4)).toString();

function spark(rows, entry, settleAt, up) {
  if (!rows || rows.length < 2) return '';
  const W = 640, H = 120, pad = 8;
  const ys = rows.map(r => r[1]).concat(Number.isFinite(entry) ? [entry] : []);
  const lo = Math.min(...ys), hi = Math.max(...ys), span = (hi - lo) || 1;
  const t0 = rows[0][0], t1 = rows[rows.length-1][0], ts = (t1 - t0) || 1;
  const X = t => pad + ((t - t0) / ts) * (W - pad*2);
  const Y = v => H - pad - ((v - lo) / span) * (H - pad*2);
  const d = rows.map((r,i) => (i?'L':'M') + X(r[0]).toFixed(1) + ' ' + Y(r[1]).toFixed(1)).join(' ');
  const col = up ? '#3ddc84' : '#ff5c5c';
  const dec = rows.find(r => r[0] >= settleAt) || rows[rows.length-1];
  return `<svg viewBox="0 0 ${W} ${H}" class="sp" preserveAspectRatio="none" aria-label="oracle path">
    ${Number.isFinite(entry) ? `<line x1="${pad}" y1="${Y(entry).toFixed(1)}" x2="${W-pad}" y2="${Y(entry).toFixed(1)}"
      stroke="#2a2d33" stroke-width="1" stroke-dasharray="4 4"/>` : ''}
    <path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${X(dec[0]).toFixed(1)}" cy="${Y(dec[1]).toFixed(1)}" r="4" fill="${col}"/></svg>`;
}

module.exports = async (req, res) => {
  const send = (code, html) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'public, max-age=60');
    res.status(code).end(html);
  };
  const page = (title, desc, body) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}">
<style>
:root{--bg:#07080a;--card:#101216;--card2:#161920;--line:#242830;--ink:#e9ecf1;--ink2:#aab2c0;
  --dim:#69707d;--gold:#f5b83d;--grn:#3ddc84;--red:#ff5c5c;--ice:#7fd4ff;
  --mono:ui-monospace,SFMono-Regular,Menlo,monospace;--sans:system-ui,-apple-system,Segoe UI,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 var(--sans);
  display:flex;justify-content:center;padding:28px 16px}
.w{width:100%;max-width:680px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px}
h1{font:800 17px/1.35 var(--sans);margin:0 0 4px}
.k{font:700 9.5px var(--mono);letter-spacing:.16em;color:var(--dim);margin-bottom:12px}
.verdict{font:900 30px/1 var(--mono);letter-spacing:.1em;margin:14px 0 4px}
.hit{color:var(--grn)}.miss{color:var(--red)}.void{color:var(--dim)}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--line);
  border:1px solid var(--line);border-radius:11px;overflow:hidden;margin:16px 0}
@media(min-width:520px){.grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
.c{background:var(--card2);padding:11px 12px}
.c u{display:block;font:700 8.5px var(--mono);letter-spacing:.14em;color:var(--dim);text-decoration:none;margin-bottom:5px}
.c b{font:800 14px var(--mono)}
.sp{display:block;width:100%;height:120px;margin:8px 0 4px}
.proof{background:var(--card2);border:1px solid var(--line);border-radius:11px;padding:14px;margin-top:14px}
.proof h2{font:700 9.5px var(--mono);letter-spacing:.16em;color:var(--dim);margin:0 0 9px}
code{font:600 11px/1.7 var(--mono);color:var(--ice);word-break:break-all}
.ok{color:var(--grn);font:800 10px var(--mono);letter-spacing:.1em}
.f{margin-top:16px;font:600 10px var(--mono);letter-spacing:.08em;color:var(--dim);text-align:center}
a{color:var(--gold)}
</style></head><body><div class="w">${body}
<div class="f"><a href="${SITE}">RATCHET</a> · sealed before the outcome · settled on Pyth read off Solana · ${esc(VERSION)}</div>
</div></body></html>`;

  try {
    const w = String(req.query.w || '').trim();
    const id = String(req.query.id || '').trim();
    if ((!isWalletShaped(w) && !isDemo(w)) || !/^[a-z0-9]{4,16}$/i.test(id))
      return send(400, page('RATCHET', 'Not a shot.', '<div class="card"><h1>Not a shot.</h1></div>'));

    const p = await getJSON(`u:${w}`);
    const s = p && (p.closed || []).find(x => x && x.id === id);
    // open shots are sealed; this route is not the way around that
    if (!s || !s.res || s.res === 'open')
      return send(404, page('RATCHET', 'No settled shot with that id.',
        '<div class="card"><h1>No settled shot with that id.</h1>'
        + `<div class="k">An open shot stays sealed until it settles.</div></div>`));

    const hit = s.res === 'hit', vd = s.res === 'void';
    const verdict = vd ? 'VOID' : hit ? 'HIT' : 'MISS';
    const up = Number.isFinite(s.exitPx) && Number.isFinite(s.entry) ? s.exitPx >= s.entry : true;
    const moved = Number.isFinite(s.exitPx) && Number.isFinite(s.entry) && s.entry
      ? ((s.exitPx - s.entry) / s.entry) * 100 : null;

    // the whole point: recompute the commitment in front of the reader
    const recomputed = (s.side && s.salt) ? sha256hex(`${s.side}|${s.salt}`) : null;
    const matches = recomputed && s.commit && recomputed === s.commit;

    let path = [];
    try {
      if (s.feed && s.t && (s.settledAt || s.exp))
        path = await pathFor(s.feed, s.t - 60e3, (s.settledAt || s.exp) + 60e3);
    } catch {}

    const title = `${verdict} — ${s.label || 'RATCHET shot'}`;
    const desc = `Called ${s.side}. ${Number.isFinite(s.entry) ? `Entry $${money(s.entry)}` : ''}`
      + `${Number.isFinite(s.exitPx) ? ` → exit $${money(s.exitPx)}` : ''}`
      + `${moved != null ? ` (${moved >= 0 ? '+' : ''}${moved.toFixed(2)}%)` : ''}`
      + ` · sealed as a hash before the outcome, settled on Pyth.`;

    const xpAwarded = vd ? 0 : hit ? Number(s.xp||0)
      : Number.isFinite(+s.settleXp) ? Number(s.xp||0) : 0;
    const body = `<div class="card">
  <div class="k">${esc(short(w))} · ${esc(new Date(s.t || Date.now()).toISOString().replace('T',' ').slice(0,16))} UTC</div>
  <h1>${esc(s.label || 'shot')}</h1>
  <div class="verdict ${vd?'void':hit?'hit':'miss'}">${verdict}${vd?' — REFUNDED':''}</div>
  <div class="k" style="margin:0">CALLED <b style="color:var(--ink)">${esc(s.side || '—')}</b>${
    Number.isFinite(s.stake) ? ` · STAKED ${s.stake.toLocaleString()}` : ''}${
    hit && s.back ? ` · RETURNED ${Number(s.back).toLocaleString()}` : ''}</div>
  ${spark(path, s.entry, s.settledAt || s.exp, up)}
  <div class="grid">
    <div class="c"><u>ENTRY</u><b>$${esc(money(s.entry))}</b></div>
    <div class="c"><u>EXIT</u><b>$${esc(money(s.exitPx))}</b></div>
    <div class="c"><u>MOVED</u><b style="color:${moved==null?'var(--dim)':moved>=0?'var(--grn)':'var(--red)'}">${
      moved==null?'—':(moved>=0?'+':'')+moved.toFixed(2)+'%'}</b></div>
    <div class="c"><u>XP</u><b>${xpAwarded ? '+'+esc(xpAwarded) : '0'}</b></div>
    <div class="c"><u>CREDITS</u><b>${s.res === 'void' ? '+'+Number(s.stake||0).toLocaleString()+' REFUND' : s.res === 'hit' ? '+'+Number(s.back||0).toLocaleString() : '+0'}</b></div>
  </div>
  <div class="proof">
    <h2>CHECK IT YOURSELF</h2>
    <div class="k" style="margin-bottom:8px">The side was stored only as a hash until this shot settled.
      Recompute it — no part of this needs trusting us.</div>
    <code>sha256("${esc(s.side)}|${esc(s.salt || '')}")<br>= ${esc(recomputed || '—')}</code>
    <div class="k" style="margin:9px 0 4px">SEALED COMMITMENT</div>
    <code>${esc(s.commit || '—')}</code>
    <div style="margin-top:9px" class="${matches?'ok':''}">${matches
      ? '✓ MATCHES — the answer scored is the answer given'
      : '<span style="color:var(--red);font:800 10px var(--mono)">NO COMMITMENT RECORDED</span>'}</div>
    ${s.exitAt ? `<div class="k" style="margin:11px 0 4px">SETTLING ORACLE SAMPLE</div>
      <code>${esc(new Date(s.exitAt).toISOString())} · first Pyth print at or after expiry</code>` : ''}
  </div>
</div>`;
    return send(200, page(title, desc, body));
  } catch (e) {
    return send(500, page('RATCHET', 'Error', '<div class="card"><h1>Something broke.</h1></div>'));
  }
};
