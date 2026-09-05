//! Manual transaction encodings against the exact final Timepin v2 SBF.
//! The Receiver/Wormhole bytes are synthetic, but their Loader-v3 account
//! shapes and 416/656-KiB ProgramData lengths exercise the real account-load path.

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
const REGISTERED_SLOT: u64 = 1_000;
const RECEIVER_GENERATION_SLOT: u64 = 900;
const WORMHOLE_GENERATION_SLOT: u64 = 901;
const CAPTURE_SLOT: u64 = 1_100;
const FEED: [u8; 32] = [3; 32];
const LIVE_SOL_FEED: [u8; 32] = [
    0xef, 0x0d, 0x8b, 0x6f, 0xda, 0x2c, 0xeb, 0xa4, 0x1d, 0xa1, 0x5d, 0x40, 0x95, 0xd1, 0xda, 0x39,
    0x2a, 0x0d, 0x2f, 0x8e, 0xd0, 0xc6, 0xc7, 0xbc, 0x0f, 0x4c, 0xfa, 0xc8, 0xc2, 0x80, 0xb5, 0x6d,
];
const LIVE_SNAPSHOT_SLOT: u64 = 444_338_968;
const LIVE_RECEIVER_SLOT: u64 = 417_825_260;
const LIVE_WORMHOLE_SLOT: u64 = 417_825_233;
const LIVE_PRICE_POSTED_SLOT: u64 = 444_338_800;
const LIVE_PRICE_PUBLISH_TS: i64 = 1_788_554_471;
const RECEIVER_PROGRAMDATA_LEN: usize = 416 * 1_024;
const WORMHOLE_PROGRAMDATA_LEN: usize = 656 * 1_024;
const HISTORICAL_TIMEPIN_ID: &str = "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx";

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

fn live_wormhole_id() -> Pubkey {
    Pubkey::from_str("HDw2E7P8X1SkCyjvoGsfBGAVUutKcj874bXjHrpVYrVL").unwrap()
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
    source_address_for(0, &FEED)
}

fn source_address_for(shard_id: u16, feed: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[&shard_id.to_le_bytes(), feed], &push_id()).0
}

fn live_fixture(name: &str, expected_len: usize, expected_sha256: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join("mainnet-2026-09-04")
        .join(name);
    let data = std::fs::read(&path)
        .unwrap_or_else(|error| panic!("read public mainnet fixture {}: {error}", path.display()));
    assert_eq!(data.len(), expected_len, "{} exact length", path.display());
    assert_eq!(
        hex(&hashv(&[&data])),
        expected_sha256,
        "{} exact SHA-256",
        path.display()
    );
    data
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
    shard_id: u16,
    feed: [u8; 32],
    target_grid_seconds: u32,
    receiver_slot: u64,
    config_hash: [u8; 32],
    wormhole: Pubkey,
    wormhole_slot: u64,
}

impl SpecArgs {
    fn canonical(config_data: &[u8]) -> Self {
        Self {
            shard_id: 0,
            feed: FEED,
            target_grid_seconds: 60,
            receiver_slot: RECEIVER_GENERATION_SLOT,
            config_hash: hashv(&[config_data]),
            wormhole: wormhole_id(),
            wormhole_slot: WORMHOLE_GENERATION_SLOT,
        }
    }

    fn policy_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(134);
        out.extend_from_slice(&SCHEMA.to_le_bytes());
        out.push(1);
        out.extend_from_slice(receiver_id().as_ref());
        out.extend_from_slice(push_id().as_ref());
        out.extend_from_slice(&self.shard_id.to_le_bytes());
        out.extend_from_slice(&self.feed);
        out.push(1);
        out.extend_from_slice(&self.target_grid_seconds.to_le_bytes());
        out.extend_from_slice(&30u32.to_le_bytes());
        out.extend_from_slice(&3_600u32.to_le_bytes());
        out.extend_from_slice(&120u32.to_le_bytes());
        out.extend_from_slice(&120u32.to_le_bytes());
        out.extend_from_slice(&60u32.to_le_bytes());
        out.extend_from_slice(&5u16.to_le_bytes());
        out.extend_from_slice(&(-12i8).to_le_bytes());
        out.extend_from_slice(&2i8.to_le_bytes());
        out.extend_from_slice(&1_000u32.to_le_bytes());
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

    fn policy_hash(&self) -> [u8; 32] {
        hashv(&[b"rcx-timepin:evidence-policy:v2\0", &self.policy_bytes()])
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

fn send_instruction(
    svm: &mut LiteSVM,
    instruction: Instruction,
    signer: &Keypair,
) -> Result<u64, String> {
    svm.expire_blockhash();
    let transaction = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&signer.pubkey()),
        &[signer],
        svm.latest_blockhash(),
    );
    match svm.send_transaction(transaction) {
        Ok(meta) => Ok(meta.compute_units_consumed),
        Err(error) => Err(format!(
            "{}\n{:?}\ncompute_units={}",
            error.meta.logs.join("\n"),
            error.err,
            error.meta.compute_units_consumed
        )),
    }
}

struct World {
    svm: LiteSVM,
    actor: Keypair,
    sbf: Vec<u8>,
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
            &sbf,
        );
        Self::resize_programdata(
            &mut svm,
            wormhole_id(),
            WORMHOLE_PROGRAMDATA_LEN,
            WORMHOLE_GENERATION_SLOT,
            &sbf,
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
            sbf,
            config_data,
        };
        world.set_clock(NOW, REGISTERED_SLOT);
        world.assert_loader_shape(
            receiver_id(),
            RECEIVER_PROGRAMDATA_LEN,
            RECEIVER_GENERATION_SLOT,
        );
        world.assert_loader_shape(
            wormhole_id(),
            WORMHOLE_PROGRAMDATA_LEN,
            WORMHOLE_GENERATION_SLOT,
        );
        world
    }

    fn resize_programdata(
        svm: &mut LiteSVM,
        program: Pubkey,
        exact_len: usize,
        slot: u64,
        sbf: &[u8],
    ) {
        let program_account = svm.get_account(&program).expect("Program account");
        let programdata = programdata_address(&program);
        assert!(program_account.executable);
        assert_eq!(program_account.owner, loader_v3());
        assert_eq!(&program_account.data[..4], &2u32.to_le_bytes());
        assert_eq!(&program_account.data[4..36], programdata.as_ref());

        let mut account = svm.get_account(&programdata).expect("ProgramData account");
        assert_eq!(account.owner, loader_v3());
        assert!(!account.executable);
        assert_eq!(&account.data[..4], &3u32.to_le_bytes());
        assert_eq!(account.data[12], 0);
        assert_eq!(&account.data[45..45 + sbf.len()], sbf);
        assert!(exact_len >= account.data.len());
        account.data[4..12].copy_from_slice(&slot.to_le_bytes());
        account.data.resize(exact_len, 0xA5);
        account.lamports = 20_000_000_000;
        svm.set_account(programdata, account).unwrap();
    }

    fn assert_loader_shape(&self, program: Pubkey, expected_len: usize, slot: u64) {
        let programdata = programdata_address(&program);
        let program_account = self.svm.get_account(&program).unwrap();
        let data_account = self.svm.get_account(&programdata).unwrap();
        assert_eq!(&program_account.data[..4], &2u32.to_le_bytes());
        assert_eq!(&program_account.data[4..36], programdata.as_ref());
        assert_eq!(data_account.data.len(), expected_len);
        assert_eq!(&data_account.data[..4], &3u32.to_le_bytes());
        assert_eq!(
            u64::from_le_bytes(data_account.data[4..12].try_into().unwrap()),
            slot
        );
        assert_eq!(data_account.data[12], 0);
        assert_eq!(&data_account.data[45..45 + self.sbf.len()], &self.sbf);
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

    fn set_programdata_slot(&mut self, program: Pubkey, slot: u64) {
        let address = programdata_address(&program);
        let mut account = self.svm.get_account(&address).unwrap();
        account.data[4..12].copy_from_slice(&slot.to_le_bytes());
        self.svm.set_account(address, account).unwrap();
    }

    fn clone_programdata(&mut self, source_program: Pubkey) -> Pubkey {
        let address = Pubkey::new_unique();
        let account = self
            .svm
            .get_account(&programdata_address(&source_program))
            .unwrap();
        self.svm.set_account(address, account).unwrap();
        address
    }

    fn set_config(&mut self, data: Vec<u8>) {
        self.svm
            .set_account(
                receiver_config_address(),
                Account {
                    lamports: 10_000_000,
                    data,
                    owner: receiver_id(),
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
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
        assert_eq!(data.len(), 254);
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

    fn put_price(&mut self, posted_slot: u64) -> [u8; 32] {
        let price = 12_345_678i64;
        let conf = 12_345u64;
        let prev_publish_time = TARGET - 60;
        let publish_time = TARGET;
        let source = source_address();
        let mut data = discriminator("account", "PriceUpdateV2").to_vec();
        data.extend_from_slice(source.as_ref());
        data.push(1); // VerificationLevel::Full
        data.extend_from_slice(&FEED);
        data.extend_from_slice(&price.to_le_bytes());
        data.extend_from_slice(&conf.to_le_bytes());
        data.extend_from_slice(&(-6i32).to_le_bytes());
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
            &(-6i32).to_le_bytes(),
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

    fn register_and_open(&mut self) -> (SpecArgs, [u8; 32]) {
        let args = SpecArgs::canonical(&self.config_data);
        let hash = args.spec_hash();
        let accounts = self.generation_accounts();
        self.send(self.register_ix(&args, accounts)).unwrap();
        self.send(self.open_ix(self.actor.pubkey(), hash)).unwrap();
        (args, hash)
    }
}

fn assert_no_spec(world: &World, args: &SpecArgs) {
    assert!(world
        .svm
        .get_account(&spec_address(&args.spec_hash()).0)
        .is_none());
}
#[test]
fn register_fails_with_trailing_bytes() {
    let mut world = World::new();
    let args = SpecArgs::canonical(&world.config_data);
    let accounts = world.generation_accounts();

    let mut ix = world.register_ix(&args, accounts.clone());
    ix.data.push(0x00); // Trailing byte

    let actor = world.actor.insecure_clone();
    let err = world.send_as(ix, &actor).unwrap_err();
    assert!(err.contains("InstructionFallbackNotFound") || err.contains("InstructionError"));
}

#[test]
fn open_fails_with_invalid_discriminator() {
    let mut world = World::new();
    let args = SpecArgs::canonical(&world.config_data);
    let accounts = world.generation_accounts();
    let ix = world.register_ix(&args, accounts.clone());

    let actor = world.actor.insecure_clone();
    world.send_as(ix, &actor).unwrap();

    let mut ix_open = world.open_ix(world.actor.pubkey(), args.spec_hash());
    ix_open.data[0] ^= 0xFF; // Corrupt discriminator

    let err = world.send_as(ix_open, &actor).unwrap_err();
    assert!(err.contains("InstructionFallbackNotFound") || err.contains("InstructionError"));
}

#[test]
fn capture_first_fails_with_truncated_data() {
    let mut world = World::new();
    let args = SpecArgs::canonical(&world.config_data);
    let accounts = world.generation_accounts();

    let actor = world.actor.insecure_clone();
    world
        .send_as(world.register_ix(&args, accounts.clone()), &actor)
        .unwrap();
    world
        .send_as(
            world.open_ix(world.actor.pubkey(), args.spec_hash()),
            &actor,
        )
        .unwrap();

    let mut ix_capture = world.capture_first_ix(args.spec_hash(), LIVE_SOL_FEED, accounts);
    ix_capture.data.pop(); // Truncate

    let err = world.send_as(ix_capture, &actor).unwrap_err();
    assert!(err.contains("InstructionFallbackNotFound") || err.contains("InstructionError"));
}

#[test]
fn register_fails_with_invalid_pda() {
    let mut world = World::new();
    let args = SpecArgs::canonical(&world.config_data);
    let accounts = world.generation_accounts();

    let mut ix = world.register_ix(&args, accounts.clone());

    // Change spec account PDA to something else
    ix.accounts[1].pubkey = Pubkey::new_unique();

    let actor = world.actor.insecure_clone();
    let err = world.send_as(ix, &actor).unwrap_err();
    assert!(
        err.contains("ConstraintSeeds")
            || err.contains("CrossProgramInvocation")
            || err.contains("InstructionError")
    );
}

#[test]
fn open_fails_with_invalid_need_pda() {
    let mut world = World::new();
    let args = SpecArgs::canonical(&world.config_data);
    let accounts = world.generation_accounts();

    let actor = world.actor.insecure_clone();
    world
        .send_as(world.register_ix(&args, accounts.clone()), &actor)
        .unwrap();

    let mut ix_open = world.open_ix(world.actor.pubkey(), args.spec_hash());

    // Modify Need PDA
    ix_open.accounts[2].pubkey = Pubkey::new_unique();

    let err = world.send_as(ix_open, &actor).unwrap_err();
    assert!(
        err.contains("ConstraintSeeds")
            || err.contains("CrossProgramInvocation")
            || err.contains("InstructionError")
    );
}
