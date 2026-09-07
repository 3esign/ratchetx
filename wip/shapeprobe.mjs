// Diagnostic only: restore the committed backup and report the SHAPE of the
// stats rows -- field names and JSON types. No values are printed.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import net from 'node:net'; import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Client } = require('pg');
const BACKUP = 'backups/pre003-20260830-P7LEkP';
const PG = process.env.RATCHET_PG_BIN || 'C:/Users/treed/AppData/Local/Temp/ratchet-postgres-tools-20260830/expanded/pgsql/bin';
const bin = n => path.join(PG, n);
const run = (n, a, env) => new Promise((res, rej) => {
  const p = spawn(bin(n), a, { env: { ...process.env, ...env }, stdio: 'inherit' });
  p.on('error', rej); p.on('close', c => c === 0 ? res() : rej(new Error(n + ' exit ' + c)));
});
const freePort = () => new Promise((res, rej) => { const s = net.createServer();
  s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? rej(e) : res(p)); }); });
const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'rxprobe-'));
let started = false, client;
try {
  await run('initdb', ['-D', path.join(cluster, 'data'), '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C']);
  const port = await freePort();
  await run('pg_ctl', ['-D', path.join(cluster, 'data'), '-l', path.join(cluster, 'pg.log'), '-o', '-h 127.0.0.1 -p ' + port, '-w', 'start']);
  started = true;
  const env = { PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: 'postgres', PGDATABASE: 'postgres', PGSSLMODE: 'disable' };
  await run('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--exit-on-error', '--dbname=postgres', path.join(BACKUP, 'public-schema.dump')], env);
  await run('pg_restore', ['--data-only', '--no-owner', '--no-privileges', '--exit-on-error', '--dbname=postgres', path.join(BACKUP, 'ratchet-kv-data.dump')], env);
  client = new Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
  await client.connect();
  const q = await client.query(`
    select r.key, f.key as field, jsonb_typeof(f.value) as jtype,
           (coalesce(f.value #>> '{}','') ~ '^(0|[1-9][0-9]*)$') as is_plain_integer
    from public.ratchet_kv r, jsonb_each(r.value) f
    where r.key in ('h:stats','g:stats')
    order by r.key, f.key`);
  console.log('ROWS', q.rowCount);
  for (const row of q.rows) {
    const flag = (row.jtype !== 'number' || !row.is_plain_integer) ? '  <-- VIOLATION' : '';
    console.log(`${row.key}  ${String(row.field).padEnd(16)} ${String(row.jtype).padEnd(8)} plainInt=${row.is_plain_integer}${flag}`);
  }
  const t = await client.query(`select key, jsonb_typeof(value) as t from public.ratchet_kv where key in ('h:stats','g:stats')`);
  console.log('CONTAINER TYPES', JSON.stringify(t.rows));
} catch (e) { console.error('PROBE FAILED:', String(e.message || e)); }
finally {
  try { if (client) await client.end(); } catch {}
  try { if (started) await run('pg_ctl', ['-D', path.join(cluster, 'data'), '-w', 'stop']); } catch {}
}
