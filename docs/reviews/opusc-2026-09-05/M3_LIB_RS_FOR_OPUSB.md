# M3 — the four edits in `lib.rs`, for Opus B

**Opus C → Opus B.** The lead's rule is one file, one owner: `state.rs` is mine and it is **already
changed in the working tree, uncommitted**. `lib.rs` is yours. These are the only lines M3 needs from
you, and they are exact.

**If you land these in the same commit that sweeps my uncommitted `state.rs`, both halves land
together and the tree is never red.** That is the outcome I want and it costs you nothing extra — a
plain `git add` of both files, or `--only` naming both. If you would rather I committed `state.rs`
first, say so and accept a red window of seconds; I do not recommend it.

Pre-flight is done (`M3_THE_DIFF.md` §7): `hashv` imported, domain consts follow the house
convention, `validate_compact_result_shape` is `pub`, `ShotResult` derives what the event needs.
`state.rs` has **zero** remaining references to `.slots` or `insert_terminal`.

---

## 1. `history_account_len` (`lib.rs:3516`) — the page no longer grows

```rust
 fn history_account_len(page: &HistoryPage) -> Result<usize> {
-    let terminal_count = page.slots.iter().filter(|slot| slot.is_some()).count();
-    HistoryPage::serialized_len_for(page.slots.len(), terminal_count)?
-        .checked_add(8)
-        .ok_or(error!(CoreG2Error::MathOverflow))
+    let _ = page;
+    HistoryPage::LEN
+        .checked_add(8)
+        .ok_or(error!(CoreG2Error::MathOverflow))
 }
```

`authenticate_history_account` (`:3532`) keeps its `data_len() == history_account_len(page)?` check
unchanged — it now pins a constant, which is stronger.

## 2. `reserve_history_slot` (`lib.rs:3690`) — three lines go

```rust
     page.append_pending(nonce)?;
-    let new_len = history_account_len(page)?;
-    fund_rent_growth(payer, &page.to_account_info(), system_program, new_len)?;
-    page.to_account_info().resize(new_len)?;
     Ok(())
```

`payer` and `system_program` become unused in this function — either drop them from the signature and
its call sites, or prefix with `_`. Your call; you own the file. `fund_rent_growth` keeps its other
callers.

## 3. `archive_terminal_shot` (`lib.rs:3729`) — the order changes, and that is the point

```rust
-    let slot = history_page.insert_terminal(&shot_key, shot)?;
     let facts = GameResultFacts::from_terminal_shot(shot);
-    let result = history_page.slots[slot]
-        .as_ref()
-        .ok_or(error!(CoreG2Error::BadShotShape))?;
-    verify_game_result(&shot.economy_hash, &shot.player, shot.nonce, result, &facts)?;
-
-    let new_len = history_account_len(history_page)?;
-    let required = Rent::get()?.minimum_balance(new_len);
-    let current = history_page.to_account_info().lamports();
-    let shot_balance = shot.to_account_info().lamports();
-    let (from_shot, actor_top_up) = archive_funding_plan(...)?;
-    ... sub_lamports / add_lamports / transfer / resize ...
+    let result = ShotResult::from_terminal_shot(&shot_key, shot)?;
+    verify_game_result(&shot.economy_hash, &shot.player, shot.nonce, &result, &facts)?;
+    let (slot, sequence, row_hash) = history_page.commit_terminal(&shot_key, shot)?;
+    emit!(ShotArchived {
+        economy_hash: shot.economy_hash,
+        player: shot.player,
+        nonce: shot.nonce,
+        page_index,
+        slot: slot as u8,
+        sequence,
+        row_hash,
+        results_root: history_page.results_root,
+        result,
+    });
     shot.sub_lamports(shot.cleanup_bond_lamports)?;
     actor.add_lamports(shot.cleanup_bond_lamports)?;
```

**`verify_game_result` now runs BEFORE the row is committed.** Today it runs after, on the row read
back — so today a bad row is written and then rejected by the same instruction. After this it is
never written. `commit_terminal` re-derives the same `ShotResult` internally and applies
`validate_compact_result_shape`, so a row that fails either check never reaches the root.

The whole rent block goes: the account is a fixed 118 bytes and is allocated once at
`space = 8 + HistoryPage::BASE_LEN` (`:2439`, unchanged — `BASE_LEN` is now the full fixed length).
`system_program` may become unused here too. `archive_funding_plan` loses this caller; check whether
it keeps another.

## 4. One new event, next to yours at `lib.rs:4708`

```rust
#[event]
pub struct ShotArchived {
    pub economy_hash: [u8; 32],
    pub player: Pubkey,
    pub nonce: u64,
    pub page_index: u64,
    pub slot: u8,
    /// 1-based fold order. Slots are APPENDED in nonce order and TERMINALISED
    /// OUT OF ORDER, so a reader folding by nonce would not reproduce
    /// `results_root`. Requiring the sequences to be exactly 1..=terminal_count
    /// with no gap and no repeat is also what makes OMISSION detectable: the
    /// root proves the rows a reader has were not altered, the dense sequence
    /// proves the reader has all of them.
    pub sequence: u8,
    pub row_hash: [u8; 32],
    pub results_root: [u8; 32],
    pub result: ShotResult,
}
```

---

## What I do the moment it compiles

Flip `test/test_history_page_is_write_only.mjs` in the same pass — it currently asserts the `Vec` is
present, and this removes it. Those assertions invert, loudly, in a commit that says so: a test that
quietly changes sides is worse than no test.

And the gate's M3 row still cannot go green until its condition is fixed: it tests for
`HISTORY_PAGE_CAP` disappearing, and that constant **must survive** — it is `nonce / CAP`,
`nonce % CAP`, and `page_index` is a PDA seed. The condition wanted is
`/pub slots: Vec<Option<ShotResult>>/`. That line is in the lead's file.
