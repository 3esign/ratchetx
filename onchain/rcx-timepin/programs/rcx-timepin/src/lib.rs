//! RCX Timepin v0.1: a no-value public Pyth evidence primitive.
//!
//! This prototype has no admin, config, pause, allowlist, token, treasury,
//! sponsor identity, ring buffer, or close path. Every instruction is open to
//! any fee-paying signer. The only oracle accepted is the pinned, fully
//! verified, sponsored Pyth push feed on shard zero.

use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::{
    price_update::{PriceUpdateV2, VerificationLevel},
    ID_CONST as PYTH_RECEIVER_ID, PYTH_PUSH_ORACLE_ID,
};
use solana_sha256_hasher::hashv;

declare_id!("Fg6PaFpoGXkYsidMpWxTWqkZgYHFwD4GwxV6Wt5VwFQ");

pub const SCHEMA_VERSION: u16 = 1;
pub const SCHEMA_SEED: [u8; 2] = SCHEMA_VERSION.to_le_bytes();
pub const NEED_SEED: &[u8] = b"need";
/// The public oracle namespace in the canonical Need identity.
pub const ORACLE_DOMAIN: Pubkey = PYTH_PUSH_ORACLE_ID;
pub const SPONSORED_SHARD: u16 = 0;

pub const MIN_OPEN_LEAD_SECS: i64 = 30;
pub const MAX_OPEN_HORIZON_SECS: i64 = 7 * 86_400;
pub const TARGET_ALIGNMENT_SECS: i64 = 5;
pub const CAPTURE_WINDOW_SECS: i64 = 180;
pub const MAX_ORACLE_FUTURE_SKEW_SECS: i64 = 5;
pub const MAX_ABS_EXPONENT: i32 = 18;
pub const MAX_CONFIDENCE_BPS: u128 = 10_000;
pub const FULL_VERIFICATION_MARKER: u8 = 1;

#[program]
pub mod rcx_timepin {
    use super::*;

    /// Create the one canonical Need for this schema/domain/feed/target tuple.
    /// The opener only pays rent and is retained as provenance; it receives no
    /// capability and is deliberately absent from the PDA seeds.
    pub fn open_need(ctx: Context<OpenNeed>, feed_id: [u8; 32], target_ts: i64) -> Result<()> {
        let clock = Clock::get()?;
        let deadline_ts = validate_open(clock.unix_timestamp, target_ts)?;
        let need = &mut ctx.accounts.need;
        need.schema_version = SCHEMA_VERSION;
        need.bump = ctx.bumps.need;
        need.state = NeedState::Open as u8;
        need.oracle_domain = ORACLE_DOMAIN.to_bytes();
        need.feed_id = feed_id;
        need.target_ts = target_ts;
        need.capture_deadline_ts = deadline_ts;
        need.opened_ts = clock.unix_timestamp;
        need.opened_slot = clock.slot;
        need.opener = ctx.accounts.opener.key();
        need.candidate_count = 0;
        need.candidate_a = EvidenceRecord::default();
        need.candidate_b = EvidenceRecord::default();
        need.terminal_ts = 0;
        need.terminal_slot = 0;
        need.terminal_actor = Pubkey::default();

        emit!(NeedOpened {
            need: need.key(),
            feed_id,
            target_ts,
            capture_deadline_ts: deadline_ts,
            opener: ctx.accounts.opener.key(),
        });
        Ok(())
    }

    /// Capture fully verified source evidence after the target and before the
    /// common deadline. The first distinct message is Candidate; a second
    /// distinct valid message makes the account terminal Ambiguous.
    pub fn capture(ctx: Context<Capture>) -> Result<()> {
        let clock = Clock::get()?;
        assert_need_identity(&ctx.accounts.need)?;
        let actor = ctx.accounts.actor.key();
        let evidence = load_evidence(
            &ctx.accounts.price_update.to_account_info(),
            ctx.accounts.need.feed_id,
            ctx.accounts.need.target_ts,
            &clock,
            actor,
        )?;
        let message_hash = evidence.message_hash;
        let disposition = capture_transition(
            &mut ctx.accounts.need,
            evidence,
            clock.unix_timestamp,
            clock.slot,
            actor,
        )?;

        emit!(EvidenceCaptured {
            need: ctx.accounts.need.key(),
            message_hash,
            actor,
            disposition: disposition as u8,
            state: ctx.accounts.need.state,
        });
        Ok(())
    }

    /// Finalize the sole submitted Candidate once this schema's capture window
    /// closes. `Final` does not prove that the mutable sponsored source never
    /// held another qualifying message that nobody captured.
    pub fn finalize(ctx: Context<Advance>) -> Result<()> {
        let clock = Clock::get()?;
        assert_need_identity(&ctx.accounts.need)?;
        let actor = ctx.accounts.actor.key();
        finalize_transition(
            &mut ctx.accounts.need,
            clock.unix_timestamp,
            clock.slot,
            actor,
        )?;
        emit!(NeedTerminalized {
            need: ctx.accounts.need.key(),
            state: NeedState::Final as u8,
            actor,
        });
        Ok(())
    }

    /// Mark an unanswered Need terminal Expired once capture is closed.
    pub fn expire(ctx: Context<Advance>) -> Result<()> {
        let clock = Clock::get()?;
        assert_need_identity(&ctx.accounts.need)?;
        let actor = ctx.accounts.actor.key();
        expire_transition(
            &mut ctx.accounts.need,
            clock.unix_timestamp,
            clock.slot,
            actor,
        )?;
        emit!(NeedTerminalized {
            need: ctx.accounts.need.key(),
            state: NeedState::Expired as u8,
            actor,
        });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(feed_id: [u8; 32], target_ts: i64)]
pub struct OpenNeed<'info> {
    #[account(mut)]
    pub opener: Signer<'info>,
    #[account(
        init,
        payer = opener,
        space = 8 + TimepinNeed::LEN,
        seeds = [
            NEED_SEED,
            SCHEMA_SEED.as_ref(),
            ORACLE_DOMAIN.as_ref(),
            feed_id.as_ref(),
            &target_ts.to_le_bytes(),
        ],
        bump,
    )]
    pub need: Account<'info, TimepinNeed>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Capture<'info> {
    /// Public caller and truthful capture provenance, never an authority.
    pub actor: Signer<'info>,
    #[account(
        mut,
        seeds = [
            NEED_SEED,
            SCHEMA_SEED.as_ref(),
            ORACLE_DOMAIN.as_ref(),
            need.feed_id.as_ref(),
            &need.target_ts.to_le_bytes(),
        ],
        bump = need.bump,
    )]
    pub need: Account<'info, TimepinNeed>,
    /// CHECK: owner, canonical shard-0 PDA, discriminator, write authority,
    /// feed, verification level, signed interval, and bounds are all checked.
    pub price_update: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Advance<'info> {
    /// Public caller and truthful terminalization provenance, never authority.
    pub actor: Signer<'info>,
    #[account(
        mut,
        seeds = [
            NEED_SEED,
            SCHEMA_SEED.as_ref(),
            ORACLE_DOMAIN.as_ref(),
            need.feed_id.as_ref(),
            &need.target_ts.to_le_bytes(),
        ],
        bump = need.bump,
    )]
    pub need: Account<'info, TimepinNeed>,
}

#[account]
pub struct TimepinNeed {
    pub schema_version: u16,
    pub bump: u8,
    pub state: u8,
    pub oracle_domain: [u8; 32],
    pub feed_id: [u8; 32],
    pub target_ts: i64,
    pub capture_deadline_ts: i64,
    pub opened_ts: i64,
    pub opened_slot: u64,
    pub opener: Pubkey,
    pub candidate_count: u8,
    pub candidate_a: EvidenceRecord,
    pub candidate_b: EvidenceRecord,
    pub terminal_ts: i64,
    pub terminal_slot: u64,
    pub terminal_actor: Pubkey,
}

impl TimepinNeed {
    pub const LEN: usize = 657;
}

/// Full raw decision data plus source-posting and capture provenance. Fixed
/// size and never recycled. `present` avoids variable-length Option encoding.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EvidenceRecord {
    pub present: u8,
    pub verification_level: u8,
    pub message_hash: [u8; 32],
    pub price_update: Pubkey,
    pub write_authority: Pubkey,
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
    pub prev_publish_time: i64,
    pub ema_price: i64,
    pub ema_conf: u64,
    pub posted_slot: u64,
    pub capture_slot: u64,
    pub capture_ts: i64,
    pub capturer: Pubkey,
}

impl EvidenceRecord {
    pub const LEN: usize = 238;
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NeedState {
    Open = 0,
    Candidate = 1,
    Final = 2,
    Ambiguous = 3,
    Expired = 4,
}

impl NeedState {
    fn read(value: u8) -> Result<Self> {
        match value {
            0 => Ok(Self::Open),
            1 => Ok(Self::Candidate),
            2 => Ok(Self::Final),
            3 => Ok(Self::Ambiguous),
            4 => Ok(Self::Expired),
            _ => err!(TimepinError::CorruptState),
        }
    }

    fn is_terminal(self) -> bool {
        matches!(self, Self::Final | Self::Ambiguous | Self::Expired)
    }
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CaptureDisposition {
    Candidate = 1,
    Duplicate = 2,
    Ambiguous = 3,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct RawDecisionFields {
    feed_id: [u8; 32],
    price: i64,
    conf: u64,
    exponent: i32,
    publish_time: i64,
    prev_publish_time: i64,
    ema_price: i64,
    ema_conf: u64,
}

fn validate_open(now: i64, target_ts: i64) -> Result<i64> {
    let lead = target_ts
        .checked_sub(now)
        .ok_or(TimepinError::TimestampOverflow)?;
    require!(lead >= MIN_OPEN_LEAD_SECS, TimepinError::LeadTooShort);
    require!(lead <= MAX_OPEN_HORIZON_SECS, TimepinError::HorizonTooLong);
    require!(
        target_ts.rem_euclid(TARGET_ALIGNMENT_SECS) == 0,
        TimepinError::TargetMisaligned
    );
    target_ts
        .checked_add(CAPTURE_WINDOW_SECS)
        .ok_or_else(|| error!(TimepinError::TimestampOverflow))
}

fn assert_need_identity(need: &TimepinNeed) -> Result<()> {
    require!(
        need.schema_version == SCHEMA_VERSION,
        TimepinError::WrongSchema
    );
    require!(
        need.oracle_domain == ORACLE_DOMAIN.to_bytes(),
        TimepinError::WrongOracleDomain
    );
    let expected_deadline = need
        .target_ts
        .checked_add(CAPTURE_WINDOW_SECS)
        .ok_or(TimepinError::TimestampOverflow)?;
    require!(
        need.capture_deadline_ts == expected_deadline,
        TimepinError::CorruptDeadline
    );
    Ok(())
}

fn sponsored_price_address(feed_id: &[u8; 32]) -> Pubkey {
    let shard = SPONSORED_SHARD.to_le_bytes();
    Pubkey::find_program_address(&[shard.as_ref(), feed_id.as_ref()], &PYTH_PUSH_ORACLE_ID).0
}

fn validate_source_identity(
    owner: Pubkey,
    account_key: Pubkey,
    write_authority: Pubkey,
    is_full: bool,
    feed_id: &[u8; 32],
) -> Result<()> {
    require!(owner == PYTH_RECEIVER_ID, TimepinError::WrongReceiverOwner);
    let expected = sponsored_price_address(feed_id);
    require!(
        account_key == expected,
        TimepinError::WrongSponsoredPriceAccount
    );
    require!(
        write_authority == expected,
        TimepinError::WrongWriteAuthority
    );
    require!(is_full, TimepinError::PartialVerification);
    Ok(())
}

fn validate_decision(
    raw: &RawDecisionFields,
    expected_feed: &[u8; 32],
    target_ts: i64,
    now: i64,
) -> Result<()> {
    require!(raw.feed_id == *expected_feed, TimepinError::WrongFeed);
    require!(
        raw.prev_publish_time < target_ts && target_ts <= raw.publish_time,
        TimepinError::DoesNotBracketTarget
    );
    require!(raw.price > 0, TimepinError::NonPositivePrice);
    require!(raw.conf > 0, TimepinError::NonPositiveConfidence);
    require!(
        raw.exponent >= -MAX_ABS_EXPONENT && raw.exponent <= MAX_ABS_EXPONENT,
        TimepinError::ExponentOutOfBounds
    );
    let price = raw.price as u128;
    let confidence_bps = (raw.conf as u128)
        .checked_mul(10_000)
        .ok_or(TimepinError::MathOverflow)?;
    let max_confidence = price
        .checked_mul(MAX_CONFIDENCE_BPS)
        .ok_or(TimepinError::MathOverflow)?;
    require!(
        confidence_bps <= max_confidence,
        TimepinError::ConfidenceTooWide
    );
    let newest_allowed = now
        .checked_add(MAX_ORACLE_FUTURE_SKEW_SECS)
        .ok_or(TimepinError::TimestampOverflow)?;
    require!(
        raw.publish_time <= newest_allowed,
        TimepinError::OracleTimeInFuture
    );
    let source_deadline = target_ts
        .checked_add(CAPTURE_WINDOW_SECS)
        .ok_or(TimepinError::TimestampOverflow)?;
    require!(
        raw.publish_time <= source_deadline,
        TimepinError::SourceAfterDeadline
    );
    Ok(())
}

fn price_message_hash(raw: &RawDecisionFields) -> [u8; 32] {
    hashv(&[
        b"RCX_TIMEPIN_PRICE_MESSAGE_V1",
        raw.feed_id.as_ref(),
        &raw.price.to_le_bytes(),
        &raw.conf.to_le_bytes(),
        &raw.exponent.to_le_bytes(),
        &raw.publish_time.to_le_bytes(),
        &raw.prev_publish_time.to_le_bytes(),
        &raw.ema_price.to_le_bytes(),
        &raw.ema_conf.to_le_bytes(),
    ])
    .to_bytes()
}

fn load_evidence(
    account: &AccountInfo,
    feed_id: [u8; 32],
    target_ts: i64,
    clock: &Clock,
    capturer: Pubkey,
) -> Result<EvidenceRecord> {
    require!(
        account.data_len() == PriceUpdateV2::LEN,
        TimepinError::BadPriceAccountData
    );
    let data = account
        .try_borrow_data()
        .map_err(|_| error!(TimepinError::BadPriceAccountData))?;
    let mut slice: &[u8] = &data;
    let update = PriceUpdateV2::try_deserialize(&mut slice)
        .map_err(|_| error!(TimepinError::BadPriceAccountData))?;
    let full = matches!(update.verification_level, VerificationLevel::Full);
    validate_source_identity(
        *account.owner,
        account.key(),
        update.write_authority,
        full,
        &feed_id,
    )?;
    require!(
        update.posted_slot <= clock.slot,
        TimepinError::PostedSlotInFuture
    );

    let message = &update.price_message;
    let raw = RawDecisionFields {
        feed_id: message.feed_id,
        price: message.price,
        conf: message.conf,
        exponent: message.exponent,
        publish_time: message.publish_time,
        prev_publish_time: message.prev_publish_time,
        ema_price: message.ema_price,
        ema_conf: message.ema_conf,
    };
    validate_decision(&raw, &feed_id, target_ts, clock.unix_timestamp)?;

    Ok(EvidenceRecord {
        present: 1,
        verification_level: FULL_VERIFICATION_MARKER,
        message_hash: price_message_hash(&raw),
        price_update: account.key(),
        write_authority: update.write_authority,
        feed_id: raw.feed_id,
        price: raw.price,
        conf: raw.conf,
        exponent: raw.exponent,
        publish_time: raw.publish_time,
        prev_publish_time: raw.prev_publish_time,
        ema_price: raw.ema_price,
        ema_conf: raw.ema_conf,
        posted_slot: update.posted_slot,
        capture_slot: clock.slot,
        capture_ts: clock.unix_timestamp,
        capturer,
    })
}

fn capture_transition(
    need: &mut TimepinNeed,
    evidence: EvidenceRecord,
    now: i64,
    slot: u64,
    actor: Pubkey,
) -> Result<CaptureDisposition> {
    let state = NeedState::read(need.state)?;
    require!(!state.is_terminal(), TimepinError::TerminalState);
    require!(now >= need.target_ts, TimepinError::TargetNotReached);
    require!(
        now < need.capture_deadline_ts,
        TimepinError::CaptureWindowClosed
    );
    require!(evidence.present == 1, TimepinError::MissingEvidence);

    match state {
        NeedState::Open => {
            require!(need.candidate_count == 0, TimepinError::CorruptState);
            need.candidate_a = evidence;
            need.candidate_count = 1;
            need.state = NeedState::Candidate as u8;
            Ok(CaptureDisposition::Candidate)
        }
        NeedState::Candidate => {
            require!(need.candidate_count == 1, TimepinError::CorruptState);
            if evidence.message_hash == need.candidate_a.message_hash {
                return Ok(CaptureDisposition::Duplicate);
            }
            if evidence.message_hash < need.candidate_a.message_hash {
                need.candidate_b = need.candidate_a;
                need.candidate_a = evidence;
            } else {
                need.candidate_b = evidence;
            }
            need.candidate_count = 2;
            need.state = NeedState::Ambiguous as u8;
            need.terminal_ts = now;
            need.terminal_slot = slot;
            need.terminal_actor = actor;
            Ok(CaptureDisposition::Ambiguous)
        }
        _ => err!(TimepinError::TerminalState),
    }
}

fn finalize_transition(need: &mut TimepinNeed, now: i64, slot: u64, actor: Pubkey) -> Result<()> {
    let state = NeedState::read(need.state)?;
    require!(!state.is_terminal(), TimepinError::TerminalState);
    require!(state == NeedState::Candidate, TimepinError::NoCandidate);
    require!(
        now >= need.capture_deadline_ts,
        TimepinError::CaptureWindowOpen
    );
    require!(need.candidate_count == 1, TimepinError::CorruptState);
    need.state = NeedState::Final as u8;
    need.terminal_ts = now;
    need.terminal_slot = slot;
    need.terminal_actor = actor;
    Ok(())
}

fn expire_transition(need: &mut TimepinNeed, now: i64, slot: u64, actor: Pubkey) -> Result<()> {
    let state = NeedState::read(need.state)?;
    require!(!state.is_terminal(), TimepinError::TerminalState);
    require!(state == NeedState::Open, TimepinError::CandidateExists);
    require!(
        now >= need.capture_deadline_ts,
        TimepinError::CaptureWindowOpen
    );
    require!(need.candidate_count == 0, TimepinError::CorruptState);
    need.state = NeedState::Expired as u8;
    need.terminal_ts = now;
    need.terminal_slot = slot;
    need.terminal_actor = actor;
    Ok(())
}

#[event]
pub struct NeedOpened {
    pub need: Pubkey,
    pub feed_id: [u8; 32],
    pub target_ts: i64,
    pub capture_deadline_ts: i64,
    pub opener: Pubkey,
}

#[event]
pub struct EvidenceCaptured {
    pub need: Pubkey,
    pub message_hash: [u8; 32],
    pub actor: Pubkey,
    pub disposition: u8,
    pub state: u8,
}

#[event]
pub struct NeedTerminalized {
    pub need: Pubkey,
    pub state: u8,
    pub actor: Pubkey,
}

#[error_code]
pub enum TimepinError {
    #[msg("target is too close or is not in the future")]
    LeadTooShort,
    #[msg("target exceeds the schema horizon")]
    HorizonTooLong,
    #[msg("target is not on the schema time grid")]
    TargetMisaligned,
    #[msg("timestamp arithmetic overflow")]
    TimestampOverflow,
    #[msg("Need schema does not match this program")]
    WrongSchema,
    #[msg("Need oracle domain does not match this program")]
    WrongOracleDomain,
    #[msg("Need deadline is inconsistent with the schema")]
    CorruptDeadline,
    #[msg("price account is not owned by the pinned Pyth Receiver")]
    WrongReceiverOwner,
    #[msg("price account is not the sponsored shard-0 PDA")]
    WrongSponsoredPriceAccount,
    #[msg("Pyth write authority is not the sponsored shard-0 PDA")]
    WrongWriteAuthority,
    #[msg("Pyth message is not fully verified")]
    PartialVerification,
    #[msg("Pyth price account data is invalid")]
    BadPriceAccountData,
    #[msg("Pyth feed does not match the Need")]
    WrongFeed,
    #[msg("signed Pyth interval does not bracket the target")]
    DoesNotBracketTarget,
    #[msg("Pyth price must be positive")]
    NonPositivePrice,
    #[msg("Pyth confidence must be positive")]
    NonPositiveConfidence,
    #[msg("Pyth exponent is outside the schema bound")]
    ExponentOutOfBounds,
    #[msg("Pyth confidence is wider than the schema bound")]
    ConfidenceTooWide,
    #[msg("Pyth publish time is implausibly ahead of the Solana clock")]
    OracleTimeInFuture,
    #[msg("signed Pyth publish time is after the Need deadline")]
    SourceAfterDeadline,
    #[msg("Pyth posted slot is ahead of the Solana clock")]
    PostedSlotInFuture,
    #[msg("target has not been reached")]
    TargetNotReached,
    #[msg("capture window has closed")]
    CaptureWindowClosed,
    #[msg("capture window is still open")]
    CaptureWindowOpen,
    #[msg("Need is terminal and immutable")]
    TerminalState,
    #[msg("Need state bytes are inconsistent")]
    CorruptState,
    #[msg("a Candidate is required")]
    NoCandidate,
    #[msg("a Candidate exists and cannot be expired")]
    CandidateExists,
    #[msg("evidence record is not present")]
    MissingEvidence,
    #[msg("integer arithmetic overflow")]
    MathOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;
    use pyth_solana_receiver_sdk::price_update::PriceFeedMessage;

    const TARGET: i64 = 1_800_000_000;
    const FEED: [u8; 32] = [7; 32];

    fn blank_need() -> TimepinNeed {
        TimepinNeed {
            schema_version: SCHEMA_VERSION,
            bump: 255,
            state: NeedState::Open as u8,
            oracle_domain: ORACLE_DOMAIN.to_bytes(),
            feed_id: FEED,
            target_ts: TARGET,
            capture_deadline_ts: TARGET + CAPTURE_WINDOW_SECS,
            opened_ts: TARGET - 300,
            opened_slot: 10,
            opener: Pubkey::new_unique(),
            candidate_count: 0,
            candidate_a: EvidenceRecord::default(),
            candidate_b: EvidenceRecord::default(),
            terminal_ts: 0,
            terminal_slot: 0,
            terminal_actor: Pubkey::default(),
        }
    }

    fn raw(prev: i64, publish: i64) -> RawDecisionFields {
        RawDecisionFields {
            feed_id: FEED,
            price: 12_345_678,
            conf: 12_345,
            exponent: -6,
            publish_time: publish,
            prev_publish_time: prev,
            ema_price: 12_300_000,
            ema_conf: 12_000,
        }
    }

    fn evidence(tag: u8) -> EvidenceRecord {
        let mut item = EvidenceRecord {
            present: 1,
            verification_level: FULL_VERIFICATION_MARKER,
            message_hash: [tag; 32],
            price_update: sponsored_price_address(&FEED),
            write_authority: sponsored_price_address(&FEED),
            feed_id: FEED,
            price: 12_345_678,
            conf: 12_345,
            exponent: -6,
            publish_time: TARGET + 1,
            prev_publish_time: TARGET - 1,
            ema_price: 12_300_000,
            ema_conf: 12_000,
            posted_slot: 19,
            capture_slot: 20,
            capture_ts: TARGET + 1,
            capturer: Pubkey::new_unique(),
        };
        item.message_hash[31] = tag;
        item
    }

    #[test]
    fn opening_bounds_alignment_and_overflow_are_fail_closed() {
        let now = TARGET - 30;
        assert_eq!(validate_open(now, TARGET).unwrap(), TARGET + 180);
        assert!(validate_open(TARGET - 29, TARGET).is_err());
        assert!(validate_open(TARGET - MAX_OPEN_HORIZON_SECS - 1, TARGET).is_err());
        assert!(validate_open(now - 1, TARGET + 1).is_err());
        assert!(validate_open(i64::MAX - 10, i64::MAX).is_err());
    }

    #[test]
    fn source_identity_pins_owner_shard_write_authority_and_full() {
        let expected = sponsored_price_address(&FEED);
        assert!(
            validate_source_identity(PYTH_RECEIVER_ID, expected, expected, true, &FEED).is_ok()
        );
        assert!(
            validate_source_identity(Pubkey::new_unique(), expected, expected, true, &FEED)
                .is_err()
        );
        assert!(validate_source_identity(
            PYTH_RECEIVER_ID,
            Pubkey::new_unique(),
            expected,
            true,
            &FEED
        )
        .is_err());
        assert!(validate_source_identity(
            PYTH_RECEIVER_ID,
            expected,
            Pubkey::new_unique(),
            true,
            &FEED
        )
        .is_err());
        assert!(
            validate_source_identity(PYTH_RECEIVER_ID, expected, expected, false, &FEED).is_err()
        );
    }

    #[test]
    fn real_pyth_v2_bytes_round_trip_into_permanent_evidence() {
        let expected = sponsored_price_address(&FEED);
        let update = PriceUpdateV2 {
            write_authority: expected,
            verification_level: VerificationLevel::Full,
            price_message: PriceFeedMessage {
                feed_id: FEED,
                price: 12_345_678,
                conf: 12_345,
                exponent: -6,
                publish_time: TARGET + 1,
                prev_publish_time: TARGET - 1,
                ema_price: 12_300_000,
                ema_conf: 12_000,
            },
            posted_slot: 19,
        };
        let mut data = vec![0u8; PriceUpdateV2::LEN];
        update.try_serialize(&mut &mut data[..]).unwrap();
        let mut lamports = 1u64;
        let account = AccountInfo::new(
            &expected,
            false,
            false,
            &mut lamports,
            &mut data,
            &PYTH_RECEIVER_ID,
            false,
        );
        let clock = Clock {
            slot: 20,
            unix_timestamp: TARGET + 1,
            ..Clock::default()
        };
        let capturer = Pubkey::new_unique();
        let evidence = load_evidence(&account, FEED, TARGET, &clock, capturer).unwrap();
        assert_eq!(evidence.feed_id, FEED);
        assert_eq!(evidence.price, update.price_message.price);
        assert_eq!(evidence.conf, update.price_message.conf);
        assert_eq!(evidence.prev_publish_time, TARGET - 1);
        assert_eq!(evidence.publish_time, TARGET + 1);
        assert_eq!(evidence.posted_slot, 19);
        assert_eq!(evidence.capture_slot, 20);
        assert_eq!(evidence.capture_ts, TARGET + 1);
        assert_eq!(evidence.capturer, capturer);
        assert_eq!(evidence.verification_level, FULL_VERIFICATION_MARKER);
    }

    #[test]
    fn only_the_strict_signed_crossing_is_accepted() {
        assert!(validate_decision(&raw(TARGET - 1, TARGET), &FEED, TARGET, TARGET).is_ok());
        assert!(validate_decision(&raw(TARGET, TARGET + 1), &FEED, TARGET, TARGET + 1).is_err());
        assert!(validate_decision(&raw(TARGET - 2, TARGET - 1), &FEED, TARGET, TARGET).is_err());

        let mut wrong_feed = raw(TARGET - 1, TARGET);
        wrong_feed.feed_id = [8; 32];
        assert!(validate_decision(&wrong_feed, &FEED, TARGET, TARGET).is_err());

        let mut zero_price = raw(TARGET - 1, TARGET);
        zero_price.price = 0;
        assert!(validate_decision(&zero_price, &FEED, TARGET, TARGET).is_err());

        let mut zero_conf = raw(TARGET - 1, TARGET);
        zero_conf.conf = 0;
        assert!(validate_decision(&zero_conf, &FEED, TARGET, TARGET).is_err());

        let mut wide = raw(TARGET - 1, TARGET);
        wide.conf = wide.price as u64 + 1;
        assert!(validate_decision(&wide, &FEED, TARGET, TARGET).is_err());

        let mut exponent = raw(TARGET - 1, TARGET);
        exponent.exponent = MAX_ABS_EXPONENT + 1;
        assert!(validate_decision(&exponent, &FEED, TARGET, TARGET).is_err());

        let future = raw(TARGET - 1, TARGET + MAX_ORACLE_FUTURE_SKEW_SECS + 1);
        assert!(validate_decision(&future, &FEED, TARGET, TARGET).is_err());

        let after_deadline = raw(TARGET - 1, TARGET + CAPTURE_WINDOW_SECS + 1);
        assert!(validate_decision(
            &after_deadline,
            &FEED,
            TARGET,
            TARGET + CAPTURE_WINDOW_SECS - 1
        )
        .is_err());
    }

    #[test]
    fn candidate_duplicate_and_ambiguity_are_deterministic() {
        let actor = Pubkey::new_unique();
        let mut need = blank_need();
        assert_eq!(
            capture_transition(&mut need, evidence(9), TARGET, 20, actor).unwrap(),
            CaptureDisposition::Candidate
        );
        assert_eq!(need.state, NeedState::Candidate as u8);
        assert_eq!(need.candidate_count, 1);

        assert_eq!(
            capture_transition(&mut need, evidence(9), TARGET + 1, 21, actor).unwrap(),
            CaptureDisposition::Duplicate
        );
        assert_eq!(need.candidate_count, 1);

        assert_eq!(
            capture_transition(&mut need, evidence(3), TARGET + 2, 22, actor).unwrap(),
            CaptureDisposition::Ambiguous
        );
        assert_eq!(need.state, NeedState::Ambiguous as u8);
        assert_eq!(need.candidate_count, 2);
        assert!(need.candidate_a.message_hash < need.candidate_b.message_hash);
        assert!(capture_transition(&mut need, evidence(1), TARGET + 3, 23, actor).is_err());
        assert!(finalize_transition(&mut need, TARGET + 180, 24, actor).is_err());
        assert!(expire_transition(&mut need, TARGET + 180, 24, actor).is_err());
    }

    #[test]
    fn exact_deadline_partitions_capture_from_final_and_expired() {
        let actor = Pubkey::new_unique();
        let deadline = TARGET + CAPTURE_WINDOW_SECS;

        let mut candidate = blank_need();
        assert!(capture_transition(&mut candidate, evidence(1), TARGET - 1, 20, actor).is_err());
        capture_transition(&mut candidate, evidence(1), deadline - 1, 20, actor).unwrap();
        assert!(capture_transition(&mut candidate, evidence(2), deadline, 21, actor).is_err());
        assert!(finalize_transition(&mut candidate, deadline - 1, 21, actor).is_err());
        finalize_transition(&mut candidate, deadline, 22, actor).unwrap();
        assert_eq!(candidate.state, NeedState::Final as u8);
        assert!(finalize_transition(&mut candidate, deadline + 1, 23, actor).is_err());

        let mut unanswered = blank_need();
        assert!(expire_transition(&mut unanswered, deadline - 1, 20, actor).is_err());
        expire_transition(&mut unanswered, deadline, 21, actor).unwrap();
        assert_eq!(unanswered.state, NeedState::Expired as u8);
        assert!(capture_transition(&mut unanswered, evidence(1), deadline + 1, 22, actor).is_err());
    }

    #[test]
    fn canonical_pda_excludes_caller_and_source_hash_is_stable() {
        let target = TARGET.to_le_bytes();
        let (address, bump) = Pubkey::find_program_address(
            &[
                NEED_SEED,
                SCHEMA_SEED.as_ref(),
                ORACLE_DOMAIN.as_ref(),
                FEED.as_ref(),
                target.as_ref(),
            ],
            &crate::ID,
        );
        let (again, again_bump) = Pubkey::find_program_address(
            &[
                NEED_SEED,
                SCHEMA_SEED.as_ref(),
                ORACLE_DOMAIN.as_ref(),
                FEED.as_ref(),
                target.as_ref(),
            ],
            &crate::ID,
        );
        assert_eq!(address, again);
        assert_eq!(bump, again_bump);
        assert_eq!(
            address.to_string(),
            "2MVzFKdx4HCPP75hv297VKj8uHrqhr9Ne75MqyuxLCnQ"
        );
        assert_eq!(bump, 254);

        let first = raw(TARGET - 1, TARGET);
        let same = raw(TARGET - 1, TARGET);
        let changed = raw(TARGET - 2, TARGET);
        assert_eq!(price_message_hash(&first), price_message_hash(&same));
        assert_ne!(price_message_hash(&first), price_message_hash(&changed));
        assert_eq!(
            price_message_hash(&first)
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>(),
            "672f49696d41304b30d66b687b2c5dfb4ba7ddf7109d3a39535effd10500d038"
        );
    }

    #[test]
    fn fixed_account_length_matches_borsh_and_has_no_ring() {
        let mut serialized = Vec::new();
        blank_need().try_serialize(&mut serialized).unwrap();
        assert_eq!(EvidenceRecord::LEN, 238);
        assert_eq!(TimepinNeed::LEN, 657);
        assert_eq!(serialized.len(), 8 + TimepinNeed::LEN);
        assert_eq!(blank_need().candidate_count, 0);
    }

    #[test]
    fn official_program_ids_are_pinned() {
        assert_eq!(
            PYTH_RECEIVER_ID.to_string(),
            "rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp"
        );
        assert_ne!(PYTH_RECEIVER_ID, PYTH_PUSH_ORACLE_ID);
        assert_eq!(ORACLE_DOMAIN, PYTH_PUSH_ORACLE_ID);
    }
}
