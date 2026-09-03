// One-time, read-only export of the legacy RatchetX authority.
//
// This is deliberately not a runtime adapter and not a failover. It opens a
// repeatable-read, read-only PostgreSQL transaction, exports every
// public.ratchet_kv row from the same snapshot, restores the dumps into an
// ephemeral local PostgreSQL cluster, and publishes only aggregate proof.
// Row values, credentials and raw keys remain in ACL-verified user-local
// storage outside the repository. The repository receives only aggregate proof.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { Client } from 'pg';

const require = createRequire(import.meta.url);
const { verifyStoredChain, CHUNK:LOG_CHUNK_SIZE } = require('../lib/log.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL_FILE = fileURLToPath(import.meta.url);
const RUNBOOK_FILE = path.join(ROOT, 'docs', 'SUPABASE_FINAL_SNAPSHOT.md');
const PROCEDURE_FILES = [
  TOOL_FILE,
  RUNBOOK_FILE,
  path.join(ROOT, 'lib', 'log.js'),
  path.join(ROOT, 'lib', 'canon.js'),
  path.join(ROOT, 'lib', 'legacy_chain.js'),
  path.join(ROOT, 'supabase', '001_ratchet_kv.sql'),
  path.join(ROOT, 'supabase', '003_guarded_player_commits.sql'),
  path.join(ROOT, 'package-lock.json'),
];
const LEGACY_PRIVATE_ROOT = path.join(ROOT, 'backups');
const PUBLIC_ROOT = path.join(ROOT, 'releases');
const PROJECT = 'gxwffzshaicpewbkziau';
const HOST = 'aws-1-eu-west-1.pooler.supabase.com';
const USER = 'postgres.' + PROJECT;
const TABLE = 'public.ratchet_kv';
const SCHEMA = 'ratchetx-legacy-snapshot-manifest';
const SCHEMA_VERSION = 1;
const WRITER_BARRIER = 'legacy-runtime-credential-revoked';
const BARRIER_SCHEMA = 'ratchetx-legacy-writer-barrier-attestation';
const BARRIER_SCHEMA_VERSION = 1;
const MAX_ROWS = 250_000;
const MAX_CANONICAL_BYTES = 512 * 1024 * 1024;
const MAX_SAFE_INTEGER_TEXT = '9007199254740991';
const LEAF_DOMAIN = Buffer.from('ratchetx-kv-leaf-v1\0');
const NODE_DOMAIN = Buffer.from('ratchetx-kv-node-v1\0');
export const RESTORE_SCHEMA_SQL = `create table public.ratchet_kv (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz,
  updated_at timestamptz not null
)`;
const SAFE_ROOT_FAMILIES = new Set([
  'agent-demo', 'agentrun', 'anch', 'anchor', 'agentname', 'aseal', 'asettle', 'asettled',
  'bal', 'c7', 'chal', 'chalexpire', 'chalref', 'chaltake', 'chaltaken',
  'champbal', 'chist', 'cs7', 'day', 'demo', 'evidence', 'fh', 'fhsettle',
  'funnel', 'funnel_daily', 'g', 'guarded', 'h', 'hist', 'hitpay', 'inv', 'ladder',
  'lb', 'lba', 'lbd', 'ldg', 'ldg2', 'ldg3', 'ldg4', 'ledger', 'live', 'lock',
  'mig', 'mirshot', 'nonce', 'odds', 'pend', 'play-session', 'play-status-throttle', 'proof',
  'px', 'pxlatest', 'pxstream', 'pxu', 'rolldebit', 'rollpay', 'rollplan',
  'ranked', 'reload', 'season', 'seal', 'session', 'settle', 'shotseal', 'sig',
  'stakefund', 'stakereverse', 'sup', 'u', 'void', 'wseal', 'wsettle', 'wvoid', 'x402', 'z',
]);
const SAFE_EVENT_TYPES = new Set([
  'anchor', 'chal', 'chalexpire', 'chaltake', 'daypot', 'hitpay', 'reload',
  'season', 'seal', 'settle', 'stake', 'stakeyield', 'wsettle',
]);

const CANONICAL_ROW_SQL = `jsonb_build_array(
  key,
  value,
  case when expires_at is null then null else
    to_char(expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
  to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
)::text`;

export const FINGERPRINT_SQL = `select count(*)::text row_count,
  encode(sha256(convert_to(coalesce(string_agg(
    encode(sha256(convert_to(${CANONICAL_ROW_SQL},'UTF8')),'hex'),
    '' order by key collate "C"),''),'UTF8')),'hex') digest,
  coalesce(to_char(max(updated_at) at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'') max_updated_at
  from ${TABLE}`;

export const AUTHORITY_SQL = `with
target as (
  select c.oid, c.relowner, c.relrowsecurity, c.relforcerowsecurity, c.relacl
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='ratchet_kv' and c.relkind in ('r','p')
),
functions as (
  select p.oid, p.proowner, p.prosecdef, p.proacl,
    p.prorettype='pg_catalog.trigger'::regtype is_trigger,
    p.oid::regprocedure::text identity
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'ratchet\\_%' escape '\\'
),
table_acl as (
  select t.relowner, x.grantee, x.privilege_type
  from target t cross join lateral aclexplode(coalesce(t.relacl,acldefault('r',t.relowner))) x
),
function_acl as (
  select f.proowner, x.grantee, x.privilege_type
  from functions f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) x
),
canonical as (
  select jsonb_build_object(
    'table',(select jsonb_build_array(relowner::regrole::text,relrowsecurity,
      relforcerowsecurity,coalesce(relacl::text,'')) from target),
    'functions',coalesce((select jsonb_agg(jsonb_build_array(identity,
      proowner::regrole::text,prosecdef,is_trigger,coalesce(proacl::text,'')) order by identity)
      from functions),'[]'::jsonb)
  )::text value
)
select
  (select count(*) from target)::text target_table_count,
  coalesce((select relrowsecurity from target),false)::text rls_enabled,
  coalesce((select relforcerowsecurity from target),false)::text rls_forced,
  has_table_privilege('service_role','public.ratchet_kv','SELECT')::text service_role_select,
  has_table_privilege('service_role','public.ratchet_kv','INSERT')::text service_role_insert,
  has_table_privilege('service_role','public.ratchet_kv','UPDATE')::text service_role_update,
  has_table_privilege('service_role','public.ratchet_kv','DELETE')::text service_role_delete,
  (select count(*) from table_acl where privilege_type in
    ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
    and grantee<>relowner
    and grantee<>(select oid from pg_roles where rolname='service_role'))::text unexpected_table_grants,
  (select count(*) from functions)::text ratchet_function_count,
  (select count(*) from functions where not is_trigger)::text ratchet_rpc_function_count,
  (select count(*) from function_acl where privilege_type='EXECUTE'
    and grantee<>proowner
    and grantee<>(select oid from pg_roles where rolname='service_role'))::text unexpected_function_grants,
  (select count(*) from functions f where not is_trigger
    and has_function_privilege('service_role',f.oid,'EXECUTE'))::text service_role_rpc_function_count,
  encode(sha256(convert_to((select value from canonical),'UTF8')),'hex') grants_fingerprint,
  (select value from canonical) private_canonical`;

export const ROWS_SQL = `select key, value,
  (expires_at is not null and expires_at <= $1::timestamptz) expired,
  ${CANONICAL_ROW_SQL} canonical
  from ${TABLE}
  order by key collate "C"`;

// These are state-bucket totals, not a claim that credits have a fixed supply.
// Hit payouts and welcome grants intentionally change play-credit totals. The
// conservation claim is that every bucket is restored bit-for-bit and that no
// malformed/negative obligation is silently imported.
export const CONSERVATION_SQL = `with
players as (
  select key, value from ${TABLE} where key like 'u:%'
),
open_shots as (
  select p.key player_key, s.value shot from players p cross join lateral jsonb_array_elements(
    case when jsonb_typeof(p.value->'open')='array' then p.value->'open' else '[]'::jsonb end) s
),
closed_shots as (
  select p.key player_key, s.value shot from players p cross join lateral jsonb_array_elements(
    case when jsonb_typeof(p.value->'closed')='array' then p.value->'closed' else '[]'::jsonb end) s
),
outbox as (
  select p.key player_key, s.value item from players p cross join lateral jsonb_array_elements(
    case when jsonb_typeof(p.value->'settlementOutbox')='array'
      then p.value->'settlementOutbox' else '[]'::jsonb end) s
),
challenges as (
  select c.value challenge from ${TABLE} k cross join lateral jsonb_array_elements(
    case when k.key='g:chal' and jsonb_typeof(k.value)='array'
      then k.value else '[]'::jsonb end) c where k.key='g:chal'
),
queues as (
  select key, value from ${TABLE} where key like 'pend:%' or key like 'c7:%' or key like 'cs7:%'
),
sessions as (
  select value from ${TABLE} where key like 'play-session:v1:%'
),
histories as (
  select value from ${TABLE} where key like 'hist:%'
),
champion_histories as (
  select value from ${TABLE} where key like 'chist:%'
),
stats as (
  select value from ${TABLE} where key in ('h:stats','g:stats')
  order by case key when 'h:stats' then 0 else 1 end limit 1
)
select
  (select count(*) from players)::text player_count,
  (select coalesce(sum(case when coalesce(value->>'cr','') ~ '^-?(0|[1-9][0-9]*)$'
    then (value->>'cr')::numeric else 0 end),0) from players)::text player_credits,
  (select coalesce(sum(case when coalesce(value->>'bal','') ~ '^-?(0|[1-9][0-9]*)$'
    then (value->>'bal')::numeric else 0 end),0) from players)::text legacy_player_balance,
  (select coalesce(sum(case when coalesce(value->>'xp','') ~ '^-?(0|[1-9][0-9]*)$'
    then (value->>'xp')::numeric else 0 end),0) from players)::text player_xp,
  (select coalesce(sum(case when coalesce(value->>'burned','') ~ '^-?(0|[1-9][0-9]*)$'
    then (value->>'burned')::numeric else 0 end),0) from players)::text player_attributed_rcx_burned,
  (select count(*) from players where jsonb_typeof(value)<>'object'
    or coalesce(value->>'w','')='' or key <> 'u:' || (value->>'w'))::text player_shape_violations,
  (select count(*) from players where
    (value ? 'open' and coalesce(jsonb_typeof(value->'open'),'null')<>'array')
    or (value ? 'settlementOutbox' and coalesce(jsonb_typeof(value->'settlementOutbox'),'null')<>'array')
    or (value ? 'closed' and coalesce(jsonb_typeof(value->'closed'),'null')<>'array'))::text player_container_shape_violations,
  (select count(*) from players where
    case when jsonb_typeof(value)<>'object' then true
      when coalesce(value->>'cr','') ~ '^(0|[1-9][0-9]*)$'
        then (value->>'cr')::numeric > ${MAX_SAFE_INTEGER_TEXT} else true end
    or case when coalesce(value->>'xp','') ~ '^(0|[1-9][0-9]*)$'
        then (value->>'xp')::numeric > ${MAX_SAFE_INTEGER_TEXT} else true end
    or case when coalesce(value->>'burned','') ~ '^(0|[1-9][0-9]*)$'
        then (value->>'burned')::numeric > ${MAX_SAFE_INTEGER_TEXT} else true end
    or case when not (value ? 'bal') then false
        when coalesce(value->>'bal','') ~ '^(0|[1-9][0-9]*)$'
        then (value->>'bal')::numeric > ${MAX_SAFE_INTEGER_TEXT} else true end
  )::text player_numeric_shape_violations,
  (select count(*) from players where
    case when coalesce(value->>'cr','') ~ '^-?[0-9]+$' then (value->>'cr')::numeric<0 else false end
    or case when coalesce(value->>'bal','') ~ '^-?[0-9]+$' then (value->>'bal')::numeric<0 else false end
    or case when coalesce(value->>'xp','') ~ '^-?[0-9]+$' then (value->>'xp')::numeric<0 else false end
    or case when coalesce(value->>'burned','') ~ '^-?[0-9]+$' then (value->>'burned')::numeric<0 else false end
  )::text negative_player_values,
  (select count(*) from open_shots)::text open_shot_count,
  (select coalesce(sum(case when coalesce(shot->>'stake','') ~ '^(0|[1-9][0-9]*)$'
    then (shot->>'stake')::numeric else 0 end),0) from open_shots)::text open_shot_stake,
  (select count(*) from open_shots where
    case when jsonb_typeof(shot)<>'object' then true
      when jsonb_typeof(shot->'id')<>'string' or length(shot->>'id') not between 1 and 120 then true
      when coalesce(shot->>'stake','') !~ '^[1-9][0-9]*$' then true
      when (shot->>'stake')::numeric > ${MAX_SAFE_INTEGER_TEXT} then true
      when coalesce(shot->>'exp','') !~ '^[1-9][0-9]*$' then true
      when (shot->>'exp')::numeric > ${MAX_SAFE_INTEGER_TEXT} then true
      when coalesce(shot->>'side','') not in ('UP','DOWN','YES','NO') then true
      when coalesce(shot->>'kind','')='' or coalesce(shot->>'feed','')='' then true
      else false end)::text open_shot_shape_violations,
  (select coalesce(sum(n-1),0) from (
    select shot->>'id' id, count(*) n from open_shots
    where jsonb_typeof(shot)='object' and jsonb_typeof(shot->'id')='string'
    group by shot->>'id' having count(*)>1
  ) d)::text duplicate_open_shot_ids,
  (select count(*) from outbox)::text settlement_outbox_count,
  (select coalesce(sum(case when coalesce(item->'s'->>'stake','') ~ '^(0|[1-9][0-9]*)$'
    then (item->'s'->>'stake')::numeric else 0 end),0) from outbox)::text settlement_outbox_stake,
  (select count(*) from outbox where
    case when jsonb_typeof(item)<>'object' or jsonb_typeof(item->'s')<>'object' then true
      when jsonb_typeof(item->'s'->'id')<>'string' or length(item->'s'->>'id') not between 1 and 120 then true
      when coalesce(item->'s'->>'stake','') !~ '^[1-9][0-9]*$' then true
      when (item->'s'->>'stake')::numeric > ${MAX_SAFE_INTEGER_TEXT} then true
      when coalesce(item->'s'->>'res','') not in ('hit','miss','void') then true
      else false end)::text settlement_outbox_shape_violations,
  (select coalesce(sum(n-1),0) from (
    select player_key, item->'s'->>'id' id, count(*) n from outbox
    where jsonb_typeof(item->'s')='object' and jsonb_typeof(item->'s'->'id')='string'
    group by player_key, item->'s'->>'id' having count(*)>1
  ) d)::text duplicate_settlement_outbox_ids,
  (select count(*) from closed_shots)::text retained_closed_shot_count,
  (select coalesce(sum(case when coalesce(shot->>'stake','') ~ '^(0|[1-9][0-9]*)$'
    then (shot->>'stake')::numeric else 0 end),0) from closed_shots)::text retained_closed_shot_stake,
  (select count(*) from closed_shots where
    case when jsonb_typeof(shot)<>'object' then true
      when jsonb_typeof(shot->'id')<>'string' or length(shot->>'id') not between 1 and 120 then true
      when coalesce(shot->>'stake','') !~ '^[1-9][0-9]*$' then true
      when (shot->>'stake')::numeric > ${MAX_SAFE_INTEGER_TEXT} then true
      when coalesce(shot->>'res','') not in ('hit','miss','void') then true
      else false end)::text closed_shot_shape_violations,
  (select coalesce(sum(n-1),0) from (
    select player_key, shot->>'id' id, count(*) n from closed_shots
    where jsonb_typeof(shot)='object' and jsonb_typeof(shot->'id')='string'
    group by player_key, shot->>'id' having count(*)>1
  ) d)::text duplicate_closed_shot_ids,
  (select count(*) from challenges)::text open_challenge_count,
  (select coalesce(sum(case when coalesce(challenge->>'stake','') ~ '^(0|[1-9][0-9]*)$'
    then (challenge->>'stake')::numeric else 0 end),0) from challenges)::text open_challenge_stake,
  (select count(*) from challenges where
    case when jsonb_typeof(challenge)<>'object' then true
      when jsonb_typeof(challenge->'id')<>'string' or length(challenge->>'id') not between 1 and 120 then true
      when jsonb_typeof(challenge->'by')<>'string' or coalesce(challenge->>'by','')='' then true
      when coalesce(challenge->>'stake','') !~ '^[1-9][0-9]*$' then true
      when (challenge->>'stake')::numeric > ${MAX_SAFE_INTEGER_TEXT} then true
      when coalesce(challenge->>'expiresAt','') !~ '^[1-9][0-9]*$' then true
      when (challenge->>'expiresAt')::numeric > ${MAX_SAFE_INTEGER_TEXT} then true
      when coalesce(challenge->>'side','') not in ('YES','NO') then true
      when coalesce(challenge->>'kind','')='' or coalesce(challenge->>'feed','')='' then true
      else false end)::text challenge_shape_violations,
  (select coalesce(sum(n-1),0) from (
    select challenge->>'id' id, count(*) n from challenges
    where jsonb_typeof(challenge)='object' and jsonb_typeof(challenge->'id')='string'
    group by challenge->>'id' having count(*)>1
  ) d)::text duplicate_challenge_ids,
  (select count(*) from ${TABLE} where key='g:chal'
    and coalesce(jsonb_typeof(value),'null')<>'array')::text challenge_container_shape_violations,
  (select coalesce(sum(case when coalesce(value #>> '{}','') ~ '^(0|[1-9][0-9]*)$'
    then (value #>> '{}')::numeric else 0 end),0) from queues where key like 'pend:%')::text pending_play_credits,
  (select coalesce(sum(case when coalesce(value #>> '{}','') ~ '^(0|[1-9][0-9]*)$'
    then (value #>> '{}')::numeric else 0 end),0) from queues where key like 'c7:%')::text pending_champion_received_rcx,
  (select coalesce(sum(case when coalesce(value #>> '{}','') ~ '^(0|[1-9][0-9]*)$'
    then (value #>> '{}')::numeric else 0 end),0) from queues where key like 'cs7:%')::text pending_champion_self_routed_rcx,
  (select count(*) from queues where
    case when jsonb_typeof(value)<>'number' or coalesce(value #>> '{}','') !~ '^(0|[1-9][0-9]*)$'
      then true else (value #>> '{}')::numeric > ${MAX_SAFE_INTEGER_TEXT} end)::text queue_shape_violations,
  (select count(*) from sessions)::text play_session_count,
  (select count(*) from sessions where value->>'pending' is not null)::text play_session_pending_count,
  (select count(*) from sessions where jsonb_typeof(value)<>'object')::text play_session_shape_violations,
  (select count(*) from histories)::text history_wallet_count,
  (select coalesce(sum(jsonb_array_length(case when jsonb_typeof(value)='array'
    then value else '[]'::jsonb end)),0) from histories)::text history_entry_count,
  (select count(*) from histories where jsonb_typeof(value)<>'array')::text history_shape_violations,
  (select count(*) from champion_histories)::text champion_history_wallet_count,
  (select coalesce(sum(jsonb_array_length(case when jsonb_typeof(value)='array'
    then value else '[]'::jsonb end)),0) from champion_histories)::text champion_history_entry_count,
  (select count(*) from champion_histories where jsonb_typeof(value)<>'array')::text champion_history_shape_violations,
  (select count(*) from ${TABLE} where key like 'sig:%')::text signature_gate_count,
  (select count(*) from ${TABLE} where key like 'sig:%'
    and jsonb_typeof(value)='object' and value ? 'amount')::text reload_signature_gate_count,
  (select count(*) from ${TABLE} where key like 'g:log:once:seal:%')::text seal_event_gate_count,
  (select count(*) from ${TABLE} where key like 'g:log:once:settle:%')::text settlement_event_gate_count,
  (select count(*) from ${TABLE} where key like 'guarded:receipt:%')::text guarded_receipt_count,
  (select count(*) from ${TABLE} where key like 'stakefund:%')::text stake_fund_gate_count,
  (select count(*) from ${TABLE} where key like 'stakereverse:%')::text stake_reverse_gate_count,
  (select count(*) from ${TABLE} where key like 'hitpay:%')::text hit_payout_gate_count,
  (select count(*) from ${TABLE} where key like 'ladder:%')::text ladder_gate_count,
  (select count(*) from ${TABLE} where key like 'ledger:%')::text ledger_gate_count,
  (select count(*) from ${TABLE} where key like 'rollplan:%')::text rollover_plan_count,
  (select count(*) from ${TABLE} where key like 'rollpay:%')::text rollover_payment_gate_count,
  (select count(*) from ${TABLE} where key like 'rolldebit:%')::text rollover_debit_gate_count,
  (select count(*) from ${TABLE} where key like 'lock:%'
    and (expires_at is null or expires_at > $1::timestamptz))::text live_lease_count,
  (select count(*) from ${TABLE} where expires_at is not null
    and expires_at <= $1::timestamptz)::text expired_row_count,
  (select count(*) from stats where
    case when jsonb_typeof(value)<>'object' then true
      else exists (select 1 from jsonb_each(value) field
        where field.key in ('burned','pot','potD','shots','realBurned','champPaid',
          'champRetained','stakePaid','stakers','hitPaid')
        and (jsonb_typeof(field.value)<>'number'
          or coalesce(field.value #>> '{}','') !~ '^(0|[1-9][0-9]*)$'
          or case when coalesce(field.value #>> '{}','') ~ '^(0|[1-9][0-9]*)$'
            then (field.value #>> '{}')::numeric > ${MAX_SAFE_INTEGER_TEXT} else false end))
      end)::text stats_shape_violations,
  (select coalesce(sum(10 - (
      (value ? 'burned')::int + (value ? 'pot')::int + (value ? 'potD')::int +
      (value ? 'shots')::int + (value ? 'realBurned')::int + (value ? 'champPaid')::int +
      (value ? 'champRetained')::int + (value ? 'stakePaid')::int +
      (value ? 'stakers')::int + (value ? 'hitPaid')::int
    )),0) from stats where jsonb_typeof(value)='object')::text stats_missing_expected_fields,
  (select count(*) from ${TABLE} where key in ('h:stats','g:stats'))::text stats_source_row_count,
  coalesce((select case when coalesce(value->>'burned','') ~ '^(0|[1-9][0-9]*)$'
    then value->>'burned' else '0' end from stats),'0')::numeric::text stats_allocated_burned_credits,
  coalesce((select case when coalesce(value->>'pot','') ~ '^(0|[1-9][0-9]*)$'
    then value->>'pot' else '0' end from stats),'0')::numeric::text weekly_pot_credits,
  coalesce((select case when coalesce(value->>'potD','') ~ '^(0|[1-9][0-9]*)$'
    then value->>'potD' else '0' end from stats),'0')::numeric::text daily_pot_credits,
  coalesce((select case when coalesce(value->>'shots','') ~ '^(0|[1-9][0-9]*)$'
    then value->>'shots' else '0' end from stats),'0')::numeric::text stats_shot_count,
  coalesce((select case when coalesce(value->>'realBurned','') ~ '^(0|[1-9][0-9]*)$'
    then value->>'realBurned' else '0' end from stats),'0')::numeric::text verified_rcx_burned,
  coalesce((select case when coalesce(value->>'champPaid','') ~ '^(0|[1-9][0-9]*)$'
    then value->>'champPaid' else '0' end from stats),'0')::numeric::text verified_rcx_champion_paid,
  coalesce((select case when coalesce(value->>'champRetained','') ~ '^(0|[1-9][0-9]*)$'
    then value->>'champRetained' else '0' end from stats),'0')::numeric::text verified_rcx_champion_retained,
  coalesce((select case when coalesce(value->>'hitPaid','') ~ '^(0|[1-9][0-9]*)$'
    then value->>'hitPaid' else '0' end from stats),'0')::numeric::text hit_payout_credits,
  coalesce((select case when coalesce(value->>'stakePaid','') ~ '^(0|[1-9][0-9]*)$'
    then value->>'stakePaid' else '0' end from stats),'0')::numeric::text staking_paid_credits,
  coalesce((select case when coalesce(value->>'stakers','') ~ '^(0|[1-9][0-9]*)$'
    then value->>'stakers' else '0' end from stats),'0')::numeric::text staker_count`;

const sha256 = value => crypto.createHash('sha256').update(value).digest();
const hex = value => sha256(value).toString('hex');
const safeCode = value => String(value || 'SNAPSHOT_FAILED').toUpperCase()
  .replace(/[^A-Z0-9_]/g, '').slice(0, 80) || 'SNAPSHOT_FAILED';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function sameResolvedPath(left, right, platform = process.platform) {
  const a = path.resolve(left), b = path.resolve(right);
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function privateRootPath({ platform = process.platform, env = process.env,
  home = os.homedir() } = {}) {
  let base;
  if (platform === 'win32') {
    base = env.LOCALAPPDATA;
    if (typeof base !== 'string' || !path.win32.isAbsolute(base)) fail('PRIVATE_LOCALAPPDATA_REQUIRED');
  } else {
    base = typeof env.XDG_DATA_HOME === 'string' && path.isAbsolute(env.XDG_DATA_HOME)
      ? env.XDG_DATA_HOME : path.join(home, '.local', 'share');
    if (!path.isAbsolute(base)) fail('PRIVATE_USER_DATA_ROOT_REQUIRED');
  }
  const resolvedBase = path.resolve(base);
  const root = path.resolve(resolvedBase, 'RatchetX', 'private-snapshots');
  if (!isWithin(resolvedBase, root) || isWithin(ROOT, root)) fail('PRIVATE_ROOT_OUTSIDE_USER_DATA_REQUIRED');
  return root;
}

function assertNoPosixSymlinkAncestors(target) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  let cursor = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) fail('PRIVATE_ROOT_REPARSE_POINT');
  }
}

function childEnvironment(overrides = {}) {
  const allowed = ['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'PATH', 'TEMP', 'TMP',
    'USERPROFILE', 'HOME', 'LANG', 'LC_ALL', 'TZ'];
  const clean = {};
  for (const wanted of allowed) {
    const actual = Object.keys(process.env).find(key => key.toLowerCase() === wanted.toLowerCase());
    if (actual && process.env[actual] != null) clean[actual] = process.env[actual];
  }
  return { ...clean, ...overrides };
}

function runExecutable(executable, args, env = {}, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: childEnvironment(env), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { if (stdout.length < 64 * 1024) stdout += chunk; });
    child.stderr.on('data', chunk => { if (stderr.length < 64 * 1024) stderr += chunk; });
    const timer = setTimeout(() => child.kill(), timeout);
    child.once('error', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('PRIVATE_ACL_UTILITY_START_FAILED'),
        { code:'PRIVATE_ACL_UTILITY_START_FAILED' }));
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(Object.assign(new Error('PRIVATE_ACL_FAILED'),
        { code:'PRIVATE_ACL_FAILED', privateDetail:stderr }));
      else resolve(stdout);
    });
  });
}

const WINDOWS_PRIVATE_ACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:RATCHET_PRIVATE_ACL_PATH
if ([string]::IsNullOrWhiteSpace($target) -or -not [IO.Path]::IsPathFullyQualified($target)) {
  throw 'PRIVATE_ACL_PATH_INVALID'
}
$me = [Security.Principal.WindowsIdentity]::GetCurrent().User
$system = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$cursorPath = [IO.Path]::GetFullPath($target)
while (-not [IO.Directory]::Exists($cursorPath) -and -not [IO.File]::Exists($cursorPath)) {
  $parent = [IO.Directory]::GetParent($cursorPath)
  if ($null -eq $parent) { throw 'PRIVATE_ACL_ANCESTOR_NOT_FOUND' }
  $cursorPath = $parent.FullName
}
$cursor = Get-Item -LiteralPath $cursorPath -Force
while ($null -ne $cursor) {
  if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'PRIVATE_ROOT_REPARSE_POINT'
  }
  $cursor = $cursor.Parent
}
if ($env:RATCHET_PRIVATE_ACL_MODE -eq 'preflight') {
  [Console]::Out.Write('PRIVATE_ACL_OK')
  return
}
if (-not [IO.Directory]::Exists($target)) { throw 'PRIVATE_ACL_TARGET_NOT_FOUND' }
if ($env:RATCHET_PRIVATE_ACL_MODE -eq 'set') {
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  $inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
  $none = [Security.AccessControl.PropagationFlags]::None
  $allow = [Security.AccessControl.AccessControlType]::Allow
  $acl.SetOwner($me)
  $null = $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($me,
    [Security.AccessControl.FileSystemRights]::FullControl, $inheritance, $none, $allow)))
  $null = $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($system,
    [Security.AccessControl.FileSystemRights]::FullControl, $inheritance, $none, $allow)))
  Set-Acl -LiteralPath $target -AclObject $acl
}
$items = @((Get-Item -LiteralPath $target -Force))
if ($env:RATCHET_PRIVATE_ACL_MODE -eq 'verify-tree') {
  $items += @(Get-ChildItem -LiteralPath $target -Force -Recurse)
}
foreach ($item in $items) {
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'PRIVATE_TREE_REPARSE_POINT'
  }
  $acl = Get-Acl -LiteralPath $item.FullName
  $isRoot = [IO.Path]::GetFullPath($item.FullName) -eq [IO.Path]::GetFullPath($target)
  if ($isRoot -and -not $acl.AreAccessRulesProtected) { throw 'PRIVATE_ACL_INHERITANCE_ENABLED' }
  $owner = (New-Object Security.Principal.NTAccount($acl.Owner)).Translate(
    [Security.Principal.SecurityIdentifier]).Value
  if ($owner -ne $me.Value) { throw 'PRIVATE_ACL_OWNER_MISMATCH' }
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  if ($isRoot -and $rules.Count -ne 2) { throw 'PRIVATE_ACL_RULE_COUNT_INVALID' }
  $meFull = $false
  $systemFull = $false
  foreach ($rule in $rules) {
    if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) {
      throw 'PRIVATE_ACL_NON_ALLOW_RULE'
    }
    $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($sid -ne $me.Value -and $sid -ne $system.Value) { throw 'PRIVATE_ACL_BROAD_ALLOW' }
    if ($isRoot) {
      if ($rule.IsInherited) { throw 'PRIVATE_ACL_INHERITED_RULE' }
      $expectedInheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [Security.AccessControl.InheritanceFlags]::ObjectInherit
      if ($rule.InheritanceFlags -ne $expectedInheritance -or
          $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None) {
        throw 'PRIVATE_ACL_INHERITANCE_SCOPE_INVALID'
      }
    } elseif (-not $rule.IsInherited) { throw 'PRIVATE_ACL_CHILD_EXPLICIT_RULE' }
    $full = (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq
      [Security.AccessControl.FileSystemRights]::FullControl)
    if ($sid -eq $me.Value -and $full) { $meFull = $true }
    if ($sid -eq $system.Value -and $full) { $systemFull = $true }
  }
  if (-not $meFull -or -not $systemFull) { throw 'PRIVATE_ACL_FULL_CONTROL_MISSING' }
}
[Console]::Out.Write('PRIVATE_ACL_OK')
`;

async function runWindowsPrivateAcl(directory, mode) {
  const systemRootKey = Object.keys(process.env).find(key => key.toLowerCase() === 'systemroot');
  const systemRoot = systemRootKey && process.env[systemRootKey];
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) fail('WINDOWS_SYSTEM_ROOT_REQUIRED');
  const executable = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (!fs.existsSync(executable)) fail('WINDOWS_ACL_UTILITY_NOT_FOUND');
  const encoded = Buffer.from(WINDOWS_PRIVATE_ACL_SCRIPT, 'utf16le').toString('base64');
  const output = await runExecutable(executable,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { RATCHET_PRIVATE_ACL_PATH:directory, RATCHET_PRIVATE_ACL_MODE:mode });
  if (output !== 'PRIVATE_ACL_OK') fail('PRIVATE_ACL_VERIFICATION_FAILED');
}

export async function securePrivateDirectory(directory, verifyTree = false) {
  if (process.platform === 'win32') {
    const mode = verifyTree ? 'verify-tree' : 'set';
    await runWindowsPrivateAcl(directory, mode);
    return { policy:'windows-protected-current-user-and-system-only-v1', verified:true };
  }
  fs.chmodSync(directory, 0o700);
  if ((fs.statSync(directory).mode & 0o077) !== 0) fail('PRIVATE_POSIX_MODE_UNSAFE');
  if (verifyTree) {
    for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail('PRIVATE_TREE_REPARSE_POINT');
      const forbidden = entry.isDirectory() ? 0o077 : 0o177;
      if ((fs.statSync(full).mode & forbidden) !== 0) fail('PRIVATE_POSIX_MODE_UNSAFE');
    }
  }
  return { policy:'posix-owner-only-v1', verified:true };
}

async function preparePrivateRoot() {
  const root = privateRootPath();
  if (process.platform === 'win32') await runWindowsPrivateAcl(root, 'preflight');
  else assertNoPosixSymlinkAncestors(path.dirname(root));
  fs.mkdirSync(root, { recursive:true, mode:0o700 });
  await securePrivateDirectory(root);
  const realRoot = fs.realpathSync.native(root);
  if (!sameResolvedPath(realRoot, root)) fail('PRIVATE_ROOT_REPARSE_POINT');
  return root;
}

export function readBarrierEvidence(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) fail('BARRIER_EVIDENCE_FILE_REQUIRED');
  const resolved = path.resolve(file);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 16 * 1024)
    fail('BARRIER_EVIDENCE_FILE_INVALID');
  const raw = fs.readFileSync(resolved);
  let record;
  try { record = JSON.parse(raw.toString('utf8')); } catch { fail('BARRIER_EVIDENCE_JSON_INVALID'); }
  const keys = Object.keys(record || {}).sort();
  const expected = ['allReachableLegacyDeploymentsCovered', 'allSupabaseSecretApiKeysDeleted', 'containsSecrets',
    'credentialSetFingerprintSha256', 'databasePasswordRotatedImmediatelyBeforeExport',
    'legacyAnonKeyDeactivated', 'legacyRuntimeProbes', 'legacyServiceRoleKeyDeactivated',
    'observedAt', 'projectRef', 'schema', 'schemaVersion'].sort();
  if (!isDeepStrictEqual(keys, expected) || record.schema !== BARRIER_SCHEMA ||
      record.schemaVersion !== BARRIER_SCHEMA_VERSION || record.projectRef !== PROJECT ||
      record.allReachableLegacyDeploymentsCovered !== true ||
      record.allSupabaseSecretApiKeysDeleted !== true ||
      record.legacyAnonKeyDeactivated !== true ||
      record.legacyServiceRoleKeyDeactivated !== true ||
      record.databasePasswordRotatedImmediatelyBeforeExport !== true ||
      record.containsSecrets !== false ||
      !/^[0-9a-f]{64}$/.test(record.credentialSetFingerprintSha256 || '') ||
      typeof record.observedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.observedAt) ||
      !Number.isFinite(Date.parse(record.observedAt)))
    fail('BARRIER_EVIDENCE_SCHEMA_INVALID');
  if (!Array.isArray(record.legacyRuntimeProbes) || record.legacyRuntimeProbes.length < 1 ||
      record.legacyRuntimeProbes.length > 64) fail('BARRIER_EVIDENCE_PROBES_INVALID');
  const seen = new Set();
  for (const probe of record.legacyRuntimeProbes) {
    if (!probe || !isDeepStrictEqual(Object.keys(probe).sort(),
        ['deploymentOriginSha256','observedAt','result']) ||
        !/^[0-9a-f]{64}$/.test(probe.deploymentOriginSha256 || '') ||
        probe.result !== 'unauthorized' ||
        typeof probe.observedAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(probe.observedAt) ||
        !Number.isFinite(Date.parse(probe.observedAt)) ||
        Date.parse(probe.observedAt) > Date.parse(record.observedAt) ||
        seen.has(probe.deploymentOriginSha256)) fail('BARRIER_EVIDENCE_PROBES_INVALID');
    seen.add(probe.deploymentOriginSha256);
  }
  const sortedProbeIds = [...seen].sort(compareC);
  if (!isDeepStrictEqual(record.legacyRuntimeProbes.map(p => p.deploymentOriginSha256), sortedProbeIds))
    fail('BARRIER_EVIDENCE_PROBES_NOT_SORTED');
  const canonicalRaw = Buffer.from(JSON.stringify(record, null, 2) + '\n');
  if (!raw.equals(canonicalRaw)) fail('BARRIER_EVIDENCE_NOT_CANONICAL');
  return { raw, sha256:hex(raw), schema:record.schema, schemaVersion:record.schemaVersion,
    observedAt:record.observedAt, probeCount:String(record.legacyRuntimeProbes.length),
    allReachableLegacyDeploymentsCovered:true, sourceFile:resolved };
}

function compareC(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export function keyFamily(key) {
  if (key === 'g:log:head' || key === 'g:log:n' || key === 'g:log:heads' || key === 'g:log:recent')
    return 'g:log:meta';
  if (/^g:log:e:\d+$/.test(key)) return 'g:log:e:*';
  if (/^g:log:c:\d+$/.test(key)) return 'g:log:c:*';
  if (key.startsWith('g:log:once:')) return 'g:log:once:*';
  if (key.startsWith('g:log:h:')) return 'g:log:h:*';
  if (key.startsWith('g:pyth:latest:v2:')) return 'g:pyth:latest:v2:*';
  if (key.startsWith('play-session:v1:')) return 'play-session:v1:*';
  if (key.startsWith('guarded:receipt:')) return 'guarded:receipt:*';
  const first = key.split(':', 1)[0];
  if (SAFE_ROOT_FAMILIES.has(first)) return first + ':*';
  return 'other:*';
}

export function keyspaceInventory(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(keyFamily(row.key), (counts.get(keyFamily(row.key)) || 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => compareC(a, b)));
}

export function buildSnapshotProof(inputRows) {
  const rows = inputRows.slice().sort((a, b) => compareC(a.key, b.key));
  if (!rows.length) fail('EMPTY_SOURCE');
  const seen = new Set();
  let canonicalBytes = 0;
  const rawHashes = [];
  for (const row of rows) {
    if (typeof row.key !== 'string' || typeof row.canonical !== 'string') fail('INVALID_ROW');
    if (seen.has(row.key)) fail('DUPLICATE_KEY');
    seen.add(row.key);
    canonicalBytes += Buffer.byteLength(row.canonical);
    if (canonicalBytes > MAX_CANONICAL_BYTES) fail('SOURCE_TOO_LARGE');
    rawHashes.push(sha256(Buffer.from(row.canonical, 'utf8')));
  }
  let level = rawHashes.map(raw => sha256(Buffer.concat([LEAF_DOMAIN, raw])));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i], right = level[i + 1] || left;
      next.push(sha256(Buffer.concat([NODE_DOMAIN, left, right])));
    }
    level = next;
  }
  return {
    rowCount: String(rows.length),
    canonicalBytes: String(canonicalBytes),
    databaseDigest: hex(rawHashes.map(hash => hash.toString('hex')).join('')),
    merkle: {
      algorithm: 'sha256-domain-separated-row-sha256-duplicate-last-v1',
      domainEncoding: 'hex',
      leafDomainHex: LEAF_DOMAIN.toString('hex'),
      nodeDomainHex: NODE_DOMAIN.toString('hex'),
      leaves: String(rows.length),
      root: level[0].toString('hex'),
    },
  };
}

function exactDecimal(value, name) {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) fail('INVALID_' + name.toUpperCase());
  return value;
}

export function validateConservation(report) {
  const nonNegative = [
    'player_count', 'player_credits', 'legacy_player_balance', 'player_xp',
    'player_attributed_rcx_burned', 'open_shot_count', 'open_shot_stake',
    'settlement_outbox_count', 'settlement_outbox_stake',
    'retained_closed_shot_count', 'retained_closed_shot_stake',
    'open_challenge_count', 'open_challenge_stake', 'stats_missing_expected_fields',
    'pending_play_credits', 'pending_champion_received_rcx',
    'pending_champion_self_routed_rcx', 'play_session_count',
    'play_session_pending_count', 'history_wallet_count', 'history_entry_count',
    'champion_history_wallet_count', 'champion_history_entry_count',
    'signature_gate_count', 'reload_signature_gate_count', 'seal_event_gate_count',
    'settlement_event_gate_count', 'guarded_receipt_count',
    'stake_fund_gate_count', 'stake_reverse_gate_count', 'hit_payout_gate_count',
    'ladder_gate_count', 'ledger_gate_count', 'rollover_plan_count',
    'rollover_payment_gate_count', 'rollover_debit_gate_count', 'live_lease_count',
    'expired_row_count', 'stats_allocated_burned_credits', 'weekly_pot_credits',
    'daily_pot_credits', 'stats_source_row_count', 'stats_shot_count',
    'verified_rcx_burned', 'verified_rcx_champion_paid',
    'verified_rcx_champion_retained', 'hit_payout_credits', 'staking_paid_credits',
    'staker_count',
  ];
  for (const name of nonNegative) {
    const value = exactDecimal(report[name], name);
    if (value.startsWith('-')) fail('NEGATIVE_' + name.toUpperCase());
  }
  for (const name of ['player_shape_violations', 'player_container_shape_violations',
    'player_numeric_shape_violations', 'negative_player_values',
    'open_shot_shape_violations', 'duplicate_open_shot_ids',
    'settlement_outbox_shape_violations', 'duplicate_settlement_outbox_ids',
    'closed_shot_shape_violations', 'duplicate_closed_shot_ids',
    'challenge_shape_violations', 'duplicate_challenge_ids',
    'challenge_container_shape_violations', 'queue_shape_violations', 'stats_shape_violations',
    'play_session_shape_violations', 'history_shape_violations',
    'champion_history_shape_violations']) {
    if (exactDecimal(report[name], name) !== '0') fail('CONSERVATION_' + name.toUpperCase());
  }
  if (BigInt(report.player_count) === 0n) fail('NO_PLAYERS');
  return Object.fromEntries(Object.entries(report).sort(([a], [b]) => compareC(a, b)));
}

export function reconstructLog(rows) {
  const values = new Map(rows.map(row => [row.key, row.value]));
  const head = values.get('g:log:head');
  const issued = Number(values.get('g:log:n'));
  if (!head || typeof head !== 'object' || !Number.isSafeInteger(issued) || issued <= 0 ||
      issued > MAX_ROWS || Number(head.i) !== issued || !/^[0-9a-f]{64}$/.test(String(head.h || '')))
    fail('LOG_META_INCOMPLETE');
  const chunkEntries = new Map();
  const directEntries = new Map();
  for (const row of rows) {
    const match = row.key.match(/^g:log:c:(\d+)$/);
    if (!match) continue;
    const chunkIndex = Number(match[1]);
    if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || String(chunkIndex) !== match[1] ||
        chunkIndex > Math.floor((issued - 1) / LOG_CHUNK_SIZE) || !Array.isArray(row.value))
      fail('LOG_CHUNK_INVALID');
    for (const entry of row.value) {
      const index = entry && entry.i;
      if (!Number.isSafeInteger(index) || index < 1 || index > issued ||
          Math.floor((index - 1) / LOG_CHUNK_SIZE) !== chunkIndex)
        fail('LOG_ENTRY_INDEX_INVALID');
      if (chunkEntries.has(index)) fail('LOG_DUPLICATE_CHUNK_ENTRY');
      chunkEntries.set(index, entry);
    }
  }
  for (const row of rows) {
    const match = row.key.match(/^g:log:e:(\d+)$/);
    if (!match) continue;
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index < 1 || index > issued ||
        String(index) !== match[1] || !row.value || typeof row.value !== 'object' ||
        Array.isArray(row.value) || row.value.i !== index)
      fail('LOG_DIRECT_INDEX_INVALID');
    if (directEntries.has(index)) fail('LOG_DUPLICATE_DIRECT_ENTRY');
    const chunk = chunkEntries.get(index);
    if (chunk && !isDeepStrictEqual(chunk, row.value)) fail('LOG_REPRESENTATION_CONFLICT');
    directEntries.set(index, row.value);
  }
  const entries = [];
  for (let index = 1; index <= issued; index++) {
    const entry = directEntries.get(index) || chunkEntries.get(index);
    if (entry) entries.push(entry);
  }
  const verification = verifyStoredChain(entries, head, issued);
  if (!verification.ok) fail('LOG_CHAIN_INVALID');
  const eventTypes = {};
  for (const entry of entries) {
    const raw = entry && entry.ev && entry.ev.k;
    const type = typeof raw === 'string' && SAFE_EVENT_TYPES.has(raw) ? raw : 'other';
    eventTypes[type] = String(BigInt(eventTypes[type] || '0') + 1n);
  }
  return {
    issued: String(issued),
    exportedEntries: String(entries.length),
    head: String(head.h || ''),
    verified: true,
    intact: !!verification.intact,
    mode: String(verification.mode || 'canonical'),
    disclosedMissing: (verification.missing || []).map(String),
    eventTypes:Object.fromEntries(Object.entries(eventTypes).sort(([a], [b]) => compareC(a, b))),
  };
}

export function analyzeRows(rows, conservation) {
  if (rows.length > MAX_ROWS) fail('SOURCE_TOO_LARGE');
  const keys = new Set(rows.map(row => row.key));
  if (!keys.has('g:log:head') || !keys.has('g:log:n') ||
      (!keys.has('h:stats') && !keys.has('g:stats')) || !rows.some(row => row.key.startsWith('u:')))
    fail('REQUIRED_STATE_MISSING');
  return {
    proof: buildSnapshotProof(rows),
    keyspace: keyspaceInventory(rows),
    conservation: validateConservation(conservation),
    log: reconstructLog(rows),
  };
}

export function parseArgs(argv) {
  const out = { quietSeconds: 30, writerBarrier: null, barrierEvidenceFile: null, cutoverId: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') return { help: true };
    const pair = arg.startsWith('--') && arg.includes('=') ? arg.slice(2).split(/=(.*)/s, 2) : null;
    const name = pair ? pair[0] : arg.startsWith('--') ? arg.slice(2) : '';
    const value = pair ? pair[1] : argv[++i];
    if (!name || value == null || value.startsWith?.('--')) fail('INVALID_ARGUMENTS');
    if (name === 'cutover-id') out.cutoverId = value;
    else if (name === 'writer-barrier') out.writerBarrier = value;
    else if (name === 'barrier-evidence-file') out.barrierEvidenceFile = value;
    else if (name === 'quiet-seconds') out.quietSeconds = Number(value);
    else fail('UNKNOWN_ARGUMENT');
  }
  if (!/^[a-z0-9][a-z0-9-]{5,63}$/.test(out.cutoverId || '')) fail('INVALID_CUTOVER_ID');
  if (out.writerBarrier !== WRITER_BARRIER) fail('WRITER_BARRIER_REQUIRED');
  if (typeof out.barrierEvidenceFile !== 'string' || !path.isAbsolute(out.barrierEvidenceFile))
    fail('BARRIER_EVIDENCE_FILE_REQUIRED');
  out.barrierEvidenceFile = path.resolve(out.barrierEvidenceFile);
  if (!Number.isInteger(out.quietSeconds) || out.quietSeconds < 15 || out.quietSeconds > 120)
    fail('INVALID_QUIET_SECONDS');
  out.publicManifest = path.join(PUBLIC_ROOT, `legacy-snapshot-manifest-${out.cutoverId}.json`);
  return out;
}

function resolvePgBin() {
  const candidates = [
    process.env.RATCHET_PG_BIN,
    'C:/Users/treed/AppData/Local/Temp/ratchet-postgres-tools-20260830/expanded/pgsql/bin',
  ].filter(Boolean).map(value => path.resolve(value));
  for (const candidate of candidates)
    if (['pg_dump', 'pg_restore', 'initdb', 'pg_ctl'].every(name => fs.existsSync(path.join(candidate, name + '.exe'))))
      return candidate;
  fail('POSTGRES_TOOLS_NOT_FOUND');
}

function runUtility(pgBin, name, args, env = {}, timeout = 240_000) {
  return new Promise((resolve, reject) => {
    const executable = process.platform === 'win32' ? path.join(pgBin, name + '.exe') : path.join(pgBin, name);
    const child = spawn(executable, args, {
      env: childEnvironment(env), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { if (stdout.length < 64 * 1024) stdout += chunk; });
    child.stderr.on('data', chunk => { if (stderr.length < 256 * 1024) stderr += chunk; });
    const timer = setTimeout(() => child.kill(), timeout);
    child.on('error', () => { clearTimeout(timer); reject(Object.assign(new Error('UTILITY_START_FAILED'), { code:'UTILITY_START_FAILED' })); });
    child.on(name === 'pg_ctl' ? 'exit' : 'close', code => {
      clearTimeout(timer);
      if (name === 'pg_ctl') { child.stdout.destroy(); child.stderr.destroy(); }
      if (code !== 0) reject(Object.assign(new Error('UTILITY_FAILED'), { code:'UTILITY_FAILED', privateDetail:stderr, utility:name }));
      else resolve(stdout);
    });
  });
}

async function privateInput() {
  if (!process.stdin.isTTY) fail('PRIVATE_TTY_REQUIRED');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  console.log('PRIVATE_DATABASE_PASSWORD_JSON_READY');
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => finish(new Error('PRIVATE_INPUT_TIMEOUT')), 60_000);
    const finish = (error, value) => {
      clearTimeout(timer);
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      buffer = '';
      error ? reject(error) : resolve(value);
    };
    const onData = chunk => {
      buffer += chunk.toString();
      if (buffer.length > 4096) return finish(Object.assign(new Error('PRIVATE_INPUT_TOO_LARGE'), { code:'PRIVATE_INPUT_TOO_LARGE' }));
      let parsed;
      try { parsed = JSON.parse(buffer.trim()); } catch { return; }
      if (!parsed || Object.keys(parsed).length !== 1 || typeof parsed.password !== 'string' ||
          parsed.password.length < 8 || parsed.password.length > 1024)
        return finish(Object.assign(new Error('INVALID_PRIVATE_INPUT'), { code:'INVALID_PRIVATE_INPUT' }));
      finish(null, parsed);
    };
    process.stdin.on('data', onData);
  });
}

function sourceConfig(password, ca) {
  return {
    host: HOST, port: 5432, user: USER, database: 'postgres', password,
    ssl: { rejectUnauthorized:true, ca, servername:HOST }, connectionTimeoutMillis: 15_000,
    application_name: 'ratchetx_final_snapshot_readonly',
    options: '-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=5000',
  };
}

async function sourceFingerprint(configuration) {
  const client = new Client(configuration);
  client.on('error', () => {});
  try {
    await client.connect();
    const readonly = (await client.query('show transaction_read_only')).rows[0].transaction_read_only;
    if (readonly !== 'on') fail('SOURCE_NOT_READ_ONLY');
    return (await client.query(FINGERPRINT_SQL)).rows[0];
  } finally { await client.end().catch(() => {}); }
}

async function sourceAuthority(configuration) {
  const client = new Client(configuration);
  client.on('error', () => {});
  try {
    await client.connect();
    const readonly = (await client.query('show transaction_read_only')).rows[0].transaction_read_only;
    if (readonly !== 'on') fail('SOURCE_NOT_READ_ONLY');
    const raw = (await client.query(AUTHORITY_SQL)).rows[0];
    return { raw, public:validateAuthoritySurface(raw) };
  } finally { await client.end().catch(() => {}); }
}

function validateCutoffTimestamp(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)))
    fail('INVALID_SNAPSHOT_CUTOFF');
  return value;
}

export function validateAuthoritySurface(row) {
  if (!row || row.target_table_count !== '1' || row.rls_enabled !== 'true' ||
      row.service_role_select !== 'true' || row.service_role_insert !== 'true' ||
      row.service_role_update !== 'true' || row.service_role_delete !== 'true' ||
      row.unexpected_table_grants !== '0' || row.unexpected_function_grants !== '0' ||
      !/^[0-9a-f]{64}$/.test(row.grants_fingerprint || '') ||
      !/^\d+$/.test(row.ratchet_function_count || '') ||
      !/^\d+$/.test(row.service_role_function_count || '') ||
      BigInt(row.ratchet_function_count) === 0n ||
      BigInt(row.service_role_function_count) === 0n ||
      typeof row.private_canonical !== 'string')
    fail('SOURCE_AUTHORITY_SURFACE_INVALID');
  return {
    schema:'ratchetx-source-authority-surface-v1',
    grantsFingerprintSha256:row.grants_fingerprint,
    rlsEnabled:true,
    rlsForced:row.rls_forced === 'true',
    unexpectedTableGrants:'0',
    unexpectedFunctionGrants:'0',
    ratchetFunctionCount:row.ratchet_function_count,
    serviceRoleFunctionCount:row.service_role_function_count,
    trustBoundary:'Catalog ACLs do not exclude an unknown owner-level SQL session; the barrier remains attested until independently reviewed.',
  };
}

export async function readSnapshot(client, cutoffTimestamp) {
  const cutoff = validateCutoffTimestamp(cutoffTimestamp);
  const rows = (await client.query(ROWS_SQL, [cutoff])).rows;
  if (!rows.length || rows.length > MAX_ROWS) fail(rows.length ? 'SOURCE_TOO_LARGE' : 'EMPTY_SOURCE');
  const conservation = (await client.query(CONSERVATION_SQL, [cutoff])).rows[0];
  return { rows, conservation, analysis:analyzeRows(rows, conservation) };
}

function pgEnvironment(password, caPath) {
  return {
    PGHOST:HOST, PGPORT:'5432', PGUSER:USER, PGDATABASE:'postgres', PGPASSWORD:password,
    PGSSLMODE:'verify-full', PGSSLROOTCERT:caPath, PGCONNECT_TIMEOUT:'15',
    PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=5000',
  };
}

async function loadPinnedCa(privateDir) {
  const expected = '1c68487d30b821fd07127d5b92dea6d0c148458ca78498d2c3918a4c038b83c5';
  const prior = path.join(LEGACY_PRIVATE_ROOT, 'pre003-20260830-P7LEkP', 'supabase-ca.pem');
  let ca;
  if (fs.existsSync(prior) && hex(fs.readFileSync(prior)) === expected) ca = fs.readFileSync(prior, 'utf8');
  else {
    const parts = [];
    for (const name of ['prod-ca-2021.crt', 'prod-ca-2025.crt']) {
      const response = await fetch('https://raw.githubusercontent.com/supabase/cli/develop/apps/cli-go/internal/gen/types/templates/' + name,
        { redirect:'error', signal:AbortSignal.timeout(15_000) });
      if (!response.ok) fail('CA_FETCH_FAILED');
      parts.push(await response.text());
    }
    ca = parts.join('\n');
    if (hex(ca) !== expected) fail('CA_PIN_MISMATCH');
  }
  const caPath = path.join(privateDir, 'supabase-ca.pem');
  fs.writeFileSync(caPath, ca, { mode:0o600, flag:'wx' });
  return { ca, caPath, sha256:expected };
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

async function restoreAndVerify({ pgBin, dataFile, sourceAnalysis, sourceFingerprint: fingerprint,
  privateDir, cutoffTimestamp }) {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchetx-final-restore-'));
  let localStarted = false, local = null;
  try {
    const password = crypto.randomBytes(32).toString('hex');
    const passwordFile = path.join(cluster, 'init-password');
    fs.writeFileSync(passwordFile, password, { mode:0o600, flag:'wx' });
    await runUtility(pgBin, 'initdb', ['-D', path.join(cluster, 'data'), '-U', 'postgres',
      '--auth=scram-sha-256', '--pwfile=' + passwordFile, '--encoding=UTF8', '--locale=C']);
    fs.unlinkSync(passwordFile);
    const port = await freePort();
    const env = { PGHOST:'127.0.0.1', PGPORT:String(port), PGUSER:'postgres', PGDATABASE:'postgres',
      PGPASSWORD:password, PGSSLMODE:'disable', PGOPTIONS:'-c statement_timeout=120000' };
    await runUtility(pgBin, 'pg_ctl', ['-D', path.join(cluster, 'data'), '-l', path.join(cluster, 'postgres.log'),
      '-o', '-h 127.0.0.1 -p ' + port, '-w', 'start']);
    localStarted = true;
    local = new Client({ host:'127.0.0.1', port, user:'postgres', database:'postgres', password,
      connectionTimeoutMillis:10_000 });
    await local.connect();
    await local.query(RESTORE_SCHEMA_SQL);
    await runUtility(pgBin, 'pg_restore', ['--data-only', '--no-owner', '--no-privileges',
      '--disable-triggers', '--exit-on-error', '--dbname=postgres', dataFile], env);
    await local.query("set timezone='UTC'");
    const restored = await readSnapshot(local, cutoffTimestamp);
    const restoredFingerprint = (await local.query(FINGERPRINT_SQL)).rows[0];
    assert.deepEqual(restoredFingerprint, fingerprint, 'restored database fingerprint differs');
    assert.deepEqual(restored.analysis, sourceAnalysis, 'restored state analysis differs');
    return { verified:true, rowCount:fingerprint.row_count, databaseDigest:fingerprint.digest,
      merkleRoot:sourceAnalysis.proof.merkle.root };
  } catch (error) {
    if (error.privateDetail) fs.writeFileSync(path.join(privateDir, 'private-restore-error.txt'),
      error.privateDetail, { mode:0o600 });
    throw error;
  } finally {
    if (local) await local.end().catch(() => {});
    if (localStarted) await runUtility(pgBin, 'pg_ctl', ['-D', path.join(cluster, 'data'), '-m', 'fast', '-w', 'stop'])
      .catch(() => {});
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    const resolved = path.resolve(cluster);
    if (resolved.startsWith(tempRoot) && path.basename(resolved).startsWith('ratchetx-final-restore-'))
      fs.rmSync(resolved, { recursive:true, force:true });
  }
}

function publicFileRecord(file) {
  return { name:path.basename(file), bytes:String(fs.statSync(file).size), sha256:hex(fs.readFileSync(file)) };
}

export function procedureProof() {
  const record = file => ({
    path:path.relative(ROOT, file).replaceAll('\\','/'),
    bytes:String(fs.statSync(file).size),
    sha256:hex(fs.readFileSync(file)),
  });
  return { files:PROCEDURE_FILES.map(record) };
}

export function assertPublicManifestSafe(manifest) {
  const text = JSON.stringify(manifest);
  for (const pattern of [/password/i, /service[_-]?key/i, /authorization/i, /postgres(?:ql)?:\/\//i,
    /"value"\s*:/i, /"canonical"\s*:/i, /-----BEGIN .*PRIVATE KEY-----/])
    if (pattern.test(text)) fail('PUBLIC_MANIFEST_SECRET_RISK');
  if (manifest && manifest.schema === SCHEMA &&
      (manifest.writerBarrier?.independentlyVerified !== false ||
       manifest.importEligibility?.eligible !== false ||
       manifest.importEligibility?.status !== 'pre-import-evidence-only'))
    fail('PUBLIC_MANIFEST_ELIGIBILITY_OVERCLAIM');
  return true;
}

function usage() {
  return [
    'Read-only final snapshot; no production write path exists in this tool.',
    'Usage:',
    '  node tools/supabase_final_snapshot.mjs --cutover-id <slug> \\',
    '    --writer-barrier legacy-runtime-credential-revoked \\',
    '    --barrier-evidence-file <absolute-redacted-json> [--quiet-seconds 30]',
    'Then enter {"password":"..."} at PRIVATE_DATABASE_PASSWORD_JSON_READY.',
    'The private input requires a real TTY and is not echoed.',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage()); return; }
  if (fs.existsSync(args.publicManifest)) fail('PUBLIC_MANIFEST_EXISTS');
  const barrierEvidence = readBarrierEvidence(args.barrierEvidenceFile);
  const privateRoot = await preparePrivateRoot();
  fs.mkdirSync(PUBLIC_ROOT, { recursive:true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const privateDir = fs.mkdtempSync(path.join(privateRoot, `final-snapshot-${stamp}-`));
  const privateAcl = await securePrivateDirectory(privateDir);
  let input, source = null, sourceTransaction = false, stage = 'private_input';
  try {
    const procedure = procedureProof();
    const evidenceFile = path.join(privateDir, 'writer-barrier-attestation.json');
    fs.writeFileSync(evidenceFile, barrierEvidence.raw, { mode:0o600, flag:'wx' });
    input = await privateInput();
    const pgBin = resolvePgBin();
    const runtime = {
      node:process.version,
      platform:process.platform,
      pgDump:String(await runUtility(pgBin, 'pg_dump', ['--version'])).trim(),
      pgRestore:String(await runUtility(pgBin, 'pg_restore', ['--version'])).trim(),
    };
    const ca = await loadPinnedCa(privateDir);
    const configuration = sourceConfig(input.password, ca.ca);

    stage = 'quiet_fingerprint_1';
    const before = await sourceFingerprint(configuration);
    console.log(JSON.stringify({ stage, ok:true, rows:before.row_count }));
    await new Promise(resolve => setTimeout(resolve, args.quietSeconds * 1000));
    stage = 'quiet_fingerprint_2';
    const quiet = await sourceFingerprint(configuration);
    if (before.row_count !== quiet.row_count || before.digest !== quiet.digest) fail('SOURCE_NOT_QUIET');
    console.log(JSON.stringify({ stage, ok:true, seconds:args.quietSeconds }));

    stage = 'consistent_export';
    source = new Client(configuration); source.on('error', () => {}); await source.connect();
    await source.query('begin isolation level repeatable read read only'); sourceTransaction = true;
    const readonly = (await source.query('show transaction_read_only')).rows[0].transaction_read_only;
    if (readonly !== 'on') fail('SOURCE_NOT_READ_ONLY');
    const snapshotId = (await source.query('select pg_export_snapshot() snapshot')).rows[0].snapshot;
    const txStartedAt = (await source.query("select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') value")).rows[0].value;
    const serverVersion = (await source.query('show server_version')).rows[0].server_version;
    const authorityRaw = (await source.query(AUTHORITY_SQL)).rows[0];
    const authority = validateAuthoritySurface(authorityRaw);
    const authorityFile = path.join(privateDir, 'source-authority-surface.json');
    fs.writeFileSync(authorityFile, authorityRaw.private_canonical + '\n', { mode:0o600, flag:'wx' });
    const captured = await readSnapshot(source, txStartedAt);
    const snapshotFingerprint = (await source.query(FINGERPRINT_SQL)).rows[0];
    assert.equal(captured.analysis.proof.rowCount, snapshotFingerprint.row_count);
    assert.equal(captured.analysis.proof.databaseDigest, snapshotFingerprint.digest);
    if (quiet.row_count !== snapshotFingerprint.row_count || quiet.digest !== snapshotFingerprint.digest)
      fail('SOURCE_CHANGED_BEFORE_SNAPSHOT');

    const rowsFile = path.join(privateDir, 'ratchet-kv-rows.ndjson');
    fs.writeFileSync(rowsFile, captured.rows.map(row => row.canonical).join('\n') + '\n', { mode:0o600, flag:'wx' });
    const schemaFile = path.join(privateDir, 'public-schema.dump');
    const dataFile = path.join(privateDir, 'ratchet-kv-data.dump');
    const pgEnv = pgEnvironment(input.password, ca.caPath);
    await runUtility(pgBin, 'pg_dump', ['--format=custom', '--schema-only', '--schema=public', '--no-owner',
      '--no-privileges',
      '--snapshot=' + snapshotId, '--file=' + schemaFile], pgEnv);
    await runUtility(pgBin, 'pg_dump', ['--format=custom', '--data-only', '--table=' + TABLE, '--no-owner',
      '--no-privileges',
      '--snapshot=' + snapshotId, '--file=' + dataFile], pgEnv);
    await source.query('commit'); sourceTransaction = false; await source.end(); source = null;
    console.log(JSON.stringify({ stage, ok:true, rows:snapshotFingerprint.row_count,
      databaseDigest:snapshotFingerprint.digest, merkleRoot:captured.analysis.proof.merkle.root }));

    stage = 'post_export_fingerprint';
    const after = await sourceFingerprint(configuration);
    if (after.row_count !== snapshotFingerprint.row_count || after.digest !== snapshotFingerprint.digest)
      fail('SOURCE_CHANGED_DURING_EXPORT');
    const afterAuthority = await sourceAuthority(configuration);
    if (!isDeepStrictEqual(afterAuthority.public, authority))
      fail('SOURCE_AUTHORITY_CHANGED_DURING_EXPORT');

    stage = 'local_restore_verification';
    const restore = await restoreAndVerify({ pgBin, dataFile,
      sourceAnalysis:captured.analysis, sourceFingerprint:snapshotFingerprint, privateDir,
      cutoffTimestamp:txStartedAt });
    console.log(JSON.stringify({ stage, ok:true, rows:restore.rowCount,
      databaseDigest:restore.databaseDigest, merkleRoot:restore.merkleRoot }));

    const files = [schemaFile, dataFile, rowsFile, evidenceFile, authorityFile].map(publicFileRecord);
    assert.deepEqual(procedureProof(), procedure, 'snapshot procedure changed during export');
    const manifest = {
      schema:SCHEMA, schemaVersion:SCHEMA_VERSION, cutoverId:args.cutoverId,
      generatedAt:new Date().toISOString(),
      procedure:{ ...procedure, runtime },
      source:{ projectRef:PROJECT, table:TABLE, serverVersion,
        isolation:'repeatable read read only', transactionStartedAt:txStartedAt,
        quietSeconds:String(args.quietSeconds), maxUpdatedAt:snapshotFingerprint.max_updated_at,
        authority },
      writerBarrier:{ kind:WRITER_BARRIER,
        status:'operator-attested-not-independently-verified',
        evidenceSchema:barrierEvidence.schema,
        evidenceSchemaVersion:barrierEvidence.schemaVersion,
        evidenceObservedAt:barrierEvidence.observedAt,
        evidenceSha256:barrierEvidence.sha256,
        preAndPostExportFingerprintStable:true,
        independentlyVerified:false },
      privateStorage:{ locationClass:'os-user-local-outside-repository',
        policy:privateAcl.policy, aclVerified:privateAcl.verified, pathPublished:false },
      completeness:{ rowCount:snapshotFingerprint.row_count, canonicalBytes:captured.analysis.proof.canonicalBytes,
        databaseDigest:snapshotFingerprint.digest, merkle:captured.analysis.proof.merkle,
        privateFiles:files, localRestoreVerified:true },
      keyspace:captured.analysis.keyspace,
      conservation:{ schema:'ratchetx-state-buckets-v2',
        status:'snapshot-integrity-inventory-not-import-reconciliation',
        note:'Exact structural and aggregate buckets from the snapshot. Credits and RCX are distinct, buckets overlap, and no fixed-supply or migration-conservation equation is claimed.',
        ...captured.analysis.conservation },
      eventLog:captured.analysis.log,
      importEligibility:{ eligible:false, status:'pre-import-evidence-only',
        requires:['independent writer-barrier review','deterministic legacy-to-G2 projection',
          'per-unit obligation and replay-gate reconciliation','independent migration-root reproduction'] },
      declaration:'Every public.ratchet_kv row was exported from one read-only PostgreSQL snapshot and reproduced by a clean local restore. Raw values remain in ACL-verified user-local storage outside the repository.',
    };
    assertPublicManifestSafe(manifest);
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    const publicManifestSha256 = hex(manifestBytes);
    fs.writeFileSync(path.join(privateDir, 'private-proof.json'), JSON.stringify({
      publicManifestSha256,
      snapshotIdSha256:hex(snapshotId),
      barrierEvidence:{ name:path.basename(evidenceFile), sha256:barrierEvidence.sha256 },
      sourceAuthority:{ name:path.basename(authorityFile),
        grantsFingerprintSha256:authority.grantsFingerprintSha256 },
      files,
    }, null, 2) + '\n', { mode:0o600, flag:'wx' });
    await securePrivateDirectory(privateDir, true);
    fs.writeFileSync(args.publicManifest, manifestBytes, { flag:'wx' });
    console.log(JSON.stringify({ stage:'complete', ok:true,
      publicManifest:path.relative(ROOT, args.publicManifest).replaceAll('\\','/'),
      publicManifestSha256,
      privateBackup:privateDir }));
  } catch (error) {
    const code = safeCode(error.code || error.message);
    if (error.privateDetail) fs.writeFileSync(path.join(privateDir, 'private-utility-error.txt'),
      error.privateDetail, { mode:0o600 });
    fs.writeFileSync(path.join(privateDir, 'failure.json'), JSON.stringify({ stage, code,
      at:new Date().toISOString() }, null, 2) + '\n', { mode:0o600 });
    console.log(JSON.stringify({ stage, ok:false, code,
      privateBackup:privateDir }));
    process.exitCode = 1;
  } finally {
    if (sourceTransaction && source) await source.query('rollback').catch(() => {});
    if (source) await source.end().catch(() => {});
    if (input) input.password = '';
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main();
