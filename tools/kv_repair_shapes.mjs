// Repair keys that the migration imported as the wrong Redis type.
//
// WHAT WENT WRONG. tools/kv_import.mjs decided a key's Redis type from its
// name: h:* a hash, z:* a sorted set, everything else a string. Five hash
// families never followed that convention -- g:fh, ldg:rx, ldg4:dropped,
// odds:<hour>, funnel_daily:<day> -- so they arrived as JSON strings. Every
// HGETALL and HINCRBYFLOAT against them throws WRONGTYPE. The visible symptom
// was /api/game?action=pyth-context returning 500 and the Bankr skill saying
// RELEASE_MISMATCH, three layers away from the cause.
//
// WHAT THIS DOES. It reads lib/kv_shapes.js -- the declaration lib/kv.js now
// enforces -- and, for every key whose stored type disagrees with it, rebuilds
// the key as the declared type FROM THE VALUE ALREADY THERE. Nothing is
// invented and nothing is taken from a file: a string holding {"set:SOL":12}
// becomes a hash holding set:SOL = 12, and a string that cannot be read as the
// declared shape is reported and left exactly as it is.
//
// It is safe to run twice: a key already the right type is skipped.
//
// It looks first and asks second. Pass nothing and it reports; type REPAIR at
// the prompt to apply.
import readline from 'node:readline';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { shapeOf } = require('../lib/kv_shapes.js');

const clean = v => String(v || '').replace(/[\x00-\x1f\x7f]/g, '').trim();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(res => rl.question(q, a => res(clean(a))));

const URL_ = clean(process.env.KV_REST_API_URL);
const TOK_ = clean(process.env.KV_REST_API_TOKEN);

async function main() {
  const url = URL_ || await ask('KV_REST_API_URL: ');
  const token = TOK_ || await ask('KV_REST_API_TOKEN: ');
  if (!url || !token) { console.log('Need both a URL and a token. Nothing was touched.'); return; }

  const redis = async cmd => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.error) throw new Error('kv ' + r.status + ': ' + (body.error || r.statusText));
    return body.result;
  };

  // Only keys that could be mistyped: every key the declaration says is not a
  // string. SCAN rather than KEYS -- this runs against a live store.
  console.log('Scanning for keys whose declared shape is not `string` ...\n');
  const found = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis(['SCAN', cursor, 'COUNT', '500']);
    cursor = next;
    for (const key of batch || []) if (shapeOf(key) !== 'string') found.push(key);
  } while (cursor !== '0');

  if (!found.length) { console.log('No hash or sorted-set keys in the store at all. Nothing to do.'); return; }

  const wrong = [];
  for (const key of found) {
    const want = shapeOf(key);
    const actual = await redis(['TYPE', key]);
    const is = typeof actual === 'string' ? actual : (actual && actual.result) || String(actual);
    const expectedRedisType = want === 'hash' ? 'hash' : 'zset';
    if (is === expectedRedisType) { console.log(`  ok       ${key}  (${is})`); continue; }
    console.log(`  MISTYPED ${key}  is ${is}, must be ${expectedRedisType}`);
    wrong.push({ key, want, is });
  }

  if (!wrong.length) { console.log('\nEvery declared key already holds the right type. Nothing to repair.'); return; }

  // Read each one's current value and work out the repair BEFORE asking.
  const plans = [], unrepairable = [];
  for (const { key, want, is } of wrong) {
    if (is !== 'string') { unrepairable.push(`${key}: is a ${is}, not a string -- this tool only rebuilds from strings`); continue; }
    let value;
    try { value = JSON.parse(await redis(['GET', key])); }
    catch (e) { unrepairable.push(`${key}: value is not JSON (${e.message})`); continue; }
    if (want === 'hash') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { unrepairable.push(`${key}: value is not an object, cannot become a hash`); continue; }
      const flat = [];
      let bad = null;
      for (const [field, n] of Object.entries(value)) {
        if (!Number.isFinite(Number(n))) { bad = `${key}.${field} is not numeric`; break; }
        flat.push(field, String(Number(n)));
      }
      if (bad) { unrepairable.push(bad); continue; }
      if (!flat.length) { unrepairable.push(`${key}: empty object -- delete it by hand if that is right`); continue; }
      plans.push({ key, fields: flat.length / 2, cmds: [['DEL', key], ['HSET', key, ...flat]] });
    } else {
      const pairs = Array.isArray(value) ? value.map(e => Array.isArray(e) ? e : null)
        : (value && typeof value === 'object' ? Object.entries(value) : null);
      if (!pairs || pairs.some(p => !p)) { unrepairable.push(`${key}: value is not member/score pairs`); continue; }
      const flat = [];
      let bad = null;
      for (const [member, score] of pairs) {
        if (!Number.isFinite(Number(score))) { bad = `${key}: non-numeric score for ${member}`; break; }
        flat.push(String(Number(score)), String(member));
      }
      if (bad) { unrepairable.push(bad); continue; }
      if (!flat.length) { unrepairable.push(`${key}: empty sorted set -- delete it by hand if that is right`); continue; }
      plans.push({ key, fields: flat.length / 2, cmds: [['DEL', key], ['ZADD', key, ...flat]] });
    }
  }

  console.log('');
  if (unrepairable.length) {
    console.log('LEFT ALONE (read them yourself before deciding):');
    for (const line of unrepairable) console.log('  ' + line);
    console.log('');
  }
  if (!plans.length) { console.log('Nothing this tool is willing to repair automatically.'); return; }

  console.log('WILL REPAIR, rebuilding each key from the value already stored in it:');
  for (const p of plans) console.log(`  ${p.key}  ->  ${shapeOf(p.key)} with ${p.fields} entr${p.fields === 1 ? 'y' : 'ies'}`);
  console.log('');
  console.log('Each repair is DEL then re-create, in that order, one key at a time.');
  console.log('The values come from the store itself; nothing here is invented.');
  const go = await ask('Type REPAIR to apply, anything else to stop: ');
  if (go !== 'REPAIR') { console.log('Stopped. Nothing was changed.'); return; }

  let done = 0;
  for (const p of plans) {
    for (const cmd of p.cmds) await redis(cmd);
    done++;
    console.log(`  repaired ${p.key}`);
  }
  console.log(`\n${done} key(s) repaired. Re-run this to confirm they all read "ok".`);
}

main().catch(e => { console.error('\nFAILED: ' + (e && e.message || e)); process.exitCode = 1; })
  .finally(() => rl.close());
