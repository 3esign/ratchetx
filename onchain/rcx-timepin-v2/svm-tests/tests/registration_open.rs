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
    adapter: u8,
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
            adapter: 1,
            shard_id: 0,
            feed: FEED,
            target_grid_seconds: 300,
            receiver_slot: RECEIVER_GENERATION_SLOT,
            config_hash: hashv(&[config_data]),
            wormhole: wormhole_id(),
            wormhole_slot: WORMHOLE_GENERATION_SLOT,
        }
    }

    fn policy_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(134);
        out.extend_from_slice(&SCHEMA.to_le_bytes());
        out.push(self.adapter);
        out.extend_from_slice(receiver_id().as_ref());
        out.extend_from_slice(push_id().as_ref());
        out.extend_from_slice(&self.shard_id.to_le_bytes());
        out.extend_from_slice(&self.feed);
        out.push(1);
        out.extend_from_slice(&self.target_grid_seconds.to_le_bytes());
        out.extend_from_slice(&30u32.to_le_bytes());
        out.extend_from_slice(&3_600u32.to_le_bytes());
        out.extend_from_slice(&(if self.adapter == 2 { 0u32 } else { 120u32 }).to_le_bytes());
        out.extend_from_slice(&299u32.to_le_bytes());
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
fn exact_final_sbf_registers_and_opens_with_real_scale_loader_accounts() {
    let mut world = World::new();
    let args = SpecArgs::canonical(&world.config_data);
    let hash = args.spec_hash();
    let registration_cu = world
        .send(world.register_ix(&args, world.generation_accounts()))
        .unwrap();
    assert!(registration_cu > 0);

    let spec = world.svm.get_account(&spec_address(&hash).0).unwrap();
    assert_eq!(spec.owner, program_id());
    assert_eq!(spec.data.len(), 262);
    assert_eq!(&spec.data[..8], &discriminator("account", "EvidenceSpecV2"));
    assert_eq!(&spec.data[8..142], args.policy_bytes());
    assert_eq!(&spec.data[142..174], &args.policy_hash());
    assert_eq!(
        u64::from_le_bytes(spec.data[174..182].try_into().unwrap()),
        RECEIVER_GENERATION_SLOT
    );
    assert_eq!(&spec.data[182..214], &args.config_hash);
    assert_eq!(&spec.data[214..246], wormhole_id().as_ref());
    assert_eq!(
        u64::from_le_bytes(spec.data[246..254].try_into().unwrap()),
        WORMHOLE_GENERATION_SLOT
    );
    assert_eq!(
        u64::from_le_bytes(spec.data[254..262].try_into().unwrap()),
        REGISTERED_SLOT
    );

    let open_cu = world
        .send(world.open_ix(world.actor.pubkey(), hash))
        .unwrap();
    let (need_key, need_bump) = need_address(&hash, TARGET);
    let need = world.svm.get_account(&need_key).unwrap();
    assert_eq!(need.owner, program_id());
    assert_eq!(need.data.len(), 168);
    assert_eq!(&need.data[..8], &discriminator("account", "TimepinNeedV2"));
    assert_eq!(
        u16::from_le_bytes(need.data[8..10].try_into().unwrap()),
        SCHEMA
    );
    assert_eq!(need.data[10], need_bump);
    assert_eq!(need.data[11], 0);
    assert_eq!(&need.data[12..44], &hash);
    assert_eq!(
        i64::from_le_bytes(need.data[44..52].try_into().unwrap()),
        TARGET
    );
    assert_eq!(
        i64::from_le_bytes(need.data[52..60].try_into().unwrap()),
        TARGET + 299
    );
    assert_eq!(
        i64::from_le_bytes(need.data[60..68].try_into().unwrap()),
        TARGET + 359
    );
    assert_eq!(&need.data[68..132], &[0u8; 64]);
    assert_eq!(u32::from_le_bytes(need.data[132..136].try_into().unwrap()), 0);
    assert_eq!(&need.data[136..168], world.actor.pubkey().as_ref());

    let stranger = Keypair::new();
    world
        .svm
        .airdrop(&stranger.pubkey(), 1_000_000_000)
        .unwrap();
    world
        .send_as(world.open_ix(stranger.pubkey(), hash), &stranger)
        .unwrap();
    assert_eq!(world.svm.get_account(&need_key).unwrap().data, need.data);
    println!(
        "Timepin v2 large-account CU: register={registration_cu}, open={open_cu}; Receiver ProgramData={}B, Wormhole ProgramData={}B",
        RECEIVER_PROGRAMDATA_LEN, WORMHOLE_PROGRAMDATA_LEN
    );
    println!(
        "policy_hash={} spec_hash={} spec_pda={} need_pda={}",
        hex(&args.policy_hash()),
        hex(&hash),
        spec_address(&hash).0,
        need_key
    );
}

#[test]
fn registration_generation_mutants_fail_closed_and_roll_back() {
    let mut world = World::new();
    let canonical = SpecArgs::canonical(&world.config_data);
    let canonical_accounts = world.generation_accounts();

    let wrong_receiver_data = world.clone_programdata(receiver_id());
    let mut accounts = canonical_accounts;
    accounts.receiver_programdata = wrong_receiver_data;
    let error = world
        .send(world.register_ix(&canonical, accounts))
        .unwrap_err();
    assert!(error.contains("Receiver Program does not link"), "{error}");
    assert_no_spec(&world, &canonical);

    let mut receiver_slot = canonical.clone();
    receiver_slot.receiver_slot += 1;
    let error = world
        .send(world.register_ix(&receiver_slot, canonical_accounts))
        .unwrap_err();
    assert!(
        error.contains("Receiver ProgramData slot differs"),
        "{error}"
    );
    assert_no_spec(&world, &receiver_slot);

    let mut config_hash = canonical.clone();
    config_hash.config_hash[0] ^= 1;
    let error = world
        .send(world.register_ix(&config_hash, canonical_accounts))
        .unwrap_err();
    assert!(
        error.contains("full Receiver config account hash differs"),
        "{error}"
    );
    assert_no_spec(&world, &config_hash);

    let other_wormhole = Pubkey::new_from_array([9; 32]);
    let other_config = receiver_config_data(other_wormhole);
    world.set_config(other_config.clone());
    let mut configured_wormhole = canonical.clone();
    configured_wormhole.config_hash = hashv(&[&other_config]);
    let error = world
        .send(world.register_ix(&configured_wormhole, canonical_accounts))
        .unwrap_err();
    assert!(
        error.contains("Receiver config names a different Wormhole"),
        "{error}"
    );
    assert_no_spec(&world, &configured_wormhole);
    world.set_config(world.config_data.clone());

    let wrong_wormhole_data = world.clone_programdata(wormhole_id());
    let mut accounts = canonical_accounts;
    accounts.wormhole_programdata = wrong_wormhole_data;
    let error = world
        .send(world.register_ix(&canonical, accounts))
        .unwrap_err();
    assert!(error.contains("Wormhole Program does not link"), "{error}");
    assert_no_spec(&world, &canonical);

    let mut wormhole_slot = canonical.clone();
    wormhole_slot.wormhole_slot += 1;
    let error = world
        .send(world.register_ix(&wormhole_slot, canonical_accounts))
        .unwrap_err();
    assert!(
        error.contains("Wormhole ProgramData slot differs"),
        "{error}"
    );
    assert_no_spec(&world, &wormhole_slot);

    world.set_clock(NOW, WORMHOLE_GENERATION_SLOT);
    let error = world
        .send(world.register_ix(&canonical, canonical_accounts))
        .unwrap_err();
    assert!(
        error.contains("generation was not observed in a later Clock slot"),
        "{error}"
    );
    assert_no_spec(&world, &canonical);
}

#[test]
fn capture_reauthenticates_generation_and_enforces_post_registration_slot_bounds() {
    let mut world = World::new();
    let (_args, spec_hash) = world.register_and_open();
    let need = need_address(&spec_hash, TARGET).0;
    let opened_need = world.svm.get_account(&need).unwrap().data;
    world.set_clock(TARGET, CAPTURE_SLOT);
    let message_hash = world.put_price(REGISTERED_SLOT + 1);
    let candidate = candidate_address(&need, &message_hash).0;
    let accounts = world.generation_accounts();

    world.set_programdata_slot(receiver_id(), RECEIVER_GENERATION_SLOT + 1);
    let error = world
        .send(world.capture_first_ix(spec_hash, message_hash, accounts))
        .unwrap_err();
    assert!(
        error.contains("Receiver ProgramData slot differs"),
        "{error}"
    );
    assert!(world.svm.get_account(&candidate).is_none());
    assert_eq!(world.svm.get_account(&need).unwrap().data, opened_need);
    world.set_programdata_slot(receiver_id(), RECEIVER_GENERATION_SLOT);

    let mut changed_config = world.config_data.clone();
    *changed_config.last_mut().unwrap() ^= 1;
    world.set_config(changed_config);
    let error = world
        .send(world.capture_first_ix(spec_hash, message_hash, accounts))
        .unwrap_err();
    assert!(
        error.contains("full Receiver config account hash differs"),
        "{error}"
    );
    assert!(world.svm.get_account(&candidate).is_none());
    assert_eq!(world.svm.get_account(&need).unwrap().data, opened_need);
    world.set_config(world.config_data.clone());

    world.set_programdata_slot(wormhole_id(), WORMHOLE_GENERATION_SLOT + 1);
    let error = world
        .send(world.capture_first_ix(spec_hash, message_hash, accounts))
        .unwrap_err();
    assert!(
        error.contains("Wormhole ProgramData slot differs"),
        "{error}"
    );
    assert!(world.svm.get_account(&candidate).is_none());
    assert_eq!(world.svm.get_account(&need).unwrap().data, opened_need);
    world.set_programdata_slot(wormhole_id(), WORMHOLE_GENERATION_SLOT);

    world.put_price(REGISTERED_SLOT);
    let error = world
        .send(world.capture_first_ix(spec_hash, message_hash, accounts))
        .unwrap_err();
    assert!(
        error.contains("posted slot is not strictly after"),
        "{error}"
    );
    assert!(world.svm.get_account(&candidate).is_none());
    assert_eq!(world.svm.get_account(&need).unwrap().data, opened_need);

    world.put_price(CAPTURE_SLOT + 1);
    let error = world
        .send(world.capture_first_ix(spec_hash, message_hash, accounts))
        .unwrap_err();
    assert!(error.contains("posted slot is ahead"), "{error}");
    assert!(world.svm.get_account(&candidate).is_none());
    assert_eq!(world.svm.get_account(&need).unwrap().data, opened_need);

    world.put_price(REGISTERED_SLOT + 1);
    let capture_cu = world
        .send(world.capture_first_ix(spec_hash, message_hash, accounts))
        .unwrap();
    let captured = world.svm.get_account(&candidate).unwrap();
    assert_eq!(captured.owner, program_id());
    assert_eq!(captured.data.len(), 119);
    assert_eq!(
        &captured.data[..8],
        &discriminator("account", "CandidateV2")
    );
    assert_eq!(world.svm.get_account(&need).unwrap().data[11], 1);
    assert!(world.svm.get_account(&work_page_address(&need)).is_none());
    println!("Timepin v2 large-account capture CU: {capture_cu}");
}

#[test]
fn exact_live_mainnet_snapshot_registers_opens_and_captures() {
    // These are exact public mainnet account bytes fetched together at finalized
    // context slot 444,338,968. The simulated registration slot is deliberately
    // after both program generations but before the captured update. That proves
    // the Timepin ABI/generation checks locally; it is not a historical RPC proof
    // that this config snapshot already existed at the simulated earlier slot.
    let receiver_program = live_fixture(
        "receiver-program.bin",
        36,
        "ef37dd1cee22d731902a8c04ed2e13136a2b8aa7068d9db3aff2ed1ec7b634e5",
    );
    let receiver_programdata = live_fixture(
        "receiver-programdata.bin",
        416_909,
        "292d187cfc879f5b0f9dd061f76ea96ea4f8193a83d3de654652309769a57ecf",
    );
    let config = live_fixture(
        "receiver-config.bin",
        370,
        "e3abebb9b51d2bcde43e074278f41bd872dc9a536f35b02eb403b0dac1a7eec1",
    );
    let wormhole_program = live_fixture(
        "wormhole-program.bin",
        36,
        "1ee590ae23d5ecbf775aba910f06a993dee8f77bfd7028790dbd349651c8034b",
    );
    let wormhole_programdata = live_fixture(
        "wormhole-programdata.bin",
        656_005,
        "3b911964d5c74335cf81838f46903abd04ffd3fe7ed7bc2661add50fbf90d4b3",
    );
    let price_update = live_fixture(
        "sol-price-update.bin",
        134,
        "a025626ee7f74a5777b703dc9c62d4f2ed15422959f88c616d4012f216004070",
    );

    let receiver_programdata_key = programdata_address(&receiver_id());
    let live_wormhole = live_wormhole_id();
    let wormhole_programdata_key = programdata_address(&live_wormhole);
    assert_eq!(&receiver_program[..4], &2u32.to_le_bytes());
    assert_eq!(&receiver_program[4..36], receiver_programdata_key.as_ref());
    assert_eq!(&receiver_programdata[..4], &3u32.to_le_bytes());
    assert_eq!(
        u64::from_le_bytes(receiver_programdata[4..12].try_into().unwrap()),
        LIVE_RECEIVER_SLOT
    );
    assert_eq!(receiver_programdata[12], 1);
    assert_eq!(&wormhole_program[..4], &2u32.to_le_bytes());
    assert_eq!(&wormhole_program[4..36], wormhole_programdata_key.as_ref());
    assert_eq!(&wormhole_programdata[..4], &3u32.to_le_bytes());
    assert_eq!(
        u64::from_le_bytes(wormhole_programdata[4..12].try_into().unwrap()),
        LIVE_WORMHOLE_SLOT
    );
    assert_eq!(wormhole_programdata[12], 1);

    assert_eq!(&config[..8], &discriminator("account", "Config"));
    let mut config_offset = 40;
    let target_authority_tag = config[config_offset];
    config_offset += 1;
    assert!(target_authority_tag <= 1);
    if target_authority_tag == 1 {
        config_offset += 32;
    }
    assert_eq!(
        &config[config_offset..config_offset + 32],
        live_wormhole.as_ref()
    );

    let source = source_address_for(0, &LIVE_SOL_FEED);
    assert_eq!(
        source,
        Pubkey::from_str("7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE").unwrap()
    );
    assert_eq!(
        &price_update[..8],
        &discriminator("account", "PriceUpdateV2")
    );
    assert_eq!(&price_update[8..40], source.as_ref());
    assert_eq!(price_update[40], 1);
    assert_eq!(&price_update[41..73], &LIVE_SOL_FEED);
    let price = i64::from_le_bytes(price_update[73..81].try_into().unwrap());
    let conf = u64::from_le_bytes(price_update[81..89].try_into().unwrap());
    let exponent = i32::from_le_bytes(price_update[89..93].try_into().unwrap());
    let publish_time = i64::from_le_bytes(price_update[93..101].try_into().unwrap());
    let prev_publish_time = i64::from_le_bytes(price_update[101..109].try_into().unwrap());
    let ema_price = i64::from_le_bytes(price_update[109..117].try_into().unwrap());
    let ema_conf = u64::from_le_bytes(price_update[117..125].try_into().unwrap());
    let posted_slot = u64::from_le_bytes(price_update[125..133].try_into().unwrap());
    assert_eq!(publish_time, LIVE_PRICE_PUBLISH_TS);
    assert_eq!(posted_slot, LIVE_PRICE_POSTED_SLOT);
    assert_eq!(price_update[133], 0);
    assert_eq!(prev_publish_time, publish_time - 1);
    assert!(posted_slot <= LIVE_SNAPSHOT_SLOT);

    // Preserve the exact public price bytes and exercise the mainnet MIN-CAPTURE
    // policy: this print belongs to its 300-second target with lag 299.
    let target = publish_time.div_euclid(300) * 300;
    let registration_slot = LIVE_RECEIVER_SLOT.max(LIVE_WORMHOLE_SLOT) + 1;
    assert!(registration_slot < posted_slot);
    let args = SpecArgs {
        adapter: 2,
        shard_id: 0,
        feed: LIVE_SOL_FEED,
        target_grid_seconds: 300,
        receiver_slot: LIVE_RECEIVER_SLOT,
        config_hash: hashv(&[&config]),
        wormhole: live_wormhole,
        wormhole_slot: LIVE_WORMHOLE_SLOT,
    };
    let spec_hash = args.spec_hash();
    let spec = spec_address(&spec_hash).0;
    let need = need_address(&spec_hash, target).0;
    let message_hash = hashv(&[
        b"rcx-timepin:pyth-price-message:v2\0",
        &LIVE_SOL_FEED,
        &price.to_le_bytes(),
        &conf.to_le_bytes(),
        &exponent.to_le_bytes(),
        &publish_time.to_le_bytes(),
        &prev_publish_time.to_le_bytes(),
        &ema_price.to_le_bytes(),
        &ema_conf.to_le_bytes(),
    ]);
    let candidate = candidate_address(&need, &message_hash).0;

    let sbf = pinned_sbf();
    let mut svm = LiteSVM::new();
    svm.add_program(program_id(), &sbf)
        .expect("install hash-pinned Timepin v2");
    for (key, account) in [
        (
            receiver_id(),
            Account {
                lamports: 1_141_440,
                data: receiver_program,
                owner: loader_v3(),
                executable: true,
                rent_epoch: u64::MAX,
            },
        ),
        (
            receiver_programdata_key,
            Account {
                lamports: 2_902_577_520,
                data: receiver_programdata,
                owner: loader_v3(),
                executable: false,
                rent_epoch: u64::MAX,
            },
        ),
        (
            receiver_config_address(),
            Account {
                lamports: 3_466_080,
                data: config,
                owner: receiver_id(),
                executable: false,
                rent_epoch: u64::MAX,
            },
        ),
        (
            live_wormhole,
            Account {
                lamports: 1_141_440,
                data: wormhole_program,
                owner: loader_v3(),
                executable: true,
                rent_epoch: u64::MAX,
            },
        ),
        (
            wormhole_programdata_key,
            Account {
                lamports: 4_566_685_680,
                data: wormhole_programdata,
                owner: loader_v3(),
                executable: false,
                rent_epoch: u64::MAX,
            },
        ),
        (
            source,
            Account {
                lamports: 1_823_520,
                data: price_update,
                owner: receiver_id(),
                executable: false,
                rent_epoch: u64::MAX,
            },
        ),
    ] {
        svm.set_account(key, account).unwrap();
    }

    let actor = Keypair::new();
    svm.airdrop(&actor.pubkey(), 20_000_000_000).unwrap();
    svm.set_sysvar(&Clock {
        slot: registration_slot,
        epoch_start_timestamp: target - 1_000,
        epoch: 1,
        leader_schedule_epoch: 1,
        unix_timestamp: target - 30,
    });
    let mut register_data = discriminator("global", "register_evidence_spec").to_vec();
    register_data.extend_from_slice(&spec_hash);
    register_data.extend_from_slice(&args.canonical_bytes());
    let register_cu = send_instruction(
        &mut svm,
        Instruction {
            program_id: program_id(),
            accounts: vec![
                AccountMeta::new(actor.pubkey(), true),
                AccountMeta::new(spec, false),
                AccountMeta::new_readonly(receiver_id(), false),
                AccountMeta::new_readonly(receiver_programdata_key, false),
                AccountMeta::new_readonly(receiver_config_address(), false),
                AccountMeta::new_readonly(live_wormhole, false),
                AccountMeta::new_readonly(wormhole_programdata_key, false),
                AccountMeta::new_readonly(system_program(), false),
            ],
            data: register_data,
        },
        &actor,
    )
    .unwrap();
    let registered = svm.get_account(&spec).unwrap();
    assert_eq!(registered.data.len(), 262);
    assert_eq!(
        u64::from_le_bytes(registered.data[254..262].try_into().unwrap()),
        registration_slot
    );

    let mut open_data = discriminator("global", "open_need").to_vec();
    open_data.extend_from_slice(&spec_hash);
    open_data.extend_from_slice(&target.to_le_bytes());
    let open_cu = send_instruction(
        &mut svm,
        Instruction {
            program_id: program_id(),
            accounts: vec![
                AccountMeta::new(actor.pubkey(), true),
                AccountMeta::new_readonly(spec, false),
                AccountMeta::new(need, false),
                AccountMeta::new_readonly(system_program(), false),
            ],
            data: open_data,
        },
        &actor,
    )
    .unwrap();
    assert_eq!(svm.get_account(&need).unwrap().data[11], 0);

    svm.set_sysvar(&Clock {
        slot: LIVE_SNAPSHOT_SLOT,
        epoch_start_timestamp: target - 1_000,
        epoch: 1,
        leader_schedule_epoch: 1,
        unix_timestamp: publish_time,
    });
    let mut capture_data = discriminator("global", "capture_first").to_vec();
    capture_data.extend_from_slice(&message_hash);
    let capture_cu = send_instruction(
        &mut svm,
        Instruction {
            program_id: program_id(),
            accounts: vec![
                AccountMeta::new(actor.pubkey(), true),
                AccountMeta::new_readonly(spec, false),
                AccountMeta::new(need, false),
                AccountMeta::new(candidate, false),
                AccountMeta::new_readonly(receiver_id(), false),
                AccountMeta::new_readonly(receiver_programdata_key, false),
                AccountMeta::new_readonly(receiver_config_address(), false),
                AccountMeta::new_readonly(live_wormhole, false),
                AccountMeta::new_readonly(wormhole_programdata_key, false),
                AccountMeta::new_readonly(source, false),
                AccountMeta::new(work_page_address(&need), false),
                AccountMeta::new_readonly(system_program(), false),
            ],
            data: capture_data,
        },
        &actor,
    )
    .unwrap();
    let need_data = svm.get_account(&need).unwrap().data;
    let candidate_data = svm.get_account(&candidate).unwrap().data;
    assert_eq!(need_data[11], 1);
    assert_eq!(&need_data[68..100], &message_hash);
    assert_eq!(candidate_data.len(), 119);
    assert_eq!(
        &candidate_data[..8],
        &discriminator("account", "CandidateV2")
    );
    assert_eq!(&candidate_data[11..43], need.as_ref());
    assert_eq!(
        u64::from_le_bytes(candidate_data[95..103].try_into().unwrap()),
        posted_slot
    );
    assert_eq!(
        u64::from_le_bytes(candidate_data[103..111].try_into().unwrap()),
        LIVE_SNAPSHOT_SLOT
    );
    assert!(svm.get_account(&work_page_address(&need)).is_none());
    println!(
        "live mainnet snapshot slot={LIVE_SNAPSHOT_SLOT}: register={register_cu} CU, open={open_cu} CU, capture={capture_cu} CU; Receiver PD=416909B@{LIVE_RECEIVER_SLOT}, configured Wormhole PD=656005B@{LIVE_WORMHOLE_SLOT}, PriceUpdate posted={posted_slot}"
    );
}
