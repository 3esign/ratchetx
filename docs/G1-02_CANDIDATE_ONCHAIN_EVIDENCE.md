# G1-02 Candidate On-Chain Evidence Specification

**Date:** 2026-08-30
**Status:** OPEN FOR APPROVAL

## 1. Specification for SOL / 5-Minute Market

### Account Binding
- **Oracle Feed:** SOL/USD
- **Expected Feed ID:** `ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`
- **Authorized Program/Owner:** Pyth Push Oracle (`pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`) or Pyth Receiver v2 (`rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp`).
- **Account Type:** `PriceUpdateV2`

### Evidence Verification
- **Verification Level:** Must be `1` (Full).
- **Exponent:** Must match the expected feed scale (typically `-8` for SOL).
- **Confidence:** `(conf / price) * 10000` must be $\le 200$ bps.
- **Clock Bounds:** `publish_time >= shot.expiry` AND `publish_time <= shot.expiry + 15 minutes` (900 seconds).

## 2. Resolving Q01: Admissibility and Omission Prevention

**The Problem:**
Solana's on-chain environment does not store a complete history of Pyth push updates. A `PriceUpdateV2` account only reflects the state at the moment a keeper updated it. If the settlement rule simply accepts *any* valid price $\ge$ expiry, a player can wait during the 15-minute grace window for the price to cross their threshold and trigger settlement, effectively gaining a free option.

**Optimal Decision (The Checkpoint Race):**
To eliminate the free option without relying on paid infrastructure (like Pyth Pull VAAs), the contract will use a **Monotonic Checkpoint Race** against the free sponsored push feed:
1. **Rule:** After expiry, *anyone* can invoke a `checkpoint` instruction for the shot. The contract reads the current `PriceUpdateV2` account on-chain. If `publish_time >= expiry`, the contract records this `price` and `publish_time` into the shot's state. 
2. **Monotonicity:** The contract will only overwrite its recorded price if a subsequent `checkpoint` call provides a valid Pyth update with an *earlier* `publish_time`. Because Pyth updates move forward in time, you can never replace an earlier checkpoint with a later one.
3. **Incentives & Omission Prevention:** The party who profits from prompt settlement has every incentive to call `checkpoint` immediately. If a player tries to withhold settlement to wait for a better price, they risk their opponent (or a public keeper) checkpointing the actual earlier price. This aligns economic incentives to execute instantly, securing the true first crossing using strictly free, on-chain data.

## 3. Resolving Q02: Edge Cases & VOID Behavior

**The Problem:**
What happens when the oracle fails, confidence widens beyond 200 bps, or the Hermes endpoint is unavailable? 

**Optimal Decision:**
1. **Invalid Confidence:** If the single update that satisfies `prev_publish_time < expiry <= publish_time` has a confidence $> 200$ bps, it is strictly unusable. The contract will evaluate this as a failed oracle print for the target window. 
2. **Missing Reveal / Expiry of Grace Window:** If 15 minutes pass after expiry and no valid price bracket has been submitted (either due to oracle downtime, invalid confidence, or network failure), *anyone* can call the `void_shot` instruction. This transitions the shot to VOID and refunds the stake. 
3. **Profitable VOID Attack / Withholding:** A losing player might attempt to withhold settlement in hopes of triggering a VOID. 
   - *Mitigation:* The winning player has a 15-minute window to fetch the Hermes VAA and claim their winnings. Failure to do so results in a VOID. Because the winner is strongly incentivized to claim their payout, intentional non-reveals by losers are harmless. If the winner fails to claim, returning the system to a clean state via a refund is the safest fallback.
