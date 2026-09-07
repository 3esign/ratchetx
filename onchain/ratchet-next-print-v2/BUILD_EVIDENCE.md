# Next Print v2 build evidence

Evidence date: 2026-09-04  
Status: byte-verified devnet candidate; not deployed on mainnet.

## Program identity and build

- program ID: `2TV2zagBZaDXXYjduLrRbiDGGsR8jXNqYAuLDE4j4tyR`
- source SHA-256: `511b2a8fc79f37caf9ddb053aebd656da7a902953fd48b39b79fc69825c7f410`
- SBF size: 217,040 bytes
- local SBF SHA-256: `01bab651f511cd72c480c432425c1bb343c91ab17f4df63c5ffdac1a8b0d52cc`
- ruleset SHA-256: `78b15cfe2ac9f4c69f60d42a65b544f143ea9a253efbde2f890a26549a15b3f0`

The deployment keypair is outside the repository at `D:\keys\ratchet-next-print-v2-program.json`. No secret key bytes are committed or reproduced.

`cargo fmt --all -- --check` passed. `cargo test --workspace --quiet` passed 5 tests, 0 failed. `cargo build-sbf -- --locked` completed successfully; only known Anchor macro `unexpected_cfgs` and dual-crate-type/LTO warnings were emitted.

## Devnet deployment identity

- audited upgrade signature: `3D9kBSTu9H6TqjitGhjuNTuY4uy8botnULJ5m1T1cy5qqdcZ2opKRMw5iL9QuM5d6ZpeqU4WkFYPnVrqgHg57M6B`
- deployed slot: `492867556`
- ProgramData: `ELapjd76gKGPyRtYc6cVRaJA1qAcp8ni5NBsiPME2mbd`
- upgrade authority: `9R17sG7w5b4w4DYkXAGAxDGKM4ktAToum3L31VJgkJUy`
- local executable length: 217,040 bytes
- allocated onchain data length: 227,240 bytes
- first 217,040 onchain bytes SHA-256: `01bab651f511cd72c480c432425c1bb343c91ab17f4df63c5ffdac1a8b0d52cc`
- remaining allocation padding: 10,200 bytes, all zero

The executable prefix is byte-identical to the local artifact. The upgradeable
ProgramData account preserves a larger allocation from the original deployment;
its entire suffix is zero padding. Upgrade authority is intentionally retained
during devnet soak; the program is not immutable.

## ABI/client parity

The compiled Rust example generated every instruction byte sequence plus Shot, receipt and Pyth PDA vectors. `node ../../test/test_next_print_v2_client.mjs` independently reconstructed them and cross-checked the receipt PDA against Work Market's client.

Result:

```text
NEXT PRINT v2 client PASS: Rust vectors, Work Market receipt PDA, ABI, layouts and guards
```

- client SHA-256: `1c8e618f0778f3eff8272c8679618494c7c97c1eaa22487f4ec7bd36af61a530`
- Rust vector SHA-256: `8496fe5bf56a094484b6a125d685f85a3214c481f09f6b329aa4afba9e8aeea0`
- machine ABI SHA-256: `a15c726df9355858fc2f4cc89e7670066420fb8f03311a1f7ee0c659c9bf16e3`
- static test SHA-256: `aa0f67e0ccef92b5e876a6a38991b875c5fead1b0a5acb823213666a0e911157`

## Exact-SBF composition suite

The Work Market LiteSVM suite loads the exact Work Market and Next Print v2 deployment SBFs. The final suite passed 8 tests, 0 failed:

1. exact 409-byte production RCX Token-2022 mint drives nonzero fund/claim/cleanup;
2. terminal nonpayable receipt refunds every actual vault unit;
3. wrong mint/program/subject/receipt/worker paths cannot move RCX;
4. multiple sponsors remain isolated and settle once;
5. a direct Pyth successor through real v2 creates a payable receipt and transfers 12 RCX to the actual observer;
6. real v2 timeout creates a nonpayable receipt and refunds all 15 RCX to the sponsor;
7. a deliberately missed direct successor creates a nonpayable receipt and refunds all 9 RCX instead of rewarding failure;
8. the exact captured mainnet TSLAX Receiver account enters the real v2 stock path.

Final suite source SHA-256: `64f3da14dccb7bf44592d1bd20a47847cddcdd5806f049b4d9a9e8e695fc7326`.

The composition cases do not inject receipts. They invoke v2's canonical transition and `write_completion_receipt`, then let Work Market independently validate the durable account and transfer Token-2022 units.

## Real TSLAX fixture

The pinned account was captured from mainnet-beta at context slot `444108800`:

- address: `G8EJV1bqPydBCFZJ2neo1hsrwp2Hwt2ZqJTLG2gotcP2`
- owner: official Pyth Receiver program
- feed: TSLAX (`47a15647...66a362`)
- account size: 134 bytes
- publish time: `1788464846`
- previous publish time: `1788464845`
- fixture-file SHA-256: `c8c8dd0531616446d30b2dfcacf447e299b6b17798567d802dc2d46238ef5aa6`
- raw-account SHA-256: `513fd1afb183de508277551b694131c96cfd075511c5fc041a13bb71a7aeccdc`

This proves byte compatibility with that real tokenized-stock Pyth account, not present-day feed liveness or direct equity ownership.

## Public devnet lifecycle

After the audited payout-policy upgrade, the official sponsored SOL feed was
stale for roughly five minutes and then produced a fresh print. V2 opened
against that print. No direct successor arrived before the onchain five-minute
deadline, so the public path completed as:

```text
OPEN -> VOID_TIMEOUT -> WRITE_COMPLETION_RECEIPT -> CLOSE_SHOT
```

- open: `2fQnwQbysnLnQ5AAtib7sTWEjbeZJANqJSCSFVYDmUn9ekzVtADsNeRJtY2xeocgyWM6iXymuFExWKRDhjL1dinN`
- timeout: `NxLttEZ6ZWMwW3D5fNMRA8RLzH54opbJLd7AqHYDdMPcQQLKAQT7r9wZauPL386PaR5Wx3ukSA9eaR7yMCwRaG5`
- receipt write: `3zgyoJoPMidhb5pAdrjQ834QWv8pGepmXbK56tRJd35YYrpgQ9nb1yWNcY85xuxvgDqDdK5DYJaCxaLXTiVcs6W8`
- Shot close: `3GJsv1btnr2NFh8q9anvE7EBgANFP53m97bevhQfarYJeKYRBUkSuiRGzjw6WkKwB5ePoMvF5KwE3jNwKivqzAeN`
- entry Pyth publish time: `1788500122`
- timeout slot: `492871770`
- Shot: `32zN6d1vjN47aisNa7Du7GfrH5r6y3w8VZHK78KFNhcY` (closed)
- durable receipt: `Gd1GdHsAmnvacsfHTupLZVK1m5mgL4RUqRHSEF1MbMsq`
- terminal result: `VOID_TIMEOUT`, disposition `Nonpayable`, default worker
- result hash: `536c9b268841ddee192cecbdcbc61615c8c00dfdf4908348d2e9deb9e2fa18fc`
- receipt account: 125 bytes, owner v2, 1,602,249 lamports, rent-exempt

The first dependent receipt simulation used a `confirmed` preflight immediately
after a timeout awaited only at `processed`; the older confirmed bank still saw
the Shot as OPEN and correctly rejected receipt creation. After the timeout
reached confirmation, permissionless recovery wrote the receipt and closed the
Shot with no program change. Checked-in lifecycle sends now use coherent
`confirmed` commitment. This is a public post-upgrade terminalization,
durable-receipt and cleanup proof, not a public CAPTURED-successor proof.

## Remaining value boundary

The exact RCX mint `FQb2...pump` does not exist on devnet. Work Market correctly has no devnet substitute escape hatch, so its production-pinned bytes cannot perform a public devnet RCX transfer. The nonzero value composition is therefore exact-SBF LiteSVM evidence until an explicitly bounded mainnet beta is reviewed and authorized.

Neither v2 nor Work Market is connected to the production UI, Bankr play, credits, reloads or the canonical 70/30/0 economy.
