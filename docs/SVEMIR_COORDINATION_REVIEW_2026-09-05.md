# RatchetX — Svemir coordination review, 2026-09-05

This is an independent review handoff, not a second status tracker. Canonical status remains docs/PERMANENCE_EXECUTION_PLAN.md. Requested by Semir in PC/Svemir task 01a06e6d-7f58-7d32-8a4b-a07e366e1003.

## Ownership and scope
- Sol/native integration owner keeps the integrated branch, all Cargo/SBF targets, C8ww identity migration, vectors, hash locks and final merges. Native laptop task identified: Complete C8ww rebuild handoff (01a06e6c-e844-75f1-ba4b-ee0f7c556d97), observed inProgress. PC reviewers have started no Cargo or build.
- Antigravity's existing lifecycle/inspector lane should address the client findings below; no second writer should edit those files until the existing owner hands them over.
- PC/Svemir reviewers own only this review and evidence files. JS green totals from Cowork were not re-run unnecessarily. Source/client/release fixes remain with the native integration owner.
- Ownership acknowledgement is PENDING. Cross-host Codex message routing returned no matching task. This file and the appended BRIDGE_LOG/COWORK_HANDOFF entries are the delivered mailbox, not a claim that Fable has read them.

## Findings that block a meaningful green build
1. Encoding repair is real but malformed_state.rs still contains five duplicated function names. First block around lines 575–657 references undefined Fixture/SpecArgs::new helpers; later duplicates around lines 659–739 use World. Three fragment .rs files are Cargo integration targets and lack standalone imports/helpers. Build owner should preserve drafts outside tests/ and consolidate the five intended independent cases using the actual harness before counting the suite.
2. Timepin host test in programs/rcx-timepin-v2/src/lib.rs around lines 1049–1050 still asserts ID bytes [7;32]. Migrate the identity-specific assertion to C8ww; US517 is closed and its historical ELF cannot prove C8ww.
3. Core lifecycle harness loads its Core ELF without the adjacent Timepin-style length/hash guard. Record and check BOTH artifacts for exact-generation evidence, along with source snapshot, toolchain and enumerated targets. Root JS runner does not execute Cargo tests.
4. Devnet lifecycle script is currently a scaffold. receiverPd/wormholePd are scoped inside try but referenced outside; register spec meta is readonly; feed ID is synthetic; target derives from wall clock and is unaligned; failures can exit 0; capture/finalize/expire/receipts are absent. It cannot certify devnet lifecycle in this state.
5. Signerless inspector prints metadata and infers cluster from URL; it does not yet reconstruct canonical state. Current compact Timepin ABI is EvidenceSpec 262 / Need 132 / Candidate 119; Need is terminal and optional WorkPage has capacity 2. Old PERMANENCE plan table still describes 182/315/229 and separate terminal/receipt objects. Update that table from current source/client before using it as inspector spec.

## Minimal sequence within the existing P0–P10 plan
1. Native owner completes the single C8ww generation: consolidate invalid tests, source/Core pins, one SBF build per changed program, regenerate ID-dependent vectors/clients, hash both binaries, then run the complete relevant host + exact-SBF targets. Keep JS/model evidence distinct from actual SBF execution.
2. In parallel, the existing client owner completes a genuine no-value lifecycle runner and signerless state decoder against that same ABI. Failures must exit nonzero and receipts must name cluster genesis, program IDs, ELF hashes, slots and transaction signatures.
3. On the approved network, prove current Pyth-owned accounts and lifecycle terminal branches with independent submitters. A captured success plus timeout/refund paths must have positive and adversarial controls; do not substitute synthetic fixtures for public-chain evidence.
4. Build the minimum chain-only player/runner and perform P6/P9 server-off acceptance: no founder API/database/keeper, third-party read/play/settle/refund/recover and same canonical outcome. Existing legacy users require a verified P8 snapshot/claim gate before canonical cutover.
5. Only the reviewed release tuple reaches the mainnet decision. Do not silently waive Work Market's immutable-producer constraint, fund unsupported pre-freeze bounties, migrate balances, or freeze under this coordination note. Preserve explicit deploy/migration/freeze approvals.

Defer cosmetic redesign, new markets/xStocks without cadence proof, optional integrations, another off-chain canonical database, and further packing/fee micro-optimization unless measurements show a release-blocking cost. Start from a small proven keyless crypto feed set; measure actual fees/rent/CU on the candidate.

## Keyless availability boundary
No mandatory paid API is consistent with the product goal. An individual public RPC or sponsored feed is not a perpetual availability guarantee. Use replaceable transports, bounded polling/backoff, shared reads and fail-closed oracle/deadline behavior; do not introduce a privileged fallback writer. Official references checked 2026-09-05: [Solana public RPC](https://solana.com/docs/references/clusters), [Pyth sponsored Solana push feeds](https://docs.pyth.network/price-feeds/core/push-feeds/solana).

## Honest verdict
Checked: live laptop access via Svemir; handoffs, active native task, dirty branch/worktrees, read-only source/client/target review. Inferred: the source defects above block compilation or useful lifecycle acceptance until consolidated. Not executed by PC/Svemir: Cargo, SBF build, JS re-run, live devnet lifecycle, mainnet deployment, migration or freeze. No secrets were opened or transferred. Detailed reports follow as separate review evidence; line numbers are snapshot references and may shift under native edits.

## Consultation amendment
Current ownership: Sol/native Windows is sole Cargo owner, Fable explicitly yielded it. Core production ID is an immutable Economy parameter; identity-only migration needs a new Economy/Ruleset/PDA generation and exact Core reproof, not an automatic Core rebuild. See COWORK_HANDOFF consultation and docs/reviews/svemir-2026-09-05/ for full answers and source receipts. Public getGenesisHash read access from laptop was confirmed on devnet/mainnet at 22:16:28–29Z. No lifecycle or transaction was executed. P6 requires the existing 72-hour window before P7.

2026-09-04T22:23:18.866Z Astra/PC-Svemir ACK receipt: native Sol task Complete C8ww rebuild handoff explicitly confirmed receipt of our shared review and sole Cargo/SBF ownership (agentMessage msg_0e01348d4e8a55c4016a9b441de86887d2974df984decb6464). Sol reports malformed target consolidated and is reviewing checklist before first build. Readback: 5 test functions, 0 duplicate names, 0 NUL bytes. This is source readback only, not compiled/PASS SBF evidence. Opus individual acknowledgement is still unobserved.
