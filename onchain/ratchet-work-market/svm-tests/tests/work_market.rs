use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use litesvm::LiteSVM;
use serde_json::Value;
use sha2::{Digest, Sha256};
use solana_sdk::{
    account::Account,
    clock::Clock,
    instruction::{AccountMeta, Instruction},
    program_pack::Pack,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use spl_token_2022_interface::{
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state::{Account as TokenAccount, AccountState, Mint},
};
use std::{path::PathBuf, str::FromStr};

const UNIT: u64 = 1_000_000;
const RCX_SUPPLY: u64 = 936_699_884_132_132;
const NOW: i64 = 1_800_000_000;
const SOL_FEED: &str = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const TSLAX_FEED: &str = "47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362";

fn program_id() -> Pubkey {
    Pubkey::from_str("EdwrtcJ254e5BDSHbY6oZosdjPBrXLMZc9PzkmR9GBVD").unwrap()
}
fn rcx_mint() -> Pubkey {
    Pubkey::from_str("FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump").unwrap()
}
fn token_2022() -> Pubkey {
    spl_token_2022_interface::id()
}
fn classic_token() -> Pubkey {
    spl_token::id()
}
fn system_program() -> Pubkey {
    Pubkey::from_str("11111111111111111111111111111111").unwrap()
}
fn completion_program() -> Pubkey {
    Pubkey::from_str("5bBHDFMmXQq6PNyrGVdSiKo3xpDvevbueYXZmp48bX4").unwrap()
}
fn completion_v2_program() -> Pubkey {
    Pubkey::from_str("2TV2zagBZaDXXYjduLrRbiDGGsR8jXNqYAuLDE4j4tyR").unwrap()
}
fn pyth_receiver() -> Pubkey {
    Pubkey::from_str("rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp").unwrap()
}
fn pyth_push_oracle() -> Pubkey {
    Pubkey::from_str("pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou").unwrap()
}
fn subject() -> Pubkey {
    Pubkey::from_str("A4tPsf9dvhvYukRfhi5R6yLHNqATsGZvMfTvYPTMXJ34").unwrap()
}
fn discriminator(kind: &str, name: &str) -> [u8; 8] {
    let hash = Sha256::digest(format!("{kind}:{name}").as_bytes());
    hash[..8].try_into().unwrap()
}
fn voucher_pda(
    completion: &Pubkey,
    subject: &Pubkey,
    work_kind: u8,
    sponsor: &Pubkey,
    nonce: u64,
) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"voucher",
            &1u16.to_le_bytes(),
            completion.as_ref(),
            subject.as_ref(),
            &[work_kind],
            sponsor.as_ref(),
            &nonce.to_le_bytes(),
        ],
        &program_id(),
    )
    .0
}
fn vault_pda(voucher: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"vault", voucher.as_ref()], &program_id()).0
}
fn completion_pda(subject: &Pubkey, work_kind: u8) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"completion", subject.as_ref(), &[work_kind]],
        &completion_program(),
    )
}
fn token_address(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"test-rcx", owner.as_ref()], &program_id()).0
}
fn so_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("target")
        .join("deploy")
        .join("ratchet_work_market.so")
}
fn completion_so_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("ratchet-next-print")
        .join("target")
        .join("deploy")
        .join("ratchet_next_print.so")
}
fn completion_v2_so_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("ratchet-next-print-v2")
        .join("target")
        .join("deploy")
        .join("ratchet_next_print_v2.so")
}
fn next_shot_pda(player: &Pubkey, nonce: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[b"shot", player.as_ref(), &nonce.to_le_bytes()],
        &completion_v2_program(),
    )
    .0
}
fn next_completion_pda(subject: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"completion", subject.as_ref(), &[1]],
        &completion_v2_program(),
    )
    .0
}
fn sol_feed() -> [u8; 32] {
    let mut out = [0; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&SOL_FEED[2 * i..2 * i + 2], 16).unwrap();
    }
    out
}
fn tslax_feed() -> [u8; 32] {
    let mut out = [0; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&TSLAX_FEED[2 * i..2 * i + 2], 16).unwrap();
    }
    out
}
fn pyth_price_account() -> Pubkey {
    Pubkey::find_program_address(&[&0u16.to_le_bytes(), &sol_feed()], &pyth_push_oracle()).0
}
fn tslax_price_account() -> Pubkey {
    Pubkey::find_program_address(&[&0u16.to_le_bytes(), &tslax_feed()], &pyth_push_oracle()).0
}
fn hex_bytes(value: &str) -> Vec<u8> {
    (0..value.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&value[i..i + 2], 16).unwrap())
        .collect()
}
fn fixture() -> (Value, Vec<u8>) {
    let json: Value = serde_json::from_str(include_str!(
        "../../fixtures/rcx-mainnet-mint-2026-09-04.json"
    ))
    .unwrap();
    let data = BASE64.decode(json["dataBase64"].as_str().unwrap()).unwrap();
    (json, data)
}

#[derive(Debug)]
struct VoucherView {
    state: u8,
    work_kind: u8,
    funded_amount: u64,
    settled_amount: u64,
    completion_receipt: Pubkey,
    beneficiary: Pubkey,
    result_hash: [u8; 32],
}

impl VoucherView {
    fn parse(data: &[u8]) -> Self {
        assert_eq!(data.len(), 245);
        assert_eq!(&data[..8], &discriminator("account", "Voucher"));
        Self {
            state: data[11],
            work_kind: data[12],
            funded_amount: u64::from_le_bytes(data[117..125].try_into().unwrap()),
            settled_amount: u64::from_le_bytes(data[125..133].try_into().unwrap()),
            completion_receipt: Pubkey::new_from_array(data[149..181].try_into().unwrap()),
            beneficiary: Pubkey::new_from_array(data[181..213].try_into().unwrap()),
            result_hash: data[213..245].try_into().unwrap(),
        }
    }
}

struct World {
    svm: LiteSVM,
}

impl World {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program_from_file(program_id(), so_path())
            .expect("load Work Market SBF");
        svm.add_program_from_file(completion_program(), completion_so_path())
            .expect("load real Next Print SBF as the completion-program boundary");
        svm.add_program_from_file(completion_v2_program(), completion_v2_so_path())
            .expect("load receipt-emitting Next Print v2 SBF");
        svm.set_account(
            subject(),
            Account {
                lamports: 10_000_000,
                data: vec![7; 64],
                owner: completion_program(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
        let (_, mint_data) = fixture();
        svm.set_account(
            rcx_mint(),
            Account {
                lamports: 3_737_520,
                data: mint_data,
                owner: token_2022(),
                executable: false,
                rent_epoch: u64::MAX,
            },
        )
        .unwrap();
        Self { svm }
    }

    fn wallet(&mut self, whole_rcx: u64) -> Keypair {
        let keypair = Keypair::new();
        self.svm.airdrop(&keypair.pubkey(), 20_000_000_000).unwrap();
        self.set_token(
            &keypair.pubkey(),
            rcx_mint(),
            whole_rcx * UNIT,
            token_2022(),
        );
        keypair
    }

    fn actor(&mut self) -> Keypair {
        self.wallet(0)
    }

    fn set_clock(&mut self, now: i64) {
        self.svm.set_sysvar(&Clock {
            slot: (now as u64) * 2,
            epoch_start_timestamp: NOW - 1_000,
            epoch: 1,
            leader_schedule_epoch: 1,
            unix_timestamp: now,
        });
    }

    fn put_pyth(&mut self, price: i64, prev: i64, publish: i64) {
        let feed = sol_feed();
        let address = pyth_price_account();
        let mut data = Vec::with_capacity(134);
        data.extend_from_slice(&discriminator("account", "PriceUpdateV2"));
        data.extend_from_slice(address.as_ref());
        data.push(1);
        data.extend_from_slice(&feed);
        data.extend_from_slice(&price.to_le_bytes());
        data.extend_from_slice(&1u64.to_le_bytes());
        data.extend_from_slice(&(-8i32).to_le_bytes());
        data.extend_from_slice(&publish.to_le_bytes());
        data.extend_from_slice(&prev.to_le_bytes());
        data.extend_from_slice(&price.to_le_bytes());
        data.extend_from_slice(&1u64.to_le_bytes());
        data.extend_from_slice(&((publish as u64) * 2).to_le_bytes());
        data.resize(134, 0);
        self.svm
            .set_account(
                address,
                Account {
                    lamports: 10_000_000,
                    data,
                    owner: pyth_receiver(),
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
    }

    fn put_raw_tslax(&mut self) -> i64 {
        let json: Value = serde_json::from_str(include_str!(
            "../../../ratchet-next-print/fixtures/pyth-tslax-mainnet-2026-09-04.json"
        ))
        .unwrap();
        let data = hex_bytes(json["dataHex"].as_str().unwrap());
        assert_eq!(data.len(), 134);
        self.svm
            .set_account(
                tslax_price_account(),
                Account {
                    lamports: json["lamports"].as_u64().unwrap(),
                    data,
                    owner: pyth_receiver(),
                    executable: false,
                    rent_epoch: u64::MAX,
                },
            )
            .unwrap();
        json["publishTime"].as_i64().unwrap()
    }

    fn next_open(&mut self, player: &Keypair, nonce: u64) -> Result<(), String> {
        let shot = next_shot_pda(&player.pubkey(), nonce);
        let mut data = discriminator("global", "open_shot").to_vec();
        data.extend_from_slice(&nonce.to_le_bytes());
        data.extend_from_slice(&[3; 32]);
        data.push(0);
        self.send(
            Instruction {
                program_id: completion_v2_program(),
                accounts: vec![
                    AccountMeta::new(player.pubkey(), true),
                    AccountMeta::new(shot, false),
                    AccountMeta::new_readonly(pyth_price_account(), false),
                    AccountMeta::new_readonly(next_completion_pda(&shot), false),
                    AccountMeta::new_readonly(system_program(), false),
                ],
                data,
            },
            &[player],
        )
    }

    fn next_open_tslax(&mut self, player: &Keypair, nonce: u64) -> Result<(), String> {
        let shot = next_shot_pda(&player.pubkey(), nonce);
        let mut data = discriminator("global", "open_shot").to_vec();
        data.extend_from_slice(&nonce.to_le_bytes());
        data.extend_from_slice(&[4; 32]);
        data.push(1);
        self.send(
            Instruction {
                program_id: completion_v2_program(),
                accounts: vec![
                    AccountMeta::new(player.pubkey(), true),
                    AccountMeta::new(shot, false),
                    AccountMeta::new_readonly(tslax_price_account(), false),
                    AccountMeta::new_readonly(next_completion_pda(&shot), false),
                    AccountMeta::new_readonly(system_program(), false),
                ],
                data,
            },
            &[player],
        )
    }

    fn next_observe(&mut self, actor: &Keypair, player: &Pubkey, nonce: u64) -> Result<(), String> {
        self.send(
            Instruction {
                program_id: completion_v2_program(),
                accounts: vec![
                    AccountMeta::new(actor.pubkey(), true),
                    AccountMeta::new(next_shot_pda(player, nonce), false),
                    AccountMeta::new_readonly(pyth_price_account(), false),
                ],
                data: discriminator("global", "observe").to_vec(),
            },
            &[actor],
        )
    }

    fn next_timeout(&mut self, actor: &Keypair, player: &Pubkey, nonce: u64) -> Result<(), String> {
        self.send(
            Instruction {
                program_id: completion_v2_program(),
                accounts: vec![
                    AccountMeta::new_readonly(actor.pubkey(), true),
                    AccountMeta::new(next_shot_pda(player, nonce), false),
                ],
                data: discriminator("global", "timeout").to_vec(),
            },
            &[actor],
        )
    }

    fn next_write_receipt(
        &mut self,
        payer: &Keypair,
        player: &Pubkey,
        nonce: u64,
    ) -> Result<(), String> {
        let shot = next_shot_pda(player, nonce);
        self.send(
            Instruction {
                program_id: completion_v2_program(),
                accounts: vec![
                    AccountMeta::new(payer.pubkey(), true),
                    AccountMeta::new_readonly(shot, false),
                    AccountMeta::new(next_completion_pda(&shot), false),
                    AccountMeta::new_readonly(system_program(), false),
                ],
                data: discriminator("global", "write_completion_receipt").to_vec(),
            },
            &[payer],
        )
    }

    fn set_token(&mut self, owner: &Pubkey, mint: Pubkey, amount: u64, program: Pubkey) {
        self.set_token_at(token_address(owner), owner, mint, amount, program);
    }

    fn set_token_at(
        &mut self,
        address: Pubkey,
        owner: &Pubkey,
        mint: Pubkey,
        amount: u64,
        program: Pubkey,
    ) {
        let mut data = vec![0u8; TokenAccount::LEN];
        TokenAccount {
            mint,
            owner: *owner,
            amount,
            delegate: None.into(),
            state: AccountState::Initialized,
            is_native: None.into(),
            delegated_amount: 0,
            close_authority: None.into(),
        }
        .pack_into_slice(&mut data);
        self.svm
            .set_account(
                address,
                Account {
                    lamports: 10_000_000,
                    data,
                    owner: program,
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
    }

    fn balance(&self, address: Pubkey) -> u64 {
        let account = self.svm.get_account(&address).expect("token account");
        let state = StateWithExtensions::<TokenAccount>::unpack(&account.data).unwrap();
        state.base.amount
    }

    fn send(&mut self, ix: Instruction, signers: &[&Keypair]) -> Result<(), String> {
        let payer = signers[0];
        self.svm.expire_blockhash();
        let transaction = Transaction::new_signed_with_payer(
            &[ix],
            Some(&payer.pubkey()),
            signers,
            self.svm.latest_blockhash(),
        );
        self.svm
            .send_transaction(transaction)
            .map(|_| ())
            .map_err(|e| format!("{}\n{:?}", e.meta.logs.join("\n"), e.err))
    }

    fn instruction(&self, name: &str, args: Vec<u8>, accounts: Vec<AccountMeta>) -> Instruction {
        let mut data = discriminator("global", name).to_vec();
        data.extend_from_slice(&args);
        Instruction {
            program_id: program_id(),
            accounts,
            data,
        }
    }

    fn fund(
        &mut self,
        sponsor: &Keypair,
        nonce: u64,
        work_kind: u8,
        amount: u64,
    ) -> Result<(), String> {
        self.fund_with(
            sponsor,
            nonce,
            work_kind,
            amount,
            subject(),
            completion_program(),
            rcx_mint(),
            token_address(&sponsor.pubkey()),
            token_2022(),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn fund_with(
        &mut self,
        sponsor: &Keypair,
        nonce: u64,
        work_kind: u8,
        amount: u64,
        subject_key: Pubkey,
        completion_key: Pubkey,
        mint: Pubkey,
        sponsor_token: Pubkey,
        token_program: Pubkey,
    ) -> Result<(), String> {
        let voucher = voucher_pda(
            &completion_key,
            &subject_key,
            work_kind,
            &sponsor.pubkey(),
            nonce,
        );
        let mut args = nonce.to_le_bytes().to_vec();
        args.push(work_kind);
        args.extend_from_slice(&amount.to_le_bytes());
        let ix = self.instruction(
            "fund_rcx_voucher",
            args,
            vec![
                AccountMeta::new(sponsor.pubkey(), true),
                AccountMeta::new_readonly(subject_key, false),
                AccountMeta::new_readonly(completion_key, false),
                AccountMeta::new(voucher, false),
                AccountMeta::new(vault_pda(&voucher), false),
                AccountMeta::new(mint, false),
                AccountMeta::new(sponsor_token, false),
                AccountMeta::new_readonly(token_program, false),
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
        work_kind: u8,
    ) -> Result<(), String> {
        let voucher = voucher_pda(&completion_program(), &subject(), work_kind, sponsor, nonce);
        let ix = self.instruction(
            "claim_rcx_voucher",
            vec![],
            vec![
                AccountMeta::new_readonly(actor.pubkey(), true),
                AccountMeta::new(voucher, false),
                AccountMeta::new(vault_pda(&voucher), false),
                AccountMeta::new_readonly(rcx_mint(), false),
                AccountMeta::new_readonly(*worker, false),
                AccountMeta::new(token_address(worker), false),
                AccountMeta::new_readonly(completion_pda(&subject(), work_kind).0, false),
                AccountMeta::new(*sponsor, false),
                AccountMeta::new_readonly(token_2022(), false),
            ],
        );
        self.send(ix, &[actor])
    }

    #[allow(clippy::too_many_arguments)]
    fn claim_with(
        &mut self,
        actor: &Keypair,
        sponsor: &Pubkey,
        worker: &Pubkey,
        nonce: u64,
        work_kind: u8,
        subject_key: Pubkey,
        completion_key: Pubkey,
    ) -> Result<(), String> {
        let voucher = voucher_pda(&completion_key, &subject_key, work_kind, sponsor, nonce);
        let receipt = Pubkey::find_program_address(
            &[b"completion", subject_key.as_ref(), &[work_kind]],
            &completion_key,
        )
        .0;
        let ix = self.instruction(
            "claim_rcx_voucher",
            vec![],
            vec![
                AccountMeta::new_readonly(actor.pubkey(), true),
                AccountMeta::new(voucher, false),
                AccountMeta::new(vault_pda(&voucher), false),
                AccountMeta::new_readonly(rcx_mint(), false),
                AccountMeta::new_readonly(*worker, false),
                AccountMeta::new(token_address(worker), false),
                AccountMeta::new_readonly(receipt, false),
                AccountMeta::new(*sponsor, false),
                AccountMeta::new_readonly(token_2022(), false),
            ],
        );
        self.send(ix, &[actor])
    }

    fn refund(
        &mut self,
        actor: &Keypair,
        sponsor: &Pubkey,
        nonce: u64,
        work_kind: u8,
    ) -> Result<(), String> {
        let voucher = voucher_pda(&completion_program(), &subject(), work_kind, sponsor, nonce);
        let ix = self.instruction(
            "refund_rcx_voucher",
            vec![],
            vec![
                AccountMeta::new_readonly(actor.pubkey(), true),
                AccountMeta::new(voucher, false),
                AccountMeta::new(vault_pda(&voucher), false),
                AccountMeta::new_readonly(rcx_mint(), false),
                AccountMeta::new_readonly(completion_pda(&subject(), work_kind).0, false),
                AccountMeta::new(*sponsor, false),
                AccountMeta::new(token_address(sponsor), false),
                AccountMeta::new_readonly(token_2022(), false),
            ],
        );
        self.send(ix, &[actor])
    }

    #[allow(clippy::too_many_arguments)]
    fn refund_with(
        &mut self,
        actor: &Keypair,
        sponsor: &Pubkey,
        nonce: u64,
        work_kind: u8,
        subject_key: Pubkey,
        completion_key: Pubkey,
    ) -> Result<(), String> {
        let voucher = voucher_pda(&completion_key, &subject_key, work_kind, sponsor, nonce);
        let receipt = Pubkey::find_program_address(
            &[b"completion", subject_key.as_ref(), &[work_kind]],
            &completion_key,
        )
        .0;
        let ix = self.instruction(
            "refund_rcx_voucher",
            vec![],
            vec![
                AccountMeta::new_readonly(actor.pubkey(), true),
                AccountMeta::new(voucher, false),
                AccountMeta::new(vault_pda(&voucher), false),
                AccountMeta::new_readonly(rcx_mint(), false),
                AccountMeta::new_readonly(receipt, false),
                AccountMeta::new(*sponsor, false),
                AccountMeta::new(token_address(sponsor), false),
                AccountMeta::new_readonly(token_2022(), false),
            ],
        );
        self.send(ix, &[actor])
    }

    fn close(
        &mut self,
        actor: &Keypair,
        sponsor: &Pubkey,
        nonce: u64,
        work_kind: u8,
    ) -> Result<(), String> {
        let voucher = voucher_pda(&completion_program(), &subject(), work_kind, sponsor, nonce);
        let ix = self.instruction(
            "close_voucher",
            vec![],
            vec![
                AccountMeta::new_readonly(actor.pubkey(), true),
                AccountMeta::new(voucher, false),
                AccountMeta::new(*sponsor, false),
            ],
        );
        self.send(ix, &[actor])
    }

    fn put_receipt(
        &mut self,
        work_kind: u8,
        disposition: u8,
        worker: Pubkey,
        result_hash: [u8; 32],
    ) -> Pubkey {
        let (address, bump) = completion_pda(&subject(), work_kind);
        let mut data = discriminator("account", "CompletionReceipt").to_vec();
        data.extend_from_slice(&1u16.to_le_bytes());
        data.push(bump);
        data.push(disposition);
        data.push(work_kind);
        data.extend_from_slice(subject().as_ref());
        data.extend_from_slice(worker.as_ref());
        data.extend_from_slice(&result_hash);
        data.extend_from_slice(&44_412_391u64.to_le_bytes());
        data.extend_from_slice(&1_788_484_123i64.to_le_bytes());
        assert_eq!(data.len(), 125);
        self.svm
            .set_account(
                address,
                Account {
                    lamports: 10_000_000,
                    data,
                    owner: completion_program(),
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
        address
    }

    fn donate(&mut self, donor: &Keypair, destination: Pubkey, amount: u64) -> Result<(), String> {
        let ix = spl_token_2022_interface::instruction::transfer_checked(
            &token_2022(),
            &token_address(&donor.pubkey()),
            &rcx_mint(),
            &destination,
            &donor.pubkey(),
            &[],
            amount,
            6,
        )
        .unwrap();
        self.send(ix, &[donor])
    }

    fn voucher(&self, sponsor: &Pubkey, nonce: u64, work_kind: u8) -> VoucherView {
        let address = voucher_pda(&completion_program(), &subject(), work_kind, sponsor, nonce);
        VoucherView::parse(&self.svm.get_account(&address).expect("voucher").data)
    }
}

fn assert_err(result: Result<(), String>, marker: &str) {
    let logs = result.expect_err("expected transaction failure");
    assert!(
        logs.contains(marker),
        "expected marker {marker}, got:\n{logs}"
    );
}

#[test]
fn real_mainnet_mint_fixture_drives_nonzero_fund_claim_and_cleanup() {
    let (json, mint_data) = fixture();
    assert_eq!(json["contextSlot"].as_u64(), Some(444_123_919));
    assert_eq!(mint_data.len(), 409);
    let mint = StateWithExtensions::<Mint>::unpack(&mint_data).unwrap();
    assert_eq!(mint.base.supply, RCX_SUPPLY);
    assert_eq!(mint.base.decimals, 6);
    assert!(mint.base.mint_authority.is_none());
    assert!(mint.base.freeze_authority.is_none());
    assert_eq!(
        mint.get_extension_types().unwrap(),
        vec![ExtensionType::MetadataPointer, ExtensionType::TokenMetadata]
    );

    let mut world = World::new();
    let sponsor = world.wallet(100);
    let worker = world.wallet(0);
    let actor = world.actor();
    let donor = world.wallet(10);
    let nonce = 7;
    let work_kind = 1;
    let amount = 25 * UNIT;
    let voucher = voucher_pda(
        &completion_program(),
        &subject(),
        work_kind,
        &sponsor.pubkey(),
        nonce,
    );
    let vault = vault_pda(&voucher);

    world.fund(&sponsor, nonce, work_kind, amount).unwrap();
    assert_eq!(world.balance(token_address(&sponsor.pubkey())), 75 * UNIT);
    assert_eq!(world.balance(vault), amount);
    let funded = world.voucher(&sponsor.pubkey(), nonce, work_kind);
    assert_eq!((funded.state, funded.work_kind), (0, work_kind));
    assert_eq!((funded.funded_amount, funded.settled_amount), (amount, 0));

    assert_err(
        world.close(&actor, &sponsor.pubkey(), nonce, work_kind),
        "VoucherStillFunded",
    );
    world.donate(&donor, vault, 2 * UNIT).unwrap();
    assert_eq!(world.balance(vault), 27 * UNIT);

    let result_hash = [9u8; 32];
    let receipt = world.put_receipt(work_kind, 1, worker.pubkey(), result_hash);
    let sponsor_lamports_before_claim = world.svm.get_balance(&sponsor.pubkey()).unwrap();
    world
        .claim(
            &actor,
            &sponsor.pubkey(),
            &worker.pubkey(),
            nonce,
            work_kind,
        )
        .unwrap();
    assert_eq!(world.balance(token_address(&worker.pubkey())), 27 * UNIT);
    assert!(
        world.svm.get_account(&vault).is_none(),
        "claim closes the per-voucher token vault"
    );
    assert!(
        world.svm.get_balance(&sponsor.pubkey()).unwrap() > sponsor_lamports_before_claim,
        "vault rent returns to the recorded sponsor, not the actor"
    );
    let paid = world.voucher(&sponsor.pubkey(), nonce, work_kind);
    assert_eq!((paid.state, paid.settled_amount), (1, 27 * UNIT));
    assert_eq!(paid.completion_receipt, receipt);
    assert_eq!(paid.beneficiary, worker.pubkey());
    assert_eq!(paid.result_hash, result_hash);

    assert!(
        world
            .claim(
                &actor,
                &sponsor.pubkey(),
                &worker.pubkey(),
                nonce,
                work_kind,
            )
            .is_err(),
        "paid voucher cannot be claimed twice"
    );
    let sponsor_lamports_before_close = world.svm.get_balance(&sponsor.pubkey()).unwrap();
    world
        .close(&actor, &sponsor.pubkey(), nonce, work_kind)
        .unwrap();
    assert!(world.svm.get_account(&voucher).is_none());
    assert!(
        world.svm.get_balance(&sponsor.pubkey()).unwrap() > sponsor_lamports_before_close,
        "voucher rent also returns to the recorded sponsor"
    );
}

#[test]
fn terminal_nonpayable_receipt_refunds_every_vault_unit() {
    let mut world = World::new();
    let sponsor = world.wallet(100);
    let donor = world.wallet(5);
    let actor = world.actor();
    let nonce = 8;
    let work_kind = 2;
    let amount = 20 * UNIT;
    let voucher = voucher_pda(
        &completion_program(),
        &subject(),
        work_kind,
        &sponsor.pubkey(),
        nonce,
    );
    let vault = vault_pda(&voucher);

    world.fund(&sponsor, nonce, work_kind, amount).unwrap();
    world.donate(&donor, vault, 2 * UNIT).unwrap();
    let receipt = world.put_receipt(work_kind, 2, Pubkey::default(), [4u8; 32]);
    assert_err(
        world.claim(&actor, &sponsor.pubkey(), &actor.pubkey(), nonce, work_kind),
        "ReceiptNotPayable",
    );
    world
        .refund(&actor, &sponsor.pubkey(), nonce, work_kind)
        .unwrap();
    assert_eq!(
        world.balance(token_address(&sponsor.pubkey())),
        102 * UNIT,
        "the fixed sponsor receives funded RCX and unsolicited top-up"
    );
    assert!(world.svm.get_account(&vault).is_none());
    let refunded = world.voucher(&sponsor.pubkey(), nonce, work_kind);
    assert_eq!((refunded.state, refunded.settled_amount), (2, 22 * UNIT));
    assert_eq!(refunded.completion_receipt, receipt);
    assert_eq!(refunded.beneficiary, sponsor.pubkey());
    assert!(
        world
            .refund(&actor, &sponsor.pubkey(), nonce, work_kind)
            .is_err(),
        "a closed vault makes every duplicate refund fail before value can move"
    );
    assert_eq!(world.voucher(&sponsor.pubkey(), nonce, work_kind).state, 2);
    world
        .close(&actor, &sponsor.pubkey(), nonce, work_kind)
        .unwrap();
    assert!(world.svm.get_account(&voucher).is_none());
}

#[test]
fn wrong_family_mint_subject_and_receipt_cannot_move_rcx() {
    let mut world = World::new();
    let sponsor = world.wallet(100);
    let actor = world.actor();
    let worker = world.wallet(0);
    let work_kind = 3;
    let initial = world.balance(token_address(&sponsor.pubkey()));

    assert_err(world.fund(&sponsor, 1, 0, UNIT), "InvalidWorkKind");
    assert_err(world.fund(&sponsor, 2, work_kind, 0), "InvalidAmount");
    assert_eq!(world.balance(token_address(&sponsor.pubkey())), initial);

    let classic_voucher = voucher_pda(
        &completion_program(),
        &subject(),
        work_kind,
        &sponsor.pubkey(),
        3,
    );
    assert!(
        world
            .fund_with(
                &sponsor,
                3,
                work_kind,
                UNIT,
                subject(),
                completion_program(),
                rcx_mint(),
                token_address(&sponsor.pubkey()),
                classic_token(),
            )
            .is_err(),
        "classic SPL Token cannot stand in for Token-2022"
    );
    assert!(world.svm.get_account(&classic_voucher).is_none());
    assert_eq!(world.balance(token_address(&sponsor.pubkey())), initial);

    let wrong_subject = Pubkey::new_unique();
    world
        .svm
        .set_account(
            wrong_subject,
            Account {
                lamports: 10_000_000,
                data: vec![1],
                owner: system_program(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
    assert_err(
        world.fund_with(
            &sponsor,
            4,
            work_kind,
            UNIT,
            wrong_subject,
            completion_program(),
            rcx_mint(),
            token_address(&sponsor.pubkey()),
            token_2022(),
        ),
        "WrongSubjectOwner",
    );
    assert_eq!(world.balance(token_address(&sponsor.pubkey())), initial);

    let wrong_mint = Pubkey::new_unique();
    let mut wrong_mint_data = vec![0u8; Mint::LEN];
    Mint {
        mint_authority: None.into(),
        supply: 1_000 * UNIT,
        decimals: 6,
        is_initialized: true,
        freeze_authority: None.into(),
    }
    .pack_into_slice(&mut wrong_mint_data);
    world
        .svm
        .set_account(
            wrong_mint,
            Account {
                lamports: 10_000_000,
                data: wrong_mint_data,
                owner: token_2022(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
    let wrong_token = Pubkey::new_unique();
    world.set_token_at(
        wrong_token,
        &sponsor.pubkey(),
        wrong_mint,
        10 * UNIT,
        token_2022(),
    );
    assert_err(
        world.fund_with(
            &sponsor,
            5,
            work_kind,
            UNIT,
            subject(),
            completion_program(),
            wrong_mint,
            wrong_token,
            token_2022(),
        ),
        "WrongMint",
    );
    assert_eq!(world.balance(token_address(&sponsor.pubkey())), initial);

    let nonce = 6;
    world.fund(&sponsor, nonce, work_kind, 10 * UNIT).unwrap();
    let voucher = voucher_pda(
        &completion_program(),
        &subject(),
        work_kind,
        &sponsor.pubkey(),
        nonce,
    );
    let vault = vault_pda(&voucher);
    let receipt_address = world.put_receipt(work_kind, 1, worker.pubkey(), [8u8; 32]);
    let mut receipt_account = world.svm.get_account(&receipt_address).unwrap();
    receipt_account.owner = system_program();
    world
        .svm
        .set_account(receipt_address, receipt_account.clone())
        .unwrap();
    assert_err(
        world.claim(
            &actor,
            &sponsor.pubkey(),
            &worker.pubkey(),
            nonce,
            work_kind,
        ),
        "WrongReceiptOwner",
    );
    assert_eq!(world.balance(vault), 10 * UNIT);

    receipt_account.owner = completion_program();
    receipt_account.data[12] = work_kind + 1;
    world
        .svm
        .set_account(receipt_address, receipt_account.clone())
        .unwrap();
    assert_err(
        world.claim(
            &actor,
            &sponsor.pubkey(),
            &worker.pubkey(),
            nonce,
            work_kind,
        ),
        "WrongReceiptWorkKind",
    );
    assert_eq!(world.balance(vault), 10 * UNIT);

    receipt_account.data[12] = work_kind;
    world
        .svm
        .set_account(receipt_address, receipt_account)
        .unwrap();
    assert_err(
        world.claim(&actor, &sponsor.pubkey(), &actor.pubkey(), nonce, work_kind),
        "WrongWorker",
    );
    assert_err(
        world.refund(&actor, &sponsor.pubkey(), nonce, work_kind),
        "ReceiptNotNonpayable",
    );
    assert_eq!(world.balance(vault), 10 * UNIT);
    world
        .claim(
            &actor,
            &sponsor.pubkey(),
            &worker.pubkey(),
            nonce,
            work_kind,
        )
        .unwrap();
    assert_eq!(world.balance(token_address(&worker.pubkey())), 10 * UNIT);
}

#[test]
fn multiple_sponsors_are_isolated_and_one_receipt_can_pay_each_once() {
    let mut world = World::new();
    let sponsor_a = world.wallet(50);
    let sponsor_b = world.wallet(50);
    let worker = world.wallet(0);
    let actor = world.actor();
    let nonce = 44;
    let work_kind = 4;

    world.fund(&sponsor_a, nonce, work_kind, 7 * UNIT).unwrap();
    world.fund(&sponsor_b, nonce, work_kind, 11 * UNIT).unwrap();
    let voucher_a = voucher_pda(
        &completion_program(),
        &subject(),
        work_kind,
        &sponsor_a.pubkey(),
        nonce,
    );
    let voucher_b = voucher_pda(
        &completion_program(),
        &subject(),
        work_kind,
        &sponsor_b.pubkey(),
        nonce,
    );
    assert_ne!(voucher_a, voucher_b);
    world.put_receipt(work_kind, 1, worker.pubkey(), [5u8; 32]);

    world
        .claim(
            &actor,
            &sponsor_b.pubkey(),
            &worker.pubkey(),
            nonce,
            work_kind,
        )
        .unwrap();
    world
        .claim(
            &actor,
            &sponsor_a.pubkey(),
            &worker.pubkey(),
            nonce,
            work_kind,
        )
        .unwrap();
    assert_eq!(world.balance(token_address(&worker.pubkey())), 18 * UNIT);
    assert_eq!(
        world.voucher(&sponsor_a.pubkey(), nonce, work_kind).state,
        1
    );
    assert_eq!(
        world.voucher(&sponsor_b.pubkey(), nonce, work_kind).state,
        1
    );
    assert!(
        world
            .svm
            .get_account(&completion_pda(&subject(), work_kind).0)
            .is_some(),
        "durable completion outlives every voucher claim"
    );
}

#[test]
fn real_next_print_v2_successor_writes_receipt_and_pays_rcx_voucher() {
    let mut world = World::new();
    let player = world.actor();
    let sponsor = world.wallet(100);
    let observer = world.actor();
    let receipt_payer = world.actor();
    let claim_actor = world.actor();
    let shot_nonce = 91;
    let voucher_nonce = 92;
    let work_kind = 1;
    let amount = 12 * UNIT;

    world.set_clock(NOW);
    world.put_pyth(10_000, NOW - 20, NOW - 1);
    world.next_open(&player, shot_nonce).unwrap();
    let shot = next_shot_pda(&player.pubkey(), shot_nonce);
    let receipt = next_completion_pda(&shot);
    assert_eq!(
        world.svm.get_account(&shot).unwrap().owner,
        completion_v2_program()
    );
    assert!(world.svm.get_account(&receipt).is_none());

    world
        .fund_with(
            &sponsor,
            voucher_nonce,
            work_kind,
            amount,
            shot,
            completion_v2_program(),
            rcx_mint(),
            token_address(&sponsor.pubkey()),
            token_2022(),
        )
        .unwrap();
    let voucher = voucher_pda(
        &completion_v2_program(),
        &shot,
        work_kind,
        &sponsor.pubkey(),
        voucher_nonce,
    );
    assert_eq!(world.balance(vault_pda(&voucher)), amount);

    world.set_clock(NOW + 10);
    world.put_pyth(10_001, NOW - 1, NOW + 10);
    world
        .next_observe(&observer, &player.pubkey(), shot_nonce)
        .unwrap();
    let shot_data = world.svm.get_account(&shot).unwrap().data;
    assert_eq!(shot_data.len(), 470);
    assert_eq!(shot_data[11], 1, "direct successor captures the shot");
    assert_eq!(
        shot_data[384], 1,
        "receipt freezes Captured as the work state"
    );
    assert_eq!(shot_data[385], 1, "oracle observation is payable");
    assert_eq!(&shot_data[386..418], observer.pubkey().as_ref());
    assert!(
        world.svm.get_account(&receipt).is_none(),
        "canonical work is independent of receipt rent"
    );

    world
        .next_write_receipt(&receipt_payer, &player.pubkey(), shot_nonce)
        .unwrap();
    let receipt_account = world.svm.get_account(&receipt).unwrap();
    assert_eq!(receipt_account.owner, completion_v2_program());
    assert_eq!(receipt_account.data.len(), 125);
    assert_eq!(
        &receipt_account.data[..8],
        &discriminator("account", "CompletionReceipt")
    );
    assert_eq!(receipt_account.data[11], 1);
    assert_eq!(receipt_account.data[12], work_kind);
    assert_eq!(&receipt_account.data[13..45], shot.as_ref());
    assert_eq!(&receipt_account.data[45..77], observer.pubkey().as_ref());
    assert_eq!(&receipt_account.data[77..109], &shot_data[418..450]);

    world
        .claim_with(
            &claim_actor,
            &sponsor.pubkey(),
            &observer.pubkey(),
            voucher_nonce,
            work_kind,
            shot,
            completion_v2_program(),
        )
        .unwrap();
    assert_eq!(world.balance(token_address(&observer.pubkey())), amount);
    assert!(world.svm.get_account(&vault_pda(&voucher)).is_none());
    let paid = VoucherView::parse(&world.svm.get_account(&voucher).unwrap().data);
    assert_eq!(paid.state, 1);
    assert_eq!(paid.completion_receipt, receipt);
    assert_eq!(paid.beneficiary, observer.pubkey());
    assert_eq!(paid.result_hash.as_slice(), &shot_data[418..450]);
}

#[test]
fn exact_mainnet_tslax_account_enters_the_real_next_print_v2_sbf() {
    let mut world = World::new();
    let player = world.actor();
    let nonce = 95;
    let publish_time = world.put_raw_tslax();
    world.set_clock(publish_time);
    world.next_open_tslax(&player, nonce).unwrap();

    let shot = next_shot_pda(&player.pubkey(), nonce);
    let data = world.svm.get_account(&shot).unwrap().data;
    assert_eq!(data.len(), 470);
    assert_eq!(data[11], 0);
    assert_eq!(data[118], 1, "TSLAX is the pinned stock feed index");
    assert_eq!(&data[119..151], &tslax_feed());
    assert_eq!(&data[167..199], tslax_price_account().as_ref());
    assert_eq!(
        i64::from_le_bytes(data[251..259].try_into().unwrap()),
        publish_time
    );
}

#[test]
fn real_next_print_v2_timeout_writes_nonpayable_receipt_and_refunds_rcx() {
    let mut world = World::new();
    let player = world.actor();
    let sponsor = world.wallet(100);
    let timeout_actor = world.actor();
    let receipt_payer = world.actor();
    let refund_actor = world.actor();
    let shot_nonce = 93;
    let voucher_nonce = 94;
    let work_kind = 1;
    let amount = 15 * UNIT;

    world.set_clock(NOW);
    world.put_pyth(10_000, NOW - 20, NOW - 1);
    world.next_open(&player, shot_nonce).unwrap();
    let shot = next_shot_pda(&player.pubkey(), shot_nonce);
    world
        .fund_with(
            &sponsor,
            voucher_nonce,
            work_kind,
            amount,
            shot,
            completion_v2_program(),
            rcx_mint(),
            token_address(&sponsor.pubkey()),
            token_2022(),
        )
        .unwrap();
    assert_eq!(world.balance(token_address(&sponsor.pubkey())), 85 * UNIT);

    world.set_clock(NOW + 300);
    world
        .next_timeout(&timeout_actor, &player.pubkey(), shot_nonce)
        .unwrap();
    let shot_data = world.svm.get_account(&shot).unwrap().data;
    assert_eq!(shot_data[11], 8);
    assert_eq!(shot_data[384], 8);
    assert_eq!(shot_data[385], 2, "timeout is terminal but nonpayable");
    assert_eq!(&shot_data[386..418], Pubkey::default().as_ref());

    world
        .next_write_receipt(&receipt_payer, &player.pubkey(), shot_nonce)
        .unwrap();
    let receipt = next_completion_pda(&shot);
    let receipt_data = world.svm.get_account(&receipt).unwrap().data;
    assert_eq!(receipt_data[11], 2);
    assert_eq!(&receipt_data[45..77], Pubkey::default().as_ref());

    world
        .refund_with(
            &refund_actor,
            &sponsor.pubkey(),
            voucher_nonce,
            work_kind,
            shot,
            completion_v2_program(),
        )
        .unwrap();
    assert_eq!(world.balance(token_address(&sponsor.pubkey())), 100 * UNIT);
    let voucher = voucher_pda(
        &completion_v2_program(),
        &shot,
        work_kind,
        &sponsor.pubkey(),
        voucher_nonce,
    );
    assert!(world.svm.get_account(&vault_pda(&voucher)).is_none());
    let refunded = VoucherView::parse(&world.svm.get_account(&voucher).unwrap().data);
    assert_eq!(refunded.state, 2);
    assert_eq!(refunded.completion_receipt, receipt);
    assert_eq!(refunded.beneficiary, sponsor.pubkey());
    assert_eq!(refunded.result_hash.as_slice(), &shot_data[418..450]);
}

#[test]
fn real_next_print_v2_missed_successor_is_nonpayable_and_refunds_rcx() {
    let mut world = World::new();
    let player = world.actor();
    let sponsor = world.wallet(100);
    let observer = world.actor();
    let receipt_payer = world.actor();
    let refund_actor = world.actor();
    let shot_nonce = 96;
    let voucher_nonce = 97;
    let work_kind = 1;
    let amount = 9 * UNIT;

    world.set_clock(NOW);
    world.put_pyth(10_000, NOW - 20, NOW - 1);
    world.next_open(&player, shot_nonce).unwrap();
    let shot = next_shot_pda(&player.pubkey(), shot_nonce);
    world
        .fund_with(
            &sponsor,
            voucher_nonce,
            work_kind,
            amount,
            shot,
            completion_v2_program(),
            rcx_mint(),
            token_address(&sponsor.pubkey()),
            token_2022(),
        )
        .unwrap();
    assert_eq!(world.balance(token_address(&sponsor.pubkey())), 91 * UNIT);

    world.set_clock(NOW + 20);
    world.put_pyth(10_002, NOW + 10, NOW + 20);
    world
        .next_observe(&observer, &player.pubkey(), shot_nonce)
        .unwrap();
    let shot_data = world.svm.get_account(&shot).unwrap().data;
    assert_eq!(
        shot_data[11], 4,
        "a skipped direct successor voids the shot"
    );
    assert_eq!(shot_data[384], 4);
    assert_eq!(
        shot_data[385], 2,
        "missed work is terminal but must not earn RCX"
    );
    assert_eq!(&shot_data[386..418], Pubkey::default().as_ref());

    world
        .next_write_receipt(&receipt_payer, &player.pubkey(), shot_nonce)
        .unwrap();
    let receipt = next_completion_pda(&shot);
    let receipt_data = world.svm.get_account(&receipt).unwrap().data;
    assert_eq!(receipt_data[11], 2);
    assert_eq!(&receipt_data[45..77], Pubkey::default().as_ref());

    world
        .refund_with(
            &refund_actor,
            &sponsor.pubkey(),
            voucher_nonce,
            work_kind,
            shot,
            completion_v2_program(),
        )
        .unwrap();
    assert_eq!(world.balance(token_address(&sponsor.pubkey())), 100 * UNIT);
    let voucher = voucher_pda(
        &completion_v2_program(),
        &shot,
        work_kind,
        &sponsor.pubkey(),
        voucher_nonce,
    );
    assert!(world.svm.get_account(&vault_pda(&voucher)).is_none());
    let refunded = VoucherView::parse(&world.svm.get_account(&voucher).unwrap().data);
    assert_eq!(refunded.state, 2);
    assert_eq!(refunded.completion_receipt, receipt);
    assert_eq!(refunded.beneficiary, sponsor.pubkey());
    assert_eq!(refunded.result_hash.as_slice(), &shot_data[418..450]);
}
