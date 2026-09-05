# MIN-CAPTURE — implementation spec (Timepin v2 + Core G2)

**Author:** Opus (lead). **Owner of this change:** Opus A (sole Rust editor).
**Status:** approved design, not built. **Decision record:** `docs/ROAD_TO_MAINNET.md` §2.
Do not improvise the predicate. If something here is wrong, say so in the room with the receipt —
do not silently implement a different rule.

## 0. Why the current rule cannot ship

`lifecycle.rs:1172` requires `prev_publish_time < target_ts && target_ts <= publish_time`. Pyth's
`prev_publish_time` is the previous Pythnet aggregate (one per second) and every sponsored message
carries `publish - prev = 1`, so exactly one message in Pyth's history brackets a given `T`: the first
aggregate of second `T`. The sponsored pusher posts on its own ~5 s schedule at a drifting phase, so
that message is almost never the one that lands. Measured on mainnet over 25 minutes: **0 of 25**
minute-aligned targets bracketed on each of SOL, BTC and ETH; **0 of 5** five-minute targets.

There is no keyless source that would give us every aggregate (three independent probes; room
10:16Z–10:31Z). The rule must therefore change, not the source.

## 1. The rule

> For target `T`, the admissible observation is the sponsored print with the **smallest
> `publish_time` such that `publish_time >= T`**, among **all** observations submitted before the
> Need's `capture_deadline_ts`.
> Ordering for replacement: smaller `publish_time` wins; on equal `publish_time`, smaller
> `posted_slot` wins; on equal both, smaller `price_message_hash` wins.
> **The order of submission never selects the price.**

### 1.0 The honest limit of this rule — read before implementing

The sponsored `PriceUpdateV2` account holds **one message at a time** and the pusher overwrites it
roughly every 5 s (SOL/BTC; ~52 s on ETH). The program reads the *live account*, never a cache, so a
message that was on the account at `T+2` is **gone** by `T+7` and no honest observer can submit it
afterwards. Replacement is therefore possible only **while the message is still on the account**, not
for the whole capture window.

What this rule does and does not buy, stated exactly:

- It **does** stop a single capturer from unilaterally fixing the price when at least one other
  observer is watching in real time during the availability window: both see `T+2`, both submit,
  the earlier `publish_time` wins regardless of who landed first.
- It **does not** let a late observer repair a withheld capture. A capturer who lets `T+2` vanish and
  submits `T+7` cannot be caught by the program, because `T+2` no longer exists anywhere the program
  can read.
- The safety assumption is therefore **1-of-N among observers watching in real time during the
  availability window** — not "anyone until `capture_deadline_ts`". Do not write the weaker claim in
  comments, docs or the settlement page. (Corrected 2026-09-05 11:12Z after Opus A's P1; the earlier
  wording in `ROAD_TO_MAINNET.md` §2 overstated it.)
- Operationally this means **at least two independent cranks polling every second are part of the
  security argument, not an optimisation.** Phase 3.4 in the tracker is load-bearing for Phase 1.

Everything else in `validate_decision_fields` stays exactly as it is: `max_post_target_lag_seconds`,
`source_deadline_ts`, positive price, exponent bounds, confidence bound, and all of `load_evidence`'s
account authentication (owner `rec2…`, sponsored PDA under `pyt2…` with shard+feed seeds, exact 134 B,
discriminator, `Full`, write authority, feed id, posted-slot bounds). Those are verified correct and
are not in scope.

### 1.1 The predicate, exactly

Replace the bracket `require!` with:

```rust
require!(
    candidate.publish_time >= need.target_ts,
    TimepinLifecycleError::PublishBeforeTarget
);
```

`max_pre_target_gap_seconds` has no meaning under this adapter. Do **not** remove the field (it is in
`canonical_policy_bytes` and every spec hash). Instead require it to be zero at registration for this
adapter, in `validate_spec`, so no dead number can sit in a spec hash and mislead a later reader.

The existing `post_lag <= max_post_target_lag_seconds` check is what makes the rule finite, and it is
already there. Keep it unchanged.

### 1.2 Adapter numbering

The adapter byte selects the predicate. **The existing `ADAPTER_PYTH_PUSH_V2` value keeps the strict
bracket** and is from now on marked experimental — it is honest only for a source that delivers every
aggregate, which we do not have. Introduce the next free adapter value for MIN-CAPTURE, make it the
only one `validate_spec` accepts for a mainnet-class registration, and name both in
`docs/SETTLEMENT.md`. Pick the number, state it in the room, and use the same number in `model.mjs`
and the vectors.

## 2. The storage change — and why it is part of the rule, not a follow-up

Today the candidate lives in its own PDA at `[CANDIDATE_SEED, need, expected_message_hash]`
(`lifecycle.rs:159-165`). That shape is wrong for a rule with replacement: every replacement mints a
**new** account, each one permanent actor-funded rent (measured 1,564,251 lamports), with no close
path. A Need that is improved three times strands three rents forever.

**Move the observation inline into `TimepinNeedV2`.** One account, no second rent, no
`init_if_needed` race, and `finalize` reads one place.

```
TimepinNeedV2 (LEN 124 -> 232)
    schema u16, bump u8, state u8,
    evidence_spec_hash [u8;32], target_ts i64,
    source_deadline_ts i64, capture_deadline_ts i64,
    observation_hash [u8;32],          // was candidate_a_hash — same 32 bytes, new name
    ambiguous_hash   [u8;32],          // was candidate_b_hash — set ONLY per §4
    // inline observation (was CandidateV2, minus schema/bump/need):
    price i64, conf u64, exponent i32,
    publish_time i64, prev_publish_time i64,
    ema_price i64, ema_conf u64,
    posted_slot u64, capture_slot u64, capture_ts i64,
    worker Pubkey,                     // who submitted the CURRENT best observation
```

Consequences to carry through, all of them:

- `CandidateV2`, `CANDIDATE_SEED`, `CaptureConflict`'s `candidate_b` and Core's `load_candidate` +
  `CandidateV2AccountView` (`foreign_timepin.rs:66,236-284`) all disappear. Core reads the Need only.
  This makes `foreign_timepin.rs` **smaller**, not bigger.
- `prev_publish_time` is still stored (it is part of the signed message and of
  `price_message_hash`), it is simply no longer part of the predicate.
- Need rent rises by roughly 0.0008 SOL; each avoided candidate account saves 0.00156 SOL. Net cost
  per shot goes down, and the unbounded case goes away entirely.
- Every vector, every `model.mjs` decoder, `client-v2.mjs`, and `docs/CORE_G2_LAYOUT.md` change with
  it. Opus B owns the JS side and moves in lockstep; land them in one commit.

## 3. The instruction set

**`capture`** (replaces `capture_first` + `capture_conflict`; keep one instruction):

1. Authenticate lifecycle, generation accounts, and load the evidence exactly as today.
2. `require!(price_message_hash(...) == expected_message_hash)`.
3. `require!(clock.unix_timestamp <= need.capture_deadline_ts, CaptureWindowClosed)`.
4. Validate decision fields (§1.1).
5. Dispatch on state:
   - `NEED_OPEN` → write the observation, `worker = actor`, `state = NEED_CANDIDATE`,
     `observation_hash = expected_message_hash`. **No work receipt is paid here** (§5).
   - `NEED_CANDIDATE` and `expected_message_hash == need.observation_hash` → no-op, emit `Duplicate`.
   - `NEED_CANDIDATE` and the new observation is **strictly better** by the §1 ordering → overwrite
     the inline observation and `worker`, keep `state`, emit `Replaced` with both hashes.
   - `NEED_CANDIDATE`, same `publish_time`, different hash → §4.
   - `NEED_CANDIDATE` and the new observation is **worse** → `err!(NotBetterThanCurrent)`. It must be
     an error, not a silent no-op: a crank that submits a worse print has a bug and should learn.
   - any terminal state → `TerminalOrWrongState`, unchanged.

**`finalize`** — one new precondition, and it is the load-bearing line of this whole design:

```rust
require!(
    clock.unix_timestamp >= need.capture_deadline_ts,
    TimepinLifecycleError::CaptureWindowStillOpen
);
```

Without it the first capturer finalizes in the same slot as their own capture and locks their own
print in before any competing crank can land. It does **not** extend the availability window of §1.0 —
nothing can — but it is what lets a crank that saw the same message land its transaction at all.
**The replacement window must actually elapse.** The cost is real and accepted: a shot resolves at
`T + max_post_target_lag + capture_grace`, not at first capture. For SOL/BTC that is tens of seconds
after the target. State this on the settlement page.

**`expire`** — unchanged.

## 4. `AMBIGUOUS` narrows

Two distinct Pyth-signed messages with the **same `publish_time`** for the same feed and shard should
be impossible. Keep the safety net, but only for that case: set `ambiguous_hash`, go
`NEED_AMBIGUOUS`, terminalize, pay `WORK_KIND_TERMINALIZE` as today. Order the two hashes as today so
the terminal result hash is canonical.

A later observation with a **larger** `publish_time` is not a conflict and must never produce
`AMBIGUOUS`. Under the old rule that case was impossible; under this rule it is the common case.
This is the single most likely place to get the port wrong.

## 5. The reward — Codex's P1, closed here

Today `capture_first` pays `WORK_KIND_FIRST_CAPTURE` with `RECEIPT_PAYABLE` immediately
(`lifecycle.rs:836-848`). Under a replaceable rule that pays a worker who may be displaced minutes
later — a racer can submit a deliberately inferior first print, collect, and be replaced by the real
minimum.

- **Version or remove `WORK_KIND_FIRST_CAPTURE`.** Do not reuse the constant with new meaning; an
  old irreversible receipt must not be satisfiable by the new path.
- The capture reward is paid **once, at finalize**, in the same atomic terminal transition, to
  `need.worker` as stored at finalize — never to `PriceUpdate.write_authority`, never to the
  transaction's fee payer, never to an alias.
- If a Need terminalizes as `AMBIGUOUS` or `EXPIRED`, the capture reward is **not** paid; the
  terminalize receipt is separate and unchanged.
- Conservation: `C + 2R` against the Shot rent floor must still hold. Astra's escrow matrix review
  and Codex's four invariants (room 10:27Z) apply to this wiring and must be re-checked against it.

## 6. Also in this change (they touch the same functions — do not split them)

- **Clock-skew gate** (`lifecycle.rs:1236-1239`): `require!(clock.unix_timestamp + max_future_skew >= target_ts)`,
  and floor `max_future_skew_seconds >= 30` in `validate_spec` (`lib.rs:468-471`). Same relaxation in
  `foreign_timepin.rs:291-294`. Solana's clock lags wall time and the first post-`T` print lives on the
  account for about 5 s; without this a perfectly valid capture is rejected.
- **Generation pin** (`lib.rs:553-565`): pin `wormhole`, `valid_data_sources` and `minimum_signatures`
  only, not the whole 370-byte Receiver config. Today any benign Pyth governance action makes every
  spec uncapturable and voids every open Need. Also pass the generation accounts to `open_need`
  (`lib.rs:244-268`) so a dead spec stops admitting new Needs; `authenticate_generation_accounts`
  already exists.
- **Forward landing race** (Codex 10:00Z): accept any aligned `entry_target_ts >= Clock + min_lead`,
  then authenticate the exact OPEN Need. Timepin already enforces alignment and max-ahead at
  `open_need`. Boundary tests: succeeds at `e = T - L`, fails at `e = T - L + 1`; misaligned and past
  targets fail; the same `T` always yields the same Need PDA; a failed open rolls back fully.

## 7. Tests — the ones that do not exist today

There is currently **no host or SBF test that calls `validate_decision_fields` or `load_evidence`
negatively**. That gap is why this rule survived to the build queue. Write these first, before the
implementation, and let them fail:

1. `publish_time == T` accepted; `publish_time == T - 1` rejected `PublishBeforeTarget`.
2. `publish_time == T + max_post_target_lag` accepted; `+1` rejected `PostTargetLagTooLarge`.
3. Replacement: submit `T+4`, then `T+2` → observation becomes `T+2`, `worker` becomes the second
   submitter; then submit `T+3` → `NotBetterThanCurrent`, observation unchanged.
4. Same `publish_time`, different hash → `NEED_AMBIGUOUS`, terminal, capture reward unpaid.
5. `finalize` before `capture_deadline_ts` → `CaptureWindowStillOpen`. Then after it → `FINAL` with
   the minimum, reward paid exactly once to the stored worker.
6. `capture` after `capture_deadline_ts` → `CaptureWindowClosed`; the Need still expires normally.
7. Reward can never be paid twice: finalize twice → second call fails in the state machine.
8. Old `WORK_KIND_FIRST_CAPTURE` receipt cannot be satisfied by the new path.
9. Clock-skew boundary: `clock == target - max_future_skew` accepted, one second earlier rejected.
10. A replacement that arrives in the same slot as the original is ordered by `posted_slot`, then hash.

Every one of these belongs at exact-SBF (LiteSVM) level as well as host, because the state machine and
the rent behaviour are what changed. Report the tier with the result — a host-only green is not a GO.

## 8. Explicitly out of scope for this change

Do not touch: the price-account authentication in `load_evidence`, PDA seeds for spec and need, the
Economy/Ruleset content addressing, Token-2022 handling, day finalization, or anything in Core G2
other than the Timepin record decoder. Do not run `cargo build-sbf`. Do not re-pin vectors or lock an
ELF hash until this lands and the tests in §7 are green — that is one build, not three.
