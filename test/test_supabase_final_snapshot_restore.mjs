import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Client } from 'pg';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  FINGERPRINT_SQL,
  readSnapshot,
} from '../tools/supabase_final_snapshot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKUP = path.join(ROOT, 'backups', 'pre003-20260830-P7LEkP');
const PG_BIN = process.env.RATCHET_PG_BIN ||
  'C:/Users/treed/AppData/Local/Temp/ratchet-postgres-tools-20260830/expanded/pgsql/bin';
const exe = name => path.join(PG_BIN, process.platform === 'win32' ? name + '.exe' : name);
const available = fs.existsSync(path.join(BACKUP, 'public-schema.dump')) &&
  fs.existsSync(path.join(BACKUP, 'ratchet-kv-data.dump')) &&
  ['initdb','pg_ctl','pg_restore'].every(name => fs.existsSync(exe(name)));

function run(name, args, env = {}, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe(name), args, {
      env:{ ...process.env, ...env }, windowsHide:true, stdio:'ignore',
    });
    const timer = setTimeout(() => child.kill(), timeout);
    child.once('error', () => { clearTimeout(timer); reject(new Error(name + '_START_FAILED')); });
    child.once('exit', code => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(name + '_FAILED'));
    });
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

test('verified 2026-08-30 raw backup restores and satisfies the final analyzer', {
  skip:available ? false : 'private ignored backup or PostgreSQL utilities are absent',
  timeout:180_000,
}, async () => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchetx-snapshot-fixture-'));
  let started = false, client;
  try {
    await run('initdb', ['-D',path.join(cluster,'data'),'-U','postgres','--auth=trust','--encoding=UTF8','--locale=C']);
    const port = await freePort();
    await run('pg_ctl', ['-D',path.join(cluster,'data'),'-l',path.join(cluster,'postgres.log'),
      '-o','-h 127.0.0.1 -p ' + port,'-w','start']);
    started = true;
    const env = { PGHOST:'127.0.0.1', PGPORT:String(port), PGUSER:'postgres',
      PGDATABASE:'postgres', PGSSLMODE:'disable' };
    await run('pg_restore', ['--clean','--if-exists','--no-owner','--no-privileges',
      '--exit-on-error','--dbname=postgres',path.join(BACKUP,'public-schema.dump')], env);
    await run('pg_restore', ['--data-only','--no-owner','--no-privileges',
      '--exit-on-error','--dbname=postgres',path.join(BACKUP,'ratchet-kv-data.dump')], env);
    client = new Client({ host:'127.0.0.1', port, user:'postgres', database:'postgres' });
    await client.connect();
    await client.query("set timezone='UTC'");
    const cutoff = '2026-08-30T12:57:54.000000Z';
    const snapshot = await readSnapshot(client, cutoff);
    const repeated = await readSnapshot(client, cutoff);
    const fingerprint = (await client.query(FINGERPRINT_SQL)).rows[0];
    assert.equal(snapshot.analysis.proof.rowCount, fingerprint.row_count);
    assert.equal(snapshot.analysis.proof.databaseDigest, fingerprint.digest);
    assert.deepEqual(repeated.analysis.conservation, snapshot.analysis.conservation);
    assert.match(snapshot.analysis.proof.merkle.root, /^[0-9a-f]{64}$/);
    assert.equal(snapshot.analysis.log.verified, true);
    console.log(JSON.stringify({ restoredFixture:true, rows:fingerprint.row_count,
      databaseDigest:fingerprint.digest, merkleRoot:snapshot.analysis.proof.merkle.root }));
  } finally {
    if (client) await client.end().catch(() => {});
    if (started) await run('pg_ctl', ['-D',path.join(cluster,'data'),'-m','fast','-w','stop']).catch(() => {});
    const resolved = path.resolve(cluster), tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (resolved.startsWith(tempRoot) && path.basename(resolved).startsWith('ratchetx-snapshot-fixture-'))
      fs.rmSync(resolved, { recursive:true, force:true });
  }
});
