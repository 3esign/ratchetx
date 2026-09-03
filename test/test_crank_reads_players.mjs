// The permissionless crank has to actually find the players.
//
// It did not. `pass()` read `snap.players` from /api/snapshot, and the full
// export nests everything under `state` — so it resolved to undefined, defaulted
// to {}, printed "0 players, 0 with expired shots", touched nothing, and exited
// 0. It had been doing that silently. A crank that finds nobody and reports
// success is worse than one that crashes: it looks like the system is settled.
//
// And it timed out at twenty seconds against the real snapshot, because that
// endpoint assembles the whole hash-chained log before answering. A crank
// nobody can afford to run is not permissionless in any sense that matters.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const crank = readFileSync(new URL('../tools/crank.mjs', import.meta.url), 'utf8');
const snapshot = readFileSync(new URL('../api/snapshot.js', import.meta.url), 'utf8');
let checks = 0;
const ok = (cond, label) => { checks++; assert.ok(cond, label); };

ok(/state && full\.state\.players/.test(crank),
  'the full snapshot nests players under `state` — reading snap.players finds nothing, forever, without failing');
ok(/only=players/.test(crank), 'it must ask for the cheap view first');
ok(/only=players/.test(snapshot), 'and the server must offer one');
ok(/carried no player map/.test(crank),
  'an empty or missing player map must stop the pass, not be treated as "nobody is playing"');
ok(/if \(ONCE\) process\.exitCode = 1/.test(crank),
  'a single pass that failed must not exit 0 — the caller has to tell "nothing to do" from "could not look"');
ok(/getJSON\(`\$\{ORIGIN\}\/api\/snapshot`, 120_000\)/.test(crank),
  'the slow fallback needs patience, since the full export builds the whole log');

// The light view must redact exactly like the full one: sealed means sealed in
// every export, or the crank becomes a way to read sides before settlement.
const light = snapshot.slice(snapshot.indexOf("only) || '') === 'players'"), snapshot.indexOf('if (memo.body'));
ok(/side, salt, xp, sp, \.\.\.rest/.test(light),
  'the players-only view must drop side and salt from open shots, exactly like the full export');
ok(/scanKeys\('u:\*'\)/.test(light) && !/g:log/.test(light),
  'the cheap view must not touch the log — that is the entire reason it exists');

console.log(`PASS  crank reads players: ${checks} checks — finds them, fails loudly, and does not download the log to do it`);
