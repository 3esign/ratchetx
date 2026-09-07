# G0-01 Baseline and Authority Inventory

**Date:** 2026-08-30
**Status:** VERIFIED (Read-Only Analysis)

## 1. Program IDs and External Authorities
- **Seal v2 Program ID:** `23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX` (Legacy v2 frozen commitment program)
- **RCX Token Mint:** `RATCHET_MINT` (Environment variable; used for on-chain burn verification)
- **Token Creator/Fee Wallet:** `HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM`
- **Pyth Oracle:**
  - Pulls from shard-0 push-feed PDAs.
  - Supported Feeds: `SOL`, `BTC`, `ETH`, `BONK`, `WIF`, `JUP`, `PUMP`.
  - Authorized Owners: `rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp` (receiver v2) and other canonical Pyth receivers.

## 2. State Field Map

### Player Ledger (`u:<wallet>`)
- **Store:** KV/Redis or Supabase.
- **Writer:** Server-side via `guarded_commit.js` (`playerWrites.save`).
- **Signature:** Client signs requests (HTTP authentication) or uses a delegated session grant.
- **Economic Effect:** Authoritative balance of `cr` (credits), `xp`, and open/closed shots.
- **Failure Behavior:** Read via `getJSONStrict` to ensure a failed read throws rather than returning `null` (which could cause a reset of the player's balance on next write).

### Credit Queues (`pend:<wallet>`, `c7:<wallet>`, `cs7:<wallet>`)
- **Store:** KV Counters.
- **Writer:** `applyOnce` for challenge refunds or `rolloverPots()` for daily/weekly payouts.
- **Economic Effect:** Buffers incoming credits from reloads or pot distributions so that a concurrent player write doesn't overwrite a credit.
- **Failure Behavior:** Atomic `INCRBYFLOAT` operations ensure no value is lost. Drained securely via `commitGuarded` when the player blob is loaded.

### Replay Gates (`sig:<sig>`)
- **Store:** KV JSON (`sig:<sig>`).
- **Writer:** `claimAnchor`, `lib/burn.js`, `lib/x402.js`.
- **Signature:** Verifies the cryptographic signature of the Solana transaction.
- **Economic Effect:** Prevents double-spending a token burn for credits, or claiming the daily anchor XP multiple times.
- **Failure Behavior:** Created with `SET NX` (`setnxJSON`). Fails closed on collision.

### Ladders & XP (`z:lb:<season>`, `z:lbd:<day>`, `z:lba:all`)
- **Store:** KV Sorted Sets.
- **Writer:** `zincrManyOnce` (Daily/Season) and `zmax` (All-Time).
- **Economic Effect:** Determines the ranking of players to distribute the 30% Champion's Cut.
- **Failure Behavior:** Server-side atomic increments (`ZINCRBY`) ensure concurrent settlements don't overwrite each other.

### Podium (`g:podium`)
- **Store:** KV JSON.
- **Writer:** `refreshLivePodium` with a one-shot lease lock.
- **Economic Effect:** Determines exactly which wallets receive the RCX from a reload on a given day.
- **Failure Behavior:** Lock prevents concurrent calculations. Includes a short signing grace period so live transactions don't instantly fail if the podium shifts.

### Oracle Capture (`pxstream:<feed>`, `px:<feed>`)
- **Store:** KV JSON (with expiration).
- **Writer:** `lib/pxlog.js` (`setJSONIfNewer`).
- **Economic Effect:** Determines the settlement result of ranked shots (HIT/MISS/VOID).
- **Failure Behavior:** Retains data using clock-based tuple ordering. Old data expires automatically.

### Global Stats (`h:stats`)
- **Store:** KV Hash.
- **Writer:** `bumpStats` (`hincrMany`).
- **Economic Effect:** Used for display and establishing the total burned value/floor.
- **Failure Behavior:** Atomic per-field increments.

### Play Sessions (`sess:<id>`)
- **Store:** KV JSON.
- **Writer:** `lib/play_session_record.js` using CAS write.
- **Signature:** Owner signature on the grant payload.
- **Economic Effect:** Delegates the ability to play to an agent/runner without exposing the owner's private key.
- **Failure Behavior:** Strict CAS (`ExpectedRevision`) prevents rollback attacks.

### x402 Premium Entitlements (`x402:q:<id>`, `x402:c:<hash>`)
- **Store:** KV JSON.
- **Writer:** `lib/x402.js`.
- **Economic Effect:** Grants access to premium proof queries.
- **Failure Behavior:** Validated receipt hashes are gated with `setnxJSON` to prevent double-claiming a payment.
