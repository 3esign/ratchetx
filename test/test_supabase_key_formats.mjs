import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { check } = require('../lib/check_store_schema.js');
const originalFetch = globalThis.fetch;
for (const key of ['legacy.fixture.jwt', 'sb_secret_fixture_not_a_real_credential']) {
  const isSecret = key.startsWith('sb_secret_');
  process.env.SUPABASE_URL = 'https://fixture.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = key;
  const methods = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.apikey, key);
    assert.equal(options.headers.Authorization, isSecret ? undefined : 'Bearer ' + key,
      'opaque secret keys must not be sent as JWT bearer tokens');
    assert.equal(options.redirect, 'error', 'credentials must not follow redirects');
    methods.push(options.method);
    const pathname = new URL(url).pathname;
    const result = pathname.endsWith('ratchet_kv_guarded_ready')
      ? { schema: 'guarded-player-v1', ready: true }
      : pathname.endsWith('ratchet_kv_get') ? { cr: 5000 } : [{ key: 'fixture' }];
    return new Response(JSON.stringify(result));
  };
  assert.equal(await check({ env: process.env, fetchImpl: globalThis.fetch }), true);
  delete require.cache[require.resolve('../lib/supabase_kv.js')];
  const kv = require('../lib/supabase_kv.js');
  assert.deepEqual(await kv.getJSONStrict('fixture'), { cr: 5000 });
  assert.equal(await kv.casPlaySession('play-session:v1:' + '1'.repeat(32), null,
    { revision: 'a'.repeat(32), count: 0 }), true);
  assert.equal(methods.length, 3);
}
globalThis.fetch = originalFetch;
const { serverHeaders } = require('../lib/supabase_auth.js');
for (const key of ['', 'sb_publishable_fixture', 'bad\r\nheader']) {
  assert.throws(() => serverHeaders(key), /server credential/);
}
console.log('Supabase legacy JWT/new secret headers, redirect refusal and public-key rejection PASS');
