# RATCHET Token-2022 Player Passport experiment

This directory is an isolated **devnet-only** prototype. It does not modify the RCX mint, the live game, production authorities, rewards, or production storage.

## Question being tested

Can a RATCHET player carry a compact, non-transferable on-chain record of durable achievements using Token-2022 metadata stored directly in the mint account, without writing every game event on-chain?

The prototype creates one zero-decimal Token-2022 mint per player, mints exactly one token, revokes the mint authority, and combines:

- `NonTransferable` — the passport cannot be moved to another wallet;
- `MetadataPointer` — points to the mint itself;
- `TokenMetadata` — name, symbol, and RATCHET fields live in the mint account; the URI is deliberately empty.

The devnet runner also creates another wallet and attempts a transfer. Success is treated as a security failure; the expected Token-2022 rejection is recorded as a passing negative test.

## What belongs on the passport

Only durable checkpoints:

- lifetime XP;
- best streak;
- shots played;
- podium wins;
- epoch day and checkpoint timestamp;
- SHA-256 checkpoint hash;
- the public RATCHET proof endpoint.

Live rank, current market state, prices, and per-shot results stay off this token. They change too frequently and already belong in RATCHET's event/proof system. A checkpoint is proposed at a daily rollover, podium or streak milestone, or after a maximum age. This boundary is part of the experiment, not a finalized production promise.

Numeric metadata values use fixed-width decimal strings. Updating them within the v1 bounds does not enlarge the mint account, avoiding surprise rent top-ups during ordinary checkpoint writes.

## Run

```bash
npm install
npm test
npm run passport -- plan
npm run passport -- devnet-demo
```

`devnet-demo` uses an ephemeral generated signer and the public devnet RPC by default. No keypair is persisted. Set `RATCHET_DEVNET_RPC` to a devnet HTTP endpoint if the public faucet or RPC is throttled. The last successful report is written to `.devnet/latest.json`, which is gitignored.

## Authority boundary

For the disposable devnet experiment, the ephemeral payer is also metadata update authority. A production design should not use a server hot key as the final trust model. The likely next step is a small program whose PDA can checkpoint only validated RATCHET state, with explicit recovery/governance rules. That program has **not** been built or deployed here.

## Token-2022 versus an attestation service

The Token-2022 passport is the simpler fit when the credential itself is a wallet-bound object with a compact canonical state. An attestation service remains potentially useful for independent issuers, revocable or expiring claims, private/permissioned claims, or claims that should not mutate one canonical passport. They are complementary designs; this prototype intentionally tests the Token-2022-first path suggested by the Solana engineer.

## Experiment gates before any production proposal

1. Verify mint, supply, revoked mint authority, extensions, and metadata directly from devnet RPC.
2. Prove transfer rejection with a second wallet.
3. Measure bytes, rent, transaction fees, and checkpoint transaction size.
4. Load-test checkpoint cadence separately; never benchmark using RCX or mainnet.
5. Review wallet/indexer rendering and Token-2022 compatibility.
6. Threat-model update authority, replay protection, duplicate passports, recovery, and state-hash provenance.
7. Decide whether the feature improves the game enough to justify per-player account rent and operational complexity.

## References

- [Token-2022 overview](https://www.solana-program.com/docs/token-2022)
- [Token-2022 extensions](https://www.solana-program.com/docs/token-2022/extensions)
- [Official Solana program examples](https://github.com/solana-foundation/program-examples)
- [Solana Kit client documentation](https://solana.com/docs/frontend/client)
