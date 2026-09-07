//! RatchetX Next Print v2: direct sponsored-Pyth successor capture plus a
//! durable completion receipt that a separate RCX Work Market can consume.
//!
//! Canonical play never calls the reward program. Anyone may materialize the
//! receipt after useful work, and the receipt fixes the original worker and
//! terminal result. Existing deployed Next Print v1 is a separate generation.

use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::{
    price_update::{PriceUpdateV2, VerificationLevel},
    ID_CONST as PYTH_RECEIVER_ID, PYTH_PUSH_ORACLE_ID,
};
use solana_sha256_hasher::hashv;

declare_id!("2TV2zagBZaDXXYjduLrRbiDGGsR8jXNqYAuLDE4j4tyR");

pub const SCHEMA_VERSION: u16 = 2;
pub const COMPLETION_SCHEMA_VERSION: u16 = 1;
pub const ADAPTER_PYTH_PUSH_V1: u16 = 1;
pub const WORK_KIND_NEXT_PRINT_TERMINALIZE: u8 = 1;
pub const RECEIPT_PAYABLE: u8 = 1;
pub const RECEIPT_NONPAYABLE: u8 = 2;
pub const NO_COMPLETION_STATE: u8 = u8::MAX;
pub const SHARD_ID: u16 = 0;
pub const MAX_FUTURE_SKEW_SECS: i64 = 5;
pub const MAX_CONF_BPS: u128 = 200;
pub const REVEAL_WINDOW_SECS: i64 = 3_600;
pub const RULESET_HASH: [u8; 32] =
    hex32(b"78b15cfe2ac9f4c69f60d42a65b544f143ea9a253efbde2f890a26549a15b3f0");

pub const FEEDS: [[u8; 32]; 7] = [
    hex32(b"ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"), // SOL
    hex32(b"47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362"), // TSLAX
    hex32(b"4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f"), // NVDAX
    hex32(b"2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14"), // SPYX
    hex32(b"978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675"), // AAPLX
    hex32(b"53f95ba4e23ed15ea56083e2ee9a5eec48055d6f59033d4bb95f1ca2a2349c28"), // MSTRX
    hex32(b"c13184461c0c80d98ffcd89be627c2220b94a96c7c67f0c4b16bc12fd3b17758"), // CRCLX
];
pub const MAX_ENTRY_AGE_SECS: [i64; 7] = [30, 120, 120, 120, 120, 120, 120];
pub const MAX_WAIT_SECS: [i64; 7] = [300, 7_200, 7_200, 7_200, 7_200, 7_200, 7_200];

const fn hex_nibble(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        _ => panic!("bad hex"),
    }
}

#[repr(u8)]
pub enum ShotState {
    Open = 0,
    Captured = 1,
    Revealed = 2,
    VoidEqual = 3,
    VoidMissedSuccessor = 4,
    VoidSourceRevision = 5,
    VoidSourceChain = 6,
    VoidScaleChange = 7,
    VoidTimeout = 8,
    Forfeited = 9,
}

#[event]
pub struct ShotOpened {
    pub shot: Pubkey,
    pub player: Pubkey,
    pub feed_id: [u8; 32],
    pub entry_publish_time: i64,
    pub deadline_ts: i64,
}

#[event]
pub struct ShotObserved {
    pub shot: Pubkey,
    pub actor: Pubkey,
    pub state: u8,
    pub outcome: i8,
    pub exit_publish_time: i64,
}

#[event]
pub struct ShotRevealed {
    pub shot: Pubkey,
    pub player: Pubkey,
    pub side: u8,
    pub p_bps: u16,
    pub hit: u8,
}

#[event]
pub struct ShotForfeited {
    pub shot: Pubkey,
    pub actor: Pubkey,
}

#[event]
pub struct CompletionReceiptWritten {
    pub receipt: Pubkey,
    pub subject: Pubkey,
    pub payer: Pubkey,
    pub disposition: u8,
    pub worker: Pubkey,
    pub result_hash: [u8; 32],
}

#[event]
pub struct ShotClosed {
    pub shot: Pubkey,
    pub actor: Pubkey,
    pub player: Pubkey,
    pub receipt: Pubkey,
}

#[error_code]
pub enum NextPrintV2Error {
    #[msg("feed is not in this ruleset")]
    FeedNotAllowed,
    #[msg("price account is executable")]
    ExecutableSource,
    #[msg("price account has the wrong owner")]
    WrongReceiverOwner,
    #[msg("price account is not the pinned sponsored PDA")]
    WrongSourcePda,
    #[msg("price account length is wrong")]
    BadPriceAccountLength,
    #[msg("price account bytes are invalid")]
    BadPriceAccountData,
    #[msg("Pyth verification is not Full")]
    PartialVerification,
    #[msg("Pyth write authority is wrong")]
    WrongWriteAuthority,
    #[msg("Pyth posted slot is in the future")]
    PostedSlotInFuture,
    #[msg("feed does not match the shot")]
    WrongFeed,
    #[msg("source interval is invalid")]
    BadSourceInterval,
    #[msg("price is invalid")]
    BadPrice,
    #[msg("exponent is outside the ruleset")]
    BadExponent,
    #[msg("oracle time is in the future")]
    OracleTimeInFuture,
    #[msg("confidence is too wide")]
    ConfidenceTooWide,
    #[msg("entry is stale")]
    StaleEntry,
    #[msg("shot is terminal")]
    TerminalShot,
    #[msg("source time regressed")]
    SourceRegression,
    #[msg("shot deadline is still open")]
    DeadlineOpen,
    #[msg("shot schema is wrong")]
    WrongSchema,
    #[msg("shot adapter is wrong")]
    WrongAdapter,
    #[msg("shot ruleset is wrong")]
    WrongRuleset,
    #[msg("shot deadline is corrupt")]
    CorruptDeadline,
    #[msg("shot completion fields are corrupt")]
    CorruptCompletion,
    #[msg("shot completion is already recorded")]
    CompletionAlreadyRecorded,
    #[msg("a durable receipt already tombstones this shot address")]
    CompletionAlreadyExists,
    #[msg("completion receipt PDA is wrong")]
    WrongCompletionReceiptPda,
    #[msg("completion receipt does not match the shot")]
    WrongCompletionReceipt,
    #[msg("shot is in the wrong state")]
    WrongState,
    #[msg("side must be DOWN=0 or UP=1")]
    BadSide,
    #[msg("probability must be 0..10000 basis points")]
    BadProbability,
    #[msg("reveal commitment does not match")]
    CommitMismatch,
    #[msg("reveal window has closed")]
    RevealWindowClosed,
    #[msg("reveal window is still open")]
    RevealWindowOpen,
    #[msg("integer arithmetic overflow")]
    MathOverflow,
    #[msg("shot has not reached a safely closable terminal state")]
    ShotNotClosable,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn evidence(publish: i64, prev: i64, hash: u8) -> EvidenceRecord {
        EvidenceRecord {
            source_account: sponsored_price_address(&FEEDS[0]),
            message_hash: [hash; 32],
            price: 100,
            conf: 1,
            exponent: -8,
            publish_time: publish,
            prev_publish_time: prev,
            posted_slot: 1,
        }
    }

    fn sample_shot(player: Pubkey) -> NextPrintShot {
        NextPrintShot {
            schema_version: SCHEMA_VERSION,
            bump: 1,
            state: ShotState::Captured as u8,
            adapter_id: ADAPTER_PYTH_PUSH_V1,
            ruleset_hash: RULESET_HASH,
            player,
            nonce: 7,
            commit: [3; 32],
            feed_index: 0,
            feed_id: FEEDS[0],
            opened_ts: 100,
            deadline_ts: 400,
            entry: evidence(100, 90, 4),
            exit: evidence(110, 100, 5),
            outcome: 1,
            completion_state: NO_COMPLETION_STATE,
            completion_disposition: 0,
            completion_worker: Pubkey::default(),
            completion_result_hash: [0; 32],
            completion_slot: 0,
            completion_ts: 0,
            side: 2,
            p_bps: 0,
            hit: 2,
        }
    }

    #[test]
    fn only_direct_successor_can_be_an_outcome() {
        let entry = evidence(100, 90, 1);
        assert_eq!(
            successor_disposition(&entry, &entry).unwrap(),
            Disposition::Same
        );
        assert_eq!(
            successor_disposition(&entry, &evidence(110, 100, 2)).unwrap(),
            Disposition::Successor
        );
        assert_eq!(
            successor_disposition(&entry, &evidence(120, 110, 3)).unwrap(),
            Disposition::Missed
        );
        assert_eq!(
            successor_disposition(&entry, &evidence(110, 95, 4)).unwrap(),
            Disposition::BrokenChain
        );
        assert_eq!(
            successor_disposition(&entry, &evidence(100, 90, 9)).unwrap(),
            Disposition::Revision
        );
        assert!(successor_disposition(&entry, &evidence(99, 89, 5)).is_err());
        assert_eq!(
            receipt_disposition_for(Disposition::Successor),
            RECEIPT_PAYABLE
        );
        assert_eq!(
            receipt_disposition_for(Disposition::Missed),
            RECEIPT_NONPAYABLE
        );
        assert_eq!(
            receipt_disposition_for(Disposition::Revision),
            RECEIPT_NONPAYABLE
        );
        assert_eq!(
            receipt_disposition_for(Disposition::BrokenChain),
            RECEIPT_NONPAYABLE
        );
    }

    #[test]
    fn policies_layouts_and_identities_are_pinned() {
        assert_eq!(feed_policy(0).unwrap().max_wait_secs, 300);
        assert_eq!(feed_policy(1).unwrap().max_wait_secs, 7_200);
        assert!(feed_policy(7).is_err());
        assert_eq!(EvidenceRecord::LEN, 108);
        assert_eq!(NextPrintShot::LEN, 462);
        assert_eq!(CompletionReceipt::LEN, 117);
        assert_eq!(
            crate::ID.to_string(),
            "2TV2zagBZaDXXYjduLrRbiDGGsR8jXNqYAuLDE4j4tyR"
        );
        assert_ne!(crate::ID, PYTH_RECEIVER_ID);
        assert_ne!(crate::ID, PYTH_PUSH_ORACLE_ID);
    }

    #[test]
    fn completion_hash_survives_later_reveal_state() {
        let player = Pubkey::new_unique();
        let worker = Pubkey::new_unique();
        let subject = Pubkey::new_unique();
        let mut shot = sample_shot(player);
        let clock = Clock {
            slot: 99,
            epoch_start_timestamp: 0,
            epoch: 0,
            leader_schedule_epoch: 0,
            unix_timestamp: 200,
        };
        record_completion(subject, &mut shot, worker, RECEIPT_PAYABLE, &clock).unwrap();
        let fixed = shot.completion_result_hash;
        assert_eq!(shot.completion_worker, worker);
        assert_eq!(shot.completion_state, ShotState::Captured as u8);
        shot.state = ShotState::Revealed as u8;
        shot.side = 1;
        shot.p_bps = 6_000;
        shot.hit = 1;
        assert_eq!(completion_result_hash(&subject, &shot), fixed);
        authenticate_completion_fields(&shot).unwrap();
    }

    #[test]
    fn failure_terminals_are_never_payable() {
        let clock = Clock {
            slot: 7,
            epoch_start_timestamp: 0,
            epoch: 0,
            leader_schedule_epoch: 0,
            unix_timestamp: 500,
        };
        for state in [
            ShotState::VoidMissedSuccessor,
            ShotState::VoidSourceRevision,
            ShotState::VoidSourceChain,
            ShotState::VoidTimeout,
        ] {
            let mut shot = sample_shot(Pubkey::new_unique());
            shot.state = state as u8;
            record_completion(
                Pubkey::new_unique(),
                &mut shot,
                Pubkey::new_unique(),
                RECEIPT_NONPAYABLE,
                &clock,
            )
            .unwrap();
            assert_eq!(shot.completion_worker, Pubkey::default());
            assert_eq!(shot.completion_disposition, RECEIPT_NONPAYABLE);
        }
    }
}

fn feed_policy(index: u8) -> Result<FeedPolicy> {
    let i = usize::from(index);
    require!(i < FEEDS.len(), NextPrintV2Error::FeedNotAllowed);
    Ok(FeedPolicy {
        feed_id: FEEDS[i],
        max_entry_age_secs: MAX_ENTRY_AGE_SECS[i],
        max_wait_secs: MAX_WAIT_SECS[i],
    })
}

fn sponsored_price_address(feed_id: &[u8; 32]) -> Pubkey {
    let shard = SHARD_ID.to_le_bytes();
    Pubkey::find_program_address(&[shard.as_ref(), feed_id.as_ref()], &PYTH_PUSH_ORACLE_ID).0
}

pub fn completion_receipt_address(subject: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            b"completion",
            subject.as_ref(),
            &[WORK_KIND_NEXT_PRINT_TERMINALIZE],
        ],
        &crate::ID,
    )
}

fn load_evidence(
    account: &AccountInfo,
    expected_feed: [u8; 32],
    clock: &Clock,
) -> Result<EvidenceRecord> {
    require!(!account.executable, NextPrintV2Error::ExecutableSource);
    require!(
        *account.owner == PYTH_RECEIVER_ID,
        NextPrintV2Error::WrongReceiverOwner
    );
    require!(
        account.data_len() == PriceUpdateV2::LEN,
        NextPrintV2Error::BadPriceAccountLength
    );
    let expected_source = sponsored_price_address(&expected_feed);
    require!(
        account.key() == expected_source,
        NextPrintV2Error::WrongSourcePda
    );

    let data = account
        .try_borrow_data()
        .map_err(|_| error!(NextPrintV2Error::BadPriceAccountData))?;
    let mut slice: &[u8] = &data;
    let update = PriceUpdateV2::try_deserialize(&mut slice)
        .map_err(|_| error!(NextPrintV2Error::BadPriceAccountData))?;
    require!(
        matches!(update.verification_level, VerificationLevel::Full),
        NextPrintV2Error::PartialVerification
    );
    require!(
        update.write_authority == expected_source,
        NextPrintV2Error::WrongWriteAuthority
    );
    require!(
        update.posted_slot <= clock.slot,
        NextPrintV2Error::PostedSlotInFuture
    );
    let msg = &update.price_message;
    require!(msg.feed_id == expected_feed, NextPrintV2Error::WrongFeed);
    require!(
        msg.prev_publish_time < msg.publish_time,
        NextPrintV2Error::BadSourceInterval
    );
    require!(msg.price > 0, NextPrintV2Error::BadPrice);
    require!(msg.exponent.abs() <= 12, NextPrintV2Error::BadExponent);
    let newest = clock
        .unix_timestamp
        .checked_add(MAX_FUTURE_SKEW_SECS)
        .ok_or(NextPrintV2Error::MathOverflow)?;
    require!(
        msg.publish_time <= newest,
        NextPrintV2Error::OracleTimeInFuture
    );
    let lhs = u128::from(msg.conf)
        .checked_mul(10_000)
        .ok_or(NextPrintV2Error::MathOverflow)?;
    let rhs = u128::from(msg.price.unsigned_abs())
        .checked_mul(MAX_CONF_BPS)
        .ok_or(NextPrintV2Error::MathOverflow)?;
    require!(lhs <= rhs, NextPrintV2Error::ConfidenceTooWide);

    let message_hash = hashv(&[
        b"RATCHET_NEXT_PRINT_EVIDENCE_V2",
        msg.feed_id.as_ref(),
        &msg.price.to_le_bytes(),
        &msg.conf.to_le_bytes(),
        &msg.exponent.to_le_bytes(),
        &msg.publish_time.to_le_bytes(),
        &msg.prev_publish_time.to_le_bytes(),
        &update.posted_slot.to_le_bytes(),
        account.key.as_ref(),
    ])
    .to_bytes();
    Ok(EvidenceRecord {
        source_account: account.key(),
        message_hash,
        price: msg.price,
        conf: msg.conf,
        exponent: msg.exponent,
        publish_time: msg.publish_time,
        prev_publish_time: msg.prev_publish_time,
        posted_slot: update.posted_slot,
    })
}

fn authenticate_shot(shot: &NextPrintShot) -> Result<()> {
    require!(
        shot.schema_version == SCHEMA_VERSION,
        NextPrintV2Error::WrongSchema
    );
    require!(
        shot.adapter_id == ADAPTER_PYTH_PUSH_V1,
        NextPrintV2Error::WrongAdapter
    );
    require!(
        shot.ruleset_hash == RULESET_HASH,
        NextPrintV2Error::WrongRuleset
    );
    let policy = feed_policy(shot.feed_index)?;
    require!(shot.feed_id == policy.feed_id, NextPrintV2Error::WrongFeed);
    let expected_deadline = shot
        .opened_ts
        .checked_add(policy.max_wait_secs)
        .ok_or(NextPrintV2Error::MathOverflow)?;
    require!(
        shot.deadline_ts == expected_deadline,
        NextPrintV2Error::CorruptDeadline
    );
    require!(
        shot.entry.source_account == sponsored_price_address(&shot.feed_id),
        NextPrintV2Error::WrongSourcePda
    );
    if shot.state == ShotState::Open as u8 {
        require!(
            shot.completion_state == NO_COMPLETION_STATE
                && shot.completion_disposition == 0
                && shot.completion_worker == Pubkey::default()
                && shot.completion_result_hash == [0; 32]
                && shot.completion_slot == 0
                && shot.completion_ts == 0,
            NextPrintV2Error::CorruptCompletion
        );
    } else {
        authenticate_completion_fields(shot)?;
    }
    Ok(())
}

fn authenticate_completion_fields(shot: &NextPrintShot) -> Result<()> {
    require!(
        matches!(
            shot.completion_state,
            x if x == ShotState::Captured as u8
                || x == ShotState::VoidEqual as u8
                || x == ShotState::VoidMissedSuccessor as u8
                || x == ShotState::VoidSourceRevision as u8
                || x == ShotState::VoidSourceChain as u8
                || x == ShotState::VoidScaleChange as u8
                || x == ShotState::VoidTimeout as u8
        ),
        NextPrintV2Error::CorruptCompletion
    );
    require!(
        shot.completion_slot > 0 && shot.completion_result_hash != [0; 32],
        NextPrintV2Error::CorruptCompletion
    );
    if completion_state_is_nonpayable(shot.completion_state) {
        require!(
            shot.completion_disposition == RECEIPT_NONPAYABLE
                && shot.completion_worker == Pubkey::default(),
            NextPrintV2Error::CorruptCompletion
        );
    } else {
        require!(
            shot.completion_disposition == RECEIPT_PAYABLE
                && shot.completion_worker != Pubkey::default(),
            NextPrintV2Error::CorruptCompletion
        );
    }
    Ok(())
}

fn completion_state_is_nonpayable(state: u8) -> bool {
    matches!(
        state,
        x if x == ShotState::VoidMissedSuccessor as u8
            || x == ShotState::VoidSourceRevision as u8
            || x == ShotState::VoidSourceChain as u8
            || x == ShotState::VoidTimeout as u8
    )
}

fn record_completion(
    shot_key: Pubkey,
    shot: &mut NextPrintShot,
    actor: Pubkey,
    disposition: u8,
    clock: &Clock,
) -> Result<()> {
    require!(
        shot.completion_disposition == 0,
        NextPrintV2Error::CompletionAlreadyRecorded
    );
    require!(
        disposition == RECEIPT_PAYABLE || disposition == RECEIPT_NONPAYABLE,
        NextPrintV2Error::CorruptCompletion
    );
    shot.completion_state = shot.state;
    shot.completion_disposition = disposition;
    shot.completion_worker = if disposition == RECEIPT_PAYABLE {
        actor
    } else {
        Pubkey::default()
    };
    shot.completion_slot = clock.slot;
    shot.completion_ts = clock.unix_timestamp;
    shot.completion_result_hash = completion_result_hash(&shot_key, shot);
    authenticate_completion_fields(shot)
}

fn completion_result_hash(shot_key: &Pubkey, shot: &NextPrintShot) -> [u8; 32] {
    let schema = shot.schema_version.to_le_bytes();
    let nonce = shot.nonce.to_le_bytes();
    let slot = shot.completion_slot.to_le_bytes();
    let time = shot.completion_ts.to_le_bytes();
    hashv(&[
        b"RATCHET_NEXT_PRINT_COMPLETION_V2",
        shot_key.as_ref(),
        schema.as_ref(),
        shot.ruleset_hash.as_ref(),
        shot.player.as_ref(),
        nonce.as_ref(),
        &[WORK_KIND_NEXT_PRINT_TERMINALIZE],
        &[shot.completion_state],
        &[shot.completion_disposition],
        shot.entry.message_hash.as_ref(),
        shot.exit.message_hash.as_ref(),
        &shot.outcome.to_le_bytes(),
        slot.as_ref(),
        time.as_ref(),
    ])
    .to_bytes()
}

fn authenticate_receipt(
    receipt: &CompletionReceipt,
    shot_key: Pubkey,
    shot: &NextPrintShot,
) -> Result<()> {
    authenticate_completion_fields(shot)?;
    require!(
        receipt.schema_version == COMPLETION_SCHEMA_VERSION
            && receipt.disposition == shot.completion_disposition
            && receipt.work_kind == WORK_KIND_NEXT_PRINT_TERMINALIZE
            && receipt.subject == shot_key
            && receipt.worker == shot.completion_worker
            && receipt.result_hash == shot.completion_result_hash
            && receipt.completed_slot == shot.completion_slot
            && receipt.completed_ts == shot.completion_ts,
        NextPrintV2Error::WrongCompletionReceipt
    );
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Disposition {
    Same,
    Successor,
    Missed,
    Revision,
    BrokenChain,
}

fn receipt_disposition_for(disposition: Disposition) -> u8 {
    if disposition == Disposition::Successor {
        RECEIPT_PAYABLE
    } else {
        RECEIPT_NONPAYABLE
    }
}

fn successor_disposition(entry: &EvidenceRecord, current: &EvidenceRecord) -> Result<Disposition> {
    require!(
        current.publish_time >= entry.publish_time,
        NextPrintV2Error::SourceRegression
    );
    if current.publish_time == entry.publish_time {
        return Ok(if current.message_hash == entry.message_hash {
            Disposition::Same
        } else {
            Disposition::Revision
        });
    }
    if current.prev_publish_time == entry.publish_time {
        return Ok(Disposition::Successor);
    }
    Ok(if current.prev_publish_time > entry.publish_time {
        Disposition::Missed
    } else {
        Disposition::BrokenChain
    })
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct OpenShot<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        init,
        payer = player,
        space = 8 + NextPrintShot::LEN,
        seeds = [b"shot", player.key().as_ref(), nonce.to_le_bytes().as_ref()],
        bump
    )]
    pub shot: Account<'info, NextPrintShot>,
    /// CHECK: owner, PDA, layout and Pyth fields are checked in load_evidence.
    pub price_update: UncheckedAccount<'info>,
    /// CHECK: canonical address and old-receipt tombstone are checked in open_shot.
    pub completion_receipt: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Observe<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    #[account(
        mut,
        seeds = [b"shot", shot.player.as_ref(), shot.nonce.to_le_bytes().as_ref()],
        bump = shot.bump
    )]
    pub shot: Account<'info, NextPrintShot>,
    /// CHECK: owner, PDA, layout and Pyth fields are checked in load_evidence.
    pub price_update: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Timeout<'info> {
    pub actor: Signer<'info>,
    #[account(
        mut,
        seeds = [b"shot", shot.player.as_ref(), shot.nonce.to_le_bytes().as_ref()],
        bump = shot.bump
    )]
    pub shot: Account<'info, NextPrintShot>,
}

#[derive(Accounts)]
pub struct Reveal<'info> {
    pub player: Signer<'info>,
    #[account(
        mut,
        has_one = player,
        seeds = [b"shot", shot.player.as_ref(), shot.nonce.to_le_bytes().as_ref()],
        bump = shot.bump
    )]
    pub shot: Account<'info, NextPrintShot>,
}

#[derive(Accounts)]
pub struct Forfeit<'info> {
    pub actor: Signer<'info>,
    #[account(
        mut,
        seeds = [b"shot", shot.player.as_ref(), shot.nonce.to_le_bytes().as_ref()],
        bump = shot.bump
    )]
    pub shot: Account<'info, NextPrintShot>,
}

#[derive(Accounts)]
pub struct WriteCompletionReceipt<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"shot", shot.player.as_ref(), shot.nonce.to_le_bytes().as_ref()],
        bump = shot.bump
    )]
    pub shot: Account<'info, NextPrintShot>,
    #[account(
        init,
        payer = payer,
        space = 8 + CompletionReceipt::LEN,
        seeds = [b"completion", shot.key().as_ref(), &[WORK_KIND_NEXT_PRINT_TERMINALIZE]],
        bump
    )]
    pub completion_receipt: Account<'info, CompletionReceipt>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseShot<'info> {
    pub actor: Signer<'info>,
    #[account(
        mut,
        close = player,
        has_one = player,
        seeds = [b"shot", shot.player.as_ref(), shot.nonce.to_le_bytes().as_ref()],
        bump = shot.bump
    )]
    pub shot: Account<'info, NextPrintShot>,
    /// CHECK: address is constrained to the player permanently stored in Shot.
    #[account(mut, address = shot.player)]
    pub player: UncheckedAccount<'info>,
    #[account(
        seeds = [b"completion", shot.key().as_ref(), &[WORK_KIND_NEXT_PRINT_TERMINALIZE]],
        bump = completion_receipt.bump
    )]
    pub completion_receipt: Account<'info, CompletionReceipt>,
}

#[account]
pub struct NextPrintShot {
    pub schema_version: u16,
    pub bump: u8,
    pub state: u8,
    pub adapter_id: u16,
    pub ruleset_hash: [u8; 32],
    pub player: Pubkey,
    pub nonce: u64,
    pub commit: [u8; 32],
    pub feed_index: u8,
    pub feed_id: [u8; 32],
    pub opened_ts: i64,
    pub deadline_ts: i64,
    pub entry: EvidenceRecord,
    pub exit: EvidenceRecord,
    pub outcome: i8,
    pub completion_state: u8,
    pub completion_disposition: u8,
    pub completion_worker: Pubkey,
    pub completion_result_hash: [u8; 32],
    pub completion_slot: u64,
    pub completion_ts: i64,
    pub side: u8,
    pub p_bps: u16,
    pub hit: u8,
}

impl NextPrintShot {
    pub const LEN: usize = 2
        + 1
        + 1
        + 2
        + 32
        + 32
        + 8
        + 32
        + 1
        + 32
        + 8
        + 8
        + EvidenceRecord::LEN * 2
        + 1
        + 1
        + 1
        + 32
        + 32
        + 8
        + 8
        + 1
        + 2
        + 1;
}

#[account]
pub struct CompletionReceipt {
    pub schema_version: u16,
    pub bump: u8,
    pub disposition: u8,
    pub work_kind: u8,
    pub subject: Pubkey,
    pub worker: Pubkey,
    pub result_hash: [u8; 32],
    pub completed_slot: u64,
    pub completed_ts: i64,
}

impl CompletionReceipt {
    pub const LEN: usize = 2 + 1 + 1 + 1 + 32 + 32 + 32 + 8 + 8;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq)]
pub struct EvidenceRecord {
    pub source_account: Pubkey,
    pub message_hash: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
    pub prev_publish_time: i64,
    pub posted_slot: u64,
}

impl EvidenceRecord {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 4 + 8 + 8 + 8;
}

#[derive(Clone, Copy)]
pub struct FeedPolicy {
    pub feed_id: [u8; 32],
    pub max_entry_age_secs: i64,
    pub max_wait_secs: i64,
}

const fn hex32(s: &[u8; 64]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        out[i] = (hex_nibble(s[2 * i]) << 4) | hex_nibble(s[2 * i + 1]);
        i += 1;
    }
    out
}

#[program]
pub mod ratchet_next_print_v2 {
    use super::*;

    pub fn open_shot(
        ctx: Context<OpenShot>,
        nonce: u64,
        commit: [u8; 32],
        feed_index: u8,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let policy = feed_policy(feed_index)?;
        let entry = load_evidence(&ctx.accounts.price_update, policy.feed_id, &clock)?;
        let oldest = clock
            .unix_timestamp
            .checked_sub(policy.max_entry_age_secs)
            .ok_or(NextPrintV2Error::MathOverflow)?;
        require!(entry.publish_time >= oldest, NextPrintV2Error::StaleEntry);

        let shot_key = ctx.accounts.shot.key();
        let expected_receipt = completion_receipt_address(&shot_key).0;
        require_keys_eq!(
            ctx.accounts.completion_receipt.key(),
            expected_receipt,
            NextPrintV2Error::WrongCompletionReceiptPda
        );
        require!(
            *ctx.accounts.completion_receipt.owner != crate::ID
                || ctx.accounts.completion_receipt.data_is_empty(),
            NextPrintV2Error::CompletionAlreadyExists
        );

        let shot = &mut ctx.accounts.shot;
        shot.schema_version = SCHEMA_VERSION;
        shot.bump = ctx.bumps.shot;
        shot.state = ShotState::Open as u8;
        shot.adapter_id = ADAPTER_PYTH_PUSH_V1;
        shot.ruleset_hash = RULESET_HASH;
        shot.player = ctx.accounts.player.key();
        shot.nonce = nonce;
        shot.commit = commit;
        shot.feed_index = feed_index;
        shot.feed_id = policy.feed_id;
        shot.opened_ts = clock.unix_timestamp;
        shot.deadline_ts = clock
            .unix_timestamp
            .checked_add(policy.max_wait_secs)
            .ok_or(NextPrintV2Error::MathOverflow)?;
        shot.entry = entry;
        shot.exit = EvidenceRecord::default();
        shot.outcome = 0;
        shot.completion_state = NO_COMPLETION_STATE;
        shot.completion_disposition = 0;
        shot.completion_worker = Pubkey::default();
        shot.completion_result_hash = [0; 32];
        shot.completion_slot = 0;
        shot.completion_ts = 0;
        shot.side = 2;
        shot.p_bps = 0;
        shot.hit = 2;
        emit!(ShotOpened {
            shot: shot_key,
            player: shot.player,
            feed_id: shot.feed_id,
            entry_publish_time: shot.entry.publish_time,
            deadline_ts: shot.deadline_ts,
        });
        Ok(())
    }

    pub fn observe(ctx: Context<Observe>) -> Result<()> {
        let clock = Clock::get()?;
        let shot_key = ctx.accounts.shot.key();
        let actor = ctx.accounts.actor.key();
        let shot = &mut ctx.accounts.shot;
        authenticate_shot(shot)?;
        require!(
            shot.state == ShotState::Open as u8,
            NextPrintV2Error::TerminalShot
        );
        let current = load_evidence(&ctx.accounts.price_update, shot.feed_id, &clock)?;
        let disposition = successor_disposition(&shot.entry, &current)?;
        if disposition == Disposition::Same {
            return Ok(());
        }
        let receipt_disposition = receipt_disposition_for(disposition);

        shot.exit = current;
        match disposition {
            Disposition::Same => unreachable!(),
            Disposition::Successor => {
                if shot.exit.exponent != shot.entry.exponent {
                    shot.state = ShotState::VoidScaleChange as u8;
                } else if shot.exit.price == shot.entry.price {
                    shot.state = ShotState::VoidEqual as u8;
                } else {
                    shot.outcome = if shot.exit.price > shot.entry.price {
                        1
                    } else {
                        -1
                    };
                    shot.state = ShotState::Captured as u8;
                }
            }
            Disposition::Missed => shot.state = ShotState::VoidMissedSuccessor as u8,
            Disposition::Revision => shot.state = ShotState::VoidSourceRevision as u8,
            Disposition::BrokenChain => shot.state = ShotState::VoidSourceChain as u8,
        }
        record_completion(shot_key, shot, actor, receipt_disposition, &clock)?;
        emit!(ShotObserved {
            shot: shot_key,
            actor,
            state: shot.state,
            outcome: shot.outcome,
            exit_publish_time: shot.exit.publish_time,
        });
        Ok(())
    }

    pub fn timeout(ctx: Context<Timeout>) -> Result<()> {
        let clock = Clock::get()?;
        let shot_key = ctx.accounts.shot.key();
        let shot = &mut ctx.accounts.shot;
        authenticate_shot(shot)?;
        require!(
            shot.state == ShotState::Open as u8,
            NextPrintV2Error::TerminalShot
        );
        require!(
            clock.unix_timestamp >= shot.deadline_ts,
            NextPrintV2Error::DeadlineOpen
        );
        shot.state = ShotState::VoidTimeout as u8;
        record_completion(
            shot_key,
            shot,
            ctx.accounts.actor.key(),
            RECEIPT_NONPAYABLE,
            &clock,
        )?;
        emit!(ShotObserved {
            shot: shot_key,
            actor: ctx.accounts.actor.key(),
            state: shot.state,
            outcome: 0,
            exit_publish_time: 0,
        });
        Ok(())
    }

    pub fn reveal(ctx: Context<Reveal>, side: u8, p_bps: u16, salt: [u8; 32]) -> Result<()> {
        require!(side <= 1, NextPrintV2Error::BadSide);
        require!(p_bps <= 10_000, NextPrintV2Error::BadProbability);
        let now = Clock::get()?.unix_timestamp;
        let shot = &mut ctx.accounts.shot;
        authenticate_shot(shot)?;
        require!(
            shot.state == ShotState::Captured as u8,
            NextPrintV2Error::WrongState
        );
        let deadline = shot
            .completion_ts
            .checked_add(REVEAL_WINDOW_SECS)
            .ok_or(NextPrintV2Error::MathOverflow)?;
        require!(now < deadline, NextPrintV2Error::RevealWindowClosed);
        let nonce = shot.nonce.to_le_bytes();
        let p = p_bps.to_le_bytes();
        let expected = hashv(&[
            b"RATCHET_NEXT_PRINT_COMMIT_V2",
            shot.player.as_ref(),
            nonce.as_ref(),
            &[side],
            p.as_ref(),
            salt.as_ref(),
        ])
        .to_bytes();
        require!(expected == shot.commit, NextPrintV2Error::CommitMismatch);
        shot.side = side;
        shot.p_bps = p_bps;
        let called = if side == 1 { 1 } else { -1 };
        shot.hit = u8::from(called == shot.outcome);
        shot.state = ShotState::Revealed as u8;
        emit!(ShotRevealed {
            shot: shot.key(),
            player: shot.player,
            side,
            p_bps,
            hit: shot.hit,
        });
        Ok(())
    }

    pub fn forfeit(ctx: Context<Forfeit>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let shot = &mut ctx.accounts.shot;
        authenticate_shot(shot)?;
        require!(
            shot.state == ShotState::Captured as u8,
            NextPrintV2Error::WrongState
        );
        let deadline = shot
            .completion_ts
            .checked_add(REVEAL_WINDOW_SECS)
            .ok_or(NextPrintV2Error::MathOverflow)?;
        require!(now >= deadline, NextPrintV2Error::RevealWindowOpen);
        shot.hit = 0;
        shot.state = ShotState::Forfeited as u8;
        emit!(ShotForfeited {
            shot: shot.key(),
            actor: ctx.accounts.actor.key(),
        });
        Ok(())
    }

    pub fn write_completion_receipt(ctx: Context<WriteCompletionReceipt>) -> Result<()> {
        let shot = &ctx.accounts.shot;
        authenticate_shot(shot)?;
        authenticate_completion_fields(shot)?;

        let receipt = &mut ctx.accounts.completion_receipt;
        receipt.schema_version = COMPLETION_SCHEMA_VERSION;
        receipt.bump = ctx.bumps.completion_receipt;
        receipt.disposition = shot.completion_disposition;
        receipt.work_kind = WORK_KIND_NEXT_PRINT_TERMINALIZE;
        receipt.subject = shot.key();
        receipt.worker = shot.completion_worker;
        receipt.result_hash = shot.completion_result_hash;
        receipt.completed_slot = shot.completion_slot;
        receipt.completed_ts = shot.completion_ts;
        emit!(CompletionReceiptWritten {
            receipt: receipt.key(),
            subject: receipt.subject,
            payer: ctx.accounts.payer.key(),
            disposition: receipt.disposition,
            worker: receipt.worker,
            result_hash: receipt.result_hash,
        });
        Ok(())
    }

    pub fn close_shot(ctx: Context<CloseShot>) -> Result<()> {
        let shot = &ctx.accounts.shot;
        authenticate_shot(shot)?;
        require!(
            matches!(
                shot.state,
                x if x == ShotState::Revealed as u8
                    || x == ShotState::VoidEqual as u8
                    || x == ShotState::VoidMissedSuccessor as u8
                    || x == ShotState::VoidSourceRevision as u8
                    || x == ShotState::VoidSourceChain as u8
                    || x == ShotState::VoidScaleChange as u8
                    || x == ShotState::VoidTimeout as u8
                    || x == ShotState::Forfeited as u8
            ),
            NextPrintV2Error::ShotNotClosable
        );
        authenticate_receipt(
            &ctx.accounts.completion_receipt,
            ctx.accounts.shot.key(),
            shot,
        )?;
        emit!(ShotClosed {
            shot: shot.key(),
            actor: ctx.accounts.actor.key(),
            player: shot.player,
            receipt: ctx.accounts.completion_receipt.key(),
        });
        Ok(())
    }
}
