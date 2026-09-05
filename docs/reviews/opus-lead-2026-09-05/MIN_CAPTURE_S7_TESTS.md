# MIN-CAPTURE section 7 tests 1-3 — written and RUN, ready to paste

**From:** the lead. **For:** Opus A, whose file this is — I did not touch it.
**Status:** these three tests were injected into a copy of `lifecycle.rs` in the cloud
container and executed. `cargo test --lib` → **17 passed, 0 failed** (your 14 plus these 3).

## Where it goes

Inside the existing `#[cfg(test)] mod tests` in
`onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lifecycle.rs`, immediately **before**
`fn candidate() -> CandidateV2 {`. It uses your existing `spec()`, `need()` and `candidate()`
helpers unchanged.

One import line also changes, at the top of that module:

```rust
    use crate::{
        canonical_policy_bytes, evidence_policy_hash, ADAPTER_PYTH_MIN_CAPTURE_V2,
        ADAPTER_PYTH_PUSH_V2, VERIFICATION_FULL,
    };
```

## Why `fails_with` is in here

Every negative test in this file — and in `malformed_state.rs`, which an external review
already flagged for it — asserts `is_err()`. That passes when the code fails for a reason
nobody intended. A boundary test that cannot tell `PublishBeforeTarget` from
`ConfidenceTooWide` is not testing the boundary. `fails_with` compares the actual Anchor
error code number. All three tests below use it, and they were confirmed to pass *with* the
exact codes, not merely to fail.

The third test is the one I would not skip: it pins that adapter 1 still **refuses** the later
print adapter 2 admits, so the two rules cannot quietly converge into one.

## The block

```rust
    // ---- MIN-CAPTURE, spec section 7 items 1 and 2 -------------------------
    // Written against docs/MIN_CAPTURE_SPEC.md. Before these existed, NO test at
    // any level called validate_decision_fields negatively, which is how a rule
    // that measured 0 of 25 against the real feed reached the build queue.
    /// Assert the EXACT error, not merely that something failed.
    /// Every other negative test in this file asserts `is_err()`, which passes
    /// when the code fails for a reason nobody intended - the class of defect an
    /// external review already flagged in malformed_state.rs. A boundary test
    /// that cannot tell PublishBeforeTarget from ConfidenceTooWide is not
    /// testing the boundary.
    fn fails_with(result: Result<()>, want: TimepinLifecycleError) -> bool {
        match result {
            Err(anchor_lang::error::Error::AnchorError(e)) => {
                e.error_code_number == want as u32 + anchor_lang::error::ERROR_CODE_OFFSET
            }
            _ => false,
        }
    }

    fn min_capture_spec() -> EvidenceSpecV2 {
        let mut value = spec();
        value.adapter = ADAPTER_PYTH_MIN_CAPTURE_V2;
        // meaningless under this adapter; the spec requires it registered as zero
        value.max_pre_target_gap_seconds = 0;
        value.evidence_policy_hash =
            evidence_policy_hash(&canonical_policy_bytes(&value.as_args()).unwrap());
        value
    }

    #[test]
    fn min_capture_accepts_the_target_second_and_rejects_the_one_before() {
        let spec = min_capture_spec();
        let need = need(NEED_OPEN);

        let mut at_target = candidate();
        at_target.publish_time = need.target_ts;
        at_target.prev_publish_time = need.target_ts - 1;
        assert!(validate_decision_fields(&spec, &need, &at_target).is_ok());

        // one second early is the whole point of the rule and must fail closed
        let mut early = candidate();
        early.publish_time = need.target_ts - 1;
        early.prev_publish_time = need.target_ts - 2;
        assert!(fails_with(
            validate_decision_fields(&spec, &need, &early),
            TimepinLifecycleError::PublishBeforeTarget
        ));

        // and a LATER print is admissible here, where the strict bracket refused it
        let mut later = candidate();
        later.publish_time = need.target_ts + 4;
        later.prev_publish_time = need.target_ts + 3;
        assert!(validate_decision_fields(&spec, &need, &later).is_ok());
    }

    #[test]
    fn min_capture_accepts_the_lag_boundary_and_rejects_one_second_past_it() {
        let mut spec = min_capture_spec();
        // keep the source deadline out of the way so the LAG is what is tested
        spec.max_post_target_lag_seconds = 60;
        spec.evidence_policy_hash =
            evidence_policy_hash(&canonical_policy_bytes(&spec.as_args()).unwrap());
        let need = need(NEED_OPEN);

        let mut at_edge = candidate();
        at_edge.publish_time = need.target_ts + 60;
        at_edge.prev_publish_time = at_edge.publish_time - 1;
        assert!(validate_decision_fields(&spec, &need, &at_edge).is_ok());

        let mut past_edge = candidate();
        past_edge.publish_time = need.target_ts + 61;
        past_edge.prev_publish_time = past_edge.publish_time - 1;
        assert!(fails_with(
            validate_decision_fields(&spec, &need, &past_edge),
            TimepinLifecycleError::PostTargetLagTooLarge
        ));
    }

    #[test]
    fn the_strict_bracket_still_refuses_what_min_capture_admits() {
        // the same later print, under adapter 1, must still be rejected - the two
        // adapters must not quietly become the same rule
        let bracket = spec();
        let need = need(NEED_OPEN);
        let mut later = candidate();
        later.publish_time = need.target_ts + 4;
        later.prev_publish_time = need.target_ts + 3;
        assert!(fails_with(
            validate_decision_fields(&bracket, &need, &later),
            TimepinLifecycleError::DoesNotBracketTarget
        ));
    }

```
