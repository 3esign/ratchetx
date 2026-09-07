# Ratchet Next Print

Minimal server-free RatchetX program candidate. It records a wallet-bound sealed
call against a fresh sponsored Pyth print and permits any signer to capture only
that print's direct successor. Missed successor, source revision, broken source
chain, exponent change, equality and timeout are deterministic VOID states.
Observer liveness remains an explicit assumption: nobody can be compelled to
submit the direct successor, and a successor that is missed produces VOID rather
than letting a later, favorable print replace it.

This is not yet a value program. It moves no RCX, credits, SOL bounty or payout.
The devnet-candidate program id is:

    5bBHDFMmXQq6PNyrGVdSiKo3xpDvevbueYXZmp48bX4

Its deployment keypair is held outside the repository. The value-free candidate
is deployed on devnet; it is not deployed on mainnet. Do not reuse the old Core
id, and do not connect production value until Token-2022 positive controls pass.

Cluster proof is deliberately asymmetric: official SOL push exists on devnet,
while TSLAX was absent there when checked on 2026-09-04. The captured official
mainnet TSLAX account is preserved under `fixtures/` and passes the same SBF
entry path in LiteSVM. No fake devnet oracle owner is used.

Host checks:

    cargo fmt --check --manifest-path onchain/ratchet-next-print/Cargo.toml
    cargo test --manifest-path onchain/ratchet-next-print/Cargo.toml
    node test/test_next_print_client.mjs

The runtime client is [client/client-v1.mjs](client/client-v1.mjs). It needs only
`@solana/web3.js`, derives the shot and Pyth PDAs, builds all six instructions
and decodes the 396-byte Shot account. The minimal checked-in ABI is
[abi-v1.json](abi-v1.json); Rust-emitted bytes are pinned in
[vectors/abi-v1.json](vectors/abi-v1.json).

The first official-Pyth devnet lifecycle and its finalized signatures are
recorded in [DEVNET_EVIDENCE_2026-09-04.md](DEVNET_EVIDENCE_2026-09-04.md).

Product contract: [TRUSTLESS_NOW_NEXT_PRINT.md](../../docs/TRUSTLESS_NOW_NEXT_PRINT.md).
