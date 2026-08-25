# RELEASE MANIFEST — RATCHET h67 (Internally Honest)

This manifest registers the exact properties, coordinates, and limitations of the RATCHET release built for the Phase A honesty audit.

## Build & Commit Coordinates
- **Release Version:** \h67-2026-08-23\
- **Git Commit (inspected baseline):** \c321798c36258ace77c0963067f5ae8c22b75799\
- **Frontend / API Target:** Vercel serverless deployment

## On-Chain Program Coordinates
- **Mainnet Seal Program ID:** \23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX\
- **SOL FeedClock ID:** \CE5m9Xag3wwgcfVkbSBnv5WFKPrY1ZhLwSSru9wu9gN\
- **Upgrade Authority:** \AAaU3oyrcmy6GDGxcSUEgg4uUag4pF9jwL2rThB49gks\ (active upgrade authority during soak period)
- **Deployed Binary ELF SHA-256:** \4947daeba64711b3e21b681870c3e6c61db510ee19922e925221fc28f9b486a8\ (verified byte-identical to \onchain/ratchet-seal-v2/mainnet-c37fa32.so\)

## Truth Plane Alignment
- **Game Settlement:** Server-canonical (\atchet-server\), driven by Pyth price update account transitions read directly off Solana.
- **On-Chain Sealing:** Optional beta path; does not represent the canonical game referee during soak.
- **Credits & Leaderboard:** Durable database projections, not held or computed on-chain.

## Current Known Limitations & Disclosures
1. **Historical Event Gap:** The append-only event log contains a single missing entry at index \#345\. The log is sequential and tamper-evident between anchors, but is not complete.
2. **Graduation/Launchpad Burn:** The front-page burned counters separate player-driven reload burns from the initial 59.7M RCX burned at graduation by pump.fun's bonding curve remainder.
3. **Ref Clock Liveness:** The on-chain FeedClock updates on local checkpoints. Missed transitions due to RPC delays can result in synthetic intervals.
4. **Staking/Podium:** Credits are internal play-rights only. Staking yields are computed off-chain on verified wallet balances.
