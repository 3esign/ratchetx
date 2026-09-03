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
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const HOST = 'aws-1-eu-west-1.pooler.supabase.com';
const PROJECT = 'gxwffzshaicpewbkziau';
const USER = 'postgres.' + PROJECT;
const TABLE = 'public.ratchet_kv';
const PAGE = 2000;

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

const client = new Client({
  host: HOST, port: 5432, user: USER, database: 'postgres', password,
  ssl: { rejectUnauthorized: true, servername: HOST },
  connectionTimeoutMillis: 20_000, statement_timeout: 120_000,
});

let rowCount = 0, bytes = 0, exitCode = 0;
const hash = crypto.createHash('sha256');
try {
  await client.connect();
  say('CONNECTED — the direct Postgres path is open even though the REST API is not.');

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
  else if (/timeout|ENOTFOUND|ECONN/i.test(message))
    say('→ The host could not be reached from this machine.');
} finally {
  try { await client.end(); } catch { }
  fs.writeFileSync(reportFile, lines.join('\n') + '\n', { mode: 0o600 });
  console.log('\nreport written: ' + reportFile);
  process.exit(exitCode);
}
