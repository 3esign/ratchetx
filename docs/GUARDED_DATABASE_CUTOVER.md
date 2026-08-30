# Guarded database cutover — 2026-08-30

Status: migration 003 APPLIED to the existing Ratchet Supabase project.
h101 application/session candidate is implemented but NOT deployed; production
remains h100. An actual owner-approved private Bankr pilot has not run.

## Evidence

- Exact project: `gxwffzshaicpewbkziau`; PostgreSQL 17.6.
- Verified TLS through session pooler `aws-1-eu-west-1.pooler.supabase.com:5432`.
  The direct database endpoint is IPv6-only and unavailable from this host.
  Trust roots came from Supabase's official CLI repository; verification was
  never disabled and system certificate stores were not changed.
- Seven catalog preconditions passed through a real read-only SQL connection.
- Schema and Ratchet KV data were exported from the SAME repeatable-read snapshot
  with PostgreSQL 17.11 `pg_dump`. Backup contains 11,062 Ratchet rows, not all
  Supabase platform/storage data or a provider-wide disaster recovery image.
- Local PostgreSQL 17.11 restored the schema and every KV row. Count and ordered
  SHA-256 over key/value/expiry/update timestamps matched the source snapshot.
- Migration 003 passed real two-connection tests locally BEFORE live installation.
  Live service-role privilege checks and the same isolated fixture batch passed.
  Only random test keys/receipts were written and removed, never real players,
  activity events, token transactions or funding. No balance migration occurred.
- Readiness: `guarded-player-v1`, `ready: true`.
- Post-installation HTTPS Data API/build gate passed with the opaque service
  key; HEAD returned 200 and the exact application prerequisite returned PASS.
  No player rows were read by these readiness checks.
- Public board still reports h100; profile and MCP tool discovery return 200
  with the existing 13 tools. The observatory `/api/feeds` returns HTML by design;
  JSON requires `?format=json`. No new session tool is exposed.
- Last complete pre-session application batch: 73 passed, 0 failed, 5 browser tests skipped
  because the required local browser fixture was absent. Not a browser-QA pass.
- h101 live isolated session-store probe: 19 HTTP requests, PostgREST CAS with
  exactly one winner and stale rejection, one guarded player/debit/accepted-receipt
  commit, stale-session rollback, exact commit replay and changed-commit refusal.
  Exact fixture cleanup passed. Zero real-player reads and zero chain calls;
  no actual owner grant, forecast, activity event or funded Bankr gameplay.
  This complements the earlier SQL batch; it is not a deployed HTTP session test.

## Race caught before deployment

Legacy `INCR` held its global advisory mutex, sampled a queue at 100, then blocked
on the row locked by a new guarded writer. That writer consumed 20 and committed
80. The old upsert subsequently wrote its precomputed 125, resurrecting the 20.
Both writers were individually transactional; their different locks did not make
read-before-write arithmetic safe together.

003 replaces `ratchet_kv_incr` with row-current arithmetic inside atomic
`INSERT ... ON CONFLICT DO UPDATE`, preserving expiry, return values, permissions
and legacy mutex compatibility. Guarded commits do not acquire that global mutex.
In the restored database, reinstalling the original INCR reproduced 125 instead
of 105; restoring the fixed function made the same test pass. The positive
failure control never ran on production. The deposit is an actual `apply_once`
call, and replaying either deposit or guarded debit leaves the queue at 105.

## Recovery and operator tooling

Private backup directory (ignored by Git AND deployment):
`backups/pre003-20260830-P7LEkP/`.

It contains `public-schema.dump`, `ratchet-kv-data.dump`, CA bundle and
`manifest.json` with file hashes, source digest, restore result, migration hash,
local/live test results and timestamps. It contains private player data: do not
upload it, paste rows into chat or serve it publicly. No database/API credential
was persisted there by this tooling.

- `tools/supabase_backup_guarded.mjs`: exact-project backup/restore/local test
  runner. `--apply-003` is an explicit live-write switch. The preflight intentionally
  fails after installation; do NOT rerun it as a blind post-deployment script.
- `tools/guarded_postgres_batch.mjs`: bounded random fixture namespace, two real
  connections, opposite-order CAS, blocked deposit, both replay boundaries,
  replaced lease, legacy rejection and exact fixture cleanup.
- `tools/supabase_readonly_probe.mjs --after-003`: read-only SQL/API readiness,
  non-echoed credential input, no player rows. Without the flag it is the
  pre-installation catalog probe.

Restoring a pre-cutover backup over active production would erase newer writes;
it is NOT an automatic rollback. After guarded players exist, do not redeploy
the old writer, disable its guard trigger, or reapply migration 001 (which would
replace the corrected increment). Recover forward with evidence and exact scope.

## Outstanding

The h101 release batch/deployment and actual owner-approved private Bankr pilot
remain. Atomic session/shot receipts, fenced recovery, consent UI and focused
HTTP/page tests are implemented; see the complete contract in
[PLAY_SESSION_DESIGN.md](PLAY_SESSION_DESIGN.md).

Vercel access is resolved: existing CLI authentication at Windows
`%APPDATA%\xdg.data\com.vercel.cli\auth.json` passed a read-only check for the exact
Ratchet project/team. No secret was printed or copied; do not treat the earlier
standard-path discovery failure as a current deployment blocker. Hosted Bankr
per-user secret isolation/X execution still needs its private runtime pilot.

The API key and DB password supplied in chat require rotation using a protected
operator channel and coordinated consumer updates. Rotation is NOT completed.
The dashboard quota warning has not been diagnosed; no paid upgrade was made.

Sources: [PostgreSQL concurrent upsert semantics](https://www.postgresql.org/docs/17/transaction-iso.html),
[Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres),
[Supabase API key formats](https://supabase.com/docs/guides/getting-started/api-keys).
