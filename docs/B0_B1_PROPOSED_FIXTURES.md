# B0/B1 Proposed Fixtures

**Date:** 2026-08-30
**Status:** PROPOSED

## Batch 0: Baseline & Accounting (B0)

**1. Database Cutover Reconciliation Fixture**
- **Input:** `backups/pre003-20260830-P7LEkP/ratchet-kv-data.dump`
- **Fixture:** A read-only script that streams the dump, accumulating:
  - Total `cr` (credits) across all `u:<wallet>` keys.
  - Total pending queue credits from `pend:<wallet>`, `c7:<wallet>`, `cs7:<wallet>`.
  - Total `burned` from `u:<wallet>` compared to global `h:stats`.
- **Acceptance:** Zero unexplained delta between sum of obligations and historical global issuance records.

**2. Command Replay / Conflict Guard**
- **Input:** Retained sanitized session play payloads (target, side, p, stake).
- **Fixture:** `test/test_session_play.mjs` and `test/test_session_play_contract.mjs` covering:
  - Exact duplicate payload with the same external command ID.
  - Conflicting payload (changed target/side) with the same external command ID.
  - Original journal status preservation (ensuring the original shot isn't overwritten).
- **Acceptance:** Tests pass without allocating new shots or mutating the original receipt.

## Batch 1: Oracle & Score Model (B1)

**1. Pyth Oracle Adversarial Stream (G1 Attacks)**
- **Input:** Synthetic arrays of `PriceUpdateV2` account buffers.
- **Fixtures to generate:**
  - **The Missing Crossing:** A price jump where the oracle heartbeat halts just before the target threshold, and resumes past it. 
  - **The Confidence Blowout:** `publish_time` reaches expiry, but the confidence interval spikes to 300 bps (invalid). The price returns to tight confidence 5 seconds later.
  - **Stale Entry:** An observation whose `age = now - publish_time` exceeds 120s.
  - **The Reorder:** Simulated network latency where a `publish_time` of T+2 is received by the node before T+1.
- **Acceptance:** The system resolves deterministically on the earliest VALID observation, rejecting stale or wide-confidence prints.

**2. Probability & Non-Reveal Vectors (G2)**
- **Input:** A simulated environment where `settle` transactions are exclusively submitted by external callers (no central keeper).
- **Fixtures to generate:**
  - **Winner Settles Fast:** The winning wallet submits the transaction at `expiry + 2s`.
  - **Loser Withholds / Forced VOID:** Both YES and NO are simulated, but the winner's bot is down. The loser intentionally waits 15 minutes and calls `void_shot` to trigger a refund.
  - **Late Settlement Race:** The winner wakes up at `expiry + 14m 59s` and submits the price, racing the loser's `void_shot` instruction.
- **Acceptance:** The on-chain game correctly allocates credits to the winner if submitted within the window, and gracefully refunds via VOID if the winner fails to claim in time.
