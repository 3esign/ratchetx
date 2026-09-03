# Local build evidence - 2026-09-03

Scope: experimental Timepin v0.1 only. No deployment and no value path.

## Green checks

```text
cargo fmt --check                         PASS
cargo test --locked                       PASS (10/10, plus 0 doc tests)
cargo check --release --locked             PASS
cargo build-sbf -- --locked                PASS
cargo test --locked (svm-tests)            PASS (6/6 transactions)
```

The tests include a byte-for-byte Anchor serialization length assertion, a
real serialized Pyth `PriceUpdateV2` round trip, source-identity adversarial
cases, strict crossing boundaries, state/deadline adversarial cases, terminal
immutability, and pinned deterministic PDA/message-hash vectors.

The transaction batch loads the compiled SBF bytes in LiteSVM and proves the
canonical Open -> Candidate -> Final life cycle, replay idempotence, both
submission permutations for two distinct valid crossings (identical
canonically sorted raw-message hashes while capture provenance remains
history-specific), bad-owner/partial/wrong-PDA rejection, instruction-level
late-open rollback, pre-funded-PDA initialization plus re-init rejection,
same-publish raw-message revision -> Ambiguous, and complete withholding ->
Expired terminalization.

These tests prove the validator and submitted-message state machine. They do
not prove that a mutable sponsored account retained every crossing long enough
for a transaction to land. `Final` is not a proof of complete Pyth history;
the live watcher/capture-completeness boundary in `SPEC.md` blocks Core G2 and
all value use.

## Keyless live source positive control

At finalized mainnet context slot `443839215`, a public-RPC read of the
documented upgraded SOL/USD shard-0 account
`7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE` returned:

- owner `rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp`;
- exactly 134 bytes and Full verification;
- the expected SOL/USD feed id;
- `write_authority` equal to the sponsored account address;
- `prev_publish_time=1788396979`, `publish_time=1788396980`;
- `posted_slot=443839203`, behind the response context slot.

This is one source-identity/layout positive control, not capture-completeness or
availability evidence. It used no API key and made no transaction.

## Local SBF result (not a release artifact)

```text
cargo-build-sbf: 4.1.0
platform-tools:  v1.54
rcx_timepin.so:  181752 bytes
SHA-256:         d846679ca7dfe7ec258f4d2ec43bc44139a9bdefcdce1ca4539c83a2314b6855
```

This hash is local semantic-build evidence only. The intended candidate builder
remains Agave `3.1.10` plus platform-tools `v1.52`, with host Rust
`1.98.0`; that exact CI build must produce and publish the candidate hash
before devnet. The inactive workflow pins action commits and verifies the
official Anza Linux release archive SHA-256 before execution.

Anchor emitted its known macro `unexpected cfg` warnings and the SBF builder
warned that the dual `cdylib`/`lib` crate types disable LTO. Neither warning is
a source failure. Release sizing and the final crate-type choice remain a
pre-devnet review item.

The SBF builder's automatic throwaway key file was deleted without retaining
or using it. It is not a deployment key. A separately authorized, reviewed
program-id ceremony is still required before any devnet deployment.
