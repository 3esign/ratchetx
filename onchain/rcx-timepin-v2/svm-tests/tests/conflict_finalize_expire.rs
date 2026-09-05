//! Manual transaction encodings against the exact final Timepin v2 SBF.
//! Exercises the terminal lifecycle beyond `capture_first`: a genuine second
//! observation forcing AMBIGUOUS via `capture_conflict`, `finalize` closing a
//! CANDIDATE Need after its capture window, and `expire` closing an
//! unanswered OPEN Need after the same deadline. Mirrors the harness in
//! `registration_open.rs` so it drops into the same `svm-tests` crate.
//!
//! Deliberately does NOT assert `TimepinNeedV2`'s total account length or any
//! offset past `candidate_b_hash` (byte 132): as of 2026-09-05 the team has an
//! open, undecided question (ROOM.md, OpusB 16:20Z) about whether the account
//! grows to 268 bytes for an inline observation or stays at 124 payload bytes
//! behind `CandidateV2`. Every assertion here only touches the header
//! (`state` at offset 11, `candidate_a_hash`/`candidate_b_hash` at 68..132),
//! which is identical either way.

use litesvm::LiteSVM;
use sha2::{Digest, Sha256};
use solana_sdk::{
    account::Account,
    clock::Clock,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use std::{
    path::{Component, PathBuf},
    str::FromStr,
};

const SCHEMA: u16 = 2;
const NOW: i64 = 1_800_000_000;
const TARGET: i64 = NOW + 1_200;

// This fixture registered grid 60 with lag 120 and hard-coded the capture
// deadline as TARGET + 180. Both numbers were legal when they were written and
// neither is legal now: lib.rs:618 refuses lag >= grid outright, because a print
// admissible for T and for T + grid collapses two rounds of the game into one --
// and grid 60 with lag 120 is the exact example that comment names. All four
// tests in this file therefore died in SETUP, at register_evidence_spec, with
// BadPostTargetLag (6009), before reaching anything they were written to test.
// That is the whole of the B1 build failure of 2026-09-05 (build_g2_report.txt
// line 1082); no program code is implicated.
//
// The numbers are now DERIVED from the rule instead of restating it, so the same
// drift cannot happen again silently: lag is grid - 1, which R2 proves is both
// the legal maximum and the coverage optimum, and the deadline is computed the
// way lib.rs::derive_deadlines computes it (target + lag + grace) rather than
// asserted. Change GRID here and every dependent constant follows.
const GRID_SECONDS: u32 = 60;
const LAG_SECONDS: u32 = GRID_SECONDS - 1;
const CAPTURE_GRACE_SECONDS: u32 = 60;
const CAPTURE_DEADLINE: i64 = TARGET + LAG_SECONDS as i64 + CAPTURE_GRACE_SECONDS as i64;
const REGISTERED_SLOT: u64 = 1_000;
const RECEIVER_GENERATION_SLOT: u64 = 900;
const WORMHOLE_GENERATION_SLOT: u64 = 901;
const CAPTURE_SLOT: u64 = 1_100;
const FEED: [u8; 32] = [3; 32];
const RECEIVER_PROGRAMDATA_LEN: usize = 416 * 1_024;
const WORMHOLE_PROGRAMDATA_LEN: usize = 656 * 1_024;
const HISTORICAL_TIMEPIN_ID: &str = "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx";

// NEED_* state tags (lib.rs).
const NEED_OPEN: u8 = 0;
const NEED_CANDIDATE: u8 = 1;
const NEED_FINAL: u8 = 2;
const NEED_AMBIGUOUS: u8 = 3;
const NEED_EXPIRED: u8 = 4;

fn program_id() -> Pubkey {
    Pubkey::from_str("C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp").unwrap()
}

fn receiver_id() -> Pubkey {
    Pubkey::from_str("rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp").unwrap()
}

fn push_id() -> Pubkey {
    Pubkey::from_str("pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou").unwrap()
}

fn wormhole_id() -> Pubkey {
    Pubkey::new_from_array([8; 32])
}

fn loader_v3() -> Pubkey {
    Pubkey::from_str("BPFLoaderUpgradeab1e11111111111111111111111").unwrap()
}

fn system_program() -> Pubkey {
    Pubkey::from_str("11111111111111111111111111111111").unwrap()
}

fn pinned_sbf() -> Vec<u8> {
    let configured = std::env::var_os("RCX_TIMEPIN_V2_SO")
        .expect("RCX_TIMEPIN_V2_SO must name the immutable Timepin v2 SBF");
    assert!(
        !configured.is_empty(),
        "RCX_TIMEPIN_V2_SO must not be empty"
    );
    let configured_path = PathBuf::from(configured);
    let path = std::fs::canonicalize(&configured_path).unwrap_or_else(|error| {
        panic!(
            "canonicalize RCX_TIMEPIN_V2_SO {}: {error}",
            configured_path.display()
        )
    });

    assert!(
        !path.components().any(|component| {
            matches!(
                component,
                Component::Normal(name) if name.to_string_lossy().eq_ignore_ascii_case("target")
            )
        }),
        "RCX_TIMEPIN_V2_SO must not resolve through a target directory: {}",
        path.display()
    );
    assert_eq!(
        path.file_name().and_then(|name| name.to_str()),
        Some("rcx_timepin_v2.so"),
        "RCX_TIMEPIN_V2_SO must have the exact canonical filename"
    );

    let sbf = std::fs::read(&path)
        .unwrap_or_else(|error| panic!("read pinned Timepin v2 SBF {}: {error}", path.display()));
    assert!(
        sbf.starts_with(b"\x7fELF"),
        "pinned Timepin v2 SBF must have ELF magic"
    );
    assert!(
        sbf.len() >= 52,
        "pinned Timepin v2 SBF must have a complete ELF64 header"
    );
    assert_eq!(sbf[4], 2, "pinned Timepin v2 SBF must be ELF64");
    assert_eq!(sbf[5], 1, "pinned Timepin v2 SBF must be little-endian");
    assert_eq!(
        u32::from_le_bytes(sbf[48..52].try_into().unwrap()),
        3,
        "pinned Timepin v2 SBF must have SBPFv3 ELF e_flags"
    );

    let sha256 = hex(&hashv(&[&sbf]));
    let parent = path
        .parent()
        .expect("pinned Timepin v2 SBF must have a SHA-256 parent directory");
    assert_eq!(
        parent.file_name().and_then(|name| name.to_str()),
        Some(sha256.as_str()),
        "pinned Timepin v2 SBF parent must equal its lowercase SHA-256"
    );
    let grandparent = parent
        .parent()
        .expect("pinned Timepin v2 SBF must have a cache-root grandparent");
    assert_eq!(
        grandparent.file_name().and_then(|name| name.to_str()),
        Some("ratchetx-onchain-sbf"),
        "pinned Timepin v2 SBF grandparent must be ratchetx-onchain-sbf"
    );

    let canonical_id = program_id().to_bytes();
    let historical_id = Pubkey::from_str(HISTORICAL_TIMEPIN_ID)
        .expect("valid historical Timepin v2 ID")
        .to_bytes();
    let canonical_count = sbf
        .windows(canonical_id.len())
        .filter(|window| *window == &canonical_id[..])
        .count();
    let historical_count = sbf
        .windows(historical_id.len())
        .filter(|window| *window == &historical_id[..])
        .count();
    assert!(
        canonical_count >= 1,
        "pinned Timepin v2 SBF must embed the canonical C8ww program ID"
    );
    assert_eq!(
        historical_count, 0,
        "pinned Timepin v2 SBF must not embed the historical US517 program ID"
    );

    sbf
}

fn discriminator(kind: &str, name: &str) -> [u8; 8] {
    Sha256::digest(format!("{kind}:{name}").as_bytes())[..8]
        .try_into()
        .unwrap()
}

fn hashv(parts: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part);
    }
    hasher.finalize().into()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn programdata_address(program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[program.as_ref()], &loader_v3()).0
}

fn receiver_config_address() -> Pubkey {
    Pubkey::find_program_address(&[b"config"], &receiver_id()).0
}

fn source_address() -> Pubkey {
    Pubkey::find_program_address(&[&0u16.to_le_bytes(), &FEED], &push_id()).0
}

fn spec_address(hash: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"evidence_spec", &SCHEMA.to_le_bytes(), hash],
        &program_id(),
    )
}

fn need_address(hash: &[u8; 32], target: i64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"need", &SCHEMA.to_le_bytes(), hash, &target.to_le_bytes()],
        &program_id(),
    )
}

fn candidate_address(need: &Pubkey, message_hash: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"candidate", need.as_ref(), message_hash], &program_id())
}

fn work_page_address(need: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"work_page", need.as_ref()], &program_id()).0
}

fn receiver_config_data(configured_wormhole: Pubkey) -> Vec<u8> {
    let mut data = discriminator("account", "Config").to_vec();
    data.extend_from_slice(Pubkey::new_from_array([11; 32]).as_ref());
    data.push(0); // target_governance_authority: None
    data.extend_from_slice(configured_wormhole.as_ref());
    data.extend_from_slice(&0u32.to_le_bytes()); // valid_data_sources: []
    data.extend_from_slice(&0u64.to_le_bytes());
    data.push(1);
    data.resize(370, 0);
    assert_eq!(data.len(), 370);
    data
}

#[derive(Clone)]
struct SpecArgs {
    receiver_slot: u64,
    config_hash: [u8; 32],
    wormhole: Pubkey,
    wormhole_slot: u64,
}

impl SpecArgs {
    fn canonical(config_data: &[u8]) -> Self {
        Self {
            receiver_slot: RECEIVER_GENERATION_SLOT,
            config_hash: hashv(&[config_data]),
            wormhole: wormhole_id(),
            wormhole_slot: WORMHOLE_GENERATION_SLOT,
        }
    }

    fn policy_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(134);
        out.extend_from_slice(&SCHEMA.to_le_bytes());
        out.push(1); // adapter: ADAPTER_PYTH_PUSH_V2 (bracket predicate)
        out.extend_from_slice(receiver_id().as_ref());
        out.extend_from_slice(push_id().as_ref());
        out.extend_from_slice(&0u16.to_le_bytes()); // shard_id
        out.extend_from_slice(&FEED);
        out.push(1); // required_verification: Full
        out.extend_from_slice(&GRID_SECONDS.to_le_bytes()); // target_grid_seconds
        out.extend_from_slice(&30u32.to_le_bytes()); // min_open_lead_seconds
        out.extend_from_slice(&3_600u32.to_le_bytes()); // max_target_ahead_seconds
        out.extend_from_slice(&120u32.to_le_bytes()); // max_pre_target_gap_seconds
        out.extend_from_slice(&LAG_SECONDS.to_le_bytes()); // max_post_target_lag_seconds
        out.extend_from_slice(&CAPTURE_GRACE_SECONDS.to_le_bytes()); // capture_grace_seconds
        out.extend_from_slice(&5u16.to_le_bytes()); // max_future_skew_seconds
        out.extend_from_slice(&(-12i8).to_le_bytes()); // min_exponent
        out.extend_from_slice(&2i8.to_le_bytes()); // max_exponent
        out.extend_from_slice(&1_000u32.to_le_bytes()); // max_confidence_bps
        assert_eq!(out.len(), 134);
        out
    }

    fn canonical_bytes(&self) -> Vec<u8> {
        let mut out = self.policy_bytes();
        out.extend_from_slice(&self.receiver_slot.to_le_bytes());
        out.extend_from_slice(&self.config_hash);
        out.extend_from_slice(self.wormhole.as_ref());
        out.extend_from_slice(&self.wormhole_slot.to_le_bytes());
        assert_eq!(out.len(), 214);
        out
    }

    fn spec_hash(&self) -> [u8; 32] {
        hashv(&[
            b"rcx-timepin:evidence-spec:v2-generation\0",
            &self.canonical_bytes(),
        ])
    }
}

#[derive(Clone, Copy)]
struct GenerationAccounts {
    receiver_programdata: Pubkey,
    wormhole_programdata: Pubkey,
}

struct World {
    svm: LiteSVM,
    actor: Keypair,
    config_data: Vec<u8>,
}

impl World {
    fn new() -> Self {
        let sbf = pinned_sbf();

        let mut svm = LiteSVM::new();
        for id in [program_id(), receiver_id(), wormhole_id()] {
            svm.add_program(id, &sbf)
                .expect("install Loader-v3 program");
        }
        Self::resize_programdata(
            &mut svm,
            receiver_id(),
            RECEIVER_PROGRAMDATA_LEN,
            RECEIVER_GENERATION_SLOT,
        );
        Self::resize_programdata(
            &mut svm,
            wormhole_id(),
            WORMHOLE_PROGRAMDATA_LEN,
            WORMHOLE_GENERATION_SLOT,
        );

        let config_data = receiver_config_data(wormhole_id());
        svm.set_account(
            receiver_config_address(),
            Account {
                lamports: 10_000_000,
                data: config_data.clone(),
                owner: receiver_id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

        let actor = Keypair::new();
        svm.airdrop(&actor.pubkey(), 20_000_000_000).unwrap();
        let mut world = Self {
            svm,
            actor,
            config_data,
        };
        world.set_clock(NOW, REGISTERED_SLOT);
        world
    }

    fn resize_programdata(svm: &mut LiteSVM, program: Pubkey, exact_len: usize, slot: u64) {
        let programdata = programdata_address(&program);
        let mut account = svm.get_account(&programdata).expect("ProgramData account");
        account.data[4..12].copy_from_slice(&slot.to_le_bytes());
        account.data.resize(exact_len, 0xA5);
        account.lamports = 20_000_000_000;
        svm.set_account(programdata, account).unwrap();
    }

    fn generation_accounts(&self) -> GenerationAccounts {
        GenerationAccounts {
            receiver_programdata: programdata_address(&receiver_id()),
            wormhole_programdata: programdata_address(&wormhole_id()),
        }
    }

    fn set_clock(&mut self, unix_timestamp: i64, slot: u64) {
        self.svm.set_sysvar(&Clock {
            slot,
            epoch_start_timestamp: NOW - 1_000,
            epoch: 1,
            leader_schedule_epoch: 1,
            unix_timestamp,
        });
    }

    fn send_as(&mut self, instruction: Instruction, signer: &Keypair) -> Result<u64, String> {
        self.svm.expire_blockhash();
        let transaction = Transaction::new_signed_with_payer(
            &[instruction],
            Some(&signer.pubkey()),
            &[signer],
            self.svm.latest_blockhash(),
        );
        match self.svm.send_transaction(transaction) {
            Ok(meta) => Ok(meta.compute_units_consumed),
            Err(error) => Err(format!(
                "{}\n{:?}\ncompute_units={}",
                error.meta.logs.join("\n"),
                error.err,
                error.meta.compute_units_consumed
            )),
        }
    }

    fn send(&mut self, instruction: Instruction) -> Result<u64, String> {
        let secret: [u8; 32] = self.actor.to_bytes()[..32].try_into().unwrap();
        let actor = Keypair::new_from_array(secret);
        self.send_as(instruction, &actor)
    }

    fn register_ix(&self, args: &SpecArgs, accounts: GenerationAccounts) -> Instruction {
        let hash = args.spec_hash();
        let mut data = discriminator("global", "register_evidence_spec").to_vec();
        data.extend_from_slice(&hash);
        data.extend_from_slice(&args.canonical_bytes());
        Instruction {
            program_id: program_id(),
            accounts: vec![
                AccountMeta::new(self.actor.pubkey(), true),
                AccountMeta::new(spec_address(&hash).0, false),
                AccountMeta::new_readonly(receiver_id(), false),
                AccountMeta::new_readonly(accounts.receiver_programdata, false),
                AccountMeta::new_readonly(receiver_config_address(), false),
                AccountMeta::new_readonly(args.wormhole, false),
                AccountMeta::new_readonly(accounts.wormhole_programdata, false),
                AccountMeta::new_readonly(system_program(), false),
            ],
            data,
        }
    }

    fn open_ix(&self, signer: Pubkey, hash: [u8; 32]) -> Instruction {
        let mut data = discriminator("global", "open_need").to_vec();
        data.extend_from_slice(&hash);
        data.extend_from_slice(&TARGET.to_le_bytes());
        Instruction {
            program_id: program_id(),
            accounts: vec![
                AccountMeta::new(signer, true),
                AccountMeta::new_readonly(spec_address(&hash).0, false),
                AccountMeta::new(need_address(&hash, TARGET).0, false),
                AccountMeta::new_readonly(system_program(), false),
            ],
            data,
        }
    }

    /// Sets the sponsored price PDA to a message with the given `price`, at
    /// the shared `publish_time`/`prev_publish_time` used across this file,
    /// and returns its `price_message_hash`. Two calls with different
    /// `price` values are the two distinct signed messages a real Pyth
    /// publisher revision would produce for the same target.
    fn put_price_at(&mut self, price: i64, posted_slot: u64) -> [u8; 32] {
        let conf = 12_345u64;
        let exponent = -6i32;
        let prev_publish_time = TARGET - 60;
        let publish_time = TARGET;
        let source = source_address();
        let mut data = discriminator("account", "PriceUpdateV2").to_vec();
        data.extend_from_slice(source.as_ref());
        data.push(1); // VerificationLevel::Full
        data.extend_from_slice(&FEED);
        data.extend_from_slice(&price.to_le_bytes());
        data.extend_from_slice(&conf.to_le_bytes());
        data.extend_from_slice(&exponent.to_le_bytes());
        data.extend_from_slice(&publish_time.to_le_bytes());
        data.extend_from_slice(&prev_publish_time.to_le_bytes());
        data.extend_from_slice(&price.to_le_bytes());
        data.extend_from_slice(&conf.to_le_bytes());
        data.extend_from_slice(&posted_slot.to_le_bytes());
        data.resize(134, 0);
        self.svm
            .set_account(
                source,
                Account {
                    lamports: 10_000_000,
                    data,
                    owner: receiver_id(),
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
        hashv(&[
            b"rcx-timepin:pyth-price-message:v2\0",
            &FEED,
            &price.to_le_bytes(),
            &conf.to_le_bytes(),
            &exponent.to_le_bytes(),
            &publish_time.to_le_bytes(),
            &prev_publish_time.to_le_bytes(),
            &price.to_le_bytes(),
            &conf.to_le_bytes(),
        ])
    }

    fn capture_first_ix(
        &self,
        spec_hash: [u8; 32],
        message_hash: [u8; 32],
        accounts: GenerationAccounts,
    ) -> Instruction {
        let need = need_address(&spec_hash, TARGET).0;
        let mut data = discriminator("global", "capture_first").to_vec();
        data.extend_from_slice(&message_hash);
        Instruction {
            program_id: program_id(),
            accounts: vec![
                AccountMeta::new(self.actor.pubkey(), true),
                AccountMeta::new_readonly(spec_address(&spec_hash).0, false),
                AccountMeta::new(need, false),
                AccountMeta::new(candidate_address(&need, &message_hash).0, false),
                AccountMeta::new_readonly(receiver_id(), false),
                AccountMeta::new_readonly(accounts.receiver_programdata, false),
                AccountMeta::new_readonly(receiver_config_address(), false),
                AccountMeta::new_readonly(wormhole_id(), false),
                AccountMeta::new_readonly(accounts.wormhole_programdata, false),
                AccountMeta::new_readonly(source_address(), false),
                AccountMeta::new(work_page_address(&need), false),
                AccountMeta::new_readonly(system_program(), false),
            ],
            data,
        }
    }

    fn capture_conflict_ix(
        &self,
        spec_hash: [u8; 32],
        first_hash: [u8; 32],
        second_hash: [u8; 32],
        accounts: GenerationAccounts,
    ) -> Instruction {
        let need = need_address(&spec_hash, TARGET).0;
        let mut data = discriminator("global", "capture_conflict").to_vec();
        data.extend_from_slice(&second_hash);
        Instruction {
            program_id: program_id(),
            accounts: vec![
                AccountMeta::new(self.actor.pubkey(), true),
                AccountMeta::new_readonly(spec_address(&spec_hash).0, false),
                AccountMeta::new(need, false),
                AccountMeta::new_readonly(candidate_address(&need, &first_hash).0, false),
                AccountMeta::new(candidate_address(&need, &second_hash).0, false),
                AccountMeta::new_readonly(receiver_id(), false),
                AccountMeta::new_readonly(accounts.receiver_programdata, false),
                AccountMeta::new_readonly(receiver_config_address(), false),
                AccountMeta::new_readonly(wormhole_id(), false),
                AccountMeta::new_readonly(accounts.wormhole_programdata, false),
                AccountMeta::new_readonly(source_address(), false),
                AccountMeta::new(work_page_address(&need), false),
                AccountMeta::new_readonly(system_program(), false),
            ],
            data,
        }
    }

    fn finalize_ix(&self, spec_hash: [u8; 32], candidate_hash: [u8; 32]) -> Instruction {
        let need = need_address(&spec_hash, TARGET).0;
        let data = discriminator("global", "finalize").to_vec();
        Instruction {
            program_id: program_id(),
            accounts: vec![
                AccountMeta::new(self.actor.pubkey(), true),
                AccountMeta::new_readonly(spec_address(&spec_hash).0, false),
                AccountMeta::new(need, false),
                AccountMeta::new_readonly(candidate_address(&need, &candidate_hash).0, false),
                AccountMeta::new(work_page_address(&need), false),
            ],
            data,
        }
    }

    fn expire_ix(&self, spec_hash: [u8; 32]) -> Instruction {
        let need = need_address(&spec_hash, TARGET).0;
        let data = discriminator("global", "expire").to_vec();
        Instruction {
            program_id: program_id(),
            accounts: vec![
                AccountMeta::new(self.actor.pubkey(), true),
                AccountMeta::new_readonly(spec_address(&spec_hash).0, false),
                AccountMeta::new(need, false),
                AccountMeta::new(work_page_address(&need), false),
            ],
            data,
        }
    }

    fn register_and_open(&mut self) -> (SpecArgs, [u8; 32]) {
        let args = SpecArgs::canonical(&self.config_data);
        let hash = args.spec_hash();
        let accounts = self.generation_accounts();
        self.send(self.register_ix(&args, accounts)).unwrap();
        self.send(self.open_ix(self.actor.pubkey(), hash)).unwrap();
        (args, hash)
    }

    fn need_state(&self, spec_hash: &[u8; 32]) -> u8 {
        let (need_key, _) = need_address(spec_hash, TARGET);
        self.svm.get_account(&need_key).unwrap().data[11]
    }

    fn need_hashes(&self, spec_hash: &[u8; 32]) -> ([u8; 32], [u8; 32]) {
        let (need_key, _) = need_address(spec_hash, TARGET);
        let data = self.svm.get_account(&need_key).unwrap().data;
        (
            data[68..100].try_into().unwrap(),
            data[100..132].try_into().unwrap(),
        )
    }
}

#[test]
fn conflict_second_message_terminalizes_ambiguous_and_locks_the_need() {
    let mut world = World::new();
    let (_args, spec_hash) = world.register_and_open();
    world.set_clock(TARGET, CAPTURE_SLOT);
    let accounts = world.generation_accounts();

    let hash_a = world.put_price_at(12_345_678, REGISTERED_SLOT + 1);
    world
        .send(world.capture_first_ix(spec_hash, hash_a, accounts))
        .unwrap();
    assert_eq!(world.need_state(&spec_hash), NEED_CANDIDATE);

    // Duplicate through capture_first is fine and does not move the state.
    world
        .send(world.capture_first_ix(spec_hash, hash_a, accounts))
        .unwrap();
    assert_eq!(world.need_state(&spec_hash), NEED_CANDIDATE);
    assert_eq!(world.need_hashes(&spec_hash), (hash_a, [0u8; 32]));

    // A second, genuinely different message through capture_first is refused:
    // the state machine insists on capture_conflict for that case.
    let hash_b = world.put_price_at(99_999_999, REGISTERED_SLOT + 2);
    let error = world
        .send(world.capture_first_ix(spec_hash, hash_b, accounts))
        .unwrap_err();
    assert!(
        error.contains("a different message must use capture_conflict"),
        "{error}"
    );
    assert_eq!(world.need_state(&spec_hash), NEED_CANDIDATE);
    assert_eq!(world.need_hashes(&spec_hash), (hash_a, [0u8; 32]));

    // The genuine conflict: capture_conflict resolves to AMBIGUOUS and sorts
    // the two hashes by byte value, independent of arrival order.
    world
        .send(world.capture_conflict_ix(spec_hash, hash_a, hash_b, accounts))
        .unwrap();
    assert_eq!(world.need_state(&spec_hash), NEED_AMBIGUOUS);
    let (stored_a, stored_b) = world.need_hashes(&spec_hash);
    let (expected_a, expected_b) = if hash_a < hash_b {
        (hash_a, hash_b)
    } else {
        (hash_b, hash_a)
    };
    assert_eq!((stored_a, stored_b), (expected_a, expected_b));

    // AMBIGUOUS is terminal: neither capture_first nor a fresh capture_conflict
    // may touch it again.
    let hash_c = world.put_price_at(55_555_555, REGISTERED_SLOT + 3);
    let error = world
        .send(world.capture_first_ix(spec_hash, hash_c, accounts))
        .unwrap_err();
    assert!(
        error.contains("Need is terminal or incompatible with this instruction"),
        "{error}"
    );
    assert_eq!(world.need_state(&spec_hash), NEED_AMBIGUOUS);
}

#[test]
fn finalize_waits_for_the_capture_window_and_then_finalizes() {
    let mut world = World::new();
    let (_args, spec_hash) = world.register_and_open();
    world.set_clock(TARGET, CAPTURE_SLOT);
    let accounts = world.generation_accounts();

    let hash_a = world.put_price_at(12_345_678, REGISTERED_SLOT + 1);
    world
        .send(world.capture_first_ix(spec_hash, hash_a, accounts))
        .unwrap();
    assert_eq!(world.need_state(&spec_hash), NEED_CANDIDATE);

    // One second before the deadline the capture window is still open.
    world.set_clock(CAPTURE_DEADLINE - 1, CAPTURE_SLOT + 1);
    let error = world
        .send(world.finalize_ix(spec_hash, hash_a))
        .unwrap_err();
    assert!(error.contains("capture window is still open"), "{error}");
    assert_eq!(world.need_state(&spec_hash), NEED_CANDIDATE);

    // Exactly on the deadline, finalize succeeds and the state is terminal.
    world.set_clock(CAPTURE_DEADLINE, CAPTURE_SLOT + 2);
    world.send(world.finalize_ix(spec_hash, hash_a)).unwrap();
    assert_eq!(world.need_state(&spec_hash), NEED_FINAL);
    assert_eq!(world.need_hashes(&spec_hash), (hash_a, [0u8; 32]));

    // FINAL is terminal: a later capture is refused and does not reopen it.
    let error = world
        .send(world.capture_first_ix(spec_hash, hash_a, accounts))
        .unwrap_err();
    assert!(
        error.contains("Need is terminal or incompatible with this instruction"),
        "{error}"
    );
    assert_eq!(world.need_state(&spec_hash), NEED_FINAL);
}

#[test]
fn expire_only_takes_an_open_unanswered_need_after_its_window() {
    let mut world = World::new();
    let (_args, spec_hash) = world.register_and_open();
    assert_eq!(world.need_state(&spec_hash), NEED_OPEN);

    // Before the target is even reached, expire is refused the same way.
    world.set_clock(TARGET, CAPTURE_SLOT);
    let error = world.send(world.expire_ix(spec_hash)).unwrap_err();
    assert!(error.contains("capture window is still open"), "{error}");
    assert_eq!(world.need_state(&spec_hash), NEED_OPEN);

    // One second before the deadline, still refused.
    world.set_clock(CAPTURE_DEADLINE - 1, CAPTURE_SLOT + 1);
    let error = world.send(world.expire_ix(spec_hash)).unwrap_err();
    assert!(error.contains("capture window is still open"), "{error}");
    assert_eq!(world.need_state(&spec_hash), NEED_OPEN);

    // Exactly on the deadline, an unanswered Need expires.
    world.set_clock(CAPTURE_DEADLINE, CAPTURE_SLOT + 2);
    world.send(world.expire_ix(spec_hash)).unwrap();
    assert_eq!(world.need_state(&spec_hash), NEED_EXPIRED);
    assert_eq!(world.need_hashes(&spec_hash), ([0u8; 32], [0u8; 32]));

    // EXPIRED is terminal and does not re-expire.
    let error = world.send(world.expire_ix(spec_hash)).unwrap_err();
    assert!(
        error.contains("an unanswered Open Need is required"),
        "{error}"
    );
    assert_eq!(world.need_state(&spec_hash), NEED_EXPIRED);
}

#[test]
fn finalize_of_an_open_need_without_a_candidate_is_refused() {
    let mut world = World::new();
    let (_args, spec_hash) = world.register_and_open();
    let (need_key, _) = need_address(&spec_hash, TARGET);

    // finalize on a Need that never received a capture has no CandidateV2 PDA
    // to authenticate against; it must fail, not fabricate a terminal result.
    world.set_clock(TARGET, CAPTURE_SLOT);
    assert!(world
        .send(world.finalize_ix(spec_hash, [0u8; 32]))
        .is_err());
    assert_eq!(world.need_state(&spec_hash), NEED_OPEN);

    world.set_clock(CAPTURE_DEADLINE, CAPTURE_SLOT + 1);
    assert!(world
        .send(world.finalize_ix(spec_hash, [0u8; 32]))
        .is_err());
    assert_eq!(world.need_state(&spec_hash), NEED_OPEN);

    // The Need is still a normal Open Need and can regularly expire.
    world.send(world.expire_ix(spec_hash)).unwrap();
    assert_eq!(world.need_state(&spec_hash), NEED_EXPIRED);
    let _ = need_key;
}
