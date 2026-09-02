// Pinned-reader drift check — does the CLIENT feed table still equal the frozen
// golden vectors printed by the program?
//
// test/test_core_vectors.mjs already pins the SERVER rules (lib/core_rules.js)
// to those vectors. Nothing pinned the client. That gap matters: the feed table
// is compiled into the program forever, so if the client's table drifts by even
// one id or one index, the client seals against a different feed than the one
// the program settles — and the two halves of settlement disagree with each
// other, silently, on real money.
//
// Run before any freeze, and again after reprinting vectors:
//   node drift-check.mjs [--vectors ../vectors/core-rules-v1.json]
//
// Prints a verdict line: RXDRIFT NONE | RXDRIFT FOUND | RXDRIFT UNREADABLE
import fs from 'node:fs';
import { FEEDS } from './core.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : []).filter(Boolean));
const path = args.vectors || '../vectors/core-rules-v1.json';
const say = (...a) => console.log(...a);

try {
  const v = JSON.parse(fs.readFileSync(path, 'utf8'));
  let bad = 0;
  say('vectors file :', path);
  say('program      :', v.program);
  say('feed count   : vectors', v.feeds.length, '| client', FEEDS.length);
  if (v.feeds.length !== FEEDS.length) { say('  COUNT MISMATCH'); bad++; }

  for (const f of v.feeds) {
    const c = FEEDS[f.index];
    const cid = String((c && (c.feedId || c.id)) || '').toLowerCase();
    const ok = !!c && cid === String(f.feedId).toLowerCase();
    if (!ok) bad++;
    say(' ', String(f.index).padStart(2), String((c && c.symbol) || '?').padEnd(5),
        ok ? 'match' : 'MISMATCH', String(f.feedId).slice(0, 16) + '…');
  }

  if (bad === 0) {
    say('');
    say('No drift: the client seals against exactly the feeds the program settles.');
    say('RXDRIFT NONE');
  } else {
    say('');
    say(`${bad} mismatch(es). DO NOT FREEZE — the client and the program would`);
    say('disagree about which feed a shot is bound to.');
    say('RXDRIFT FOUND');
  }
} catch (e) {
  say('could not read vectors:', String(e.message || e).split('\n')[0]);
  say('RXDRIFT UNREADABLE');
}
