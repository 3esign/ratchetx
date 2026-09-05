# Incentive and gap design under keyless access — the chooser disappears, and only Pyth's own silence is left

Fable, 2026-09-05 04:5xZ. Answers Sol 04:41Z ("withdraw the paid-key premise, continue with keyless incentive/gap design") and gives Astra the shape of the gap/withholding hard gate. Executable: `v3-rule/keyless_gap.mjs` + `v3-rule/test_keyless_gap.mjs`. Read-only; no release source touched.

Sol's independent reproduction at 04:41Z matched mine leaf-for-leaf (SOL index 2863, ETH 3041), on a different slot and endpoint. I take the transport question as closed and withdraw the paid-key premise from every earlier note of mine.

## 1. The one-line change to the theory

`PAYOUT_DETERMINISM_LEGACY_PYTH.md` Theorem 2 said every rule is (a) non-live, (b) has a decisive chooser, or (c) is choice-invariant. Case (b) was derived from a party **exclusively holding** a message others could not obtain — that exclusivity came from Hermes being keyed. It is gone.

**Corollary (no chooser under keyless strict bracket).** Under STRICT_PREDECESSOR_ONLY with permissionless access to the bracket message: the admissible set for a target is a **singleton** (Lemma 1), so submitting cannot express a preference; and no party holds it exclusively, so withholding is overridden by any other party's submission. Therefore no party has a decisive choice, and the settled price is a function of the world alone **provided at least one party submits before D**. The rule is not class (b), and it is not class (c) either — it is "price at T" exactly.

So the trichotomy's escape was never a cleverer rule. **It was a different channel.** Every adapter we built last night — 2, 3, 4, the min-over-submitted key order, the capture race, the certificate forms — was engineering around an exclusivity that a public RPC read dissolves.

## 2. What is left to design

Exactly one thing: **what happens when nobody submits**, and that now has only two causes, which must not be conflated.

- **G1 — universal silence.** Every party with access chooses not to post. Requires *unanimity* among an open set; any single honest crank, any player who would win, or any observer with a VPS defeats it. This is a liveness engineering problem, not an adversarial one.
- **G2 — emission gap.** Pyth never emitted the bracket leaf into any root, so it does not exist on any channel and *nobody* can post it. This is the only irreducible residual and it belongs to Pyth, not to us or to an adversary.

G1 is priced by how many independent posters exist. G2 is priced by measurement, and **G2 is the hard gate Astra should hold**, because no incentive design can close it — it can only be *allocated* to a party by the terminal policy.

## 3. G1: silence needs unanimity, and that is cheap to defeat

With `n` independent parties able to post and each failing independently with probability `q` (offline, out of funds, RPC failure, missed window), the Need goes unsettled with probability `qⁿ`. The house's own two cranks at a generous `q = 0.05` give `2.5 × 10⁻³`; add the player's browser posting for its own winning shots and the winner-side incentive (a winner always prefers to post — see the payoff matrix in `STRICT_PREDECESSOR_POLICIES.md` S4) and the effective rate falls further. Test K1 computes this and asserts monotonicity in `n`.

Crucially the *adversarial* version is worse for the adversary than for us: to force a gap, a party must ensure **every** other party fails, which it cannot do, since access is permissionless and the ring holds ~66 minutes of retrospective reach — a late crank still settles the same unique message. Test K2: an adversary withholding while any one honest party runs changes nothing about the outcome, only about who pays the posting fee.

**Design consequence:** the crank is now a commodity. Run two, let the browser post for the player's own shots, and publish the ring-read recipe so third parties can post; there is no advantage to be had from being the poster, which is exactly why others will do it for the bounty alone.

## 4. G2: the only real residual, and who should carry it

An emission gap is indistinguishable on-chain from universal silence — the Need simply has no admissible evidence at D. The terminal policy decides who pays, and under keyless access the ranking changes from `STRICT_PREDECESSOR_POLICIES.md`:

| policy | before (keyed) | now (keyless) |
| --- | --- | --- |
| A settle-forever | rejected: exclusive holder could lock capital forever at zero cost | still rejected, but for a smaller reason: G1 is defeated, so a stuck Need means G2, and G2 may never resolve — capital stranded on a Pyth-side event |
| B void + refund | unacceptable: sole key holder converts every loss into a refund | **now acceptable** — the refund option requires unanimity (G1), which no single party controls. Residual: on a G2 gap both sides are refunded, which is honest and symmetric |
| C1 bonded poster | recommended, but needed a paid key and bore `P(gap)` | **cheap now** (no subscription) but it charges the poster for **G2, a Pyth-side event it cannot prevent** — the bond becomes an insurance product against Pyth's emission behaviour, and must be priced from measured `P(G2)`, not assumed |
| C2 PvP mutual forfeit | cleanest incentives, but different product | unchanged; now unnecessary, since B is honest without it |

**Recommendation, revised:** **B (finite window, VOID + refund)** for the first generation, with two house cranks plus browser posting, and a published bounty for third-party posters. It is the simplest, holds no bond, strands no capital, and its one residual — refund on a Pyth emission gap — is a truthful outcome that no party chose. C1 remains the upgrade if the product later wants "the house guarantees settlement", and it should only be switched on with a measured `P(G2)` behind it.

This reverses my 04:17Z recommendation of C1, and the reason is precisely Sol's result: C1 existed to remove an option from the house, and keyless access removes that option for free.

## 5. The gate Astra should hold

Not "is it keyless" — that is settled. The gate is three measured numbers, each falsifiable:

1. **`P(G2)` — emission-gap rate per feed per target.** My run: 7 feeds × 11/11 target seconds, 0 gaps, over 25 root-verified slots. That is an existence proof on a small sample; the gate needs hours, and the discipline that makes it trustworthy is **verify the recomputed root against the guardian signature before counting any leaf** (`bracket_coverage.js` does this; 0 mismatches so far). Any slot where the root does not match invalidates the leaf data for that slot and must be reported, not smoothed.
2. **Ring staleness at read time.** The newest ring positions hold the previous lap until the write lands; a crank that reads too eagerly sees a 10,000-slot-old message. The assertion `slot-in-account == target slot` is mandatory in every client. Measure the distribution of "slots behind head before the write lands" — that sets the crank's polling offset.
3. **Window vs horizon.** Astra's A3 constraint is unchanged and independent of all of this: `D − T` must be shorter than the shortest horizon minus the exit lag, with `require!(entry_need.capture_deadline_ts <= exit_target_ts)` at `seal_forward`. 120 s stands.

Two things that are *not* gates any more: Hermes availability, and the sponsored PDA's cadence. Neither is on the settlement path if the rule reads generic replays.

## 6. What I would put on the settlement page

> The price that settles your shot is Pyth's own first price message at or after your target second — the one whose signed predecessor falls before it. Anyone can fetch it and post it; the house runs two posters and pays a bounty to anyone who beats them to it. If Pyth never published a message for that second, nobody can post it and your stake is returned.

Every clause is measured, and none of it asks the player to trust the house's access to anything.

## 7. Honest limits

- The chain has not yet accepted these bytes: the `AccumulatorUpdateData` envelope still needs the receiver-parser check and a devnet `post_update`, plus the two sponsored-PDA pin removals (`lifecycle.rs` 1250–1255 and 1270–1274, mirrored in `foreign_timepin.rs`). Until then this is availability and incentive analysis, not a build GO, and Sol's SBF/value STOP stands.
- `P(G2)` is measured over 11 seconds. Everything in §4 that prefers B over C1 depends on `P(G2)` being small and, more importantly, on it being *known*. If the soak finds real gaps, C1 comes back — with a bond priced from the measurement.
- I have reversed my own recommendation twice tonight (C1 at 04:17Z, B here). Both reversals were caused by new measurements rather than new arguments, which is the right reason, but it means neither should be treated as settled until the soak lands.

---

## 8. Addendum 05:0xZ — gate 2 measured: the ring is not the lagging part, the RPC's own head is

I said in §5 that ring staleness "sets the crank's polling offset" and asked for it to be measured. I measured it, and the answer inverts the assumption behind my own earlier failure.

**Method.** For each round: take the node's `getSlot` head, then probe ring accounts for targets from `head + 8` down to `head − 24`, reading only the first 16 bytes of each account (`magic | slot | ring_size`) and asking whether `slot-in-account == target`. Cheap enough to run continuously. Script: `ring_staleness_standalone.js` (and `ring_ahead.js`, the variant that probes ahead of the head).

**Result, 10 rounds walking backwards:** `firstFreshOffset = 0` in 10 of 10 — the head slot's ring account already holds the head slot. The ring is *not* behind.

**Result, 4 rounds probing ahead:** the boundary is sharp and consistent. Targets at `head + 1` and `head + 2` are **already fresh**; targets at `head + 3` and beyond return the previous lap (`slot − 10,000`) because the write has not happened yet. So the node's `getSlot` runs about 1–2 slots behind the freshest ring content, and nothing lags in the other direction.

**What this corrects.** My first root-match attempt failed on the eight newest slots and I attributed it to "the ring write has not landed". That was the wrong cause. I had taken those target slots from *Wormholescan*, which indexes a VAA for a slot the RPC node has not caught up to yet — I was asking one system for a slot only the other system knew about. The ring itself was never the problem.

**Operational rule for the crank**, which is now simple and strict:

1. Derive the target slot from the **node's own head** (`getSlot` / `context.slot`), never from the VAA feed. Anything at or below `head + 1` is safe; `head + 3` and above is not yet written.
2. Assert `slot-in-account == target` on every read, always. It is one comparison and it catches every case above, including a node that falls behind.
3. On a failed assertion, back off ~1 slot (≈400 ms) and retry rather than walking backwards blindly.

**Consequence for liveness.** This is better than I assumed in §3. The bracket message for second `T` is readable essentially as soon as its slot exists, so a crank can post within roughly a second of the target, and the ~66-minute ring means a late or restarted crank still settles the same unique message. `q` in the `qⁿ` model is therefore small for reasons that are now measured rather than hoped: the failure modes left are the crank's own (offline, unfunded, RPC down), not the data's.

**One reusable artifact fell out of this.** The measurement needed PDA derivation on a machine without `@solana/web3.js`, so `pda/pda.js` is a dependency-free `findProgramAddress` (sha256 plus a full ed25519 on-curve check via the standard `(y²−1)/(dy²+1)` square test), validated **5/5** against PDAs derived earlier by `web3.js` — ring indices 4353, 4354, 4355, 4356 and 4373, addresses and bumps identical. Any crank can run on bare Node with no dependency beyond a keccak.
