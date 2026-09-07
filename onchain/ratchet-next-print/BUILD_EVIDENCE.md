# Next Print local build evidence

Date: 2026-09-04
Status: local build plus value-free devnet deployment evidence; not a mainnet release.

## Identity

- devnet-candidate program id: `5bBHDFMmXQq6PNyrGVdSiKo3xpDvevbueYXZmp48bX4`
- artifact: `target/deploy/ratchet_next_print.so`
- bytes: `187480`
- SHA-256: `e819470d2d068af4c09e02e41d883034c43102c32b12c5453ddbaea14def90ba`
- static client SHA-256: `14652abe2eb0328cc6f36a4acde83815c552c880f8c5424b64f45a56dc1dbc17`
- minimal ABI SHA-256: `e15fa7e9175567ca42ae899dbc947974eed80fdac530c27372aa1a8b6e6e15e1`
- Rust ABI vector SHA-256: `b31d8ef02a15b7f2b9c435130a391ca671a724ef3b9afa9148eeb3bfcdd5ca20`

The deployment keypair was generated separately and is held outside the
repository. The candidate is deployed only on devnet.

## Toolchain observed

- rustc 1.98.0
- cargo 1.98.0
- solana-cli 4.2.1
- cargo-build-sbf 4.1.0
- platform-tools v1.54

This is not the repository's intended reproducible release line
(platform-tools v1.52). Therefore this hash proves only the local executable
tested below. Rebuild under the pinned release toolchain before any deployment
claim.

## Passing commands

    node test/test_next_print_model.mjs
    cargo fmt --check --manifest-path onchain/ratchet-next-print/Cargo.toml
    cargo test --locked --manifest-path onchain/ratchet-next-print/Cargo.toml
    cargo build-sbf --manifest-path onchain/ratchet-next-print/Cargo.toml -- --locked
    cargo test --locked --manifest-path onchain/ratchet-next-print/svm-tests/Cargo.toml
    cargo run --locked --manifest-path onchain/ratchet-next-print/Cargo.toml -p ratchet-next-print --example print_abi_vectors
    node test/test_next_print_client.mjs

Results:

- pure JS model: PASS
- Anchor host tests: 5 passed, 0 failed
- SBF build: PASS
- LiteSVM transactions: 8 passed, 0 failed
- Rust to static-JS ABI parity: PASS
- repository release gate: 114 passed, 0 failed, 0 skipped

The transaction suite proves a direct successor capture by an unrelated signer,
missed-successor VOID, same-time revision VOID, equality and exponent-change
VOID, exact timeout, wrong Receiver owner refusal, player reveal, and a TSLAX
path against manually encoded PriceUpdateV2 bytes. It also executes a public
mainnet-beta TSLAX Receiver-account snapshot captured at RPC context slot
`444108800` through the exact program binary as a valid entry. It proves that
open/captured Shot accounts cannot be closed early, then proves stranger close
of a terminal Shot, rent return to the recorded player and PDA removal.

The close-enabled SBF is deployed on devnet. The on-chain dump equals the local
187480-byte SBF prefix exactly; its remaining 4248 bytes are zero loader
padding. The official-Pyth lifecycle reached `OPEN -> VOID_TIMEOUT -> CLOSED`
with all signatures finalized. See `DEVNET_EVIDENCE_2026-09-04.md`.

## Still required

- live `CAPTURED -> REVEALED -> CLOSED` happy-path evidence when an official
  devnet successor is available;
- browser-wallet and Bankr integration against the checked static client;
- Token-2022/credit economics only after separate positive controls;
- pinned release-toolchain reproduction and independent review.
