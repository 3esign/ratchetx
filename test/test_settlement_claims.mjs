// What the settlement guarantee actually is, pinned so prose cannot drift back
// past it.
//
// Blocker 7 in docs/PERMANENCE_EXECUTION_PLAN.md: "Earlier prose overclaimed
// cranker neutrality. Owner/PDA/Full-verification checks stop fabricated
// prices, but they do not by themselves stop withholding, missed crossing or
// ring-eviction selection. Documentation must follow the executable evidence,
// not the intended story."
//
// The claim has two halves and both are true:
//
//   WHICH price is not a choice. Owner = the Pyth receiver, canonical shard-0
//   PDA, VerificationLevel::Full, feed id match, confidence bound, and the
//   crossing predicate together mean exactly one print can settle a shot.
//
//   WHETHER it settles is a liveness assumption. Nobody can be compelled to
//   crank. A shot whose crossing is never recorded voids and refunds, and
//   against a winning position a refund is a loss.
//
// Ruleset 2 closed the part of this that WAS an attack rather than an absence:
// bind_crossing freezes the crossing into the shot, so a party who can
// influence checkpoint volume can no longer bury it. This file fails if any
// document goes back to claiming the second half away.
import assert from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, relative } from 'node:path';
import { test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'backups', '_to_delete', 'artifacts']);
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (/\.(md|html|js|mjs|rs)$/.test(name)) out.push(full);
  }
  return out;
}
const files = walk(root).map(f => [relative(root, f).replace(/\\/g, '/'), readFileSync(f, 'utf8')]);
assert.ok(files.length > 100, `expected to scan the repo, saw ${files.length} files`);

// A sentence may say settling early or late gives the same number. It may not
// put "never" in that list: never gives a refund, which is a different economic
// outcome and the whole point of the distinction.
test('no document says that never settling gives the same number', () => {
  const bad = [];
  for (const [path, text] of files) {
    for (const m of text.matchAll(/early[^.\n]{0,40}\bnever\b[^.\n]{0,80}same number/gi)) {
      bad.push(`${path}: ${m[0].slice(0, 110)}`);
    }
  }
  assert.deepEqual(bad, [],
    'settling never does NOT give the same number — it gives a refund, which is a real loss to a winning position');
});

// "Trustless" is a strong word and it is not earned by fabrication-resistance
// plus open access. Where a document uses it about settlement, the liveness
// assumption has to be somewhere on the same page.
test('every page that calls settlement trustless also names the liveness assumption', () => {
  const LIVENESS = /(liveness|voids and refunds|void and refund|refunds instead|declin|withhold|nobody (records|cranks|posts)|does not make (anyone|anybody|somebody|one) post)/i;
  const bad = [];
  for (const [path, text] of files) {
    if (!/\.(md|html)$/.test(path)) continue;
    if (path.startsWith('test/')) continue;
    // Only AFFIRMATIVE uses. A page that says "not trustless", or "not magically
    // trustless", or that is telling somebody else not to use the word, is doing
    // the right thing and must not be dragged in by a substring match. The
    // window is over the FLATTENED text, not over lines: markdown wraps, and
    // README.md had the "not" on one line and "trustless" on the next.
    const flat = text.replace(/\s+/g, ' ');
    const NEGATED = /(\bnot\b|\bnever\b|\bnot yet\b|\bisn't\b|\bis not\b)[^.]{0,60}$/i;
    let affirmative = false;
    for (const m of flat.matchAll(/trustless/gi)) {
      const before = flat.slice(Math.max(0, m.index - 120), m.index);
      if (NEGATED.test(before)) continue;
      if (/is an engineering claim|Do not describe/i.test(flat.slice(Math.max(0, m.index - 80), m.index + 80))) continue;
      affirmative = true;
      break;
    }
    if (!affirmative) continue;
    if (!LIVENESS.test(text)) bad.push(path);
  }
  assert.deepEqual(bad, [],
    'a page may say nobody can pick the price; it may not call that trustless without saying that nobody can be made to crank either');
});

// The load-bearing statement lives in one place and says both halves.
test('SETTLEMENT.md states both halves of the guarantee', () => {
  const text = files.find(([p]) => p === 'docs/SETTLEMENT.md')[1];
  assert.match(text, /Which price is not a choice/i, 'the price half');
  assert.match(text, /liveness assumption/i, 'the attendance half');
  assert.match(text, /bind_crossing/, 'and what ruleset 2 closed');
  // The old unqualified sentence must not come back as the opening claim.
  assert.ok(!/rests on one sentence: \*\*the exit price/.test(text),
    'the claim is two halves; presenting one of them as the whole is the thing blocker 7 was about');
});

// The pages a stranger actually reads must carry the refund, not just the rule.
test('the public surfaces say what happens when nobody settles', () => {
  for (const path of ['index.html', 'agent/README.md', 'docs/ARENA.md',
                      'docs/SELF_HOST.md', 'docs/UNKILLABLE.md', 'api/record.js']) {
    const entry = files.find(([p]) => p === path);
    assert.ok(entry, `${path} is missing`);
    assert.match(entry[1], /(voids? and (your stake|the stake|refund)|refunds?\b)/i,
      `${path} tells a stranger the price cannot be picked; it must also tell them an unsettled shot refunds`);
  }
});
