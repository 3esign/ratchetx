// ============================================================
//  api/feeds.js — THE OBSERVATORY.
//
//  A public, continuously updated, third-party measurement of Pyth's
//  sponsored push feeds on Solana, taken by a consumer that settles real
//  money on them.
//
//  WHY WE PUBLISH IT.
//  Pyth publishes the advertised parameters — 60s heartbeat, 0.5% deviation
//  trigger, sponsored on mainnet. What nobody publishes is the observed
//  behaviour: how wide the confidence band actually runs, how long the worst
//  gap actually was, how far the price actually sat from an unrelated venue,
//  and — the part only a betting game can measure — how many settlements the
//  feed's timing actually cost. We are already sampling every minute for our
//  own settlement record. Keeping the by-product costs us nothing and gives
//  the people who run the oracle a signal they cannot generate themselves,
//  because it has to come from outside.
//
//  It is deliberately unflattering where the truth is unflattering. The
//  first number on the page is OUR sampling duty cycle, not theirs, because
//  a measurement that cannot be wrong about itself cannot be trusted about
//  anyone else.
// ============================================================
const { report } = require('../lib/feedhealth.js');
const { ACCOUNTS, MAX_AGE_S } = require('../lib/onchain_px.js');

const VERSION = 'h38-2026-08-20';
const SITE = 'https://ratchetx.vercel.app';
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const n0 = v => (v == null ? '—' : Math.round(v).toLocaleString());
const n2 = v => (v == null ? '—' : (+v).toFixed(2));
const secs = v => (v == null ? '—' : v >= 120 ? `${(v / 60).toFixed(1)}m` : `${Math.round(v)}s`);
const ago = t => {
  if (!t) return '—';
  const d = Math.max(0, Math.floor(Date.now() / 1000) - t);
  return d < 90 ? `${d}s ago` : d < 5400 ? `${Math.round(d / 60)}m ago` : `${(d / 3600).toFixed(1)}h ago`;
};

module.exports = async (req, res) => {
  // One clamp, in one place: report() owns the bounds and reports back the
  // window it actually used. Everything below reads rep.windowHours so the
  // page can never label a 24h report as the 9999h someone asked for.
  let rep;
  try {
    rep = await report(Number(req.query.hours));
  } catch (e) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.status(503).end(`<!doctype html><meta charset="utf-8"><title>RATCHET · observatory</title>
      <body style="background:#07080a;color:#aab2c0;font:15px system-ui;padding:40px">
      The observatory could not read its own record: ${esc(String(e.message || e))}.
      <a style="color:#f5b83d" href="${SITE}">back</a></body>`);
  }

  if (String(req.query.format || '').toLowerCase() === 'json') {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('cache-control', 'public, max-age=60');
    return res.json({ ok: true, v: VERSION, ...rep });
  }

  const FEEDS = Object.keys(rep.feeds);
  const live = FEEDS.filter(f => rep.feeds[f].samples > 0);
  // Only feeds whose distributions we are actually willing to publish can win
  // "worst gap" — otherwise the headline names a feed off a single observation,
  // which is precisely the thing the withholding rule exists to prevent.
  const ranked = live.filter(f => rep.feeds[f].gapMaxS != null)
    .sort((a, b) => rep.feeds[b].gapMaxS - rep.feeds[a].gapMaxS);
  const worst = ranked[0];
  const warming = live.length > 0 && live.every(f => rep.feeds[f].thin);
  const totalVoids = FEEDS.reduce((a, f) => a + rep.settle[f].voided, 0);
  const totalDefer = FEEDS.reduce((a, f) => a + rep.settle[f].deferred, 0);
  const totalSet = FEEDS.reduce((a, f) => a + rep.settle[f].settled, 0);

  const row = f => {
    const d = rep.feeds[f];
    const acct = (ACCOUNTS[f] || [])[0];
    const bad = (d.staleWindows || 0) > 0 || (d.coverage != null && d.coverage < 99);
    return `<tr>
      <td><b>${esc(f)}</b><a class="acct" href="https://solscan.io/account/${esc(acct)}" target="_blank" rel="noopener">${esc(String(acct).slice(0, 4))}…${esc(String(acct).slice(-4))}</a></td>
      <td>${n0(d.samples)}</td>
      <td class="${d.coverage != null && d.coverage < 99 ? 'warn' : ''}">${d.coverage == null ? '—' : n2(d.coverage) + '%'}</td>
      <td class="${d.thin ? 'warn' : ''}">${n0(d.telemetry)}</td>
      <td>${n0(d.updates)}</td>
      <td class="dim">${n0(d.blindWindows)}</td>
      <td>${secs(d.gapMedS)}</td>
      <td>${secs(d.gapP95S)}</td>
      <td class="${bad ? 'warn' : ''}">${secs(d.gapMaxS)}</td>
      <td class="${d.staleWindows == null ? 'dim' : d.staleWindows > 0 ? 'warn' : 'good'}">${n0(d.staleWindows)}</td>
      <td>${secs(d.ageMedS)}</td>
      <td>${n2(d.confMedBps)}</td>
      <td>${n2(d.confP95Bps)}</td>
      <td>${n2(d.divMedBps)}</td>
      <td>${n2(d.divMaxBps)}</td>
      <td class="dim">${n0(d.divSamples)}</td>
      <td class="dim">${esc(ago(d.lastPublish))}</td>
    </tr>`;
  };

  const srow = f => {
    const s = rep.settle[f];
    if (!s.settled && !s.deferred && !s.voided) return '';
    return `<tr><td><b>${esc(f)}</b></td><td>${n0(s.settled)}</td>
      <td class="${s.deferred ? 'warn' : ''}">${n0(s.deferred)}</td>
      <td class="${s.voided ? 'bad' : 'good'}">${n0(s.voided)}</td></tr>`;
  };
  const settleRows = FEEDS.map(srow).join('');

  const desc = `Third-party measurement of Pyth sponsored push feeds on Solana, taken by a game that settles real bets on them. ${n0(rep.pythSamples)} samples over ${rep.windowHours}h.`;

  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>THE OBSERVATORY · Pyth sponsored feeds, measured</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="THE OBSERVATORY · Pyth sponsored feeds, measured">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="THE OBSERVATORY · Pyth sponsored feeds, measured">
<meta name="twitter:description" content="${esc(desc)}">
<style>
:root{--bg:#07080a;--card:#101216;--card2:#161920;--line:#242830;--ink:#e9ecf1;--ink2:#aab2c0;
  --dim:#69707d;--gold:#f5b83d;--grn:#3ddc84;--red:#ff5c5c;--ice:#7fd4ff;
  --mono:ui-monospace,SFMono-Regular,Menlo,monospace;--sans:system-ui,-apple-system,Segoe UI,sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 var(--sans);
  display:flex;justify-content:center;padding:28px 16px}
.w{width:100%;max-width:1080px}
.k{font:700 9.5px var(--mono);letter-spacing:.16em;color:var(--dim);margin-bottom:10px}
h1{font:800 26px/1.2 var(--sans);margin:0 0 10px;letter-spacing:-.01em}
h2{font:700 9.5px var(--mono);letter-spacing:.16em;color:var(--dim);margin:0 0 10px}
.lede{color:var(--ink2);font-size:14.5px;max-width:78ch;margin:0 0 22px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin-bottom:16px}
.strip{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--line);
  border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:16px}
@media(min-width:760px){.strip{grid-template-columns:repeat(4,minmax(0,1fr))}}
.c{background:var(--card2);padding:13px 14px}
.c u{display:block;font:700 8.5px var(--mono);letter-spacing:.14em;color:var(--dim);text-decoration:none;margin-bottom:5px}
.c b{font:800 19px var(--mono)}
.c i{font-style:normal;font:400 11px/1.45 var(--sans);color:var(--dim);display:block;margin-top:4px}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -4px;padding:0 4px}
table{border-collapse:collapse;width:100%;min-width:900px;font:600 12px var(--mono)}
th{font:700 8.5px var(--mono);letter-spacing:.1em;color:var(--dim);text-align:right;
  padding:0 10px 9px;border-bottom:1px solid var(--line);white-space:nowrap}
th:first-child,td:first-child{text-align:left}
td{padding:9px 10px;border-bottom:1px solid #1a1d23;text-align:right;white-space:nowrap}
tr:last-child td{border-bottom:none}
.acct{display:block;font:600 9px var(--mono);color:var(--dim);text-decoration:none;margin-top:2px}
.acct:hover{color:var(--ice)}
.warn{color:var(--gold)}.bad{color:var(--red)}.good{color:var(--grn)}.dim{color:var(--dim)}
ul{margin:0;padding-left:18px;color:var(--ink2);font-size:13px}
li{margin-bottom:7px}
p{color:var(--ink2);font-size:13.5px}
a{color:var(--gold)}
.f{margin:20px 0 6px;font:600 10px var(--mono);letter-spacing:.08em;color:var(--dim);text-align:center}
.tag{display:inline-block;font:700 8.5px var(--mono);letter-spacing:.12em;padding:4px 8px;
  border:1px solid var(--line);border-radius:999px;color:var(--ice);margin-left:8px;vertical-align:middle}
</style></head><body><div class="w">

<div class="k">RATCHET · THE OBSERVATORY<span class="tag">${esc(rep.windowHours)}H WINDOW</span></div>
<h1>What Pyth's sponsored feeds actually did.</h1>
<p class="lede">RATCHET settles real bets off Pyth's sponsored push feeds on Solana, which makes it a
consumer that cannot look away when one misbehaves: a late publish here is not a log line, it is a
voided bet and a refunded stake. We already read every feed once a minute to keep our own settlement
record. These are the statistics that fall out of it — published because the advertised parameters are
public and the observed ones are not, and because this kind of number has to come from outside the
oracle to mean anything. Nothing here is a complaint. It is a measurement, with its own blind spots
listed at the bottom.</p>

${warming ? `<div class="card" style="border-color:#3a3218;background:linear-gradient(90deg,rgba(245,184,61,.06),transparent)">
  <h2 style="color:var(--gold)">STILL WARMING UP</h2>
  <p style="margin:0">Price sampling has been running since long before this page existed, so the read
  counts below are already deep. The telemetry those reads carry — publish time, confidence band, age —
  only started when the observatory shipped. Until a feed has at least
  <b style="color:var(--ink)">${rep.minObs}</b> telemetry reads, its gap, age and confidence figures are
  <b style="color:var(--ink)">withheld rather than published thin</b>: a median drawn from two
  observations is not a median, and this page would rather show you a dash than a decimal point it
  cannot stand behind. Nothing is broken. Check back in an hour.</p>
</div>` : ''}
<div class="strip">
  <div class="c"><u>OUR SAMPLING DUTY</u><b class="${rep.ourDutyPct != null && rep.ourDutyPct < 60 ? 'warn' : ''}">${rep.ourDutyPct == null ? '—' : n2(rep.ourDutyPct) + '%'}</b>
    <i>${n0(rep.samples)} of ${n0(rep.expectedSamples)} possible minutes. Ours, not theirs — a serverless instance nobody woke records nothing.</i></div>
  <div class="c"><u>READ FROM PYTH</u><b>${n0(rep.pythSamples)}</b>
    <i>samples where the on-chain accounts answered. ${esc(Object.entries(rep.srcMix).map(([k, v]) => `${k} ${v}`).join(' · ') || '—')}</i></div>
  <div class="c"><u>WORST GAP · UPPER BOUND</u><b class="${worst && rep.feeds[worst].gapMaxS > MAX_AGE_S ? 'warn' : 'good'}">${worst ? secs(rep.feeds[worst].gapMaxS) : '—'}</b>
    <i>${worst ? esc(worst) + ' — longest interval we can attribute to the feed. Windows where we stopped looking are excluded, not counted against it.'
        : 'withheld until a feed has ' + rep.minObs + ' telemetry reads. A worst case drawn from two observations is not a worst case.'}</i></div>
  <div class="c"><u>SETTLEMENTS COST</u><b class="${totalVoids ? 'bad' : 'good'}">${n0(totalVoids)}</b>
    <i>bets voided and refunded because no oracle sample landed inside the 15-minute grace window. ${n0(totalDefer)} deferred, ${n0(totalSet)} settled clean.</i></div>
</div>

<div class="card">
  <h2>PER FEED · LAST ${esc(rep.windowHours)} HOURS</h2>
  <div class="scroll"><table>
    <thead><tr>
      <th>FEED</th><th>SAMPLES</th><th>USABLE</th><th title="reads carrying publish_time and confidence">TELEMETRY</th><th>ADVANCES</th><th title="windows we were not looking">BLIND (OURS)</th>
      <th>GAP MED</th><th>GAP P95</th><th>GAP MAX</th><th>STALE&gt;${MAX_AGE_S}s</th>
      <th>AGE MED</th><th>CONF MED</th><th>CONF P95</th>
      <th>DIV MED</th><th>DIV MAX</th><th>DIV n</th><th>LAST PUBLISH</th>
    </tr></thead>
    <tbody>${FEEDS.map(row).join('')}</tbody>
  </table></div>
  <p style="margin:14px 0 0">
    <b style="color:var(--ink)">USABLE</b> — share of our Pyth reads where this feed passed every check
    (owner is a Pyth program, discriminator is PriceUpdateV2, verification level is Full, feed id matches,
    publish age under ${MAX_AGE_S}s). <b style="color:var(--ink)">TELEMETRY</b> — reads that carried
    publish_time, confidence and age, which is what every distribution to the right is computed from. It is
    lower than SAMPLES because price sampling predates this page; below ${rep.minObs} the distributions are
    withheld and the cell shows a dash. <b style="color:var(--ink)">ADVANCES</b> — publish_time moves we could
    attribute to the feed. <b style="color:var(--ink)">BLIND (OURS)</b> — pairs of looks more than
    ${Math.round(rep.blindMs / 1000)}s apart, where <i>we</i> stopped sampling; thrown out of every figure on this
    row rather than charged to the feed, because our outage is not their stall.
    <b style="color:var(--ink)">GAP</b> — seconds between consecutive publish_times.
    <b style="color:var(--gold)">This is an upper bound</b>: we only ever see a feed's latest publish, so an
    interval we measure may contain publishes we never saw. <b style="color:var(--ink)">AGE</b> — how old the
    price was when we read it, truncated by our own ${MAX_AGE_S}s filter (anything older is a miss, not an age).
    <b style="color:var(--ink)">CONF</b> — the publishers' own confidence band, in basis points of price.
    <b style="color:var(--ink)">DIV</b> — absolute distance from Coinbase spot, in basis points, sampled
    every 10 minutes, withheld below ${rep.minDiv} cross-checks; <b style="color:var(--ink)">DIV n</b> is how many
    there have been.
  </p>
</div>

${settleRows ? `<div class="card">
  <h2>WHAT THE TIMING COST · LIFETIME</h2>
  <p style="margin:0 0 12px">This is the part only a game can measure. A shot expires; we look for the
  first oracle sample at or after that instant. If none has landed yet the shot is <b style="color:var(--gold)">deferred</b>
  and we look again. If the 15-minute grace window closes with nothing, the shot is <b style="color:var(--red)">voided</b>
  and the stake goes back — nobody wins, nobody loses, and the feed's timing is the only reason.</p>
  <div class="scroll"><table style="min-width:420px">
    <thead><tr><th>FEED</th><th>SETTLED CLEAN</th><th>DEFERRED</th><th>VOIDED</th></tr></thead>
    <tbody>${settleRows}</tbody>
  </table></div>
</div>` : `<div class="card"><h2>WHAT THE TIMING COST · LIFETIME</h2>
  <p style="margin:0">No settlements measured yet — these counters started at ${esc(VERSION)}. This box
  fills in as shots settle.</p></div>`}

<div class="card">
  <h2>METHOD</h2>
  <ul>
    <li>One <code>getMultipleAccounts</code> read of each sponsored price account per minute, over plain
      Solana JSON-RPC. No Pyth API, no key, no plan — these are ordinary accounts and reading an account
      is not something anyone can bill for.</li>
    <li><code>PriceUpdateV2</code> is decoded locally from the raw bytes. A number is kept only if the
      account owner is one of Pyth's own programs, the Anchor discriminator matches
      <code>sha256("account:PriceUpdateV2")[..8]</code>, the verification level is <b>Full</b>, the
      32-byte feed id equals the one we expect, and <code>publish_time</code> is under ${MAX_AGE_S}s old.
      Anything else is dropped and counted as unusable rather than quietly used.</li>
    <li>Settlement uses the first recorded sample at or after a shot's expiry — the same first-crossing
      rule (<code>prev_publish_time &lt; expiry &lt;= publish_time</code>) the on-chain program enforces —
      so these samples are not a side record. They are the evidence.</li>
    <li>Every sample behind every statistic is served back raw:
      <code>/api/game?action=path&amp;feed=SOL&amp;from=&lt;ms&gt;&amp;to=&lt;ms&gt;</code>. Recompute anything here, or
      disagree with it, without asking us.</li>
  </ul>
</div>

<div class="card">
  <h2>LIMITS</h2>
  <ul>${rep.limits.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
</div>

<div class="f">
  <a href="?format=json&hours=${esc(rep.windowHours)}">JSON</a> ·
  <a href="?hours=1">1h</a> · <a href="?hours=24">24h</a> · <a href="?hours=72">72h</a> ·
  <a href="${SITE}">RATCHET</a> ·
  <a href="/api/supply">supply clock</a> ·
  <a href="/api/record">the record</a> ·
  <a href="https://github.com/3esign/ratchetx">source</a> ·
  measured by a consumer with money on it · ${esc(VERSION)}
</div>
</div></body></html>`;

  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=60');
  return res.status(200).end(html);
};
