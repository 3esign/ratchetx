// A scrolling flex column shrinks its children. That is the whole bug: `.chambers`
// was `display:flex; flex-direction:column; max-height:min(40vh,420px); overflow-y:auto`,
// so every chamber was compressed under its own content height and then clipped by
// `.cham{overflow:hidden}`. Measured before the fix: rows given 30.2px and 36.7px
// where their text needed 43px and 58px. The right-hand rail already carried the
// guard (`.railInner>.panel{flex:none}`); the two lists inside it did not, which is
// exactly how a fix stays local and the same bug comes back somewhere else.
//
// So this asserts the invariant rather than the instance: ANY scrolling flex column
// on any page must state that its rows keep their own height. A new list added
// without that line fails here, not in a screenshot three weeks later.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [...readdirSync(root).filter(f => /\.(html|css)$/.test(f))];

const rules = [];               // {file, sel, body}
for (const f of files) {
  const text = readFileSync(join(root, f), 'utf8');
  const css = f.endsWith('.css')
    ? [text]
    : [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
  for (const block of css) {
    const flat = block.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of flat.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      rules.push({ file:f, sel:m[1].trim().replace(/\s+/g,' '), body:m[2].replace(/\s+/g,'') });
    }
  }
}

const norm = s => s.replace(/\s+/g,'');
// bodies are whitespace-stripped above, so `flex:0 0 auto` reads as `flex:00auto`
const guards = rules.filter(r => /flex:00auto|flex:none|flex-shrink:0/.test(r.body));

const bad = [];
for (const r of rules) {
  const b = r.body;
  if (!/display:flex/.test(b) || !/flex-direction:column/.test(b)) continue;
  if (!/overflow-y:auto|overflow:auto|overflow-y:scroll/.test(b)) continue;
  // every selector in the group needs its own children guarded
  for (const sel of r.sel.split(',').map(s => s.trim()).filter(Boolean)) {
    if (!sel.startsWith('.') && !sel.startsWith('#')) continue;   // element-level rules are not lists
    const guarded = guards.some(g =>
      g.sel.split(',').map(s => norm(s)).some(gs => gs.startsWith(norm(sel) + '>')));
    if (!guarded) bad.push(`${r.file}  ${sel}  scrolls as a flex column but never guards its rows (want \`${sel}>*{flex:0 0 auto}\`)`);
  }
}

console.log(bad.length ? bad.join('\n') + `\n\n${bad.length} SCROLLING COLUMN(S) CAN CLIP THEIR ROWS`
  : 'EVERY SCROLLING FLEX COLUMN KEEPS ITS ROWS AT FULL HEIGHT');
process.exitCode = bad.length ? 1 : 0;
