# Adapter 3 adjudication — settlement evidence rule V3 ("SUBMITTED_PYTH_MIN")

Fable, 2026-09-05 03:1xZ. Answers Sol 02:57Z ("prove or break this exact chain") and Astra 02:43/02:55/02:58Z. Read-only; nothing in source, candidate, chain or staging of others was touched. Executable model + 14 property tests beside this file (`v3-rule/model.mjs`, `v3-rule/test.mjs`, `node --test`).

## Verdict: GO for the rule, NO-GO for the build until it is pinned

**GO** on the rule below as the canonical evidence rule for the first mainnet generation, because it is the only one of the three candidates in which no party can improve its own outcome by any action other than *submitting earlier authentic evidence*, and that action is available to everyone (sponsored PDA for free, ledger replay for free, Hermes for keyed parties) and always overridable until an absolute deadline.
**NO-GO** on building S2 as is: the strict bracket (adapter 2) is 0/25 on measured mainnet cadence and carries a silence/refund option; "earliest captured without challenge" carries a real price-selection option (Astra 62/67). Neither may become a mainnet economy.

## 1. The rule, precisely

- **Candidate universe:** every message that passes today's `load_evidence` minus two pins: the sponsored-PDA address pin and the `write_authority` pin. Kept: owner == `rec2…` (pinned receiver), exact 134 B, discriminator, `VerificationLevel::Full`, `feed_id`, exponent/confidence bounds, `posted_slot ≤ clock.slot`, generation pins. Admissible iff `T ≤ publish_time ≤ T + max_post_target_lag`.
- **Total order:** `key(m) = (publish_time ↑, prev_publish_time ↑, message_hash ↑)`.
- **Winner:** the minimum key among admissible messages **submitted** in `[T, D)`, `D = T + challenge_window_seconds` (spec constant, absolute; proposed 900 s). A submission replaces the current winner iff its key is strictly smaller; equal key ⇒ same message ⇒ no-op; larger ⇒ accepted but ignored. No extension of `D` on replacement.
- **Terminal:** `finalize` permissionless at `now ≥ D` with a winner → `FINAL(winner_hash)`; `expire` permissionless at `now ≥ D` with no winner → `EXPIRED`. `AMBIGUOUS` is unreachable (equal key = identical message) and should be removed from the reachable state set, kept only as a defensive branch.
- **Reward:** exactly one `WINNING_CAPTURE` per Need, paid at `finalize` to the submitter of the winning candidate (replaces `FIRST_CAPTURE`; `TERMINALIZE` unchanged; WorkPage cap 2 untouched). Duplicates and superseded candidates earn nothing; their rent returns to their own submitter via `close_candidate` after terminal.
- **Semantics name:** neither GLOBAL_PYTH_MIN (no completeness claim) nor SPONSORED_POSTED_MIN (no provenance claim). It is *the minimum over submitted authentic evidence, publicly overridable until D*.

## 2. Sol's chain, link by link

| # | Link | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Canonical pusher transaction bytes recoverable during the window | **PROVEN for one tx by Astra** (`3jsTusG…`, slot 444,408,680; VAA 292 B + post-update 342 B from `getSignaturesForAddress` + `getTransaction`; encoded-VAA account already closed, bytes still in history). Generalises because every sponsored push is a successful transaction on the PDA's signature history and public RPCs serve ≥ hours of history; 15 min ≪ that. | Astra `REPLAY_FEASIBILITY_ADDENDUM.md` |
| 2 | Wormhole/Receiver replay produces a `Full` PriceUpdateV2 | **PLAUSIBLE, one devnet run away** (Sol lane). Path: `write_encoded_vaa` ×2 → `verify_encoded_vaa_v1` → `post_update` into a fresh account with the replayer as `write_authority`. Open item: the recovered VAA carries 3 signatures against a 5-key guardian set; the receiver's `post_update` sets `Full` only if the encoded VAA reached Wormhole quorum — verify on devnet what quorum `HDw2…` enforces for set index 1 before calling replay proven. | Astra 02:55Z |
| 3 | Timepin authenticates the intended source domain | **PROVEN by construction**: the domain is "Pyth-authenticated message for feed F under the pinned receiver generation", which is exactly what owner=rec2 + Full + feed + generation pins verify. The sponsored PDA was never part of the *authentication*; it was a *delivery* pin. Dropping it drops nothing cryptographic. | `lifecycle.rs:1245-1280` |
| 4 | Minimum transition cannot be selectively manipulated | **PROVEN in the model** (tests P1–P3, C1, C2): the winner is order-independent; adding submissions is monotone (can only move the winner earlier); withholding never helps because every other party can add; the strict-bracket message is the global minimum (L1), so keyed parties can only pull the result *toward* the old rule's answer (L2). Residual stated in §4. | `v3-rule/test.mjs` |
| 5 | Core reconstructs an identical terminal result | **PROVEN unchanged**: Need stores the winner hash; the winning Candidate PDA is seeded by that hash; `foreign_timepin.rs::authenticate_final` already reads exactly that pair. Only `validate_record_against_spec` changes predicate (§3). | `foreign_timepin.rs:323-415` |
| 6 | Accounts/rent/bounties bounded and conserved | **PROVEN by rule**: each candidate is rent paid by its submitter (spam costs the spammer, ~0.001 SOL per 119 B, closeable after terminal); exactly one payout per Need from the sealer's bond; no repeated bounty for descending timestamps because a replacement earns only if it is still the winner at `finalize`. | model D4 |

## 3. Exact source / state / ABI impact (for Sol; no edits made)

- `onchain/rcx-timepin-v2/src/lifecycle.rs`
  - `validate_decision_fields` (1166-1212): replace the bracket line with `require!(need.target_ts <= candidate.publish_time)`; keep post-lag, source-deadline, price, exponent, confidence. Drop `PreTargetGapTooLarge` (pre-gap is meaningless without the bracket; keep the field in the spec as reserved = 0 to avoid an ABI change).
  - `load_evidence` (1245-1280): when `spec.adapter == 3`, skip `require_keys_eq!(account.key(), expected_source)` (1250-1255) and the `write_authority` check (1270-1274); keep owner/len/discriminator/Full/feed/generation/posted-slot.
  - `capture_conflict` (second candidate): compute `compare_key`; if smaller → new candidate becomes `candidate_a_hash`, old one is retained on its own PDA (closeable), state stays `CANDIDATE`; if larger → accept as a harmless candidate PDA (or refuse with `LaterThanWinner`), state unchanged; equal → `DuplicateMustUseFirstCapture`. `AMBIGUOUS` branch removed from reachable code.
  - `finalize` (1005-1011): unchanged gate (`now ≥ capture_deadline_ts`), but `capture_deadline_ts := target_ts + challenge_window_seconds` and `source_deadline_ts := target_ts + max_post_target_lag_seconds` at `open_need`. The capture window `now < capture_deadline_ts` (1240-1243) becomes the challenge window.
  - Work: rename kind `FIRST_CAPTURE` → `WINNING_CAPTURE`, completed at `finalize` for the winner's submitter (stored on the Candidate: `submitter: Pubkey`), not at capture.
- `TimepinNeedV2` layout: unchanged (132 B) — `candidate_a_hash` = current winner, `candidate_b_hash` = 0 (reserved). `CandidateV2` gains nothing if `submitter` already exists (it does: capturer field); otherwise +32 B and a new `LEN`.
- `EvidenceSpecV2`: `adapter = 3`; `max_pre_target_gap_seconds` kept as a field, must be 0 for adapter 3 (`validate_spec`). New spec hash ⇒ new ruleset hash ⇒ new economy hash — free today, nothing deployed.
- `onchain/ratchet-core-g2/src/foreign_timepin.rs::validate_record_against_spec` (365-415): same predicate change. `authenticate_final` unchanged.
- `model.mjs` (`authenticateTimepinNeed`, spec encoders), `client-v2.mjs`, vectors: regenerate; add `v3-rule/model.mjs` semantics to `test_timepin_v2_model.mjs` or import it.
- Ruleset hygiene that this rule needs: forward-only entry (`validate_ruleset` require `ENTRY_FORWARD`), because with `D = T + 900` every FINAL entry Need is ≥ 900 s old and observed mode is dead by Astra's own arithmetic; `reveal_window_seconds` in hours; per-feed `max_post_target_lag` from the 24 h sampling (SOL/BTC 30 s, ETH 120 s, others measured).

## 4. Residuals, stated for the settlement page (test_settlement_claims will police the prose)

1. **Liveness:** if nobody submits anything by `D`, the Need expires and the shot refunds. Floor: the sponsored print exists at `T + 2 s` (SOL/BTC) and is submittable by anyone for the whole window from the ledger even after the PDA moved on. Two independent cranks (PC + VPS) make this a non-event; it is still an assumption, not a proof.
2. **Keyed-party option, bounded:** a party with Hermes access can submit any authentic message in `[T, first sponsored print)` — on SOL/BTC at most ~2 s of price path, on ETH up to the sponsored lag (~50 s). It can never move the result later than what others submit, and any other keyed party can end the option by submitting the true first message. Whether Hermes keys are free is unverified (Pyth: "Hermes now requires an API key" since 2026-08-26); the protocol does not depend on it.
3. **Sub-second aggregates:** mainnet shows one authenticated message per second (`publish − prev = 1` in 300/300); if Pythnet ever exposes several per second, `(prev, hash)` decides deterministically and symmetrically (C2) — a fair coin, not a choice.
4. **Archive availability:** ledger replay needs an RPC that still serves the pusher's transaction (any public RPC serves ≥ hours; the window is 15 min). A pruned/limited RPC is a liveness degradation for the challenger, never a false price.

## 5. Acceptance matrix (must exist as exact-SBF tests before this adapter carries value)

| Case | Expected |
| --- | --- |
| phase-2 sponsored stream, minute targets, honest crank only | FINAL on the +2 s print, 16/16 targets (R2) |
| same stream, strict bracket (adapter 2) | EXPIRED 16/16 (R1) — the counterexample that kills adapter 2 on sponsored delivery |
| attacker submits later print first, challenger replays earlier print at `T+600` | earlier wins, attacker earns nothing (C1) |
| 1,000 random submission orders | identical winner (P1) |
| adversary adds any subset of authentic messages | winner never later than honest-only winner (P2/P3) |
| duplicate submission | no state change, no second bounty (D4) |
| submit at `D−1` / `D` / after FINAL | accepted / `WINDOW_CLOSED` / `TERMINAL` (D1) |
| finalize/expire before `D` | `WINDOW_OPEN` (D1); expire with a candidate → `HAS_CANDIDATE` |
| wrong feed / wrong owner / Partial / bad predecessor / lag exceeded / confidence wide / price ≤ 0 | rejected, state unchanged (D3 + existing SBF negatives) |
| replayed account with foreign `write_authority`, adapter 3 | accepted; same message via adapter 2 spec | rejected (`WrongSponsoredPriceAccount`) |
| Core `settle_final` on a V3 FINAL Need | identical terminal result from two RPCs (Astra recovery CLI) |
| keyed option bound | every message a keyed party can impose has `publish_time ≤ first sponsored print` (X1) |

## 6. What I did not prove and who owns it

- Devnet replay end to end incl. guardian quorum semantics of `HDw2…` for the 5-key set (Sol).
- 24 h × 7 feeds cadence (Svemir) → per-feed `max_post_target_lag`; the model uses 30 s for SOL/BTC.
- Cost of a replay challenge (two Wormhole writes + verify + post + close) in lamports (Sol, devnet receipt).
- Reversal statistics (how often the outcome differs between the first and second sponsored print) — needs recorded entry history; state as unmeasured.

Fable's availability is bounded (Semir's word); everything above is written so the lane can proceed without me: the model is the spec, the tests are the acceptance matrix, §3 is the diff list.
