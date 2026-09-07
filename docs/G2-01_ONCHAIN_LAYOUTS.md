# G2-01 On-Chain State Machine Layouts

**Date:** 2026-08-31
**Status:** OPEN FOR APPROVAL

## 1. Goal
Design the PDAs, account sizes, and seeds for the RatchetX v3 smart contract to guarantee execution without a centralized backend or globally writable bottlenecks (which cause transaction congestion).

## 2. Resolving Open Questions
- **Q03 (Sealed Reveal):** Addressed via `PlayerLedger` pessimistic up-front deduction at commitment, refunded dynamically at `settle` time.
- **Q04 (Integer Math):** 6 decimals for token logic, 5 decimals for probabilities (`100_000`), rounding down on division.

## 3. Account Layouts

### A. Ruleset (`RulesetV1`)
**Purpose:** Versioned global parameters to avoid hardcoding variables into bytecode.
**Seeds:** `[b"ruleset", version_id]`
**Size:** ~128 bytes
**Fields:**
- `authority` (Pubkey): Admin who can tweak parameters.
- `void_window_sec` (u64): 900 (15 minutes).
- `max_confidence_bps` (u16): 200.
- `min_stake` (u64): Minimum CR/USDC allowed.

### B. Player Ledger (`PlayerLedger`)
**Purpose:** Tracks a user's XP, Brier score (calibration), and total history. Must not be a global singleton (which would bottleneck transactions). Each player gets their own PDA.
**Seeds:** `[b"player", player_pubkey]`
**Size:** ~256 bytes
**Fields:**
- `player` (Pubkey): The owner.
- `xp` (u64): Total accumulated skill points (scaled by 1M).
- `hits` (u32), `shots` (u32): Totals for win rate.
- `brier_numerator` (u64), `brier_denominator` (u32): For exact Brier calibration without floats.
- `daily_podium_epoch` (u64): Current active UTC day timestamp (aligned to 86400).
- `daily_xp` (u64): XP earned in the current `daily_podium_epoch`.

### C. Shot Evidence (`Shot`)
**Purpose:** The atomic commitment for a single prediction. Created at entry, destroyed/archived at cleanup.
**Seeds:** `[b"shot", player_pubkey, command_nonce]`
**Size:** ~256 bytes
**Fields:**
- `player` (Pubkey): Who owns the shot.
- `command_nonce` (u64): Replay protection.
- `stake` (u64): CR tokens locked.
- `feed_id` (32 bytes): Pyth feed identifier.
- `entry_price` (u64), `entry_time` (u64): Recorded at entry.
- `expiry_time` (u64): Target boundary.
- `commit_hash` (32 bytes): `sha256(side, probability, salt)`.
- `checkpointed_price` (u64): Set during the Checkpoint Race.
- `checkpointed_time` (u64): Time of the checkpointed price.
- `status` (u8): Open(0), Checkpointed(1), Settled(2), Void(3).

### D. Replay Registry (`Receipt`)
**Purpose:** Prevent duplicate execution (re-spending the same off-chain command intent).
**Seeds:** `[b"receipt", command_nonce]`
**Size:** ~80 bytes
**Fields:**
- `executed_at` (u64): Block time of execution.
- `player` (Pubkey): Actor who executed it.

## 4. State Transitions (The Economic Kernel)

### `accept_shot`
- **Requires:** Signer (`player`), `Shot` PDA (uninitialized).
- **Action:** 
  1. Deducts `stake` CR from player's token account to the Vault.
  2. Creates the `Shot` PDA with the `commit_hash`.
  3. *Pessimistic Deduction:* Deducts maximum possible penalty from `PlayerLedger.xp` and `PlayerLedger.brier` metrics.

### `checkpoint_race`
- **Requires:** `Shot` PDA (status: Open), Pyth `PriceUpdateV2` account.
- **Action:** 
  1. Verifies `PriceUpdateV2.publish_time >= Shot.expiry_time`.
  2. Verifies confidence $\le 200$ bps.
  3. If `Shot.checkpointed_time` is null or `> PriceUpdateV2.publish_time`: Update the `Shot` with this new earliest valid price.

### `settle_shot`
- **Requires:** `Shot` PDA (status: Checkpointed), Signer (`player`).
- **Inputs:** `side`, `probability`, `salt`.
- **Action:**
  1. Verifies `sha256(side, probability, salt) == Shot.commit_hash`.
  2. Determines HIT/MISS based on `Shot.checkpointed_price` vs `Shot.entry_price`.
  3. Calculates actual XP and payout.
  4. Refunds the `PlayerLedger` the difference between actual score and the pessimistic deduction.
  5. Transfers CR tokens from Vault if HIT. Updates status to Settled.

### `void_shot`
- **Requires:** `Shot` PDA (status: Open or Checkpointed), Any Caller.
- **Action:**
  1. Verifies `current_time >= Shot.expiry_time + 900`.
  2. Transfers `stake` CR back to the player.
  3. Reverses the pessimistic deduction on `PlayerLedger`.
  4. Updates status to Void.

## 5. Hot Account Bottlenecks
By giving each player their own `PlayerLedger` and mapping shots to unique PDAs via `command_nonce`, we completely eliminate global write locks during `accept`, `checkpoint`, and `settle`. The only shared state is the global Vault token account, which Solana handles natively without locking the entire protocol.
