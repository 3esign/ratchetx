# RatchetX agent handoff

Updated: 2026-08-30. h100 is deployed and production-verified. MCP remains 1.2.0
(13 tools), as published in the official registry; this release changes no tool schema.

## Live identity and external proofs

h98 fixes shared Pyth-context regressions under late arrivals and player kill-feed
eviction by hidden house-Fleet rows. See
`docs/PYTH_ORDERING_H98.md` for the red-before-fix contract, backend atomicity,
bounded receipt recovery, release checks and limits.

h99 adds golden registered-agent activity and separately retained actual MCP/demo
attempts. See `docs/AGENT_ACTIVITY_H99.md` for identity/proof limits, bounded read
costs and the independent 100-player + 20-demo capacity. This does not change the
ranked economy or imply that a registered wallet proves autonomous AI control.

h100 fixes Bankr's broken MCP scorecard route and a reproduced cursor failure when
optional `to` was omitted. Complete continuation arguments are returned as
`nextRequest`; receipt provenance no longer falsely says Pyth Benchmarks. See
`docs/BANKR_RETEST_H100.md` for controls, release evidence and the next resolution
contract. No new settler, worker, payment or synthetic demo run was introduced.

- Production release: `h100-2026-08-30`; no pending local candidate.
- MCP, Agent Skill and ERC-8004 profile: `1.2.0` live.
- Production deployment: `dpl_EyHicrnAA5E9F6Pv7taxoD6G1dez`, code commit `9b3e7f0`.
- Verified 09:43:05Z: actual MCP scorecards execute; five pages return all 14
  observations in a fixed test window exactly matching the reference read. Omitted
  `to` continuation also passes. All seven atomic Pyth projections remain present.
- Feed has 80 rows: all 75 player events plus 5 demos. HTML is unchanged from h99.
- New Bankr-reported handles `41ea35bc740d` and `55fe7753034f` exist, but both still
  had zero scored calls/null Brier in read-only inspection. Do not claim completed
  retests. Only Bankr's older WIF run had the verified 0.2116 Brier.
- Official MCP Registry: `io.github.3esign/ratchet@1.2.0` is latest; publish
  workflow run `33280486574` completed successfully.
- Solana registry: agent 1475, asset
  `Auj5yXbsaeQUJpYpSRugkgRE3ABc76uqmUe3Vz7fxqCu`.
- Bankr Gauntlet passes:
  - handle `009d2bf7f3be`, shot `308c9b77fcd3`;
  - handle `301e30592c97`, shot `68aef803bf7a`.
  - handle `da738cabd5c2`, shot `0c46104b07a4` (operator-provided Bankr response).
- Ratchet Seal v2 program: `23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX`.

## What this recovery changed

- Restored the frozen v2 Rust source to the deployed/reviewed identity and pinned
  its normalized SHA-256 in `scripts/check-release-safety.mjs`.
- Removed tracked SQL/rotation/transcript/backup artifacts and an invalid nested
  repository gitlink. The removed SQL helper exposed a database credential in Git
  history; credential rotation remains a mandatory external operation.
- Fixed 30-day hashed invite TTL, attribution, milestones and daily counters.
- Implemented the remote ranked prepare/submit protocol with real Ed25519 payloads,
  exact live-target binding, nonce TTL and replay idempotency.
- Replaced duplicated settlement interpretation with `lib/outcome.js`, shared by
  live settlement and the verifier.
- Added schema-v4 record evidence for question type, thresholds/range/race inputs,
  probability, exact exit transitions and rule versions.
- Rebuilt the proof verifier as a keyless audit: symbol→feed-ID mapping comes from
  `lib/onchain_px.js`; the sealed commitment, full hash chain, exact retained validated
  PriceUpdateV2 observation and shared outcome rule reproduce the result. It explicitly
  leaves first-observed selection authority with the Ratchet hash chain.
- Reordered premium proof economics: prepare/validate/cache first, then issue a
  request-digest-bound 0.01 USDC x402 quote. Paid replay is deterministic and does
  not settle twice.
- Added durable KV AgentRun receipts and rebuilt agent report cards from real
  `u:<wallet>` state, exact Brier threshold and receipt provenance.
- Removed the nonconforming A2A endpoint. Consolidated report/proof routes behind
  the game function while preserving `/api/agent` and `/api/agent-proof-bundle`.
  Current deployable API function count is 12.
- Added release safety, invite, ranked, funded premium and report provenance tests.
- Production smoke of h92 caught two deployment-boundary regressions before any
  premium payment: Vercel omitted a runtime imported from `scripts/`, and a bare
  Gauntlet handle did not canonicalize to its `demo-<handle>` player key. h93 moves
  the runtime to statically required `lib/verifier.js` and tests both accepted demo
  ID forms. Invalid premium IDs still fail before any payment quote.
- h94 fixes the stale seven-tool assertion on `/agents` by binding the live check
  to all 11 canonical MCP tool names, and adds a shareable public Brier/calibration
  profile driven only by `/api/agent` values. The initial production profile for
  Bankr is `/agents?id=009d2bf7f3be`.

## Truth boundary

`canonicalSettlement: ratchet-server` and `independentPythReplay: false` remain
correct. The verifier recomputes commitment, hash-chain, retained oracle observation
and outcome consistency. It does not prove that the server observed every qualifying
transition. No v3 program or Calibration PDA is deployed.

## h97 Pyth-native agent layer

- `ratchet_pyth_context` returns the shared validated PriceUpdateV2 snapshot,
  confidence, EMA, publish cadence, Solana observation slots, Pyth posted slots,
  observed health and active targets. `ratchet_pyth_path` returns a bounded
  retained observation path. Pagination uses an opaque composite `nextCursor`,
  not `observedAt + 1`, so distinct transitions captured in the same
  millisecond cannot be skipped.
- Both read from Ratchet capture state and stop before `getPrices()`. Agent reads
  therefore do not trigger Solana/Pyth reads or create data privilege.
- Accepted economic shots record `ratchetx-oracle-seal-v1`, including a SHA-256
  fingerprint over feed identity, price, confidence, EMA, publish times and slots.
- Existing economics remain unchanged: Pyth reads consume no RCX; a valid ranked
  seal deducts play credits; HIT/MISS finalizes the stake; VOID refunds it. RCX
  remains the verified ranked reload rail with the frozen 70/30/0 routing.
- MCP discovery, ERC-8004 metadata, AI catalog, Agent Skill, llms.txt and `/agents`
  advertise 1.2.0 and all 13 tools in Pyth-first order.

## Required environment names

Existing deployment docs remain authoritative. `X402_PROOF_RECEIVER` selects the
separate premium-service receiver. Core settlement, agent context and proof use
validated Pyth PriceUpdateV2 state captured from Solana. A configured Hermes route
is a labeled display-only failover and never changes the settlement authority.
Never place credential values in this repository.

h95 removes the accidental Pyth Benchmarks dependency. Valid retained evidence reaches
402 without any Pyth credential; expired, invalid or divergent evidence fails before the
facilitator and cannot charge an agent.

h96 makes the premium path use the same honest legacy-chain recovery verdict as the
public proof page. All retained economic values must reproduce, the current head must
match, and the sole historical missing index remains explicitly disclosed; changing any
legacy value still fails before an x402 quote is issued.

## Verification already completed locally

- `test_x402_premium`: invalid-before-charge, correct 402 URL/amount, paid delivery,
  exact replay and changed-body rejection.
- `test_x402`: existing ranked-entry economics and funded-path seam unchanged.
- `test_agent_funnel_protocol`, `test_ranked_remote_protocol`, `test_agent_report`.
- Warden, record, agent discovery and release safety pass.
- Final complete run: 65 pass / 0 fail / 5 browser-fixture skips. The browser
  fixtures skip only when their local fixture server is absent. Release safety,
  the 114-check kill switch and all protocol/economics tests passed.

## Exact next actions and boundaries

Immediate next implementation: a per-shot resolution envelope on the existing
canonical `ratchet_demo_state` flow. Include terminal HIT/MISS/VOID, exact retained
exit, balances/Brier, direct proof URLs, pending reason and retry timing. Keep VOID
terminality separate from Gauntlet non-void completion; no forced post-expiry result,
second settler, five-minute serverless wait or invented confidence-expansion test.
Acceptance and existing progress-selector limitation: `docs/BANKR_RETEST_H100.md`.

1. Keep the current release evidence above; do not repeat a funded smoke merely
   for deployment verification. `activity-feed`, Pyth context/path and MCP schemas
   provide read-only checks. The legacy state GET can settle game state.
2. Define a separate policy for conflicting payloads with identical complete
   oracle clock tuples. h98 ordering does not settle fork/equivocation questions.
3. Continue investigating capture gaps without calling the retained sampled path
   a continuous archive or equating posted/RPC slot deltas with measured latency.
4. Full independent Pyth replay remains false. No v3/Calibration PDA is deployed.
5. Earlier recovery documented a leaked database credential. This turn did not
   export, rotate, or certify that credential. Confirm rotation via the authorized
   hosting procedure separately; non-exportable secrets must stay non-exportable.
6. Browser visual QA was unavailable due to Windows ACL startup failure; do not
   confuse the successful API/HTML-byte verification with a rendered visual check.
7. Future successful MCP demo calls are indexed as `MCP client` unless there is
   separate attributed evidence for a name. Do not label arbitrary callers Bankr
   or Grok, count demos as ranked volume, or merge demo retention into player KV.
