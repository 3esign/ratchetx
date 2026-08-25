# RATCHET next-operator handoff — Core passport experiment

Date: 2026-08-23  
Production release at handoff: `h68-2026-08-23` / Git commit `d12a708`  
Canonical working tree: `D:\Work\Software_Projects\pumpmind\ratchetx\ratchet_phase_a_clean` (path corrected 2026-08-25 — the folder moved under `ratchetx\` in the workspace reorganisation)

## Mission

Keep RATCHET a game first while using it as a rigorous Solana systems laboratory. The immediate promise to the Metaplex developer community is narrow: reproduce the already-completed Token-2022 player-passport baseline with MPL Core + AppData on Devnet, measure both approaches, publish raw evidence, and ask Metaplex maintainers to sanity-check the authority design.

Do not mix this experiment into the live game, RCX, production rewards or mainnet authorities.

## What is already complete

### Production h68

- GitHub `main` contains commit `d12a708`.
- Vercel production deployment is live on `ratchetx.xyz` and `www.ratchetx.xyz`.
- Build marker is `h68-2026-08-23`.
- Real commitment-v2 shot proof passed in production.
- Settlement is explicitly labelled `ratchet-server`.
- Oracle input is explicitly labelled `pyth-price-update-v2-accounts-read-from-solana`.
- On-chain shot seal is explicitly labelled `optional-mainnet-beta`.
- Solana log-head anchor entry `#1096` was verified and Proof anchor freshness became green.
- Two red Proof checks are the same disclosed historical missing event at index `345`; do not describe the pre-gap log as completely restorable.

### Token-2022 baseline

Location: `onchain/player-passport`

- Devnet mint: `4J9Tqmiq4FhNVRpwqcw4xizkWtXT3HYRkugGQr4o2SpY`
- Player: `8MmiTs9CoMT55gdFyCjM9issn9tsG1qVJCfgukYmeeVH`
- Supply one, decimals zero, mint/freeze authorities revoked.
- Extensions: MetadataPointer, NonTransferable, TokenMetadata.
- Program-enforced transfer rejection passed (`0x25`).
- Total measured wallet delta: `0.01098416` Devnet SOL.
- Total successful compute: `134,625 CU` over nine transactions.
- Evidence: `onchain/player-passport/DEVNET_RESULT_2026-08-22.md`.
- v2 checkpoint model and negative tests exist but are not deployed: `ARCHITECTURE_V2.md`, `src/checkpoint-v2.mjs`, `src/merkle.mjs`.

### Core comparison started

Location: `onchain/core-passport-benchmark`

- `AUTHORITY_SCHEMA.md` contains the proposed minimal authority layout.
- `src/schema.mjs` contains deterministic JSON AppData encoding and transition validation.
- `test/schema.test.mjs` covers determinism, authority separation and rejected regressions.
- `package.json` pins current official packages: MPL Core `1.10.0`, Umi `1.5.1`.

## Immediate execution order

### P0 — finish the reproducible Core harness

1. Install the pinned dependencies inside `onchain/core-passport-benchmark`.
2. Add `src/cli.mjs` with two modes:
   - `plan`: offline schema/authority/transaction plan, no RPC writes.
   - `devnet`: explicit Devnet genesis guard, funded signer guard, Core Asset creation, AppData write, fetch verification, negative authority write, freeze/transfer experiment and JSON report.
3. Add a Solana Playground client variant using `pg.wallet` so the already-funded Devnet wallet can sign without exporting its secret key.
4. Never print or persist a secret key. Persist only public addresses, signatures, block times, balances, account sizes, CU and latency.
5. Run local unit tests before any wallet transaction.

### P0 — funded Devnet run

The user has a funded Solana Playground Devnet wallet. The user must approve wallet transactions; an agent must never sign on their behalf. Before running:

- confirm Devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`;
- confirm no RCX mint/program address appears in the transaction plan;
- display the expected number of transactions and upper-bound Devnet SOL delta;
- stop if the cluster is not Devnet.

Required measurements:

- create transaction signature, fee, CU, confirmation latency and resulting Asset account bytes;
- AppData initial-write and at least five fixed-size update measurements;
- direct RPC fetch visibility latency;
- DAS visibility and per-update indexing latency if a Devnet DAS endpoint is available;
- unauthorized AppData write rejection;
- transfer/freeze behavior and exact trust difference from Token-2022 NonTransferable;
- final balance delta and rent allocation.

Write the result to `onchain/core-passport-benchmark/results/DEVNET_RESULT_<date>.json` and a readable Markdown summary next to it.

### P1 — maintainer review package

Send Blockiosaurus:

- proposed authority diagram;
- repository/file link;
- Core Asset and transaction explorer links;
- raw benchmark JSON;
- four focused questions: AppData vs LinkedAppData, correct plugin authority, correct dataAuthority rotation/recovery, and best Core-native soulbound pattern.

Do not say that Core is cheaper, faster or safer until measurements exist.

### P1 — benchmark fairness

Normalize the comparison:

- separate rent from transaction fees;
- compare creation with creation and fixed-size checkpoint update with fixed-size checkpoint update;
- report account bytes and CU, not only SOL;
- report median and p95 from repeated updates, not a single successful transaction;
- record RPC provider and commitment level;
- state that DAS indexing latency is infrastructure-dependent;
- distinguish protocol enforcement from authority convention.

### P2 — game integration only after review

If Core wins the experiment, integrate only durable milestones: daily checkpoint, podium win, best-streak milestone or max-age checkpoint. Do not write every shot/price tick/XP increment to a passport. The live event log remains the high-frequency plane; the passport is a sparse, durable identity/checkpoint plane.

## High-value follow-up experiments

1. **AppData vs LinkedAppData:** per-player isolation versus collection-level write efficiency and blast radius.
2. **JSON vs MsgPack:** DAS readability, bytes, CU and update latency.
3. **Wallet vs program-PDA data authority:** operational recovery, replay protection and compromised-key blast radius.
4. **Core freeze vs Token-2022 NonTransferable:** exact lifecycle guarantees and wallet/indexer presentation.
5. **DAS consistency:** direct RPC truth versus indexed UI truth under rapid updates.
6. **Checkpoint batching:** one root per epoch plus player proofs versus per-player writes.
7. **Authority rotation drill:** rotate, revoke and recover without changing player ownership.
8. **Failure injection:** stale RPC, delayed DAS, duplicate sequence, regressing XP, wrong player, wrong prior hash and forked log head.

## Product priorities after the experiment

1. Settlement correctness and live UI convergence remain above cosmetic work.
2. Reduce void rate through better question eligibility and Pyth crossing-sample capture without inventing prices.
3. Make all player-facing numbers traceable from raw oracle/account data through canonical state to rendered UI.
4. Keep the elegant-casino visual redesign separate from settlement/economic changes.
5. Mainnet program work requires an explicit authority map, reproducible tests, cost estimate and rollback/upgrade decision before deployment.

## Non-negotiable truth language

- Current scoring and settlement are server-canonical, not trustless.
- Pyth provides oracle observations; RATCHET defines question semantics and settlement selection.
- Solana memo anchors timestamp log heads but cannot repair historical gap `#345` or prove off-chain scoring correctness.
- Optional shot seals commit data on-chain; they do not make the entire game on-chain.
- The Core passport experiment is Devnet-only until reviewed.

## Safe takeover checklist

1. Read this file.
2. Read `onchain/player-passport/DEVNET_RESULT_2026-08-22.md` and `ARCHITECTURE_V2.md`.
3. Read `onchain/core-passport-benchmark/AUTHORITY_SCHEMA.md`.
4. Run `npm test` in both passport experiment directories.
5. Run the Core `plan` mode and inspect every program/account before requesting a wallet signature.
6. Keep production files untouched until the experiment and maintainer review are complete.
7. Commit experiment files separately from production releases.

## Definition of done

The immediate promise is complete only when a public Devnet Core Asset exists, AppData updates are independently readable, unauthorized writes and transfer behavior are tested, raw cost/CU/latency evidence is saved, the authority layout is reviewed by a Metaplex maintainer, and every conclusion distinguishes measured fact from design hypothesis.
