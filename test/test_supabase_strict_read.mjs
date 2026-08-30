import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

// Exercise the real adapter against an in-process fetch fixture only. The
// synthetic credential and host never leave this process; no database is used.
const require = createRequire(import.meta.url);
const modulePath = require.resolve('../lib/supabase_kv.js');
const originalModule = require.cache[modulePath];
const originalFetch = globalThis.fetch;
const names = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const previous = new Map(names.map(name => [name, process.env[name]]));
const credential = 'sb_secret_strict_read_fixture_not_a_real_credential';
const marker = 'PRIVATE_FIXTURE_PAYLOAD_MUST_NOT_BE_ECHOED';
process.env.SUPABASE_URL = 'https://strict-read-fixture.invalid';
process.env.SUPABASE_SERVICE_KEY = credential;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete require.cache[modulePath];

let active, totalCalls = 0;
function scenario(steps) {active = {steps, calls: []};}
const response = (body, status = 200) => ({body, status});
globalThis.fetch = async (url, options) => {
  const address = new URL(url);
  assert.equal(address.origin, 'https://strict-read-fixture.invalid');
  assert.ok(address.pathname.startsWith('/rest/v1/rpc/'));
  assert.equal(options.method, 'POST');
  assert.equal(options.redirect, 'error');
  assert.ok(options.headers.apikey === credential, 'only the synthetic fixture credential is used');
  assert.equal(options.headers.Authorization, undefined, 'opaque secret is not a JWT bearer');
  assert.ok(active, 'all fetches must belong to an explicit fixture scenario');
  const step = active.steps[Math.min(active.calls.length, active.steps.length - 1)];
  active.calls.push({name: address.pathname.split('/').at(-1), args: JSON.parse(options.body)});
  totalCalls++;
  return new Response(step.status === 204 ? null : step.body,
    {status: step.status, headers: {'content-type': 'application/json'}});
};

try {
  const kv = require(modulePath);
  assert.equal(kv.backend, 'supabase');
  assert.equal(kv.enabled, true);
  // JSON null is the actual missing-row contract, not a transport error.
  for (const value of [null, {cr: 5000}, [1, null], false, 0, '']) {
    scenario([response(JSON.stringify(value))]);
    assert.deepEqual(await kv.getJSONStrict('fixture-key'), value);
    assert.equal(active.calls.length, 1, 'valid JSON must not cause a retry');
    assert.deepEqual(active.calls[0], {name: 'ratchet_kv_get', args: {p_key: 'fixture-key'}});
  }

  for (const [label, body, status] of [
    ['malformed JSON', '{' + marker, 200],
    ['truncated JSON', '{"session":', 200],
    ['empty body', '', 200],
    ['whitespace body', ' \r\n\t ', 200],
    ['HTML body', '<html>' + marker + '</html>', 200],
    ['empty 204', null, 204],
  ]) {
    scenario([response(body, status)]);
    await assert.rejects(kv.getJSONStrict('fixture-private-key'), error => {
      assert.equal(error.message, 'supabase invalid JSON response', label);
      for (const secret of [marker, credential, 'fixture-private-key'])
        assert.ok(!String(error).includes(secret), 'strict parse errors must not reflect payload or key');
      return true;
    }, label + ' must not masquerade as a missing record');
    assert.equal(active.calls.length, 2, label + ': retain the existing bounded read retry');
    assert.ok(active.calls.every(call => call.name === 'ratchet_kv_get'), 'failed reads must never write');
  }

  scenario([response('{"truncated":'), response('{"cr":4900}')]);
  assert.deepEqual(await kv.getJSONStrict('fixture-key'), {cr: 4900});
  assert.equal(active.calls.length, 2, 'a valid second read may recover a transient unreadable response');
  scenario([response(''), response('null')]);
  assert.equal(await kv.getJSONStrict('fixture-key'), null);
  assert.equal(active.calls.length, 2, 'a valid second JSON null still means missing');

  scenario([response(marker)]);
  assert.equal(await kv.getJSON('cosmetic-fixture'), null, 'the explicitly lenient read preserves its null fallback');
  assert.equal(active.calls.length, 2);

  // The new strictness is opt-in: do not reinterpret unrelated RPC return
  // contracts or make legitimate void writer responses retry execution.
  for (const [body, status] of [['', 200], [null, 204], ['null', 200]]) {
    scenario([response(body, status)]);
    assert.equal(await kv.setJSON('fixture-write', {n: 1}), undefined);
    assert.equal(active.calls.length, 1, 'void writer response must not retry');
    assert.equal(active.calls[0].name, 'ratchet_kv_set');
  }
  scenario([response('not-json')]);
  assert.deepEqual(await kv.getManyJSON(['fixture-key']), [], 'unrelated mget behavior remains unchanged');
  assert.equal(active.calls.length, 1);
  scenario([response('true')]);
  assert.equal(await kv.setnxJSON('fixture-gate', {n: 1}, 5), true);
  assert.equal(active.calls.length, 1);

  scenario([response('{"message":"fixture not found"}', 404)]);
  await assert.rejects(kv.getJSONStrict('fixture-key'), error => error.status === 404
    && error.message === 'supabase 404: fixture not found');
  assert.equal(active.calls.length, 1, 'existing non-retryable HTTP error behavior is unchanged');
  scenario([response('fixture unavailable', 503)]);
  await assert.rejects(kv.getJSONStrict('fixture-key'), error => error.status === 503
    && error.message === 'supabase 503: fixture unavailable');
  assert.equal(active.calls.length, 2, 'existing bounded 5xx retry behavior is unchanged');
  assert.ok(totalCalls > 0, 'the real adapter must have executed the response fixture');
  console.log('Supabase strict reads: valid null preserved; malformed/empty 2xx refuse safely; bounded retries, lenient reads and unrelated RPC behavior PASS (offline)');
} finally {
  globalThis.fetch = originalFetch;
  if (originalModule) require.cache[modulePath] = originalModule;
  else delete require.cache[modulePath];
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
