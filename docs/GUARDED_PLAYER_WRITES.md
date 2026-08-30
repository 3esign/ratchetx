# Guarded player writes — database and h101 application LIVE

Production `h101-2026-08-30` public-verified at 2026-08-30T13:47:30.236Z.
h101 now includes the connected session HTTP adapter, atomic shot/receipt bridge,
owner recovery and private consent page. No actual owner grant, token transfer,
RCX reload or funded Bankr pilot; the live database probe used isolated fixtures only.

## Why this precedes delegated play

The canonical HTTP handler acquired a 30-second player lease but later saved a
whole player JSON unconditionally. A paused request could resume after a newer
request had accepted a shot and erase it. The regression was reproduced through
`api/game.js`, not just an isolated storage imitation. Its test failed before the
fix and passes now: the newer shot and balance survive; the expired caller gets
a structured 409.

Queue draining had a related crash window: `takeNum(pend/c7/cs7)` consumed value
before the credited player was durable. Compensating after a failed acknowledgement
could instead duplicate credits. Reading those queues is now non-destructive.

## Implemented boundaries

- `lib/player_writes.js` owns request-local leases and exact original player
  snapshots. Every canonical player save, including both challenge participants,
  uses `commitGuarded` rather than a naked SET.
- One database operation verifies lease token/deadline and expected JSON, deducts
  only the observed queue amounts, saves all records and writes an idempotent
  transaction receipt. New arrivals remain in the queue. Receipt lookup precedes
  lease checks, so retrying a lost acknowledgement cannot charge twice.
- `lib/guarded_commit.js`: memory reference and Redis Lua. Postgres executes
  `supabase/003_guarded_player_commits.sql`: sorted per-key advisory locks plus
  existing-row locks, CAS checks, atomic changes and rollback on error.
- Migration 003 also replaces legacy `ratchet_kv_incr`: arithmetic runs against
  the current row inside `ON CONFLICT DO UPDATE`, not a value sampled before a
  row-lock wait. The legacy mutex remains for old callers. A real simultaneous
  apply-once deposit otherwise resurrected credits consumed by a guarded commit.
- Player `_writeGuard:1` opts into a database trigger refusing legacy unconditional
  updates and legacy credit drains. The challenge board has its own protection
  marker. Old code must not be promoted as a rollback after this cutover.
- Challenge acceptance atomically stores both players, removes the offer and
  writes its replay gate. An insufficient balance never consumes that gate.
  Expiry refunds commit before removing offers; interrupted sweeps retry a stable
  refund receipt. Creation/acceptance preserve unswept expired offers for recovery.
- Settled player balance/Brier/exit evidence and a delivery outbox commit together.
  Delivery to pots, ladders, ledger, log and history occurs AFTER that commit and
  retries the exact saved result. The ledger now has a wallet/shot once-key.
  Daily/season keys are frozen in the outbox; all-time XP uses the committed total
  as a maximum, avoiding double counting when bootstrap has already seen it.
- History updates use CAS and chronological retention. Lease takeover releases
  only the stale token it actually read, never a replacement owner's lease.
- Vercel build runs `lib/check_store_schema.js`. Its read-only readiness RPC
  requires migration 003 and the enabled guard trigger. Missing configuration or
  schema BLOCKS the build; there is no unsafe fallback to old player writes.
- `/api/game?action=play-session` and `/play-session.html` are live in h101.
  A private, exact-intent permit reaches the canonical shot path; its player
  debit/shot and expected-session terminal receipt commit together. Owner recovery
  uses the same player lease and session CAS to fence delayed dispatch. The
  [session design](PLAY_SESSION_DESIGN.md) is the complete authoritative contract.

## Executed tests and what they prove

- `test_player_write_fencing.mjs`: two actual canonical handler requests, old
  reader paused beyond lease, newer accepted shot, old writer rejected.
- `test_player_commit_recovery.mjs`: failed player commit leaves queue/accounting
  unchanged; lost acknowledgement commits once; arrival after queue snapshot is
  preserved; failed/partial settlement delivery survives fresh requests; ledger,
  Brier, balance, payouts and all-time bootstrap remain single-counted.
- `test_guarded_commit_sql.mjs`: executes both migrations in PGlite's PostgreSQL
  engine, not a SQL-string mock. Covers multi-player atomicity, queue conservation,
  exact replay, expiry, JSONB ordering, forced exception after deduction with full
  rollback, legacy-writer rejection, retained deposits and disabled-trigger check.
  PGlite is one connection: NOT a distributed-contention or live-Supabase test.
- `test_guarded_build_gate.mjs`: missing/wrong schema blocks deployment; private
  readiness request is read-only, does not print secrets and rejects redirects.
- Last complete pre-session suite after SQL concurrency/opaque-key fixes: 73 passed / 0 failed /
  5 browser skips. Frozen v2 and version/digest checks pass. Browser fixture
  `http://127.0.0.1:8247/` was absent; skipped browser tests are not release evidence.
- `tools/guarded_postgres_batch.mjs`: two real connections exercise opposing CAS,
  blocked apply-once deposit versus queue consumption, replay of both operations,
  expired/replaced lease and old-writer rejection. Local restored PostgreSQL and
  production Supabase both pass. A local old-function control reproduced 125
  queued credits where conservation requires 105. Live fixture keys were removed.
- `test_supabase_key_formats.mjs`: legacy JWT and opaque `sb_secret_` service
  keys across reads, guarded writes and the build gate. Opaque keys use `apikey`
  only; all credential-bearing requests refuse redirects. No secret is committed.
- Focused h101 tests pass: `test_play_session.mjs`,
  `test_play_session_atomicity.mjs`, `test_play_session_http.mjs` and
  `test_play_session_page.mjs`. They cover signed scope/budgets, atomic acceptance,
  lost acknowledgements, delayed-worker recovery, canonical HTTP settlement,
  private consent/owner controls and lease cleanup.
- All 76 runnable h101 suites validated: initial batch 75 pass / one documentation-env
  scanner failure / five browser skips; the corrected client-vs-server-name
  scanner passed 126 checks. No second full-batch pass is claimed. Subsequent
  changes were tests/docs and output-directory config; readiness/output-gate tests
  pass. Isolated consent desktop/mobile QA passes, not the five skipped broad suites.
- The live isolated session probe passed 19 HTTP requests: exactly one PostgREST
  CAS winner, stale rejection, atomic guarded player/receipt, stale-session rollback,
  exact commit replay, changed-commit refusal and exact cleanup. No real-player
  reads, chain calls, owner grant or funded gameplay. See the cutover evidence.

## Completed database cutover and application release

Migration 003 was applied on 2026-08-30 after full backup restore verification and
real local concurrency tests. Service role can execute; anon/authenticated cannot.
The live isolated batch passed and cleaned its fixtures. Installation changes no
real player balances; existing players opt into protection on guarded app writes.
See [cutover evidence and recovery boundaries](GUARDED_DATABASE_CUTOVER.md).

Existing Vercel CLI authentication was found at Windows
`%APPDATA%\xdg.data\com.vercel.cli\auth.json` and exact Ratchet project/team access
was verified with a read-only API request. Production now serves h101 from
`dpl_CQfeCv7FAWgL1sHocBWYzmkgXYUk`, artifact commit
`1b503da6c759cf37c70fc87229c2ab6d98a4e1c0` (application code `9be7c0e`).
Supplied credentials must be rotated; do not repeat, export or commit them.

1. Exact clean artifact: 327 files, tree SHA-256
   `c19b0742304807795fe01ab669616a24ab921e27b502fbf8f1a9ccfb03307035`.
   Public root HTML, consent page and JavaScript hashes match; board/session/Pyth
   report h101, sessions enabled, MCP 13. Auth/origin/scope/private-path checks pass.
2. First deploy passed the database gate but failed a `public` output-directory
   expectation, leaving old production intact. Explicit `outputDirectory: "."`
   produced the verified second READY build. Preserve this guarded writer and
   packaging contract; never disable the trigger to let h100 overwrite guarded rows.
3. Redis Lua and rolling Redis writers remain an unexecuted backend gate. This
   release's production build deliberately requires the Supabase backend.

Full release identity and evidence: [RELEASE_H101.md](RELEASE_H101.md).

## Remaining release and authority boundaries

- The exact-artifact deployment and public readback are complete. These checks
  do not establish an actual owner grant or hosted Bankr execution.
- Actual owner consent and the Bankr private-runtime/X pilot remain. The consent
  UI and private HTTP contract exist, but Bankr's hosted per-user secret injection,
  redirect/log protection and viewer isolation need an external acceptance test.
  No native signer or authority to fund a wallet is added.
- This is not a whole-system atomicity claim. Legacy anchor-XP gate-before-player
  save and separate staking/maintenance side effects need their own fault tests;
  delegated sessions must not gain access to those actions.
- Settlement delivery is eventual on subsequent player reads, not a background
  worker guarantee. No Pyth collector, oracle rule, payout rate or token fee changed.

## Implemented session contract

The exact reserved intent is bound to a non-serializable internal game context.
Acceptance includes the current session as an expected-value extra in the SAME
guarded player commit and writes its terminal shot receipt there. Revocation
flags and signed reserved-attempt budgets survive the transition. Full bounded
intent is retained; ambiguous work never auto-dispatches again.

Recovery holds the player lease and terminalizes the still-reserved session via
CAS. Delayed dispatch is fenced by player ownership and expected session state,
not guessed from absence in a bounded shot ring. Fresh owner-signed status and
recovery remain available after revoke/expiry. External bearer authority stays
closed; the branded worker may read its own terminal receipt to report an already
accepted result truthfully. See [PLAY_SESSION_DESIGN.md](PLAY_SESSION_DESIGN.md)
for expiry-at-commit, consent, transport and private pilot acceptance details.

Sources: [PostgreSQL locks](https://www.postgresql.org/docs/current/explicit-locking.html),
[Redis Lua atomic execution](https://redis.io/docs/latest/develop/programmability/eval-intro/),
[PGlite execution and single-connection limit](https://pglite.dev/docs/).
