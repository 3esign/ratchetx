# RatchetX agent roadmap — proverljiva ekonomija, ne broj integracija

Updated: 2026-08-30. This file is the canonical long-term plan. `docs/AGENT_STATE.json`
is the machine-readable version contract; `docs/AGENT_HANDOFF.md` is the live work handoff.

Latest checkpoint: h103 is deployed; h104 cross-device owner management is the
candidate described in RELEASE_H104.md. The one-owner Bankr acceptance pilot has
completed (evidence in RELEASE_H103.md); user reports all grants revoked.
Historical h101 pilot prerequisites below must not trigger another live run.
Next product acceptance is independent-user onboarding with separate authority,
not repeated spending on the owner's account. Credential rotation/quota closure
remain operator backlog; no second-user or global-X availability claim is made.

Long-term architecture decision (2026-08-30): migrate all authoritative game and
economic state to Solana. [On-chain migration plan](ONCHAIN_MIGRATION_PLAN.md)
defines G0-G6, legacy credit preservation, oracle-selection gates, chain-enforced
agent permissions and a server-off acceptance drill. This is a plan, not a change
to today's canonical settlement or a funded deployment authorization.

Next utility/adoption epic: [RCX value through agent utility](RCX_AGENT_VALUE_PLAN.md).
It orders result-contract closure, wallet/registration/reload onboarding, funded
multi-user play through Bankr on X, an Agent League, and repeat RCX use before new
service fees. These are plans, not deployed tools or changes to frozen economics.

**Immediate Bankr safety gate:** [PLAY_SESSION_DESIGN.md](PLAY_SESSION_DESIGN.md).
Bankr reports protected secret transport in web and X. The deployed h101 release now
implements owner-signed grants, `/api/game?action=play-session`, private consent
at `/play-session.html`, atomic canonical debit/shot/session receipts and fenced
owner recovery. Production was public-verified at 2026-08-30T13:47:30.236Z;
the session API is enabled. See [RELEASE_H101.md](RELEASE_H101.md).
[Guarded writes](GUARDED_PLAYER_WRITES.md) and migration 003 are complete with a
restore-verified backup and passing live concurrency tests. The live isolated
session probe also passes: 19 HTTP requests, exact CAS/atomicity/replay checks and
cleanup, zero real-player reads or chain calls
([evidence](GUARDED_DATABASE_CUTOVER.md)). Remaining acceptance is an
owner-approved actual private Bankr runtime/X pilot.
The green fixture and database probe do not prove hosted Bankr secret isolation.

## North star and non-negotiable boundaries

RatchetX should be the place where an agent earns a public forecasting record by
making probability-bearing calls against the same live board, stake rules, Pyth
evidence and settlement code as every other player.

- The human and agent core loop stays one loop. No privileged agent settlement path.
- Pyth publishes once, Ratchet validates/captures once, and every agent reads the
  same shared PriceUpdateV2 snapshot and bounded observed path. A reader must not
  create a fresh oracle request or receive privileged data.
- Oracle reading and ranked economics are separate: reading consumes no RCX.
  Existing play credits are deducted only after a fresh valid seal; VOID refunds
  them. RCX remains the ranked reload rail, not a per-read or per-shot transfer.
- Free Gauntlet remains wallet-free, token-free and reward-free.
- Ranked x402 entry is 0.01 USDC and 100% goes to the quoted daily champion.
  RatchetX takes 0% of entry.
- The separate premium proof bundle costs 0.01 USDC to the proof-service receiver
  declared in the quote. It must be completely prepared before payment can move.
- Public board, record, report cards, MCP and ordinary proof remain free.
- Canonical credits/XP settlement remains `ratchet-server`. The keyless audit
  verifier checks the sealed commitment, full Ratchet hash chain, retained
  validated Pyth PriceUpdateV2 observation and outcome, but cannot prove that
  the server captured every earlier admissible transition. Keep
  `independentPythReplay: false` until a new on-chain program actually closes that gap.
- Frozen Ratchet Seal v2 source never changes. Any v3 work gets a new directory,
  program ID, threat model and deployment transcript.
- Do not publish an A2A Agent Card until a conforming task runtime, persistence,
  authentication, cancellation and conformance test exist.

## Verified production baseline

- Production release marker: `h101-2026-08-30`, public-verified at
  2026-08-30T13:47:30.236Z. Deployment `dpl_CQfeCv7FAWgL1sHocBWYzmkgXYUk`;
  artifact commit `1b503da6c759cf37c70fc87229c2ab6d98a4e1c0`.
  Root HTML/consent-page/JavaScript hashes match; board/session/Pyth report h101.
  Private auth/origin/scope guards and private-path 404 canaries pass.
- MCP/Agent Skill/ERC-8004 surfaces: `1.2.0`, checked bidirectionally; the
  official MCP Registry lists `io.github.3esign/ratchet@1.2.0` as latest.
- MCP advertises 13 tools in Pyth-first order. `ratchet_pyth_context` exposes
  shared price, confidence, EMA, cadence and slots; `ratchet_pyth_path` exposes
  a bounded retained observation path. Both stop before `getPrices()`.
- Solana Agent Registry: asset `Auj5yXbsaeQUJpYpSRugkgRE3ABc76uqmUe3Vz7fxqCu`,
  indexer Agent ID 1475.
- External Gauntlet proof: Bankr handles `009d2bf7f3be` and `301e30592c97`.
- Remote ranked protocol: domain/network/action-bound Ed25519 request, 120-second
  nonce TTL, exact-body verification and idempotent replay.
- Invite funnel: 128-bit IDs, hashed durable storage, exact 30-day TTL, demo
  attribution and idempotent milestone counts.
- Premium proof: invalid/unsettled/divergent requests stop before facilitator;
  a valid quote is bound to a canonical request digest; paid replay returns the
  same deterministic bundle without a second settlement.
- Durable AgentRun receipts live in KV, content-digested by shot ID. No local
  serverless filesystem is treated as evidence.
- Deployable API functions: 12. Agent report and proof bundle retain their public
  URLs through rewrites into `api/game.js`; the fake A2A surface is removed.
- Release gate pins the restored v2 source SHA-256 and rejects tracked secret,
  private-key and investigation-artifact patterns.

## Immediate next acceptance task — private Bankr pilot

The exact-artifact h101 deployment and public readback are complete. Follow the
owner-signature/private-secret/pilot gates in
[PLAY_SESSION_DESIGN.md](PLAY_SESSION_DESIGN.md). Existing Vercel authentication
was found under Windows `%APPDATA%\xdg.data\com.vercel.cli\auth.json` and its exact
Ratchet project/team access was verified read-only. No new credential is needed
for routine deployment; do not export the private session file.

All 76 runnable h101 suites are validated: the initial batch was 75 pass / one
documentation-env scanner failure / five browser skips; the corrected
client-vs-server-name scanner then passed 126 checks. This was not a second full
batch. Readiness/output-gate tests and isolated consent desktop/mobile QA pass;
five broad browser tests remain skipped. The actual Bankr pilot still requires
owner consent and a protected per-user bearer, not a public prompt or implied
funding authority. Full evidence is in RELEASE_H101.md.

## Historical h100 resolution evidence and follow-up

h100 repaired two real integration breaks: MCP scorecard import drift and a moving
default `to` invalidating path cursors. Full tests: 65/0/5 browser skips. Exact
release controls and remaining limits are in `BANKR_RETEST_H100.md`.

Follow-up: expose one predictable per-shot result through the existing demo-state flow:
identity/target, pending or terminal state, retry timing, retained exit evidence,
credit balance, Brier and proof URLs. The current route already invokes canonical
settlement after expiry; a second worker or long-held request is not required to
repair its response contract. Acceptance must cover HIT, MISS, pending inside the
grace window, VOID/refund outside it, and idempotent repeat polls. VOID ends a shot
but does not complete the Gauntlet's non-void objective. Do not assume every
post-expiry request can immediately finalize without a valid oracle observation.

The release check found `41ea35bc740d` and `55fe7753034f` still unscored; Bankr
subsequently completed both and reports stable three-poll replay checks. Read-only
scorecards at 10:00:53Z confirm one scored MISS/Brier 0.2704 each. Its WIF window
independently returns 17 rows across four fixed-bound pages. See
RCX_AGENT_VALUE_PLAN.md for evidence boundaries. Winning-payout replay, VOID
refunds and a live confidence-expansion event are not established by these runs.

## Phase A — production convergence and security closure (now)

1. Rotate the Supabase/Postgres credential that appeared in Git history. Deleting
   the file from the tip does not un-leak a password. Update the production secret
   atomically and prove state reads/writes before revoking the old credential.
2. h101 regression/preflight evidence is complete as recorded above; preserve it.
3. h101 deployment and public readback are complete. The first build's missing
   `public` output-directory failure left old production intact; explicit
   `outputDirectory: "."` produced the verified READY build. Preserve this
   packaging contract and guarded writer during recovery, not an h100 rollback.
4. Continuing live contract and pilot acceptance checks (historical funded flows
   are not automatically re-executed by a release smoke):
   - MCP initialize and `tools/list` return `1.2.0` and all 13 tools;
   - both Pyth tools return Pyth attribution and `requestTriggeredOracleRead:false`;
   - a ranked seal records its exact Pyth snapshot hash, stale refusal debits
     nothing, and settlement VOID refunds the full credit stake;
   - invite TTL and ranked prepare/submit succeed through the remote endpoint;
   - invalid premium request produces 4xx without a facilitator settlement;
   - valid premium request produces 402 with the correct resource URL and digest binding;
   - `/api/agent?id=...` reports durable receipt provenance;
   - `/api/a2a/*` is absent rather than pretending conformance;
   - state, proof, record, feeds, x402 entry and Gauntlet stay healthy.
   - the session route and consent page report deployed h101; private
     auth/origin/scope errors stay no-store, and no new MCP tool/function is added.
   - an owner-approved private Bankr pilot proves one accepted intent, identical
     replay without a second debit, terminal status and revoked new-authority refusal.

Acceptance: one production release, 12 or fewer functions, no credential pattern
in tracked files, funded entry smoke still passes, and no core economy number changes.

## Phase B — adoption instrumentation and calibration UI

Build the first dashboard from values already produced by the game; do not invent
an on-chain `Calibration` PDA or claim a v3 program exists.

Status on 2026-08-29: the shareable `/agents?id=<wallet-or-handle>` profile is live
in h94 with canonical stated-call/ranking counts, Brier, skill versus the 0.25
coin-flip baseline, void rate, 10-bin curve and latest receipt. Remaining Phase B
work is row-level aggregate links, horizon distribution and the funnel dashboard.

- Agent profile: identity provenance, stated-call count, Brier, Brier Index,
  10-bin reliability curve, recent feed/horizon distribution, void rate and latest
  durable AgentRun digest.
- Every displayed aggregate links to the rows/receipts that produced it.
- Funnel dashboard: invite issued → demo created → shot sealed → settlement scored
  → Gauntlet complete → ranked prepare → ranked submit → paid proof request.
- Distinguish attempts, unique invite hashes, unique registered wallets and settled
  calls. Never call handles or requests “unique agents”.

Acceptance: UI fixture tests connect each displayed number to seeded canonical data;
empty/provisional states are explicit; production metrics can be recomputed from KV.

## Phase C — plug-and-play client SDKs

Ship the smallest useful clients in this order:

1. TypeScript `@ratchetx/agent-client`: MCP discovery, invite/demo flow, ranked
   prepare/sign/submit, report-card reads and standard x402 proof purchase.
2. Python `ratchetx-agent`: the same protocol vectors and canonical payload bytes.
3. Thin adapters for LangChain, ElizaOS and other active frameworks only after the
   framework's current plugin format is researched and exercised end to end.

Both clients must share published golden vectors for canonical JSON, request digest,
Ed25519 payload, x402 resource binding and replay. A README snippet is not an SDK gate.

Acceptance: a fresh external process completes Gauntlet, submits one ranked shot,
reads its report and can purchase one bounded proof without importing repository code.

## Phase D — distribution loops that agents can actually discover

- Keep domain discovery (`llms.txt`, MCP, Agent Skill, ERC-8004, OpenAPI, AI catalog)
  internally linked and live-tested after every release.
- Issue invite IDs through MCP and expose attribution-safe progress, so an agent can
  invite another agent without a human dashboard.
- Publish reproducible challenge prompts that ask external agents to choose a live
  target and state `p`, then link the settled proof and report-card change.
- Target builders and framework maintainers with a runnable client example and one
  evidence-backed request, not mass mentions.
- Measure return rate and settled stated calls; impressions are secondary.

Acceptance: at least three independent implementations complete the flow without
operator repair, and all failed steps have a machine-readable next action.

## Phase E — genuine A2A and marketplace work

Research current A2A conformance before implementation. Required minimum:
standard Agent Card, task lifecycle, durable idempotent task IDs, input validation,
authenticated ranked actions, status polling/streaming, cancellation, artifacts and
conformance tests. Route A2A tasks into the same Gauntlet/ranked services; never create
a second economy or unsigned game shortcut.

Acceptance: official/current conformance suite passes and two unrelated clients can
complete and resume a task. Only then add the Agent Card to discovery.

## Phase F — new on-chain settlement generation

Expanded into [ONCHAIN_MIGRATION_PLAN.md](ONCHAIN_MIGRATION_PLAN.md), covering the
whole authoritative product, not just an optional settlement receipt. Research and
the no-funds oracle attack harness can start now; canonical migration cannot bypass
core safety, the separate v2 freeze commitment or the new generation's review gates.

After the v2 freeze, design v3 as a new program. Threat-model exact Pyth account
ownership, feed IDs, confidence, first-crossing semantics, clock/checkpoint liveness,
replay, rent cleanup and dual-read migration. Test on devnet/isolated mainnet accounts
before any canonical cutover. Off-chain records must carry the program generation and
rule version so v2 and v3 calls can never be silently reinterpreted.

Acceptance: reproducible build, independent review, soak report, new program ID,
mainnet smoke and explicit migration gate. Until then the product says v3 is planned,
not deployed.

## Release order for every phase

Core-loop regression → protocol golden vectors → funded/idempotent smoke → discovery
consistency → preview deploy → live read-only checks → bounded live mutation → release
marker verification → handoff update. If a number cannot be traced to a source row,
receipt, on-chain transaction or deterministic rule, it does not ship.
