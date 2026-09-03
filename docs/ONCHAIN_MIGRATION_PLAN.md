# RatchetX: move authority to Solana, then remove the server dependency

Decision recorded: 2026-08-30. Requested by Semir. Status: ROADMAP, not an
implemented migration, mainnet approval, or change to economic rules.

Founder-independence companion: [OPERATOR_INDEPENDENCE_PLAN.md](OPERATOR_INDEPENDENCE_PLAN.md).
It adds cost ownership and server-off acceptance for making the founder optional.
The companion now contains stable task IDs, decision questions, dependencies,
test batches, stop conditions and the user's product-expansion freeze. Follow
those controls; old optional integration plans are not active implementation scope.
Local AGENT_STATE.json now records h105; h100/h104 status paragraphs below are
historical, not instructions to repeat completed migrations or proof G1-G6 shipped.

Checkpoint update 2026-08-30: h104 is now deployed and verified. Guarded application
cutover and the scoped Bankr owner pilot progressed beyond the historical h100
baseline below; see AGENT_STATE.json and RELEASE_H104.md. That does not close all
G0 inventory/operational items or any oracle-selection/program migration gate.
Next hard engineering task remains G1, not repeating the completed owner pilot.
Video and current hackathon instructions: BANKR_VIDEO_AND_CLAWRENA_PLAN.md.
Historical status paragraphs below are not instructions to reapply migration003.

## Goal and definition of done

The target is all authoritative game state and economic decisions on Solana:
admission, credit ownership, stake, oracle selection, outcome, payout, reputation,
champion eligibility, and bounded agent permissions. Ratchet's database must not
be able to invent, erase, censor recovery of, or change those facts.

Architecture interpretation of "everything on chain": the website, MCP, search,
notifications and shared read caches may remain off-chain as replaceable clients.
They must not be required authorities. This is NOT a proposal to copy every HTTP
request, private credential, or every global Pyth tick into permanent accounts.
Every input actually used for an economic decision needs independently available
evidence. If a cosmetic feature starts affecting payout or access, it moves inside
the authoritative boundary too.

Final acceptance: turn off Ratchet API, Supabase, its oracle collector and its
keeper in an isolated drill. A different client and independent submitter can
admit new valid play, resolve or deterministically void existing positions, recover
balances, revoke delegation and verify scores using Solana and admissible Pyth
evidence. No Ratchet admin signature, secret API or server-issued result is needed.
This removes Ratchet's authority, not dependencies on Solana, Pyth, transaction
submitters, data availability or network access.

## What exists now, and what does not

Baseline is recorded in [AGENT_STATE.json](AGENT_STATE.json) and
[AGENT_HANDOFF.md](AGENT_HANDOFF.md); these are not a fresh mainnet attestation.

| Surface | Current boundary | Required destination |
| --- | --- | --- |
| RCX mint, actual burns/transfers | Solana; game verifies receipts | Same mint and actual token semantics; no replacement token |
| Credits, shots, XP, Brier, pots, champion selection | Canonical server state | Program-validated state transitions and entitlements |
| Pyth context/path | Validated sampled account observations; relay ordering | Shared readable context plus chain-verifiable decision inputs |
| Ratchet Seal v2 | Optional non-custodial receipt/referee, not the game ledger | Preserve v2; new audited generation for canonical play |
| Calibration PDA | Draft in CALIBRATION_ONCHAIN.md; not deployed canonical state | Native scoring from eligible terminal positions |
| Bankr play capability | Local detached off-chain foundation | Explicit on-chain scoped authority AND demonstrated signing transport |
| x402 services | On-chain USDC payment; off-chain quote, delivery and replay state | Verifiable entitlement and recipient rules; replaceable service delivery |
| Registry/passport | Identity or attestation, not proof of game correctness | Provenance labels remain separate from native game results |
| Demo Gauntlet | Wallet-free, reward-free sandbox | Remains a segregated demo; never becomes redeemable ranked balances |

Production application remains h100. The guarded-write repair is local; database
migration 003 is applied and live contention-tested (see GUARDED_DATABASE_CUTOVER.md).
Existing v2 source stays byte-pinned, with the separately registered
[freeze ceremony](FREEZE.md) unchanged. A directory named v3 or a successful
receipt transaction is not evidence of a deployed canonical economy.

## Economic invariants before any port

1. RCX tokens, ranked play credits, demo credits, XP and USDC are different units.
   Label each quantity in the schema and UI. Credits are not an RCX withdrawal
   claim. Moving credit arithmetic on-chain must not tokenize or collateralize it
   by accident.
2. Preserve the actual reload/burn/champion rules and stake accounting in
   `api/game.js`, including integer dust and self-recipient behavior. The existing
   70/30/0 stake ledger is not a new token transfer on every shot. HIT credit
   rewards and VOID credit refunds must not be represented as token minting or
   reversal of an irreversible RCX burn.
3. Public oracle/board/proof reads do not consume RCX. Real ranked reloads remain
   its utility rail; no token-price promise, per-read levy, new team cut, automatic
   buyback or subsidy for all users is part of this migration.
4. Keep x402 champion entry and the separate proof-service payment distinct.
   A service receipt must not silently grant transfer, reload or gameplay power.
5. Any proposed change to payout, eligibility, timing or custody is a separately
   versioned rule decision with explicit approval, not a migration implementation
   detail. Preserve already accepted positions under their original rules.

## Ordered work and exit gates

### G0 — make the existing source ledger safe to migrate

Finish [guarded player writes](GUARDED_PLAYER_WRITES.md): schema verification,
recoverable backup, compatible migration, real two-connection contention tests,
browser checks and verified production cutover. Close the remaining anchor,
staking and maintenance fault boundaries before they enter migration scope.
Reconcile pending credit queues, settlement outboxes and financial side effects.

Database prerequisite completed on 2026-08-30: verified administrator access,
consistent 11,062-row backup fully restored with matching digest, migration 003,
service-role access checks and local/live two-connection tests. The first real
contention batch exposed a legacy increment race; the corrected arithmetic
passed both failure control and live regression. Application deployment and the
remaining fault boundaries are still open; this is not completion of G0.
Its quota warning names a possible restriction from
2026-09-27; the exhausted resource has not been established. Inspect usage rather
than infer egress or storage from dashboard percentages. No automatic paid upgrade.
On-chain migration is not an immediate fix for this operational warning.

Deliverable: a versioned state inventory and conservation report, including each
queue, replay gate, reload receipt, pot, champion obligation and pending position.
Gate: no unaccounted balance delta or unresolved receipt ambiguity in that report.

### G1 — solve the oracle authority problem first, without funds

Build a new-generation executable specification and adversarial oracle harness.
Pin accepted Pyth program/account/feed identities, verification level, confidence,
clock bounds, exponent/rounding, admissible observation identity and expiry policy.
Read validated Pyth accounts directly in the program; a hash signed or posted by
Ratchet is not an oracle proof. Keep shared capture for client reads and avoid a
new upstream request for each agent. No mandatory paid history service is assumed.

Crucial source finding: v2 `checkpoint()` links a snapshot to the previous
checkpoint it actually recorded, not to every source update. Its 64-entry ring
and publish-time-only duplicate rule are v2 semantics, not a complete Pyth archive.
Porting that ring does not by itself remove withholding, missed-crossing or
same-timestamp selection risks. Do not modify frozen v2 to experiment.

Evaluate a permissionless shared on-chain feed clock with a predeclared sampling
and admissibility rule. Explicitly distinguish first **protocol checkpoint** from
first **Pyth source update**. Prove how the rule handles skipped samples, equal
publish times, adjacent posted slots, fork rollback and late keepers. If source
first-crossing is claimed, establish its evidence and exact upstream semantics;
two timestamp fields or a relay hash are not enough by assumption.

Unresolved design gate: sponsored accounts expose current state, not guaranteed
historical completeness. A keeper can still affect which states get captured.
Fixed schedules and multiple keepers improve availability but do not alone prove
non-manipulable selection. Reject a candidate if selective withholding can improve
an actor's expected payoff, including by forcing favorable refunds. If the desired
rule cannot be proved with the available evidence, report that blocker and request
an explicit rule/dependency decision; do not silently fall back to latest price.

Tests: same-millisecond distinct observations; widening confidence and EMA lag;
fresh entry followed by bad confidence; conflicting valid states; omitted crossing;
ring wrap; first checkpoint after expiry; delayed/reordered/duplicated submissions;
source stoppage; two competing keepers; settlement at multiple delays.
Gate: one admissible result for the declared evidence/rule, or explicit bounded
unresolvable/VOID behavior, with selection and liveness attacks documented.

### G2 — implement one atomic game/economy kernel

New directory, program ID and ruleset; resolve existing v3 naming collisions before
choosing its name. Start with the minimum supported market type, not every chamber
at once. Keep the credit ledger/economic invariants isolated from experimental
game logic. If split into programs, pin allowed CPI callers and bound each game's
authority; a caller must not supply arbitrary winnings or create credit grants.

Proposed accounts: versioned Ruleset, PlayerCredits, Shot, FeedClock/Epoch,
Calibration, Season/Pot, reload/claim receipts and later Session. Use per-player
state and bounded per-feed/epoch aggregates rather than one writable global account.
Benchmark shared mint/podium/pot contention; sharding is a measured optimization,
not an excuse to weaken atomicity or change who wins a seat.

Acceptance of a shot atomically binds identity, nonce, ruleset, target, probability
commitment, entry evidence and credit debit. Settlement atomically fixes outcome,
balance, score and economic entitlement exactly once. Read models may lag; real
payout eligibility must not depend on an asynchronous server leaderboard.
Permissionless season/champion finalization must prove the eligible participant
set, completeness and deterministic tie rules; an operator-posted top-three root
is not a substitute. Preserve replay protection after shot cleanup or session expiry.

Port canonical probability semantics explicitly: the probability refers to the
chosen side, not always to YES. Use bounded checked integer math and a documented
rounding scale, with vectors against actual JS outcomes. Never silently score
legacy v2 calls as probability-bearing v3 calls.

Calibration design blocker: counting only voluntarily revealed wins lets agents
hide bad forecasts. Track commitments, reveals, non-reveals and coverage; design
and test eligibility so withheld outcomes cannot improve a published ranked score.
Stake loss alone does not prove reputation cannot be bought. Any reveal timing or
public-probability alternative needs its own new-generation rule decision.

New reloads should execute exact RCX burn/routes plus non-redeemable credit issuance
atomically with a durable nonce. Validate mint, token program, decimals, extensions,
account authority and recipients; do not accept a client assertion that a prior
transfer happened. Legacy reload receipts are handled only by G5's migration.

Gate: JS/Rust golden vectors, conservation by asset, duplicate and reordered calls,
wrong owner/mint/program, arithmetic edges, selective reveal, concurrent writes,
deadline refunds, permissionless cleanup to the correct rent recipient and no
admin instruction capable of awarding arbitrary balances. Any actual fund custody
requires a separate independent security audit before a funded pilot.

### G3 — agent execution, with chain-enforced limits

Build grant/revoke transactions approved by the owner wallet. A Session binds the
owner, explicit delegate, program/ruleset, allowed methods, expiry, maximum stake,
gross budget, nonce and revocation state. It cannot transfer tokens, reload, replace
itself or choose a payout recipient. Define whether a budget counts reservations
or accepted actions; do not silently copy server-attempt semantics into Solana
transactions that revert. Revoke/submit races follow finalized chain ordering.

Bankr's protected HTTP secret is not a Solana signer. Prove that its actual runtime
can submit the required owner/delegate-approved transaction, or correctly verify
a supported signed intent through a separately reviewed adapter. An HTTP bearer
token alone must not become on-chain spending authority. Do not generate/store
user signing keys in Ratchet or publish private capabilities on X.

Keep MCP/REST response contracts stable: explicit pending/confirmed/finalized state,
shot identity, next action, exit evidence, credit and Brier delta, proof URI and
terminal reason. Notify/wait is an optional client convenience, not a second
settlement engine. A getAccountInfo read does not execute settlement.

Gate: independent client lifecycle; cross-user, wrong-domain, replay, revoke,
expiry and cap tests; crash recovery; no Bankr-app-owner fallback. Pilot funding
remains Bankr-only and requires the exact wallet, amounts and fee cap to be approved.

### G4 — shadow replay, costs and bounded mainnet pilot

Run historical labeled fixtures and synthetic adversarial streams on local validator
and devnet. Feed identical inputs to the old and new rules; explain every intended
difference. Shadow mode has one economic authority: do not debit real state twice.

Measure account bytes/rent, transaction bytes, compute, success/failed fees, account
contention, keeper writes, replay cost, void rate and resolution delay. No assumed
future transaction-format activation, rent reduction, unlimited public RPC or
zero operating cost. Reuse one validated checkpoint across eligible shots, subject
to G1 correctness. Publish costs for 1, 100 and 1,000 active agents using measured
actions per agent, not a guessed SOL/USD forecast.

Someone must submit transactions; the program cannot run on a timer. Users and
independent keepers can do so. Start with explicit user-paid transactions and a
separate finite approved test gas budget. Do not deduct a new keeper fee from
frozen pots or promise perpetual sponsorship. Any sustainable keeper incentive
requires a separately approved funding rule and depletion behavior.

Gate: reproducible artifact, independent review, invariant fuzzing, complete
lifecycle/recovery matrix, source-to-deployed-byte verification, cost ceiling and
zero unexplained economic mismatches. Only then an isolated capped mainnet pilot,
with a declared authority policy and an escape path that cannot seize balances
or change accepted shots. Devnet success alone is not a mainnet cutover gate.

### G5 — migrate legacy state once, with an auditable boundary

Preferred simple cutover: announced generation boundary; stop new legacy economic
actions, finish/void old positions under old rules, drain verified queues/outboxes,
reconcile reload receipts and freeze a consistent snapshot. If per-wallet cutover
is later needed, specify atomic tombstones and race handling first. Never run two
independent writers against the same spendable balance.

Publish snapshot schema, provenance, rule/version, cutoff identifiers, totals by
unit and known gaps. Use a canonical deterministic encoding and bounded claim
proofs, not JSON property insertion order. A one-time importer or Merkle root is a
legacy trust boundary: it proves inclusion in that snapshot, not historical game
correctness. Root publication requires review and explicit approval; disable root
replacement/import authority after the announced process, with a tested recovery
policy for omissions decided BEFORE finalization.

Each claim binds cluster, program generation, migration ID, wallet, asset/unit,
amount and nonce/index. On-chain nullifiers prevent duplicate claims, including
after receipt/account cleanup. An active destination wallet cannot spend both a
legacy balance and its imported equivalent. Prevent an old burn/reload signature
from being credited again through the new-generation path.

Legacy ranked credits remain non-redeemable credits. Demo identities are excluded
from economic claims. Preserve old XP/records as labeled legacy provenance; native
on-chain calibration starts with native eligible forecasts, not attested backfill.
The known log gap stays disclosed. Active claims, pots, staking obligations and
USDC entitlements each need reconciliation; no balance is silently dropped.

Gate: two independent snapshot/replay checks, full totals reconciliation, duplicate
and omitted-claim tests, rollback rehearsal before activation, no shared mutable
balance after activation. Once chain becomes authoritative, rollback means fixing
or switching a compatible client, never restoring a stale database over chain.

#### The cutover switch, and why the root does not void anything

`RX_MIGRATION_FREEZE=1` is the environment variable that performs "stop new
legacy economic actions" above. It is read once in `api/game.js` and checked in
`takeStake`, which is the only place in the machine where credits are ever
COMMITTED — every shot, every challenge and every take passes through it.
Settlement, reveals, claims, payouts and the crank are untouched: the freeze
stops *selling*, never *settling*. With the variable unset, which is every
deployment today, the check is a comparison against `undefined` and the game
behaves exactly as before. Refusals carry the code `MIGRATION_FREEZE` (registered
in `lib/play_session_http.js` and in the skill's runner), because an agent that
gets a generic `SHOT_REFUSED` for a day has no way to tell a freeze from a fault
— that was the whole shape of the Bankr `RELEASE_MISMATCH` failure.

It is an environment variable rather than a store key deliberately. The cutover
is one announced act, not something that must flip in five seconds, and a switch
that ships in the source is one anybody can verify against the running release.
A flag hiding in the store is invisible to exactly the people this is meant to
be honest with.

**The rule the root follows: stop selling, then drain. Never void.**

A stake in flight is credits that are in nobody's `cr`. `tools/legacy_root.mjs`
therefore refuses to build a root while any shot is open, and says when the last
one expires. The tempting shortcut is to credit that stake back as `cr` and void
the shot, and it is the wrong answer for two independent reasons:

1. **It confiscates an earned outcome.** A player who sealed a correct
   prediction gets the stake back instead of the win, selected by nothing but
   holding a chamber at the cutover second.
2. **It can pay somebody twice.** The void has to land in the store atomically
   with the snapshot. A half-applied void leaves a wallet credited on chain and
   still holding the shot off chain — on the one path that cannot be rolled
   back.

So: freeze, let every open shot run to its own expiry and settle on its own
terms, then snapshot. The wait is bounded by the longest horizon actually open
when the freeze went on — `latestExpiry`, which the tool prints — not by the
1440 minutes the horizon table allows in the abstract. Nobody's outcome is taken
from them, and no new money path is introduced on the day it can least afford
one.

This also answers the objection that "refuse while open" cannot scale: at a
thousand concurrent players a naturally quiet moment may never arrive. True, and
irrelevant. The legacy root is set ONCE. After cutover, balances live on chain
and the crossing predicate settles them; there is no snapshot any more. The rule
must survive exactly one cutover, not a thousand players — and building a
void-and-credit path to handle a one-time event is added risk on the money path
in exchange for nothing.

**Both guards must be live.** `scripts/set-legacy-root.mjs` refuses to patch
`LEGACY_ROOT` into `lib.rs` when any row of `merkle_balances.json` carries
`staked > 0` — an independent second check that fires even when the builder was
run with `--allow-open-stake`, which is the exact case it exists for. That check
was dead until 2026-09-03: the builder wrote a hardcoded `staked: 0` for every
player, so the guard read a constant and passed. It now writes the real
per-wallet stake. A check that cannot fail is worse than no check, because the
money path looks doubly protected when it is not.

### G6 — retire database authority and prove independent operation

Switch clients and MCP to chain-derived records with visible source slot,
commitment level and generation. A bad/stale indexer must not build an unauthorized
transaction or redefine outcome. Rebuild indexes from independently retrievable
chain state/evidence; preserve replay identifiers and final scoring aggregates.

History is a separate storage decision: events on a pruned RPC are not guaranteed
permanent availability. Retain the evidence required to verify each result on-chain
or in a specifically reviewed independently available archive with chain commitments.
Do not close accounts or introduce compression until retrieval/proof/replay tests
and costs pass. A hash without retrievable data does not satisfy auditability.

Move authoritative registry permissions, paid-access claims and champion payment
selection on-chain where they affect the product. Premium computation/delivery
can remain a replaceable service, but disclose availability and entitlement limits;
payment settlement does not cryptographically guarantee off-chain delivery.

Gate: the server-off drill described above, plus corrupt-indexer and keeper-loss
tests, independent client instructions, complete dependency/authority inventory,
and no remaining economic writer in Supabase. Only then update the canonical
settlement claim for that generation. Retire unused DB workloads after backups,
not before; historical demo/read caches can be retained without economic authority.

## Handoff: where the next agent starts

1. Continue G0's real deployment gates; do not mistake the local 71/0/5 result for
   production migration. User SQL results confirm all seven catalog checks pass;
   proceed with verified backup/access before migration and real contention tests.
2. Inventory the full economy and build G1's oracle-selection attack harness.
   This is the highest-value hard task; another SDK or prettier dashboard cannot
   solve authority over the chosen exit price.
3. Produce the G2 numeric specification and non-reveal scoring decision before
   writing a custody program. No arbitrary deadline or approved budget is inferred.
4. Update this plan with exact artifacts, tests, signatures and unresolved failures
   at each gate. Preserve current source, history and the v2 freeze commitment.

All gates are currently OPEN. This document creates no program, session, transfer,
paid subscription, migration root or background job.

## Primary references checked 2026-08-30

- [Pyth Solana integration](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana):
  account identity/validation, current feed accounts versus timestamp-specific
  updates, and the need for an updating process. Its examples are not a proof of
  Ratchet's first-crossing policy; inspect the pinned receiver source at G1.
- [Solana transactions](https://solana.com/docs/core/transactions): atomic state
  changes and current transaction limits. Atomicity does not span separate calls.
- [Solana accounts](https://solana.com/docs/core/accounts): program-owned state and
  storage balance; [programs](https://solana.com/docs/core/programs): execution
  and upgrade-authority boundaries.
- [Solana fees](https://solana.com/docs/core/fees),
  [rent query](https://solana.com/docs/rpc/http/getminimumbalanceforrentexemption),
  [simulation](https://solana.com/docs/rpc/http/simulatetransaction): measure actual
  cluster costs before funding. Simulation is not finalized execution.
- [Token-2022](https://www.solana-program.com/docs/token-2022): inspect the actual
  mint's supported extensions and program, rather than assuming classic SPL behavior.

Local sources: `api/game.js`, `lib/player_writes.js`, `lib/onchain_px.js`,
`onchain/ratchet-seal-v2/programs/ratchet-seal/src/lib.rs`,
[calibration draft](CALIBRATION_ONCHAIN.md), [log provenance](CHAIN_GAP.md),
[Bankr boundaries](BANKR_SELF_SERVICE_INTEGRATION.md). Older research prose is not
evidence of deployed functionality or of current network parameters.
