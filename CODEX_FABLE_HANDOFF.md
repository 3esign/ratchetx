# Codex -> Fable handoff

Date: 2026-09-04

Semir assigned Fable as integration lead. Codex is the independent parallel reviewer.

Division of work:
- Fable owns the integrated branch, Cargo/SBF target lock, build order, devnet/deploy decisions, and final merges.
- Codex owns identity/source-artifact-client parity review, browser/client static review, test-matrix pruning, and adversarial result review.
- Codex will not launch Cargo while Fable owns an active Cargo target.

P0 identity finding:
- Last proven Timepin ELF: 414264 bytes, SHA-256 `8D913A5D65B187D665D35088E577EE231B3F2BDB2954377AD4B986FAC343AB7F`, tested under public-only ID `US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx`.
- Current `declare_id!`, `Anchor.toml`, `registration_open.rs`, and root deploy keypair use `C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp`.
- README and both golden-vector JSON files still use `US517...`; no current Timepin `.so` exists in this clean tree.
- Therefore C8 is a new unproven generation. Regenerate every ID-dependent PDA/vector/client constant, build once, pin/hash once, and never cite the old US517 artifact hash as C8 evidence.

Release hygiene:
- The whole Timepin-v2 tree is currently untracked. The matching keypair is ignored but sits inside the Vercel-bound deployable folder. Keep it outside Git and every upload/release artifact.
- `malformed_state.rs`, `malformed_state_append.rs`, `malformed_state_append2.rs`, and `malformed_state_new.rs` are four Cargo integration targets. Consolidate or relocate the fragments before the full suite.

Please record active Cargo target plus PASS/FAIL/ELF hash at boundaries in `BRIDGE_LOG.md` or this file. Codex will review the result without duplicating the build.

## Codex verified delta - 2026-09-05

Browser-native forward admission is now implemented in
`onchain/ratchet-core-g2/client/client-v2.mjs`, with a direct parity gate in
`test/test_core_g2_client_v2.mjs`.

Fixed before handoff:
- `EvidenceSpecV2` has no stored bump; the first draft was one byte shifted.
- `EvidenceSpecArgs` now includes adapter byte 2, restoring exact 214-byte canonical parity.
- EvidenceSpec owner/discriminator/exact-size/PDA/policy hash/generation hash/registered-slot checks fail closed.
- Core/Timepin target-ahead, exponent, Full-verification and horizon coupling mirror the Rust admission guard.
- empty commitments, integer bounds and Ledger conservation/nonce-capacity invariants fail before signing.

Verified locally without Cargo, SBF, RPC or deploy:
- `node test/test_core_g2_client_v2.mjs` -> PASS.
- `node test/test_core_g2_model.mjs` -> PASS (1,825 checks; 1,000 shared-Need seals).
- `node test/test_core_g2_snapshot.mjs` -> PASS (76 checks).
- `node test/test_core_g2_cost.mjs` -> PASS (53 checks after dated Core G2 rent correction).
- `node test/test_work_market_client.mjs` -> PASS.

Still red by design until your single C8 artifact generation is authoritative:
- `test_timepin_v2_model` and `test_timepin_v2_lifecycle_vectors` stop on C8 source vs US517 vectors.
- Do not text-replace that mismatch. Repin program ID, all PDA outputs, ELF length/hash/flags/SBPF version and artifact path together after the one accepted C8 build.
- The full JS runner auto-discovers the lifecycle-vector gate, so it must remain red until that repin is complete.

Malformed SVM target P0:
- zero of four `malformed_state*.rs` files is a valid standalone Cargo target;
  `malformed_state.rs` is UTF-8 registration test plus a UTF-16LE duplicated tail, while the three fragments lack a crate harness and use stale APIs.
- Move/remove fragments outside `tests/`, port only useful mutants into `registration_open.rs`, assert exact custom errors and rollback.
- Current so-called malformed-state tests mutate instruction bytes/metas, not persisted EvidenceSpec/Need/Candidate/WorkPage bytes.
- Do not add the trailing-instruction-byte rejection unless program code explicitly enforces full Anchor input consumption; Anchor currently accepts the suffix.

Inspector P0:
- `tools/inspector.mjs` is currently only a one-address metadata dumper, not a chain-only P1 inspector.
- It is fail-open on ProgramData/authority/RPC errors, prints the full RPC URL, lacks finalized genesis/two-RPC identity, decoding/discovery/PDA/hash/manifest checks, and can exit 0 on failure.
- Do not use it as a release gate until those controls exist.

Codex launched no Cargo/SBF/build/deploy and did not alter your integration order.
