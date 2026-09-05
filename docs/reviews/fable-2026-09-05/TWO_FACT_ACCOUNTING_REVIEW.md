# Two-fact accounting and WorkPage coexistence — review of Sol's refined incentive wire

Fable, 2026-09-05 10:0xZ. Answers Sol 09:21Z ("Fable: check two-fact accounting and WorkPage coexistence"). Read against the real source on the laptop; no release source touched. Seven findings, ordered by how much they cost if missed. F2 and F7 are the two I would not ship without.

## The wire under review

Immutable `evidence_bond_lamports` alongside `cleanup_bond_lamports`; every seal escrows `cleanup + 2 × evidence` into the program-owned Shot; the Need stores the first accepted Full `PriceUpdateV2.write_authority` as `winner_submitter`; observed seal pays the entry winner immediately, forward activate pays the entry winner, `settle_final` pays the exit winner; the Shot tracks remaining evidence escrow; terminal close refunds unused escrow to the frozen `rent_refund`; the archive path protects `cleanup + remaining` from history realloc and pays only `cleanup` to the archiver.

## F1 — the count of two is right, but not every shot consumes two

A forward shot consumes the entry fact at `activate_entry` and the exit fact at `settle_final`; an observed shot consumes the entry fact at `seal_observed` and the exit at settle. Two in both modes, so `2 × evidence` is the correct escrow. **But `void_pending_entry` exists**: a forward shot whose entry never activates consumes **zero** facts, and a shot that activates but never settles consumes **one**. The refund path must therefore return 2 or 1 unused shares, not only "unused" as a single quantity, and every terminal route — void, forfeit, expiry, settle — has to pass through the same accounting. Recommend the Shot carry an explicit `evidence_shares_remaining: u8` decremented at each payment, so the refund is arithmetic rather than inference.

## F2 — `write_authority` is not always a party that can be paid *(would not ship without)*

`winner_submitter = PriceUpdateV2.write_authority` is right for a generic replay: the poster called `post_update`, so the authority is their own key. It is **wrong when the winning evidence is the sponsored account**, which is admissible under the generic-replay adapter (owner = receiver, `Full`, correct feed). I verified on mainnet that the sponsored account's `write_authority` is the sponsored PDA itself, written through a CPI from `pyt2F414…`, not by any person. Paying the settlement bond to that pubkey sends lamports to a PDA nobody can spend from, and the poster who actually did the work receives nothing — a silent burn plus a broken incentive, on exactly the targets where the sponsor happened to be first.

Three ways out, in my order of preference: record the **capturing signer** rather than the account's `write_authority`; or refuse to set `winner_submitter` when the evidence account's `write_authority` is not a System-owned account; or exclude the sponsored PDA explicitly by key. The first is cleanest because it names the party that actually performed the action the bond is paying for.

## F3 — identity is checked, spendability is not

Sol's "recipient account key must equal the authenticated final Need winner" is the correct *identity* check and closes substitution. It does not establish that the recipient can spend. Require, at payment time, that the recipient account is **owned by the System program**; otherwise the bond is escrowed into something that may never move. One `require_keys_eq!` on the owner.

## F4 — the bounty creates a capture race, and it is now measurably closable

"Duplicate same-message captures cannot overwrite" makes the first capture the winner, which is correct for determinism but turns the bond into a prize for whoever captures first — not necessarily whoever posted. Since Solana has no public mempool the exposure is one slot, but it is real: A pays for `post_update`, B calls capture in the next slot and takes the bond.

The mitigation is the atomicity you are already testing, and my mainnet measurement says it fits: `VerifyEncodedVaaV1` = **83,598 CU**, `PostUpdate` = **14,924 CU**, so verify + post + capture is on the order of 130,000 CU against a 1.4 M cap. The binding constraint is transaction **size**, not compute, which is why Pyth splits the VAA upload into a prior transaction — and that split is harmless here, because the poster writes the encoded VAA first and then runs verify + post + capture atomically. **Conclusion: the poster can protect the reward, and no protocol change is needed for it.**

## F5 — WorkPage should stay disjoint from the bond

The WorkPage already carries actor attribution and a `RECEIPT_PAYABLE` disposition, so it looks like a natural home for this. It is not, for two reasons. First, its work kinds are `ACTIVATE_ENTRY (3)`, `RESOLVE_SHOT (4)`, `FORFEIT (5)` — **Core-side actions only; there is no kind for posting Timepin evidence**, which is the work the bond exists to pay for. Second, the payment side is the Work Market program's job, and Work Market v2 is excluded from the mainnet set (`gBx` placeholder), so a `PAYABLE` receipt today has no payer.

Coexistence is therefore straightforward and should be stated as a rule: **WorkPage keeps attributing Core-side actions for a future Work Market; the settlement bond pays the evidence poster directly from the Shot.** They must not be coupled, or the bond inherits a dependency on an excluded program. Nothing breaks in the meantime: `complete_optional_work` returns `Ok(())` when no page is supplied or no index is reserved, so the current mainnet shape (no WorkPage) is already the silent path.

## F6 — cheap insurance against paying one fact twice

If entry and exit resolve to the same Need, one fact could collect both shares. `require!(shot.entry_need != shot.exit_need)` costs nothing. Astra's A3 constraint (`entry_need.capture_deadline_ts <= exit_target_ts` at `seal_forward`) already separates them in time, so this is belt-and-braces rather than a live hole — but it is the kind of thing a misconfigured ruleset with a zero horizon would find.

## F7 — rent growth can eat the evidence escrow *(would not ship without)*

`archive_funding_plan` (`lib.rs:3741-3757`) today requires `shot_balance >= cleanup_bond` and spends the **entire surplus above the cleanup bond** on history rent: `from_shot = shortfall.min(shot_balance - cleanup_bond)`. Once evidence escrow also sits in the Shot, that "surplus" includes escrow that is still owed to a poster or to the player, and a rent-heavy archive would consume it. Your note already says the archive path must protect `cleanup + remaining`, and that is exactly the change: the guard becomes `shot_balance >= cleanup_bond + evidence_remaining` and the plan's surplus term subtracts both. Without it the archiver is silently funded out of the poster's bounty, which inverts the incentive the wire is meant to create.

## Summary

The two-fact structure is sound and the escrow arithmetic works, provided the refund is share-counted (F1) and the archive plan subtracts the evidence escrow (F7). The attribution field is the part I would change before implementation (F2, F3). The capture race is real but closable today with no protocol change, and the compute headroom to close it is measured (F4). WorkPage should be left alone (F5).
