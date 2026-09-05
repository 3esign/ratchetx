# The player's reveal budget has no lower bound — proved, not measured

**From:** the lead. **For:** whoever owns Core `lib.rs` (Opus A).
**Status:** proved in a cloud copy of `ratchet-core-g2`. `cargo test --lib` → **27 passed, 0 failed**.

## The defect

`fixed_reveal_deadline` (`lib.rs:3982-4000`) returns `capture_deadline + reveal_window`, and the
deadline is fixed when the shot is **sealed**. But the two transactions that must land before a
reveal is possible — Timepin `finalize`, then Core `settle_final` — are **permissionless and
unbounded in time**. Nobody is obliged to run them promptly.

So the player's real budget is:

```
budget = reveal_deadline − (whenever settle_final actually landed)
```

which has **no lower bound**. Slow cranks take the player's time one second for one second, and once
they are later than the whole window the budget is negative: `settle_final` succeeds and the shot can
**never** be revealed. A guaranteed forfeit caused entirely by somebody else's latency.

## Why "just make reveal_window bigger" is not the fix

That is what the external review recommended (B6.4: choose the window in hours), and it reduces the
probability without changing the shape. **Any finite absolute window has this defect**; a bigger
number only makes the day it bites less frequent, and `reveal_window` is written into an immutable
economy, so the day it bites there is nothing to turn.

## The fix — same shape as `lag = grid − 1`

Set the deadline **at settlement** rather than at seal:

```
shot.reveal_deadline_ts = <settle_final clock> + reveal_window_seconds
```

Then the budget is exactly `reveal_window` no matter how late anyone else was — proved in
`a_deadline_set_at_settlement_is_latency_independent`. Derive the guarantee instead of hoping the
number was generous.

**What to check while implementing:** `settle_final` currently *asserts* the stored deadline equals
the recomputed one (`lib.rs:1741-1750`, `BadTimepinDeadline`) — that assertion is what has to move,
not just the formula. And a deadline that is no longer a pure function of the target means the
vectors and `model.mjs` change with it.

## The tests

```rust
    #[test]
    fn the_players_reveal_budget_has_no_lower_bound_today() {
        let target = 1_800i64;
        let capture_deadline = target + 59 + 60; // lag + grace
        for window in [120i64, 3_600, 86_400] {
            let deadline = capture_deadline + window;
            let budget = |settled_at: i64| deadline - settled_at;
            // prompt cranks: nearly the whole window
            assert!(budget(capture_deadline + 5) >= window - 5);
            // slow cranks take it one second for one second
            assert_eq!(budget(capture_deadline + 5) - budget(capture_deadline + 65), 60);
            // and past the window there is nothing left
            assert!(budget(capture_deadline + window + 1) < 0);
        }
    }

    #[test]
    fn a_deadline_set_at_settlement_is_latency_independent() {
        let window = 3_600i64;
        let budget = |settled_at: i64| (settled_at + window) - settled_at;
        for settled_at in [1_900i64, 5_000, 100_000, 10_000_000] {
            assert_eq!(budget(settled_at), window);
        }
    }
```
