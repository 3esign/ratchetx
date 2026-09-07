# Q03 & Q04 Decisions (Optimal Path)

**Date:** 2026-08-30
**Status:** OPEN FOR APPROVAL

## Q03: Sealed Probability & Reputation Integrity

**The Problem:** 
Players must keep their probability and side sealed until resolution to avoid market manipulation. However, if they only reveal winning bets (and withhold losing ones), their on-chain ranking and reputation (Brier score) becomes artificially inflated.

**Optimal Decision (Pessimistic Scoring with Reveal Refund):**
To ensure that a non-reveal heavily penalizes the player's reputation rather than hiding a loss, we will enforce **Pessimistic Up-front Scoring**:
1. **Commitment (Entry):** The player submits a `sha256(side, probability, salt)` hash and their stake.
2. **Pessimistic XP/Brier Deduction:** At the exact moment of commitment, the player's on-chain reputation ledger is immediately debited by the *maximum possible penalty* (e.g., as if they bet 100% on the wrong side). 
3. **Reveal & Settle:** During settlement, the player reveals their `salt`, `side`, and `probability`. The contract computes their *actual* score based on the outcome. The contract then refunds the difference between the pessimistic penalty and their actual score, plus any stake winnings.
4. **Non-Reveal Consequence:** If the player intentionally withholds a reveal, the maximum penalty remains permanently locked in on their record, devastating their ranking. There is zero incentive to hide a loss.

## Q04: Integer Units & Exact Arithmetic

**The Problem:**
Solana programs do not support floating-point arithmetic securely. We need exact integer units, rounding rules, and bounds.

**Optimal Decision (Strict Integer Arithmetic):**
1. **Financial Units:** 
   - `CR` (Credits) and `USDC` mapped to **6 decimals** (`1_000_000` base units = 1 CR).
2. **Score/Probability Units:** 
   - Probabilities (`p`) are represented as integers `0` to `100_000` (representing $0.00000$ to $1.00000$, 5 decimals precision).
   - `XP` and Brier scores are scaled by `1_000_000` to maintain precision across squaring operations.
3. **Rounding & Dust:** 
   - All token payout calculations will use integer division and **round down**. Any fractional dust (e.g., $< 0.000001$ USDC) remains in the global pot/vault and is never minted to the player.
4. **Time & Midnight Transitions:** 
   - Daily bounds and leaderboards are strictly determined by the Solana `block_time` (Unix timestamp) aligned to UTC midnight (e.g., `timestamp % 86400 == 0`). 
5. **Signing Grace:** 
   - Transactions signed near a daily boundary receive a 5-minute logical grace period to account for network congestion, meaning a shot submitted at `23:59:50` that lands at `00:00:10` is still attributed to the preceding day's podium.
