# h98: monotonic shared Pyth context

Date: 2026-08-30. Status: deployed and production-verified at 08:49:39Z.
Production code: 263836c. Deployment: dpl_aUSupktX6fEXcDcgN14PqALNSXq1.
Regression contract: commit 8a15b83 (red against h97, before implementation).

## Reproduced defect

A late older transition overwrote `pxlatest:<feed>`, including on duplicate replay.
Two synthetic observations sharing publishTime/observedAt, with posted slots 401
and 402, returned whichever arrived last. The retained path kept both. This was
an application projection bug, not evidence of Pyth manipulation or credit loss.

## Fix and semantics

- Poll and stream both update `g:pyth:latest:v2:<feed>`, using the lexicographic
  order publishTime, postedSlot, rpcSlot, observedAt. A later receipt cannot beat
  an older source clock. These are distinct clocks, not interchangeable latencies.
- Writes use atomic per-key conditional replacement: Redis Lua; Postgres
  conditional PATCH comparing value, updated_at and expires_at; synchronous memory
  compare/write. Losing Postgres writers re-read, with at most five CAS attempts.
  No unconditional fallback, new database, schema migration or paid dependency.
- Older/equal arrivals do not refresh the value or its TTL. Like the old cache,
  the projection expires after an hour without an accepted refreshing observation;
  monotonicity is scoped to that retained projection lifetime, not infinite history.
- Versioned keys isolate rolling old deployments. First capture bootstraps the
  best legacy poll/stream candidate through the same atomic comparator. Readers
  use legacy data only for feeds without a v2 projection, and report atomicFeeds
  versus legacyFeeds explicitly. Shared reads perform no capture writes or RPCs.
- Historical evidence, path cursor order and settlement choice remain separate.
  Polling display fallback is no longer labelled as Pyth context. Stream health
  clocks also use ordered writes, independently of economic state.
- Context means the latest ACCEPTED observation, not a continuous archive or a
  promise that a shot will be accepted. Oracle admissibility is rechecked at seal.
  199/200 bps remain accepted; 201 bps remains rejected. EMA divergence alone does
  not freeze context. No RCX routing, payment, credit, settlement or on-chain changes.

## Verification

- `test/test_pyth_ordering.mjs`: both arrival orders; late duplicates with newer
  local/RPC clocks; cross-hour publication order; poll/stream races; display
  fallback exclusion; 199/200/201 bps; EMA lag; unchanged earliest retained
  settlement versus newest context.
- `test/test_kv_ordered.mjs`: memory concurrency; Redis atomic command shape;
  mocked Postgres CAS update/insert races; equality, expiry, nullable legacy TTL,
  bounded contention and backend failure. The Redis fixture does not execute Lua.
- Existing Pyth context/stream tests verify same-millisecond cursor completeness,
  zero per-reader oracle fetches, and canonical byte validation/capture retries.
- Full suite after the kill-feed/read-only repair: 61 passed, 0 failed, 5 browser-fixture
  skips. Browser inspection could not start because its Windows sandbox failed
  its ACL setup; no claim of completed visual QA. Local production-secret export
  was blocked; Vercel also
  marks the credentials non-exportable. No production env file was created.

Initial Pyth-only canary, commit 67c8723, deployment
`dpl_HPV5Q8NDxhw6KxkaLoB4N7obqzbB`, exercised the real Supabase runtime twice:
heartbeat sampled=true at 1788078314371 and 1788078717481. All seven atomicFeeds
were present with no legacyFeeds. SOL advanced from publishTime 1788078307 /
postedSlot 442833129 to 1788078712 / 442834404. This verifies real insert/update
paths, not a synthetic production concurrency test. The canary was not promoted:
the user then reported the kill-feed defect below. Final combined deployment
must be verified separately.

Final combined candidate 263836c was verified independently: read-only activity
inspection returned 75 rows (73 recovered), no Fleet rows, persisted:false as
expected for a preview. MCP initialized at 1.2.0 / h98 and listed all 13 tools.
Heartbeat sampled=true at 1788079673493; every feed advanced its atomic projection.
The exact deployment was then promoted (not rebuilt).

Production readback at 2026-08-30T08:49:39.847Z:

- ratchetx.xyz served h98; homepage bytes matched the committed index.html after
  newline normalization.
- Activity returned 75 rows, 73 recovered, persisted:true. Normal application
  traffic had initialized the player projection. No diagnostic settlement call
  was used to trigger that migration.
- Pyth context reported all seven atomic feeds, no legacy feeds. SOL's stream
  advanced to publishTime 1788079774 / postedSlot 442837763, demonstrating that
  the production capture worker uses the new writer, not only the canary poll.
- Stream health was 4/7 fresh, 7/7 usable, none beyond the 900-second settlement
  grace window. This is not a claim that every stream notification is captured.

## Kill-feed repair included before final release

Live state returned two visible rows; the public snapshot held 100 rows, of which
98 were hidden house-Fleet activity. Filtering happened AFTER the shared 100-row
retention cap, so agents had already evicted player receipts. Regression contract
3923b4f proves a Fleet burst removed all 100 seeded player rows before the fix.

`lib/activity_feed.js` now rejects house-Fleet writes before the retention cap.
Ranked external-agent wallets remain ordinary players. A versioned player-only
projection protects rolling releases; the legacy mirror preserves snapshot and
rollback compatibility. Initialization recovers at most the last 1000 retained
event indices (plus up to three legacy chunks), merges by receipt identity, and
keeps the latest 100 player rows. It does not claim full-history recovery. Normal
reads do not rescan history; failure leaves no empty/partial migration marker.
Recovery never rewrites the log, settles a shot or changes a balance. A historical
HIT without retained payout bytes displays its recorded XP, not an inferred payout.
Seal rows expose neither side nor salt. Rendered feed text is escaped.

`test_activity_feed` pins retention before filtering; `test_activity_recovery`
covers bounded restoration, immutable-entry precedence, duplicate receipts,
outages/retry, rolling old writers, demo exclusion and safe rendering.
`test_activity_readonly` pins the no-writes/no-oracle diagnostic boundary, including
GET-only behavior and protection against POST query fallthrough.

The opt-in `scripts/probe-ordered-kv.mjs` accepts runtime-provided credentials and
touches only two random `test:pyth-order:*` TTL keys, then removes them. It prints
only assertions and counts, never credentials. It fails closed without the named
durable backend. It is excluded from deployments along with all scripts.

## Release gate and rollback

Deploy clean committed code with `vercel deploy --prod --skip-domain`. Use normal
heartbeat reads to exercise actual validated capture on that deployment, then inspect
Pyth context for atomicFeeds, chronological progress and truthful fallback status.
Inspect `GET /api/game?action=activity-feed` for restored player-feed rows and
provenance. This route returns before player locks, oracle reads and settlement;
it never writes the migration. `projection.persisted:false` explicitly marks a
read-only recovery preview. Normal game activity initializes the actual cosmetic
projection. Do not use the mutating state endpoint as a candidate smoke test.
Promote that exact deployment only after checks pass. A failed canary must not
replace the current domain. Rollback to the previous deployment restores old code;
the new projection keys are isolated, TTL-bound and cannot mutate player balances.

## Bankr evidence checked separately

Public API confirmed handle `da738cabd5c2`, shot `0c46104b07a4`: WIF YES, p=0.54,
entry 0.19883753, exit 0.19893821, HIT, Brier 0.2116. This verifies that demo run,
not forecasting skill or a complete independent oracle audit. A 46-slot difference
between posted and RPC context slots is not an end-to-end latency measurement.
The demo's hash is not automatically an on-chain transaction; canonical settlement
is `ratchet-server`, and `independentPythReplay` remains false.

## References

- [PostgREST conditional table writes](https://docs.postgrest.org/en/stable/references/api/tables_views.html)
- [Postgres concurrent UPDATE predicate recheck](https://www.postgresql.org/docs/current/transaction-iso.html)
- [Redis atomic Lua execution](https://redis.io/docs/latest/develop/programmability/eval-intro/)
- [Pyth EMA semantics](https://docs.pyth.network/price-feeds/core/how-pyth-works/ema-price-aggregation)

Remaining limits: ordering does not establish oracle authenticity or completeness;
capture gaps still exist. Equal full clock tuples with contradictory payloads need
a separate equivocation/fork policy, not an assertion that hashing resolved them.
