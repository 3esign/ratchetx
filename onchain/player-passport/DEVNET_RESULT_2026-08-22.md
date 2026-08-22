# RATCHET Player Passport — Devnet result (2026-08-22)

Status: **successful isolated experiment**. RCX and the production RATCHET game were not touched.

## Result

- Network: Solana Devnet
- Player: `8MmiTs9CoMT55gdFyCjM9issn9tsG1qVJCfgukYmeeVH`
- Passport mint: `4J9Tqmiq4FhNVRpwqcw4xizkWtXT3HYRkugGQr4o2SpY`
- Player token account: `2YhG2ZR5LqDGgr3yeiVQcSCwKTs9tNthQSNPGd8P3TnC`
- Mint owner: Token-2022 program (`TokenzQd...PxuEb`)
- Mint account: 839 bytes
- Supply: 1
- Decimals: 0
- Mint authority: none (revoked after issuing one)
- Freeze authority: none
- Extensions: `MetadataPointer`, `NonTransferable`, `TokenMetadata`
- Standard metadata: `RATCHET Player Passport` / `RPX` / empty URI
- Metadata update authority: the experiment's Devnet player wallet
- Negative transfer test: passed; `TransferChecked` was rejected with Token-2022 error `0x25` (`Transfer is disabled for this mint`)

[Inspect the passport mint on Solana Explorer](https://explorer.solana.com/address/4J9Tqmiq4FhNVRpwqcw4xizkWtXT3HYRkugGQr4o2SpY?cluster=devnet).

The account was independently fetched and decoded from Devnet after the Playground run. The decoded owner token account holds exactly one unit for the expected player.

## On-mint fields

```text
ratchet.schema          ratchet-passport-v1
ratchet.player          8MmiTs9CoMT55gdFyCjM9issn9tsG1qVJCfgukYmeeVH
ratchet.lifetime_xp     00000000000000000000
ratchet.best_streak     0000000000
ratchet.shots           00000000000000000000
ratchet.podium_wins     0000000000
ratchet.epoch_day       0000020687
ratchet.checkpoint_unix 1787424300
ratchet.checkpoint_hash bd5e1237b8e2ed3b40678af288b5e78a66a03c57507cd8421406bb64cf3babb5
ratchet.proof           https://ratchetx.xyz/api/proof
```

The hash is SHA-256 over the canonical fixed-width snapshot and player address. Fixed-width values let ordinary updates remain within the original account allocation.

## Measured cost and compute

- Total wallet delta: 10,984,160 lamports (0.01098416 Devnet SOL)
- Total transaction fees: 50,000 lamports across 9 successful transactions
- Account rent funded: 10,934,160 lamports
  - passport mint: 6,730,320 lamports
  - player token account: 2,101,920 lamports
  - negative-test destination token account: 2,101,920 lamports
- Total compute consumed by the 9 successful transactions: 134,625 compute units
- Negative transfer simulation: 1,570 compute units before expected rejection

The negative transfer was rejected during preflight simulation, so it has logs but no failed on-chain signature or fee.

## Successful transactions

| Stage | CU | Signature |
|---|---:|---|
| Create mint and base extensions | 3,992 | [2mQbzY…grHV](https://explorer.solana.com/tx/2mQbzY5p4QWTSTUmtVLMG3SgxDDc9aHyFLq75o8kF6YBXnDe7CyBgkcGtiUCw7qEV3jRmTzLfXgS3juot8H2grHV?cluster=devnet) |
| Initialize on-mint metadata | 3,426 | [2Ba6nC…kNwo](https://explorer.solana.com/tx/2Ba6nCDZ3DvaqZoeBAi4C9CQ8s6VCVyEjyzXif3n4yu5iMz5YVF4qRyUNM6JVZmPmxrL5H6EPNA5xPWGNuWvkNwo?cluster=devnet) |
| Metadata fields 1–2 | 10,855 | [5ar4py…4FGp](https://explorer.solana.com/tx/5ar4py3ZV6qWN9We4c1eskMYbva1VFSibBn3Egtz57ggk3ieLnzWCZmJMv2NVnEi8Qd3mKwutXERVWYZCGV54FGp?cluster=devnet) |
| Metadata fields 3–4 | 14,176 | [2LRXfz…6LmZp](https://explorer.solana.com/tx/2LRXfzkP7HtTmXTVvtiqKHRsr1aEhRTfXBwFQa5PRLpgVxarzSHfEEfYX7baFEjFngVZ4fQv1hSbm8WtjSL6LmZp?cluster=devnet) |
| Metadata fields 5–6 | 17,425 | [3kN5qa…eF5B](https://explorer.solana.com/tx/3kN5qaK92czcCMu73TFth35udFZNdR4tsySRaus82PhhuQWAirhR972U2QqrFecWHEV8zkqZico3szNk3qeLeF5B?cluster=devnet) |
| Metadata fields 7–8 | 20,336 | [mfFnFt…kQH7](https://explorer.solana.com/tx/mfFnFtbNTiLdrNhj9sJN1uuZUF3ouNCBeLWQBCe2nhkjYp4SLsSuX3BAUBpkeLKqv1Se18Yi4EnySfPmu8rkQH7?cluster=devnet) |
| Metadata fields 9–10 | 23,650 | [3a7ead…Tikz](https://explorer.solana.com/tx/3a7ead1LSWmyHqPP5B9DXytcEvH4fKcKyYt7mMniZPiz3sppzyFLRFQSxAaJAJhGNdLSbfGYvs7PPvSuFSwdTikz?cluster=devnet) |
| Create player ATA, mint one, revoke mint authority | 22,644 | [fe1QG1…oWz1](https://explorer.solana.com/tx/fe1QG14z92vtUATkVhiFp43UAvbBwcNMhBt3fUQttSmV8DrZpbyCaXf4pP4xqHD75W5ovEuEoWsW8P3eFbjoWz1?cluster=devnet) |
| Create transfer-test destination ATA | 18,121 | [4aFa3R…KGeK](https://explorer.solana.com/tx/4aFa3RHkyWtpEbPqMxLFXH7Zzu865PSv32Ufx3UDTRR7WJs8rNDWomuW5iUrr6sMX1kiW9QGJSH2Ec8DrwsPKGeK?cluster=devnet) |

## Findings from the experiment

1. Solana Playground's bundled `spl-token-cli-wasm 2.0.15` does not expose the NonTransferable flag. The wallet-signed TypeScript client was required.
2. The public Devnet faucet was rate-limited, but an already-funded Playground Devnet wallet worked.
3. The mint must initially use the exact base-extension allocation. It can be funded for the final rent, then TokenMetadata initialization reallocates it. Preallocating the final metadata length before `InitializeMint` is rejected as invalid account data.
4. A compact durable checkpoint fits naturally in Token-2022 metadata. Per-shot or live-rank updates do not: those should remain in RATCHET's event/proof layer.
5. Token-2022 enforced non-transferability at the program level; no freeze-authority workaround was used.

## What this does not prove

This is not production-ready identity infrastructure and it is not a load test. It does not prevent duplicate passports, validate RATCHET state on-chain, rotate/recover update authority, or enforce update rules through a program. The Devnet player wallet remains metadata update authority for this disposable experiment.

Before production, the authority should likely become a reviewed program PDA with replay protection and a registry enforcing one canonical passport per player. Load testing should use a local validator or carefully rate-limited Devnet harness—not spam the public RPC.
