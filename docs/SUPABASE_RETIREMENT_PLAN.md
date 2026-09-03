# Supabase retirement plan: move authority before deleting storage

Status: required cutover contract; not executed.  
Recorded: 2026-09-03.  
Canonical repository: `ratchetx/ratchet_phase_a_clean`.

This document defines the only acceptable path from the current
Supabase-canonical game to a Solana-canonical RatchetX generation. It does not
authorize a production deployment, a migration root, a rules change, a database
upgrade, or deletion of legacy evidence.

The target is precise: deleting Supabase, every Ratchet-owned server, and every
operator credential must affect convenience only. It must not change a credit,
position, outcome, refund, payout, score, oracle input, delegation, or replay
decision. Solana is the canonical economic database; an indexer or cache is a
replaceable projection.

## 1. Current state: two different HTTP 402 responses

As of this plan, the production Supabase project is restricting access with HTTP
402 `exceed_egress_quota`. There is no current final legacy snapshot and no
`releases/legacy-snapshot-manifest-*.json` produced by the final-snapshot
procedure. The prepared recovery procedure is documented in
[`SUPABASE_FINAL_SNAPSHOT.md`](SUPABASE_FINAL_SNAPSHOT.md).

This infrastructure 402 must not be confused with RatchetX's intentional x402
protocol response:

| HTTP 402 source | Meaning | Migration treatment |
| --- | --- | --- |
| Supabase `exceed_egress_quota` | The current canonical KV authority cannot be read or written through its normal API. Game/API calls may surface this as HTTP 500. | Outage and migration blocker. It is not payment authorization and not a safe writer barrier. |
| RatchetX x402 `Payment Required` | Expected protocol response for the optional paid agent-entry or proof-bundle resource. | Preserve only if its entitlement and recipient rules become verifiable on-chain; otherwise retire it from the canonical game path. |

The static site can still load while the game fails because the browser talks to
same-origin Ratchet APIs, and those APIs then reach Supabase. There are no browser
direct Supabase requests and no `@supabase/*` client dependency. `index.html`
contains disclosure text only; `vercel.json` restricts browser connections to
`'self'`.

The quota restriction is not proof that the old writer is permanently stopped.
If quota access is restored while the legacy Vercel credential remains valid, the
old deployment can resume writing. Before any recovery access is enabled, revoke
or rotate the exact credential installed in the legacy runtime and do not install
the replacement there. Preserve only a redacted hash of the revocation evidence;
never put a key, database password, connection string, or player value in a public
manifest.

The SQL boundary makes this exact. `public.ratchet_kv` and every callable
`ratchet_kv_*` function are granted to `service_role`, while `public`, `anon`, and
`authenticated` are revoked. The old runtime uses that service credential through
PostgREST; it has no direct PostgreSQL path. Inventory every still-reachable
production, preview and retained Vercel deployment, not only the current custom
domain. If their installed credentials are individually revocable `sb_secret_*`
keys, delete every distinct writer key or disable the deployment. If any uses a
legacy service-role JWT, rotate the signing secret that validates it. A redacted
evidence hash is only an attestation pointer: the snapshot tool cannot prove a dashboard
revocation from 64 hexadecimal characters. After quota access is restored, an
independent negative probe must show that every reachable old deployment/credential
pair is unauthorized rather than still quota-blocked. Probing only
`ratchetx.xyz` does not fence an old deployment URL. Only those probes plus the
redacted deployment/credential inventory and revocation records establish the
writer barrier.

## 2. Non-negotiable cutover rules

1. Do not delete Supabase state until a complete, repeatable-read export, clean
   local restore, event-log verification, key-family inventory, and conservation
   report all match exactly.
2. Do not use `/api/snapshot` as a migration source. It is a resurrection view,
   not a lossless database export.
3. Do not use Upstash, Vercel KV, or process memory as an automatic or temporary
   canonical fallback.
4. Do not dual-write spendable state to Supabase and Solana. There must be one
   authority on each side of a named generation boundary.
5. Do not silently drop, recompute, or zero open shots, challenges, queues,
   settlement outboxes, leases, replay receipts, pots, or payout plans.
6. Do not merge RCX, play credits, XP, demo credits, or USDC into one unit. A
   legacy play credit is not an RCX redemption claim.
7. Do not make an API key unlock a feed, market, rule, payment path, or settlement
   capability. Paid infrastructure may improve transport only when its bytes are
   checked against the same on-chain authority as the keyless path.
8. Fail closed when canonical state is unavailable. A gap is `unknown`, never
   zero, a fresh player record, a stale cache, or a guessed settlement.
9. Do not freeze or revoke upgrade authority merely to meet a historical date.
   Freeze only after the on-chain generation passes the server-off acceptance
   drill and independent byte/authority verification.

## 3. Runtime dependency surface

### 3.1 Storage selection and direct Supabase access

| Path or symbol | Current role | Retirement condition |
| --- | --- | --- |
| `lib/supabase_kv.js` | Canonical PostgREST/RPC adapter. Reads `SUPABASE_URL` plus `SUPABASE_SERVICE_KEY` or `SUPABASE_SERVICE_ROLE_KEY`. | Remove only after no canonical route imports `lib/kv.js` for economic state. |
| `lib/supabase_auth.js` | Constructs server-side database-authority headers. This is not end-user Supabase Auth. | Remove with the Supabase adapter. |
| `lib/kv.js` | Chooses Supabase when both Supabase variables exist; otherwise chooses Upstash when its URL/token exist; otherwise uses `globalThis` memory. | Replace canonical callers and then remove the implicit backend switch. |
| `lib/check_store_schema.js` | Calls `ratchet_kv_guarded_ready` as a live production build gate. | Replace with chain-generation/program-ID/schema checks. |
| `vercel.json` `buildCommand` | Runs `node lib/check_store_schema.js`, making deployment depend on live Supabase and its credential. | Remove only when the chain-only build/release gate exists. |
| `lib/play_session_http.js` | Requires `kv.backend === 'supabase'` and otherwise returns `DURABLE_SESSION_STORE_REQUIRED`. | Replace with owner-approved on-chain `DelegateGrant` state or retire delegated sessions. |

`lib/supabase_kv.js` uses these database functions:

```text
ratchet_kv_get                 ratchet_kv_mget
ratchet_kv_set                 ratchet_kv_set_many
ratchet_kv_setnx               ratchet_kv_release
ratchet_kv_del                 ratchet_kv_scan
ratchet_kv_incr                ratchet_kv_take
ratchet_kv_hincr               ratchet_kv_hincr_many
ratchet_kv_hall                ratchet_kv_hseed
ratchet_kv_zincr               ratchet_kv_zmax
ratchet_kv_ztop                ratchet_kv_apply_once
ratchet_kv_zincr_many_once     ratchet_kv_sweep
ratchet_kv_commit_guarded
```

It also performs ordered/CAS writes directly against
`/rest/v1/ratchet_kv`, including Pyth latest-state ordering and play-session
revision CAS.

### 3.2 Hidden fallback that is forbidden for migration

`lib/kv.js` currently recognizes:

```text
KV_REST_API_URL
KV_REST_API_TOKEN
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

Removing only `SUPABASE_*` therefore does not create a chain-only product. It can
silently select old Upstash data or per-process memory. Memory is fragmented
between serverless instances and evaporates on cold starts. Upstash is an older
rollback source, not the current authority. The final runtime must reject a
missing Solana generation/configuration rather than selecting either backend.
Revoking a still-configured Supabase credential leaves the Supabase adapter
selected and failing closed; deleting the Supabase variables first would activate
the hidden Upstash/memory branch and is therefore forbidden during the writer
barrier ceremony.

### 3.3 API routes that currently reach KV

Directly or through imported modules, the dependency includes:

```text
api/game.js            api/feeds.js           api/proof.js
api/snapshot.js        api/log.js             api/record.js
api/shot.js            api/supply.js          api/ledger.js
api/blink.js           api/mcp.js             api/agent-entry.js
```

This is why a working HTML page is not evidence of a working game. Every route
must be classified as one of: direct Solana authority read/write, replaceable
projection, immutable archive read, or retired surface.

## 4. Canonical state that must move on-chain

The following state cannot be deleted after a historical upload alone. It needs
an on-chain replacement or an explicit terminalization/import rule.

### 4.1 Player ledger, balances, positions, and obligations

| Current source | Meaning | Required destination |
| --- | --- | --- |
| `u:<wallet>` via `api/game.js::loadPlayer` and `lib/player_writes.js::savePlayer` | Credits (`cr`), XP, streak, hit/shot counters, Brier/calibration, open and closed shots, `settlementOutbox`, staking, agent registration and Champion receipt totals. | Versioned `PlayerLedger` PDA plus one `Shot` PDA per live position; checked atomic transitions. |
| `pend:<wallet>` | Queued play-credit obligation. | Imported obligation or drained before cutoff; never merged into a stale player value. |
| `c7:<wallet>` | Pending Champion-received RCX accounting. | Reconcile against chain transfers and import only the exact remaining obligation. |
| `cs7:<wallet>` | Pending Champion self-routed RCX accounting. | Reconcile independently from `c7:*`; preserve its distinct semantics. |
| `hist:<wallet>` | Compact shot history. | Archive as legacy provenance; native G2 history derives from on-chain accounts/events. |
| `chist:<wallet>`, `lock:chist:<wallet>` | Champion receipt history and write lease. | Reconcile receipts against chain; archive history; no canonical lock after cutover. |
| `h:stats`, legacy `g:stats` | Burn/pot/shot/Champion/staking/hit accounting aggregates. | Recompute from imported state and chain evidence; bind reconciled legacy totals to the migration manifest. |

`lib/player_writes.js` and `lib/guarded_commit.js` currently couple player CAS,
queue drains, lease validation, and replay receipts. G2 must preserve the atomic
effect, not just copy the final JSON object.

### 4.2 Economic replay and idempotency gates

```text
guarded:receipt:<txid>         shotseal:<wallet>:<shot>
stakefund:<wallet>:<shot>      stakereverse:<wallet>:<shot>
hitpay:<wallet>:<shot>         ladder:<wallet>:<shot>
ledger:<wallet>:<shot>         sig:<txsig>
anch:<wallet>                  mirshot:<wallet>:<shot>
champbal:<wallet>              lock:u:<wallet>
guarded:challenge-board
```

Replace these with durable PDA seeds, account constraints, transaction
signatures/nullifiers, or direct Token-2022 account reads. Cleanup must not make a
previous signature or legacy receipt spendable again.

`g:anchors` and `lock:anchor:<txsig>` are the discoverable anchor projection and
its repair lease. Archive `g:anchors`, reconcile it with the corresponding
`sig:*` and log entries, and never treat the expiring lease as value. The guarded
challenge marker is SQL protection state, not a player claim, but it must remain
in the legacy inventory so it is not mistaken for an unknown economic family.

### 4.3 Oracle evidence and settlement selection

Primary code: `lib/pxlog.js`, `api/game.js::samplePx`,
`api/game.js::oracleIngest`, and `lib/pxlog.js::priceCrossing`.

```text
px:YYYY-MM-DDTHH
pxu:YYYY-MM-DDTHH
g:pyth:latest
g:pyth:latest:v2:<feed>
pxlatest:<feed>
pxstream:<feed>
lock:px:*
lock:pxu:*
```

The current server's price-crossing selection depends on these retained buckets.
`oracleIngest` is authorized by the separate `RATCHET_CAPTURE_SECRET`; that is a
central writer even though it is not a Supabase credential.

The replacement is a separately versioned Timepin program. A permanent
per-target account must bind oracle domain, Pyth program/account owner, feed ID,
target time, price, confidence, exponent, publish time, previous publish time,
verification level, authenticated-message hash, and capture/finalization slots.
The signed source interval must bracket the target. A bounded rolling ring is not
sufficient because eviction can convert a losing outcome into a forced refund.
Core G2 consumes exactly one finalized admissible Timepin or reaches a deterministic
VOID/refund terminal state.

### 4.4 Challenges

```text
g:chal
chaltaken:<id>
chalref:<id>
g:log:once:chal:<id>
g:log:once:chaltake:<id>
g:log:once:chalexpire:<id>
lock:g:chal
```

Every open challenge contains two-sided commitments and debit/refund obligations.
The immediate no-Supabase path must import them exactly into versioned on-chain
accounts. The alternative is to stop admission and terminalize every challenge
under its original rule before taking the final snapshot. Deletion is never a
valid implicit VOID.

### 4.5 Epochs, leaderboards, pots, and podiums

```text
z:lb:<season>                  z:lbd:<day>
z:lba:all                     lb:<season>
lbd:<day>                     mig:<zkey>
g:alltime:seeded              g:day
g:season                      g:dayResults
g:seasonResults               g:podium
g:podium:prev                 g:podium:fallback
g:podium:history              g:lastRoot
rollplan:<daypot|season>:<period>
rollpay:<kind>:<period>:<rank>
rolldebit:<kind>:<period>
lock:roll:*                   lock:g:podium:live
lock:g:alltime:seed
day:paid:<period>             season:paid:<period>
```

G2 needs deterministic per-player/per-epoch score accounts or reviewed shards,
explicit pot/vault or credit accounting, immutable payout plans, permissionless
epoch finalization, deterministic tie rules, and durable replay protection. An
operator-posted top-three root is not proof that the eligible set was complete.
The `day:paid:*` and `season:paid:*` rows are predecessor payout gates left by the
older rollover implementation. They must be archived and reconciled against the
newer `rollplan:*`/`rollpay:*`/`rolldebit:*` records; an old gate must never be
silently reinterpreted as an unpaid plan.

### 4.6 Delegated play and ranked authorization

Primary code: `lib/play_session_record.js`, `lib/play_session.js`,
`lib/play_session_http.js`, and `api/mcp.js`.

```text
play-session:v1:<wallet>
play-status-throttle:<wallet>
nonce:ranked:<wallet>:<nonce>
```

If delegated play remains, replace the database session with an owner-signed
`DelegateGrant` PDA containing the delegate, allowed program/ruleset/methods,
expiry, nonce/replay boundary, revocation state, and whatever explicit budgets the
owner approves. Removing a server-side spend cap must not accidentally create an
unbounded bearer capability. Ranked prepare/submit should become one signed
on-chain authorization transition rather than a KV nonce lease.

### 4.7 Agent identity and paid entitlements

```text
g:arena
agentname:<name>
agentrun:<shotId>
x402:q:<id>
x402:c:<hash>
x402:cu:<hash>
lock:x402:claim:<quoteId>
proof:prepared:<digest>
```

Agent names/ownership that affect access must be owner-signed on-chain state.
x402 payment may settle on-chain today, but quote, claim, used-claim, delivery, and
replay records remain off-chain. Keep premium computation or delivery off-chain
only as a replaceable service; entitlement, recipient, resource binding, and
payment replay must be independently verifiable. The optional
`X402_FACILITATOR_BEARER` cannot be required for canonical play.

### 4.8 Board generation and immutable rules

The current hourly board is KV-free but still server-resident:
`api/game.js::targetBoard` derives its feed permutation, horizons, PUMP/DUMP/RACE/
BOX slots, `TYPVOL` thresholds, XP and side multipliers from the UTC hour and
JavaScript constants. Determinism inside one server file is not permissionless
admission. If the Ratchet API disappears, an on-chain program cannot safely accept
a target merely because a client reproduces those constants.

G2 must bind each admission to a write-once `Ruleset` and a deterministic
`EpochBoard` identity (or derive the exact board inside the program). The on-chain
definition must include feed IDs, horizon set, generator/version, integer PRNG and
rounding rules, threshold constants, XP/multipliers, epoch clock and target-ID
derivation. Anyone must be able to materialize or verify an epoch board; no
operator may choose, omit, reorder or edit its markets. A new ruleset may create a
new generation, but it cannot mutate the rules of an open shot or the permanent
generation. Rust, JavaScript and independent-client board vectors must match
byte-for-byte across epoch boundaries.

## 5. Historical data and replaceable projections

These families may be removed from the live database after the complete snapshot
and immutable archive are verified. They do not need to be economic consensus,
but any historical fact not reconstructible from retained chain data must remain
available as an authenticated archive.

| Domain | Paths and namespaces | Treatment |
| --- | --- | --- |
| Event log | `lib/log.js`; `g:log:e:<i>`, `g:log:n`, `g:log:head`, `g:log:c:<chunk>`, `g:log:heads`, `g:log:recent`, `g:log:h:<i>`, `g:log:once:*`, `lock:g:log` | Verify the chain/head and disclosed historical gap; publish canonical bytes and archive manifest; bind its digest/root on-chain. |
| Feed health | `lib/feedhealth.js`; `g:fh`, `fhsettle:*`, `g:fh:live:<hours>`, `g:fh:days`, `fh:d:<date>`, `lock:g:fh:rollup` | Archive daily rollups because expired raw buckets may make them unreconstructible; rebuild live views from chain/indexer data. |
| Supply history | `lib/supplylog.js`; `g:sup:days`, `sup:<date>`, `g:supply0` | Archive provenance; read current supply directly from the mint. |
| Display/proof caches | `g:coin`, `g:proofcache`, `g:mintprog`, `g:mcap`, `champbal:*` | Delete after chain-only readers exist. Never use them to authorize value. |
| Activity/evidence | `g:feed`, `g:feed:players:v2`, `g:evidence:publicRuns`, `g:evidence:externalAudits`, `evidence:seeded` and locks | Archive useful provenance; make new views recomputable and explicitly noncanonical. |
| Funnel/demo telemetry | `inv:<hash>`, `demo:invite:<handle>`, `funnel:<inviteHash>`, `funnel_daily:<day>` and locks | Archive or delete; never import demo balances into ranked economic claims. |
| MCP demo feed | `g:feed:mcp-demos:v1` | Archive/delete as telemetry. |
| External ledger projection | `ldg:tick`, `ldg2:open`, `ldg3:score`, `ldg3:recent`, `ldg4:dropped`, `ldg:rx` | Archive or rebuild; it must not become game authority. |
| Crowd odds | `odds:<hour>` | Treat as a derived display projection. |
| Warden | `g:warden:rec`, `g:warden:rec:prev`, `g:warden:model`, `g:warden:hist`, `g:warden:open`, `wseal:<id>` and Warden append gates/locks | Archive the record; move only a deliberately retained economic obligation. |
| Fleet | `g:agents:rec`, `g:agents:open`, `g:agents:px`, `g:agents:pxh:<hour>`, `aseal:<id>`, `asettled:<id>` and Fleet append gates/locks | Archive/delete unless explicitly promoted to a separately reviewed on-chain product. |

Arweave or another content-addressed archive is permanent memory, not Solana
consensus. The archive should hold source, verified binaries, schemas, clients,
runbooks, the raw legacy evidence bundle, and historical projections. Solana must
hold the commitments that make alteration detectable and every state fact that can
move value.

## 6. The only acceptable final snapshot

### 6.1 `/api/snapshot` is forbidden as a migration source

`api/snapshot.js` intentionally strips the secret side/salt and other fields from
open shots. `scripts/restore.mjs` then void-refunds restored open shots. The API
also omits, among other state:

- `g:chal` and challenge obligations/replay gates;
- `guarded:receipt:*`, leases, and several repair records;
- `play-session:v1:*` and pending session actions;
- `px:*`, `pxu:*`, and latest Pyth projections;
- Fleet state;
- x402 quotes, claims, used claims, and proof preparation records;
- arena/name/agent-run state;
- rollover plans, debits, payouts, and many idempotency gates;
- supply/feed-health/activity/funnel/external-ledger projections.

It cannot prove a lossless cutover. `scripts/dump_kv.mjs`, `LEGACY_ROOT.cmd`, an
old backup, or Upstash are also insufficient as the sole final source.

### 6.2 Required extraction protocol

Use `tools/supabase_final_snapshot.mjs` only according to
[`SUPABASE_FINAL_SNAPSHOT.md`](SUPABASE_FINAL_SNAPSHOT.md). Its status is prepared,
not executed. The accepted source is every row of `public.ratchet_kv` from one
PostgreSQL snapshot.

Required order:

1. Revoke the exact legacy runtime database credential and retain redacted,
   hashed evidence of the writer barrier.
2. Do not put the replacement/recovery credential in Vercel and do not enable
   Upstash fallback.
3. Enable only enough private, temporary direct database access to perform the
   recovery export. If Supabase still returns 402 or PostgreSQL is unavailable,
   stop; do not publish a root.
4. Require a stable whole-table fingerprint before export.
5. Start `REPEATABLE READ READ ONLY DEFERRABLE`, export the snapshot identifier,
   and capture every row ordered with the C collation. Canonical row material must
   include `key`, `value`, `expires_at`, and `updated_at`.
6. Produce the complete data dump, public schema dump, canonical private NDJSON,
   ordered database digest, domain-separated Merkle root, key-family inventory,
   event-log proof, and conservation vector from that same snapshot.
7. Restore schema and data into a clean ephemeral local PostgreSQL instance and
   require exact row count, digest, Merkle root, inventory, log, and conservation
   agreement.
8. Recheck the source fingerprint after export. Any change before/during/after the
   snapshot invalidates the run.
9. Publish only the redacted manifest of hashes, counts, aggregate buckets, known
   gaps, and procedure identity. Raw keys, values, wallets, credentials, snapshot
   identifiers, and connection material remain private and ignored.

Before this procedure is accepted, the key-family report must identify every
approved root family separately without publishing private suffixes. A residual
`other:*` bucket is a stop condition until every contained private key is reviewed,
assigned a named treatment and added to the safe family classifier. One aggregate
`other:*` count is not an inventory. After the writer barrier, wait for ordinary
leases to expire; require zero live leases at cutoff or publish and review an exact
exception for each interrupted transition before any import is compiled.

### 6.3 Required conservation and integrity report

The report must preserve distinct units and must at minimum cover:

- player count, credits, legacy balance fields, XP, and player-attributed RCX
  burn records;
- player-shape violations and negative values;
- open-shot count, aggregate open-shot stake, and malformed shots;
- settlement-outbox count;
- open-challenge count, aggregate challenge stake, and malformed challenges;
- `pend:*`, `c7:*`, and `cs7:*` aggregates and malformed queue entries;
- play-session and pending-session counts;
- guarded-receipt count;
- live-lease and expired-row counts at snapshot time;
- `h:stats` or legacy `g:stats` totals for allocated burned credits, weekly and
  daily pots, verified RCX burned, Champion paid/retained RCX, and hit-payout
  credits;
- exact event-log issued count, exported entries, head, verified mode, intactness,
  and disclosed missing positions;
- counts for every approved root family, plus a private classification record for
  every previously unknown family; a residual `other:*` bucket blocks import.

These are overlapping state buckets, not a false fixed-supply equation. The
requirement is that every bucket restores bit-for-bit, every malformed/negative
obligation stops the migration, and a separately reviewed import projection
explains every transformation from legacy units to G2 state.

The raw export includes expired rows so the database digest is lossless. Migration
semantics must use the fixed snapshot cutoff: expired leases, quotes, throttles and
TTL replay records are archived but never revived as active G2 state. A live lease
is not imported as authority; it first requires the interrupted operation to be
resolved or explicitly proven non-economic under a reviewed exception.

Stop immediately if a required family is absent, a row is malformed, an
undisclosed log break appears, one restored byte/digest/node differs, or a public
artifact contains private row material.

## 7. Legacy position treatment and migration root

The current 402 condition makes an exact import the default immediate-retirement
path: preserve the whole database once, leave the old runtime unauthorized, and
move open obligations into a reviewed legacy generation. Do not restore the old
general writer merely to make the site appear healthy.

If the project instead chooses terminalization before import, it requires a
separately reviewed, bounded recovery writer, an admission fence, settlement or
deterministic VOID/refund under each position's original rules, queue/outbox drain,
and then a new final repeatable-read snapshot. A snapshot taken before such writes
cannot be reused as the final root.

The migration commitment must bind at least:

```text
cluster
destination program generation and program ID
migration ID and finalized cutoff slot
legacy snapshot schema/version and manifest digest
wallet or claimant identity
unit/asset type and amount or exact position payload
leaf index/nonce and durable claim nullifier
original ruleset/market/oracle identity for open positions
```

A Merkle root proves inclusion in the captured snapshot; it does not prove that
the old server's history was correct. Publish that trust boundary. Use a dedicated
nonzero migration generation, make root replacement impossible after its reviewed
ceremony, and retain a predetermined recovery policy for omissions. Never allow a
wallet to spend both its legacy balance and imported balance, and never recredit a
consumed RCX burn/reload signature.

## 8. Target authority boundary

The minimum replacement architecture is:

- **Timepin program:** permissionless need/candidate/finalization for the uniquely
  admissible Pyth source crossing; permanent per-target evidence, no evicting ring.
- **Core G2 program:** versioned Ruleset, PlayerLedger, Shot, Challenge,
  Epoch/Pot/Podium, reload/claim receipts, calibration, deterministic settlement,
  refund and cleanup instructions.
- **DelegateGrant:** owner-approved, revocable, scoped agent authority with durable
  replay protection. An HTTP bearer token is not a Solana signer.
- **Token-2022 path:** actual RCX mint owner/extensions/ATAs and transfer/burn CPIs
  validated by a real positive control. Credits remain nonredeemable game units.
- **Replaceable clients/indexers:** direct chain reads with explicit commitment and
  context slot, independently recomputable summaries, and no authority to change a
  result or balance.
- **Permanent artifact archive:** content-addressed source, verified binaries,
  IDLs/schemas, clients, migration evidence, and recovery instructions, with
  digests bound on-chain.

A Solana program does not wake itself or pay its own transactions. Every timed
transition must be callable by anyone, with deterministic evidence and terminal
behavior. Any keeper bounty must be pre-funded, explicit, bounded, and unable to
change the winning observation. No permanent operation may require the founder or
an API key.

## 9. Dependency-ordered retirement sequence

### R0 — preserve the legacy authority now

1. Treat the Supabase 402 as an outage, not a migration success.
2. Revoke every legacy production/preview runtime database credential, or disable
   every corresponding deployment, before lifting the restriction.
3. Run the complete final snapshot procedure once access is available.
4. Keep Supabase unavailable to the old runtime after the verified export.

**Gate:** public redacted manifest exists; private dumps restore exactly; no
credential or player value is public; writer barrier and source fingerprints are
verified. The writer-barrier evidence includes an independent unauthorized probe
for every reachable legacy deployment after quota access returns; the tool's
formatted evidence hash alone is not proof.
Every key family is classified, and live leases are zero or have reviewed,
transition-specific terminalization evidence.

### R1 — complete the no-value oracle authority

Finish and adversarially test Timepin: exact source crossing, same-timestamp
revisions, confidence, late arrival, omission, competing submitters, ambiguity,
finalization, and deterministic VOID.

**Gate:** one admissible result or one explicit terminal refund result, with no
operator-selected input and no secret-required feed.

### R2 — complete one atomic G2 economic kernel

Implement atomic admission/debit, shot/challenge state, settlement/refund,
credits/XP/calibration, replay receipts, reload/burn routing, pots and deterministic
finalization. Bind admission to a write-once ruleset and a permissionlessly
reproducible hourly board, including the current horizon/feed/PUMP/DUMP/RACE/BOX
generator. Use grouped SVM tests for concurrent/double seal, receipt replay,
asset conservation, competing settle/void/finalize, arithmetic boundaries and
actual Token-2022 ownership/extensions.

**Gate:** no admin instruction can award arbitrary value; every funded state has a
permissionless terminal path; JS/Rust board and economy vectors and conservation
agree; no operator can choose or suppress an admissible epoch market.

### R3 — replace delegated and paid capabilities

Implement DelegateGrant or retire owner sessions. Move ranked authorization and
economically meaningful agent identity on-chain. Make x402 entitlement/recipient
verification independent of Supabase, or remove x402 from canonical admission.

**Gate:** replay, revoke, expiry, wrong-owner/domain, crash recovery and independent
client lifecycle tests pass; no API key creates economic capability.

### R4 — compile and verify the legacy import

Transform only the verified final snapshot into the versioned migration leaf set.
Reconcile every unit, obligation, replay gate, open position, pot, payout plan,
outbox and known gap. Classify every private key family, apply the captured cutoff
to expired rows, and resolve every live-lease exception. Independently reproduce
the leaf set and root twice.

**Gate:** manifest-to-leaf transformation is deterministic; totals and counts match;
duplicate/omitted claims fail; root and import authority policy receive explicit
review before activation.

### R5 — activate one finalized generation boundary

At a named finalized slot, activate G2/import claims and route every new economic
action only to Solana. Keep the legacy runtime unauthorized. There is no dual-write
period and no Upstash/memory rollback of canonical state.

Before activation, ship a static chain client that derives/verifies the same board,
reads accounts at explicit commitment and submits transactions directly to a
user-selectable keyless RPC. The current browser calls `/api/*`, and the current
`vercel.json` CSP says `connect-src 'self'`; both must change before a server-off
claim is true. A content-addressed copy of the client must work when
`ratchetx.xyz` and every Ratchet API are unavailable.

**Gate:** an active wallet cannot spend both generations; old signatures cannot be
replayed; clients display generation, source slot and commitment.

### R6 — prove founder-independent operation

Turn off Ratchet API, Supabase, oracle collector and keeper in an isolated drill.
Using an independent client and keyless public RPC, admit valid play, finalize a
Timepin, settle or deterministically void/refund positions, recover balances,
revoke delegation, verify scores and rebuild projections.

**Gate:** deleting founder infrastructure changes latency/availability only; it
cannot alter economic truth. Corrupt-indexer and keeper-loss tests also pass.

### R7 — remove Supabase code and configuration

Only after R6:

1. Replace or delete every remaining `lib/kv.js` caller. If a projection-only
   adapter remains, remove its unconditional `require('./supabase_kv.js')` and give
   it a name/API that cannot be imported by an economic path. Only then delete
   `lib/supabase_kv.js`, `lib/supabase_auth.js`, and
   `lib/check_store_schema.js`; deleting the adapter first would make current
   `lib/kv.js` fail at module load.
2. Remove the Supabase build command from `vercel.json`.
3. Remove `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY` from deployment configuration.
4. Remove the implicit Upstash/memory economic fallback and its deployment
   variables from canonical paths.
5. Delete/archive the Supabase SQL and obsolete migration/probe tooling listed
   below.
6. Replace Supabase/PostgreSQL tests with SVM/on-chain tests and regenerate the
   dependency lockfile.
7. Archive or disable the Supabase project only after multiple independently
   verified evidence copies and the agreed audit/grace period.
8. Replace same-origin `/api/*` browser reads/writes and update the CSP for direct,
   user-selectable Solana RPC access; verify the content-addressed client with the
   Ratchet origin and APIs offline.

## 10. Files to retire, replace, or preserve

### Remove after R6

```text
lib/supabase_kv.js
lib/supabase_auth.js
lib/check_store_schema.js
supabase/001_ratchet_kv.sql
supabase/002_ratchet_kv_sweep.sql
supabase/003_guarded_player_commits.sql
supabase/preflight_guarded_player_commits.sql
scripts/migrate-upstash-to-supabase.mjs
tools/supabase_readonly_probe.mjs
tools/play_session_live_probe.mjs
tools/guarded_postgres_batch.mjs
```

`lib/kv.js` must either be deleted after its last caller or replaced with an
explicitly noncanonical projection adapter before the Supabase module is removed.
Also retire or mark non-current `LEGACY_ROOT.cmd`, `scripts/dump_kv.mjs`, and
`tools/repro_player_lease_expiry.mjs`; none is an accepted chain migration or
production recovery path.

Remove Supabase mode from `scripts/probe-ordered-kv.mjs`, or archive the entire
probe. Retain `tools/supabase_final_snapshot.mjs` and
`tools/supabase_backup_guarded.mjs` through final extraction, restore verification,
independent review, and evidence replication; archive them afterwards rather than
using them as runtime dependencies. Keep `scripts/restore.mjs` only as historical
recovery tooling; it restores to Upstash and is not a Solana migration mechanism.

### Replace tests after their on-chain equivalents exist

```text
test/test_supabase_kv.mjs
test/test_supabase_strict_read.mjs
test/test_supabase_key_formats.mjs
test/test_supabase_migration.mjs
test/test_guarded_build_gate.mjs
test/test_guarded_commit_sql.mjs
test/test_guarded_preflight_sql.mjs
```

Remove Supabase-specific branches from `test/test_kv_ordered.mjs` and
`test/test_play_session_kv.mjs`. Generic activity, registry, player-recovery,
session, Pyth-ordering, and shot-page tests should remain but lose assumptions such
as `kv.backend = 'supabase'` and environment clearing that exists only to select a
database backend.

After the last PostgreSQL export/probe and SQL-emulation test is retired, remove
`pg` and `@electric-sql/pglite` from `package.json` and regenerate
`package-lock.json`.

### Mark historical, do not execute as current runbooks

```text
docs/SUPABASE_CUTOVER.md
docs/GUARDED_DATABASE_CUTOVER.md
docs/GUARDED_PLAYER_WRITES.md
docs/PLAY_SESSION_DESIGN.md
docs/SELF_HOST.md
docs/STACK.md
```

Also correct Supabase-era claims in `README.md`, `index.html`, release documents,
and `.vercelignore` only when G2 is actually canonical. Preserve history instead of
rewriting old release evidence to imply it was on-chain.

### Preserve as provenance or active migration truth

```text
docs/SUPABASE_FINAL_SNAPSHOT.md
docs/ONCHAIN_MIGRATION_PLAN.md
docs/OPERATOR_INDEPENDENCE_PLAN.md
docs/CHAIN_GAP.md
lib/canon.js
lib/legacy_chain.js
tools/chain-diag.mjs
tools/permanence-release.mjs
```

`lib/canon.js`, `lib/legacy_chain.js`, and `tools/chain-diag.mjs` handle historical
JSONB/hash-chain ordering damage. They are evidence tools, not live Supabase
dependencies, and must not be deleted merely because their comments mention
PostgreSQL.

## 11. Final definition of done

Supabase retirement is complete only when all statements below are true:

- a complete final database export and exact local restore are independently
  verified;
- the migration root and every aggregate are reproducible without private player
  values becoming public;
- every open legacy obligation is terminalized or represented by an exact on-chain
  claim/state transition;
- all new economic writes and all outcome selection occur on Solana;
- target/board generation and every admission rule are reproduced and enforced
  from immutable on-chain generation data, not server constants;
- no Supabase, Upstash, memory, server secret, or operator signature can alter the
  result;
- public clients can read and verify the generation through keyless RPC, while
  showing unavailable data as unknown, and the browser client works without any
  same-origin Ratchet API;
- every funded position has a permissionless settle, VOID/refund, recovery, and
  cleanup path;
- program source, binaries, schemas, clients, migration evidence, and recovery
  instructions are content-addressed and their identities are bound on-chain;
- the independent server-off drill passes;
- only then are database code, variables, build gates, and the project itself
  retired.

Until all of these are satisfied, Supabase is not retired. It is either the current
authority, a sealed migration source, or retained historical evidence; those three
states must never be blurred.
