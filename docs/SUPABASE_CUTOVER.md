# Supabase cutover — no-reset runbook

This migration keeps Upstash intact as a rollback source. Never add the
Supabase variables to production before the copy hash matches.

## 1. Install the isolated schema

In the Supabase project SQL Editor, run [`supabase/001_ratchet_kv.sql`](../supabase/001_ratchet_kv.sql).
It creates only `public.ratchet_kv` and `ratchet_kv_*` functions. Browser roles
receive no table or function access; only `service_role` can execute them.

## 2. Prepare secrets locally (never paste them into chat or commit them)

Create the gitignored file `.env.migration.local`:

```dotenv
KV_REST_API_URL=https://...
KV_REST_API_TOKEN=...
SUPABASE_URL=https://gxwffzshaicpewbkziau.supabase.co
SUPABASE_SERVICE_KEY=...
```

Use the Upstash REST URL/token currently attached to Vercel and the new
Supabase project's server-side `service_role` key. Do not use the publishable
or anonymous key.

## 3. Read-only preflight, then verified copy

Run this after the Upstash daily allowance resets:

```powershell
node --env-file=.env.migration.local scripts/migrate-upstash-to-supabase.mjs --check
node --env-file=.env.migration.local scripts/migrate-upstash-to-supabase.mjs
```

The second command refuses a non-empty target, writes a local JSON backup,
copies every non-expired key except short-lived `lock:*` leases, then reads the
target back and requires the same canonical SHA-256. Upstash is never modified.

## 4. Preview before production

Add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` to a Vercel Preview deployment.
Confirm `/api/game?action=state` and `/api/snapshot` report
`"storage":"supabase"`, then run all smoke tests. Only then add the same two
variables to Production and deploy the already-tested build.

Rollback is immediate: remove the two Supabase variables and redeploy; the
unchanged Upstash path becomes active again. Do not allow writes on both
backends after cutover without a new reconciliation snapshot.
