use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use litesvm::LiteSVM;
use serde_json::Value;
use sha2::{Digest, Sha256};
use solana_sdk::{
    account::Account,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use spl_token_2022_interface::{
    extension::{
        memo_transfer::{memo_required, MemoTransfer},
        BaseStateWithExtensions, BaseStateWithExtensionsMut, ExtensionType, StateWithExtensions,
        StateWithExtensionsMut,
    },
    state::{Account as TokenAccount, AccountState, Mint},
};
use std::{path::PathBuf, str::FromStr};

const UNIT: u64 = 1_000_000;
const RCX_SUPPLY: u64 = 936_699_884_132_132;
const SCHEMA_VERSION: u16 = 2;
const MANIFEST_SCHEMA_VERSION: u16 = 1;
const COMPLETION_SCHEMA_VERSION: u16 = 1;
const WORK_KIND: u8 = 4;
const LOCATOR_SLOT: u8 = 0;
const SUBJECT_SCHEMA: u16 = 7;
const SUBJECT_LEN: usize = 64;
const LOCATOR_SCHEMA: u16 = 2;
const RECORDS_OFFSET: usize = 87;
const WORK_RECORD_LEN: usize = 106;
const LOCATOR_CAPACITY: u8 = 48;
const VOUCHER_LEN: usize = 246;

fn work_market_program() -> Pubkey {
    Pubkey::from_str("gBxS1f6uyyGPuW5MzGBukidSb71jdsCb5fZaoSzULE5").unwrap()
}

fn completion_program() -> Pubkey {
    Pubkey::new_from_array([41; 32])
}

fn subject() -> Pubkey {
    Pubkey::new_from_array([42; 32])
}

fn locator() -> Pubkey {
    Pubkey::new_from_array([43; 32])
}

fn rcx_mint() -> Pubkey {
    Pubkey::from_str("FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump").unwrap()
}

fn token_2022() -> Pubkey {
    Pubkey::from_str("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb").unwrap()
}

fn memo_program() -> Pubkey {
    Pubkey::from_str("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr").unwrap()
}

fn wrong_memo_program() -> Pubkey {
    Pubkey::from_str("Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo").unwrap()
}

fn loader_v3() -> Pubkey {
    Pubkey::from_str("BPFLoaderUpgradeab1e11111111111111111111111").unwrap()
}

fn system_program() -> Pubkey {
    Pubkey::from_str("11111111111111111111111111111111").unwrap()
}

fn discriminator(kind: &str, name: &str) -> [u8; 8] {
    Sha256::digest(format!("{kind}:{name}").as_bytes())[..8]
        .try_into()
        .unwrap()
}

fn sbf_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("target")
        .join("deploy")
        .join("ratchet_work_market_v2.so")
}

fn programdata_address(program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[program.as_ref()], &loader_v3()).0
}

fn work_manifest_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            b"work_manifest",
            &MANIFEST_SCHEMA_VERSION.to_le_bytes(),
            &[WORK_KIND],
        ],
        &completion_program(),
    )
}

fn voucher_pda(sponsor: &Pubkey, nonce: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"voucher",
            &SCHEMA_VERSION.to_le_bytes(),
            completion_program().as_ref(),
            subject().as_ref(),
            &[WORK_KIND],
            sponsor.as_ref(),
            &nonce.to_le_bytes(),
        ],
        &work_market_program(),
    )
    .0
}

fn vault_pda(voucher: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"vault", voucher.as_ref()], &work_market_program()).0
}

fn token_address(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"memo-token", owner.as_ref()], &work_market_program()).0
}

fn fixture() -> (Value, Vec<u8>) {
    let json: Value =
        serde_json::from_str(include_str!("../fixtures/rcx-mainnet-mint-2026-09-04.json")).unwrap();
    let data = BASE64.decode(json["dataBase64"].as_str().unwrap()).unwrap();
    (json, data)
}

fn subject_data() -> Vec<u8> {
    let mut data = vec![0u8; SUBJECT_LEN];
    data[..8].copy_from_slice(&discriminator("account", "MockSubject"));
    data[8..10].copy_from_slice(&SUBJECT_SCHEMA.to_le_bytes());
    data
}

fn manifest_data() -> Vec<u8> {
    let (_, bump) = work_manifest_pda();
    let mut data = discriminator("account", "WorkManifest").to_vec();
    data.extend_from_slice(&MANIFEST_SCHEMA_VERSION.to_le_bytes());
    data.push(bump);
    data.push(WORK_KIND);
    data.extend_from_slice(&COMPLETION_SCHEMA_VERSION.to_le_bytes());
    data.push(2);
    data.extend_from_slice(&SUBJECT_SCHEMA.to_le_bytes());
    data.extend_from_slice(&(SUBJECT_LEN as u16).to_le_bytes());
    data.extend_from_slice(&discriminator("account", "MockSubject"));
    data.extend_from_slice(&LOCATOR_SCHEMA.to_le_bytes());
    data.extend_from_slice(&discriminator("account", "MockWorkPage"));
    data.extend_from_slice(&(RECORDS_OFFSET as u16).to_le_bytes());
    data.extend_from_slice(&(WORK_RECORD_LEN as u16).to_le_bytes());
    data.push(LOCATOR_CAPACITY);
    assert_eq!(data.len(), 42);
    data
}

fn packed_locator_data(
    record_subject: Pubkey,
    disposition: u8,
    worker: Pubkey,
    result_hash: [u8; 32],
    completed_slot: u64,
) -> Vec<u8> {
    let mut data = vec![0u8; RECORDS_OFFSET];
    data[..8].copy_from_slice(&discriminator("account", "MockWorkPage"));
    data[8..10].copy_from_slice(&LOCATOR_SCHEMA.to_le_bytes());
    data[RECORDS_OFFSET - 4..RECORDS_OFFSET].copy_from_slice(&1u32.to_le_bytes());
    data.extend_from_slice(record_subject.as_ref());
    data.push(WORK_KIND);
    data.push(disposition);
    data.extend_from_slice(worker.as_ref());
    data.extend_from_slice(&result_hash);
    data.extend_from_slice(&completed_slot.to_le_bytes());
    assert_eq!(data.len(), RECORDS_OFFSET + WORK_RECORD_LEN);
    data
}

#[derive(Debug, PartialEq, Eq)]
struct VoucherView {
    state: u8,
    work_kind: u8,
    completion_program: Pubkey,
    subject: Pubkey,
    completion_locator: Pubkey,
    locator_slot: u8,
    sponsor: Pubkey,
    nonce: u64,
    funded_amount: u64,
    settled_amount: u64,
    beneficiary: Pubkey,
    result_hash: [u8; 32],
}

impl VoucherView {
    fn parse(data: &[u8]) -> Self {
        assert_eq!(data.len(), VOUCHER_LEN);
        assert_eq!(&data[..8], &discriminator("account", "Voucher"));
        assert_eq!(u16::from_le_bytes(data[8..10].try_into().unwrap()), 2);
        Self {
            state: data[11],
            work_kind: data[12],
            completion_program: Pubkey::new_from_array(data[13..45].try_into().unwrap()),
            subject: Pubkey::new_from_array(data[45..77].try_into().unwrap()),
            completion_locator: Pubkey::new_from_array(data[77..109].try_into().unwrap()),
            locator_slot: data[109],
            sponsor: Pubkey::new_from_array(data[110..142].try_into().unwrap()),
            nonce: u64::from_le_bytes(data[142..150].try_into().unwrap()),
            funded_amount: u64::from_le_bytes(data[150..158].try_into().unwrap()),
            settled_amount: u64::from_le_bytes(data[158..166].try_into().unwrap()),
            beneficiary: Pubkey::new_from_array(data[182..214].try_into().unwrap()),
            result_hash: data[214..246].try_into().unwrap(),
        }
    }
}

#[derive(Clone, Copy)]
enum MemoAccount {
    Canonical,
    Wrong,
    Missing,
}

struct World {
    svm: LiteSVM,
    sbf_bytes: Vec<u8>,
}

impl World {
    fn new() -> Self {
        let bytes = std::fs::read(sbf_path()).expect("build exact Work Market v2 SBF first");
        assert_eq!(&bytes[..4], b"\x7fELF");

        let mut svm = LiteSVM::new();
        svm.add_program(work_market_program(), &bytes)
            .expect("load exact Work Market v2 SBF");
        svm.add_program(completion_program(), &bytes)
            .expect("install a frozen executable mock producer boundary");

        for program in [token_2022(), memo_program(), wrong_memo_program()] {
            let account = svm
                .get_account(&program)
                .expect("bundled processor account");
            assert!(account.executable, "{program} must be executable");
        }
        Self::assert_exact_frozen_sbf(&svm, work_market_program(), &bytes);
        Self::assert_exact_frozen_sbf(&svm, completion_program(), &bytes);

        let (json, mint_data) = fixture();
        assert_eq!(json["contextSlot"].as_u64(), Some(444_123_919));
        assert_eq!(mint_data.len(), 409);
        svm.set_account(
            rcx_mint(),
            Account {
                lamports: json["lamports"].as_u64().unwrap(),
                data: mint_data,
                owner: token_2022(),
                executable: false,
                rent_epoch: u64::MAX,
            },
        )
        .unwrap();
        svm.set_account(
            subject(),
            Account {
                lamports: 10_000_000,
                data: subject_data(),
                owner: completion_program(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
        svm.set_account(
            work_manifest_pda().0,
            Account {
                lamports: 10_000_000,
                data: manifest_data(),
                owner: completion_program(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
        svm.set_account(
            locator(),
            Account {
                lamports: 10_000_000,
                data: packed_locator_data(subject(), 0, Pubkey::default(), [0; 32], 0),
                owner: completion_program(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

        Self {
            svm,
            sbf_bytes: bytes,
        }
    }

    fn assert_exact_frozen_sbf(svm: &LiteSVM, program: Pubkey, bytes: &[u8]) {
        let programdata = programdata_address(&program);
        let program_account = svm.get_account(&program).expect("program account");
        assert!(program_account.executable);
        assert_eq!(program_account.owner, loader_v3());
        assert_eq!(&program_account.data[..4], &2u32.to_le_bytes());
        assert_eq!(&program_account.data[4..36], programdata.as_ref());

        let data_account = svm.get_account(&programdata).expect("ProgramData account");
        assert!(!data_account.executable);
        assert_eq!(data_account.owner, loader_v3());
        assert_eq!(&data_account.data[..4], &3u32.to_le_bytes());
        assert_eq!(data_account.data[12], 0, "upgrade authority must be None");
        assert_eq!(&data_account.data[45..], bytes);
    }

    fn actor(&mut self) -> Keypair {
        let actor = Keypair::new();
        self.svm.airdrop(&actor.pubkey(), 20_000_000_000).unwrap();
        actor
    }

    fn wallet(&mut self, whole_rcx: u64) -> Keypair {
        let wallet = self.actor();
        self.set_memo_token(wallet.pubkey(), whole_rcx * UNIT);
        wallet
    }

    fn set_memo_token(&mut self, owner: Pubkey, amount: u64) {
        let account_len = ExtensionType::try_calculate_account_len::<TokenAccount>(&[
            ExtensionType::MemoTransfer,
        ])
        .unwrap();
        let mut data = vec![0u8; account_len];
        {
            let mut state =
                StateWithExtensionsMut::<TokenAccount>::unpack_uninitialized(&mut data).unwrap();
            let extension = state.init_extension::<MemoTransfer>(true).unwrap();
            extension.require_incoming_transfer_memos = true.into();
            state.base.mint = rcx_mint();
            state.base.owner = owner;
            state.base.amount = amount;
            state.base.delegate = None.into();
            state.base.state = AccountState::Initialized;
            state.base.is_native = None.into();
            state.base.delegated_amount = 0;
            state.base.close_authority = None.into();
            state.pack_base();
            state.init_account_type().unwrap();
        }
        let parsed = StateWithExtensions::<TokenAccount>::unpack(&data).unwrap();
        assert!(memo_required(&parsed));
        assert_eq!(
            parsed.get_extension_types().unwrap(),
            vec![ExtensionType::MemoTransfer]
        );
        self.svm
            .set_account(
                token_address(&owner),
                Account {
                    lamports: 10_000_000,
                    data,
                    owner: token_2022(),
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
    }

    fn balance(&self, address: Pubkey) -> u64 {
        let account = self.svm.get_account(&address).expect("token account");
        StateWithExtensions::<TokenAccount>::unpack(&account.data)
            .unwrap()
            .base
            .amount
    }

    fn token_requires_memo(&self, address: Pubkey) -> bool {
        let account = self.svm.get_account(&address).expect("token account");
        let state = StateWithExtensions::<TokenAccount>::unpack(&account.data).unwrap();
        memo_required(&state)
    }

    fn set_locator(
        &mut self,
        record_subject: Pubkey,
        disposition: u8,
        worker: Pubkey,
        result_hash: [u8; 32],
        completed_slot: u64,
    ) {
        self.svm
            .set_account(
                locator(),
                Account {
                    lamports: 10_000_000,
                    data: packed_locator_data(
                        record_subject,
                        disposition,
                        worker,
                        result_hash,
                        completed_slot,
                    ),
                    owner: completion_program(),
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
    }

    fn instruction(&self, name: &str, args: Vec<u8>, accounts: Vec<AccountMeta>) -> Instruction {
        let mut data = discriminator("global", name).to_vec();
        data.extend_from_slice(&args);
        Instruction {
            program_id: work_market_program(),
            accounts,
            data,
        }
    }

    fn send(&mut self, ix: Instruction, signers: &[&Keypair]) -> Result<Vec<String>, String> {
        let payer = signers[0];
        self.svm.expire_blockhash();
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&payer.pubkey()),
            signers,
            self.svm.latest_blockhash(),
        );
        self.svm
            .send_transaction(tx)
            .map(|metadata| metadata.logs)
            .map_err(|error| format!("{}\n{:?}", error.meta.logs.join("\n"), error.err))
    }

    fn fund(&mut self, sponsor: &Keypair, nonce: u64, amount: u64) -> Result<Vec<String>, String> {
        let voucher = voucher_pda(&sponsor.pubkey(), nonce);
        let mut args = nonce.to_le_bytes().to_vec();
        args.push(WORK_KIND);
        args.push(LOCATOR_SLOT);
        args.extend_from_slice(&amount.to_le_bytes());
        let ix = self.instruction(
            "fund_rcx_voucher",
            args,
            vec![
                AccountMeta::new(sponsor.pubkey(), true),
                AccountMeta::new_readonly(subject(), false),
                AccountMeta::new_readonly(locator(), false),
                AccountMeta::new_readonly(completion_program(), false),
                AccountMeta::new_readonly(programdata_address(&completion_program()), false),
                AccountMeta::new_readonly(work_manifest_pda().0, false),
                AccountMeta::new(voucher, false),
                AccountMeta::new(vault_pda(&voucher), false),
                AccountMeta::new(rcx_mint(), false),
                AccountMeta::new(token_address(&sponsor.pubkey()), false),
                AccountMeta::new_readonly(token_2022(), false),
                AccountMeta::new_readonly(system_program(), false),
            ],
        );
        self.send(ix, &[sponsor])
    }

    fn claim(
        &mut self,
        actor: &Keypair,
        sponsor: &Pubkey,
        worker: &Pubkey,
        nonce: u64,
        memo: MemoAccount,
        locator_override: Option<Pubkey>,
    ) -> Result<Vec<String>, String> {
        let voucher = voucher_pda(sponsor, nonce);
        let mut accounts = vec![
            AccountMeta::new_readonly(actor.pubkey(), true),
            AccountMeta::new(voucher, false),
            AccountMeta::new(vault_pda(&voucher), false),
            AccountMeta::new_readonly(rcx_mint(), false),
            AccountMeta::new_readonly(*worker, false),
            AccountMeta::new(token_address(worker), false),
            AccountMeta::new_readonly(work_manifest_pda().0, false),
            AccountMeta::new_readonly(locator_override.unwrap_or_else(locator), false),
            AccountMeta::new(*sponsor, false),
            AccountMeta::new_readonly(token_2022(), false),
        ];
        match memo {
            MemoAccount::Canonical => {
                accounts.push(AccountMeta::new_readonly(memo_program(), false))
            }
            MemoAccount::Wrong => {
                accounts.push(AccountMeta::new_readonly(wrong_memo_program(), false))
            }
            MemoAccount::Missing => {}
        }
        let ix = self.instruction("claim_rcx_voucher", Vec::new(), accounts);
        self.send(ix, &[actor])
    }

    fn refund(
        &mut self,
        actor: &Keypair,
        sponsor: &Pubkey,
        nonce: u64,
        memo: MemoAccount,
    ) -> Result<Vec<String>, String> {
        let voucher = voucher_pda(sponsor, nonce);
        let mut accounts = vec![
            AccountMeta::new_readonly(actor.pubkey(), true),
            AccountMeta::new(voucher, false),
            AccountMeta::new(vault_pda(&voucher), false),
            AccountMeta::new_readonly(rcx_mint(), false),
            AccountMeta::new_readonly(work_manifest_pda().0, false),
            AccountMeta::new_readonly(locator(), false),
            AccountMeta::new(*sponsor, false),
            AccountMeta::new(token_address(sponsor), false),
            AccountMeta::new_readonly(token_2022(), false),
        ];
        match memo {
            MemoAccount::Canonical => {
                accounts.push(AccountMeta::new_readonly(memo_program(), false))
            }
            MemoAccount::Wrong => {
                accounts.push(AccountMeta::new_readonly(wrong_memo_program(), false))
            }
            MemoAccount::Missing => {}
        }
        let ix = self.instruction("refund_rcx_voucher", Vec::new(), accounts);
        self.send(ix, &[actor])
    }

    fn voucher(&self, sponsor: &Pubkey, nonce: u64) -> VoucherView {
        VoucherView::parse(
            &self
                .svm
                .get_account(&voucher_pda(sponsor, nonce))
                .expect("voucher")
                .data,
        )
    }
}

fn logs_invoke(logs: &[String], program: Pubkey) -> bool {
    logs.iter()
        .any(|line| line.contains(&program.to_string()) && line.contains("invoke"))
}

fn assert_funded_state_unchanged(
    world: &World,
    sponsor: &Pubkey,
    worker: &Pubkey,
    nonce: u64,
    expected_voucher_data: &[u8],
    expected_vault_balance: u64,
    expected_worker_balance: u64,
) {
    let voucher = voucher_pda(sponsor, nonce);
    let vault = vault_pda(&voucher);
    assert_eq!(
        world.svm.get_account(&voucher).unwrap().data,
        expected_voucher_data
    );
    assert_eq!(world.balance(vault), expected_vault_balance);
    assert_eq!(
        world.balance(token_address(worker)),
        expected_worker_balance
    );
    assert_eq!(world.voucher(sponsor, nonce).state, 0);
}

#[test]
fn exact_sbf_frozen_programdata_and_real_rcx_fixture_are_positive_controls() {
    let mut world = World::new();
    let digest = Sha256::digest(&world.sbf_bytes);
    assert_ne!(digest.as_slice(), &[0u8; 32]);
    eprintln!(
        "ratchet_work_market_v2.so sha256={}",
        digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    );

    let mint_account = world.svm.get_account(&rcx_mint()).unwrap();
    assert_eq!(mint_account.owner, token_2022());
    assert_eq!(mint_account.data.len(), 409);
    let mint = StateWithExtensions::<Mint>::unpack(&mint_account.data).unwrap();
    assert_eq!(mint.base.supply, RCX_SUPPLY);
    assert_eq!(mint.base.decimals, 6);
    assert!(mint.base.mint_authority.is_none());
    assert!(mint.base.freeze_authority.is_none());
    assert_eq!(
        mint.get_extension_types().unwrap(),
        vec![ExtensionType::MetadataPointer, ExtensionType::TokenMetadata]
    );

    let wallet = world.wallet(1);
    assert!(world.token_requires_memo(token_address(&wallet.pubkey())));
    World::assert_exact_frozen_sbf(&world.svm, work_market_program(), &world.sbf_bytes);
    World::assert_exact_frozen_sbf(&world.svm, completion_program(), &world.sbf_bytes);
}

#[test]
fn packed_pending_fund_then_payable_claim_memos_transfers_and_closes_vault() {
    let mut world = World::new();
    let sponsor = world.wallet(100);
    let worker = world.wallet(0);
    let actor = world.actor();
    let nonce = 11;
    let amount = 25 * UNIT;
    let voucher = voucher_pda(&sponsor.pubkey(), nonce);
    let vault = vault_pda(&voucher);

    let fund_logs = world.fund(&sponsor, nonce, amount).unwrap();
    assert!(logs_invoke(&fund_logs, token_2022()));
    assert_eq!(world.balance(token_address(&sponsor.pubkey())), 75 * UNIT);
    assert_eq!(world.balance(vault), amount);
    let funded = world.voucher(&sponsor.pubkey(), nonce);
    assert_eq!(funded.state, 0);
    assert_eq!(funded.work_kind, WORK_KIND);
    assert_eq!(funded.completion_program, completion_program());
    assert_eq!(funded.subject, subject());
    assert_eq!(funded.completion_locator, locator());
    assert_eq!(funded.locator_slot, LOCATOR_SLOT);
    assert_eq!(funded.sponsor, sponsor.pubkey());
    assert_eq!(funded.nonce, nonce);
    assert_eq!(funded.funded_amount, amount);

    let result_hash = [9u8; 32];
    world.set_locator(subject(), 1, worker.pubkey(), result_hash, 44_412_391);
    assert!(world.token_requires_memo(token_address(&worker.pubkey())));
    let sponsor_lamports_before = world.svm.get_balance(&sponsor.pubkey()).unwrap();
    let claim_logs = world
        .claim(
            &actor,
            &sponsor.pubkey(),
            &worker.pubkey(),
            nonce,
            MemoAccount::Canonical,
            None,
        )
        .unwrap();
    assert!(logs_invoke(&claim_logs, memo_program()));
    assert!(logs_invoke(&claim_logs, token_2022()));
    assert_eq!(world.balance(token_address(&worker.pubkey())), amount);
    assert!(world.svm.get_account(&vault).is_none());
    assert!(
        world.svm.get_balance(&sponsor.pubkey()).unwrap() > sponsor_lamports_before,
        "Token-2022 vault rent returns to the fixed sponsor"
    );

    let paid = world.voucher(&sponsor.pubkey(), nonce);
    assert_eq!(paid.state, 1);
    assert_eq!(paid.settled_amount, amount);
    assert_eq!(paid.beneficiary, worker.pubkey());
    assert_eq!(paid.result_hash, result_hash);
}

#[test]
fn packed_pending_fund_then_nonpayable_refund_memos_transfers_and_closes_vault() {
    let mut world = World::new();
    let sponsor = world.wallet(100);
    let actor = world.actor();
    let nonce = 12;
    let amount = 20 * UNIT;
    let voucher = voucher_pda(&sponsor.pubkey(), nonce);
    let vault = vault_pda(&voucher);

    world.fund(&sponsor, nonce, amount).unwrap();
    assert_eq!(world.balance(token_address(&sponsor.pubkey())), 80 * UNIT);
    assert!(world.token_requires_memo(token_address(&sponsor.pubkey())));
    let result_hash = [7u8; 32];
    world.set_locator(subject(), 2, Pubkey::default(), result_hash, 44_412_392);
    let sponsor_lamports_before = world.svm.get_balance(&sponsor.pubkey()).unwrap();
    let refund_logs = world
        .refund(&actor, &sponsor.pubkey(), nonce, MemoAccount::Canonical)
        .unwrap();
    assert!(logs_invoke(&refund_logs, memo_program()));
    assert!(logs_invoke(&refund_logs, token_2022()));
    assert_eq!(world.balance(token_address(&sponsor.pubkey())), 100 * UNIT);
    assert!(world.svm.get_account(&vault).is_none());
    assert!(world.svm.get_balance(&sponsor.pubkey()).unwrap() > sponsor_lamports_before);

    let refunded = world.voucher(&sponsor.pubkey(), nonce);
    assert_eq!(refunded.state, 2);
    assert_eq!(refunded.settled_amount, amount);
    assert_eq!(refunded.beneficiary, sponsor.pubkey());
    assert_eq!(refunded.result_hash, result_hash);
}

#[test]
fn wrong_and_missing_memo_programs_fail_atomically_before_outbound_value_moves() {
    let mut world = World::new();
    let sponsor = world.wallet(100);
    let worker = world.wallet(0);
    let actor = world.actor();
    let nonce = 13;
    let amount = 13 * UNIT;
    let voucher = voucher_pda(&sponsor.pubkey(), nonce);
    let vault = vault_pda(&voucher);

    world.fund(&sponsor, nonce, amount).unwrap();
    world.set_locator(subject(), 1, worker.pubkey(), [5u8; 32], 44_412_393);
    let voucher_before = world.svm.get_account(&voucher).unwrap().data;
    let worker_before = world.balance(token_address(&worker.pubkey()));

    let wrong_error = world
        .claim(
            &actor,
            &sponsor.pubkey(),
            &worker.pubkey(),
            nonce,
            MemoAccount::Wrong,
            None,
        )
        .expect_err("wrong Memo program must fail");
    assert!(
        wrong_error.contains("InvalidProgramId")
            || wrong_error.contains("only the canonical SPL Memo program is accepted"),
        "unexpected wrong-memo failure: {wrong_error}"
    );
    assert_funded_state_unchanged(
        &world,
        &sponsor.pubkey(),
        &worker.pubkey(),
        nonce,
        &voucher_before,
        amount,
        worker_before,
    );

    world
        .claim(
            &actor,
            &sponsor.pubkey(),
            &worker.pubkey(),
            nonce,
            MemoAccount::Missing,
            None,
        )
        .expect_err("missing Memo account must fail");
    assert_funded_state_unchanged(
        &world,
        &sponsor.pubkey(),
        &worker.pubkey(),
        nonce,
        &voucher_before,
        amount,
        worker_before,
    );

    let logs = world
        .claim(
            &actor,
            &sponsor.pubkey(),
            &worker.pubkey(),
            nonce,
            MemoAccount::Canonical,
            None,
        )
        .unwrap();
    assert!(logs_invoke(&logs, memo_program()));
    assert!(world.svm.get_account(&vault).is_none());
    assert_eq!(world.balance(token_address(&worker.pubkey())), amount);
    assert_eq!(world.voucher(&sponsor.pubkey(), nonce).state, 1);
}

#[test]
fn mutated_or_substituted_packed_locator_fails_atomically_then_canonical_record_pays() {
    let mut world = World::new();
    let sponsor = world.wallet(100);
    let worker = world.wallet(0);
    let actor = world.actor();
    let nonce = 14;
    let amount = 14 * UNIT;
    let voucher = voucher_pda(&sponsor.pubkey(), nonce);
    let vault = vault_pda(&voucher);
    let result_hash = [6u8; 32];

    world.fund(&sponsor, nonce, amount).unwrap();
    world.set_locator(
        Pubkey::new_from_array([99; 32]),
        1,
        worker.pubkey(),
        result_hash,
        44_412_394,
    );
    let voucher_before = world.svm.get_account(&voucher).unwrap().data;
    let worker_before = world.balance(token_address(&worker.pubkey()));
    let mutation_error = world
        .claim(
            &actor,
            &sponsor.pubkey(),
            &worker.pubkey(),
            nonce,
            MemoAccount::Canonical,
            None,
        )
        .expect_err("cross-subject packed record must fail");
    assert!(
        mutation_error.contains("completion record subject is wrong"),
        "unexpected locator-mutation failure: {mutation_error}"
    );
    assert_funded_state_unchanged(
        &world,
        &sponsor.pubkey(),
        &worker.pubkey(),
        nonce,
        &voucher_before,
        amount,
        worker_before,
    );

    let substituted_locator = Pubkey::new_from_array([44; 32]);
    world
        .svm
        .set_account(
            substituted_locator,
            Account {
                lamports: 10_000_000,
                data: packed_locator_data(subject(), 1, worker.pubkey(), result_hash, 44_412_394),
                owner: completion_program(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
    let substitution_error = world
        .claim(
            &actor,
            &sponsor.pubkey(),
            &worker.pubkey(),
            nonce,
            MemoAccount::Canonical,
            Some(substituted_locator),
        )
        .expect_err("voucher locator substitution must fail");
    assert!(
        substitution_error.contains("completion locator does not match the voucher"),
        "unexpected locator-substitution failure: {substitution_error}"
    );
    assert_funded_state_unchanged(
        &world,
        &sponsor.pubkey(),
        &worker.pubkey(),
        nonce,
        &voucher_before,
        amount,
        worker_before,
    );

    world.set_locator(subject(), 1, worker.pubkey(), result_hash, 44_412_394);
    world
        .claim(
            &actor,
            &sponsor.pubkey(),
            &worker.pubkey(),
            nonce,
            MemoAccount::Canonical,
            None,
        )
        .unwrap();
    assert!(world.svm.get_account(&vault).is_none());
    assert_eq!(world.balance(token_address(&worker.pubkey())), amount);
    assert_eq!(world.voucher(&sponsor.pubkey(), nonce).state, 1);
}

#[test]
fn mutable_completion_programdata_is_rejected_before_funding_moves_rcx() {
    let mut world = World::new();
    let sponsor = world.wallet(100);
    let nonce = 15;
    let amount = 15 * UNIT;
    let voucher = voucher_pda(&sponsor.pubkey(), nonce);
    let vault = vault_pda(&voucher);
    let sponsor_balance_before = world.balance(token_address(&sponsor.pubkey()));

    let programdata = programdata_address(&completion_program());
    let mut account = world.svm.get_account(&programdata).unwrap();
    assert_eq!(account.data[12], 0);
    account.data[12] = 1;
    account.data[13..45].copy_from_slice(Pubkey::new_from_array([88; 32]).as_ref());
    world.svm.set_account(programdata, account).unwrap();

    let error = world
        .fund(&sponsor, nonce, amount)
        .expect_err("mutable producer must be rejected");
    assert!(
        error.contains("completion program still has an upgrade authority"),
        "unexpected mutable-program failure: {error}"
    );
    assert_eq!(
        world.balance(token_address(&sponsor.pubkey())),
        sponsor_balance_before
    );
    assert!(world.svm.get_account(&voucher).is_none());
    assert!(world.svm.get_account(&vault).is_none());
}
