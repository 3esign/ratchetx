Ownership amendment: Sol/native Windows owns Cargo/SBF; Fable released it in COWORK_HANDOFF section0. Earlier snapshot owner wording below is superseded.

# RatchetX exact-SBF review — 2026-09-05

Read-only laptop audit through Svemir. Repo: D:/Work/Software_Projects/pumpmind/ratchetx/ratchet_phase_a_clean.
Snapshot 2026-09-04T22:12:47.741Z = September 5 00:12:47 Budapest. Native lead/Fable retains sole Cargo/SBF/integration ownership.

## Release-blocking findings

1. malformed_state.rs is NUL-free UTF-8 (26,568 B) but remains invalid. Five duplicate top-level function names: lines 576/659, 591/673, 608/690, 624/707, 641/723. First block 575–657 uses nonexistent Fixture and SpecArgs::new. Three sibling fragments are automatically discovered Cargo integration targets without required helpers/imports; svm-tests/Cargo.toml:1–18 has no target restrictions. Ten annotations represent five intended cases.
   Fix: retain one World-based implementation per case, relocate fragments outside tests/, use existing World::send (442–445) instead of later Keypair::from_bytes calls. Native owner should validate SDK compatibility.

2. Malformed assertions can accept unrelated failures: lines 669,686,703,719,737 accept generic InstructionError. Truncated capture at 699 uses LIVE_SOL_FEED as the message hash and never installs a price account through put_price. A missing account/setup error can satisfy this test. Establish a successful control transaction, mutate one thing, assert specific error plus rollback. Trailing-byte rejection at 665 is an unverified expectation; verify actual Anchor decoder behavior.

3. Timepin host identity test programs/rcx-timepin-v2/src/lib.rs:1049–1050 still asserts crate::ID.to_bytes() == [7u8;32]. Migrate it to C8ww alongside the native owner's identity work.

4. Core exact-SBF World::new, onchain/ratchet-core-g2/svm-tests/tests/core_g2_lifecycle.rs:559–569, loads Core from a path without a Core length/hash assertion. It validates only Timepin. Pin both binaries in release evidence, preferably assert Core bytes before loading. Both Timepin targets still pin 414,264 B / historical 8d913a5d at 36–40; Core also pins old Timepin hash at 55–56 and US517 at 77–78. Replace all with new C8ww generation evidence atomically.

## Smallest honest matrix

- Timepin host tests after identity assertion repair.
- Timepin registration_open: 4 tests at 577,659,742,826. Synthetic real-scale registration/open/capture; generation mutations/rollback; slot/reauthentication; exact public mainnet snapshot. Artifact mismatch fails at 271–274 and 953–955.
- Timepin malformed_state: 5 intended unique cases AFTER consolidation and semantic repair; zero current proven results. Compile every discovered Cargo target before counting.
- Core core_g2_lifecycle: 6 tests at 2100,2184,2436,2589,2832,3162. Immutable registration/claim/history; forward/archive/sponsor; equality/void; Token-2022 reload/memo/burn/replay; delegation/revocation/pending expiry; observed replay/active expiry. Actual loaded Timepin capture_first/finalize/expire are invoked at 1205,1267,1309.
- Missing direct Timepin SBF proof: conflict and Timepin sponsored two-record WorkPage path. README:128–130 explicitly leaves these open. Pure lifecycle tests do not establish account-level transaction behavior. Add narrow cases to a maintained existing target.
- Then native lead's devnet lifecycle and server-off drill; these are separate evidence.

## Runner behavior

scripts/run-tests.mjs:112–118 launches only JS test_*.mjs; green npm tests do not prove SBF. Nonzero/null exit fails (135–143). It has no per-child timeout/error-event handler. The known ~70-second model run needs sufficient outer timeout; no suites repeated here.

## Honest verdict

Verified exact source, duplicate names, missing fragment scaffolding, NUL-free encoding, test counts, guard asymmetry and runner handling. Compile failure and weak error specificity inferred from source; Cargo was not invoked. No JS tests, builds, key access, deploy, freeze, repository edits or Git changes. An initial broad source census timed out at Svemir's 120-second response boundary; all cited evidence came from subsequent successful narrow reads.

## Source receipt

snapshotUtc=2026-09-04T22:12:47.741Z
onchain/rcx-timepin-v2/svm-tests/Cargo.toml 440 b4aeb462c5522c5bb19e8fe5a2b277b0cb2b7a8e487271522c5d485822d009cf
onchain/rcx-timepin-v2/svm-tests/tests/malformed_state.rs 26568 85b5bf8cd1c4cf3f357bca0997e9f963492e33221219c6eb41e2261c207d596a
onchain/rcx-timepin-v2/svm-tests/tests/malformed_state_append.rs 2124 1c1ef318e856406767f2b2d1bf4c13a208a7ba147fc25ade293ae5aff6708967
onchain/rcx-timepin-v2/svm-tests/tests/malformed_state_append2.rs 1386 cdd38b3019e3e1eedcdf1b1a2902cafe437d0be9f1a3edc44120e5b500581dfc
onchain/rcx-timepin-v2/svm-tests/tests/malformed_state_new.rs 3200 e17182a5a8433b31470579dbb055a7bad38bbc12d36021418ffacef39a9a2b49
onchain/rcx-timepin-v2/svm-tests/tests/registration_open.rs 40905 6956199fb7761c1a3a908ebbeffe6adc7d3acb1403dbe2b6234aa66ef633e92d
onchain/ratchet-core-g2/svm-tests/tests/core_g2_lifecycle.rs 116792 0fcdac90ba2d275167f987d8b8e2a9e054f12c2934b29fce8a1424d196bd4ebe
1205:            self.timepin_instruction(
1206:                "expire",
1212:                    AccountMeta::new(timepin_work_page_pda(&need), false),
1217:        let expired = self.svm.get_account(&need).expect("expired Timepin Need");
1237:        let mut data = discriminator("account", "PriceUpdateV2").to_vec();
1254:    fn capture_and_finalize_timepin(
1265:        let timepin_work_page = timepin_work_page_pda(&need);
1267:            self.timepin_instruction(
1268:                "capture_first",
1281:                    AccountMeta::new(timepin_work_page, false),
1287:        let captured_need = self.svm.get_account(&need).expect("captured Need");
1288:        let captured_candidate = self
1291:            .expect("captured Candidate");
1292:        assert_eq!(captured_need.owner, timepin_program());
1293:        assert_eq!(captured_need.data.len(), 132);
1294:        assert_eq!(captured_need.data[11], 1);
1295:        assert_eq!(read_hash(&captured_need.data, 68), message_hash);
1296:        assert_eq!(captured_candidate.owner, timepin_program());
1297:        assert_eq!(captured_candidate.data.len(), 119);
1299:            &captured_candidate.data[..8],
1300:            &discriminator("account", "CandidateV2")
1302:        assert_eq!(&captured_candidate.data[11..43], need.as_ref());
1303:        assert_eq!(read_i64(&captured_candidate.data, 43), price);
1304:        assert_eq!(read_i64(&captured_candidate.data, 63), target);
1305:        assert_eq!(read_i64(&captured_candidate.data, 111), target);
1309:            self.timepin_instruction(
1310:                "finalize",
1317:                    AccountMeta::new(timepin_work_page, false),
1322:        let final_need = self.svm.get_account(&need).expect("final Timepin Need");
onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lib.rs 37946 ffa60cdd721118379e0e70a18545c472382edf046df64d9a51d01ce9068cdaac
scripts/run-tests.mjs 7087 b70da508bf51ff38ca0a953ff1aba3a9c951ba463425ef044b46eca360d317b3


