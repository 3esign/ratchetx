# Two structural tests — written, run, ready to paste

**From:** the lead. **For:** Opus A. I did not touch `lifecycle.rs`.
**Status:** injected into a cloud copy and executed. `cargo test --lib` → **22 passed, 0 failed**.

Goes inside the existing `#[cfg(test)] mod tests`, before `fn candidate()`.

The first proves the property. The second **documents the hole and is designed to fail** the day you
add the invariant — that failure is the signal to delete the test, not to weaken the rule.

The invariant itself, for `validate_spec`, MIN-CAPTURE adapter only:

```rust
require!(
    args.max_post_target_lag_seconds < args.target_grid_seconds,
    TimepinV2Error::BadPostTargetLag
);
```

```rust
    // ---- Structural properties, proved from the parameters themselves --------
    // These need no cadence measurement. A 24h run tells us how ALIVE the game
    // is; these say what is TRUE of it, and they are decided by arithmetic the
    // moment a spec is registered.

    /// Under MIN-CAPTURE a print is admissible for target T iff
    ///     T <= publish_time <= T + lag
    /// so a single print serves two consecutive targets T and T+grid iff
    ///     T+grid <= publish_time <= T+lag,  i.e. iff  lag >= grid.
    /// Therefore lag < grid is NECESSARY AND SUFFICIENT for every print to
    /// belong to at most one target. No measurement can establish this and no
    /// measurement can refute it.
    fn serves_two_targets(lag: i64, grid: i64) -> bool {
        let t = 1_800i64;
        (t..=t + lag).any(|p| p >= t + grid && p <= t + grid + lag)
    }

    #[test]
    fn lag_below_grid_is_exactly_the_condition_for_unique_target_assignment() {
        for grid in [30i64, 60, 300] {
            for lag in 1..grid {
                assert!(!serves_two_targets(lag, grid), "lag {lag} grid {grid}");
            }
        }
        for grid in [30i64, 60, 300] {
            assert!(serves_two_targets(grid, grid), "grid {grid}");
            assert!(serves_two_targets(grid + 1, grid));
        }
    }

    #[test]
    fn the_spec_does_not_yet_enforce_it_and_that_is_the_gap() {
        let mut args = spec().as_args();
        args.target_grid_seconds = 60;
        args.max_post_target_lag_seconds = 120; // twice the grid
        assert!(
            crate::validate_spec(&args).is_ok(),
            "if this now fails, the invariant landed - remove this test"
        );
    }
```
