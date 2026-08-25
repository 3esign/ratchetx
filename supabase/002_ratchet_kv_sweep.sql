-- RATCHET KV expired-row sweeper (h69, 2026-08-25).
-- Run once in the Supabase SQL editor as the project owner, after 001.
--
-- WHY: ratchet_kv rows with a TTL (price buckets, leases, gates with
-- exSeconds) are filtered out by every read the moment they expire, but the
-- rows themselves were never deleted — the table grew forever and every scan
-- walked dead weight. This function deletes a bounded batch of expired rows.
--
-- Deliberately NOT under the global advisory lock: readers already ignore
-- expired rows, setnx/hseed delete their own expired key under the lock
-- before deciding, and deleting an expired row twice is a no-op — so this
-- sweep cannot change any answer the store gives, and keeping it lock-free
-- means a large sweep never stalls gameplay writes.

begin;

create or replace function public.ratchet_kv_sweep(p_limit integer default 500)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  delete from public.ratchet_kv
   where key in (
     select key from public.ratchet_kv
      where expires_at is not null and expires_at <= now()
      limit greatest(1, least(coalesce(p_limit, 500), 5000))
   );
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.ratchet_kv_sweep(integer) from public, anon, authenticated;
grant execute on function public.ratchet_kv_sweep(integer) to service_role;

commit;
