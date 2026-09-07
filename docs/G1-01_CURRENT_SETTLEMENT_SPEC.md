# G1-01 Current Settlement Specification

**Date:** 2026-08-30
**Status:** VERIFIED (Current Off-Chain Rules)

## Overview
This specification details the existing off-chain settlement rules extracted from `api/game.js`, `lib/onchain_px.js`, `lib/pyth_context.js`, and `lib/outcome.js`.

## Pyth Oracle Admission
- **Account Type:** Fully verified Pyth `PriceUpdateV2`.
- **Feed IDs:** Checked against expected constants for the 7 supported majors.
- **Authorized Owners:** Must be owned by an authorized Pyth program (e.g. `rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp`).
- **Age Bound:** `now - publish_time` must not exceed `MAX_AGE_S` (120 seconds).
- **Confidence Bound:** `conf / price * 10000` must be $\le$ `MAX_CONF_BPS` (200 basis points, or 2%). 

## Capture and Retention (`pxlog.js`)
- **Source Update:** Decoded direct from Solana via RPC and Hermes streams. Includes `price`, `conf`, `expo`, `publishTime`, `prevPublishTime`, `emaPrice`, `emaConf`, and `postedSlot`.
- **Retained Observation:** Captured updates are persisted into hour-aligned KV buckets (`px:<time>` and `pxu:<time>`) if they represent a new `publishTime` or `postedSlot`. Distinct transitions in the same millisecond are preserved.
- **Protocol Checkpoint vs Transaction Slot:** The `postedSlot` is the Pyth oracle's internal slot. The `rpcSlot` is the Solana transaction slot where the observation was read. The primary time parameter is Pyth's own `publishTime`.

## Settlement Execution
- **Trigger:** Settlement is LAZY. Any state-mutating request can trigger resolution for expired shots.
- **Rule Identifier:** The active rule is `pyth-first-observed-after-v3` with outcome rule `strict-compare-v2`.
- **Sample Identity:** The resolution price is the *first fully-validated observation* with an oracle `publishTime` $\ge$ the shot's `expiry` timestamp.
- **Comparison:** Uses `questionOutcome()` (`strict-compare-v2`). Checks use raw numbers without `LEGACY_EPS` (0.0004 diff threshold). 
  - For directional (up/down), strict inequality determines YES/NO. Exact equality resolves to VOID.
- **Void Semantics:**
  1. If `price === entry` exactly.
  2. If no valid crossing sample is observed within the grace window `ts + SETTLE_GRACE_MS` (15 minutes).
  3. If the feed is missing completely for 24 hours past expiry (`STALE_VOID_MS`).

## Data Path
1. `onchainPrices` or stream reads `PriceUpdateV2`.
2. Validated against limits (age $\le$ 120s, conf $\le$ 200 bps).
3. `ingestUpdate` saves tuple to bucket.
4. `priceCrossing` searches forward in buckets starting from `expiry` for the first sample with `publishTime >= expiry` and `confBps <= 200`.
5. `questionOutcome` evaluates the condition.
