// Read-only rescue: pull everything out of the legacy Supabase KV table over a
// direct Postgres connection, and prove what was pulled.
//
// WHY THIS EXISTS SEPARATELY FROM supabase_final_snapshot.mjs
// The final-snapshot tool performs a CUTOVER: it demands a revoked writer
// credential and an attestation, because a migration root taken while writers
// are live is worthless. This one makes no such claim. It is a backup, taken
// while the game is already down, so that whatever happens to the quota, the
// data is on a disk we control. It writes nothing to the database, revokes
// nothing, and deletes nothing.
//
// It also answers the question the outage raised. The API returns 500 because
// Supabase is refusing the REST path with exceed_egress_quota. Whether the
// DIRECT Postgres path is refused too is a different question with a different
// answer, and nobody has asked it. This asks it in one connection.
//
// Output goes to the private root (never the repository): the rows as NDJSON,
// a manifest with the row count, byte count and sha256 of the file, and a
// report the operator can read. No password is ever written anywhere.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const HOST = 'aws-1-eu-west-1.pooler.supabase.com';
const PROJECT = 'gxwffzshaicpewbkziau';
const USER = 'postgres.' + PROJECT;
const TABLE = 'public.ratchet_kv';
const PAGE = 2000;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The pooler presents a chain Node's default bundle does not carry, which is why a
// first attempt failed with "self-signed certificate in certificate chain". The
// answer is the real CA, not a disabled check: the same pinned Supabase root the
// snapshot tool uses, already in the repository, verified by digest before use. If
// it is missing or altered, this stops -- an unverified connection to a database
// holding the whole ledger is not a shortcut worth taking.
const CA_FILE = path.join(REPO, 'backups', 'pre003-20260830-P7LEkP', 'supabase-ca.pem');
const CA_SHA256 = '1c68487d30b821fd07127d5b92dea6d0c148458ca78498d2c3918a4c038b83c5';

function pinnedCa() {
  if (!fs.existsSync(CA_FILE)) throw new Error('CA_FILE_MISSING: ' + CA_FILE);
  const bytes = fs.readFileSync(CA_FILE);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (digest !== CA_SHA256) throw new Error('CA_PIN_MISMATCH: refusing to connect');
  return bytes.toString('utf8');
}

function privateRoot() {
  const base = process.platform === 'win32'
    ? process.env.LOCALAPPDATA
    : (process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'));
  if (!base || !path.isAbsolute(base)) throw new Error('PRIVATE_ROOT_UNAVAILABLE');
  return path.join(path.resolve(base), 'RatchetX', 'private-snapshots');
}

// The password is typed once, into this process, and never leaves it: not to a
// file, not to a log line, not into the manifest. The prompt hides nothing
// clever -- it just does not echo, and it does not accept an empty string.
function askPassword() {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const stdout = process.stdout;
    const onData = () => { };
    rl.question('Supabase database password (input hidden), then Enter: ', answer => {
      rl.close(); stdout.write('\n'); resolve(answer.trim());
    });
    rl.stdoutMuted = true;
    const write = stdout.write.bind(stdout);
    rl._writeToOutput = string => { if (rl.stdoutMuted) write('') ; else write(string); };
    process.stdin.on('data', onData);
  });
}

const started = new Date();
const stamp = started.toISOString().replace(/[:.]/g, '-');
const root = privateRoot();
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const rowsFile = path.join(root, `legacy-kv-${stamp}.ndjson`);
const reportFile = path.join(root, `rescue-report-${stamp}.txt`);
const lines = [];
const say = text => { lines.push(text); console.log(text); };

say('RatchetX legacy rescue — read-only');
say('started   ' + started.toISOString());
say('host      ' + HOST);
say('table     ' + TABLE);
say('output    ' + rowsFile);
say('');

const password = process.env.RATCHET_LEGACY_DB_PASSWORD || await askPassword();
if (!password || password.length < 8) {
  say('NO PASSWORD GIVEN — nothing was attempted.');
  fs.writeFileSync(reportFile, lines.join('\n') + '\n');
  process.exit(2);
}

const ca = pinnedCa();
say('CA        pinned Supabase root, sha256 verified');

// Supabase answers on three different doors, and they do not fail alike. The
// pooler in session mode is the one the tools use; transaction mode is a
// separate port with its own gate; the direct database host bypasses the pooler
// entirely and takes the plain 'postgres' role. When a password is refused on
// one, the useful question is whether it is refused on all three -- a password
// that fails everywhere is a wrong password, and a password that fails only at
// the pooler is a restriction wearing an authentication error's clothes.
const DOORS = [
  { name: 'pooler · session mode',     host: HOST, port: 5432, user: USER },
  { name: 'pooler · transaction mode', host: HOST, port: 6543, user: USER },
  { name: 'direct database host',      host: 'db.' + PROJECT + '.supabase.co', port: 5432, user: 'postgres' },
];

async function openFirstDoor() {
  const failures = [];
  for (const door of DOORS) {
    const candidate = new Client({
      host: door.host, port: door.port, user: door.user, database: 'postgres', password,
      ssl: { rejectUnauthorized: true, ca, servername: door.host },
      connectionTimeoutMillis: 15_000,
      // Read-only is asserted by the session itself, not only by the queries below:
      // if anything in this file ever tried to write, Postgres would refuse it.
      options: '-c default_transaction_read_only=on -c statement_timeout=120000',
    });
    try {
      await candidate.connect();
      say('OPEN      ' + door.name + '  (' + door.host + ':' + door.port + ' as ' + door.user + ')');
      return candidate;
    } catch (error) {
      const why = String(error && error.message || error);
      failures.push(door.name + ' → ' + why);
      say('closed    ' + door.name + ' → ' + why);
      try { await candidate.end(); } catch { }
    }
  }
  const all = failures.join(' | ');
  say('');
  if (/password authentication failed/i.test(all) && !/quota|restricted|too many|not permitted/i.test(all))
    say('Every door refused the same password. That is a wrong password, not a restriction.');
  else if (/quota|restricted|not permitted/i.test(all))
    say('At least one door named the quota. The project is restricted, not misconfigured.');
  throw new Error('NO_DOOR_OPENED');
}

// Declared here, opened inside the try below: a door that refuses must still
// leave a report behind, and an exception thrown at module scope would not.
let client = null;

let rowCount = 0, bytes = 0, exitCode = 0;
const hash = crypto.createHash('sha256');
try {
  client = await openFirstDoor();
  say('CONNECTED — a Postgres path is open even though the REST API is not.');

  const total = await client.query(`select count(*)::text as n from ${TABLE}`);
  say('rows in table: ' + total.rows[0].n);
  say('');

  const out = fs.createWriteStream(rowsFile, { mode: 0o600 });
  let after = null;
  for (;;) {
    // Keyset pagination, ordered by key: an OFFSET walk would re-read the
    // prefix of the table on every page and spend the egress we are rescuing.
    const page = after == null
      ? await client.query(`select key, value, expires_at, updated_at from ${TABLE} order by key limit ${PAGE}`)
      : await client.query(`select key, value, expires_at, updated_at from ${TABLE} where key > $1 order by key limit ${PAGE}`, [after]);
    if (!page.rows.length) break;
    for (const row of page.rows) {
      const line = JSON.stringify([row.key, row.value, row.expires_at, row.updated_at]) + '\n';
      out.write(line); hash.update(line); bytes += Buffer.byteLength(line); rowCount++;
    }
    after = page.rows[page.rows.length - 1].key;
    if (rowCount % 20000 < PAGE) say('  ... ' + rowCount + ' rows');
  }
  await new Promise(resolve => out.end(resolve));

  const digest = hash.digest('hex');
  const manifest = {
    schema: 'ratchetx-legacy-rescue', schemaVersion: 1,
    claim: 'read-only backup taken while the API was quota-restricted; NOT a cutover root and NOT a migration snapshot',
    takenAt: started.toISOString(), host: HOST, table: TABLE,
    rowCount: String(rowCount), bytes: String(bytes), sha256: digest,
    file: path.basename(rowsFile),
    writerBarrier: 'none — writers were not fenced, so this cannot anchor a migration',
  };
  fs.writeFileSync(path.join(root, `legacy-kv-${stamp}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });

  say('');
  say('DONE');
  say('rows      ' + rowCount);
  say('bytes     ' + bytes);
  say('sha256    ' + digest);
  say('');
  say('This is a backup, not a migration root: writers were never fenced.');
  say('Nothing in the database was changed.');
} catch (error) {
  exitCode = 1;
  const message = String(error && error.message || error);
  say('');
  say('FAILED: ' + message);
  if (/quota|402|egress/i.test(message))
    say('→ The quota blocks the direct path too. Nothing can be pulled until the cycle resets.');
  else if (/password|auth/i.test(message))
    say('→ Authentication was refused. That is the database password, not the service key.');
  else if (/certificate|self-signed|SELF_SIGNED/i.test(message))
    say('→ TLS verification failed even with the pinned CA. Do not disable the check; report this.');
  else if (/timeout|ENOTFOUND|ECONN/i.test(message))
    say('→ The host could not be reached from this machine.');
} finally {
  try { if (client) await client.end(); } catch { }
  fs.writeFileSync(reportFile, lines.join('\n') + '\n', { mode: 0o600 });
  console.log('\nreport written: ' + reportFile);
  process.exit(exitCode);
}
