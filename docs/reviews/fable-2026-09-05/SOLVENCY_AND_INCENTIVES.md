# Solvency and incentives, bound to the actual ledger — who pays for a PNAU posting, and can the cleanup bond honestly cover it

Fable, 2026-09-05 09:0xZ. Answers Sol 05:04Z ("bind VOID+refund and the permissionless bounty to the ACTUAL G2 ledger/economy, prove solvency and the incentive source exactly, identify every party who can gain from silence, no abstract house purse and no restored CrankPurse") and 05:39Z ("final solvency/incentive verdict — especially who pays PNAU posting and whether cleanup_bond can honestly cover it"). Executable: `v3-rule/settlement_economy.mjs` + `v3-rule/test_settlement_economy.mjs`, 8/8. Every claim below is read from the laptop's own tree, with line numbers; nothing is inferred from docs.

## 0. Verdict in four lines

1. **Today exactly one role is funded: archiving.** The cleanup bond is escrowed by the player into the Shot at open and paid to whoever archives the terminal shot. **Opening a Need, posting PNAU evidence, capturing, finalizing and expiring are all unfunded**, and Timepin moves lamports in exactly one place, for rent, never as a reward.
2. **Can the cleanup bond cover a PNAU posting? By size yes, by wiring no.** Posting costs ~45,000 lamports; the bond may be up to 1,000,000. But the bond is escrowed in the *Shot*, paid to the *archiver*, and `TimepinNeedV2` has **no lamport field and no submitter field**, so no path exists from that money to the party who posted the price. The honest answer to Sol is: *not too small — simply not connected.*
3. **The minimal honest wire** uses only money the player already escrows: split the existing bond into an archive part (today's behaviour, unchanged) and a settlement part paid at settle time to the submitter the Need records. No purse, no house funds, no CrankPurse, no new funding source. Solvency is structural: every payout was pre-funded at open, and the model refuses to pay more than the escrow rather than borrowing (test E2).
4. **The manifest is economically incoherent at its own minimum.** `minStake = 100` lamports while a posting costs ~45,000. Whatever fee attracts a poster is ~450× the entire bet. A value-bearing lane needs a minimum stake around **4,500,000 lamports (≈0.0045 SOL)** for the fee to be ≤1% of the bet.

## 1. What the source actually says

| fact | where |
| --- | --- |
| `MIN_CLEANUP_BOND_LAMPORTS = 5_000`, `MAX = 1_000_000` | `ratchet-core-g2/src/state.rs:82-83` |
| the bond is transferred **from the player to the Shot account at open** | `lib.rs:3666-3683` (`deposit_cleanup_bond`), called at `1001, 1169, 1325, 1509` |
| at archive the bond leaves the shot and goes **to the actor** | `lib.rs:3729-3730` (`shot.sub_lamports(bond); actor.add_lamports(bond)`) |
| the bond is **never** consumed by rent growth; any shortfall past the shot's surplus is **the actor's to pay** | `lib.rs:3741-3757` (`archive_funding_plan`) |
| `TimepinNeedV2 { schema, bump, state, evidence_spec_hash, target_ts, source_deadline_ts, capture_deadline_ts, candidate_a_hash, candidate_b_hash }` — **no lamports, no submitter** | `rcx-timepin-v2/src/lib.rs:359-372` |
| the Need is created by whoever calls `open_need`, who pays its rent; there is **no close**, so that rent is sunk | `lib.rs:246-268` (`OpenNeed`, `payer = actor`) |
| the **only** lamport transfer in Timepin is `fund_rent_growth` | `lifecycle.rs:774-796` |

So the permissionless-role ledger today is:

| role | who pays | who is paid |
| --- | --- | --- |
| open the Need | actor (rent, sunk) | nobody |
| post PNAU evidence (4–6 tx, ~0.5 M CU) | poster | **nobody** |
| capture / finalize / expire | actor | nobody |
| archive the terminal shot | actor (only if rent short) | actor, the cleanup bond |

## 2. The cost being funded

One keyless posting per `(feed, target)`: encoded-VAA init + write + `verify_encoded_vaa_v1` + `post_update` + closes ≈ **5 signatures × 5,000 = 25,000 lamports**, plus priority to land inside the window (**~20,000** assumed), so **~45,000 lamports** out of pocket. The ~0.0138 SOL of encoded-VAA and `PriceUpdateV2` rent is **transient and reclaimed on close**, so it is working capital, not cost. Archiving is one signature, 5,000 lamports.

The decisive structural fact: **one posting settles every shot on that `(feed, target)`.** Cost is per target; bond revenue is per shot. So the economics improve exactly where more money rides on the target — provided the wire exists.

## 3. The wire, and why it is the minimal one

At open the player already escrows `cleanup_bond_lamports` into the Shot. Split it:

- `archive_bond` — unchanged, paid to the archiver at archive (today's code path untouched).
- `settlement_bond` — paid at settle time, from the Shot, to the submitter recorded on the Need.

This needs exactly one new field, `winner_submitter: Pubkey`, on `TimepinNeedV2` (`LEN` 124 → 156), set when a submission becomes the winner, plus a transfer at settle from the Shot to that pubkey. Nothing else changes: no purse account, no house balance, no CrankPurse, no new source of funds. The money is the player's, escrowed at open, and it pays the two permissionless jobs the game depends on.

**Solvency proof (tests E1, E2).** Total payouts per shot are bounded by the escrow deposited at open; the model decrements escrow and refuses `ESCROW_EXHAUSTED` rather than borrowing. Conservation is asserted, not assumed: escrow before equals escrow after plus everything paid, and every paid lamport lands in a named actor's balance. The program cannot mint and cannot be drained, in any ordering.

**Break-even (test E4).** With `bond = 300,000` split 1:2, `settlement_bond = 200,000` and a 45,000-lamport posting: **k\* = 1** — a single shot already pays for the posting, and three shots pay the poster 600,000 for one 45,000 job. At the on-chain **minimum** bond of 5,000 the settlement part is 3,333 and **k\* = 14** — posting only pays once fourteen shots share the target. That is the number Sol asked for, and it is the one the manifest must be set against.

**Today's number (test E3).** With the source-accurate wire the poster's profit is `−cost` at every k, and `breakEvenShots` is `Infinity`. There is no k at which anyone rationally posts.

## 4. Every party who can gain from silence, with amounts

Modelled at `stake = 10,000,000`, payout `17,000,000` (17/10), bond 300,000 (test E7):

| party | gain from silence under VOID+refund |
| --- | --- |
| the side about to **lose** the shot (player) | **10,000,000** — it recovers its stake |
| the side about to **lose** the shot (counterparty/house) | **7,000,000** — it avoids paying the win |
| the side about to **win** | 0 |
| the **archiver** | **0** — the bond is paid identically on VOID and on FINAL (test E6), so archiving is not a settlement incentive and the archiver is neutral, by construction |
| a **third party** | 0 from silence; **+200,000 − 45,000** from breaking it |

The asymmetry to state plainly: **silence is worth millions to the loser, and breaking it earns 200,000.** Silence is *not* defeated by outbidding it — it is defeated by the fact that breaking it is profitable *for someone with no position at all* (test E8). One profitable independent poster removes the entire gain, because the loser cannot prevent anyone else from posting. This is why the permissionless-access result matters economically and not just cryptographically: it converts a millions-scale manipulation into something any stranger profitably prevents for 200,000 lamports.

The corresponding danger, stated equally plainly: **if the settlement wire is absent (today), the only parties with a reason to post are the ones with a position, and exactly half of them have a reason not to.** That is the hole under VOID+refund, and it is an economics hole, not a cryptography one.

## 5. The min-stake incoherence (test E5)

`minStake = 100` lamports in `g2-mainnet-economy.proposal.json`, while attracting a lone poster costs ~45,000. The fee-to-bet ratio at the minimum stake is **450×**. `openShot` accepts the combination and nothing on chain forbids it, so this must be fixed in the manifest, not assumed away:

- For the fee to be ≤ 1% of the bet with `k = 1`: **minStake ≥ 4,500,000 lamports (~0.0045 SOL)**.
- Or keep small stakes and accept `k*` > 1, i.e. small shots only settle when several share a target — which is a liveness dependency on other players and should not be sold as a guarantee.
- Or scale the bond with the stake, so the fee is a fixed percentage — my recommendation, since it keeps one rule at every size.

## 6. Recommendation

1. **Do not ship VOID+refund with the current ledger.** With no settlement wire, the refund option is available to the losing side and nobody is paid to close it. My 04:52Z recommendation of B assumed posters exist; the ledger says they are unpaid. B is correct *only together with* the wire in §3.
2. **Add the settlement split and the `winner_submitter` field** — one field, one transfer, no purse. Then B is honest and the `qⁿ` model has real n, because n is "everyone for whom `k × settlement_bond > cost`", which at sane parameters is anyone with a VPS.
3. **Set the manifest against `k* = 1`**: `cleanup_bond` ≈ 300,000 lamports split 1:2, and `minStake` ≥ 4,500,000 — or make the bond proportional to stake.
4. **Do not fund any of this from the house.** Everything above is the player's own escrow, which is what makes the solvency proof trivial and the game unable to owe anyone anything.

## 7. Limits

- The wire in §3 is a *proposal against read source*, not a patch; I have written no release source tonight and this needs Astra's adversarial pass on the field addition and the settle-time transfer, and Sol's decision on where the submitter is recorded (Need vs a per-shot receipt).
- `postingCost` assumes 5 signatures and a 20,000-lamport priority. Sol's devnet numbers supersede both, and every threshold in §3–§5 moves linearly with them: `k* = ceil(cost / settlement_bond)`.
- The 17/10 payout, the bond bounds and the stake bounds are read from source and the manifest; if the manifest changes, re-run the model rather than re-reading this note.
