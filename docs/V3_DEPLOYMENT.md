# Ratchet Seal V3 - Deployment Guide

## Overview
The V3 Anchor program has been fully written and is located in \onchain/ratchet-seal-v3\.
It implements the fully decentralized Pull Oracle + VAA Archiver architecture.

## Compilation (Solana Playground)
Since local Rust/Anchor toolchains are not available in this sandbox, please compile the program using Solana Playground (https://beta.solpg.io):
1. Create a new Anchor project in Solana Playground.
2. Copy the contents of \onchain/ratchet-seal-v3/programs/ratchet_seal_v3/src/lib.rs\ into the Playground \lib.rs\.
3. Build the project.
4. Deploy to Devnet.

## Next Steps for the Backend
Once the V3 program is deployed, the backend (\pi/game.js\) must be updated to use the new instructions:
- The \create_checkpoint\ call must be removed.
- The \settle\ call must pass the VAA to the Pyth Receiver program first to create the \PriceUpdateV2\ account, and then pass that account to the Ratchet \settle\ instruction.
- A background worker (or Vercel cron job) should be set up to periodically call \oid_shot\ on any shots that missed their crossing, and \close_abandoned_shot\ to reclaim rent from forgotten shots.

## Security — signing material (added 2026-08-25)
The keypairs this branch once carried (`program-keypair.json` → `CqVGgsJpkWm4KtSzQkLk4LaRikgxnRrhbYGietTtu7AB`, `deployer.json` → `HcyV2C2QgXSWtAFn7e7p4sh5Zdw6XjTb2WMiYkwSf1eQ`) were committed to a public branch and are BURNED. Verified 2026-08-25: neither account exists on mainnet (never funded, never deployed), so nothing was lost — but neither ID may ever be used. Before any v3 deploy: generate fresh keypairs locally (`solana-keygen new`), update `declare_id!` in `lib.rs` and `[programs.*]` in `Anchor.toml`, keep keys under `onchain/ratchet-seal-v3/.keys/` (gitignored). Signing material never enters this repository, from any path — CI uses ephemeral keys (see `.github/workflows/deploy-v3.yml`).
