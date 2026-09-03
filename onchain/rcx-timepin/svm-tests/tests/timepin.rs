//! Transaction-level tests for the compiled Timepin SBF program. The Pyth
//! accounts are byte-exact, hand-built Receiver v2 accounts. No RPC, network,
//! API key, deployment key, validator, token, or value integration is used.

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
const TARGET: i64 = NOW + 300;
const WINDOW: i64 = 180;
const SCHEMA: u16 = 1;
const FEED: [u8; 32] = [7; 32];
const NEED_STATE_OPEN: u8 = 0;
const NEED_STATE_CANDIDATE: u8 = 1;
const NEED_STATE_FINAL: u8 = 2;
const NEED_STATE_AMBIGUOUS: u8 = 3;
const NEED_STATE_EXPIRED: u8 = 4;

fn program_id() -> Pubkey {
    Pubkey::from_str("Fg6PaFpoGXkYsidMpWxTWqkZgYHFwD4GwxV6Wt5VwFQ").unwrap()
}

fn pyth_receiver() -> Pubkey {
    Pubkey::from_str("rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp").unwrap()
}

fn pyth_push_oracle() -> Pubkey {
    Pubkey::from_str("pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou").unwrap()
}

fn so_path() -> PathBuf {
    if let Ok(path) = std::env::var("RCX_TIMEPIN_SO") {
        return path.into();
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("target")
        .join("deploy")
        .join("rcx_timepin.so")
}

fn discriminator(kind: &str, name: &str) -> [u8; 8] {
    let hash = Sha256::digest(format!("{kind}:{name}").as_bytes());
    let mut out = [0u8; 8];
    out.copy_from_slice(&hash[..8]);
    out
}

fn sponsored_price_address(feed: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[&0u16.to_le_bytes(), feed], &pyth_push_oracle()).0
}

fn need_address(feed: &[u8; 32], target: i64) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"need",
            &SCHEMA.to_le_bytes(),
            pyth_push_oracle().as_ref(),
            feed,
            &target.to_le_bytes(),
        ],
        &program_id(),
    )
    .0
}

fn account_state(data: &[u8]) -> u8 {
    data[11]
}

fn candidate_count(data: &[u8]) -> u8 {
    data[140]
}

fn candidate_hash_a(data: &[u8]) -> &[u8] {
    &data[143..175]
}

fn candidate_hash_b(data: &[u8]) -> &[u8] {
    &data[381..413]
}

struct World {
    svm: LiteSVM,
    now: i64,
    actor: Keypair,
}

impl World {
    fn new() -> Self {
        Self::with_actor(Keypair::new())
    }

    fn with_actor(actor: Keypair) -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program_from_file(program_id(), so_path())
            .expect("load compiled Timepin SBF");
        svm.airdrop(&actor.pubkey(), 10_000_000_000)
            .expect("fund transaction caller");
        let mut world = Self {
            svm,
            now: NOW,
            actor,
        };
        world.set_clock(NOW);
        world
    }

    fn set_clock(&mut self, unix_timestamp: i64) {
        self.now = unix_timestamp;
        self.svm.set_sysvar(&Clock {
            slot: (unix_timestamp as u64) * 2,
            epoch_start_timestamp: NOW - 1_000,
            epoch: 1,
            leader_schedule_epoch: 1,
            unix_timestamp,
        });
    }

    fn slot(&self) -> u64 {
        (self.now as u64) * 2
    }

    fn send(&mut self, instruction: Instruction) -> Result<(), String> {
        self.svm.expire_blockhash();
        let blockhash = self.svm.latest_blockhash();
        let transaction = Transaction::new_signed_with_payer(
            &[instruction],
            Some(&self.actor.pubkey()),
            &[&self.actor],
            blockhash,
        );
        self.svm
            .send_transaction(transaction)
            .map(|_| ())
            .map_err(|error| format!("{}\n{:?}", error.meta.logs.join("\n"), error.err))
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

    fn open(&mut self, target: i64) -> Result<(), String> {
        let mut args = FEED.to_vec();
        args.extend_from_slice(&target.to_le_bytes());
        let instruction = self.instruction(
            "open_need",
            args,
            vec![
                AccountMeta::new(self.actor.pubkey(), true),
                AccountMeta::new(need_address(&FEED, target), false),
                AccountMeta::new_readonly(system_program::id(), false),
            ],
        );
        self.send(instruction)
    }

    fn capture_from(&mut self, price_account: Pubkey, target: i64) -> Result<(), String> {
        let instruction = self.instruction(
            "capture",
            Vec::new(),
            vec![
                AccountMeta::new_readonly(self.actor.pubkey(), true),
                AccountMeta::new(need_address(&FEED, target), false),
                AccountMeta::new_readonly(price_account, false),
            ],
        );
        self.send(instruction)
    }

    fn capture(&mut self, target: i64) -> Result<(), String> {
        self.capture_from(sponsored_price_address(&FEED), target)
    }

    fn advance_instruction(&mut self, name: &str, target: i64) -> Result<(), String> {
        let instruction = self.instruction(
            name,
            Vec::new(),
            vec![
                AccountMeta::new_readonly(self.actor.pubkey(), true),
                AccountMeta::new(need_address(&FEED, target), false),
            ],
        );
        self.send(instruction)
    }

    fn need_data(&self, target: i64) -> Vec<u8> {
        self.svm
            .get_account(&need_address(&FEED, target))
            .expect("Need account")
            .data
    }

    fn put_pyth_value(
        &mut self,
        account_key: Pubkey,
        owner: Pubkey,
        write_authority: Pubkey,
        full: bool,
        price: i64,
        conf: u64,
        prev_publish_time: i64,
        publish_time: i64,
    ) {
        let mut data = Vec::with_capacity(134);
        data.extend_from_slice(&discriminator("account", "PriceUpdateV2"));
        data.extend_from_slice(write_authority.as_ref());
        if full {
            data.push(1); // Borsh VerificationLevel::Full
        } else {
            data.extend_from_slice(&[0, 1]); // Partial { num_signatures: 1 }
        }
        data.extend_from_slice(&FEED);
        data.extend_from_slice(&price.to_le_bytes());
        data.extend_from_slice(&conf.to_le_bytes());
        data.extend_from_slice(&(-6i32).to_le_bytes());
        data.extend_from_slice(&publish_time.to_le_bytes());
        data.extend_from_slice(&prev_publish_time.to_le_bytes());
        data.extend_from_slice(&price.to_le_bytes());
        data.extend_from_slice(&conf.to_le_bytes());
        data.extend_from_slice(&self.slot().to_le_bytes());
        data.resize(134, 0);
        self.svm
            .set_account(
                account_key,
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

    fn put_pyth(
        &mut self,
        account_key: Pubkey,
        owner: Pubkey,
        write_authority: Pubkey,
        full: bool,
        prev_publish_time: i64,
        publish_time: i64,
    ) {
        self.put_pyth_value(
            account_key,
            owner,
            write_authority,
            full,
            12_345_678,
            12_345,
            prev_publish_time,
            publish_time,
        );
    }

    fn put_valid_pyth(&mut self, prev_publish_time: i64, publish_time: i64) {
        let address = sponsored_price_address(&FEED);
        self.put_pyth(
            address,
            pyth_receiver(),
            address,
            true,
            prev_publish_time,
            publish_time,
        );
    }

    fn put_valid_pyth_value(
        &mut self,
        price: i64,
        conf: u64,
        prev_publish_time: i64,
        publish_time: i64,
    ) {
        let address = sponsored_price_address(&FEED);
        self.put_pyth_value(
            address,
            pyth_receiver(),
            address,
            true,
            price,
            conf,
            prev_publish_time,
            publish_time,
        );
    }
}

#[test]
fn canonical_need_runs_open_candidate_final_life_cycle() {
    let mut world = World::new();
    world.open(TARGET).unwrap();
    let opened = world.need_data(TARGET);
    assert_eq!(opened.len(), 8 + 657);
    assert_eq!(account_state(&opened), NEED_STATE_OPEN);
    assert_eq!(candidate_count(&opened), 0);

    world.put_valid_pyth(TARGET - 1, TARGET);
    assert!(world.capture(TARGET).is_err()); // source exists, target not reached
    world.set_clock(TARGET);
    world.put_valid_pyth(TARGET - 1, TARGET);
    world.capture(TARGET).unwrap();
    let candidate = world.need_data(TARGET);
    assert_eq!(account_state(&candidate), NEED_STATE_CANDIDATE);
    assert_eq!(candidate_count(&candidate), 1);

    world.capture(TARGET).unwrap(); // exact source replay is idempotent
    assert_eq!(candidate_count(&world.need_data(TARGET)), 1);
    assert!(world.advance_instruction("finalize", TARGET).is_err());
    world.set_clock(TARGET + WINDOW);
    world.advance_instruction("finalize", TARGET).unwrap();
    assert_eq!(account_state(&world.need_data(TARGET)), NEED_STATE_FINAL);
    assert!(world.capture(TARGET).is_err());
    assert!(world.advance_instruction("expire", TARGET).is_err());
}

#[test]
fn both_submission_orders_produce_identical_sorted_message_hashes() {
    fn run(first: (i64, i64), second: (i64, i64), actor_bytes: &[u8]) -> Vec<u8> {
        let actor = Keypair::try_from(actor_bytes).unwrap();
        let mut world = World::with_actor(actor);
        world.open(TARGET).unwrap();
        world.set_clock(TARGET + 1);
        world.put_valid_pyth(first.0, first.1);
        world.capture(TARGET).unwrap();
        world.set_clock(TARGET + 2);
        world.put_valid_pyth(second.0, second.1);
        world.capture(TARGET).unwrap();

        let ambiguous = world.need_data(TARGET);
        assert_eq!(account_state(&ambiguous), NEED_STATE_AMBIGUOUS);
        assert_eq!(candidate_count(&ambiguous), 2);
        assert!(candidate_hash_a(&ambiguous) < candidate_hash_b(&ambiguous));
        assert!(world.capture(TARGET).is_err());
        world.set_clock(TARGET + WINDOW);
        assert!(world.advance_instruction("finalize", TARGET).is_err());
        assert!(world.advance_instruction("expire", TARGET).is_err());

        ambiguous
    }

    let message_a = (TARGET - 2, TARGET);
    let message_b = (TARGET - 1, TARGET + 1);
    let ephemeral_actor = Keypair::new();
    let actor_bytes = ephemeral_actor.to_bytes();
    let account_ab = run(message_a, message_b, actor_bytes.as_ref());
    let account_ba = run(message_b, message_a, actor_bytes.as_ref());
    assert_eq!(account_state(&account_ab), account_state(&account_ba));
    assert_eq!(candidate_count(&account_ab), candidate_count(&account_ba));
    assert_eq!(candidate_hash_a(&account_ab), candidate_hash_a(&account_ba));
    assert_eq!(candidate_hash_b(&account_ab), candidate_hash_b(&account_ba));
    // Capture time/slot belong to the message actually observed at that time.
    // Reversing observations must not erase that provenance, so complete
    // account bytes are intentionally not an order-independent invariant.
    assert_ne!(account_ab, account_ba);
}

#[test]
fn prefunded_need_pda_initializes_once_without_dust_squatting() {
    let mut world = World::new();
    let need = need_address(&FEED, TARGET);
    world
        .svm
        .airdrop(&need, 1)
        .expect("pre-fund canonical Need PDA with one lamport");
    let prefunded = world.svm.get_account(&need).expect("pre-funded PDA");
    assert_eq!(prefunded.owner, system_program::id());
    assert!(prefunded.data.is_empty());

    world.open(TARGET).unwrap();
    let initialized = world.svm.get_account(&need).expect("initialized Need");
    assert_eq!(initialized.owner, program_id());
    assert_eq!(initialized.data.len(), 8 + 657);
    assert_eq!(account_state(&initialized.data), NEED_STATE_OPEN);
    assert!(world.open(TARGET).is_err());
}

#[test]
fn same_publish_revision_with_distinct_raw_value_is_ambiguous() {
    let mut world = World::new();
    world.open(TARGET).unwrap();
    world.set_clock(TARGET + 1);
    world.put_valid_pyth_value(12_345_678, 12_345, TARGET - 1, TARGET);
    world.capture(TARGET).unwrap();
    world.put_valid_pyth_value(12_345_679, 12_346, TARGET - 1, TARGET);
    world.capture(TARGET).unwrap();

    let revised = world.need_data(TARGET);
    assert_eq!(account_state(&revised), NEED_STATE_AMBIGUOUS);
    assert_eq!(candidate_count(&revised), 2);
    assert_ne!(candidate_hash_a(&revised), candidate_hash_b(&revised));
    assert!(candidate_hash_a(&revised) < candidate_hash_b(&revised));
}

#[test]
fn bad_source_is_rejected_and_unanswered_need_expires() {
    let mut world = World::new();
    assert!(world.open(NOW).is_err()); // explicit late/open-at-target rejection
    assert!(world.svm.get_account(&need_address(&FEED, NOW)).is_none());
    assert!(world.open(NOW + 31).is_err()); // not on the 5-second grid
    assert!(world
        .svm
        .get_account(&need_address(&FEED, NOW + 31))
        .is_none());

    world.open(TARGET).unwrap();
    world.set_clock(TARGET);
    let expected = sponsored_price_address(&FEED);
    world.put_pyth(
        expected,
        Pubkey::new_unique(),
        expected,
        true,
        TARGET - 1,
        TARGET,
    );
    assert!(world.capture(TARGET).is_err());
    world.put_pyth(
        expected,
        pyth_receiver(),
        expected,
        false,
        TARGET - 1,
        TARGET,
    );
    assert!(world.capture(TARGET).is_err());
    let fake = Pubkey::new_unique();
    world.put_pyth(fake, pyth_receiver(), fake, true, TARGET - 1, TARGET);
    assert!(world.capture_from(fake, TARGET).is_err());
}

#[test]
fn complete_oracle_withholding_becomes_terminal_expired() {
    let mut world = World::new();
    world.open(TARGET).unwrap();
    world.set_clock(TARGET + WINDOW);
    assert!(world.capture(TARGET).is_err()); // no oracle account was submitted
    world.advance_instruction("expire", TARGET).unwrap();
    assert_eq!(account_state(&world.need_data(TARGET)), NEED_STATE_EXPIRED);
    assert_eq!(candidate_count(&world.need_data(TARGET)), 0);
    assert!(world.advance_instruction("expire", TARGET).is_err());
    assert!(world.advance_instruction("finalize", TARGET).is_err());
}
