# The exact-SBF suite, executed for the first time against this source

**2026-09-05, Opus B. Evidence tier: exact-SBF** for the transaction results below;
**host** for everything derived by reading source.

Nobody had run `onchain/ratchet-core-g2/svm-tests` against the current tree, because
you cannot: the harness refuses anything but a content-addressed SBPFv3 pair, and the
artifacts in this repository are the stale 4 September v0 build. I built a v3 pair on
the pinned toolchain, so this is the first execution.

## What was run

    cargo build-sbf --arch v3 --tools-version v1.56 -- --locked   # both crates
    # each .so copied to <tmpdir>/ratchetx-onchain-sbf/<sha256>/<name>.so
    RATCHET_CORE_G2_SO=... RCX_TIMEPIN_V2_SO=... cargo test --locked

| artifact | sha256 | size | verify-artifact |
|---|---|---|---|
| `ratchet_core_g2.so` | `09ce47a182de93fdc7a8ca500ba1674f9a2465b48034d4080129a5c3af02136d` | 1,010,752 | PASS (id `cGfHiC6…`, sbpf v3) |
| `rcx_timepin_v2.so` | `f2d1e93aea77d4af5a98c4bf576ead58361b856a18d2990ac820751f7d3cb546` | 379,400 | PASS (id `C8wwxU…`, sbpf v3, forbidden `US517…` absent, 0 occurrences) |

The harness demands the `ratchetx-onchain-sbf/<sha256>/` layout and refuses any path
with a `target` component (`tests/core_g2_lifecycle.rs:135-173`). That is the same rule
that stops `BUILD_G2.cmd` at step 3 and the gate's own B1 verify. Three tools enforce
it; two callers violate it.

## Result 1 — the suite does not bootstrap. 0 of 16.

Every test died before Core was reached, in `register_timepin_spec`:

    AnchorError thrown in programs/rcx-timepin-v2/src/lib.rs:603.
    Error Code: BadPostTargetLag. Error Number: 6009.

`core_g2_lifecycle.rs:568-573` encodes `target_grid_seconds = 60` and
`max_post_target_lag_seconds = 120`. R2's `require!(lag < grid)` at `lib.rs:603` is
correct and the fixture is a broken game: one print settles two targets. The harness has
carried it since before the rule existed, and no gate row can see a suite that cannot start.

## Result 2 — a real Timepin writes 276 bytes. The harness and Core both say 132.

With `:572` changed to `59u32` (derived: `grid - 1`, which `lib.rs:597-602` argues is
optimal for every feed) the suite reaches the Need and panics:

    assertion `left == right` failed
      left: 276
     right: 132        # core_g2_lifecycle.rs:1322

`left` is a live Timepin SBF's account. `right` is the same constant Core hardcodes at
`foreign_timepin.rs:26` as `NEED_ACCOUNT_LEN = 8 + 124`.

Length assertions at `:1257 :1322 :1358 :1432`.

## Result 3 — the harness fabricates the account it authenticates.

`need_data()` at `:1240-1258` builds a Need by hand and stops after `candidate_b_hash` —
124 payload bytes, Core's stale field list exactly. Every negative test
(`settle_final_rejects_*`) hands Core an account that Core's own stale view agrees with,
so they pass at any length. **A harness that builds the account it is authenticating
proves the decoder is self-consistent and nothing else.** It is the same shape as an
exact-SBF price test that fabricates the price account with `set_account`.

Widening it by 144 zero bytes (108 observation + 32 `obs_worker` + 4 `open_refs` + 32
`rent_payer` = 268) is what let a transaction finally reach Core.

## Result 4 — Core refuses the Need. Exact-SBF, on `SealForward`.

    Program cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN invoke [1]
    Program log: Instruction: SealForward
    Program log: AnchorError thrown in programs/ratchet-core-g2/src/foreign_timepin.rs:115.
      Error Code: BadTimepinLength. Error Number: 6002.
      Error Message: foreign Timepin account has the wrong exact length.
    Program cGfHiC6… failed: custom program error: 0x1772

`foreign_timepin.rs:115-117` is `require!(data.len() == expected_len)` — an equality, and
`payload.is_empty()` below it forbids a longer account even if the length passed. All seven
Core paths that load a Need are affected: seal at `lib.rs:920 :926 :1078 :1084 :1250 :1425`,
settle at `:1725`.

This confirms at exact-SBF tier what `test/test_foreign_timepin_abi.mjs` (commit `1d80975`)
reports at host tier.

## Distance remaining, measured rather than estimated

Beyond the four steps above the suite hits stale deadline fixtures — measured
`1800000119` against expected `1800000180`, off by exactly the 61-second lag delta
(`:1330-1331`). That is the same arithmetic C2 needs in the Timepin unit tests, in a
second place.

## What this is not

Every edit above was made in a container copy. **No file in this repository was changed.**
The four numbers are a measurement of the distance, not a proposed patch: `svm-tests` is
not my file, and the deadline fixtures need the same derivation Opus A is doing for C2.

The artifacts are evidence that the build works. They were produced on x86-64 Linux in
an agent container, not on the canonical build machine, and they are **not deployable and
not canonical**.

## For the gate

`C1` and `C2` can both read GO while these two programs cannot transact. There is no row
for the pair, and none for whether the exact-SBF suite runs at all — a suite that cannot
bootstrap is indistinguishable from a suite that was never written.
