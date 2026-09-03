// Every suite, in one command: `npm test`.
//
// Each file runs in its own process on purpose. These tests stub modules by
// writing into require.cache and reset an in-memory KV between cases, so state
// leaking between files has caused real false passes before — a stub from one
// file surviving into the next and quietly making its assertions vacuous.
// Process isolation is the cheapest way to make that impossible.
import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'test');

// These drive a real browser (Playwright) against a locally served copy of the
// site. They used to be skipped unless somebody had already started a server on
// port 8247, and nobody ever did. A skipped test catches nothing: on 2026-09-03
// all five were run for the first time in a while and test_notify had three
// real failures in it, one of them a settlement a connected player was not told
// about for thirty seconds. The suite was not passing. It was not running.
//
// So the runner serves the repo itself. There is no port to know about and no
// setup step to forget. The only remaining reason to skip is Playwright not
// being installed, which is the honest case the skip was written for -- a
// stranger on a fresh clone should not meet a wall of red from missing
// infrastructure -- and it is now the ONLY case, so a skip means one thing.
//
// Browser suites were originally wired to three different, undocumented fixture
// servers while this runner checked one unrelated port. Each suite declares the
// surface it needs; RATCHET_LAYOUT_SERVER still overrides, and when it does the
// runner serves nothing and uses what you pointed it at.
const LAYOUT_SERVER = process.env.RATCHET_LAYOUT_SERVER || 'http://127.0.0.1:8247/';
const SERVER_FOR = new Map([
  ['test_widths.mjs',LAYOUT_SERVER], ['test_align.mjs',LAYOUT_SERVER],
  ['test_funnel.mjs',LAYOUT_SERVER], ['test_notify.mjs',LAYOUT_SERVER],
  ['test_chal_ui.mjs',LAYOUT_SERVER],
]);
const reachable = url => fetch(url, { signal: AbortSignal.timeout(1500) })
  .then(r => r.ok).catch(() => false);

// Serve the repository over http, read-only, on the layout port, unless
// something is already there or the caller pointed us elsewhere.
let servedBy = null;
async function serveRepo(url) {
  const { createServer } = await import('node:http');
  const { createReadStream, statSync } = await import('node:fs');
  const { extname, normalize, resolve } = await import('node:path');
  const TYPES = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript',
    '.mjs':'text/javascript', '.json':'application/json', '.svg':'image/svg+xml',
    '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon',
    '.woff2':'font/woff2', '.woff':'font/woff', '.txt':'text/plain', '.map':'application/json' };
  const { port } = new URL(url);
  const server = createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, url).pathname); }
    catch { res.writeHead(400).end(); return; }
    if (pathname.endsWith('/')) pathname += 'index.html';
    // Normalise first, then require the result to still be inside the repo:
    // this serves a working copy to a browser, not the whole filesystem.
    const file = resolve(root, '.' + normalize(pathname));
    if (!file.startsWith(resolve(root))) { res.writeHead(403).end(); return; }
    let size;
    try { const st = statSync(file); if (!st.isFile()) throw 0; size = st.size; }
    catch { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'content-length': size, 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  await new Promise((ok, no) => { server.once('error', no); server.listen(Number(port), '127.0.0.1', ok); });
  server.unref();
  return server;
}

const up = new Map();
for (const url of new Set(SERVER_FOR.values())) {
  let ok = await reachable(url);
  if (!ok && !process.env.RATCHET_LAYOUT_SERVER && url === LAYOUT_SERVER) {
    try { servedBy = await serveRepo(url); ok = await reachable(url); }
    catch (e) { console.log(`(could not serve the repo at ${url}: ${e.message})`); }
  }
  up.set(url, ok);
}

// The one honest reason left to skip a browser suite.
let havePlaywright = true;
try { await import('playwright'); }
catch { havePlaywright = false; }

const files = readdirSync(dir).filter(f => /^test_.*\.mjs$/.test(f)).sort();
const run = f => new Promise(res => {
  const p = spawn(process.execPath, [join(dir, f)], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', d => out += d);
  p.stderr.on('data', d => out += d);
  p.on('close', code => res({ f, code, out }));
});

let failed = 0, skipped = 0;
for (const f of files) {
  const server = SERVER_FOR.get(f);
  if (server && !havePlaywright) {
    console.log(`SKIP  ${f.padEnd(28)} (playwright is not installed — run npm install to include the browser suites)`);
    skipped++;
    continue;
  }
  if (server && !up.get(server)) {
    console.log(`SKIP  ${f.padEnd(28)} (no fixture at ${server}, and this runner could not serve one)`);
    skipped++;
    continue;
  }
  const r = await run(f);
  if (r.code === 0) console.log(`ok    ${f}`);
  else {
    failed++;
    console.log(`FAIL  ${f}\n${r.out.split('\n').slice(-25).join('\n')}`);
  }
}
console.log(`\n${files.length - failed - skipped} passed · ${failed} failed · ${skipped} skipped`);
if (servedBy) servedBy.close();
process.exit(failed ? 1 : 0);
