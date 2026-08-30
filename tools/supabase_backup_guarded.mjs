// Exact-project cutover. Credentials arrive only over non-echoed stdin.
// The default backs up/restores/tests locally. --apply-003 explicitly allows
// the live migration AFTER backup restore verification and local tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { guardedBatch } from './guarded_postgres_batch.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = 'C:/Users/treed/AppData/Local/Temp/ratchet-postgres-tools-20260830/expanded/pgsql/bin';
const host = 'aws-1-eu-west-1.pooler.supabase.com';
const project = 'gxwffzshaicpewbkziau';
const apply = process.argv.includes('--apply-003');
const digestSql = `select count(*)::text n,
  encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(
    jsonb_build_array(key,value,expires_at,updated_at)::text,'UTF8')),'hex'),'' order by key collate "C"),''),'UTF8')),'hex') digest
  from public.ratchet_kv`;
const hash = value => createHash('sha256').update(value).digest('hex');
const run = (name, args, env = {}, timeout = 180000) => new Promise((resolve, reject) => {
  const child = spawn(path.join(bin, name + '.exe'), args, {
    env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', stderr = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill(), timeout);
  child.on('error', () => { clearTimeout(timer); reject(new Error(name + '_START_FAILED')); });
  // pg_ctl starts a background server which can inherit pipe handles on Windows.
  // Its exit, not closure of every inherited pipe, is the lifecycle boundary.
  child.on(name === 'pg_ctl' ? 'exit' : 'close', code => {
    clearTimeout(timer);
    if (name === 'pg_ctl') { child.stdout.destroy(); child.stderr.destroy(); }
    if (code !== 0) {
      const error = new Error(name + '_FAILED');
      error.stage = name; error.exit = code;
      // Detailed utility output remains private, never printed with SQL/secrets.
      error.privateDetail = stderr;
      reject(error);
    } else resolve(output);
  });
});

if (!process.stdin.isTTY) { console.log('PRIVATE_TTY_REQUIRED'); process.exit(2); }
process.stdin.setRawMode(true); process.stdin.resume();
console.log('PRIVATE_CUTOVER_INPUT_READY');
let buffer = '', started = false;
const inputTimer = setTimeout(() => process.exit(2), 60000);
process.stdin.on('data', async chunk => {
  if (started) return;
  buffer += chunk.toString();
  if (buffer.length > 8192) process.exit(2);
  let input;
  try { input = JSON.parse(buffer.trim()); } catch { return; }
  started = true; buffer = ''; clearTimeout(inputTimer); process.stdin.pause();
  let live, other, local, localOther, backup, cluster, localEnv, stage = 'input';
  let localStarted = false, liveTransaction = false;
  const manifest = { project, startedAt: new Date().toISOString(), applied: false };
  try {
    assert.ok(typeof input.password === 'string' && input.password);
    const ca = [];
    for (const name of ['prod-ca-2021.crt', 'prod-ca-2025.crt']) {
      const response = await fetch('https://raw.githubusercontent.com/supabase/cli/develop/apps/cli-go/internal/gen/types/templates/' + name, { redirect: 'error', signal: AbortSignal.timeout(10000) });
      assert.ok(response.ok); ca.push(await response.text());
    }
    const configuration = { host, port: 5432, user: 'postgres.' + project, database: 'postgres',
      password: input.password, ssl: { rejectUnauthorized: true, ca, servername: host },
      connectionTimeoutMillis: 10000, application_name: 'ratchet_guarded_cutover' };
    live = new Client(configuration); live.on('error', () => {}); await live.connect();
    await live.query("set statement_timeout='60s'; set lock_timeout='5s'; set timezone='UTC'");
    const preflight = fs.readFileSync(path.join(root, 'supabase/preflight_guarded_player_commits.sql'), 'utf8');
    assert.ok((await live.query(preflight)).rows.every(row => row.ok));
    stage = 'backup';
    const resume = process.argv.find(arg => arg.startsWith('--resume='));
    if (resume) {
      backup = path.resolve(resume.slice('--resume='.length));
      assert.equal(path.dirname(backup), path.join(root, 'backups'));
      assert.ok(path.basename(backup).startsWith('pre003-20260830-'));
      const previous = JSON.parse(fs.readFileSync(path.join(backup, 'manifest.json'), 'utf8'));
      assert.equal(previous.project, project); assert.equal(previous.applied, false);
      for (const name of ['public-schema.dump', 'ratchet-kv-data.dump']) {
        assert.equal(hash(fs.readFileSync(path.join(backup, name))), previous.files[name].sha256);
      }
      Object.assign(manifest, previous, { resumedAt: new Date().toISOString() });
      delete manifest.failedStage; delete manifest.failureCode; delete manifest.localStopFailed;
      console.log(JSON.stringify({ backupReused: true, hashesVerified: true, rows: manifest.data.n }));
    } else {
    fs.mkdirSync(path.join(root, 'backups'), { recursive: true });
    backup = fs.mkdtempSync(path.join(root, 'backups/pre003-20260830-'));
    const certPath = path.join(backup, 'supabase-ca.pem');
    fs.writeFileSync(certPath, ca.join('\n'), { mode: 0o600 });
    manifest.caSha256 = hash(ca.join('\n'));
    const env = { PGHOST: host, PGPORT: '5432', PGUSER: configuration.user,
      PGDATABASE: 'postgres', PGPASSWORD: input.password, PGSSLMODE: 'verify-full', PGSSLROOTCERT: certPath,
      PGOPTIONS: '-c statement_timeout=60000 -c lock_timeout=5000', PGCONNECT_TIMEOUT: '10' };
    await live.query('begin isolation level repeatable read read only'); liveTransaction = true;
    const snapshot = (await live.query('select pg_export_snapshot() snapshot')).rows[0].snapshot;
    manifest.data = (await live.query(digestSql)).rows[0];
    manifest.serverVersion = (await live.query('show server_version')).rows[0].server_version;
    const schemaFile = path.join(backup, 'public-schema.dump');
    const dataFile = path.join(backup, 'ratchet-kv-data.dump');
    await run('pg_dump', ['--format=custom', '--schema-only', '--schema=public', '--no-owner', '--snapshot=' + snapshot, '--file=' + schemaFile], env);
    await run('pg_dump', ['--format=custom', '--data-only', '--table=public.ratchet_kv', '--no-owner', '--snapshot=' + snapshot, '--file=' + dataFile], env);
    await live.query('commit'); liveTransaction = false;
    manifest.files = {};
    for (const file of [schemaFile, dataFile]) manifest.files[path.basename(file)] = { bytes: fs.statSync(file).size, sha256: hash(fs.readFileSync(file)) };
    console.log(JSON.stringify({ backupCreated: true, rows: manifest.data.n, files: Object.keys(manifest.files) }));
    }
    fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    const schemaFile = path.join(backup, 'public-schema.dump');
    const dataFile = path.join(backup, 'ratchet-kv-data.dump');

    stage = 'local_restore';
    cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-restore-'));
    const localPassword = randomBytes(32).toString('hex');
    const passwordFile = path.join(cluster, 'init-password');
    fs.writeFileSync(passwordFile, localPassword, { mode: 0o600 });
    await run('initdb', ['-D', path.join(cluster, 'data'), '-U', 'postgres', '--auth=scram-sha-256', '--pwfile=' + passwordFile, '--encoding=UTF8', '--locale=C']);
    fs.unlinkSync(passwordFile);
    const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
    localEnv = { PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: 'postgres', PGDATABASE: 'postgres', PGPASSWORD: localPassword, PGSSLMODE: 'disable', PGOPTIONS: '-c statement_timeout=60000' };
    await run('pg_ctl', ['-D', path.join(cluster, 'data'), '-l', path.join(cluster, 'postgres.log'), '-o', '-h 127.0.0.1 -p ' + port, '-w', 'start']); localStarted = true;
    const localConfig = { host: '127.0.0.1', port, user: 'postgres', database: 'postgres', password: localPassword, connectionTimeoutMillis: 10000 };
    local = new Client(localConfig); await local.connect();
    const roles = (await live.query("select rolname from pg_roles where rolname !~ '^pg_' and rolname <> 'postgres'")).rows;
    for (const row of roles) await local.query('create role "' + row.rolname.replaceAll('"', '""') + '"');
    await run('pg_restore', ['--clean', '--if-exists', '--no-owner', '--exit-on-error', '--dbname=postgres', schemaFile], localEnv);
    await run('pg_restore', ['--data-only', '--exit-on-error', '--dbname=postgres', dataFile], localEnv);
    await local.query("set timezone='UTC'");
    assert.deepEqual((await local.query(digestSql)).rows[0], manifest.data);
    manifest.restoreVerified = true;
    console.log(JSON.stringify({ restoreVerified: true, rows: manifest.data.n, digestMatches: true }));

    stage = 'local_migration_batch';
    const migration = fs.readFileSync(path.join(root, 'supabase/003_guarded_player_commits.sql'), 'utf8');
    manifest.migrationSha256 = hash(migration);
    const oldIncrement = (await local.query("select pg_get_functiondef('public.ratchet_kv_incr(text,numeric)'::regprocedure) def")).rows[0].def;
    await local.query(migration);
    const fixedIncrement = (await local.query("select pg_get_functiondef('public.ratchet_kv_incr(text,numeric)'::regprocedure) def")).rows[0].def;
    localOther = new Client(localConfig); await localOther.connect();
    await local.query("set statement_timeout='15s'; set lock_timeout='5s'");
    await localOther.query("set statement_timeout='15s'; set lock_timeout='5s'");
    // Positive failure control, ONLY in the restored local database. Prove the
    // old function recreates the measured race before accepting the replacement.
    await local.query(oldIncrement);
    await assert.rejects(() => guardedBatch(local, localOther), error =>
      error.code === 'ERR_ASSERTION' && error.actual === 125 && error.expected === 105
      && error.message.includes('queued-credit conservation'));
    manifest.legacyRaceReproduced = { actual: 125, expected: 105 };
    await local.query(fixedIncrement);
    manifest.localBatch = await guardedBatch(local, localOther);
    console.log(JSON.stringify({ legacyRaceReproduced: manifest.legacyRaceReproduced, localMigrationBatch: manifest.localBatch }));
    if (apply) {
      stage = 'live_migration';
      assert.ok((await live.query(preflight)).rows.every(row => row.ok), 'live preflight changed');
      await live.query(migration);
      manifest.applied = true;
      manifest.ready = (await live.query('select public.ratchet_kv_guarded_ready() v')).rows[0].v;
      assert.equal(manifest.ready.ready, true);
      const privileges = (await live.query(`select
        has_function_privilege('service_role','public.ratchet_kv_commit_guarded(jsonb)','EXECUTE') service,
        has_function_privilege('anon','public.ratchet_kv_commit_guarded(jsonb)','EXECUTE') anon,
        has_function_privilege('authenticated','public.ratchet_kv_commit_guarded(jsonb)','EXECUTE') authenticated`)).rows[0];
      assert.deepEqual(privileges, { service: true, anon: false, authenticated: false });
      stage = 'live_fixture_batch';
      other = new Client(configuration); other.on('error', () => {}); await other.connect();
      await other.query("set statement_timeout='15s'; set lock_timeout='5s'");
      manifest.liveBatch = await guardedBatch(live, other);
      console.log(JSON.stringify({ liveMigration: 'PASS', ready: manifest.ready, privileges, fixtureBatch: manifest.liveBatch, fixtureRowsRemoved: true }));
    }
    manifest.completedAt = new Date().toISOString();
  } catch (error) {
    manifest.failedStage = stage;
    manifest.failureCode = String(error.code || error.stage || 'VALIDATION_FAILED').replace(/[^A-Z0-9_a-z]/g, '').slice(0, 80);
    console.log(JSON.stringify({ failedStage: stage, code: manifest.failureCode, migrationApplied: manifest.applied }));
    if (backup && error.privateDetail) fs.writeFileSync(path.join(backup, 'private-utility-error.txt'), error.privateDetail, { mode: 0o600 });
    if (backup && error.code === 'ERR_ASSERTION') fs.writeFileSync(path.join(backup, 'private-validation-error.txt'), error.stack, { mode: 0o600 });
    process.exitCode = 1;
  } finally {
    if (liveTransaction) await live.query('rollback').catch(() => {});
    for (const c of [other, live, localOther, local]) if (c) await c.end().catch(() => {});
    if (localStarted) await run('pg_ctl', ['-D', path.join(cluster, 'data'), '-m', 'fast', '-w', 'stop']).catch(() => { manifest.localStopFailed = true; });
    if (backup) {
      fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
      console.log(JSON.stringify({ privateBackupDirectory: backup, applied: manifest.applied, restoreVerified: manifest.restoreVerified || false }));
    }
    input.password = ''; input.apiKey = '';
    process.stdin.setRawMode(false);
    process.exit(process.exitCode || 0);
  }
});
