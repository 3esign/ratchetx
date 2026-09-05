#!/usr/bin/env node
// A quota error must cost ONE request, not two.
//
// lib/kv.js retries once by default, so every failing call costs two requests.
// When the failure IS "you are out of requests", the retry spends one more of
// the thing you have run out of - the burn rate doubles at exactly the moment it
// must not. And the only quota string the code recognised was "daily request
// limit", while the message the live site actually returned on 2026-09-05 was
// "ERR max requests limit exceeded. Limit: 500000, Usage: 500000". It fell
// through to the generic branch and was retried.
//
// The test drives the real module by replacing globalThis.fetch, and COUNTS the
// attempts. Counting is the whole point: an assertion that the error propagates
// would have passed before the fix too.
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'http://kv.test/';
process.env.KV_REST_API_TOKEN = 'test-token';

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);

let attempts = 0;
const reply = (status, error) => {
  globalThis.fetch = async () => { attempts += 1; return {
    ok: status === 200, status,
    json: async () => (status === 200 ? { result: JSON.stringify('ok') } : { error }),
  }; };
};

let checks = 0;
const kv = require('../lib/kv.js');
// getJSONStrict, not getJSON: the lenient reader swallows every backend failure
// and returns null, so it would have shown one attempt and no error regardless of
// whether the fix worked. The strict reader is the money path and it throws.
const call = () => kv.getJSONStrict('probe:key');

// --- the message the live site actually returned
attempts = 0;
reply(400, 'ERR max requests limit exceeded. Limit: 500000, Usage: 500000. See https://upstash.com/docs');
checks += 1;
await assert.rejects(call, /request limit reached/,
  'the live quota message must be recognised as a quota error');
checks += 1;
assert.equal(attempts, 1,
  `a quota failure must cost ONE request; it cost ${attempts}. Retrying "you are out of requests" ` +
  'spends one more of the thing you have run out of.');

// --- the older wording still counts
attempts = 0;
reply(429, 'daily request limit exceeded');
checks += 1;
await assert.rejects(call, /request limit reached/);
checks += 1;
assert.equal(attempts, 1, 'the older daily-limit wording must also cost one request');

// --- a genuine transient IS still retried; the fix must not disable retries
attempts = 0;
reply(500, 'internal error');
checks += 1;
await assert.rejects(call, /kv 500/);
checks += 1;
assert.equal(attempts, 2,
  `a transient failure must still be retried once; it was attempted ${attempts} time(s). ` +
  'Turning off all retries would trade one bug for another.');

// --- success is one request and no retry
attempts = 0;
reply(200);
checks += 1;
assert.equal(await call(), 'ok');
checks += 1;
assert.equal(attempts, 1, 'a successful call must cost exactly one request');

console.log(`ok - kv quota: ${checks} checks, quota failures cost one request, transients still retry once`);
