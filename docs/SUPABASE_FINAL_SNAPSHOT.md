# Final Supabase snapshot: one read, then zero dependency

Status: prepared, not executed. The current production project is restricted by
Supabase with HTTP 402 `exceed_egress_quota`. No current snapshot exists until
the procedure below completes and its generated manifest passes review.

This is a one-time migration ceremony, not a new runtime service. The final
RatchetX runtime remains API-keyless. A database password is used locally once
to recover the legacy authority, is entered through a non-echoed TTY, is never
written to a file, and is not needed by the on-chain generation.

## Why `/api/snapshot` is not enough

The public snapshot is useful for resurrection, but it intentionally removes
the secret side/salt of open shots and does not include every `ratchet_kv` row.
Among the omitted state are play-session records, guarded commit receipts,
idempotency gates, leases and several repair/outbox records. Upstash is an old
rollback source, not a current authority. Neither can be used to invent the
final migration root.

The only accepted source is every row of `public.ratchet_kv` from one database
snapshot. The tool also merges and verifies the event-log representations,
including the already-disclosed historical gap; an undisclosed gap fails.

## Required writer barrier

Do not merely remove the Supabase spend cap. That would let the still-live
Vercel deployment write again while the export is running.

Before restoring database access:

1. In Supabase, revoke or rotate the exact server credential still installed in
   the legacy Vercel production deployment. Do not install the replacement in
   Vercel. This is the cutover barrier: the old runtime can no longer write.
2. Save redacted evidence containing the project ref, time, credential id or
   fingerprint, and the successful revocation result. It must contain no key.
3. Hash that evidence locally with `Get-FileHash -Algorithm SHA256` and retain
   the lowercase 64-hex digest. The snapshot tool records only this digest.
4. Temporarily remove the egress cap or enable enough Supabase access for a
   direct database connection. This is recovery access only. Do not point the
   site at a replacement database and do not enable Upstash fallback.
5. Confirm the old production runtime is unauthorized, not merely returning the
   previous 402 restriction. Keep the replacement credential private and out of
   Vercel.

If the old runtime credential has not been revoked, stop. A repeatable-read
transaction is internally consistent, but it cannot prevent a still-authorized
writer from creating a later state after the snapshot.

## Run once

The PostgreSQL database password is obtained from the Supabase project owner
surface. It is not the service-role API key. From a private local terminal:

```powershell
node tools/supabase_final_snapshot.mjs `
  --cutover-id 2026-09-03-final `
  --writer-barrier legacy-runtime-credential-revoked `
  --barrier-evidence-sha256 <lowercase-sha256>
```

At `PRIVATE_DATABASE_PASSWORD_JSON_READY`, type the following object. Input is
not echoed and piped stdin is refused:

```json
{"password":"the database password"}
```

The command first requires the whole-table fingerprint to remain unchanged for
30 seconds. It then uses `REPEATABLE READ READ ONLY`, exports a
PostgreSQL snapshot, and checks the fingerprint again after export. Any change
aborts without a public manifest. Lease and expiry buckets use the source
transaction's fixed UTC start time in both source and restored analyses; local
restore time can never change the conservation result.

## What is produced

Private, ignored, mode-restricted files are written below a unique
`backups/final-snapshot-*` directory:

- the complete `ratchet_kv` custom-format dump;
- the public schema dump;
- canonical NDJSON containing every row;
- private proof/failure details.

The tool restores both dumps into a fresh ephemeral local PostgreSQL cluster.
It recomputes the row count, whole-database digest, domain-separated Merkle root,
key-family inventory, event-log verification and conservation vector. Only an
exact match produces:

`releases/legacy-snapshot-manifest-2026-09-03-final.json`

That public manifest contains hashes, counts and aggregate state buckets only.
It contains no row value, wallet key, credential or connection string. Existing
files are never overwritten. It records the exact SHA-256 of the exporter and
this runbook. The Merkle proof publishes the exact hexadecimal domain bytes,
including each trailing `00` separator byte, rather than an ambiguous display
string.

## Stop conditions

Do not import or publish a legacy Merkle root if any of these occurs:

- the Supabase response is still 402, or direct PostgreSQL is unavailable;
- the old Vercel runtime still has a valid database credential;
- the pre/export/post fingerprints differ;
- a required player, stats or log meta family is absent;
- an economic field is malformed or negative, or a player/open/outbox/closed,
  challenge, session or history container has the wrong JSON type;
- event-log verification finds an undisclosed break;
- a log index is out of range, a direct-entry key disagrees with its stored
  index, or chunk and direct representations conflict;
- the clean local restore differs by one row, digest, Merkle node or aggregate;
- raw files appear outside ignored `backups/`, or a public manifest contains a
  raw key/value.

After success, keep the legacy runtime credential revoked. The reviewed public
manifest becomes the only input to the separate on-chain import build. Supabase
is retained read-only only as historical evidence until independent import
verification completes; it is never the authority for the new generation.

## Environment

**`RATCHET_PG_BIN`** — the directory holding `pg_dump`, `pg_restore`, `initdb` and
`pg_ctl`. The tool needs real Postgres binaries: it takes a schema and data dump
at one snapshot id and restores them into a throwaway local cluster to verify the
result, which is not something a client library can do. When the variable is
unset the tool falls back to the extracted toolchain path recorded in its source
and, failing that, stops with `POSTGRES_TOOLS_NOT_FOUND` rather than proceeding
with half a ceremony.

The database password is entered at the prompt and lives only in that process.
Private outputs go under `%LOCALAPPDATA%\RatchetX\private-snapshots` on Windows,
or `$XDG_DATA_HOME/RatchetX/private-snapshots` (default `~/.local/share`)
elsewhere; see `RESCUE_AND_MIGRATION_TOOLS.md`, which covers the four lighter
tools that share that private root.
