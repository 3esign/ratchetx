// Load the rescued legacy store into a Redis-protocol KV (Upstash / Vercel KV).
//
// WHY THIS IS NOT A DUMB COPY. Supabase held everything as JSON in one table,
// including the two things Redis stores natively: the stats hash and the XP
// ladders. lib/kv.js reads those with HGETALL and ZREVRANGE, so importing them
// as JSON strings would leave a store that looks complete and answers every
// leaderboard query with nothing. Three shapes, decided by key and verified by
// value:
//
//   h:*   -> HSET   (fields with numeric values)
//   z:*   -> ZADD   (member/score pairs -- the XP ladders)
//   rest  -> SET    (the JSON string form lib/kv.js writes and reads)
//
// Anything that does not match its expected shape stops the import rather than
// being guessed at. A row that was already expired is skipped: leases and
// caches do not need to move.
//
// It runs a classification pass with no network first, prints what it would do,
// and waits for you to type IMPORT.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const BATCH = 200;

function privateRoot() {
  const base = process.platform === 'win32'
    ? process.env.LOCALAPPDATA
    : (process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'));
  if (!base || !path.isAbsolute(base)) throw new Error('PRIVATE_ROOT_UNAVAILABLE');
  return path.join(path.resolve(base), 'RatchetX', 'private-snapshots');
}

// One interface for every question. A fresh readline per prompt looked tidier
// and did not work: closing the first one leaves stdin ended, so the second
// question returns an empty string the instant it is asked -- which is exactly
// what happened on the first run, printing both prompts and then "no target".
// The credentials normally arrive through the environment (the .cmd collects
// them, hiding the token), and this interactive path is the fallback.
let rl = null;
const ask = question => new Promise(resolve => {
  rl ||= readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl.question(question, answer => resolve(answer.trim()));
});

const root = privateRoot();
const file = fs.readdirSync(root)
  .filter(name => /^legacy-kv-.*\.ndjson$/.test(name))
  .map(name => ({ name, at: fs.statSync(path.join(root, name)).mtimeMs }))
  .sort((a, b) => b.at - a.at)[0];
if (!file) { console.log('No rescue file in ' + root + ' — run SUPABASE_RESCUE.cmd first.'); process.exit(1); }
const rescued = path.join(root, file.name);

// ---- pass one: classify, no network ----------------------------------------
const now = Date.now();
const commands = [];
let skippedExpired = 0, sets = 0, hashes = 0, zsets = 0;
const problems = [];

for (const line of fs.readFileSync(rescued, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const [key, value, expiresAt] = JSON.parse(line);
  if (expiresAt && Date.parse(expiresAt) <= now) { skippedExpired++; continue; }
  const ttl = expiresAt ? Math.max(1, Math.floor((Date.parse(expiresAt) - now) / 1000)) : null;

  if (key.startsWith('h:')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { problems.push(key + ' is not a hash'); continue; }
    const flat = [];
    for (const [field, n] of Object.entries(value)) {
      if (!Number.isFinite(Number(n))) { problems.push(key + '.' + field + ' is not numeric'); continue; }
      flat.push(field, String(Number(n)));
    }
    if (flat.length) { commands.push(['HSET', key, ...flat]); hashes++; }
  } else if (key.startsWith('z:')) {
    const pairs = Array.isArray(value)
      ? value.map(entry => Array.isArray(entry) ? entry : null)
      : (value && typeof value === 'object' ? Object.entries(value) : null);
    if (!pairs || pairs.some(pair => !pair)) { problems.push(key + ' is not a sorted set'); continue; }
    const flat = [];
    for (const [member, score] of pairs) {
      if (!Number.isFinite(Number(score))) { problems.push(key + ' has a non-numeric score'); continue; }
      flat.push(String(Number(score)), String(member));
    }
    if (flat.length) { commands.push(['ZADD', key, ...flat]); zsets++; }
  } else {
    const encoded = JSON.stringify(value);
    commands.push(ttl ? ['SET', key, encoded, 'EX', String(ttl)] : ['SET', key, encoded]);
    sets++;
  }
}

console.log('source   ' + rescued);
console.log('');
console.log('  SET   (json strings) ' + String(sets).padStart(7));
console.log('  HSET  (stats hash)   ' + String(hashes).padStart(7));
console.log('  ZADD  (xp ladders)   ' + String(zsets).padStart(7));
console.log('  skipped, expired     ' + String(skippedExpired).padStart(7));
console.log('  total commands       ' + String(commands.length).padStart(7));
if (problems.length) {
  console.log('');
  console.log('REFUSING: ' + problems.length + ' row(s) do not match the shape their key implies:');
  for (const problem of problems.slice(0, 10)) console.log('   ' + problem);
  console.log('Nothing was sent. A store that looks complete and answers wrongly is worse than an empty one.');
  process.exit(1);
}

// ---- pass two: send ---------------------------------------------------------
console.log('');
console.log('Target: a Redis-protocol KV (Upstash / Vercel KV). The token is typed');
console.log('into this window only and is never written to a file.');
const url = (process.env.KV_REST_API_URL || await ask('  REST URL  : ')).replace(/\/+$/, '');
const token = process.env.KV_REST_API_TOKEN || await ask('  REST token: ');
if (!url || !token) { console.log('No target given — nothing was sent.'); process.exit(2); }
// The console shows a redis:// line for redis-cli and an https:// one for the
// REST API. Only the second speaks the protocol lib/kv.js uses, and pasting the
// first would fail later with something far less obvious than this sentence.
if (!/^https:\/\//i.test(url)) {
  console.log('\nThat is not the REST endpoint. Copy the HTTPS one from the Upstash console');
  console.log('(the redis:// line is for redis-cli and will not work here). Nothing was sent.');
  process.exit(2);
}

const go = await ask('\nType IMPORT to write ' + commands.length + ' commands: ');
if (go !== 'IMPORT') { console.log('Not confirmed — nothing was sent.'); process.exit(2); }

let done = 0, failed = 0;
for (let i = 0; i < commands.length; i += BATCH) {
  const slice = commands.slice(i, i + BATCH);
  const response = await fetch(url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(slice),
  });
  if (!response.ok) {
    console.log('\nHTTP ' + response.status + ' at command ' + i + ' — stopping. ' +
      (response.status === 401 ? 'The token was refused.' : 'Nothing further was sent.'));
    process.exit(1);
  }
  const results = await response.json();
  for (const result of results) if (result && result.error) failed++;
  done += slice.length;
  if (i % (BATCH * 10) === 0 || done === commands.length) process.stdout.write('\r  written ' + done + ' / ' + commands.length + '   ');
}
console.log('');
console.log('');
console.log(failed ? 'DONE with ' + failed + ' command error(s) — read them before trusting this store.'
                   : 'DONE. ' + done + ' commands accepted, none refused.');
console.log('The legacy store was not touched. This wrote only to the target.');
if (rl) rl.close();
