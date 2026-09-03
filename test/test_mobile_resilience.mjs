import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const kv = readFileSync(new URL('../lib/kv.js', import.meta.url), 'utf8');
const game = readFileSync(new URL('../api/game.js', import.meta.url), 'utf8');

assert.match(html, /phantom\.app\/ul\/browse\/\$\{page\}\?ref=\$\{ref\}/,
  'mobile Connect must hand off to Phantom’s documented in-app browse link');
assert.match(html, /let refreshing=false;[\s\S]*if\(dead\|\|refreshing\)return;[\s\S]*finally\{clearTimeout\(timeout\);refreshing=false;\}/,
  'state refreshes must not overlap and create player-lock 409s');
// The rule this pins is about WHO waits how long, not how many tiers the
// expression happens to have. The first version matched `engaged?10000:60000`
// literally, so tuning broke it for reasons unrelated to what it protects; the
// second matched a three-tier shape and broke the same way. So evaluate the
// real expression and ask it the questions that matter.
{
  // Anchored inside pollState: index.html has more than one `const delay`,
  // and the retry backoff is not the poll cadence.
  const poll = html.slice(html.indexOf('function pollState('));
  const m = poll.match(/const delay=([^;]+);/);
  assert.ok(m, 'the poll interval must follow what the player is waiting for');
  const delayFor = new Function('liveShot', 'AUTH', 'return (' + m[1] + ');');
  const withShot = delayFor(true, true), connected = delayFor(false, true), guest = delayFor(false, false);
  assert.ok(withShot <= 10000,
    'a shot in the air is a player waiting for a number: watch it at least every ten seconds');
  // The one that cost something. `open.length` says THIS TAB sealed a shot; it
  // does not say the player has an outcome coming. A shot sealed by their agent,
  // from another device, or a challenge somebody else accepted all settle for a
  // player whose open list here is empty. Slowing that player to thirty seconds
  // meant a settlement they were told about half a minute late, and test_notify
  // found it: the tab title never carried the result inside the window.
  assert.ok(connected <= 10000,
    'a connected player can have a settlement coming without an open shot in THIS tab: never make them wait for it');
  assert.ok(guest >= connected, 'less to see must mean less polling, never more');
  assert.ok(guest >= 60000, 'an idle guest must not hammer storage');
}
assert.match(html, /if\(left===0\)\{sp\.textContent="SETTLING…";[\s\S]*watchExpired\(sp\.dataset\.exp\)/,
  'an expired shot must show SETTLING and trigger bounded live refresh without a manual reload');
assert.match(html, /function settlementMargin\(e\)[\s\S]*INDICATIVE[\s\S]*NOT USED TO SETTLE/,
  'VOID proximity must be labelled indicative and never presented as settlement');
assert.match(html, /function settlementReceipt\(e\)[\s\S]*CREDITS REFUND[\s\S]*PLAY \+.*SKILL/,
  'settled cards must itemize outcome, XP, credits, and refunds');
assert.match(game, /appendOnce\(`settle:\$\{eventId\}`[\s\S]*settleXp:s\.settleXp \|\| 0, skillXp:s\.skillXp \|\| 0/,
  'the durable settlement event must seal the XP breakdown used by the ladders');
assert.match(kv, /daily request limit/i,
  'storage quota failures must be identified instead of hidden as kv 400');

console.log('mobile wallet handoff, refresh guard, adaptive polling, and KV diagnostics are wired');

// The release gate must skip a browser suite when there is no BROWSER, not when
// there is no playwright package. DEPLOY.cmd runs `npm test` before it ships, so
// getting that wrong means a machine with an unusable browser binary refuses to
// deploy a fix -- which is exactly what a node_modules synced from another
// platform produces: imports fine, launches nothing.
{
  const runner = readFileSync(new URL('../scripts/run-tests.mjs', import.meta.url), 'utf8');
  assert.match(runner, /chromium\.launch\(/,
    'the runner must find out whether a browser actually launches');
  assert.match(runner, /npx playwright install chromium/,
    'and say how to fix it when one does not');
  assert.match(runner, /NEEDS_BROWSER/,
    'every suite that drives a browser must be gated, including the ones that serve their own page');
  assert.ok(/NEEDS_BROWSER\.has\(f\) && browserReason/.test(runner),
    'the skip must be decided by the browser probe, not by the package import');
}
