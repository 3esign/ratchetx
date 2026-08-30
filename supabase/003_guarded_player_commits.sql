-- Guarded player/CAS/credit-queue commit + replay receipt, plus a compatible
-- replacement of legacy INCR: its arithmetic must use the locked current row.
-- No player balances are changed by applying this migration. Existing records
-- opt into old-writer protection on their first successful guarded commit.
begin;
create or replace function public.ratchet_kv_incr(p_key text, p_by numeric)
returns numeric language plpgsql security definer set search_path=public,pg_temp as $$
declare n numeric;
begin
  -- Preserve serialization with legacy apply_once/take callers. New guarded
  -- writers do not take this mutex, so a SELECT then stale-value UPSERT is unsafe.
  perform pg_advisory_xact_lock(7241742381742);
  insert into public.ratchet_kv as counter(key,value,expires_at,updated_at)
  values(p_key,to_jsonb(p_by),null,now())
  on conflict(key) do update set
    value=to_jsonb((case when counter.expires_at is not null and counter.expires_at<=now()
      then 0 else public.ratchet_kv_num(counter.value) end)+p_by),
    expires_at=null,updated_at=now()
  returning public.ratchet_kv_num(value) into n;
  return n;
end;
$$;
revoke all on function public.ratchet_kv_incr(text,numeric) from public,anon,authenticated;
grant execute on function public.ratchet_kv_incr(text,numeric) to service_role;

create or replace function public.ratchet_kv_commit_guarded(p_tx jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare k text; e jsonb; d jsonb; l jsonb; current_value jsonb; prior jsonb;
  n numeric; receipt_key text; keys text[]; written integer;
begin
  if coalesce(p_tx->>'id','') !~ '^[a-f0-9]{32}$' or coalesce(p_tx->>'digest','') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_tx->'entries') is distinct from 'array'
     or jsonb_typeof(p_tx->'debits') is distinct from 'array'
     or jsonb_typeof(p_tx->'leases') is distinct from 'array'
     or jsonb_array_length(p_tx->'entries') not between 1 and 12
  then raise exception 'invalid guarded commit'; end if;
  receipt_key := 'guarded:receipt:'||(p_tx->>'id');
  select array_agg(distinct x order by x) into keys from (
    select receipt_key x union all
    select value->>'key' from jsonb_array_elements(p_tx->'entries') union all
    select value->>0 from jsonb_array_elements(p_tx->'debits') union all
    select value->>'key' from jsonb_array_elements(p_tx->'leases')
  ) all_keys;
  -- Per-key locks serialize new writers even for rows not created yet. Row
  -- locks also fence existing RPC/direct writers; never a global request mutex.
  foreach k in array keys loop
    perform pg_advisory_xact_lock(hashtextextended(k, 101));
    perform 1 from public.ratchet_kv where key=k for update;
  end loop;
  select value into prior from public.ratchet_kv where key=receipt_key;
  if found then
    if prior->>'digest'=p_tx->>'digest' then return jsonb_build_object('ok',true,'replay',true); end if;
    return jsonb_build_object('ok',false,'code','COMMIT_ID_CONFLICT');
  end if;
  for l in select value from jsonb_array_elements(p_tx->'leases') loop
    select value into current_value from public.ratchet_kv where key=l->>'key'
      and (expires_at is null or expires_at>clock_timestamp());
    if not found or current_value is distinct from to_jsonb(l->>'token')
      or extract(epoch from clock_timestamp())*1000 >= (l->>'expiresAt')::numeric then
      return jsonb_build_object('ok',false,'code','WRITE_LEASE_EXPIRED');
    end if;
  end loop;
  for e in select value from jsonb_array_elements(p_tx->'entries') loop
    if not (e ? 'expected') or not (e ? 'value') or coalesce(e->>'key','')='' then
      raise exception 'invalid guarded entry'; end if;
    if e->>'key' like 'u:%' and e->'value'->>'_writeGuard' is distinct from '1' then
      raise exception 'player guard marker required'; end if;
    if (e->>'key' like 'u:%' or e->>'key'='g:chal') and not exists(
      select 1 from jsonb_array_elements(p_tx->'leases') as item(value)
      where item.value->>'key'='lock:'||(e->>'key')) then
      raise exception 'guarded player/board write requires its lease'; end if;
    select value into current_value from public.ratchet_kv where key=e->>'key';
    if coalesce(current_value,'null'::jsonb) is distinct from e->'expected' then
      return jsonb_build_object('ok',false,'code','WRITE_CONFLICT');
    end if;
  end loop;
  for d in select value from jsonb_array_elements(p_tx->'debits') loop
    select public.ratchet_kv_num(value) into n from public.ratchet_kv where key=d->>0;
    if (d->>0) !~ '^(pend|c7|cs7):' or (d->>1)::numeric<0 or coalesce(n,0)<(d->>1)::numeric then
      return jsonb_build_object('ok',false,'code','CREDIT_QUEUE_CONFLICT');
    end if;
  end loop;
  perform set_config('ratchet.guarded_commit',p_tx->>'id',true);
  for d in select value from jsonb_array_elements(p_tx->'debits') loop
    update public.ratchet_kv set value=to_jsonb(public.ratchet_kv_num(value)-(d->>1)::numeric),updated_at=clock_timestamp()
      where key=d->>0;
  end loop;
  for e in select value from jsonb_array_elements(p_tx->'entries') loop
    if e->'expected'='null'::jsonb then
      insert into public.ratchet_kv(key,value,expires_at,updated_at)
        values(e->>'key',e->'value',null,clock_timestamp()) on conflict(key) do nothing;
      get diagnostics written=row_count;
      if written<>1 then raise exception 'guarded insert conflict'; end if;
    else
      update public.ratchet_kv set value=e->'value',expires_at=null,updated_at=clock_timestamp() where key=e->>'key';
    end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(p_tx->'entries') as item(value) where item.value->>'key'='g:chal') then
    insert into public.ratchet_kv(key,value) values ('guarded:challenge-board','true'::jsonb) on conflict do nothing;
  end if;
  insert into public.ratchet_kv(key,value,expires_at) values(receipt_key,
    jsonb_build_object('digest',p_tx->>'digest'),clock_timestamp()+interval '7 days');
  return jsonb_build_object('ok',true,'replay',false);
end;
$$;
revoke all on function public.ratchet_kv_commit_guarded(jsonb) from public,anon,authenticated;
grant execute on function public.ratchet_kv_commit_guarded(jsonb) to service_role;

create or replace function public.ratchet_protect_guarded_player()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare w text; guarded boolean;
begin
  if coalesce(current_setting('ratchet.guarded_commit',true),'') ~ '^[a-f0-9]{32}$' then return new; end if;
  if old.key like 'u:%' and old.value->>'_writeGuard'='1' then
    raise exception 'unguarded player write refused';
  end if;
  if old.key='g:chal' and exists(select 1 from public.ratchet_kv where key='guarded:challenge-board') then
    raise exception 'unguarded challenge write refused'; end if;
  if old.key ~ '^(pend|c7|cs7):' and public.ratchet_kv_num(new.value)<public.ratchet_kv_num(old.value) then
    w:=substring(old.key from position(':' in old.key)+1);
    select value->>'_writeGuard'='1' into guarded from public.ratchet_kv where key='u:'||w;
    if coalesce(guarded,false) then raise exception 'unguarded credit drain refused'; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.ratchet_protect_guarded_player() from public,anon,authenticated;
drop trigger if exists ratchet_guarded_player on public.ratchet_kv;
create trigger ratchet_guarded_player before update on public.ratchet_kv
  for each row execute function public.ratchet_protect_guarded_player();

-- Read-only build prerequisite. A failed/missing migration must block a new
-- deployment, rather than replace the working app with failed player writes.
create or replace function public.ratchet_kv_guarded_ready()
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('schema','guarded-player-v1','ready',
    to_regprocedure('public.ratchet_kv_commit_guarded(jsonb)') is not null
    and exists(select 1 from pg_trigger where tgrelid='public.ratchet_kv'::regclass
      and tgname='ratchet_guarded_player' and tgenabled in ('O','A') and not tgisinternal));
$$;
revoke all on function public.ratchet_kv_guarded_ready() from public,anon,authenticated;
grant execute on function public.ratchet_kv_guarded_ready() to service_role;
commit;
