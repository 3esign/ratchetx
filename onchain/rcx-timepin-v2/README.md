# RCX Timepin v2: generation-pinned, no-value evidence

Status: local implementation and runtime evidence. This directory is not a
deployment claim and must not receive RCX, SOL, game positions, treasury power
or production authority.

Timepin v2 has no admin, token, vault, pause, allowlist, API, database or
privileged cranker. Anyone can register an immutable evidence specification,
open its canonical target Need, submit admissible Pyth evidence and
permissionlessly terminalize or expire the Need.

The trust boundary is explicit: price truth still depends on Pyth publishers,
Wormhole guardians and their governance. A specification pins the official
upgraded Pyth Receiver and Push program identities plus the exact Receiver
ProgramData slot, complete 370-byte Receiver config hash, configured Wormhole
program and Wormhole ProgramData slot. Registration requires a later Clock
slot than both code generations. Every capture reauthenticates those pins and
requires `PriceUpdateV2.posted_slot > EvidenceSpecV2.registered_slot`.
Persistent generation drift therefore fails closed; an unanswered Need remains
permissionlessly expirable.

## Final state and Work Market ABI

`TimepinNeedV2` is the sole permanent terminal record. Its state and zero/one/two
candidate-hash shape determine Open, Candidate, Final, Ambiguous or Expired;
the terminal result hash is recomputed from the Need rather than stored in a
second terminal account.

`CandidateV2` retains only signed Pyth message values that cannot be derived
from the Need/spec, plus `posted_slot`, `capture_slot` and `capture_ts`.

Optional sponsored work uses producer-owned packed records:

- immutable `WorkManifest` PDAs for `FIRST_CAPTURE=1` and `TERMINALIZE=2`;
- optional `WorkPage` PDA `["work_page", need]`, capacity two;
- fixed 106-byte `WorkRecord` entries;
- open the page only while absent, then call `reserve_work`; and
- completion never creates a page. If no page exists, evidence/terminalization
  remains permissionless and unpaid.

The exact account sizes are:

- `EvidenceSpecV2`: 254-byte payload, 262 bytes including discriminator;
- `TimepinNeedV2`: 124-byte payload, 132 bytes including discriminator;
- `CandidateV2`: 111-byte payload, 119 bytes including discriminator;
- `WorkManifest`: 34-byte payload, 42 bytes including discriminator;
- `WorkPage`: 39-byte base payload / 47-byte full base, then 106 bytes per
  record, maximum 251-byte payload / 259-byte full account.

There is no `TerminalTimepinV2`, `CompletionReceipt` or `EvidenceRecordV2` in
the final ABI.

## Frozen vectors

`vectors/register-open-v2.json` freezes the 134-byte generation-independent
policy, 214-byte generation-bound specification, full config hash, PDAs,
instruction order and large Loader-v3 fixture.

`vectors/lifecycle-v2.json` freezes the compact Candidate, Need terminal shape,
Work Market locator ABI, lifecycle instruction accounts and hash domains.

The vectors distinguish host-proven invariants from exact-SBF runtime proof;
they do not claim that synthetic ProgramData bytes are mainnet dumps.

## Exact-SBF LiteSVM evidence

The manual harness uses no Anchor client and refuses to run unless the existing
artifact is the expected 414,264-byte ELF with SHA-256
`8D913A5D65B187D665D35088E577EE231B3F2BDB2954377AD4B986FAC343AB7F`.
This SVM task did not rebuild it.

The harness installs valid Loader-v3 Program and ProgramData account shapes,
including synthetic but exact fixture lengths:

- Receiver ProgramData: 425,984 bytes (`416 * 1024`), slot 900;
- Wormhole ProgramData: 671,744 bytes (`656 * 1024`), slot 901;
- Receiver config: exact 370 bytes, SHA-256 over the complete account data;
- registration Clock slot: 1,000.

Measured by LiteSVM on 2026-09-04:

```text
exact-SBF tests:          3 passed, 0 failed
register_evidence_spec:   35,532 CU
open_need:                22,456 CU
capture_first:            54,173 CU
```

The positive controls prove registration, open, idempotent unrelated-signer
open and a no-WorkPage capture at `posted_slot = registered_slot + 1`.
Negative controls prove atomic rollback for wrong Receiver ProgramData link and
slot, wrong full config hash, config-selected Wormhole mismatch, wrong Wormhole
ProgramData link and slot, same-slot generation observation, persistent
post-registration Receiver/config/Wormhole drift, `posted_slot ==
registered_slot`, and a future posted slot.

These CU values prove this exact LiteSVM path, not mainnet pricing or a mainnet
account snapshot. A release still needs a validator/devnet transaction with the
actual selected Receiver/config/Wormhole generation and an explicit compute
budget based on measured headroom.

## Artifact identity

```text
program id:  US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx
file:        target/deploy/rcx_timepin_v2.so
size:        414264 bytes
sha256:      8D913A5D65B187D665D35088E577EE231B3F2BDB2954377AD4B986FAC343AB7F
```

The ignored builder-generated keypair resolves to
`HN1mdp8MrxbxL5VXejZ9ww1SN4S946bc16ZLQK3xUjBP`, does not match `declare_id!`,
and is not a deployment identity. It was intentionally left untouched.

## Commands

```text
cargo fmt --manifest-path svm-tests/Cargo.toml --all -- --check
cargo test --locked --manifest-path svm-tests/Cargo.toml -- --nocapture
```

The suite loads `target/deploy/rcx_timepin_v2.so` by default. A caller may set
`RCX_TIMEPIN_V2_SO` to another path, but the fixed size and SHA-256 assertion
still reject any other binary.

Program host/SBF gates from the source refactor also pass: 14 host tests,
`cargo check`, and `cargo build-sbf` with zero stack-frame or verifier warnings.
The separate lifecycle SVM expansion for conflict/finalize/expire and sponsored
two-record WorkPage transactions remains a later release gate; only their pure
state transitions are presently host-tested.
