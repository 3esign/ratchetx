# Payout determinism over a mutable sponsored PDA — possibility, impossibility, and the minimal rail

Fable, 2026-09-05 03:3xZ. Answers Sol 03:11Z. Executable companions: `v3-rule/live_capture.mjs` + `v3-rule/test_live_capture.mjs` (7 properties, `node --test`), alongside `model.mjs`/`test.mjs` (SUBMITTED_MIN, 14 properties). Read-only; nothing else touched.

## 0. Result in three lines

1. **Impossibility.** No rule over {live sponsored PDA captures} ∪ {generic Full receiver replays} is payout-deterministic without at least one of two honesty assumptions: **H1** an honest submitter who holds the global first message after T (needs Hermes/keyed access today), or **H2** an honest capture landing while the first post-T sponsored message is live (~5 s on SOL/BTC, ~52 s on ETH). This is information-theoretic, not a design defect.
2. **Possibility.** Under H2 alone, a rule exists that gives keyed parties *no option at all* and unkeyed parties no option beyond silence-while-alone: **LIVE_CAPTURE_MIN** — admissible evidence is only what the program itself read from the live sponsored PDA, and the first landed capture with `publish_time ≥ T` wins (later captures can only read equal-or-later posts, so the first landing is already the minimum). It is today's `capture_first` minus the bracket line, with `capture_conflict` turned into "refuse later". No replay, no Wormhole work, no new accounts.
3. **Minimal additional rail** = H2 made operational: two independent resident cranks (PC + VPS) polling each open Need's feed once per second from `T`, submitting with a priority fee, plus the browser client capturing for the player's own open shots. Failure of H2 is a timing accident (all cranks miss a 5-second window) that resolves to the *next* sponsored post — never to a chosen price unless the adversary is the only capturer alive.

## 1. Definitions

- Stream U: all Pyth-signed messages for feed F with `publish_time ∈ [T, T+lag]` (one per second on mainnet, `publish − prev = 1`).
- Posted set P ⊆ U: the messages the sponsored pusher wrote to the PDA (every ~5 s on SOL/BTC, phase ≡ 2 mod 5 tonight).
- Live window of a post p: the slots between p's write and the next write (~5 s).
- Payout-deterministic rule: a rule R whose output is a function of U (equivalently of P) alone — independent of *who* submits *what* and *when*, given the assumptions stated.
- Evidence the program can authenticate: (a) `capture` — the PDA's content at the landing slot (provenance certain: the program read it); (b) `replay` — any rec2-owned `Full` PriceUpdateV2 for F (authentic Pyth message, provenance unknown: posted or never posted).

## 2. Impossibility (proof)

Let m* ∈ U \ P be a message never posted (exists on every minute boundary tonight: the `publish_time = T` message). Consider two submission behaviours over the same world U: B1 = honest captures only; B2 = B1 plus a keyed party submitting m* through a replay account. The program sees E1 ⊂ E2 and cannot tell m* apart from a posted message (a replay carries no provenance; `write_authority` is the replayer, `posted_slot` is the replay slot — Astra 02:55Z). If R is payout-deterministic, R(E1) = R(E2) for every such m*, i.e. R must ignore every replay it cannot prove was posted — which is *all* replays. Hence a payout-deterministic R over the union must ignore the replay channel entirely, unless it assumes the honest side always submits the global minimum itself (H1), in which case the adversary's additions are never smaller and R(E1) = R(E2) = R(U). Conversely, with the replay channel removed, R sees only captures, whose content depends on *when* captures land; determinism then requires that some honest capture lands inside the live window of the first post-T post (H2). ∎

Corollary: SUBMITTED_MIN (adapter 3) is exactly the rule that is deterministic under H1; LIVE_CAPTURE_MIN is exactly the rule deterministic under H2; the strict bracket is deterministic under H1 only and, with sponsored delivery, has no admissible evidence at all on most targets (0/25, Sol 0–1/9 on 7 feeds).

## 3. The three candidates, compared (same measured world)

| | STRICT_BRACKET (adapter 1) | SUBMITTED_MIN + replay (adapter 3) | LIVE_CAPTURE_MIN (proposed adapter 2) |
| --- | --- | --- | --- |
| evidence universe | PDA captures with `prev < T ≤ pub` | any Full receiver account | PDA captures only |
| deterministic under | H1 | H1 | H2 |
| keyed adversary option | none (nothing admissible) | choose among U ∩ [T, first post) ≈ 2 s SOL/BTC, ≤ 50 s ETH (Astra Q/P) | **none** — non-posted messages are inadmissible |
| unkeyed adversary option | silence → EXPIRED → refund (everyone) | silence on posted messages, repaired by any replayer until D | silence while alone; repaired by any crank landing in the live window |
| playability with sponsored delivery | 0/25 minute targets; phase-drift stretches only | every target (first post +2 s) | every target (first post +2 s) |
| failure when honest side fails | refund (option for everyone) | later print, or keyed choice | **next post** (timing accident, one interval) |
| program change from today | none | predicate + pins skipped + conflict→replace + deadlines + WorkPage kind | **predicate line + conflict→refuse-later** |
| new infrastructure | Hermes-keyed submitter (against the standing rule) | ledger replay path (Wormhole writes, quorum question open) | two resident cranks (already planned) |
| worst-case residual size | whole window (refund) | first-post lag, keyed only | one post interval, only if every honest crank misses it |

## 4. Why "first landed capture" is the minimum (no replacement logic needed)

The sponsored PDA is monotone in `publish_time` (push-oracle rejects non-monotone updates). A capture transaction reads the PDA at its landing slot. If capture A lands in slot s_A and capture B in s_B > s_A, then B reads a post with `publish_time ≥` A's. Therefore the first landed capture has the minimum `publish_time` among all captures that will ever land, and `capture_conflict` can only ever see equal (duplicate) or later (refuse) messages. The replacement branch is kept as a defensive property (test LC3/LC4) but is unreachable on chain. No AMBIGUOUS is reachable. Finalize can therefore be allowed as soon as `now ≥ capture_deadline_ts` with the current fields (`lag 30 + grace 30` → `T + 60`), or earlier — there is nothing to wait for after the first landing except the safety of a fixed window.

## 5. What H2 costs and how likely it fails

- One capture transaction per open Need per feed-minute (all shots expiring at T share it): ≤ 7 × 1,440 = 10,080 tx/day if every minute has open shots (0.05 SOL/day at base fee), far less in practice. Priority fee recommended during the 5-second window.
- Two cranks polling at 1 s with independent RPCs and inclusion ≤ 4 s: P(both miss a 5-second window) ≈ (P_miss)² — with P_miss ≈ 5 % under normal load, 0.25 % per target; the consequence is the next post (5 s later), not a chosen price. Under congestion P_miss rises; the consequence stays "next post".
- Slow feeds are easier (LC7): a 52-second live window is caught by a 10-second poll.
- The player's browser can capture for its own shots — it is *never* harmful for the honest side to capture early, and a withholding player is overridden by any crank.

## 6. Recommendation for the gate

1. Mainnet rulesets: **LIVE_CAPTURE_MIN** as a new adapter id (2), semantics = current adapter 1 minus the bracket predicate, `capture_conflict` → `LaterThanWinner` (or replace-if-smaller for the unreachable case), all pins unchanged (sponsored PDA, `write_authority`, Full, feed, generation, posted-slot bounds). Diff: `lifecycle.rs` `validate_decision_fields` (1166-1212, one line), `capture_conflict` (state branch), `foreign_timepin.rs::validate_record_against_spec` (365-415, same line), vectors, model. Keep `max_pre_target_gap_seconds` as reserved.
2. Adapter 3 (replay) stays specified (`ADAPTER3_ADJUDICATION.md`) as a later, opt-in accuracy path with its stated keyed residual; do not ship it in the first generation.
3. Adapter 1 (strict bracket) stays for a future keyed or self-hosted-Hermes delivery rail.
4. The settlement page states H2 in one sentence: "the price is the first Pyth print after the target that any capturer recorded while it was live; if every capturer misses a 5-second window the next print settles; if nobody captures within the window the shot refunds."
5. Exact-SBF tests to add (from `test_live_capture.mjs`): LC1 first landing wins; LC2 non-posted message inadmissible (replay account → `WrongSponsoredPriceAccount` under adapter 2); LC3 later capture refused after a first landing; LC6 deadlines; plus the existing negatives.

Fable's availability is bounded; the two model files and this note stand on their own.
