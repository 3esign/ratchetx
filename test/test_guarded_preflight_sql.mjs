import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql = name => readFileSync(new URL('../supabase/' + name, import.meta.url), 'utf8');
const db = new PGlite();
const preflight = sql('preflight_guarded_player_commits.sql');
const check = async () => (await db.query(preflight)).rows;
const flag = async prefix => (await check()).find(row => row.provera.startsWith(prefix)).ok;
try {
  assert.equal(await flag('01'), false, 'absent table must fail');
  assert.equal(await flag('04'), false, 'absent roles must fail without query errors');
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(sql('001_ratchet_kv.sql'));
  const baseline = await check();
  assert.equal(baseline.length, 7);
  assert.ok(baseline.every(row => row.ok === true), JSON.stringify(baseline));

  await db.exec('alter table public.ratchet_kv alter column updated_at drop not null;');
  assert.equal(await flag('01'), false, 'incompatible column must fail');
  await db.exec('alter table public.ratchet_kv alter column updated_at set not null;');
  await db.exec('alter table public.ratchet_kv drop constraint ratchet_kv_pkey;');
  assert.equal(await flag('02'), false, 'missing primary key must fail');
  await db.exec('alter table public.ratchet_kv add primary key (key);');
  await db.exec('alter function public.ratchet_kv_num(jsonb) rename to preflight_fixture_num;');
  assert.equal(await flag('03'), false, 'missing helper must fail');
  await db.exec('alter function public.preflight_fixture_num(jsonb) rename to ratchet_kv_num;');
  await db.exec('alter table public.ratchet_kv disable row level security;');
  assert.equal(await flag('05'), false, 'disabled RLS must fail');
  await db.exec('alter table public.ratchet_kv enable row level security;');
  assert.ok((await check()).every(row => row.ok === true));

  // Catalog-only check also runs inside a database-enforced read-only transaction.
  await db.exec('begin read only;');
  assert.ok((await check()).every(row => row.ok === true));
  await db.exec('commit;');
  await db.exec(sql('003_guarded_player_commits.sql'));
  assert.equal(await flag('06'), false, 'existing functions need review, not overwrite');
  assert.equal(await flag('07'), false, 'existing guard trigger needs review');
  console.log('PASS: read-only SQL preflight; baseline and negative controls (local PostgreSQL only).');
} finally {
  await db.close();
}
