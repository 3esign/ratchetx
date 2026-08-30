# RCX value through agent utility

2026-08-30. Planning artifact, not a deployed feature or changed token policy.
Baseline h100 / production code 9b3e7f0. See AGENT_ROADMAP.md for the full roadmap.

Latest Bankr capability reply and user direction: no dependency on platform-team
changes. See [self-service integration](BANKR_SELF_SERVICE_INTEGRATION.md) for
per-user skill/app distribution and the proposed bounded play-session adapter.
Bankr reports raw Solana signing unavailable on X. No new auth flow is deployed.

## Objective and next epic

Create useful recurring agent workflows that generate voluntary RCX use. The
hypothesis is: shared Pyth context attracts builders; credible forecasting records
and competition retain them; convenient ranked play creates demand for play credits.
Measure adoption, service revenue and RCX demand separately.

Next epic: **Play RatchetX through Bankr on X**, then a recurring Agent League,
after the existing result-contract closure. Preserve shared oracle access,
existing credit sources and frozen 70/30/0.
No compulsory paid Pyth provider, privileged oracle freshness or score-for-payment.

## Current economic map

| Activity | Direct RCX effect |
|---|---|
| Shared context/path, ordinary public proofs | None |
| Free demo | None; demo credits cannot become ranked funds |
| x402 entry in USDC | Pays the quoted daily champion; no RCX conversion |
| Premium proof in USDC | Separate proof-service payment; no automatic RCX purchase |
| Ranked shot | Consumes play credits, not a token transaction per shot |
| Verified RCX reload | Actual RCX routing and play-credit funding |
| RCX holding / Gearbox | Existing bounded play-credit utility, not a token yield |

Sources: api/game.js (STAKE, WELCOME_GRANT, agent-register, rankedEconomy, reload),
api/mcp.js, lib/ranked.js, lib/burn.js, lib/x402.js, lib/agent_report.js.

Real wallets currently receive a one-time 5,000-credit welcome balance; winning,
pot and Gearbox mechanisms also provide credits. Ten ranked calls therefore do
not establish that a paid reload occurred. A reload from existing holdings is
token use, not necessarily a new market buy. Incinerator transfers and true SPL
burns are different supply events. Existing empty-podium/self-seat rules affect
actual routing; report the receipt, not an assumed universal 70/30 transfer.

Brier arena qualification is separate from the daily XP podium controlling
champion routing. Brier placement alone does not guarantee champion payments.

## Bankr regression evidence

Bankr reports full WIF pagination (5+5+5+2), zero duplicate identities, preserved
same-millisecond observations, fixed bounds and structured rejection of a changed
to bound. Window: from 1788083221692 to 1788083827046.

At 2026-08-30T10:00:53.410Z independent read-only REST checks reproduced four pages,
17 distinct serialized rows and no exact duplicates. This follow-up did not
independently replay its negative cursor call or prove continuous oracle coverage.

Bankr reports three stable 4,500-credit polls per handle, one MISS and no duplicate
scoring. Independent scorecards confirm one scored call/Brier 0.2704 each:

- 41ea35bc740d / shot 9fde0319a8a4
- 55fe7753034f / shot 77a7b9c92aa8

Our check did not invoke the lazy-settling state route. Repeated-poll balances are
Bankr-reported; winning-payout replay, VOID refunds and live confidence expansion
are not established by these two MISS cases.

## Implementation order and acceptance gates

### R0 - predictable per-shot result

Extend the existing canonical settlement flow with shot/target IDs, pending or
terminal state, retry timing, retained exit evidence, outcome, credits, Brier and
proof URLs. No second settler or five-minute held request. VOID is terminal for a
shot but does not complete the non-void Gauntlet objective.

Test HIT, MISS, pending, VOID/refund, restart and repeat-poll idempotency. Correct
demo-ineligible versus insufficient-sample explanations without changing thresholds.
Demo never ranks merely by completing ten forecasts.

### R1 - discoverable wallet onboarding

Expose a checklist: wallet signing capability, registration, eligibility, existing
credits, required signatures and next action. Preflight should not create a player,
grant credits or settle shots; avoid loadPlayer/state helpers for a read-only check.
Registration/reload should be as discoverable as ranked prepare/submit, sharing
canonical handlers. Proposed new tool names are not live until schema/release tests.

Distinguish raw Solana Ed25519 message signing, transaction signing and EVM
personal_sign. Never weaken authentication to accommodate a missing capability.
Public demo handles do not prove ownership; do not silently merge their scores
into an authenticated wallet record.

Acceptance: a real operator can finish each step with precise machine-readable
failures, no exported private key and no duplicate action after retries.

### R2 - controlled RCX funding

The user's priority is people playing through @bankrbot on X, not merely asking
one bot to test repeatedly. The target journey is: public intent to start a
RatchetX session -> authenticated Bankr user/wallet -> private budget/signature
approval -> existing RCX reload when needed -> ranked forecast -> canonical
settlement -> optional public result/proof. Each caller retains a separate wallet,
credits, history and spending authority; Bankr is the interface, not a common pot.

Do not publish the open forecast's side, probability, salt or actionable signatures
in X replies if the user chooses sealed play. Public prompts should request a
session, not expose its prediction. No automatic posting without the caller's
consent. Replayed mentions/replies must not trigger another reload or forecast;
bind user/session/request IDs and require explicit fresh authority for new spend.

Bankr's [advanced features](https://docs.bankr.bot/agent/advanced/) document
per-wallet MCP/skill installs; its [runtime overview](https://docs.bankr.bot/agent/overview/)
describes shared state across web/X/Telegram/CLI. A Ratchet skill installed for one
operator does not make it globally available to every X user. Prove a one-time
per-user setup in the pilot. Default inclusion in every account is a different
product; it is not required for our self-service route. Public/forkable apps and
per-user skill installs are the chosen direction. Exact signing capability must
still be demonstrated; a skill does not create a signer.

Multi-user acceptance: two test users cannot act for each other; forged social
mentions and tool output cannot authorize payments; duplicate prompts do not spend
twice; refusal/cancel/timeout are recoverable; public results reveal only settled
information. If raw signing is unavailable on X, use an explicit private wallet
handoff rather than exporting keys or claiming fully autonomous ranked support.

Package existing reload logic as prepare/sign/verify. Display mint, network,
amount, exact recipients, credit result, fees, expiry and any swap slippage before
approval. Validate wallet-mutated instructions and confirmed outcome. Preserve
podium signing grace, signature replay gates and receipt recovery.

Support existing RCX balances without requiring a swap provider. Keep optional
SOL/USDC acquisition separate from Pyth capture. Do not treat USDC entry as a
credit reload, or unnecessarily reload an account that is already funded.

Acceptance: declined/failed/wrong-mint/wrong-recipient requests create no credits;
retry cannot credit twice; direct-RCX and optional swap paths pass separately.
No funded mainnet transaction until its operator, amount and spending scope are set.

### R3 - funded Bankr pilot on X, then a founding cohort

Funding scope clarified by user: RatchetX funds **only Bankr's integration test if
needed**, not other players/builders. Other people using Bankr on X play with their
own funds. A wider cohort invitation does not include a subsidy or a new reward.
Latest Solana checks: [Bankr preflight](SOLANA_BANKR_PREFLIGHT_2026-08-30.md).

User explicitly offered RCX or money to fund Bankr testing and public reporting
on X. Bankr subsequently named DuqnyhLHPAARS9dhCL3d3ZVxwYi48XtuZ3yRH38AgQAy as
the user's own Bankr wallet. Ownership is not independently verified; no funding
destination or budget is approved and no transfer was made. Its approximate
0.01 SOL quote is an estimate, not an authorization or a proven minimum.

1. Ask Bankr whether the X runtime can sign the exact raw Ed25519 message required
   by Ratchet ranked execution, sign bounded Solana transactions if needed, and
   retain one identity. Solana trading support alone is not proof.
2. Have it identify the Solana mainnet wallet, who controls it (including whether
   it is the user's Bankr wallet), and confirm control via an authenticated channel
   and an appropriate non-spending ownership challenge. No seed/private key.
3. Agree with the user on total RCX/USDC budget and separate SOL network-fee cap,
   exact authorized actions, maximum number of calls and a stop condition.
   An X reply is not a blank cheque and cannot increase the agreed budget.
4. One capped verified RCX reload, then up to ten stated-probability ranked calls
   if the budget and legitimate test need allow. Use the same wallet and canonical
   settlement rules. Halt on signing errors, invalid evidence or budget exhaustion.
5. Publish results, misses, limits, receipts and spend on X. Label it a
   RatchetX-funded integration test; funding is not conditional on praise.
   Report unused balance; no automatic return transfer or sale is pre-authorized.

This pilot proves a funded integration, not organic demand, independent customers
or forecasting skill. Ten calls only clears the existing minimum sample gate.
After it works, invite 3-5 independent builders/operators as a target cohort, not
a claim of agreed participation. Publish shareable proofs and a weekly digest;
no new prize fund, token emission or modified ranking/payout rules.

### R4 - one recurring service with a paying design partner

Interview cohort builders about reproducible strategy comparisons, bounded batch
analysis, report delivery and integration exports. Validate ONE paid use case.
Optional RCX service packs may follow, with explicit limits and separate service
credits that cannot enter gameplay, win pots or receive gameplay refunds.

Retain public Pyth context, ordinary proofs and honest performance records. No
paid freshness advantage, hidden losses, bought score or redirected champion fees.
Current USDC products remain distinct; new fee routing requires its own decision.

## Metrics and decision point

Build a bounded aggregate projection from canonical idempotent receipts, not a
fresh log scan or oracle read per dashboard request. Track:

- demo completions, authenticated ranked identities and paying wallets separately;
- first/repeat RCX reloads and known externally funded payers;
- team-funded tests as a separate cohort, never counted as organic conversion;
- 7/30-day returning operators, with wallet/AI identity uncertainty disclosed;
- actual reload amount, destruction/removal, champion payments, self-retained legs;
- USDC entry, proof-service revenue and any future RCX service receipts separately;
- failures at signing, eligibility, funding and settlement; cost per completed run.

Pilot checkpoint (target, not forecast): three operators onboard; two voluntarily
return on another day; one genuine repeat need leads to a verified RCX reload.
If welcome/gameplay credits cover their needs, that is a measured outcome, not
permission to erase credits or manufacture demand with arbitrary restrictions.

## Research affecting the plan

- [Pyth MCP](https://docs.pyth.network/price-feeds/pro/mcp) already exposes price
  discovery/history/candles. Our inferred differentiation is evidence, forecasting
  and competition around Pyth, not invention of raw price access or a partnership.
- [Bankr sign API](https://docs.bankr.bot/wallet-api/sign/) documents EVM methods.
  Its [wallet overview](https://docs.bankr.bot/wallet-api/overview/) documents Solana
  swaps separately. Exact raw Ed25519 support in the X runtime remains unverified.
- [x402 asset support](https://docs.x402.org/faq) includes SPL/Token-2022 at protocol
  level; that does not prove RCX support in our actual client/facilitator or mint
  extensions. Ratchet's current x402 implementation is USDC-specific.
- [Jupiter custom swaps](https://developers.jup.ag/docs/guides/how-to-build-a-custom-swap-with-metis)
  documents x-api-key and its [v1 guide](https://developers.jup.ag/docs/swap/v1/get-quote)
  marks v1 superseded. A keyless SOL/USDC v1 quote nevertheless returned HTTP 200
  here at 09:59:50.714Z. Do not claim it is broken based on docs alone. This was
  only a quote control, not an RCX liquidity/build/signing/swap test.

## Draft X capability request (not sent)

> @bankrbot next milestone: let people play RatchetX through you on X, using each
> caller's own Solana wallet and an explicit RCX budget. We can fund a capped pilot.
> Before funding, can your X runtime sign Ratchet's exact raw Ed25519 messages,
> preserve per-user wallet identity, and move spending approval into a private
> confirmation flow? Can a user install our MCP/skill once and invoke it from X?
> Please identify the supported interface or precise blocker. Then we can agree
> on a verified wallet, budget and ranked test. No funds or new shots yet. Results
> should include wins, losses and proofs, labeled as a RatchetX-funded test.

## Disclosure fixes for the next code release

- lib/agent_report.js ranking.reason conflates demo ineligibility and sample size.
- lib/x402.js paymentRequired.extra.payToIs says daily champion even for a proof
  bundle, whose actual receiver is the configured proof service. Add a
  purpose-sensitive test and correct metadata, not the recipient.
- index.html dependency prose implies RCX supply shrinks every shot and creator
  revenue is only trading fees. Reconcile credit-based play and proof-service fees.

This work changes documentation only. Production remains h100. No purchase,
transfer, burn, new demo, registry change, external post or deployment was made.
