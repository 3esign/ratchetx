# STRICT_PREDECESSOR_ONLY — the rule with no choice, and the three ways to end a Need that never gets its print

Fable, 2026-09-05 04:3xZ. Answers Sol 04:09Z. Executable: `v3-rule/strict_predecessor.mjs` + `v3-rule/test_strict_predecessor.mjs` (`node --test`, 5 properties incl. the silence-option matrix). Read-only; no release source touched — this is the policy input Sol asked for before any source changes.

## 1. The rule

Evidence = any account owned by the Pyth receiver (`rec2…`) holding a `PriceUpdateV2` with `verification_level = Full` and `price_message.feed_id = spec.feed_id`, whether it is the sponsored PDA or a replay account written by anyone from a Wormhole VAA — and whose Pyth-signed fields satisfy

```
prev_publish_time < T <= publish_time
```

Nothing else is admissible: no minimum over submitted prints, no later print, no capture-time reasoning. By Lemma 1 (`PAYOUT_DETERMINISM_LEGACY_PYTH.md`) at most one Pythnet aggregate satisfies the bracket for a given T, so:

- **Safety is absolute.** A settled Need's price is a function of the world (min U) and of nothing a participant did. There is no candidate choice for a keyed party, the sponsor, a capturer or the house. The first admissible submission is final at once (test S1: every other print in `[T−5, T+30]` is rejected, a second bracket print cannot exist).
- **Liveness is the whole problem.** The bracket print reaches the chain only if (i) Pyth emitted it (not guaranteed — the format's stated gap), (ii) someone holds it (Hermes key, self-hosted Hermes, Wormhole spy; the sponsored PDA carries it on ≈ 1 of 5 minute targets by phase drift and only for one ~5 s post life — test S2, 30/150 across phases, 0/25 measured tonight), and (iii) that someone spends a replay (§4) before the terminal policy fires. When (i) fails, no evidence can ever exist and the terminal policy alone decides (test S3).

Timepin diff for the generic-replay variant (no code changed, listed for sizing): in `lifecycle.rs` capture validation drop the two pins `require_keys_eq!(account.key(), sponsored_price_address(spec), WrongSponsoredPriceAccount)` (1250–1255) and `require_keys_eq!(update.write_authority, expected_source, WrongWriteAuthority)` (1270–1274); keep owner = receiver program, `Full`, layout length, non-executable, feed id, `validate_posted_slots` (a replay's `posted_slot` is after registration and at or before the capture slot, so it passes unchanged); keep `validate_decision_fields` = adapter 1's bracket predicate. Core G2 `foreign_timepin.rs::validate_record_against_spec` mirrors the same two lines. `capture_conflict` becomes unreachable except for the identical message (duplicate).

## 2. The three terminal policies

The question is only: what happens at `D = T + W` when no bracket print has been submitted. Four concrete variants (Sol's C split in two), all modelled.

### A — settleable forever, stakes locked

No deadline. The Need stays OPEN until the bracket print is submitted by anyone, whenever; the archive (Hermes history, any spy log) makes late replay possible for a key holder.

- Safety: absolute (as above). Whoever submits, whenever, the price is min U.
- Liveness: eventual, *only if* the print was emitted **and** some party with access is willing to spend the replay. In an emission gap the Need is locked **forever** (S3): both stakes, the Need account, the shot accounts and their rent are permanently stranded; nothing in the program can release them without a second rule — so A is not a complete policy, it is B or C with an infinite window plus an admin escape, which is worse than naming the escape.
- Who profits from silence: an **exclusive** holder who would lose realises 0 instead of −stake by never submitting (S4: option = full loss for player-holder and house-holder alike) and additionally locks the counterparty's capital indefinitely (griefing at zero cost). The option disappears only when the print is obtainable by someone else — i.e. A is exactly as good as the *second* holder's access, which today means: a house key or a paid keyed crank.
- Accounts / tx / rent: Need + shots live indefinitely (rent-exempt, paid once, never reclaimed in a gap); one replay (§4) when it happens; no expiry crank.
- Claim we may make publicly: "A shot settles only on Pyth's own bracket print for its target; if that print is never posted, the shot stays open and the stakes stay locked." — true, and it tells the player the game can freeze their money.

### B — finite window, VOID + refund

At D with no bracket print: VOID, every stake refunded, house exposure released.

- Safety: absolute when settled; VOID never pays anyone.
- Liveness: guaranteed terminal at D (settled or void). Nothing is ever stranded.
- Who profits from silence: **the losing side, fully** (S4: option = whole loss for whichever exclusive holder would lose). If the house is the only key holder, the house never loses — unacceptable and detectable only ex post by other key holders. If a player holds a key, that player converts every loss into a refund — the house's edge is gone and the game is adversely selected. If the print is held by a neutral bounty crank *and* by the interested side, silence by the interested side is repaired by the crank — so B is honest exactly when H1 holds for a **disinterested** party, which is the same assumption as adapter 3's, now with refund instead of a later print as the failure mode.
- Accounts / tx / rent: one `expire` instruction per Need at D (crank, ~5k CU), one replay (§4) when the print exists; Need/shots closable after VOID/FINAL — rent reclaimed.
- Claim: "A shot settles only on Pyth's bracket print for its target, posted by anyone within W; if nobody posts it the shot is refunded. Whoever holds that print alone can turn a loss into a refund." — the second sentence must be printed or the first is misleading.

### C1 — bonded poster, timeout charged to the poster

A registered poster (the house first) bonds `B`. At D with no bracket print: the poster is charged **as if it had lost every open shot against it** (players are paid their hit payout from the bond), the Need closes.

- Safety: absolute when settled; the timeout transfer is the poster's declared liability, not a price.
- Liveness: guaranteed terminal at D; either the print or the bond pays.
- Who profits from silence: **not the poster** — withholding is weakly dominated (S4: option 0 in both outcomes; charged the same as a loss). **But a player who is the only holder gains 1,700 on a 1,000 stake by silence** (S4 row C1/player-holder/LOSE): C1 is incentive-compatible **only if the poster obtains the print independently** (own Hermes key or self-hosted Hermes/spy — H1 on the poster), never if the poster relies on the sponsored PDA (1 in 5 targets) or on players. And the poster is charged for **every** miss whatever its cause (S5): Pyth emission gaps, Solana congestion inside W, its own outage. `P(gap)` is therefore a priced input and must be measured from Pyth history over days before C1 is switched on; a burst of gaps is a bank run on the bond.
- Accounts / tx / rent: Poster account (bond, ~0.002 SOL rent) + the bond itself (≥ total open hit payouts of the poster's shots — with `max_open = 5` and `max stake 1e9` per player the bond is the product's exposure cap, whatever it is set to); one replay per Need (§4) paid by the poster; one `expire` per missed Need moving bond → players (one instruction, ≤ `max_open` transfers or a claim pattern); the entry Need of a forward shot must have `W_entry ≤ horizon − lag` (Astra A3) — under SPO there is no disclosure choice, but the poster's timeout charge for the entry Need must still be resolvable before exit.
- Claim: "A shot settles only on Pyth's bracket print for its target. The house is obliged to post it within W; if it does not — for any reason, including Pyth not emitting it — the house pays every open shot as a win." — strong, true, and it converts the format's gap into a house liability the players can see on-chain.

### C2 — symmetric PvP, mutual forfeit

Two players on opposite sides of the same target (matched by a market or a queue), house takes a fixed rake, no poster. At D with no bracket print: **both stakes forfeited** (burned or raked) — refund is not an outcome.

- Safety: absolute when settled.
- Liveness: guaranteed terminal at D. The **winner** strictly prefers to post (S4: +700 vs −1,000), the loser is indifferent (−1,000 either way) — so any keyed participant on the winning side settles, and silence never pays anyone (option 0 in every row). Unkeyed pairs, however, both lose unless a crank with access posts for them: C2 is playable for unkeyed players only with a bounty crank (H1 on a neutral), and in an emission gap everyone loses.
- Who profits from silence: nobody (the only policy with an all-zero option column). The rake taker profits from *gaps* — the house must not be the rake taker and the key holder at once, or it gains from its own silence; burn to the incinerator, not to the house.
- Accounts / tx / rent: a match account per pair (or a pool per target/side), one replay per Need, one `expire` per gap; the product changes from house-vs-player to matched PvP (liquidity, matching, and a queue).
- Claim: "Two players take opposite sides; the print that settles is Pyth's bracket print, posted by anyone within W; if nobody posts it both stakes are burned." — true, harsh, and it needs a "you will lose if nobody posts" sentence on the page.

### Summary matrix

| | A forever | B void+refund | C1 bonded poster | C2 PvP forfeit |
| --- | --- | --- | --- | --- |
| safety | absolute | absolute | absolute | absolute |
| terminal at D | no (gap = forever) | yes | yes | yes |
| silence pays… | exclusive loser (lock = refund) | exclusive loser (full loss) | nobody among posters; a lone player-holder if the poster fails | nobody |
| needs H1 on… | anyone, eventually | a disinterested party, before D | the poster, before D | the winner or a neutral, before D |
| gap cost borne by | both (locked forever) | nobody (refund) | the poster (bond) | both players (burn) |
| new accounts | none | none | Poster + bond | match/pool |
| product | unchanged, can freeze | unchanged | unchanged, house-obliged | PvP |
| honest one-liner | "may stay locked" | "a lone holder can void a loss" | "house pays if it fails to post" | "nobody posts ⇒ both burn" |

## 3. Recommendation for the policy choice

- **B is not acceptable as a house-vs-player product** unless a disinterested keyed crank exists; with the house as sole key holder it is a silent house edge of 100 % on losses.
- **A is B with an infinite window and no escape**; it converts refunds into stranded capital and still has the exclusive-holder option. Reject.
- **C1 is the only house-vs-player policy with the option removed from the house**, at the price of (a) a house key (Hermes trial/paid, or self-hosted Hermes + spy — measure it), (b) a bond equal to the exposure cap, (c) bearing `P(gap)` — which must be measured before pricing. If Semir wants SPO on mainnet, this is the policy: the bond makes the format's gap a visible liability instead of a hidden refund option.
- **C2 is the only policy where silence pays nobody at all**, but it is a different product (matched PvP) and unplayable for unkeyed pairs without a crank.
- Whichever is chosen, the settlement page carries the "silence pays…" and "gap cost borne by" cells of its column verbatim.

## 4. Cost of one replay (Full verification) — estimates, to be replaced by Sol's devnet-measured numbers

A Full `PriceUpdateV2` from a VAA needs the Wormhole encoded-VAA path (all guardian signatures verified), not `post_update_atomic` (which yields `Partial` unless the full guardian set is passed and verified in-tx). Typical sequence: `init_encoded_vaa` + `write_encoded_vaa` (VAA ≈ 1–1.5 KB for one price + Merkle path; may need two writes) + `verify_encoded_vaa_v1` (13 secp256k1 recoveries ≈ 13 × ~25k CU plus hashing — around 0.35–0.45 M CU; fits one transaction under the 1.4 M cap but needs an explicit compute-budget instruction) + receiver `post_update` (Merkle proof check, account init — ~0.05–0.1 M CU) + `close_encoded_vaa` and, after settlement, close of the `PriceUpdateV2` account. Rent: encoded-VAA account ≈ 0.01–0.012 SOL and `PriceUpdateV2` ≈ 0.0018 SOL, both reclaimable by the payer; fees ≈ 5 tx × 5k lamports + priority. Order of magnitude: **~0.013 SOL transient, ~0.0001 SOL consumed, 4–6 transactions, ~0.5 M CU per Need**. Worst case 7 feeds × 1,440 targets/day = 10,080 replays/day ≈ 1 SOL/day consumed, 130 SOL transiently cycling — only if every minute has open shots on every feed; real load is a small fraction. Sol's devnet replay (03:xxZ, "without key") has the exact CU/tx/rent figures — those supersede every number in this paragraph.

## 5. Pyth Pro (Lazer) `fixed_rate@1000ms` exact-timestamp — short assessment

What it changes: a channel that emits **one signed update per feed per exact second boundary**, with the timestamp inside the signed payload, makes "the price at T" a single signed object — no bracket, no min, no candidate choice, no emission-gap *ambiguity* (a missing second is a missing object, not a later print masquerading as the first). Verification on Solana is an ed25519 signature check against a signer set held in the Lazer program's storage — one transaction, tens of thousands of CU, no VAA account, no guardian loop; so §4's cost falls by roughly an order of magnitude, and SPO's liveness step (iii) becomes cheap.

What it does not change, per Sol's source facts (`pytd2…` holds at most two trusted signers under a single `top_authority`; REST/history needs an API key): the **trust set** is Pyth's Lazer signer(s) under one authority, not a 13-of-19 guardian quorum — a single-operator oracle with a stronger determinism story and a weaker decentralisation story; key rotation, signer compromise and authority behaviour are one party's; the **access model** is keyed (stream and history), so H1 is "a key holder posts", which is C1's assumption, not B's; and **gaps remain a policy question** (a second with no signed object, or a signer outage, still ends in A/B/C1/C2). Honest one-liner if used: "settled on Pyth Lazer's signed 1-second print at the target time; trusted signers: Pyth's Lazer set (≤ 2 keys, one authority); posted by the house within W, house pays if it fails" — i.e. Lazer + C1, and the page must say that the oracle's trust model is a single operator, not Wormhole's guardians. Recommendation: worth a devnet probe for cost and gap frequency; not a decentralisation upgrade and should not be described as one.

Fable's availability is bounded; the model, the tests and this note stand on their own.
