# Devnet first-deployment funding and legacy snapshot handoff

Owner direction, 2026-09-06 local: complete the whole game on devnet, including the website and real transaction evidence; revisit mainnet funding later. Both accepted programs were deployed to devnet using faucet SOL. No mainnet transaction, account reset, freeze, token distribution or key movement was performed.

## Current result: both programs deployed

Owner confirmed two 5-SOL devnet faucet sends to the dedicated payer. The funded dry run passed, then the exact accepted Core and Timepin pair deployed successfully; runner exit 0. Full on-chain ProgramData payloads matched the accepted ELF bytes and SHA-256, with expected loader ownership, exact capacity and designated upgrade authority. Build-source hold was released after both readbacks.

- Core ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL, ProgramData 6h8VdBWK8rjc8ZaPA64VxpVYRHJ91qRQhQEn4LkVbGfg, deployment slot 493790839. [Finalized deployment transaction](https://explorer.solana.com/tx/PTwri4oMaqHU465grPVKqnLdF8chPLByaiCTJRuESRV4K1i7s5R32fkFBCh7tY8kt7f173E8mB2f8zMoAyRHZ2H?cluster=devnet).
- Timepin C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp, ProgramData BdkDZhs4MionjYMkmrRkY43VdKTR9XtVo1jbRc84EXMK, deployment slot 493790908. [Finalized deployment transaction](https://explorer.solana.com/tx/a8rx8Gvi15FcK3x7fdEymBWyRP9m96eeFEBewceD23r5LFeChPGPjXTq7aE9Zf34r261XDJKZ6JVSPXPa3HjPXQ?cluster=devnet).

Finalized balance after deployment: **2.926672920 devnet SOL**. Structured evidence: docs/receipts/g2-devnet-deployment-20260906.json; original sanitized runner log: docs/receipts/devnet-deploy-windows-20260906.log. RPC independently returned successful finalized deployment transactions at the same recorded slots. The final deploy instruction fee shown per transaction is not the total upload cost: uploading includes many preceding transactions.

Independent finalized verification also passed using direct RPC without the deployment runner: full ELF bytes, loader states, authority/capacity and actual DeployWithMaxDataLen instruction fields. Evidence: docs/receipts/g2-devnet-independent-readback-20260906.json. The complete deployment changes and evidence landed in native commit 88344a1, exactly 13 owned paths. Retained public binary copies now also exist outside the site tree at ../g2-release-artifacts/devnet-20260906, with a SHA manifest; previous caches were preserved.

The funding refusal below is historical and resolved. Build, B1, and deployment are complete. Actual bootstrap/claim/observer/game settlement plus website integration remain; the deployment signatures do not prove L1/L2 gameplay. Lead owns the callable bootstrap path and has the exact existing-protocol claim route; Astra 2/Gemini own site integration. Do not rerun the fresh-deployment command against these now-existing programs.

## Confirmed deployment payer

Use **wJYFx75hzP9h2ujQQ6mpJWLeYgPSUdLtuWjrw881rKz** for this G2 devnet release. Lead created the dedicated signer concurrently with the earlier CLI-default check. Its public key was independently derived with solana-keygen; its file is ignored/untracked. This supersedes the earlier 9R17... address. Select the dedicated signer explicitly for deployment; do not rely on CLI defaults. No key content is included here. Team and owner received this correction at 2026-09-05T23:09:31Z.

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

## Validation and current handoff

The corrected funding helper and preflight passed 13 rent tests plus 45 preflight checks (14 Node test entries total), zero skips. The deployment runner and plan passed 33 related tests; the final program-key custody-path correction passed 19 focused tests. Independent reviews found no blocker in these owned changes.

A fresh canonical Windows build with --ci completed successfully on 2026-09-05 at approximately 23:44 UTC: both exact artifacts above were rebuilt, ELF/identity/SHA verifiers passed, Timepin vector --check passed, Timepin ran 14 tests (4 conflict, 6 malformed-state, 4 registration) and Core ran 16 tests, with zero ignored or filtered tests. The three Timepin fixture files now match the accepted S1 total-order rule, valid grid/lag constraints and actual Anchor argument-prefix behavior. No program source or public Pyth fixture bytes changed.

The canonical receipt at docs/receipts/g2-build-artifacts.json is PASS and BUILT, SHA-256 06bdb71f82e53b880a03e3584c7fdc02fd587415ca29c1b3ed11efcec7a1c991. The separate strict checker also returned PASS, receiptStatus PASS and runtimeEvidenceChecked true, saved at docs/receipts/b1-strict-windows-20260906.json. That checker verifies recorded runtime evidence; it does not itself execute the SBF tests. This supersedes the earlier failed Timepin attempt. The separate core-current-source.json remains historical evidence of the earlier Core-only run. CI mode did not run the full JavaScript release gate.

The accepted public artifact copies are under _to_delete/public-build-handoff/<sha256>/<filename>; the canonical build also holds copies in the Windows content-addressed temporary cache recorded by its receipt. Preserve both accepted copies until the deployment handoff is complete. Deployment always rechecks the PASS receipt, current source hashes and exact artifact bytes.

Actual deployment dry run on 2026-09-05 at approximately 23:49 UTC verified devnet genesis through RPC and CLI, the strict PASS receipt, both artifact hashes and the existing program signers. Timepin uses onchain/rcx-timepin-v2/timepin-v2-keypair.json, whose derived public key is C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp. The similarly named target/deploy key derives FNc5ezEgW9Z4vRvgsmgMQV46YQfoMvR8KYuq9A7qU9Ge and is deliberately not used. No signer was generated, copied, moved or published by this work.

The dry run then refused funding: the dedicated wJYFx75hzP9h2ujQQ6mpJWLeYgPSUdLtuWjrw881rKz payer held 0 lamports. Actual RPC rent was 7.06641208 devnet SOL; required total with the runner's 0.05 SOL fee allowance was 7.11641208 SOL. This allowance is a planning reserve, not a measured transaction charge; gameplay account rent is additional. No deployment transaction was sent. One earlier CLI faucet request failed with a possible rate-limit response.

Historical command used for this successful deployment (do not rerun against existing programs):

    node ops/g2-deploy/deploy-devnet.mjs --cache-root _to_delete/public-build-handoff --payer ops/g2-deploy/keys/devnet-payer.json --execute

Use Node 22.20.0 on the Windows build host. Omit --execute for the dry run. The runner refuses an existing program rather than silently upgrading or resuming, and verifies actual Program/ProgramData ownership, authority, exact capacity and complete deployed ELF bytes after each successful send. It does not log potentially sensitive raw CLI failure output or close buffers indiscriminately.

Build/B1 and devnet program deployment are complete. Fresh-ledger credits, live bootstrap/observer/settlement signatures and the website flow remain separate outstanding work. A bootstrap plan alone is not a sent transaction; a fresh ledger starts with zero credits and requires the existing claim_legacy path with a valid devnet-bound nonzero root/proof before a funded seal. Lead owns that bootstrap path; Astra 2 and Gemini own website integration. Mainnet remains deferred.
