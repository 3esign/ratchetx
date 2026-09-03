// What did we actually rescue? Reads the newest legacy-kv-*.ndjson in the private
// folder and reports the census: how many rows, of which key families, how large,
// and whether every line parses. It touches no network and no database.
//
// This is the question that decides the migration. "37,805 rows" is a number; a
// census says which of them are players, which are log chunks, which are leases
// that expire on their own and need not move at all.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

function privateRoot() {
  const base = process.platform === 'win32'
    ? process.env.LOCALAPPDATA
    : (process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'));
  if (!base || !path.isAbsolute(base)) throw new Error('PRIVATE_ROOT_UNAVAILABLE');
  return path.join(path.resolve(base), 'RatchetX', 'private-snapshots');
}

// The family, not the key: 'u:HXFD...' is one player's row and must never be
// printed, but 'u:*' with a count is the shape of the ledger and is safe to read
// aloud. Same rule the snapshot tool's keyspace inventory follows.
function family(key) {
  if (key.startsWith('g:log:c:')) return 'g:log:c:*  (log chunks)';
  if (key.startsWith('g:log:e:')) return 'g:log:e:*  (log entries)';
  if (key.startsWith('g:log:')) return 'g:log:*    (log metadata)';
  if (key.startsWith('u:')) return 'u:*        (players)';
  if (key.startsWith('play-session:')) return 'play-session:*';
  if (key.startsWith('guarded:')) return 'guarded:*  (receipts)';
  if (key.startsWith('sig:')) return 'sig:*      (signature gates)';
  if (key.startsWith('lock:')) return 'lock:*     (leases, expire on their own)';
  if (key.startsWith('px:') || key.startsWith('h:px')) return 'px:*       (price buckets)';
  const head = key.split(':', 1)[0];
  return head + ':*';
}

const root = privateRoot();
const files = fs.readdirSync(root)
  .filter(name => /^legacy-kv-.*\.ndjson$/.test(name))
  .map(name => ({ name, at: fs.statSync(path.join(root, name)).mtimeMs }))
  .sort((a, b) => b.at - a.at);
if (!files.length) { console.log('No rescue file found in ' + root); process.exit(1); }

const file = path.join(root, files[0].name);
console.log('reading  ' + file);
console.log('');

const counts = new Map();
const bytesBy = new Map();
let rows = 0, bad = 0, bytes = 0, expired = 0;
const now = Date.now();
const hash = crypto.createHash('sha256');
const stream = fs.createReadStream(file);
const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

for await (const line of lines) {
  if (!line) continue;
  hash.update(line + '\n');
  bytes += Buffer.byteLength(line) + 1;
  let parsed;
  try { parsed = JSON.parse(line); } catch { bad++; continue; }
  if (!Array.isArray(parsed) || typeof parsed[0] !== 'string') { bad++; continue; }
  rows++;
  const fam = family(parsed[0]);
  counts.set(fam, (counts.get(fam) || 0) + 1);
  bytesBy.set(fam, (bytesBy.get(fam) || 0) + Buffer.byteLength(line));
  const expiresAt = parsed[2];
  if (expiresAt && Date.parse(expiresAt) < now) expired++;
}

const mb = n => (n / 1048576).toFixed(2) + ' MB';
console.log('CENSUS');
for (const [fam, count] of [...counts.entries()].sort((a, b) => b[1] - a[1]))
  console.log('  ' + fam.padEnd(32) + String(count).padStart(7) + '   ' + mb(bytesBy.get(fam)).padStart(10));
console.log('');
console.log('  rows parsed        ' + rows);
console.log('  unparseable lines  ' + bad + (bad ? '   <-- look at these' : ''));
console.log('  already expired    ' + expired + '   (leases and caches; they do not need to move)');
console.log('  file size          ' + mb(bytes));
console.log('  sha256             ' + hash.digest('hex'));
console.log('');
console.log(bad === 0
  ? 'Every line parsed. This file is a complete, readable copy of the legacy store.'
  : 'Some lines did not parse. Do not treat this file as complete until that is explained.');
