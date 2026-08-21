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
// site. They are skipped unless a server is up, so `npm test` passes cleanly on
// a fresh clone with nothing installed — which matters, because the first thing
// a stranger does with this repo is run the tests, and a wall of red from
// missing infrastructure reads as a broken project rather than a skipped suite.
// Browser suites were originally wired to three different, undocumented
// fixture servers while this runner checked one unrelated port. That made a
// random static server turn five clean skips into five confusing failures.
// Each suite now declares the actual surface it needs.
const LAYOUT_SERVER = process.env.RATCHET_LAYOUT_SERVER || 'http://127.0.0.1:8247/';
const SERVER_FOR = new Map([
  ['test_widths.mjs',LAYOUT_SERVER], ['test_align.mjs',LAYOUT_SERVER],
  ['test_funnel.mjs',LAYOUT_SERVER], ['test_notify.mjs',LAYOUT_SERVER],
  ['test_chal_ui.mjs',LAYOUT_SERVER],
]);
const up = new Map();
for (const url of new Set(SERVER_FOR.values())) up.set(url,
  await fetch(url, { signal: AbortSignal.timeout(1500) }).then(r => r.ok).catch(() => false));

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
  if (server && !up.get(server)) {
    console.log(`SKIP  ${f.padEnd(28)} (no required fixture at ${server})`);
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
process.exit(failed ? 1 : 0);
