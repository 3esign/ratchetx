# M3 — the HistoryPage change, written out before it is applied

**Opus C, 2026-09-05.** The Rust for gate row M3, in the shape the lead used for the inline-observation
prototype at 12:37: **readable before it is applied**. Premise and evidence are in `M3_THE_PAGES.md`
(`396ca81`), enforced by `test/test_history_page_is_write_only.mjs` (`ea76c6c`).

**Evidence tier: `host`.** I have no cargo. Svemir compiles.

---

## 0. A correction to my own proposal, found by reading the code I was about to change

`M3_THE_PAGES.md` §5 says reconstruction folds the rows **in nonce order**. That is wrong, and the
code says so: `state.rs:3311` is named
`history_pages_append_sequentially_and_terminalize_out_of_order_once`. Slots are **appended** in nonce
order but **terminalised out of order** — a shot sealed later can settle first.

A rolling hash `H(prev, row)` depends on fold order, so folding by nonce would not reproduce a root
built by insertion. Two ways out, and only one of them is honest:

- ~~make the accumulator commutative (XOR)~~ — no. XOR cancels: two identical rows vanish, and an
  attacker who can choose rows can cancel any pair.
- **emit a sequence number and fold by it.** Each insertion emits `sequence = terminal_count` *after*
  the increment, so the events carry their own fold order. The verifier sorts by `sequence`, requires
  it to be exactly `1..=terminal_count` with no gaps and no repeats, and folds in that order.

The sequence check is not decoration. It is what makes **omission** detectable in a way the root alone
cannot: a root proves the rows you have were not altered; a dense `1..=N` sequence proves you have all
of them. §5 of the other document is superseded by this section.

## 1. `state.rs` — the struct

```rust
 pub struct HistoryPage {
     pub schema: u16,
     pub bump: u8,
     pub economy_hash: [u8; 32],
     pub player: Pubkey,
     pub page_index: u64,
-    pub slots: Vec<Option<ShotResult>>,
+    /// Slots appended so far, 0..=HISTORY_PAGE_CAP. Replaces `slots.len()`.
+    pub pending_count: u8,
+    /// Bit i set = slot i has been terminalised. Replaces `slots[i].is_some()`
+    /// and is what keeps terminalise-once enforceable while allowing the
+    /// out-of-order terminalisation state.rs:3311 pins.
+    pub terminal_mask: u16,
+    /// Rolling commitment over the terminal rows, in insertion order.
+    pub results_root: [u8; 32],
 }

 impl HistoryPage {
-    pub const BASE_LEN: usize = 2 + 1 + 32 + 32 + 8 + 4;
-    pub const MAX_LEN: usize = Self::BASE_LEN + HISTORY_PAGE_CAP * (1 + ShotResult::LEN);
+    // Fixed. There is no Vec, so there is no length prefix and no growth.
+    pub const LEN: usize = 2 + 1 + 32 + 32 + 8 + 1 + 2 + 32;   // 110
+    pub const BASE_LEN: usize = Self::LEN;   // kept so callers need no edit
+    pub const MAX_LEN: usize = Self::LEN;
 }
```

`HISTORY_PAGE_CAP` **stays**: it is the paging arithmetic (`nonce / CAP`, `nonce % CAP`) and
`page_index` is a PDA seed. Only the storage goes.

**2,743 B → 118 B**, fixed for the life of the page, never resized.

## 2. `state.rs` — the three methods

```rust
 pub fn validate_contents(&self) -> Result<()> {
     require!(
         self.schema == CORE_SCHEMA_VERSION
             && self.economy_hash != [0; 32]
             && self.player != Pubkey::default()
-            && self.slots.len() <= HISTORY_PAGE_CAP,
+            && (self.pending_count as usize) <= HISTORY_PAGE_CAP
+            // no bit may be set above the slots actually appended, and none
+            // above the cap: a mask wider than the page is a corrupt page
+            && self.terminal_mask >> self.pending_count == 0
+            && (self.terminal_count() as usize) <= self.pending_count as usize,
         StateError::InvalidHistoryPage
     );
-    for slot in &self.slots { ... validate_compact_result_shape(result)? ... }
     Ok(())
 }
+
+pub fn terminal_count(&self) -> u8 { self.terminal_mask.count_ones() as u8 }
```

`validate_compact_result_shape` does not disappear — it moves to the **write** path in
`archive_terminal_shot`, where it now runs on the row being committed instead of re-running on rows
committed long ago. That is strictly earlier, not weaker.

```rust
 pub fn append_pending(&mut self, nonce: u64) -> Result<usize> {
     self.validate_contents()?;
-    require!(self.slots.len() < HISTORY_PAGE_CAP, StateError::HistoryPageFull);
+    require!((self.pending_count as usize) < HISTORY_PAGE_CAP, StateError::HistoryPageFull);
     let slot = history_page_slot(nonce);
     require!(
-        history_page_index(nonce) == self.page_index && slot == self.slots.len(),
+        history_page_index(nonce) == self.page_index && slot == self.pending_count as usize,
         StateError::HistoryAppendOutOfOrder
     );
-    self.slots.push(None);
+    self.pending_count += 1;
     Ok(slot)
 }

-pub fn insert_terminal(&mut self, shot_key: &Pubkey, shot: &Shot) -> Result<usize> {
+/// Returns (slot, sequence, row_hash). `sequence` is 1-based and is the fold
+/// order the off-chain verifier must use.
+pub fn commit_terminal(&mut self, result: &ShotResult, nonce: u64) -> Result<(usize, u8, [u8; 32])> {
     self.validate_contents()?;
-    require!(self.economy_hash == shot.economy_hash && self.player == shot.player, ...);
-    require!(history_page_index(shot.nonce) == self.page_index, ...);
-    let slot = history_page_slot(shot.nonce);
-    let destination = self.slots.get_mut(slot).ok_or(...)?;
-    require!(destination.is_none(), StateError::HistorySlotAlreadyTerminal);
-    *destination = Some(ShotResult::from_terminal_shot(shot_key, shot)?);
-    self.validate_contents()?;
-    Ok(slot)
+    require!(history_page_index(nonce) == self.page_index, StateError::InvalidHistoryPage);
+    let slot = history_page_slot(nonce);
+    require!(slot < self.pending_count as usize, StateError::HistorySlotMissing);
+    let bit = 1u16 << slot;
+    require!(self.terminal_mask & bit == 0, StateError::HistorySlotAlreadyTerminal);
+    let row_hash = hashv(&[
+        HISTORY_ROW_DOMAIN,
+        &nonce.to_le_bytes(),
+        &result.try_to_vec()?,
+    ]).to_bytes();
+    self.results_root = hashv(&[HISTORY_CHAIN_DOMAIN, &self.results_root, &row_hash]).to_bytes();
+    self.terminal_mask |= bit;
+    self.validate_contents()?;
+    Ok((slot, self.terminal_count(), row_hash))
 }
```

The economy/player equality checks move to the caller, which already has the `Shot`; everything else is
the same predicate expressed against a mask instead of a `Vec`.

## 3. `lib.rs` — the two call sites

```rust
 fn reserve_history_slot(...) -> Result<()> {
     authenticate_history_account(page, page.key(), &economy_hash, &player, page_index)?;
     page.append_pending(nonce)?;
-    let new_len = history_account_len(page)?;
-    fund_rent_growth(payer, &page.to_account_info(), system_program, new_len)?;
-    page.to_account_info().resize(new_len)?;
     Ok(())
 }
```

The account never grows, so the growth funding and the resize go with it. `fund_rent_growth` keeps its
other callers.

```rust
 fn archive_terminal_shot(...) -> Result<()> {
     let shot_key = shot.key();
     let page_index = history_page_index(shot.nonce);
     authenticate_history_account(history_page, history_page.key(), &shot.economy_hash, &shot.player, page_index)?;
+    require!(
+        history_page.economy_hash == shot.economy_hash && history_page.player == shot.player,
+        CoreG2Error::BadShotShape
+    );
+    let result = ShotResult::from_terminal_shot(&shot_key, shot)?;
+    validate_compact_result_shape(&result)?;
+    require!(result.game_result_hash != [0; 32], CoreG2Error::BadShotShape);
     let facts = GameResultFacts::from_terminal_shot(shot);
-    let slot = history_page.insert_terminal(&shot_key, shot)?;
-    let result = history_page.slots[slot].as_ref().ok_or(...)?;
-    verify_game_result(&shot.economy_hash, &shot.player, shot.nonce, result, &facts)?;
+    verify_game_result(&shot.economy_hash, &shot.player, shot.nonce, &result, &facts)?;
+    let (slot, sequence, row_hash) = history_page.commit_terminal(&result, shot.nonce)?;
+    emit!(ShotArchived {
+        economy_hash: shot.economy_hash, player: shot.player, nonce: shot.nonce,
+        page_index, slot: slot as u8, sequence, row_hash,
+        results_root: history_page.results_root, result,
+    });
-    let new_len = history_account_len(history_page)?;
-    ... archive_funding_plan / add_lamports / resize ...
     shot.sub_lamports(shot.cleanup_bond_lamports)?;
     actor.add_lamports(shot.cleanup_bond_lamports)?;
     Ok(())
 }
```

**`verify_game_result` now runs BEFORE the commit, on the row about to be committed.** Today it runs
after, on the row read back. Strictly earlier: a row that fails verification is no longer written at
all, where today it is written and then rejected by the same instruction.

`history_account_len` and `archive_funding_plan` lose their HistoryPage callers. `open_history_page`
allocates `8 + HistoryPage::LEN` once and never resizes.

## 4. The event, and the verifier

```rust
#[event]
pub struct ShotArchived {
    pub economy_hash: [u8; 32],
    pub player: Pubkey,
    pub nonce: u64,
    pub page_index: u64,
    pub slot: u8,
    pub sequence: u8,          // 1-based fold order — the whole point of §0
    pub row_hash: [u8; 32],
    pub results_root: [u8; 32],
    pub result: ShotResult,
}
```

Off chain, for any page:

1. Walk `getSignaturesForAddress(history_page_pda)` and collect every `ShotArchived`.
2. Require the `sequence` values to be exactly `1..=terminal_count` — **no gap, no repeat**. This is
   the omission check and it is not optional.
3. Fold in `sequence` order: `h = 0u8;32`, then `h = H(CHAIN_DOMAIN, h, row_hash)`.
4. Assert `h == results_root` read from the account, and that each `row_hash` equals
   `H(ROW_DOMAIN, nonce, result)` for the row it came with.

Root proves nothing was **altered**. Dense sequence against the on-chain `terminal_count` proves
nothing was **omitted**. Neither alone is enough and I would not let either be dropped.

## 5. What this costs, honestly

- A reader must walk logs instead of reading one account. Real cost for a naive client; none for the
  only client that exists, which already walks the ledger.
- **Log retention is now a dependency.** The root and the count are permanent; the rows are not. An
  archival RPC or an indexer becomes load-bearing for anyone who wants the list back. That is Semir's
  "carry it parasitically" trade and it is his call, not mine.
- `test/test_history_page_is_write_only.mjs` **inverts**: it currently asserts the `Vec` is present,
  and this removes it. Those assertions flip in the same commit, stated loudly, because a test that
  quietly changes sides is worse than no test.

## 6. What I am not doing

No cargo, so I compile nothing and I claim no build. The `#[account]` layout change is an **ABI
break**: it must land in the same pass as the other ABI changes and before `register_economy`.
