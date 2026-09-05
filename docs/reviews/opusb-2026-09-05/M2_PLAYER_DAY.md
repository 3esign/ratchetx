# M2 — PlayerDay: the rent, the trap, and the change

OpusB, 2026-09-05. Evidence tier: **host** (source read; no Rust edited, nothing built,
nothing sent). Written so that whoever holds the Rust editor role can land this in one pass.

## 1. What the gate row actually tests, and why that is not enough

`tools/mainnet-go-check.mjs:55` decides M2 with `!/PLAYER_DAY_SEED/.test(lib.rs)`. A grep cannot
separate *the rent went away* from *the day went away*, and those are different changes with
different consequences. Section 2 is the one that would have shipped.

The number in that row, `0.527 SOL/year`, is a hardcoded string. Derived from the struct instead:
`PlayerDay::LEN = 100` (`state.rs:401-403`), Anchor allocates `8 + LEN = 108` bytes, Solana rent is
`(128 + 108) × 3480 × 2 = 1,642,560` lamports, and a player who plays on 365 days funds 365 of them:
**0.600 SOL per year, per daily player**. `test/test_player_day_rent.mjs` derives this from the
struct so it cannot drift; the gate should read `PlayerDay::LEN` rather than quote a figure.

## 2. The trap: the obvious fix breaks every shot that crosses midnight

The natural reading of *"stop creating one account per player per day"* is to fold `accepted`,
`terminal` and `xp` into `PlayerLedger` — which already exists, already pays rent, and is one
account per player — and reset the counters when the day rolls over.

That is wrong, and the source says so:

| Fact | Where |
| --- | --- |
| `Shot.score_day` is frozen when the shot is sealed | `state.rs:239` |
| `authenticate_shot_score_accounts` requires `shot.score_day == player_day.day` | `lib.rs:4142-4157` |
| It is called on the **late** paths, not only at seal | `lib.rs:1606`, `:1702`, `:1832`, `:1899`, `:1983` |

Those late paths are `void_pending_entry`, `settle_final`, `finalize_resolved_void`,
`void_active_shot` and `reveal`. So a shot sealed on day D must still find a `PlayerDay` **for day
D** when it is revealed, which is hours or days later — and R3 is about to make the reveal deadline
relative to settlement, which makes that gap *longer*, not shorter.

One ledger with an in-place daily reset loses day D the moment day D+1 begins. Every shot in flight
across midnight becomes unrevealable — permanently, for that economy, because the economy is
write-once. **And the M2 grep would have gone green on it.**

`test/test_player_day_rent.mjs` now pins the two halves together: the per-day account and the
per-day authentication are either both present or both gone, and removing one turns the suite red
naming the other.

## 3. The change: PlayerDay becomes a buffer, exactly as the Need did

This is not a new pattern. M1 applied it to `TimepinNeedV2` this morning: `open_refs`, `rent_payer`,
and a close that refunds. The same three moves fit `PlayerDay` without touching day semantics,
without touching `score_day`, and without any shot in flight losing its day.

**3.1 — two fields on the struct** (`state.rs:389-403`, `LEN` 100 → 136)

```rust
pub open_refs: u32,     // shots whose score_day binds this account and have not terminalized
pub rent_payer: Pubkey, // the only address a close will ever refund
```

`LEN` must be recomputed, not guessed: `state.rs:2822` already asserts
`serialized_len(&PlayerDay::default()) == PlayerDay::LEN`, so a wrong number fails there first.
That assertion is the reason this is safe to change.

**3.2 — set them once, at creation** (`initialize_or_authenticate_player_day`, `lib.rs:4004-4027`)

Inside the `if player_day.schema == 0` branch only: `open_refs: 0`, and `rent_payer` = the account
that funds the init. Everything else in that function is unchanged, and `authenticate_player_day`
must **not** compare either field — they are lifecycle state, not identity.

**3.3 — count the references**

- **increment** in `record_accepted` (`lib.rs:4160`), which is where a shot first binds its
  `score_day`: it is called from all four seal paths (`lib.rs:1007`, `:1175`, `:1331`, `:1515`).
- **decrement** in `record_terminal` (`lib.rs:4176`), called from every terminal transition
  (`lib.rs:1635`, `:1857`, `:1928`, `:2080`, `:2240`, `:2305`).

The pairing is already exact — every shot that is recorded accepted is eventually recorded terminal
— which is why this needs no new bookkeeping. Decrement must saturate at zero rather than wrap.

**3.4 — one instruction**

`close_player_day(ctx)`: requires `player_day.open_refs == 0`, refunds the full lamport balance to
the recorded `rent_payer` and to nobody else, and is permissionless — anyone may call it, since the
refund address is fixed in the account and the caller cannot redirect it. Permissionless matters:
the player has no reason to come back and close yesterday's account, so somebody else has to be able
to, and the same argument the crank rests on applies here.

## 4. What must be true before M1 or M2 may read GO

`close_player_day` must **exist**, not be prepared for. As of this writing the Timepin program has
no close instruction at all — its whole instruction set is `register_evidence_spec`, `open_need`,
`open_work_manifest`, `open_work_page`, `reserve_work`, `capture_first`, `capture_conflict`,
`finalize`, `expire` — and the crate contains no `close =` attribute and no lamport return, while
the gate prints `M1 GO the Need can be closed and its rent returned`. Two fields landed; the
instruction that would spend them did not. M2 must not repeat that.

The row should assert the behaviour it names: a `pub fn` whose name contains `close`, or an Anchor
`close =` on the account — never a field name.

## 5. Tests that must fail first

1. `open_refs` is `0` at creation and `rent_payer` is the funder — not the signer of a later call.
2. Sealing a shot increments; terminalizing it decrements; the counter returns to zero.
3. `close_player_day` is **refused** while `open_refs > 0`.
4. `close_player_day` refunds `rent_payer`, not the caller, when a third party calls it.
5. A shot sealed on day D and revealed on day D+1 still authenticates — the midnight case, which is
   the one this whole document exists to protect. It should be written before the change and pass
   before and after it.
