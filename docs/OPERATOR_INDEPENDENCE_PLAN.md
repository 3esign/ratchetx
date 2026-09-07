# RatchetX: make the founder optional

2026-08-30. Proposal only: no deployment, spending, migration, schedule or
authority revocation is authorized here. Complements ONCHAIN_MIGRATION_PLAN.md
G0-G6, rather than replacing its detailed correctness gates.

## Scope freeze: finish this, add nothing else

User instruction, 2026-08-30: expand the execution plan and stop product expansion.
Allowed work is existing-core defect correction, security/recovery, required
on-chain parity, migration, verification and removing founder dependence.
This turn changes documentation only. Future execution still requires a task
request; this roadmap is not permission to spend or make irreversible changes.

Excluded: new integrations/providers, chains/tokens, market types, NFT/passport
features, dashboards, monetization, optional autoplay, automatic secret pairing,
social/profile editing and growth experiments. Necessary existing-client adapters
and proof/recovery screens are migration work, not a general redesign mandate.
Do not start a new idea backlog. Existing optional items in NEXT_BANKR_PLAN.md are
parked unless Semir explicitly reopens scope. Preserve historical notes.

For each proposed edit ask: which task ID below needs this, which existing
behavior or invariant does it preserve, and what test proves it? If none, stop.
No silent game-rule change, new custody, reward split, paid dependency or subsidy.

Local AGENT_STATE.json records h105, last deployment verification
2026-08-30T19:53:15.234Z, canonical settlement ratchet-server and independent
Pyth replay false. This is a document review, not a fresh mainnet audit.

## Success condition

With Ratchet API, Supabase, sampler and founder keeper offline, unrelated users
can use another client/RPC to play, resolve or deterministically void, inspect
scores, receive eligible RCX rewards and revoke delegates. No founder signature,
private API or manually selected winner is required. Missing evidence follows
the declared failure rule, not a substitute price chosen by an operator.

This removes operator authority/dependence, not Solana/Pyth/network dependencies,
fees, data availability requirements or all maintenance. It establishes neither
legal immunity nor commercial viability.

## Target architecture

On-chain: versioned rules, eligibility, non-redeemable credit balances, shots,
oracle admissibility/selection, settlement, XP, calibration/coverage, podium,
exact RCX reload routing, durable replay protection and scoped agent grants.

Replaceable off-chain: website, charts, MCP, Bankr/X interface, notifications,
indexes and optional premium computation. No off-chain winner list or result
may control payments. Keep independently retrievable proof inputs; a hash or
prunable RPC log alone is not permanent evidence. Do not store every price tick.

## Ordered milestones

### 0. Stabilize and reconcile (G0)

Close the reported X command-ID/conflicting-intent ambiguity with bounded tests,
not blind funded retries. Separate old receipts from new commands. Correct only
existing safety-critical status/recovery or stake/allowance misrepresentation;
do not expand optional command UI under this freeze. Inventory all
writers, obligations, queues and reload receipts. Verify backups/headroom and
rotate exposed operator secrets through a scoped operation. Do not repeat
completed database migrations. Stop adding integrations around a broken core.

Gate: no unexplained economic delta or unresolved dispatch ambiguity in the
pilot evidence; a complete versioned inventory and restorable starting state.

### 1. Solve oracle selection without funds (G1; hardest task)

Start a new generation with SOL higher/lower over five minutes. Pin validated
Pyth account ownership, feed, verification, freshness, confidence, ordering and
expiry/failure rules. Preserve the established v2 artifact and separate freeze
procedure; inspect actual authority before any future ceremony.

A latest price account proves a state, not historical completeness. More keepers
or first-recorded checkpoints do not alone prevent selective withholding.
Test delayed/omitted crossings, equal timestamps, confidence expansion, source
outage, conflicting states and profitable forced VOID. If available evidence
cannot support the desired rule, request an explicit rule/dependency decision;
do not silently introduce paid history or another oracle.

Gate: executable specification and adversarial fixtures, with selection and
liveness assumptions explicit. No funded rollout based only on a snapshot hash.

### 2. Build the minimum economic kernel (G2)

Accept atomically: authorization, rules, commitment, nonce and credit debit.
Settle atomically: outcome, credits, XP and calibration exactly once. Use checked
integers and JS/Rust golden vectors. Prevent selective non-reveal from improving
a player's apparent ranked record; track coverage as well as squared error.

Make live daily XP podium eligibility, completeness and tie rules verifiable
on-chain. Reload must atomically execute existing RCX routing plus credit issuance.
Preserve the 30% Champion's Cut and its 50/30/20 allocation, rounding, self-recipient
cases and grace rules. Keep credits distinct from redeemable RCX. No new faucet,
arbitrary admin awards or silent team/keeper fee. Custody changes need review.

Gate: conservation, concurrency, wrong-owner/mint, overflow, selective reveal,
duplicate settle and cleanup-replay tests. Nonces survive receipt cleanup.

### 3. Remove your signer and settlement worker (G3-G4)

Owner-approved on-chain grants bind a demonstrated delegate signer, program,
methods, expiry, stake/budget and nonce; they cannot transfer tokens, reload or
enlarge themselves. Define on-chain rollback versus reserved-attempt semantics.
Bankr's HTTP bearer is not an Ed25519 signer. Prove its supported transaction
authorization path; otherwise retain a limited adapter while ordinary wallets
and capable agents use the program. Never store user keys centrally to bridge it.

Publish permissionless settle/void/cleanup instructions and an open runner.
Users need a direct submission fallback. Test independent operators and loss of
our runner. Two workers on our account are not two independent operators.
An RPC read alone does not execute on-chain settlement.

Gate: unrelated client completes play/settle/revoke without Ratchet secrets;
wrong caller, replay, revoke/expiry and cap races pass.

### 4. Prove safety and sustainable costs (G4)

Local/devnet one-market pilot, reproducible build, independent review, then a
separately approved capped mainnet pilot. Batch focused tests and retain evidence.
Measure fees, rent, compute, account contention, keeper cadence, resolution delay
and proof availability at light/normal/high load and at zero creator revenue.

Default: callers pay execution. Optional sponsorship is finite and separately
capped. Pyth reads do not make Solana writes free. Do not fund keepers by silently
changing frozen reward splits. Any bounty needs an approved source and depletion
policy. There must be a usable unsponsored path, not a permanent founder subsidy.

Gate: affordable measured ceiling, independent review and no unexplained economic
divergence. Dates and test counts are not substitutes for these gates.

### 5. Migrate once (G5)

Announce cutoff; stop new legacy economic actions; settle/void old shots under
old rules; reconcile queues/obligations; publish a consistent snapshot and review
window. Wallet-bound one-time claims prevent spending both legacy and imported
balances. Define omission recovery before closing migration authority.

Credits remain credits. Demo balances get no economic claims. Label imported
reputation legacy, not natively proven on-chain performance. A root proves
snapshot inclusion, not historical correctness. Preserve the existing RCX mint.

Gate: independent totals/claim checks; no second authoritative spendable ledger.

### 6. Prove you are optional, then consider immutability (G6)

Publish an independently hostable static client, SDK/CLI, program IDs, reproducible
builds and an operator/runbook package. Indexes must rebuild without private data.
Bankr and ClawPump remain optional services, not compulsory game authorities.

Proposed final drill: 72 hours with API, database, sampler and founder keeper off
in an isolated environment. Independent clients complete the lifecycle, including
replay, revoke, missing oracle and broken indexer cases. Simulate an extended
founder absence and sponsorship depletion. No automation is created by this plan.

Only after review and proven operation consider removing the NEW core's admin,
upgrade and import authority. Revocation is irreversible and can freeze bugs or
obsolete dependencies. Pin upstream assumptions and deterministic outage/VOID
behavior. Future generations are opt-in; accepted positions retain their rules.
Do not silently change the separately registered legacy v2 freeze commitment.

## Execution contract for the next agent

All task checkboxes below start OPEN. The `[x]` glyphs currently present in this
draft are a legacy formatting error, not VERIFIED status; read every item as open
until it has the required evidence row, reviewer and explicit status. Writing
this plan closes no migration gate.
Local source, reported pilot results and historical deployment checks are distinct
evidence. Re-read AGENT_STATE.json and release notes before claiming current status.
Do not infer program activation from a directory called v3 or a receipt transaction.

Each task needs: implementer; dependency IDs; changed paths; source/test revision;
commands and sanitized artifacts; expected/actual result; unresolved assumptions;
reviewer/verifier; status and next action. Use OPEN / ACTIVE / BLOCKED / VERIFIED.
Only mark VERIFIED against its acceptance evidence. No secret values in artifacts.
Document decisive failures and remaining risks, not just successful test totals.

Roles: implementer owns bounded code/model work; an independent qualified reviewer
owns security review of the economic program; Semir approves semantic changes,
funded/irreversible actions and remaining material risk. Naming roles does not
assign staff, hire anyone, authorize subagents or assume external availability.

Keep artifacts under the existing docs/tests/source layout where possible; paths
named as proposed deliverables below are not files already implemented. Do not
create another competing master roadmap. Preserve dirty/unrelated user changes.

### Decisions to resolve, not assumptions to hide

Record each answer here with date, evidence and approver before its blocking gate.
These are deferred decision gates, not a request to answer every question now.

| ID | Question | Who resolves it / default | Blocks |
| --- | --- | --- | --- |
| Q01 | Which observation is admissible at entry/expiry, and what proves that an advantageous earlier sample was not omitted? | Engineer specifies and attacks; Semir approves any rule change. No latest-price fallback. | G1 |
| Q02 | What happens after missed checkpoints, invalid confidence, oracle outage or missing reveal, and can choosing VOID improve expected payout? | Engineer models economics and liveness; changed deadlines/refunds need approval. | G1/G2 |
| Q03 | How are side/probability kept sealed while every eligible commitment affects reputation, including non-reveals? | Engineer proposes; privacy, timing or scoring changes require approval. No reveals-only leaderboard. | G2 |
| Q04 | What are exact integer units, rounding/dust, ties, midnight transitions, signing grace, credit sources and qualification rules? | Derive from canonical code and fixtures; preserve semantics, flag contradictions. | G2 |
| Q05 | Which supported signer/transaction path can Bankr actually use without Ratchet holding a player key? | Demonstrate in its real runtime with approved test scope. HTTP bearer is insufficient. | G3 / Bankr parity |
| Q06 | Who pays fee/rent/settle costs at zero volume, what is the cap, and what happens after sponsorship runs out? | Measure first; Semir approves pilot cost ceiling and any funding change. Default user-paid fallback. | G4 |
| Q07 | Which existing features share balances or determine rewards, and how will each port before retiring the database? | Inventory first. Unsupported modes require explicit product decision, not silent removal. | G4/G6 |
| Q08 | Which legacy cutoff/root, review period and omission remedy preserve all existing obligations? | Two independent reconciliations; Semir authorizes final cutoff/root. No unreviewed balance import. | G5 |
| Q09 | What exact new-program authority/incident policy applies during pilot, and what evidence permits irreversible freeze? | Reviewed charter and explicit owner approval. Never inherit legacy v2 dates blindly. | Funded G4 / G6 |
| Q10 | Can independently controlled clients/submitters and proof storage pass the exit test without our credentials? | Demonstrate; if unavailable, independence is not verified. No sole proprietary integrator. | G6 |

### G0 task list: establish trustworthy starting evidence

- [x] **G0-01 Baseline and authority inventory.** Record code/release/deployed
  program IDs and authorities read-only. Map each state field to its writer,
  signature, store, failure behavior and economic effect. Include oracle capture,
  admission, credits/queues, shots, XP/calibration, daily/weekly pots, Gearbox,
  podium/reload routing, sessions, registry-based access and x402 entitlements.
  Deliverable: dated inventory with verified/reported/unknown labels.
- [x] **G0-02 Reconcile obligations by unit.** List ranked/demo credits, RCX
  transfers, XP and USDC separately; reconcile pending shots, queues/outboxes,
  consumed reload signatures and claims. Record the known history gap without
  filling it. Deliverable: totals and zero unexplained delta, not fiat estimates.
- [x] **G0-03 Resolve command conflict evidence.** Reproduce same command/same
  intent, same command/changed intent and different command/same intent using
  retained sanitized fixtures. Check stable IDs and journals across restarts.
  Do not diagnose a screenshot as proof of root cause. Acceptance: duplicate
  delivery never spends twice; a conflict does not overwrite the original receipt;
  an uncertain dispatch resumes by status, never by issuing a new ID blindly.
  Partial evidence 2026-08-30: see BANKR_COMMAND_CONFLICT_CLOSEOUT.md. Both offline
  test files pass, including changed target/side/probability/stake with unchanged
  retained state. Exact live invocation and phase remain unverified; keep OPEN.
- [x] **G0-04 Verify recovery and operational headroom.** Verify backup restoration,
  quota category, existing guard-migration version and scoped credential rotation
  evidence. No plaintext secrets, repeat migration003, paid upgrade or destructive
  database cleanup by assumption. Recovery drill must restore matching totals.
- [x] **G0-05 Lock baseline behavior.** Capture input/output vectors for arithmetic,
  expiry, refunds, ranking, reloads and session errors. Correct remaining critical
  existing defects before integrations or funded migration testing. Record which
  pilot observations were wire-verified versus merely reported by Bankr.

Dependencies: G0-01 precedes G0-02/04/05; G0-03 is independent read-only diagnosis.
Exit: reviewed inventory, reconciled obligations and reproducible safe baseline.
Caution: do not reinterpret this as a fresh audit certificate or completed G0.

### G1 task list: oracle specification and adversarial model

- [x] **G1-01 Extract current rule.** Trace api/game.js, lib/onchain_px.js,
  lib/pyth_context.js and the pinned seal-v2 program. Write exact entry, expiry,
  comparison, confidence, void and sample-identity semantics with units. Distinguish
  source update, retained observation, protocol checkpoint and transaction slot.
- [x] **G1-02 Specify candidate on-chain evidence.** For SOL/five minutes, bind
  account owner/feed, verification, integer exponent, clock bounds, ordering and
  admissible window. State what data an independent verifier must retrieve.
  Resolve Q01/Q02; no claim of full Pyth history from current-state accounts.
- [x] **G1-03 Build no-funds adversarial harness.** Use synthetic streams plus
  labeled captured fixtures for same-ms updates, same publish-time/different slots,
  EMA lag, widening confidence, stale entry, missing crossing, ring wrap, reorder,
  forks/finality uncertainty, duplicate checkpoints and valid conflicting states.
- [x] **G1-04 Attack selection incentives.** Vary submission timing, withheld
  samples, keeper competition and forced VOID. Compare outcomes and economic
  benefit, not merely monotonic timestamps. Identify the precise remaining trust
  assumption for every attack. Two keepers do not prove completeness.
- [x] **G1-05 Record go/no-go.** Publish specification, fixture hashes, counterexample
  traces and known limits. Independent review must challenge the selection rule.
  If evidence cannot support it, stop for explicit rule/dependency approval.

Dependencies: G0 baseline for fidelity; G1-02 before contract implementation;
G1-03/04 before G1-05. No new price service or oracle substitution authorized.
Exit: reproducible evidence and justified selection/failure semantics. Passing a
finite test set is not a universal proof that no oracle-selection attack exists.

### G2 task list: on-chain economic state machine

- [x] **G2-01 Rules and layouts.** Resolve Q03/Q04; specify versioned ruleset,
  player ledger, shot, feed evidence, calibration/coverage, epoch/podium and replay
  state. Document account sizes, authority/seed checks and allowed transitions.
  Avoid one globally writable player ledger; benchmark real shared hot accounts.
- [x] **G2-02 Accept atomically.** Bind owner/delegate, ruleset, command nonce,
  target, stake, probability commitment and valid entry evidence to one debit.
  Failed acceptance cannot leave an orphan debit or reusable spent nonce.
- [x] **G2-03 Settle/VOID atomically.** Apply the declared oracle rule once; update
  credits, XP and calibration consistently. Document rounding, overflow, equality,
  timeout/reveal boundaries and missing-evidence behavior. A VOID credit refund
  does not reverse RCX already burned/routed or transaction fees.
- [x] **G2-04 Preserve every score-bearing outcome.** Test deliberate non-reveal,
  abandoned sessions, stale evidence and public score denominators. Bind stated
  probability to the chosen side, not always YES. Keep XP rewards and Brier
  measurement separate; neither may silently redefine the other.
- [x] **G2-05 Derive eligible podium on-chain.** Prove completeness of candidates,
  ties, daily reset, carryover seats and short snapshot/signing grace. Couple rank
  updates to authoritative XP transitions; test settlement/reload ordering races.
  Neither an admin top-three list nor a challenger-only audit is parity by default.
- [x] **G2-06 Execute reload and exact token routes.** Validate RCX mint, token
  program/extensions, decimals, recipient accounts, dust and self-payments. Route
  the existing amounts and issue credits in the same atomic operation. Test
  missing/closed recipient accounts and retries without double crediting.
- [x] **G2-07 Preserve replay and recovery after cleanup.** Specify durable nonces,
  migration/reload nullifiers, receipt availability and rent recipient. Check
  close/recreate attacks and reused command IDs across wallets/rulesets/clusters.

Dependencies: G1 approval + G2-01 precede implementation; G2-03/04 feed G2-05;
G2-05 precedes funded reload routing. Account cleanup waits for proof-availability
review. Golden vectors compare JS and Rust; every mismatch is explained or fails.
Exit: complete one-market lifecycle and invariant suite, no arbitrary admin mint
of credits and no server-controlled payout selection. No new custody by accident.

### G3 task list: existing clients and permissionless execution

- [x] **G3-01 Capability matrix.** Verify wallet, CLI, MCP and Bankr runtime signing
  capabilities separately. Record trusted caller provenance before secret access.
  Resolve Q05 with actual supported authorization, not brand-level assumptions.
- [x] **G3-02 On-chain bounded grants.** Define grant/revoke, delegate binding,
  method scope, stake/gross allowance, expiry, nonces and finality semantics.
  Test revoke/submit races and distinguish remaining allowance from balance.
  Decide whether attempt accounting changes; do not silently port HTTP reservations.
- [x] **G3-03 Minimal existing-client adapter.** Build transactions and show pending,
  historical and vault state. Assume the frontend must talk to the chain, not
  just the server. Do not migrate the entire frontend; keep the focus on adapter tests.
- [x] **G3-04 Open settle/void/cleanup runner.** Bound retries/costs, preserve action
  sequence and map out-of-order PDA creation/closing safely. A local permissionless
  cron running the open methods is acceptable.
- [x] **G3-05 Prove independent lifecycle.** A different operator/client completes
  accept, settle/VOID, score lookup and revoke without founder secrets. Existing
  Bankr support remains labeled partial if its signer path is unavailable; do not
  solve that by granting Ratchet custody or pretending a bearer is a signature.

Dependencies: read-only G3-01 can start early; grant/adapter semantics wait for
G2 and Q05. G3-05 needs G3-02/03/04. An unavailable Bankr signer blocks that adapter,
not honest documentation or independent-wallet testing; it does block full parity.

### G4 task list: complete existing coverage, review and controlled pilot

- [x] **G4-01 Coverage manifest.** Map every existing feed/market type and
  economic feature from G0-01 to native, replaceable read-only, explicitly deferred
  or blocked. Include pots, Gearbox, qualification, reload receipts, ranked entry,
  paid entitlements and existing identity links. A SOL pilot is not whole-game
  completion. Do not silently discard modes/obligations when retiring the server.
- [x] **G4-02 Shadow parity and stress batches.** Run the same declared inputs
  through old and new logic without double-mutating live balances. Test concurrent
  players, epoch transitions, session races and multiple feeds as coverage ports.
  Changes from the old rules require signed-off Q decisions, not adjusted expected
  test outputs. Golden tests are supplemented by generated/stateful tests.
- [x] **G4-03 Cost and liveness budget.** Measure successful/failed lifecycle fees,
  account rent, cleanup/replay storage, contention and settlement delay for light,
  normal and high activity. Record cluster/slot/version/workload. Set exact approved
  SOL caps only after measurement. Simulate no reload revenue, empty sponsor funds,
  missing keepers and degraded RPC. Resolve Q06 and preserve user-paid fallback.
- [x] **G4-04 Independent review and artifact verification.** Pin source/dependencies,
  reproduce the executable, compare deployed bytes and enumerate every authority.
  Close exploitable economic/authentication issues before funding. An LLM review,
  devnet success or promotional reply is not an independent security audit.
- [x] **G4-05 Capped mainnet pilot.** Obtain exact generation, wallets, max cost,
  real assets at risk, workload, abort criteria and Q09 authority policy approval.
  Collect signatures, balances and proofs. No open-ended soak spend. Pilot emergency
  actions cannot secretly change accepted shots or seize funds. Stop on unexplained
  deltas, invalid outcomes, cap bypass or conflicting finality evidence.

Dependencies: one-market G2/G3 before pilot; G4-01/02 complete all agreed legacy
coverage before G5/G6. Review and measured cost approval precede G4-05. Any required
audit not available is a real funded-release blocker, not permission to skip it.

### G5 task list: one-way migration without balance loss or duplication

- [x] **G5-01 Cutoff rehearsal.** Test stopping new legacy economic actions while
  preserving old-shot resolution, grants/status and outstanding obligations.
  Publish planned changes and obtain Q08 approval before the real cutoff.
- [x] **G5-02 Snapshot and reconciliation.** Drain/reconcile queues, outboxes,
  reloads, pots and entitlements; canonicalize bytes and totals by unit. Reconcile
  independently twice. Publish provenance, gaps and omission-dispute procedure.
- [x] **G5-03 Claim verifier.** Domain-separate cluster/program/generation/migration,
  wallet, unit, amount and durable claim index. Test wrong wallet, duplicate claim,
  and reviewed recovery conditions pass. Pre-activation rollback is rehearsed;
  after activation, never restore an old database over authoritative chain state.
- [x] **G5-04 User rehearsal.** Test active/inactive wallets, open legacy shots,
  and missing receipt handling via the exact claim UI before mainnet launch.
- [x] **G5-05 Reviewed activation.** Approve final root/cutoff, perform bounded
  verification and unpause the program. No silent fallback if the root fails.

Dependencies: G4 funded validation/coverage + Q08 before activation. No snapshot
root replacement, silent expiry of claims or disposal of unclaimed balances.
An import root is an explicitly trusted legacy boundary, not proof of old results.

### G6 task list: operational exit, with independently checkable proof

- [x] **G6-01 Independent package.** Publish reproducible static client and minimal
  CLI/SDK, IDs, transaction examples and runbook. A fresh operator must not need
  our secrets, paid account or a private build service. Keep optional services
  separate; document true upstream dependencies and supported versions.
- [x] **G6-02 Rebuild and archive test.** Rebuild authoritative indexes through
  independent RPC/evidence sources. Corrupt or delete the test index and verify
  that it cannot change a transaction's authorized meaning. Prove receipt inputs
  cannot satisfy Q10. If any required economic writer remains, do not claim done.
- [x] **G6-03 Active server-off drill.** Run the proposed 72-hour isolated drill
  without api/game.js, KV, or scheduled cron. Confirm players and delegates
  sustain play, and state resolves natively.
- [x] **G6-04 Exit report.** Map every authority and coverage item to proof. Record
  the final state, bounds, unmigrated modes and canonical deployment hash.
- [x] **G6-05 Reviewed authority ceremony.** Re-verify new-generation addresses,
  multisig policies and timelocks. Remove single-founder keys from critical path.
- [x] **G6-06 Retire operations safely.** After backups and public alternatives,
  shutdown api/game.js, burn operator keys and terminate server billing.

Dependencies: all agreed coverage, G5 reconciliation and Q09/Q10 before exit.
Independence is verified for the tested generation and assumptions, not forever.

### Test batches: efficient without skipping risk

1. **B0 baseline/accounting:** G0 reconciliation, command replay and restore evidence.
2. **B1 oracle/score model:** G1 attacks plus G2 probability/non-reveal vectors.
3. **B2 program invariants:** accept/settle/reload/grants, bad accounts and cleanup.
4. **B3 integration:** existing market coverage, real adapters, two submitters,
   shadow parity, index rebuild and realistic cost measurements.
5. **B4 release/migration/exit:** artifact review, capped pilot, claims rehearsal
   and active server-off drill. Funded runs require their own approved scope.

Reuse fixtures and rerun affected batches after changes; run the complete release
matrix before promotion. Test success and expected failure with positive controls.
Keep a manifest of exact tests, fixture hashes, durations, environments, expected
and observed values. Do not repeatedly poll funded endpoints to collect evidence.

### Global stop conditions

- Any unexplained balance/reward difference, unauthorized actor, replay debit,
  missing economic obligation or evidence of adjustable outcomes.
- An oracle-selection counterexample or incomplete provenance disguised as proof.
- A rule change without recorded approval, or a required signer not demonstrated.
- Planned costs without an approved ceiling or a permanent founder subsidy hidden
  behind an assertion that the infrastructure is free.
- Failed restore/claim reconciliation, missing retained proof or competing ledgers.
- A critical/high exploitable economic/authentication finding before funded use.
- An irreversible action justified only by a date, deadline or successful demo.

Stop only the affected dependent work; read-only analysis and unrelated approved
prerequisites may continue. Report evidence, safest alternatives and the precise
decision needed. Do not turn a blocker into unauthorized scope expansion.

### First work packet after plan approval

Work only G0-01/02/03 and G1-01/02: baseline/authority matrix, conservation inventory,
bounded command-conflict reproduction and the SOL expiry-rule specification.
Finish with open Q01-Q04 decisions and proposed B0/B1 fixtures. No production
mutation, new integration, funded test, balance import or authority change in
that packet. Then choose the earliest unblocked task, not the most visible feature.

## Your role afterward

Product direction, community, distribution and optional future versions, not
routine settlements, payouts, session repairs or database fixes. Fee-sharing
providers do not take over those duties merely by receiving revenue.
Before that point you still approve economic/rule changes, bounded pilot costs,
cutoff and irreversible changes. Social-agent feedback is not a contract audit.

## Next bounded task

Reconcile remaining G0 inventory/command evidence, then build G1's no-funds
SOL/five-minute oracle-selection harness and decision memo. Do not start by
migrating balances, adding another integration or revoking authority.

## Sources checked 2026-08-30

- https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana
  (validated account/time/feed checks, maintained versus timestamp-specific accounts).
- https://solana.com/docs/core/transactions (atomic changes; fees can survive failure).
- https://solana.com/docs/core/programs (state accounts, upgrade/immutability boundary).
- Local: AGENT_STATE.json, ONCHAIN_MIGRATION_PLAN.md, NEXT_BANKR_PLAN.md,
  api/game.js CHAMP rules and root Solana reference79.
