import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const kv = readFileSync(new URL('../lib/kv.js', import.meta.url), 'utf8');
const game = readFileSync(new URL('../api/game.js', import.meta.url), 'utf8');

assert.match(html, /phantom\.app\/ul\/browse\/\$\{page\}\?ref=\$\{ref\}/,
  'mobile Connect must hand off to Phantom’s documented in-app browse link');
assert.match(html, /let refreshing=false;[\s\S]*if\(dead\|\|refreshing\)return;[\s\S]*finally\{clearTimeout\(timeout\);refreshing=false;\}/,
  'state refreshes must not overlap and create player-lock 409s');
// The rule this pins is "poll as often as there is something to see, and no
// more", not one particular set of numbers. It was a literal match on
// `engaged?10000:60000`, so the tuning could not change without the test
// failing for a reason unrelated to what it protects.
{
  const tiers = html.match(/const delay=liveShot\?(\d+):\(AUTH\?(\d+):(\d+)\)/);
  assert.ok(tiers, 'the poll interval must follow what the player is waiting for');
  const [live, connectedIdle, guest] = tiers.slice(1).map(Number);
  assert.ok(live <= 10000,
    'a shot in the air is a player waiting for a number: watch it at least every ten seconds');
  assert.ok(connectedIdle >= live && guest >= connectedIdle,
    'less to see must mean less polling, never more');
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
