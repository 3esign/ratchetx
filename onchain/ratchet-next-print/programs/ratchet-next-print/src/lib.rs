//! RatchetX Next Print v1: current fully verified sponsored Pyth print versus
//! only its direct signed successor. No server or historical API selects exit.
//! This candidate intentionally carries no RCX, credits, SOL bounty or payout.

use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::{
    price_update::{PriceUpdateV2, VerificationLevel},
    ID_CONST as PYTH_RECEIVER_ID, PYTH_PUSH_ORACLE_ID,
};
use solana_sha256_hasher::hashv;

declare_id!("5bBHDFMmXQq6PNyrGVdSiKo3xpDvevbueYXZmp48bX4");

pub const SCHEMA_VERSION: u16 = 1;
pub const ADAPTER_PYTH_PUSH_V1: u16 = 1;
pub const SHARD_ID: u16 = 0;
pub const MAX_FUTURE_SKEW_SECS: i64 = 5;
pub const MAX_CONF_BPS: u128 = 200;
pub const REVEAL_WINDOW_SECS: i64 = 3_600;
pub const RULESET_HASH: [u8; 32] =
    hex32(b"5a83a821bc9a4d8562d8cf362f8f5e44d9e6d9522c06ee594da53f39d4cf3c39");

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
pub mod ratchet_next_print {
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
            .ok_or(NextPrintError::MathOverflow)?;
        require!(entry.publish_time >= oldest, NextPrintError::StaleEntry);

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
            .ok_or(NextPrintError::MathOverflow)?;
        shot.entry = entry;
        shot.exit = EvidenceRecord::default();
        shot.terminal_ts = 0;
        shot.outcome = 0;
        shot.side = 2;
        shot.p_bps = 0;
        shot.hit = 2;
        emit!(ShotOpened {
            shot: shot.key(),
            player: shot.player,
            feed_id: shot.feed_id,
            entry_publish_time: shot.entry.publish_time,
            deadline_ts: shot.deadline_ts,
        });
        Ok(())
    }

    pub fn observe(ctx: Context<Observe>) -> Result<()> {
        let clock = Clock::get()?;
        let shot = &mut ctx.accounts.shot;
        authenticate_shot(shot)?;
        require!(
            shot.state == ShotState::Open as u8,
            NextPrintError::TerminalShot
        );
        let current = load_evidence(&ctx.accounts.price_update, shot.feed_id, &clock)?;
        match successor_disposition(&shot.entry, &current)? {
            Disposition::Same => return Ok(()),
            Disposition::Successor => {
                shot.exit = current;
                shot.terminal_ts = clock.unix_timestamp;
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
            Disposition::Missed => {
                shot.state = ShotState::VoidMissedSuccessor as u8;
                shot.terminal_ts = clock.unix_timestamp;
            }
            Disposition::Revision => {
                shot.state = ShotState::VoidSourceRevision as u8;
                shot.terminal_ts = clock.unix_timestamp;
            }
            Disposition::BrokenChain => {
                shot.state = ShotState::VoidSourceChain as u8;
                shot.terminal_ts = clock.unix_timestamp;
            }
        }
        emit!(ShotObserved {
            shot: shot.key(),
            actor: ctx.accounts.actor.key(),
            state: shot.state,
            outcome: shot.outcome,
            exit_publish_time: shot.exit.publish_time,
        });
        Ok(())
    }

    pub fn timeout(ctx: Context<Timeout>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let shot = &mut ctx.accounts.shot;
        authenticate_shot(shot)?;
        require!(
            shot.state == ShotState::Open as u8,
            NextPrintError::TerminalShot
        );
        require!(now >= shot.deadline_ts, NextPrintError::DeadlineOpen);
        shot.state = ShotState::VoidTimeout as u8;
        shot.terminal_ts = now;
        emit!(ShotObserved {
            shot: shot.key(),
            actor: ctx.accounts.actor.key(),
            state: shot.state,
            outcome: 0,
            exit_publish_time: 0,
        });
        Ok(())
    }

    pub fn reveal(ctx: Context<Reveal>, side: u8, p_bps: u16, salt: [u8; 32]) -> Result<()> {
        require!(side <= 1, NextPrintError::BadSide);
        require!(p_bps <= 10_000, NextPrintError::BadProbability);
        let now = Clock::get()?.unix_timestamp;
        let shot = &mut ctx.accounts.shot;
        authenticate_shot(shot)?;
        require!(
            shot.state == ShotState::Captured as u8,
            NextPrintError::WrongState
        );
        let deadline = shot
            .terminal_ts
            .checked_add(REVEAL_WINDOW_SECS)
            .ok_or(NextPrintError::MathOverflow)?;
        require!(now < deadline, NextPrintError::RevealWindowClosed);
        let nonce = shot.nonce.to_le_bytes();
        let p = p_bps.to_le_bytes();
        let expected = hashv(&[
            b"RATCHET_NEXT_PRINT_COMMIT_V1",
            shot.player.as_ref(),
            nonce.as_ref(),
            &[side],
            p.as_ref(),
            salt.as_ref(),
        ])
        .to_bytes();
        require!(expected == shot.commit, NextPrintError::CommitMismatch);
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
            NextPrintError::WrongState
        );
        let deadline = shot
            .terminal_ts
            .checked_add(REVEAL_WINDOW_SECS)
            .ok_or(NextPrintError::MathOverflow)?;
        require!(now >= deadline, NextPrintError::RevealWindowOpen);
        shot.hit = 0;
        shot.state = ShotState::Forfeited as u8;
        emit!(ShotForfeited {
            shot: shot.key(),
            actor: ctx.accounts.actor.key()
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
            NextPrintError::ShotNotClosable
        );
        emit!(ShotClosed {
            shot: shot.key(),
            actor: ctx.accounts.actor.key(),
            player: shot.player,
        });
        Ok(())
    }
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
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Observe<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    #[account(mut)]
    pub shot: Account<'info, NextPrintShot>,
    /// CHECK: owner, PDA, layout and Pyth fields are checked in load_evidence.
    pub price_update: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Timeout<'info> {
    pub actor: Signer<'info>,
    #[account(mut)]
    pub shot: Account<'info, NextPrintShot>,
}

#[derive(Accounts)]
pub struct Reveal<'info> {
    pub player: Signer<'info>,
    #[account(mut, has_one = player)]
    pub shot: Account<'info, NextPrintShot>,
}

#[derive(Accounts)]
pub struct Forfeit<'info> {
    pub actor: Signer<'info>,
    #[account(mut)]
    pub shot: Account<'info, NextPrintShot>,
}

#[derive(Accounts)]
pub struct CloseShot<'info> {
    pub actor: Signer<'info>,
    #[account(mut, close = player, has_one = player)]
    pub shot: Account<'info, NextPrintShot>,
    /// CHECK: address is constrained to the player permanently stored in Shot.
    #[account(mut, address = shot.player)]
    pub player: UncheckedAccount<'info>,
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
    pub terminal_ts: i64,
    pub outcome: i8,
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
        + 8
        + 1
        + 1
        + 2
        + 1;
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

fn feed_policy(index: u8) -> Result<FeedPolicy> {
    let i = usize::from(index);
    require!(i < FEEDS.len(), NextPrintError::FeedNotAllowed);
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

fn load_evidence(
    account: &AccountInfo,
    expected_feed: [u8; 32],
    clock: &Clock,
) -> Result<EvidenceRecord> {
    require!(!account.executable, NextPrintError::ExecutableSource);
    require!(
        *account.owner == PYTH_RECEIVER_ID,
        NextPrintError::WrongReceiverOwner
    );
    require!(
        account.data_len() == PriceUpdateV2::LEN,
        NextPrintError::BadPriceAccountLength
    );
    let expected_source = sponsored_price_address(&expected_feed);
    require!(
        account.key() == expected_source,
        NextPrintError::WrongSourcePda
    );

    let data = account
        .try_borrow_data()
        .map_err(|_| error!(NextPrintError::BadPriceAccountData))?;
    let mut slice: &[u8] = &data;
    let update = PriceUpdateV2::try_deserialize(&mut slice)
        .map_err(|_| error!(NextPrintError::BadPriceAccountData))?;
    require!(
        matches!(update.verification_level, VerificationLevel::Full),
        NextPrintError::PartialVerification
    );
    require!(
        update.write_authority == expected_source,
        NextPrintError::WrongWriteAuthority
    );
    require!(
        update.posted_slot <= clock.slot,
        NextPrintError::PostedSlotInFuture
    );
    let msg = &update.price_message;
    require!(msg.feed_id == expected_feed, NextPrintError::WrongFeed);
    require!(
        msg.prev_publish_time < msg.publish_time,
        NextPrintError::BadSourceInterval
    );
    require!(msg.price > 0, NextPrintError::BadPrice);
    require!(msg.exponent.abs() <= 12, NextPrintError::BadExponent);
    let newest = clock
        .unix_timestamp
        .checked_add(MAX_FUTURE_SKEW_SECS)
        .ok_or(NextPrintError::MathOverflow)?;
    require!(
        msg.publish_time <= newest,
        NextPrintError::OracleTimeInFuture
    );
    let lhs = u128::from(msg.conf)
        .checked_mul(10_000)
        .ok_or(NextPrintError::MathOverflow)?;
    let rhs = u128::from(msg.price.unsigned_abs())
        .checked_mul(MAX_CONF_BPS)
        .ok_or(NextPrintError::MathOverflow)?;
    require!(lhs <= rhs, NextPrintError::ConfidenceTooWide);

    let message_hash = hashv(&[
        b"RATCHET_NEXT_PRINT_EVIDENCE_V1",
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
        NextPrintError::WrongSchema
    );
    require!(
        shot.adapter_id == ADAPTER_PYTH_PUSH_V1,
        NextPrintError::WrongAdapter
    );
    require!(
        shot.ruleset_hash == RULESET_HASH,
        NextPrintError::WrongRuleset
    );
    let policy = feed_policy(shot.feed_index)?;
    require!(shot.feed_id == policy.feed_id, NextPrintError::WrongFeed);
    let expected_deadline = shot
        .opened_ts
        .checked_add(policy.max_wait_secs)
        .ok_or(NextPrintError::MathOverflow)?;
    require!(
        shot.deadline_ts == expected_deadline,
        NextPrintError::CorruptDeadline
    );
    require!(
        shot.entry.source_account == sponsored_price_address(&shot.feed_id),
        NextPrintError::WrongSourcePda
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

fn successor_disposition(entry: &EvidenceRecord, current: &EvidenceRecord) -> Result<Disposition> {
    require!(
        current.publish_time >= entry.publish_time,
        NextPrintError::SourceRegression
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
pub struct ShotClosed {
    pub shot: Pubkey,
    pub actor: Pubkey,
    pub player: Pubkey,
}

#[error_code]
pub enum NextPrintError {
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
    }

    #[test]
    fn feed_policies_are_pinned_and_stale_sources_cannot_open() {
        let sol = feed_policy(0).unwrap();
        let stock = feed_policy(1).unwrap();
        assert_eq!(sol.max_entry_age_secs, 30);
        assert_eq!(sol.max_wait_secs, 300);
        assert_eq!(stock.max_entry_age_secs, 120);
        assert_eq!(stock.max_wait_secs, 7_200);
        assert!(feed_policy(7).is_err());
    }

    #[test]
    fn fixed_layout_is_stable() {
        let record = evidence(100, 90, 1);
        assert_eq!(EvidenceRecord::LEN, 108);
        let mut bytes = Vec::new();
        record.serialize(&mut bytes).unwrap();
        assert_eq!(bytes.len(), EvidenceRecord::LEN);
        assert_eq!(NextPrintShot::LEN, 388);
    }

    #[test]
    fn official_programs_and_candidate_identity_are_distinct() {
        assert_eq!(
            PYTH_RECEIVER_ID.to_string(),
            "rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp"
        );
        assert_eq!(
            PYTH_PUSH_ORACLE_ID.to_string(),
            "pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou"
        );
        assert_ne!(crate::ID, PYTH_RECEIVER_ID);
        assert_ne!(crate::ID, PYTH_PUSH_ORACLE_ID);
    }
}
