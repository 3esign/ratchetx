-- 003: v3 security hardening + incr expiry — v3-deploy's edits to the ALREADY-APPLIED 001,
-- split into their own migration so 001 stays byte-identical to what production ran.
-- Idempotent (create or replace). Apply together with the v3 cutover, not before the
-- deployed lib/supabase_kv.js starts sending p_ex_seconds.

-- RATCHET generic state store for Supabase/Postgres.
-- Safe to re-run. Run in the Supabase SQL editor as the project owner.
-- All access is service-role-only; browsers never receive these credentials.

begin;

create table if not exists public.ratchet_kv (
  key text primary key,
  value jsonb not null default 'null'::jsonb,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists ratchet_kv_expires_idx on public.ratchet_kv (expires_at)
  where expires_at is not null;
alter table public.ratchet_kv enable row level security;
revoke all on table public.ratchet_kv from public, anon, authenticated;
grant select, insert, update, delete on table public.ratchet_kv to service_role;

create or replace function public.ratchet_kv_num(p_value jsonb)
returns numeric language sql immutable as $$
  select coalesce(nullif(p_value #>> '{}', '')::numeric, 0);
$$;

create or replace function public.ratchet_kv_get(p_key text)
returns jsonb language sql security definer set search_path = '' as $$
  select value from public.ratchet_kv
   where key = p_key and (expires_at is null or expires_at > now());
$$;

create or replace function public.ratchet_kv_mget(p_keys text[])
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(k.value order by q.ord), '[]'::jsonb)
    from unnest(p_keys) with ordinality q(key, ord)
    left join public.ratchet_kv k on k.key = q.key
      and (k.expires_at is null or k.expires_at > now());
$$;

create or replace function public.ratchet_kv_set(
  p_key text, p_value jsonb, p_ex_seconds integer default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(7241742381742);
  insert into public.ratchet_kv(key, value, expires_at, updated_at)
  values (p_key, coalesce(p_value, 'null'::jsonb),
    case when p_ex_seconds is null then null else now() + make_interval(secs => p_ex_seconds) end, now())
  on conflict (key) do update set value = excluded.value,
    expires_at = excluded.expires_at, updated_at = now();
end;
$$;

create or replace function public.ratchet_kv_set_many(p_entries jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare row jsonb;
begin
  perform pg_advisory_xact_lock(7241742381742);
  for row in select value from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    insert into public.ratchet_kv(key, value, expires_at, updated_at)
    values (row->>0, coalesce(row->1, 'null'::jsonb), null, now())
    on conflict (key) do update set value = excluded.value, expires_at = null, updated_at = now();
  end loop;
end;
$$;

create or replace function public.ratchet_kv_setnx(
  p_key text, p_value jsonb, p_ex_seconds integer default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(7241742381742);
  delete from public.ratchet_kv where key = p_key and expires_at is not null and expires_at <= now();
  if exists (select 1 from public.ratchet_kv where key = p_key) then return false; end if;
  insert into public.ratchet_kv(key, value, expires_at)
  values (p_key, coalesce(p_value, 'null'::jsonb),
    case when p_ex_seconds is null then null else now() + make_interval(secs => p_ex_seconds) end);
  return true;
end;
$$;

create or replace function public.ratchet_kv_release(p_key text, p_token text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(7241742381742);
  delete from public.ratchet_kv where key = p_key and value = to_jsonb(p_token)
    and (expires_at is null or expires_at > now());
  return found;
end;
$$;

create or replace function public.ratchet_kv_del(p_key text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(7241742381742);
  delete from public.ratchet_kv where key = p_key;
end;
$$;

create or replace function public.ratchet_kv_scan(p_pattern text)
returns text[] language sql security definer set search_path = '' as $$
  select coalesce(array_agg(key order by key), array[]::text[])
    from public.ratchet_kv
   where key like replace(p_pattern, '*', '%')
     and (expires_at is null or expires_at > now());
$$;

create or replace function public.ratchet_kv_incr(p_key text, p_by numeric, p_ex_seconds integer default null)
returns numeric language plpgsql security definer set search_path = '' as $$
declare n numeric;
begin
  perform pg_advisory_xact_lock(7241742381742);
  select public.ratchet_kv_num(value) into n from public.ratchet_kv
   where key = p_key and (expires_at is null or expires_at > now());
  n := coalesce(n, 0) + p_by;
  insert into public.ratchet_kv (key, value, expires_at) values (p_key, to_jsonb(n), case when p_ex_seconds is null then null else now() + make_interval(secs => p_ex_seconds) end) on conflict (key) do update set value = to_jsonb(n), updated_at = now(), expires_at = excluded.expires_at;
  return n;
end;
$$;

create or replace function public.ratchet_kv_take(p_key text)
returns numeric language plpgsql security definer set search_path = '' as $$
declare n numeric;
begin
  perform pg_advisory_xact_lock(7241742381742);
  select public.ratchet_kv_num(value) into n from public.ratchet_kv
   where key = p_key and (expires_at is null or expires_at > now());
  insert into public.ratchet_kv(key, value, expires_at, updated_at)
  values (p_key, '0'::jsonb, null, now()) on conflict (key) do update
    set value = '0'::jsonb, expires_at = null, updated_at = now();
  return coalesce(n, 0);
end;
$$;

create or replace function public.ratchet_kv_hall(p_key text)
returns jsonb language sql security definer set search_path = '' as $$
  select case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end
    from public.ratchet_kv
   where key = p_key and (expires_at is null or expires_at > now());
$$;

create or replace function public.ratchet_kv_hseed(p_key text, p_value jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(7241742381742);
  delete from public.ratchet_kv where key = p_key and expires_at is not null and expires_at <= now();
  if exists (select 1 from public.ratchet_kv where key = p_key) then return false; end if;
  insert into public.ratchet_kv(key, value) values
    (p_key, case when jsonb_typeof(p_value) = 'object' then p_value else '{}'::jsonb end);
  return true;
end;
$$;

create or replace function public.ratchet_kv_hincr_many(p_key text, p_deltas jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare obj jsonb := '{}'::jsonb; row record; next_value numeric;
begin
  perform pg_advisory_xact_lock(7241742381742);
  select case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end into obj
    from public.ratchet_kv where key = p_key and (expires_at is null or expires_at > now());
  obj := coalesce(obj, '{}'::jsonb);
  for row in select key, value from jsonb_each(coalesce(p_deltas, '{}'::jsonb)) loop
    next_value := public.ratchet_kv_num(obj->row.key) + public.ratchet_kv_num(row.value);
    obj := jsonb_set(obj, array[row.key], to_jsonb(next_value), true);
  end loop;
  insert into public.ratchet_kv(key, value, expires_at, updated_at)
  values (p_key, obj, null, now()) on conflict (key) do update
    set value = excluded.value, expires_at = null, updated_at = now();
  return obj;
end;
$$;

create or replace function public.ratchet_kv_hincr(p_key text, p_field text, p_by numeric)
returns numeric language plpgsql security definer set search_path = '' as $$
declare obj jsonb; n numeric;
begin
  obj := public.ratchet_kv_hincr_many(p_key, jsonb_build_object(p_field, p_by));
  n := public.ratchet_kv_num(obj->p_field);
  return n;
end;
$$;

create or replace function public.ratchet_kv_zincr(p_key text, p_member text, p_by numeric)
returns numeric language plpgsql security definer set search_path = '' as $$
declare obj jsonb := '{}'::jsonb; n numeric;
begin
  perform pg_advisory_xact_lock(7241742381742);
  select case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end into obj
    from public.ratchet_kv where key = p_key and (expires_at is null or expires_at > now());
  obj := coalesce(obj, '{}'::jsonb); n := public.ratchet_kv_num(obj->p_member) + p_by;
  obj := jsonb_set(obj, array[p_member], to_jsonb(n), true);
  insert into public.ratchet_kv(key, value, expires_at, updated_at)
  values (p_key, obj, null, now()) on conflict (key) do update
    set value = excluded.value, expires_at = null, updated_at = now();
  return n;
end;
$$;

create or replace function public.ratchet_kv_zmax(p_key text, p_member text, p_score numeric)
returns boolean language plpgsql security definer set search_path = '' as $$
declare obj jsonb := '{}'::jsonb; old numeric;
begin
  perform pg_advisory_xact_lock(7241742381742);
  select case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end into obj
    from public.ratchet_kv where key = p_key and (expires_at is null or expires_at > now());
  obj := coalesce(obj, '{}'::jsonb); old := public.ratchet_kv_num(obj->p_member);
  if obj ? p_member and old >= p_score then return false; end if;
  obj := jsonb_set(obj, array[p_member], to_jsonb(p_score), true);
  insert into public.ratchet_kv(key, value, expires_at, updated_at)
  values (p_key, obj, null, now()) on conflict (key) do update
    set value = excluded.value, expires_at = null, updated_at = now();
  return true;
end;
$$;

create or replace function public.ratchet_kv_ztop(p_key text, p_limit integer default null)
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_array(member, score) order by score desc, member), '[]'::jsonb)
  from (
    select e.key as member, public.ratchet_kv_num(e.value) as score
      from public.ratchet_kv k cross join lateral jsonb_each(
        case when jsonb_typeof(k.value) = 'object' then k.value else '{}'::jsonb end) e
     where k.key = p_key and (k.expires_at is null or k.expires_at > now())
     order by score desc, member
     limit case when p_limit is null or p_limit <= 0 then null else p_limit end
  ) ranked;
$$;

create or replace function public.ratchet_kv_apply_once(
  p_gate_key text, p_gate_value jsonb, p_counters jsonb default '[]'::jsonb,
  p_hash_key text default null, p_deltas jsonb default '{}'::jsonb,
  p_ex_seconds integer default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare row jsonb;
begin
  perform pg_advisory_xact_lock(7241742381742);
  delete from public.ratchet_kv where key = p_gate_key and expires_at is not null and expires_at <= now();
  if exists (select 1 from public.ratchet_kv where key = p_gate_key) then return false; end if;
  insert into public.ratchet_kv(key, value, expires_at) values
    (p_gate_key, coalesce(p_gate_value, 'null'::jsonb),
     case when p_ex_seconds is null then null else now() + make_interval(secs => p_ex_seconds) end);
  for row in select value from jsonb_array_elements(coalesce(p_counters, '[]'::jsonb)) loop
    perform public.ratchet_kv_incr(row->>0, (row->>1)::numeric);
  end loop;
  if p_hash_key is not null and p_deltas is not null and p_deltas <> '{}'::jsonb then
    perform public.ratchet_kv_hincr_many(p_hash_key, p_deltas);
  end if;
  return true;
end;
$$;

create or replace function public.ratchet_kv_zincr_many_once(
  p_gate_key text, p_gate_value jsonb, p_increments jsonb default '[]'::jsonb,
  p_ex_seconds integer default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare row jsonb;
begin
  perform pg_advisory_xact_lock(7241742381742);
  delete from public.ratchet_kv where key = p_gate_key and expires_at is not null and expires_at <= now();
  if exists (select 1 from public.ratchet_kv where key = p_gate_key) then return false; end if;
  insert into public.ratchet_kv(key, value, expires_at) values
    (p_gate_key, coalesce(p_gate_value, 'null'::jsonb),
     case when p_ex_seconds is null then null else now() + make_interval(secs => p_ex_seconds) end);
  for row in select value from jsonb_array_elements(coalesce(p_increments, '[]'::jsonb)) loop
    perform public.ratchet_kv_zincr(row->>0, row->>1, (row->>2)::numeric);
  end loop;
  return true;
end;
$$;

create or replace function public.ratchet_kv_import_rows(p_rows jsonb, p_overwrite boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare row jsonb; n integer := 0; exp timestamptz;
begin
  perform pg_advisory_xact_lock(7241742381742);
  for row in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    exp := case when row->>'expiresAt' is null then null else (row->>'expiresAt')::timestamptz end;
    if p_overwrite then
      insert into public.ratchet_kv(key, value, expires_at, updated_at)
      values (row->>'key', coalesce(row->'value', 'null'::jsonb), exp, now())
      on conflict (key) do update set value=excluded.value, expires_at=excluded.expires_at, updated_at=now();
      n := n + 1;
    else
      insert into public.ratchet_kv(key, value, expires_at, updated_at)
      values (row->>'key', coalesce(row->'value', 'null'::jsonb), exp, now())
      on conflict (key) do nothing;
      if found then n := n + 1; end if;
    end if;
  end loop;
  return n;
end;
$$;

create or replace function public.ratchet_kv_count()
returns bigint language sql security definer set search_path = '' as $$
  select count(*) from public.ratchet_kv where expires_at is null or expires_at > now();
$$;

-- Restrict every function from this migration to the backend service role.
do $$
declare f record;
begin
  for f in select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like 'ratchet_kv_%'
  loop
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', f.proname, f.args);
    execute format('grant execute on function public.%I(%s) to service_role', f.proname, f.args);
  end loop;
end $$;

commit;
