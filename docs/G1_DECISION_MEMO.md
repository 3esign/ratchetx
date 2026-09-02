# G1 Oracle Selection Decision Memo

**Date:** 2026-08-31
**Status:** VERIFIED
**Artifacts:** `test/test_oracle_selection.mjs`

## Executive Summary
This memo resolves the oracle selection strategy for the RatchetX on-chain program (v3). Following operator instructions to remain optimal while avoiding paid infrastructure, we have definitively rejected the Hermes Pull Oracle (VAA) path in favor of the **Monotonic Checkpoint Race** using Pyth's free sponsored push feeds.

## The Problem
A Pyth `PriceUpdateV2` account on Solana only holds the *latest* price. If a smart contract accepts any valid price $\ge$ expiry, a user could monitor the price during the 15-minute grace window and submit the transaction only when the price crosses their threshold. This creates a "free option" latency race.

## The Solution: Monotonic Checkpoint Race
The on-chain rule is structured as follows:
1. **Open Checkpointing:** After a shot expires, *anyone* (players or public cranks) can call the `checkpoint` instruction, submitting the current Pyth `PriceUpdateV2` state.
2. **Monotonic Retention:** The contract records the price, but only if the Pyth `publish_time` is strictly earlier than any previously recorded checkpoint for that shot (and $\ge$ expiry).
3. **Incentive Alignment:** The player winning at expiry has a strong economic incentive to call `checkpoint` immediately. If the losing player waits for the price to swing in their favor, the winner (or a public keeper) will have already pinned the earlier, correct price. Because time moves forward, the losing player cannot overwrite an earlier checkpoint with a later one.

## Adversarial Testing Results
We constructed a no-funds harness (`test/test_oracle_selection.mjs`) to simulate this state machine against the attack vectors required by `OPERATOR_INDEPENDENCE_PLAN.md` (G1-03 / G1-04). All tests passed:

- **Standard Execution:** The earliest submitted Pyth update overwrites later ones, properly pinning the true crossing.
- **Pre-Expiry Updates:** Checkpoints with `publish_time < expiry` are cleanly rejected.
- **The Confidence Blowout:** If the exact crossing occurs during a volatility spike where Pyth confidence $> 200$ bps, the contract rejects it. The true price is pinned by the next update that tightens below the threshold.
- **Ring Wrap / Reordering:** If a keeper submits an out-of-order transaction (e.g., submitting an older valid price after a newer one was already checkpointed), the contract correctly rewinds and accepts the older price.
- **Missing Reveal & Forced VOID:** If no valid Pyth crossing is submitted within 15 minutes of expiry (due to total oracle failure, persistent wide confidence, or mutual player non-reveal), anyone can call `void_shot` to trigger a refund, preventing locked funds.

## Conclusion & Next Steps
The Checkpoint Race safely delegates oracle selection to the users' economic incentives without paying for historical data endpoints. 
- **Q01 is resolved:** Admissibility is strictly the lowest valid `publish_time` submitted.
- **Q02 is resolved:** Missing reveals and oracle outages are safely floored by the 15-minute VOID refund.
- **Dependency:** No Pyth API keys or paid VAA endpoints will be required for core settlement.

**Next Action (G2):** Build the minimum economic kernel (accepting stake, rules, and ruleset verification atomically).

## Addendum 2026-09-02 — window shortened to 120 s in Core v1

The 15-minute grace window above assumed a PvP counterparty with a reason to
checkpoint at once. Core v1 settles against the credit pool, so only the
player and public runners have that reason, and with no runner live the
window was a free option for the player. `SETTLE_DEADLINE_SECS` in
`onchain/ratchet-core` is therefore 120 s: no captured crossing within two
minutes → VOID and refund. Everything else in this memo stands. Decided by
the founder; details in `docs/CORE.md`.
