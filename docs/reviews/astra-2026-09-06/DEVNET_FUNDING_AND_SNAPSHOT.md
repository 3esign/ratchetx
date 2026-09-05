# Devnet first-deployment funding and legacy snapshot handoff

Owner direction, 2026-09-06 local: complete the whole game on devnet, including the website and real transaction evidence; revisit mainnet funding later. No paid deploy, account reset, freeze, token distribution or key movement was performed in this review.

## First deployment funding

The earlier buffer peak was counted twice. Agave 4.2.1 funds a new buffer with the selected ProgramData rent; its loader drains that buffer to the payer before creating/funding ProgramData. For this fresh-deploy path, maximum allocated rent equals final Program + ProgramData rent. Order does not create the previously claimed saving. Transaction fees, retries, game-state accounts, upgrades and existing buffers are outside this calculation. Sources: [CLI funding](https://github.com/anza-xyz/agave/blob/v4.2.1/cli/src/program.rs#L2535-L2569), [loader transfer order](https://github.com/anza-xyz/agave/blob/v4.2.1/programs/bpf_loader/src/lib.rs#L287-L300).

Exact capacity and upgrade authority are independent. Installed solana-cli 4.2.1 defaults capacity to the original ELF length and supports later extension. Removing authority makes a program permanently immutable and unclosable; it is not necessary to obtain exact-capacity pricing. Sources: [CLI capacity](https://github.com/anza-xyz/agave/blob/v4.2.1/cli/src/program.rs#L1414-L1429), [deployment and immutability](https://solana.com/docs/programs/deploying).

Public RPC quotes use actual account data lengths: Program 36 bytes, ProgramData ELF + 45. The 128-byte rent overhead is handled by RPC and must not be added again. [RPC method](https://solana.com/docs/rpc/http/getminimumbalanceforrentexemption).

| Exact artifact | Bytes | SHA-256 | Devnet ProgramData lamports |
|---|---:|---|---:|
| Timepin | 375944 | 534e3fd33c3350a2ce086f0f2d46dfb85db07813f76c6da569e750f624a1f3c1 | 1910674360 |
| Core | 1014408 | a8f3fb4daefaeea13c951c967e23b92ed14d8cc904402aad7d38e5b8c446094d | 5154071480 |

Devnet observation 2026-09-05T22:54:56.671Z: each 36-byte Program account requires 833120 lamports. Total exact rent: **7066412080 lamports = 7.066412080 devnet SOL**, plus fees and game-state accounts. Genesis is EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG. Both canonical program addresses returned null at finalized slot 493767584. This single-RPC observation is not deployment proof.

Mainnet observation 2026-09-05T22:46:54.088Z, saved for later: exact rent was **8.809367658 SOL**, not the static 9.681540960 estimate. The old 6960 lamports/byte calculation is retained only as a labelled offline estimate. Different observed cluster schedules demonstrate why real funding must query the selected RPC; no SOL price/conversion was requested.

The corrected preflight defaults to exact capacity, displays and checks the same selected plan, reads rent after its devnet genesis guard, awaits async connection creation, and cannot report a funding verdict for partial artifacts or an offline estimate. Covering rent is explicitly not a transaction-fee or deployment-acceptance verdict.

## Storage and snapshot handoff to Lead

Current legacy storage is Upstash Redis. lib/kv.js uses KV_REST_API_* or UPSTASH_REDIS_REST_*; configured SUPABASE_URL plus a service key overrides that selection. Current storage-truth tests document Upstash; older Supabase authority prose is historical. No credentials or raw player snapshots were read for this review.

Existing tools/live_snapshot.mjs privately exports u:* player blobs with hashes, timestamps and an open-stake census. It excludes pend:* rewards, c7/cs7 receipts, rankings and separate history/log namespaces. api/game.js materializes queued credits only on guarded player reads/saves; a u:* export alone can omit earned queued value. Private open side/salt values are present in raw player blobs, so these exports must not be published.

RX_MIGRATION_FREEZE stops new stakes while settlement/claims/payouts remain possible. It is a drain phase, not a complete final writer barrier. Before a final migration root, reconcile queued value, preserve existing outcomes and establish a stable cutoff. Existing snapshots and Merkle metadata found by the read-only review date from September 3, not this review.

The public /api/snapshot preserves more namespaces but redacts open secrets and reads sequentially. Its restoration path intentionally void-refunds open games; it is not transparent migration. onchain/ratchet-core-g2/legacy-snapshot.mjs already builds G2 credits+XP claim data from reconciled rows plus cutover_slot, cluster_genesis_hash and migration_id. That does not define RCX token entitlements. scripts/airdrop_v2.mjs has a syntax error and is not a ready distribution script. Lead retained snapshot/export ownership; no duplicate export occurred.

## Validation and build result

The corrected funding helper and preflight passed 13 rent tests plus 45 preflight checks (14 Node test entries total), zero skips; independent review reran them. Controls include a payer between exact and double-capacity thresholds, RPC failure, wrong cluster, missing artifacts and offline estimates.

A fresh canonical Windows --ci build produced both unchanged artifact hashes above, passed strict verifiers and Timepin vector --check, then stopped on Timepin conflict_finalize_expire (3 passed, 1 failed). The failing test expects obsolete AMBIGUOUS behavior after the accepted S1 total-order rule. The current receipt remains FAIL. Previously delivered fixture proposal 4c6ca11 covers the policy alignment; Lead was notified. This review does not certify devnet readiness.

Follow-up: actual corrected preflight CLI on devnet passed with current quotes. The verified existing local fee-payer public key is 9R17sG7w5b4w4DYkXAGAxDGKM4ktAToum3L31VJgkJUy, independently derived with solana address and solana-keygen pubkey against the configured signer; no key was copied or generated. Its observed balance was 1.407959487 devnet SOL. Team and owner received this same address for faucet funding.

A separate current-source Core exact-SBF run passed all16 tests,0ignored/filtered; source and artifact hashes were checked before/after. Its evidence is core-current-source.json. It does not replace the canonical failed Timepin run or make B1 pass.
