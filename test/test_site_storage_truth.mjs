import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(html, /current legacy production machine uses Upstash Redis/,
  'the site names the actual current economic storage authority');
assert.match(html, /Supabase (?:is|remains) retained legacy evidence/,
  'the site keeps Supabase in its honest legacy role');
assert.match(html, /G2 candidate is not live/,
  'source arithmetic is not marketed as a live on-chain game');
assert.match(html, /cluster-specific rent and transaction cost will be measured and published/,
  'the site promises measurement rather than a timeless guessed cost');
assert.doesNotMatch(html, /~0\.000015 SOL each/,
  'the rejected compressed-record estimate cannot return');
assert.doesNotMatch(html, /Production Postgres holds players, credits, XP, open shots/,
  'the pre-Upstash storage description cannot return');
assert.match(html, /@PythNetwork/,
  'the site credits the oracle used by every production beta');

console.log('PASS  site storage and on-chain cost claims remain explicit and falsifiable');
