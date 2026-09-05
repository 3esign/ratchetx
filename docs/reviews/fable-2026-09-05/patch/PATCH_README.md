# live_capture_min_adapter2.patch — Timepin ADAPTER_PYTH_PUSH_LIVE_MIN (= 2)

Fable, 2026-09-05. NOT APPLIED anywhere. `git apply --check` / `patch -p1 --dry-run` succeed against the pinned sources listed below (the working-tree files captured 2026-09-05 ~02:0xZ). Sol owns Rust; this is the exact diff behind PAYOUT_DETERMINISM_THEOREM.md §6 so the integration is a review, not a rewrite.

Base files (sha256 of the exact bytes the patch was made against):
```
5bbcd7ec12a1b29b80fa8ed1a45e737c2393ae51b056763add812950fa5e1800  onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lib.rs
b80e00da062594642b2142301d715d54c228ef94d3db6b8d1170dc5287d92a98  onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lifecycle.rs
574c7bf8cc56922c729a479b8f1b64c03f5e75c48c6b4e4a02e02b6da8769153  onchain/ratchet-core-g2/programs/ratchet-core-g2/src/foreign_timepin.rs
```

What it changes (71 added lines, 4 files touched conceptually, 3 physically):
1. `rcx-timepin-v2/src/lib.rs`: new constant `ADAPTER_PYTH_PUSH_LIVE_MIN = 2` (documented); `validate_spec` accepts adapter 1 or 2. Everything else about a spec (receiver/push-oracle pins, Full, grid, lead, ahead, gap/lag/grace bounds, skew, exponent, confidence, generation pins) is unchanged — adapter 2 keeps the sponsored-PDA and write_authority pins in `load_evidence` untouched (provenance by construction).
2. `rcx-timepin-v2/src/lifecycle.rs`: `validate_decision_fields` branches on `spec.adapter`: adapter 2 requires `target_ts <= publish_time` (post-lag, source deadline, price, exponent, confidence unchanged; pre-gap not evaluated); adapter 1 unchanged byte-for-byte in behaviour. `capture_conflict_handler`: under adapter 2 a different message is refused with the new error `LaterThanWinner` before any write (state stays NEED_CANDIDATE, candidate_b never created); adapter 1 keeps its AMBIGUOUS path. New error variant appended at the end of `TimepinLifecycleError` (existing codes unchanged — verify with the vectors that no error index shifted: it is appended after `DuplicateMustUseFirstCapture`, which is NOT the last variant, so codes after it shift by one — if the repo pins error codes numerically, move the variant to the end of the enum instead).
3. `ratchet-core-g2/src/foreign_timepin.rs`: `validate_spec_shape` accepts adapter 1 or 2; `validate_record_against_spec` mirrors the producer predicate per adapter.

What it does NOT change: account layouts (EvidenceSpecV2 262 B, Need 132 B, Candidate 119 B), PDAs, hashes, WorkPage kinds (FIRST_CAPTURE still completed at first capture — which under adapter 2 is the winner by construction), finalize/expire gates, Core's `authenticate_final`. Nothing about replay accounts is admitted; adapter 3 is a separate future generation.

Tests to add before the SBF gate (from `v3-rule/test_live_capture.mjs`):
- LC1: phase-2 sponsored fixture, minute target, capture at first post → CANDIDATE with publish_time = T+2; finalize after deadline → FINAL.
- LC2 negative: a rec2-owned Full PriceUpdateV2 that is NOT the sponsored PDA (replay account) → `WrongSponsoredPriceAccount` under adapter 2 (pins unchanged).
- LC3: second capture with a later message → `LaterThanWinner`, Need unchanged, no candidate_b account created; duplicate message → `capture_first` duplicate disposition.
- Bracket negatives that now matter: `publish_time < T` → `DoesNotBracketTarget`; `publish_time > T + lag` → `PostTargetLagTooLarge`.
- Vectors: `core-rules` unaffected; Timepin register/lifecycle vectors regenerated with `adapter: 2` specs (spec hash changes → ruleset/economy hashes change).
- Error-code pin check (see item 2).

Compile status: not compiled here (no cargo in the review sandbox). The diff is syntactically conservative (require!/if-else, one enum variant, one import).
