-- READ ONLY: catalog checks before migration 003. No player data is read.
-- Run in the SQL Editor of the existing Ratchet project, not a new project.
-- All rows should be true BEFORE the first installation. A false row needs review.
-- This is not a backup, migration, readiness test, or proof of runtime safety.
with target as (
  select oid, relkind, relrowsecurity
  from pg_class
  where oid = to_regclass('public.ratchet_kv')
), expected_columns(name, type_id, required) as (
  values
    ('key', 'text'::regtype::oid, true),
    ('value', 'jsonb'::regtype::oid, true),
    ('expires_at', 'timestamptz'::regtype::oid, false),
    ('updated_at', 'timestamptz'::regtype::oid, true)
), checks(provera, ok) as (
  values
    ('01 tabela i tipovi kolona',
      exists (select 1 from target where relkind = 'r')
      and not exists (
        select 1 from expected_columns e
        left join pg_attribute a on a.attrelid = (select oid from target)
          and a.attname = e.name and a.attnum > 0 and not a.attisdropped
        where a.attnum is null or a.atttypid <> e.type_id
          or a.attnotnull <> e.required
      )),
    ('02 primarni kljuc je key', exists (
      select 1 from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attname = 'key'
      where c.conrelid = (select oid from target) and c.contype = 'p'
        and c.conkey = array[a.attnum]
    )),
    ('03 pomocna numeric funkcija postoji', exists (
      select 1 from pg_proc
      where oid = to_regprocedure('public.ratchet_kv_num(jsonb)')
        and prorettype = 'numeric'::regtype and prokind = 'f'
    )),
    ('04 Supabase uloge postoje', (
      select count(*) = 3 from pg_roles
      where rolname in ('anon', 'authenticated', 'service_role')
    )),
    ('05 RLS je ukljucen', exists (
      select 1 from target where relrowsecurity
    )),
    ('06 nema ranijih funkcija migracije 003', not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in (
        'ratchet_kv_commit_guarded', 'ratchet_protect_guarded_player',
        'ratchet_kv_guarded_ready'
      )
    )),
    ('07 nema ranijeg zastitnog triggera', not exists (
      select 1 from pg_trigger
      where tgrelid = (select oid from target)
        and tgname = 'ratchet_guarded_player'
    ))
)
select provera, ok from checks order by provera;
