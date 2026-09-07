//! Transaction-level tests for the compiled Next Print SBF program.
//! Pyth Receiver accounts are manually encoded; no RPC, API key or wallet file.

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
use std::{path::PathBuf, str::FromStr};

mod system_program {
    pub fn id() -> solana_sdk::pubkey::Pubkey {
        solana_sdk::pubkey::Pubkey::from_str_const("11111111111111111111111111111111")
    }
}

const NOW: i64 = 1_800_000_000;
const SOL: &str = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const TSLAX: &str = "47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362";

fn program_id() -> Pubkey {
    Pubkey::from_str("5bBHDFMmXQq6PNyrGVdSiKo3xpDvevbueYXZmp48bX4").unwrap()
}
fn pyth_receiver() -> Pubkey {
    Pubkey::from_str("rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp").unwrap()
}
fn pyth_push_oracle() -> Pubkey {
    Pubkey::from_str("pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou").unwrap()
}
fn so_path() -> PathBuf {
    std::env::var("RATCHET_NEXT_PRINT_SO")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("target")
                .join("deploy")
                .join("ratchet_next_print.so")
        })
}
fn disc(kind: &str, name: &str) -> [u8; 8] {
    let hash = Sha256::digest(format!("{kind}:{name}").as_bytes());
    let mut out = [0u8; 8];
    out.copy_from_slice(&hash[..8]);
    out
}
fn hex32(s: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap();
    }
    out
}
fn hex_bytes(s: &str) -> Vec<u8> {
    assert_eq!(s.len() % 2, 0);
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}
fn feed(index: u8) -> [u8; 32] {
    match index {
        0 => hex32(SOL),
        1 => hex32(TSLAX),
        _ => [0; 32],
    }
}
fn price_account(feed: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[&0u16.to_le_bytes(), feed], &pyth_push_oracle()).0
}
fn shot_pda(player: &Pubkey, nonce: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[b"shot", player.as_ref(), &nonce.to_le_bytes()],
        &program_id(),
    )
    .0
}
fn commit(player: &Pubkey, nonce: u64, side: u8, p_bps: u16, salt: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for part in [
        b"RATCHET_NEXT_PRINT_COMMIT_V1".as_slice(),
        player.as_ref(),
        &nonce.to_le_bytes(),
        &[side],
        &p_bps.to_le_bytes(),
        salt.as_ref(),
    ] {
        hasher.update(part);
    }
    hasher.finalize().into()
}

struct World {
    svm: LiteSVM,
    now: i64,
}

impl World {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program_from_file(program_id(), so_path())
            .expect("load fresh Next Print SBF");
        let mut world = Self { svm, now: NOW };
        world.set_clock(NOW);
        world
    }
    fn actor(&mut self) -> Keypair {
        let actor = Keypair::new();
        self.svm.airdrop(&actor.pubkey(), 10_000_000_000).unwrap();
        actor
    }
    fn set_clock(&mut self, now: i64) {
        self.now = now;
        self.svm.set_sysvar(&Clock {
            slot: (now as u64) * 2,
            epoch_start_timestamp: NOW - 1000,
            epoch: 1,
            leader_schedule_epoch: 1,
            unix_timestamp: now,
        });
    }
    fn put_pyth(
        &mut self,
        feed_index: u8,
        owner: Pubkey,
        price: i64,
        exponent: i32,
        prev: i64,
        publish: i64,
    ) {
        let feed = feed(feed_index);
        let address = price_account(&feed);
        let mut data = Vec::with_capacity(134);
        data.extend_from_slice(&disc("account", "PriceUpdateV2"));
        data.extend_from_slice(address.as_ref());
        data.push(1);
        data.extend_from_slice(&feed);
        data.extend_from_slice(&price.to_le_bytes());
        data.extend_from_slice(&1u64.to_le_bytes());
        data.extend_from_slice(&exponent.to_le_bytes());
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
                    owner,
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
    }
    fn put_raw_pyth(&mut self, feed_index: u8, owner: Pubkey, data_hex: &str) {
        let address = price_account(&feed(feed_index));
        self.svm
            .set_account(
                address,
                Account {
                    lamports: 1_823_520,
                    data: hex_bytes(data_hex),
                    owner,
                    executable: false,
                    rent_epoch: u64::MAX,
                },
            )
            .unwrap();
    }
    fn ix(&self, name: &str, args: Vec<u8>, accounts: Vec<AccountMeta>) -> Instruction {
        let mut data = disc("global", name).to_vec();
        data.extend(args);
        Instruction {
            program_id: program_id(),
            accounts,
            data,
        }
    }
    fn send(&mut self, ix: Instruction, signers: &[&Keypair]) -> Result<(), String> {
        self.svm.expire_blockhash();
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&signers[0].pubkey()),
            signers,
            self.svm.latest_blockhash(),
        );
        self.svm
            .send_transaction(tx)
            .map(|_| ())
            .map_err(|e| format!("{}\n{:?}", e.meta.logs.join("\n"), e.err))
    }
    fn open(
        &mut self,
        player: &Keypair,
        nonce: u64,
        commitment: [u8; 32],
        feed_index: u8,
    ) -> Result<(), String> {
        let mut args = nonce.to_le_bytes().to_vec();
        args.extend_from_slice(&commitment);
        args.push(feed_index);
        let ix = self.ix(
            "open_shot",
            args,
            vec![
                AccountMeta::new(player.pubkey(), true),
                AccountMeta::new(shot_pda(&player.pubkey(), nonce), false),
                AccountMeta::new_readonly(price_account(&feed(feed_index)), false),
                AccountMeta::new_readonly(system_program::id(), false),
            ],
        );
        self.send(ix, &[player])
    }
    fn observe(
        &mut self,
        actor: &Keypair,
        player: &Pubkey,
        nonce: u64,
        feed_index: u8,
    ) -> Result<(), String> {
        let ix = self.ix(
            "observe",
            Vec::new(),
            vec![
                AccountMeta::new(actor.pubkey(), true),
                AccountMeta::new(shot_pda(player, nonce), false),
                AccountMeta::new_readonly(price_account(&feed(feed_index)), false),
            ],
        );
        self.send(ix, &[actor])
    }
    fn timeout(&mut self, actor: &Keypair, player: &Pubkey, nonce: u64) -> Result<(), String> {
        let ix = self.ix(
            "timeout",
            Vec::new(),
            vec![
                AccountMeta::new_readonly(actor.pubkey(), true),
                AccountMeta::new(shot_pda(player, nonce), false),
            ],
        );
        self.send(ix, &[actor])
    }
    fn reveal(
        &mut self,
        player: &Keypair,
        nonce: u64,
        side: u8,
        p_bps: u16,
        salt: [u8; 32],
    ) -> Result<(), String> {
        let mut args = vec![side];
        args.extend_from_slice(&p_bps.to_le_bytes());
        args.extend_from_slice(&salt);
        let ix = self.ix(
            "reveal",
            args,
            vec![
                AccountMeta::new_readonly(player.pubkey(), true),
                AccountMeta::new(shot_pda(&player.pubkey(), nonce), false),
            ],
        );
        self.send(ix, &[player])
    }
    fn close(&mut self, actor: &Keypair, player: &Pubkey, nonce: u64) -> Result<(), String> {
        let ix = self.ix(
            "close_shot",
            Vec::new(),
            vec![
                AccountMeta::new_readonly(actor.pubkey(), true),
                AccountMeta::new(shot_pda(player, nonce), false),
                AccountMeta::new(*player, false),
            ],
        );
        self.send(ix, &[actor])
    }
    fn shot(&self, player: &Pubkey, nonce: u64) -> Vec<u8> {
        self.svm
            .get_account(&shot_pda(player, nonce))
            .expect("shot")
            .data
    }
}

fn state(data: &[u8]) -> u8 {
    data[11]
}
fn outcome(data: &[u8]) -> i8 {
    data[391] as i8
}
fn hit(data: &[u8]) -> u8 {
    data[395]
}
fn entry_publish(data: &[u8]) -> i64 {
    i64::from_le_bytes(data[251..259].try_into().unwrap())
}
fn exit_publish(data: &[u8]) -> i64 {
    i64::from_le_bytes(data[359..367].try_into().unwrap())
}
fn assert_err(result: Result<(), String>, code: &str) {
    let error = result.expect_err(code);
    assert!(error.contains(code), "wanted {code}, got:\n{error}");
}

#[test]
fn stranger_captures_direct_successor_and_player_reveals() {
    let mut w = World::new();
    let player = w.actor();
    let stranger = w.actor();
    let salt = [7u8; 32];
    let c = commit(&player.pubkey(), 1, 1, 6500, &salt);
    w.put_pyth(0, pyth_receiver(), 10_000, -8, NOW - 20, NOW - 1);
    w.open(&player, 1, c, 0).unwrap();
    let open = w.shot(&player.pubkey(), 1);
    assert_eq!(state(&open), 0);
    assert_eq!(entry_publish(&open), NOW - 1);

    w.set_clock(NOW + 10);
    w.put_pyth(0, pyth_receiver(), 10_001, -8, NOW - 1, NOW + 10);
    w.observe(&stranger, &player.pubkey(), 1, 0).unwrap();
    let captured = w.shot(&player.pubkey(), 1);
    assert_eq!(state(&captured), 1);
    assert_eq!(outcome(&captured), 1);
    assert_eq!(exit_publish(&captured), NOW + 10);

    w.reveal(&player, 1, 1, 6500, salt).unwrap();
    let revealed = w.shot(&player.pubkey(), 1);
    assert_eq!(state(&revealed), 2);
    assert_eq!(hit(&revealed), 1);
}

#[test]
fn later_print_cannot_replace_a_missed_successor() {
    let mut w = World::new();
    let player = w.actor();
    let actor = w.actor();
    w.put_pyth(0, pyth_receiver(), 10_000, -8, NOW - 20, NOW - 1);
    w.open(&player, 2, [3; 32], 0).unwrap();
    w.set_clock(NOW + 20);
    w.put_pyth(0, pyth_receiver(), 11_000, -8, NOW + 10, NOW + 20);
    w.observe(&actor, &player.pubkey(), 2, 0).unwrap();
    assert_eq!(state(&w.shot(&player.pubkey(), 2)), 4);
}

#[test]
fn same_print_is_noop_but_same_time_revision_voids() {
    let mut w = World::new();
    let player = w.actor();
    let actor = w.actor();
    w.put_pyth(0, pyth_receiver(), 10_000, -8, NOW - 20, NOW - 1);
    w.open(&player, 3, [4; 32], 0).unwrap();
    let before = w.shot(&player.pubkey(), 3);
    w.observe(&actor, &player.pubkey(), 3, 0).unwrap();
    assert_eq!(w.shot(&player.pubkey(), 3), before);

    w.put_pyth(0, pyth_receiver(), 10_001, -8, NOW - 20, NOW - 1);
    w.observe(&actor, &player.pubkey(), 3, 0).unwrap();
    assert_eq!(state(&w.shot(&player.pubkey(), 3)), 5);
}

#[test]
fn scale_change_and_equality_are_fail_closed() {
    let mut w = World::new();
    let player = w.actor();
    let actor = w.actor();
    w.put_pyth(0, pyth_receiver(), 10_000, -8, NOW - 20, NOW - 1);
    w.open(&player, 4, [4; 32], 0).unwrap();
    w.set_clock(NOW + 10);
    w.put_pyth(0, pyth_receiver(), 100_000, -9, NOW - 1, NOW + 10);
    w.observe(&actor, &player.pubkey(), 4, 0).unwrap();
    assert_eq!(state(&w.shot(&player.pubkey(), 4)), 7);

    w.set_clock(NOW + 20);
    w.put_pyth(0, pyth_receiver(), 10_000, -8, NOW + 10, NOW + 20);
    w.open(&player, 5, [5; 32], 0).unwrap();
    w.set_clock(NOW + 30);
    w.put_pyth(0, pyth_receiver(), 10_000, -8, NOW + 20, NOW + 30);
    w.observe(&actor, &player.pubkey(), 5, 0).unwrap();
    assert_eq!(state(&w.shot(&player.pubkey(), 5)), 3);
}

#[test]
fn timeout_boundary_and_wrong_owner_are_exact() {
    let mut w = World::new();
    let player = w.actor();
    let actor = w.actor();
    w.put_pyth(0, Pubkey::new_unique(), 10_000, -8, NOW - 20, NOW - 1);
    assert_err(w.open(&player, 6, [6; 32], 0), "WrongReceiverOwner");
    w.put_pyth(0, pyth_receiver(), 10_000, -8, NOW - 20, NOW - 1);
    w.open(&player, 6, [6; 32], 0).unwrap();
    w.set_clock(NOW + 299);
    assert_err(w.timeout(&actor, &player.pubkey(), 6), "DeadlineOpen");
    w.set_clock(NOW + 300);
    w.timeout(&actor, &player.pubkey(), 6).unwrap();
    assert_eq!(state(&w.shot(&player.pubkey(), 6)), 8);
}

#[test]
fn fresh_tokenized_stock_uses_the_same_transaction_path() {
    let mut w = World::new();
    let player = w.actor();
    let actor = w.actor();
    w.put_pyth(1, pyth_receiver(), 25_000, -8, NOW - 30, NOW - 1);
    w.open(&player, 7, [7; 32], 1).unwrap();
    w.set_clock(NOW + 870);
    w.put_pyth(1, pyth_receiver(), 25_010, -8, NOW - 1, NOW + 870);
    w.observe(&actor, &player.pubkey(), 7, 1).unwrap();
    let shot = w.shot(&player.pubkey(), 7);
    assert_eq!(state(&shot), 1);
    assert_eq!(outcome(&shot), 1);
}

#[test]
fn real_mainnet_receiver_tslax_snapshot_is_accepted_as_entry() {
    const PUBLISH_TIME: i64 = 1_788_464_846;
    const DATA_HEX: &str = "22f123639d7ef4cde0b968d731bed8056913169aa1dfced294f95f219c56434bce289640dcf129e10147a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362dc4257d008000000e1ff7f0100000000f8ffffffcece996a00000000cdce996a000000006e0946df080000000a220b0100000000f0bc771a0000000000";
    let mut w = World::new();
    let player = w.actor();
    w.set_clock(PUBLISH_TIME);
    w.put_raw_pyth(1, pyth_receiver(), DATA_HEX);
    w.open(&player, 8, [8; 32], 1).unwrap();
    let shot = w.shot(&player.pubkey(), 8);
    assert_eq!(state(&shot), 0);
    assert_eq!(entry_publish(&shot), PUBLISH_TIME);
}

#[test]
fn stranger_closes_only_terminal_shots_and_rent_returns_to_player() {
    let mut w = World::new();
    let player = w.actor();
    let stranger = w.actor();
    let salt = [9u8; 32];
    let commitment = commit(&player.pubkey(), 9, 1, 5000, &salt);
    w.put_pyth(0, pyth_receiver(), 10_000, -8, NOW - 20, NOW - 1);
    w.open(&player, 9, commitment, 0).unwrap();
    assert_err(w.close(&stranger, &player.pubkey(), 9), "ShotNotClosable");
    w.set_clock(NOW + 10);
    w.put_pyth(0, pyth_receiver(), 10_001, -8, NOW - 1, NOW + 10);
    w.observe(&stranger, &player.pubkey(), 9, 0).unwrap();
    assert_err(w.close(&stranger, &player.pubkey(), 9), "ShotNotClosable");
    w.reveal(&player, 9, 1, 5000, salt).unwrap();
    let before = w.svm.get_account(&player.pubkey()).unwrap().lamports;
    w.close(&stranger, &player.pubkey(), 9).unwrap();
    let after = w.svm.get_account(&player.pubkey()).unwrap().lamports;
    assert!(
        after > before,
        "Shot rent must return to the recorded player"
    );
    assert!(w.svm.get_account(&shot_pda(&player.pubkey(), 9)).is_none());
}
