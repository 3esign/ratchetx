# RCX Timepin v0.1

Experimental, no-value, devnet-only prototype. It is not deployed, does not
move RCX, does not settle RatchetX credits, and is not production authority.

Timepin is intended to turn one future timestamp into non-evicting,
independently readable Pyth evidence. Anyone may pay rent to open the canonical
Need before its target. After the target, anyone may capture the exact fully
verified sponsored Pyth shard-0 message whose signed interval brackets the
target. Anyone may then finalize the submitted candidate or expire an
unanswered Need.

There is deliberately no administrator, config account, pause switch,
allowlist, sponsor identity, API key, HTTP dependency, ring buffer, account
close, token transfer, bounty, treasury, or upgrade ceremony in this slice.
The signer on each instruction is only the public actor whose provenance is
recorded; it has no special capability and need not be the transaction fee
payer. The opener separately pays the Need's rent.

## What `Final` does and does not prove

The sponsored shard-0 account is live mutable state. A later Pyth push
overwrites its previous `PriceUpdateV2`, and v1 deliberately rejects a copy in
any other account. The 180-second window is therefore a transaction deadline,
not source retention. `Final` means one distinct valid message was submitted
and no second distinct message was submitted before that deadline. It does not
prove that no qualifying message was ever missed or withheld.

Surfacing every ambiguity requires at least one independent honest watcher to
observe and land every relevant transition before overwrite. This is an
explicit blocker for Core G2 and every value-bearing use. A later schema may
evaluate receiver-verified archival accounts, but only after their owner,
Full-verification and caller-controlled write-authority rules are proved, and
without introducing an API key. v1 remains live-sponsored-capture only.

Pyth Receiver/Push Oracle governance and availability, Wormhole verification,
Pyth publishers, Solana consensus and Solana Clock remain trust boundaries.
Program upgrade authority is a deployment property outside this source. This
prototype is neither deployed nor immutable, and no freeze is part of it.

## Build and test

Pinned source dependencies are in `Cargo.lock`; the intended SBF toolchain is
Agave `3.1.10` with platform-tools `v1.52`, matching the RatchetX reproducible
build line.

```sh
cargo fmt --check --manifest-path onchain/rcx-timepin/Cargo.toml
cargo test --locked --manifest-path onchain/rcx-timepin/Cargo.toml
cargo build-sbf --manifest-path onchain/rcx-timepin/Cargo.toml -- --locked
cargo test --locked --manifest-path onchain/rcx-timepin/svm-tests/Cargo.toml -- --nocapture
```

The host suite is the first gate and exercises the same validators and state
transition functions called by the instructions. An SBF artifact is not a
release artifact until the exact pinned builder, artifact hash, independent
program-id review, and devnet transaction tests are recorded.

`ci/timepin-build.workflow.yml` is an intentionally inactive GitHub Actions
template. It pins Agave `v3.1.10`, hard-fails unless the builder reports
platform-tools `v1.52`, runs both host and LiteSVM batches against fresh SBF
bytes, deletes the builder's throwaway key file, publishes only the no-value
artifact/hash/spec, and contains no deployment step. Activating it requires a
separately reviewed move to repository-root `.github/workflows/`.

## State in one line

`Open -> Candidate -> Final`, `Open -> Expired`, or
`Candidate -> Ambiguous` when two distinct fully valid crossing messages are
submitted before the common deadline. Candidate records are sorted by raw
message hash; capture and terminal provenance remain history-specific.

See [SPEC.md](SPEC.md) for the byte-level identity and terminal rules.
