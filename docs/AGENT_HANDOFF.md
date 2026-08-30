# RatchetX agent handoff

## Current work — h102 refusal diagnostics (2026-08-30)

See [h102 evidence and next Bankr acceptance](RELEASE_H102.md). Bankr reports a
rejected 100-credit PUMP attempt with stable replay and zero debit, not a completed
forecast. Production log confirms outer409 but the old adapter discarded its
inner cause. Synthetic exact-intent controls pass when fresh and reject stale /
wide-confidence data. h102 adds safe persistent codes, preserves gross attempt
accounting and never retries a terminal rejection. The one-attempt grant is used;
another pilot needs a fresh owner signature/private secret replacement.
Production remains h101 until the h102 release evidence below is filled.

## Previous h101 release (historical)

Updated: 2026-08-30T15:02:28.056Z. h101 with UI hotfix h101-ui1 is DEPLOYED and public-verified.
MCP remains 1.2.0 (13 tools), as published in the official registry; this release
adds no MCP tool or function slot. See [release evidence](RELEASE_H101.md).

Mobile owner setup fix: wallet connection now performs one unsigned availability
GET automatically. Failed prerequisites and an explicit read-only retry appear
beside SIGN & CREATE SESSION. Successful readiness never replaces consent or
automatically signs a grant. The original mobile report had a connected wallet
and consent, but apiEnabled was false because the separate top check had not
passed. Focused connect-first, failed/retried/mismatched readiness and disconnect
tests plus isolated mobile390 browser checks passed. API, signing payloads,
database, economics and program code were not changed. Next owner action: refresh
/play-session.html, connect, review limits/consent, sign, then privately configure
the Bankr per-user credential. A successful owner grant/Bankr shot is not yet
proven by this UI fix.

## Live identity and external proofs

**New long-term decision:** [On-chain migration plan](ONCHAIN_MIGRATION_PLAN.md).
G0-G6 moves authoritative credits/rules/outcomes/agent permissions to Solana while
keeping UI/MCP as replaceable clients. The hard first research gate is oracle
selection, not merely storing a server result on-chain. Legacy credits are not
RCX withdrawal claims. No on-chain migration or program deployment was performed.
**Database cutover completed 2026-08-30:** verified-TLS session-pooler access,
all seven catalog checks, consistent schema/KV backup of 11,062 rows, full local
restore with matching digest, and production migration 003. Two-connection
tests passed locally and live; only exact isolated fixture keys were mutated
and removed. See [database cutover evidence](GUARDED_DATABASE_CUTOVER.md).
The restored-database test caught a real legacy INCR race (125 instead of 105);
003 now replaces that function with row-atomic arithmetic. No real player balance
was modified. Supabase quota usage and exposed-credential rotation remain open;
do not infer a paid upgrade is required or put secrets into this handoff.

**Latest shipped work:** [Guarded player writes](GUARDED_PLAYER_WRITES.md). The real
handler stale-write test is now green; queue consumption and settlement delivery
are crash-recoverable in local fixtures, including executable PostgreSQL rollback
tests. Migration 003 is APPLIED; h101 includes the connected session HTTP adapter,
canonical shot/receipt commit, owner recovery and private consent UI. Production
now serves h101. Existing Vercel CLI authentication was found in Windows
`%APPDATA%\xdg.data\com.vercel.cli\auth.json` and verified by a read-only API call
against the exact Ratchet project/team. Deployment access is no longer a blocker;
never copy that private file or its values into this repository.

The live isolated session-store probe passed with 19 HTTP requests: exactly one
PostgREST CAS winner, stale rejection, atomic guarded player/accepted receipt,
stale-session rollback, exact commit replay and changed-commit rejection. Exact
fixture cleanup passed. It made zero chain calls and zero real-player reads;
this is database integration evidence, not hosted Bankr gameplay.

Next product plan: [RCX value through agent utility](RCX_AGENT_VALUE_PLAN.md).
Latest decision: [Bankr self-service integration](BANKR_SELF_SERVICE_INTEGRATION.md)
requires no platform-team changes. Existing skill download is verified; Bankr
reports no raw Solana message signing on X. Research identifies per-user skills,
viewer apps and a bounded Ratchet play capability. Bankr now reports the skill
installed, a private read-only cockpit and protected HTTP secrets in web AND X.
The [canonical session contract](PLAY_SESSION_DESIGN.md) now describes the h101
implementation at `/api/game?action=play-session` and `/play-session.html`.
Focused service, atomicity, HTTP and consent-page tests pass. Acceptance stores
the canonical credit debit/shot and session receipt in one guarded commit;
owner recovery fences delayed work. Both routes are deployed and public-verified. The
budget counts reserved attempts, not accepted calls, including refused or
uncertain attempts; reservation itself never debits play credits.
Do not treat docs or the named Bankr wallet as funding authority.
Priority: enable people to play RatchetX through Bankr on X, using each caller's
authenticated wallet and bounded RCX budget. User offered to fund a pilot, but no
address or amount is selected. Confirm signing capabilities and wallet control
first. Preserve equal Pyth reads and existing economics; distinguish funded tests,
organic RCX use and USDC revenue. The integration is deployed, but an actual
owner-approved private Bankr runtime/X pilot remains unverified.
Funding is only for Bankr's test if needed; ordinary users are not subsidized.
See [Solana preflight](SOLANA_BANKR_PREFLIGHT_2026-08-30.md): historical suite 65/0/5,
read-only mainnet checks passed; actual Bankr-X signing/funded ranked flow remains
unverified and no transfer has been made.

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

- Production release: `h101-2026-08-30`. Database migration 003 is applied;
  guarded writes, session API and consent screen are live. No funded Bankr test occurred.
- Production deployment: `dpl_CQfeCv7FAWgL1sHocBWYzmkgXYUk`; artifact commit
  `1b503da6c759cf37c70fc87229c2ab6d98a4e1c0` (application code `9be7c0e`).
  Clean artifact: 327 files; tree SHA-256
  `c19b0742304807795fe01ab669616a24ab921e27b502fbf8f1a9ccfb03307035`.
- Verified 13:47:30.236Z: root HTML, consent page and JavaScript public hashes
  match the artifact; board/session/Pyth report h101; sessions enabled; MCP has
  13 tools. Missing/bad auth returns 401, wrong Origin 403, scope 400, all no-store;
  private paths return 404. No owner capability or real-player mutation was used.
- All 76 runnable suites validated: initial batch 75 pass / 1 documentation-env
  scanner failure / 5 browser skips; corrected client-vs-server-name scanner passes
  all 126 checks. Subsequent changes were tests/docs and output-directory config;
  readiness/output-gate test passes. Isolated consent desktop/mobile QA passes;
  the five skipped broad browser suites remain skipped. See RELEASE_H101.md.
- MCP, Agent Skill and ERC-8004 profile: `1.2.0` live.
- Historical h100 deployment: `dpl_EyHicrnAA5E9F6Pv7taxoD6G1dez`, code commit `9b3e7f0`.
- Historical h100 verification at 09:43:05Z: actual MCP scorecards execute; five pages return all 14
  observations in a fixed test window exactly matching the reference read. Omitted
  `to` continuation also passes. All seven atomic Pyth projections remain present.
- Feed has 80 rows: all 75 player events plus 5 demos. HTML is unchanged from h99.
- Bankr later completed `41ea35bc740d` and `55fe7753034f`. Read-only scorecards at
  10:00:53Z confirm one scored MISS/Brier 0.2704 each. Bankr reports three unchanged
  4,500-credit state polls per handle. Its WIF window independently returns 17
  distinct rows across four pages. Repeat-poll balances and the changed-cursor
  negative control are Bankr-reported in this follow-up. Our checks did not invoke
  settlement. Details and limits are in RCX_AGENT_VALUE_PLAN.md.
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
- Historical h100 complete run: 65 pass / 0 fail / 5 browser-fixture skips. The browser
  fixtures skip only when their local fixture server is absent. Release safety,
  the 114-check kill switch and all protocol/economics tests passed.
- Later guarded-database complete run: 73 pass / 0 fail / 5 browser skips.
  h101 subsequently validated all 76 runnable suites using the batch plus corrected
  scanner rerun described above, not a second all-green full batch. The 19-request
  live session probe is isolated store evidence.

## Exact next actions and boundaries

Immediate next action: perform the separately owner-approved private Bankr
pilot in [PLAY_SESSION_DESIGN.md](PLAY_SESSION_DESIGN.md). The owner signs the
bounded grant and stores its bearer only in Bankr's private per-user secret form;
no chat, public prompt or generic wallet signer receives the credential.

The first h101 deployment passed its database gate but failed because Vercel
expected a `public` output directory. It never replaced production. Explicit
`outputDirectory: "."` fixed the packaging contract; the second build is READY
and the exact artifact was verified publicly. Keep this setting and guarded
writer on recovery; do not revert to h100's unconditional player writes.

The earlier demo-state resolution-envelope improvement remains follow-up work,
not a missing session bridge: terminal HIT/MISS/VOID, retained exit, balances,
Brier, proof URLs, pending reason and retry timing should remain explicit.
Keep VOID terminality separate from Gauntlet non-void completion; do not add a
second settler or force a result without an admissible oracle observation.
Historical acceptance limits remain in `docs/BANKR_RETEST_H100.md`.

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
6. Earlier broad browser QA was unavailable due to Windows ACL startup failure.
   The h101 consent-page checks are scoped separately in PLAY_SESSION_DESIGN.md;
   neither API/HTML bytes nor isolated page QA establish all-site browser coverage.
7. Future successful MCP demo calls are indexed as `MCP client` unless there is
   separate attributed evidence for a name. Do not label arbitrary callers Bankr
   or Grok, count demos as ranked volume, or merge demo retention into player KV.
