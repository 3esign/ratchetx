# M3 — the pages: measure first, and the answer splits in two

**Opus C, 2026-09-05.** Gate row M3, delegated by the lead at 13:47Z. **Evidence tier: `host`**, all
of it from the source in this tree; no cargo, no cluster.

The lead asked, in this order: *measure first whether WorkPage is even created when nobody sponsors
work; then propose the commitment-hash form for HistoryPage with the exact reconstruct-and-verify
path; and if a page is genuinely needed for on-chain reads, say which instruction reads it and I
will drop this.* I looked for the disqualifying evidence first. **I found some — for one of the two
pages, and it is the one that turns out not to matter.**

---

## 1. The headline number sums a mandatory cost and an optional one

The gate reports **0.00323 SOL per shot, 11.8 SOL/year at ten shots a day**. That is the sum of two
different things:

| | size | rent @ 6,333/(128+len) | per shot | 10 shots/day | mandatory? |
| --- | --- | --- | --- | --- | --- |
| HistoryPage | 79 + 16×166 = **2,735 B** | 0.018131 SOL / 16 shots | **0.001133 SOL** | **4.14 SOL/yr** | **yes** |
| WorkPage | 79 + 48×106 = **5,167 B** | 0.033533 SOL / 16 shots | 0.002096 SOL | 7.65 SOL/yr | **no** |
| total | | | 0.003229 SOL | 11.79 SOL/yr | |

**Sixty-five percent of the headline is the optional half.**

### WorkPage costs nothing when nobody sponsors work — measured

`load_optional_work_page` (`lib.rs:3550-3578`) returns `Ok(None)` when the account
`is_logically_uninitialized` (`lib.rs:3769`: zero data **and** system-owned **and** not executable —
deliberately not "zero lamports", so a dust sender cannot fabricate a veto). `complete_optional_work`
(`lib.rs:3595`) then returns `Ok(())` and the instruction proceeds. Every `work_page` binding in the
eleven `Accounts` structs is an `UncheckedAccount` authenticated in the handler, never `init`.

So a shot whose work nobody sponsors creates **no WorkPage and locks no rent**. The 7.65 SOL/year is
a worst case in which every shot's work is sponsored, not a charge on players.

### HistoryPage is genuinely per shot, and the player pays

It is not a lump: `reserve_history_slot` (`lib.rs:3649`) appends one pending slot and calls
`fund_rent_growth(payer, …)`; `archive_terminal_shot` (`lib.rs:3684`) inserts the terminal row,
recomputes `history_account_len` and funds the growth from the **shot's own lamports first**
(`archive_funding_plan`), topping up from the actor. The account resizes each time. So the amortised
0.001133 SOL/shot is the real shape — proportional, not pre-paid — and it is paid by the player.

---

## 2. Nothing on chain ever reads a HistoryPage row

This is the question that decides whether the commitment form is available, so it is the one I tried
hardest to falsify.

- **Eleven** `Accounts` structs bind `history_page` (`OpenHistoryPage`, `SealForward`,
  `SealForwardDelegated`, `SealObserved`, `SealObservedDelegated`, `VoidPendingEntry`,
  `FinalizeResolvedVoid`, `VoidActiveShot`, `RevealShot`, `RevealDelegatedShot`, `ForfeitShot`).
  **Every one of them is `#[account(mut, …)]`.** There is no reader binding.
- `slots[` appears **once** in the whole program outside tests: `lib.rs:3701`, inside
  `archive_terminal_shot`, and it reads back **the slot the same instruction inserted two lines
  earlier** in order to run `verify_game_result` on it. It never touches another slot. That read can
  be served by the value before it is written.
- `validate_contents()` (`state.rs:1372`) iterates the page's own slots — a self-consistency check on
  data that would not exist under a commitment form, not a consumer of it.
- Ordering does **not** need the rows. The slot for a shot is `history_page_slot(nonce)`, pure
  arithmetic on the nonce (`state.rs:1325`), and append order is enforced by `append_pending`.

**Verdict: HistoryPage is a write-only archive.** The commitment-hash form is available.

## 3. WorkPage rows ARE read — and this is the disqualifying evidence I was asked to look for

`lib.rs:368`: `page.records[index].disposition == RECEIPT_PENDING`. The work-completion path looks a
record up by `(subject, work_kind)` and reads its disposition to decide whether the receipt may be
completed. That is a genuine on-chain read of stored row content, and **the commitment-hash form does
not apply to WorkPage as it stands.**

It also does not need to. WorkPage is the optional half: absent by default, created only when someone
wants a work receipt, paid for by whoever wants it. The lead called it "the same and worse". It is
the opposite shape — worse to convert, and not a charge on players at all.

## 4. ReloadHistoryPage — a third instance, and the read is a COUNT

`validate_next_nonce` (`state.rs:1540-1552`) requires `slot == self.records.len()`. It reads the
**length**, never a record's contents. A commitment form that keeps `records_len` alongside the
rolling hash preserves that check exactly. Same treatment as HistoryPage, 32 records of
`ReloadRecord::LEN = 8 + 32 + 8 + PODIUM_SEAT_COUNT` each.

---

## 5. The commitment form for HistoryPage, exactly

Replace `slots: Vec<Option<ShotResult>>` with two fields:

```rust
pub terminal_count: u8,          // how many rows the chain has committed to
pub results_root: [u8; 32],      // rolling commitment over those rows, in nonce order
```

**Write path**, in `archive_terminal_shot`, replacing the insert:

```
result      = ShotResult::from_terminal_shot(shot_key, shot)   // unchanged, built in memory
verify_game_result(economy_hash, player, nonce, &result, &facts)?   // unchanged, on the local value
row_hash    = hashv(&[ROW_DOMAIN, &nonce.to_le_bytes(), &result.try_to_vec()?])
results_root = hashv(&[CHAIN_DOMAIN, &results_root, &row_hash])
terminal_count += 1
emit!(ShotArchived { player, nonce, page_index, slot, result, row_hash, results_root })
```

The account never grows: 79 bytes of header plus 33, fixed, for the life of the page. **The row is
still verified before it is committed to** — `verify_game_result` runs on the local value, exactly as
it does today on the read-back copy.

**Reconstruct-and-verify path**, off chain, for anyone:

1. `getSignaturesForAddress(history_page_pda)` and pull every transaction that emitted
   `ShotArchived` for that page. This is the same ledger walk `ledger-cadence.mjs` already does for
   Pyth writes, and it needs no key and no index.
2. Sort by `nonce`. Rebuild `row_hash` for each row from the emitted `ShotResult` bytes.
3. Fold: `h = CHAIN_DOMAIN` then `h = hashv(&[CHAIN_DOMAIN, h, row_hash])` in nonce order.
4. Assert `h == results_root` **and** `rows.len() == terminal_count` read from the chain.

The two together are what make it sound: the root proves **nothing was altered**, and the count
proves **nothing was omitted**. A root alone is satisfiable by a shorter list.

**What this costs and what it buys.** A reader must walk logs instead of reading one account — that
is a real loss for a naive client and no loss at all for the one client that exists, which already
walks the ledger. It buys: **2,735 B → 112 B**, 0.001133 SOL/shot → **0.0000 SOL/shot**, and the
4.14 SOL/year becomes a fixed 79+33 bytes per sixteen shots. It also removes the resize-and-fund
machinery (`archive_funding_plan`, `fund_rent_growth`, the cleanup-bond top-up) from the settle path.

## 6. What I am not claiming

- Not that this is free. Log retention is a real dependency, and a validator that prunes is a reader
  that cannot reconstruct. The root and count remain on chain forever; the **rows** live in history.
  That is Semir's "carry it parasitically" rule, and it is his call whether the archive is worth that.
- Not that WorkPage should be converted. §3 says it should not, as it stands.
- Not that I can implement it. No cargo. This is a proposal plus the exact write and verify paths;
  the Rust belongs to whoever holds Core G2.
- Not that 11.8 SOL/year is wrong — it is right for the worst case. It is 4.14 for the case where
  nobody sponsors work, and that distinction is the whole of §1.
