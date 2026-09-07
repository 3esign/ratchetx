# Chain-only client and recovery acceptance

Astra owns this bounded gate C specification, 2026-09-05. Status: **acceptance defined; implementation and runtime proof pending**. This supports `PERMANENCE_EXECUTION_PLAN.md` P5/P6/P9; it is not another release tracker. Current coordination is in `ROOM.md`.

## Ownership and the next executable slice

Sol alone owns native Cargo/SBF, artifact integration and any separately authorized cluster operation. Fable owns the hardest coupled correctness/liveness proof across Timepin, Core and Work Market. Opus independently challenges its economics/security and measures G2 costs. Astra owns chain-only lifecycle/recovery and the acceptance below.

Astra's reserved new implementation paths, after the atomic candidate A and native handover: `onchain/ratchet-core-g2/client/lifecycle-v2.mjs`, `tools/core-g2-recovery.mjs`, `test/test_core_g2_lifecycle_client.mjs`. Existing `client-v2.mjs`, inspector, UI, Rust and vector writers retain their existing owners. Reuse the current client dependencies by injection; no new npm package. Sol resolves the existing admission-owner handover on the laptop before integration.

First implementation: signerless discovery + terminal/recovery builders over the pinned final ABI. Admission remains the existing client. Delivery is executable client code with independent Rust/SBF parity evidence, not a page claiming the old v1 CLI proves G2.

## Source baseline

Read directly from the laptop on 2026-09-04 around 22:49 UTC:

- `onchain/ratchet-core-g2/client/client-v2.mjs`: SHA-256 `991e59c31eb8a0139168c00a05b61dc3c710aed0599441e8bfc85104c596f664`. Current factory is `createCoreG2Client`; the earlier exported surface covers forward admission and decoding, not the complete terminal lifecycle.
- `onchain/ratchet-core-g2/programs/ratchet-core-g2/src/lib.rs`: SHA-256 `369a674bd255de0a8b9649c1eed976d5c9f33d97d370c28d15ec33ba3b3af5e3`. Relevant instructions are `activate_entry` (1532), `void_pending_entry` (1597), `settle_final` (1693), `finalize_resolved_void` (1823), `void_active_shot` (1890), `reveal` (1974), `reveal_delegated` (2119), `forfeit` (2277), and `revoke_delegate` (858). Reload is `reload_rcx` (390); legacy claim is `claim_legacy` (707), a separate migration gate.
- `PERMANENCE_EXECUTION_PLAN.md`: SHA-256 `8da6b5acf5a5a37549798fe3f6972e859c365ca5eaa6ed9f4bd601b7c32a5e75`. P6 requires 72 continuous hours before P7. P9 requires the recoverable release bundle. P7 forbids v2 voucher funding against mutable producers; P10 requires separate approvals.

Refresh source hashes after A; these reads are not evidence that the future ELF contains this source. Timepin is C8ww; historical US517 bytes must fail the release gate. No existing SBF count is promoted to new-candidate evidence.

## Required acceptance cases

| Case | Positive control and required result | Adversarial/failure check |
| --- | --- | --- |
| C1 Canonical identity | Pin genesis, exact Core/Timepin IDs, canonical Economy/Ruleset, release ABI and ELF hashes; authenticate owners, PDAs and linked state before constructing an action. | Mutate one of genesis, producer, Economy, Ruleset, account owner or discriminator in an otherwise valid fixture. Each must fail explicitly before any send. A separately valid foreign Economy must also fail the canonical client pin. |
| C2 ABI parity | Compare instruction bytes, account order and signer/writable flags with a fixture exported by the Rust/SBF owner, independently of the JS implementation. All amounts and counters round-trip without JS number truncation. | Truncation, unexpected enum values, wrong lengths and values above 2^53 must fail or round-trip as exact integers, never silently coerce. A JS encoder tested only against itself is insufficient. |
| C3 Happy lifecycle | Discover an owner's admitted shot from chain state; construct activation, settlement and reveal as allowed by the current state; independent readback verifies credit, stake, XP, counters and emitted/history state against the accepted rules. | Replay each terminal action with the same and a different payer. No duplicate payout, XP, reward or terminal record. A generic transaction error is insufficient without state/balance readback. |
| C4 VOID/timeout | Exercise pending-entry expiry, active-shot expiry and resolved VOID as separate valid paths. Exercise permissionless forfeit after its actual deadline. | Before/at/after boundary cases come from chain Clock and pinned Timepin terminal facts. Missing oracle/RPC is explicit unavailable/pending; never use the latest arbitrary price or a local-clock guess. |
| C5 Owner recovery | A second machine with only release bundle, owner wallet and locally retained reveal material can discover and finish the position without Ratchet API, account database or pre-recorded shot addresses. Delegation revocation and authorized recovery obey on-chain grants. | Missing salt produces an explicit unrecoverable-reveal state and exposes only valid timeout/forfeit choices, including their economic consequence. Never fabricate a salt or promise its recovery from a hash. Never log private keys or reveal material into shared evidence. |
| C6 Independent executor | A separate fee payer can execute every permissionless transition allowed by the program and identify payer/refund/reward recipients from authenticated state. | Removing the founder's runner and leaving bounty escrow empty must not turn permissionless validity into founder authorization. Whether outsiders have sufficient economic incentive is a separate Fable/Opus proof, not assumed from callable instructions. |
| C7 Public RPC failure | Discovery and state reads work through an operator-chosen public endpoint; use returned context and actual genesis. Retain a machine-readable RPC failure and permit a replacement endpoint. | Timeout, rate limit, stale state and disagreement fail closed. Re-read chain state after uncertain submission before retry; do not report success from a signature string alone. No mandatory private RPC token or founder proxy. |
| C8 Cost and account closure | Record actual fee payer deltas, tx fee, newly locked lamports, valid refunds and persistent account balances per tested path. | Every claimed refund needs an observed close/recipient balance delta; durable pages and ledger deposits are not silently counted as refunded. Report CU from actual SBF metadata, separately from network execution. |
| C9 Server-off rehearsal | Independent operator runs the complete supported path with founder API/database/indexer/runner absent, using only the published bundle, wallet and declared public chain/oracle transport. Save exact artifacts, start/end and receipts. | A founder call, undocumented hosted dependency or missing recovery path fails this rehearsal. A short rehearsal is not P6; the 72-hour window starts only after prerequisites are met. Candidate changes require an explicit decision about which evidence remains valid. |

Positive controls must run on the same exact candidate as their mutations. Negative transaction tests must identify the intended failure and verify rollback, not merely observe an arbitrary instruction error. Fable chooses the highest-risk counterexamples; Sol runs the exact binary cases once and shares the output.

## Network and release boundary

Public devnet cannot prove a reload using a production-only RCX mint. Sol must label any no-value fixture/test ledger by its actual network and initialization; it cannot substitute for P7's real RCX Token-2022 proof. C3/C4 local SBF parity can precede a cluster run; the report must keep them distinct.

P6's 72-hour operator-independence window and P7/P8/P9/P10 remain the existing tracker gates. The first mainnet beta is intermediate. Economy's legacy root/snapshot/cutover are immutable registration arguments: a final legacy snapshot implies a named final Economy namespace and a treatment of pilot obligations, not a root-only Core recompile. Fable/Opus establish that accounting boundary before a migration is offered for approval.

Core and Timepin can be exercised without Work Market bounties in the upgradeable pilot. Full permanence still requires the separately authorized producer-immutability stage, real-RCX market proof, then separately authorized Work Market freeze. This document authorizes none of those actions.

## Evidence returned by the native owner

For each case: candidate manifest/source hashes, both ELF hashes, toolchain/test target, exact invocation, stdout/stderr archive and exit code; for a network run add actual genesis/context, signatures and finalized account/balance readback. Report observed executed/pass/fail/skipped counts. No count inferred from function names, no embedded-ID byte scan standing in for runtime proof.

Honest verdict: source identities and instruction inventory above were read; all three proposed implementation paths and this document were absent before Astra's claim. The acceptance criteria are designed, not executed. Astra has performed no Cargo/SBF rebuild, wallet operation, deployment, migration, service shutdown or freeze. Other owners' latest fixes can supersede the source snapshot.
