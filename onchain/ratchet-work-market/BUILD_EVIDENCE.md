# Work Market v1 build evidence

Evidence date: 2026-09-04  
Status: byte-verified devnet candidate; not deployed to mainnet.

## Fixed identity

- Program ID: `EdwrtcJ254e5BDSHbY6oZosdjPBrXLMZc9PzkmR9GBVD`
- RCX mint: `FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump`
- Token program: Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`)

The program keypair is stored outside the repository at `D:\keys\ratchet-work-market-program.json`. No secret key material is committed or reproduced here.

## Mainnet mint fixture

One finalized `getAccountInfo` response and mint decode were captured atomically at mainnet-beta context slot `444123919`:

- account size: 409 bytes
- data SHA-256: `547c288ed91788e249908da2de5295bc895859658a8f2ac98d6c8b606eea7f44`
- owner: Token-2022
- decimals: 6
- supply: `936699884132132` base units
- mint authority: none
- freeze authority: none
- extensions: `MetadataPointer`, `TokenMetadata`

Fixture file: `fixtures/rcx-mainnet-mint-2026-09-04.json`  
Fixture-file SHA-256: `351fcb70630fd30e884399617f9ad248ecb16d64c649ded6e68559b90847e843`

This 409-byte positive control matters: a synthetic base 82-byte Token-2022 mint would not prove that the program and test harness accept the real RCX extension layout.

## Program tests

`cargo test --workspace --quiet` completed with 3 passed, 0 failed. It covers the fixed program/mint/token identities and exact account layout constants. Anchor emitted known macro `unexpected_cfgs` warnings; there were no test failures.

`cargo build-sbf -- --locked` completed successfully.

- SBF path: `target/deploy/ratchet_work_market.so`
- size: 235,552 bytes
- SHA-256: `ad6830c32e77bf02bac666006f8ddc4e10f8bff52388c9a693c516072ae3494e`

The same bytes were deployed to devnet:

- deployment signature: `377dfvu4g9gyh7ZTa2KPWpCrwXA2hqYyJXDGSyt3BfgPXGmh8ZLfSrqcFxQ1ECervvU3rCbEXr5pN1SsX2Gxs4HT`
- deployed slot: `492838526`
- ProgramData: `459V16YCDVoxtYvkgKugjPktaiXqxnZedvX1uvCJ6mvU`
- upgrade authority during soak: `9R17sG7w5b4w4DYkXAGAxDGKM4ktAToum3L31VJgkJUy`
- dumped devnet SBF SHA-256: `ad6830c32e77bf02bac666006f8ddc4e10f8bff52388c9a693c516072ae3494e`

## LiteSVM adversarial suite

`cargo test --manifest-path svm-tests/Cargo.toml --test work_market -- --nocapture` completed with 8 passed, 0 failed:

1. the exact real mainnet RCX mint fixture funds a nonzero voucher, pays the fixed worker and cleans up rent;
2. a terminal nonpayable receipt returns every vault unit to the fixed sponsor;
3. classic SPL Token, wrong mint, wrong subject/program family, wrong receipt owner/fields/disposition and substituted worker cannot move RCX;
4. multiple sponsors remain isolated while one canonical receipt allows each independent voucher to settle once.
5. the real Next Print v2 SBF consumes a direct Pyth successor, writes its own durable payable receipt and routes 12 nonzero RCX to the actual observer;
6. the real v2 timeout writes its own nonpayable receipt and routes all 15 RCX back to the sponsor;
7. the real v2 missed-successor path writes its own nonpayable receipt and routes all 9 RCX back to the sponsor, proving failed work cannot earn a bounty;
8. the exact captured 134-byte mainnet TSLAX Receiver account enters the real v2 SBF through the pinned tokenized-stock feed path.

The suite also donates extra RCX to a funded vault. Claim/refund moves the complete actual balance to the already fixed destination and closes the vault, preventing dust-based cleanup denial or value redirection.

The first four isolated adversarial cases deliberately inject controlled receipt bytes so every invalid field can be mutated. The three composition cases do not inject receipts: they execute Next Print v2's canonical work and `write_completion_receipt` instructions. Both SBFs loaded by LiteSVM are the exact byte-hashed deployment artifacts. The tested and devnet-deployed v2 executable SHA-256 is `01bab651f511cd72c480c432425c1bb343c91ab17f4df63c5ffdac1a8b0d52cc`.

Final eight-test LiteSVM source SHA-256: `64f3da14dccb7bf44592d1bd20a47847cddcdd5806f049b4d9a9e8e695fc7326`.

## Rust/JavaScript ABI parity

The Rust example derives PDAs and serializes Anchor instruction data. Its output is pinned in `vectors/abi-v1.json`; `node ../../test/test_work_market_client.mjs` then independently reconstructs the same values in JavaScript.

Result:

```text
WORK MARKET static client PASS: Rust vectors, Token-2022 ATA, PDAs, ABI and parser guards
```

- client SHA-256: `6a748aab3d14fd97c2c9d30d6b1ffa717720abc8f6b7d008e6ea4e8bf44bcd92`
- vector SHA-256: `192f4fad4089c4d6340cad9c3ed66bf91ca64568e2163305bf94a6cb3590ddcf`
- machine contract SHA-256: `29f24b225e85d680c2529c8043990ac0c4291bdb76266ced01b71edcd319359d`
- static test SHA-256: `457c3c0ff43ba27962e77bd63901e080ceb59b446d861082d2aaa473c07e9772`

The test covers program and token identities, voucher/vault/receipt PDAs and bumps, Token-2022 associated-token derivation, all instruction bytes, signer/writable topology, account ordering, classic-token exclusion, valid parsing and discriminator/size/range guards.

## Toolchain observed

- `rustc 1.98.0 (88d9e12ae 2026-08-18)`
- `cargo 1.98.0 (797e8a9bc 2026-08-05)`
- `solana-cli 4.2.1` (Agave)
- `anchor-lang = 1.0.2`, `anchor-spl = 1.0.2`
- `litesvm = 0.16.0`, `solana-sdk = 4.0.1`

The standalone Anchor CLI was not installed or required; Cargo and `cargo build-sbf` were used directly.

## Honest remaining gate

Next Print v2 and Work Market are deployed and byte-verified on devnet. The public official-Pyth run produced a durable v2 receipt, but the exact mainnet RCX mint account is absent from devnet. Work Market intentionally rejects substitutes, so a public devnet RCX transfer cannot honestly exercise these production bytes.

Before any mainnet value activation, review/soak the two generations, decide and publish their upgrade-authority/freeze policy, then demonstrate the full opt-in mainnet sequence with a bounded sponsor amount:

```text
fund -> canonical permissionless work -> durable receipt
     -> permissionless claim/refund -> vault close -> voucher close
```

No website, Bankr or canonical game integration should advertise live RCX work rewards before that public value proof exists. The 70/30/0 reload economy remains unchanged and separate.
