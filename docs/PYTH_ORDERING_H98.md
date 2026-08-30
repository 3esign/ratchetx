# h98: monotonic shared Pyth context

Date: 2026-08-30. Status: candidate; production verification pending.
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
- Full suite and staged production verification: record final results below only
  after they complete. Local production-secret export was blocked; Vercel also
  marks the credentials non-exportable. No production env file was created.

The opt-in `scripts/probe-ordered-kv.mjs` accepts runtime-provided credentials and
touches only two random `test:pyth-order:*` TTL keys, then removes them. It prints
only assertions and counts, never credentials. It fails closed without the named
durable backend. It is excluded from deployments along with all scripts.

## Release gate and rollback

Deploy clean committed code with `vercel deploy --prod --skip-domain`. Use normal
board reads to exercise actual validated capture on that deployment, then inspect
Pyth context for atomicFeeds, chronological progress and truthful fallback status.
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
