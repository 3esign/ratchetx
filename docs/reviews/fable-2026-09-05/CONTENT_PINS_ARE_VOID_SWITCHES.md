# Under a unique admissible message, every content pin is a void switch — measured margins for the seven feeds

Fable, 2026-09-05 09:2xZ. A structural finding from reading `validate_decision_fields` against the strict-bracket rule, with the margins measured keylessly. This is the adversarial surface that survives after the transport question closed, and it is the one Astra's gate should hold. Read-only; no release source touched. Measurement: `gate_soak.js` (self-contained — inlined keccak self-tested against the standard vectors at startup, inlined dependency-free `findProgramAddress`).

## 1. The structural point

`rcx-timepin-v2/src/lifecycle.rs:1166-1212` (`validate_decision_fields`) applies six predicates to a candidate: the bracket itself, `max_pre_target_gap_seconds`, `max_post_target_lag_seconds`, `source_deadline_ts`, `price > 0`, the exponent bounds, and `max_confidence_bps`.

Under a **min-over-submitted** rule these are *selection* criteria: reject one message and another can still win. Under **STRICT_PREDECESSOR_ONLY** the admissible set is a **singleton** (Lemma 1) — so rejecting it leaves nothing at all.

**Therefore, under the strict bracket, every content pin stops being a safety feature and becomes a liveness switch.** Safety comes from uniqueness, not from the filters; the filters can only decide whether the target settles or voids. Each one is a house-made gap, indistinguishable on-chain from Pyth's own (my `G2`) and from universal silence (`G1`).

That matters adversarially because these switches are keyed to *market conditions*, and the party who benefits from a void is the one about to lose. A confidence bound in particular is widened by exactly the volatility that makes a shot valuable.

## 2. Measured margins (keyless, root-verified)

Continuous run, slots derived from the node's own head, every `(feed, second)` counted at most once, roots recomputed and compared against the guardian-signed VAA on a sampled subset; any slot whose root fails is discarded rather than smoothed.

First window: **200 slots read, 0 stale, 25 roots checked, 0 mismatches, 595 feed-seconds, 595 with a bracket message, 595 admissible under the real spec — 100%, zero rejections of any kind.**

| pin | manifest value | measured worst case | margin |
| --- | --- | --- | --- |
| `max_pre_target_gap_seconds` | **1** | pre-gap histogram is `{1: 595}` — always exactly 1 | **none. zero. the pin sits exactly on the observed value** |
| `max_confidence_bps` | 200 | SOL 6, BTC 3, ETH 5, JUP 14, WIF 15, BONK 26, **PUMP 44** | 4.5× on PUMP, 33× on BTC — *in calm conditions* |
| `max_post_target_lag_seconds` | 30 | bracket message is at the target second itself | wide |
| exponent bounds | −12 … 2 | −8 everywhere | wide |

## 3. The two findings that need action

**A. `max_pre_target_gap_seconds = 1` has zero margin and will manufacture gaps.** Pythnet publishes one aggregate per second, so `prev = T − 1` and `pre_gap = 1` exactly — the pin passes only because it sits precisely on the observed value. The moment Pythnet skips a single aggregate for a feed, that second's bracket message carries `pre_gap = 2`, **the unique admissible message is rejected, and the target voids** — not because Pyth failed to publish, but because our own spec refused what Pyth published.

This is a self-inflicted `G2`, and it is the most likely gap source in the whole design. Raising the bound does **not** weaken safety: uniqueness comes from the predecessor chain (`prev(m_{i+1}) = pub(m_i)`), not from how old the predecessor is, so a larger gap still admits exactly one message — the first after a longer silence, which is precisely what we want to settle on. **Recommend `max_pre_target_gap_seconds` ≥ 5**, and treat the value as a liveness parameter, never a safety one.

**B. `max_confidence_bps = 200` is a volatility-triggered void switch.** PUMP already sits at 44 bps when nothing is happening. Pyth widens confidence exactly during the moves that make a prediction market interesting, so this pin will fire, if it fires at all, on the targets that matter most — and it hands a void (a refund) to whichever side was about to lose. Three honest options, in my order of preference:

1. **Raise it per feed against measured quiet-state confidence** (e.g. ≥ 20× the calm worst case) and publish the number, accepting that a genuinely broken feed still voids.
2. **Drop it under the strict bracket** and state that the game settles on whatever Pyth signed, wide confidence included — maximally live, and honest, since we cannot do better than the oracle.
3. Keep it tight and **publish the refund condition as a rule of the game**: "if Pyth's own uncertainty exceeds X% at your target second, the shot is refunded." Acceptable only if it is stated up front, because it is a rule, not an accident.

What is not acceptable is keeping a tight bound and describing the resulting refunds as oracle failure. They would be ours.

## 4. What this does not change

Safety is untouched: the admissible message is still unique, still Pyth-signed, still chosen by nobody. Every option above trades only between "settles on a wide-confidence print" and "refunds". And the solvency wire from `SOLVENCY_AND_INCENTIVES.md` is orthogonal — but note the interaction: **each void switch is also a poster-revenue switch**, since a poster earns only on settlement. A tight confidence bound therefore both refunds the loser and unpays the poster, on exactly the targets where posting was most contested.

## 5. Limits

- 595 feed-seconds is a first window; the soak continues at 40 slots/minute for 6 hours and the numbers above should be replaced by its totals. `gate_soak_status.json` carries `preGapHistogram`, `worstConfidenceBps` per feed, and a rejection breakdown by pin.
- Confidence behaviour under stress is not measured here at all — calm-state margins say little about a spike. That measurement needs a volatile window, which cannot be scheduled; the right response is to size the bound against a stress percentile from Pyth history, not against my quiet sample.
- I have corrected a defect in my own earlier soak: its slot windows came from the Wormholescan page and repeated, so its status file double-counted (10 batches over 6 distinct windows). The independent figure I published — 1,120 feed-seconds, 0 gaps — was the correct one, and this v2 tool counts each `(feed, second)` at most once by construction.

---

## 6. Addendum — finding A made executable (`v3-rule/test_pre_gap.mjs`, 5/5)

The claim in §3A is now a test rather than an argument:

- **G1** with no skips, the bracket message exists and is unique for every target, and `pre_gap` is always exactly 1 — the measured mainnet condition, reproduced in the model.
- **G2** a skipped aggregate does **not** remove the bracket message. The predecessor chain is continuous (`prev(m_{i+1}) = pub(m_i)`), so exactly one edge crosses `T` however long that edge becomes; uniqueness is a property of the chain, not of the gap.
- **G3** the finding itself, quantified: with Pythnet missing one aggregate every seven seconds, `max_pre_target_gap = 1` **voids 70 of 491 targets — 14.3%** — while `max_pre_target_gap = 5` voids **none**. Same data, same rule, same oracle; only the pin differs.
- **G4** raising the bound can never introduce a second admissible message — at bounds 1, 2, 5, 30 and 3600, across skip densities 0 to 60 %, the admissible set is never larger than one. The gap filter is a conjunction with a unique-satisfier predicate, so it can only ever delete, never select. **This is the proof that the bound is a liveness parameter and carries no safety duty at all.**
- **G5** the only way to lose the bracket message entirely is to have no aggregate after `T` — a real Pyth outage, not a skip.

The asymmetry is therefore total: a tight bound buys **nothing** (G4) and costs targets in proportion to Pythnet's skip rate (G3). The skip rate is currently zero in my window, which is exactly why the risk is invisible and why the pin should be widened before it is ever exercised in production rather than after.
