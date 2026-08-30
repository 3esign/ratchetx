// Operator-only diagnostic. No credentials in args/files/output; no DB writes.
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { createRequire } from 'node:module';
const { check } = createRequire(import.meta.url)('../lib/check_store_schema.js');
const afterMigration = process.argv.includes('--after-003');

if (!process.stdin.isTTY) {
  console.log('PRIVATE_TTY_REQUIRED');
  process.exit(2);
}
process.stdin.setRawMode(true);
process.stdin.resume();
let buffer = '', started = false;
const watchdog = setTimeout(() => process.exit(2), 60000);
console.log('PRIVATE_DATABASE_INPUT_READY');
process.stdin.on('data', async chunk => {
  if (started) return;
  buffer += chunk.toString();
  if (buffer.length > 8192) process.exit(2);
  let input;
  try { input = JSON.parse(buffer.trim()); } catch { return; }
  started = true;
  buffer = '';
  process.stdin.pause();
  let client;
  try {
    if (typeof input.password !== 'string' || !input.password) throw new Error('INPUT');
    const ca = [];
    for (const name of ['prod-ca-2021.crt', 'prod-ca-2025.crt']) {
      const response = await fetch('https://raw.githubusercontent.com/supabase/cli/develop/apps/cli-go/internal/gen/types/templates/' + name, {
        redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('CA_UNAVAILABLE');
      ca.push(await response.text());
    }
    const host = 'aws-1-eu-west-1.pooler.supabase.com';
    client = new Client({ host, port: 5432,
      user: 'postgres.gxwffzshaicpewbkziau', database: 'postgres', password: input.password,
      ssl: { rejectUnauthorized: true, ca, servername: host },
      connectionTimeoutMillis: 10000, application_name: 'ratchet_readonly_preflight',
    });
    client.on('error', () => {});
    await client.connect();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='10s'");
    const info = await client.query("select current_database() as database,current_user as role,current_setting('server_version') as version");
    const inspection = await client.query(afterMigration
      ? 'select public.ratchet_kv_guarded_ready() readiness'
      : readFileSync(new URL('../supabase/preflight_guarded_player_commits.sql', import.meta.url), 'utf8'));
    await client.query('COMMIT');
    console.log(JSON.stringify({ databaseConnection: 'verified-TLS', info: info.rows,
      [afterMigration ? 'readiness' : 'preflight']: inspection.rows }));
    if (typeof input.apiKey === 'string' && input.apiKey.startsWith('sb_secret_')) {
      const response = await fetch('https://gxwffzshaicpewbkziau.supabase.co/rest/v1/ratchet_kv?select=key&limit=0', {
        method: 'HEAD', redirect: 'error', headers: { apikey: input.apiKey }, signal: AbortSignal.timeout(10000),
      });
      console.log(JSON.stringify({ dataApiReadStatus: response.status, playerRowsRead: 0 }));
      if (afterMigration) {
        await check({ env: { SUPABASE_URL: 'https://gxwffzshaicpewbkziau.supabase.co', SUPABASE_SERVICE_KEY: input.apiKey } });
        console.log(JSON.stringify({ productionDataApiBuildGate: 'PASS', credentialFormat: 'opaque-server-key', playerRowsRead: 0 }));
      }
    }
  } catch (error) {
    // Do not print driver messages, SQL details, stacks or server response bodies.
    console.log(JSON.stringify({ probeFailed: true,
      code: String(error.code || 'CONNECTION_OR_QUERY_ERROR').replace(/[^A-Z0-9_]/g, '').slice(0, 64) }));
    process.exitCode = 1;
  } finally {
    input.password = ''; input.apiKey = '';
    if (client) await Promise.race([client.end().catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))]);
    clearTimeout(watchdog);
    process.stdin.setRawMode(false);
    process.exit(process.exitCode || 0);
  }
});
