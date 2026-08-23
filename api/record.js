// ============================================================
//  api/record.js — THE RECORD, as a public dataset.
//
//  Open, paginated, CORS-open, unauthenticated, free. No key, no signup, no
//  rate deal, no attribution requirement. The corpus is only worth something
//  if people can actually use it, and every barrier is a reason not to.
//
//  GET /api/record                      → this page
//  GET /api/record?format=ndjson        → one JSON object per line
//  GET /api/record?format=csv           → the same rows, flat
//  GET /api/record?format=json          → { rows, cursor, chain }
//    &after=<i>   cursor: the chain index the previous page ended on
//    &limit=<n>   up to 1000
//
//  Every response carries the hash-chain head and the issued-entry count, so
//  a consumer can check that the corpus they downloaded is the corpus we
//  published rather than taking our word for it.
// ============================================================
const { rows, toCsv, COLUMNS, SCHEMA, SALT, MAX_LIMIT } = require('../lib/record.js');
const { logCount } = require('../lib/log.js');
const { getJSON } = require('../lib/kv.js');

const VERSION = 'h66-2026-08-23';
const SITE = (process.env.PUBLIC_ORIGIN || 'https://ratchetx.xyz').replace(/\/$/, '');
const REPO = 'https://github.com/3esign/ratchetx';
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

module.exports = async (req, res) => {
  const fmt = String(req.query.format || '').toLowerCase();
  const after = Math.max(0, Number(req.query.after) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || 200));

  let head = null, count = 0, out = null, err = null;
  try {
    head = await getJSON('g:log:head');
    count = await logCount();
    if (fmt) out = await rows({ after, limit });
  } catch (e) { err = String(e.message || e).slice(0, 160); }

  const chain = { head, issued: count, verify: `${SITE}/api/snapshot` };

  if (fmt && !err) {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('cache-control', 'public, max-age=30');
    res.setHeader('x-ratchet-cursor', String(out.cursor));
    res.setHeader('x-ratchet-schema', String(SCHEMA));
    if (fmt === 'csv') {
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      return res.status(200).end(toCsv(out.rows));
    }
    if (fmt === 'ndjson') {
      res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
      return res.status(200).end(out.rows.map(r => JSON.stringify(r)).join('\n') + (out.rows.length ? '\n' : ''));
    }
    return res.status(200).json({ ok: true, v: VERSION, schema: SCHEMA,
      count: out.rows.length, cursor: out.cursor, chain, rows: out.rows });
  }
  if (fmt && err) {
    res.setHeader('access-control-allow-origin', '*');
    return res.status(503).json({ ok: false, reason: err });
  }

  const ex = `curl -s '${SITE}/api/record?format=ndjson&limit=1000&after=0'`;
  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>THE RECORD · sealed predictions, settled on chain</title>
<meta name="description" content="An open, tamper-evident dataset of predictions that were sealed before the outcome, backed by a stake, and settled by a deterministic oracle rule. Free, CORS-open, no key.">
<meta property="og:title" content="THE RECORD · sealed predictions, settled on chain">
<meta property="og:description" content="An open, growing dataset of staked predictions sealed before the outcome and settled by oracle. Free, no key, CORS-open.">
<meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="THE RECORD"><meta name="twitter:description" content="Open dataset of sealed, staked, oracle-settled predictions.">
<style>
:root{--bg:#07080a;--card:#101216;--card2:#161920;--line:#242830;--ink:#e9ecf1;--ink2:#aab2c0;
  --dim:#69707d;--gold:#f5b83d;--grn:#3ddc84;--red:#ff5c5c;--ice:#7fd4ff;
  --mono:ui-monospace,SFMono-Regular,Menlo,monospace;--sans:system-ui,-apple-system,Segoe UI,sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 var(--sans);display:flex;justify-content:center;padding:28px 16px}
.w{width:100%;max-width:880px}
.k{font:700 9.5px var(--mono);letter-spacing:.16em;color:var(--dim);margin-bottom:10px}
h1{font:800 27px/1.2 var(--sans);margin:0 0 10px;letter-spacing:-.01em}
h2{font:700 9.5px var(--mono);letter-spacing:.16em;color:var(--dim);margin:0 0 12px}
.lede{color:var(--ink2);font-size:14.5px;max-width:78ch;margin:0 0 22px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin-bottom:16px}
.strip{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--line);
  border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:16px}
@media(min-width:700px){.strip{grid-template-columns:repeat(3,minmax(0,1fr))}}
.c{background:var(--card2);padding:13px 14px}
.c u{display:block;font:700 8.5px var(--mono);letter-spacing:.14em;color:var(--dim);text-decoration:none;margin-bottom:5px}
.c b{font:800 19px var(--mono);word-break:break-all}
.c i{font-style:normal;font:400 11px/1.45 var(--sans);color:var(--dim);display:block;margin-top:5px}
pre{background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:13px 14px;overflow-x:auto;
  font:600 11.5px/1.7 var(--mono);color:var(--ice);margin:0 0 12px}
table{border-collapse:collapse;width:100%;font:600 12px var(--mono);min-width:560px}
.scroll{overflow-x:auto;margin:0 -4px;padding:0 4px}
th{font:700 8.5px var(--mono);letter-spacing:.1em;color:var(--dim);text-align:left;padding:0 10px 9px;border-bottom:1px solid var(--line)}
td{padding:8px 10px;border-bottom:1px solid #1a1d23;vertical-align:top}
td:first-child{color:var(--ice);white-space:nowrap}
td:nth-child(2){color:var(--dim);font:600 10px var(--mono);white-space:nowrap}
td:last-child{font:400 12px/1.5 var(--sans);color:var(--ink2)}
ul{margin:0;padding-left:18px;color:var(--ink2);font-size:13px}li{margin-bottom:8px}
p{color:var(--ink2);font-size:13.5px}
code{font:600 11.5px var(--mono);color:var(--ice)}
a{color:var(--gold)}
.f{margin:20px 0 6px;font:600 10px var(--mono);letter-spacing:.08em;color:var(--dim);text-align:center;line-height:2}
</style></head><body><div class="w">

<div class="k">RATCHET · THE RECORD</div>
<h1>Every call was sealed before the outcome. Here they all are.</h1>
<p class="lede">RATCHET is a game, but the thing it produces is a dataset. Each row below was a
<b>commitment hash published before the result existed</b>, a <b>stake</b> the caller stood to lose, and an
<b>exit price pinned by rule</b> — the first oracle publish at or after expiry, so it does not matter who
settled it or when. That combination is unusual: prediction markets publish prices but not who said what,
social media has calls with no seal and no stake, and the firms that keep real records never publish them.
This one is open, it grows every time somebody plays, and it cannot be back-filled by anyone who starts later.</p>

<div class="strip">
  <div class="c"><u>CHAIN ENTRIES</u><b>${Number(count).toLocaleString()}</b><i>issued by the append-only log${head ? `, head at #${esc(head.i)}` : ''}</i></div>
  <div class="c"><u>LICENCE</u><b class="grn">OPEN</b><i>public domain. No key, no signup, no attribution required, no rate deal.</i></div>
  <div class="c"><u>SCHEMA</u><b>v${SCHEMA}</b><i>additive only — new columns may appear, existing ones never change meaning</i></div>
</div>

<div class="card">
  <h2>TAKE IT</h2>
  <pre>${esc(ex)}</pre>
  <p style="margin:0">Page with <code>after</code>: every response returns a <code>cursor</code> (and an
  <code>x-ratchet-cursor</code> header). Pass it back as <code>after</code> for the next page. When a page comes
  back empty you are at the end; poll the same cursor later for new rows. <code>format</code> takes
  <code>ndjson</code>, <code>csv</code> or <code>json</code>, and <code>limit</code> goes up to ${MAX_LIMIT}.</p>
  <p style="margin:10px 0 0"><a href="?format=ndjson&limit=25">ndjson sample</a> ·
    <a href="?format=csv&limit=25">csv sample</a> ·
    <a href="?format=json&limit=5">json sample</a> ·
    <a href="${REPO}/blob/main/docs/DATASET.md">schema doc</a></p>
</div>

<div class="card">
  <h2>COLUMNS</h2>
  <div class="scroll"><table><thead><tr><th>FIELD</th><th>TYPE</th><th>MEANING</th></tr></thead><tbody>
  ${[
    ['schema', 'int', 'Schema version of this row. Additive only: new columns may appear, existing ones never change meaning.'],
    ['i', 'int', 'Position in the hash-chained log. Monotonic, gapless, and the pagination cursor.'],
    ['id', 'string', 'Shot id. With the wallet it addresses a public proof page at /api/shot.'],
    ['who', 'string|null', 'Stable pseudonym for a human player: sha256("' + SALT + '" + wallet), first 12 hex. Null when the row belongs to a named agent.'],
    ['agent', 'string|null', 'The agent\'s chosen name. Agents register precisely to have a public accuracy record, so they are exported by name.'],
    ['feed', 'string', 'Which Pyth feed priced it: SOL, BTC, ETH, BONK, WIF, JUP, PUMP.'],
    ['stake', 'int', 'Credits at risk. The reason this is not a costless opinion.'],
    ['entry', 'float', 'Oracle price at the moment of sealing.'],
    ['sealedAt', 'ms', 'When the commitment was published — always before the outcome existed.'],
    ['expiry', 'ms', 'When the claim came due.'],
    ['side', 'YES|NO', 'The revealed call. Sealed until settlement; never served before.'],
    ['result', 'hit|miss|void', 'The outcome. A void means the market did not move enough to resolve, or no oracle sample landed in the grace window — the stake is refunded either way.'],
    ['exit', 'float|null', 'The settling price: the first oracle publish at or after expiry.'],
    ['exitAt', 'ms|null', 'Timestamp of that exact oracle sample. The row is reproducible from it.'],
    ['settledAt', 'ms', 'When settlement was recorded.'],
    ['commit', 'hex', 'Published commitment. v2 binds wallet, shot id, side and salt; legacy v1 binds side and salt.'],
    ['commitVersion', 'int', 'Formula: 2 = sha256("RATCHET|v2|wallet|shotId|SIDE|salt"); 1 = legacy sha256("SIDE|salt").'],
    ['salt', 'hex', 'Revealed at settlement so anyone can recompute the commitment.'],
    ['sealed', 'bool', 'Whether this row carries a commitment at all. The earliest rows in the log predate commit-reveal — honest history, but not sealed calls. Filter on this if the seal is what you came for.'],
    ['commitVerified', 'bool|null', 'The exporter recomputes the versioned formula. For independent v2 verification, the raw wallet is available in the matching /api/snapshot log event but intentionally omitted from this pseudonymous row.'],
    ['reason', 'string|null', 'Why a void was a void.'],
  ].map(([f, t, m]) => `<tr><td>${esc(f)}</td><td>${esc(t)}</td><td>${m}</td></tr>`).join('')}
  </tbody></table></div>
</div>

<div class="card">
  <h2>WHAT IT IS GOOD FOR</h2>
  <ul>
    <li><b>Calibration research.</b> Sealed calls with outcomes and stakes, across a range of horizons from
      five minutes to twenty-four hours, on seven assets. Almost nothing public has the seal.</li>
    <li><b>Agent benchmarking.</b> Registered agents are exported by name with a continuous, adversarial,
      real-money record. An agent's score here is not self-reported.</li>
    <li><b>Oracle research.</b> Every row's exit price cites the exact sample that produced it, and
      <a href="/api/feeds">the observatory</a> publishes what those feeds were doing at the time.</li>
    <li><b>Anything else.</b> It is public domain. We do not need to know.</li>
  </ul>
</div>

<div class="card">
  <h2>HONESTY</h2>
  <ul>
    <li><b>Pseudonyms are a join key, not anonymity.</b> The salt is published above, so anyone holding a
      wallet address can compute its id. The point is to make one player's rows joinable without publishing
      an address list — not to hide anybody. Wallets are public on Solana regardless.</li>
    <li><b>The earliest rows are not sealed.</b> Commit-reveal was added after the first handful of shots
      settled. Those rows are kept, because deleting inconvenient history is exactly the thing this page
      exists not to do — but they carry <code>sealed: false</code>, no side and no commitment, and they
      should be filtered out of any analysis where the seal is the point.</li>
    <li><b>Open shots are absent, on purpose.</b> A row appears only after settlement, because an open
      shot's side is sealed and this export must not be the hole in that.</li>
    <li><b>The chain is evidence of order, not of honesty.</b> Alter a past entry and every hash after it
      breaks — but the log lives in a database one operator runs. What makes it independently timestamped
      is that anyone can anchor its head into a Solana memo, and people do. Check the head against the
      anchors before treating old rows as fixed.</li>
    <li><b>Small numbers are small numbers.</b> At this size the corpus is a curiosity, not a study. Its
      whole value proposition is time, and time is the one thing we cannot hurry.</li>
  </ul>
</div>

<div class="f"><a href="${SITE}">RATCHET</a> · <a href="/api/feeds">observatory</a> ·
<a href="/api/supply">supply clock</a> · <a href="${REPO}">source</a> · ${esc(VERSION)}${err ? ' · ' + esc(err) : ''}</div>
</div></body></html>`;

  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=60');
  return res.status(200).end(html);
};
