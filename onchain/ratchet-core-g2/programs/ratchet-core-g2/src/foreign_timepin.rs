//! Byte-exact, read-only authentication of RCX Timepin v2 accounts.
//!
//! Core never accepts a caller-decoded price or terminal flag. Every decision
//! is reconstructed from accounts owned by the immutable Timepin program and
//! from their canonical PDAs, discriminators, lengths and hashes.

use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

pub const TIMEPIN_SCHEMA_V2: u16 = 2;
// Core is a FOREIGN reader: it does not depend on the rcx-timepin-v2 crate, so
// the adapter bytes are re-declared here and MUST match that crate's lib.rs
// exactly. If they drift, Core and Timepin disagree about which price settles a
// shot -- it settles in one program and voids in the other. Nothing at compile
// time can catch that across two crates, so it is policed by
// test/test_client_model_parity.mjs, which reads every ADAPTER_ constant out of
// all three files and requires one value per name.
pub const ADAPTER_PYTH_PUSH_V2: u8 = 1;
pub const ADAPTER_PYTH_MIN_CAPTURE_V2: u8 = 2;
pub const NEED_OPEN: u8 = 0;
pub const NEED_CANDIDATE: u8 = 1;
pub const NEED_FINAL: u8 = 2;
pub const NEED_AMBIGUOUS: u8 = 3;
pub const NEED_EXPIRED: u8 = 4;

// 8 + 160. The Need's payload is 124 (schema 2, bump 1, state 1,
// evidence_spec_hash 32, target_ts 8, source_deadline 8, capture_deadline 8,
// candidate_a_hash 32, candidate_b_hash 32) plus the 36 rent bytes Timepin now
// writes: open_refs 4 and rent_payer 32. Timepin's TimepinNeedV2::LEN says 160
// and decode_exact demands EQUALITY, so this constant and that one are one fact
// written twice and they must move together.
//
// It said 8 + 124 for a day after Timepin grew, and every Core instruction that
// loaded a Need failed on chain with BadTimepinLength - no shot could be sealed
// or settled while both crates compiled and both host suites passed. Core's own
// tests FABRICATE Timepin's accounts from Core's structs, so the fixture and the
// reader were the same definition agreeing with each other about a shape the
// other program had stopped writing. That is why nothing caught it, and it is
// why test/test_core_reads_what_timepin_writes.mjs reads BOTH crates.
pub const NEED_ACCOUNT_LEN: usize = 8 + 160;
pub const EVIDENCE_SPEC_ACCOUNT_LEN: usize = 8 + 254;
// 8 + 143 since 2026-09-10, when CandidateV2 gained rent_payer so the capture
// rent could be given back. decode_exact demands EQUALITY, so this number and
// Timepin's CandidateV2::LEN are one fact written twice; test_foreign_timepin_abi
// is what stops the two copies from drifting, and it is the test that caught
// this one before it reached a chain.
pub const CANDIDATE_ACCOUNT_LEN: usize = 8 + 143;
pub const EVIDENCE_POLICY_CANONICAL_LEN: usize = 134;
pub const EVIDENCE_SPEC_CANONICAL_LEN: usize = 214;

const NEED_DISCRIMINATOR: [u8; 8] = [0xe1, 0xf8, 0xcc, 0x82, 0x10, 0x15, 0x58, 0x6c];
const EVIDENCE_SPEC_DISCRIMINATOR: [u8; 8] = [0x5e, 0x4c, 0x19, 0xf1, 0x27, 0x41, 0x46, 0xe4];
const CANDIDATE_DISCRIMINATOR: [u8; 8] = [0xdc, 0xdf, 0x41, 0x08, 0xb3, 0x71, 0x5f, 0x4f];

const NEED_SEED: &[u8] = b"need";
const EVIDENCE_SPEC_SEED: &[u8] = b"evidence_spec";
const CANDIDATE_SEED: &[u8] = b"candidate";
const PRICE_MESSAGE_HASH_DOMAIN: &[u8] = b"rcx-timepin:pyth-price-message:v2\0";
const EVIDENCE_POLICY_HASH_DOMAIN: &[u8] = b"rcx-timepin:evidence-policy:v2\0";
const EVIDENCE_SPEC_HASH_DOMAIN: &[u8] = b"rcx-timepin:evidence-spec:v2-generation\0";
const EVIDENCE_SET_HASH_DOMAIN: &[u8] = b"rcx-timepin:evidence-set:v2\0";
const EXPIRED_HASH_DOMAIN: &[u8] = b"rcx-timepin:expired:v2\0";

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TimepinNeedV2View {
    pub schema: u16,
    pub bump: u8,
    pub state: u8,
    pub evidence_spec_hash: [u8; 32],
    pub target_ts: i64,
    pub source_deadline_ts: i64,
    pub capture_deadline_ts: i64,
    pub candidate_a_hash: [u8; 32],
    pub candidate_b_hash: [u8; 32],

    // THE RENT FIELDS, and they are the only two Timepin added that anything
    // writes. open_refs counts the live references to this Need; rent_payer is
    // whoever funded it and the only address close_need may ever refund. Borsh
    // reads by position, so this order mirrors rcx-timepin-v2's TimepinNeedV2
    // exactly - an order that merely looks right decodes garbage.
    //
    // The eleven obs_ fields that briefly lived here are NOT in this view, and
    // that is deliberate: Timepin declares them and writes zeros into every one.
    // The real observation is in the CandidateV2 account this file loads below.
    pub open_refs: u32,
    pub rent_payer: Pubkey,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EvidenceRecordV2View {
    pub message_hash: [u8; 32],
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
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
struct CandidateV2AccountView {
    pub schema: u16,
    pub bump: u8,
    pub need: Pubkey,
    /// Read only to keep the field offsets after it correct. Core never uses it:
    /// who paid for the account is not a fact about the price.
    pub rent_payer: Pubkey,
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
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TerminalTimepinV2View {
    pub terminal_kind: u8,
    pub result_hash: [u8; 32],
}

fn decode_exact<T: AnchorDeserialize>(
    account: &AccountInfo,
    program: &Pubkey,
    expected_len: usize,
    discriminator: &[u8; 8],
) -> Result<T> {
    require!(
        !account.executable,
        TimepinConsumerError::ExecutableForeignAccount
    );
    require_keys_eq!(
        *account.owner,
        *program,
        TimepinConsumerError::WrongTimepinOwner
    );
    let data = account
        .try_borrow_data()
        .map_err(|_| error!(TimepinConsumerError::BadTimepinData))?;
    require!(
        data.len() == expected_len,
        TimepinConsumerError::BadTimepinLength
    );
    require!(
        data[0..8] == discriminator[..],
        TimepinConsumerError::BadTimepinDiscriminator
    );
    let mut payload = &data[8..];
    let value =
        T::deserialize(&mut payload).map_err(|_| error!(TimepinConsumerError::BadTimepinData))?;
    require!(payload.is_empty(), TimepinConsumerError::BadTimepinData);
    Ok(value)
}

pub fn load_evidence_spec(
    account: &AccountInfo,
    program: &Pubkey,
    evidence_spec_hash: &[u8; 32],
) -> Result<EvidenceSpecV2View> {
    let spec: EvidenceSpecV2View = decode_exact(
        account,
        program,
        EVIDENCE_SPEC_ACCOUNT_LEN,
        &EVIDENCE_SPEC_DISCRIMINATOR,
    )?;
    require!(
        spec.schema == TIMEPIN_SCHEMA_V2,
        TimepinConsumerError::WrongTimepinSchema
    );
    validate_spec_shape(&spec)?;
    require!(
        evidence_policy_hash_from_spec(&spec)? == spec.evidence_policy_hash,
        TimepinConsumerError::WrongEvidencePolicy
    );
    require!(
        evidence_spec_hash_from_spec(&spec)? == *evidence_spec_hash,
        TimepinConsumerError::WrongEvidenceSpec
    );
    let schema = TIMEPIN_SCHEMA_V2.to_le_bytes();
    let (expected, _) = Pubkey::find_program_address(
        &[
            EVIDENCE_SPEC_SEED,
            schema.as_ref(),
            evidence_spec_hash.as_ref(),
        ],
        program,
    );
    require_keys_eq!(
        account.key(),
        expected,
        TimepinConsumerError::WrongEvidenceSpecPda
    );
    Ok(spec)
}

pub fn load_need(
    account: &AccountInfo,
    program: &Pubkey,
    evidence_spec_hash: &[u8; 32],
    target_ts: i64,
) -> Result<TimepinNeedV2View> {
    let need: TimepinNeedV2View =
        decode_exact(account, program, NEED_ACCOUNT_LEN, &NEED_DISCRIMINATOR)?;
    require!(
        need.schema == TIMEPIN_SCHEMA_V2,
        TimepinConsumerError::WrongTimepinSchema
    );
    require!(
        need.evidence_spec_hash == *evidence_spec_hash,
        TimepinConsumerError::WrongEvidenceSpec
    );
    require!(
        need.target_ts == target_ts,
        TimepinConsumerError::WrongTarget
    );
    let schema = TIMEPIN_SCHEMA_V2.to_le_bytes();
    let target = target_ts.to_le_bytes();
    let (expected, bump) = Pubkey::find_program_address(
        &[
            NEED_SEED,
            schema.as_ref(),
            evidence_spec_hash.as_ref(),
            target.as_ref(),
        ],
        program,
    );
    require_keys_eq!(account.key(), expected, TimepinConsumerError::WrongNeedPda);
    require!(need.bump == bump, TimepinConsumerError::WrongTimepinBump);
    require!(
        need.source_deadline_ts >= need.target_ts
            && need.capture_deadline_ts > need.source_deadline_ts,
        TimepinConsumerError::BadTerminalShape
    );
    validate_need_shape(&need)?;
    Ok(need)
}

pub fn load_open_need(
    account: &AccountInfo,
    program: &Pubkey,
    evidence_spec_hash: &[u8; 32],
    target_ts: i64,
) -> Result<TimepinNeedV2View> {
    let need = load_need(account, program, evidence_spec_hash, target_ts)?;
    require!(need.state == NEED_OPEN, TimepinConsumerError::NeedNotOpen);
    Ok(need)
}

fn validate_need_shape(need: &TimepinNeedV2View) -> Result<()> {
    match need.state {
        NEED_OPEN | NEED_EXPIRED => require!(
            need.candidate_a_hash == [0; 32] && need.candidate_b_hash == [0; 32],
            TimepinConsumerError::BadTerminalShape
        ),
        NEED_CANDIDATE | NEED_FINAL => require!(
            need.candidate_a_hash != [0; 32] && need.candidate_b_hash == [0; 32],
            TimepinConsumerError::BadTerminalShape
        ),
        NEED_AMBIGUOUS => require!(
            need.candidate_a_hash != [0; 32]
                && need.candidate_b_hash != [0; 32]
                && need.candidate_a_hash < need.candidate_b_hash,
            TimepinConsumerError::BadTerminalShape
        ),
        _ => return err!(TimepinConsumerError::BadTerminalShape),
    }
    Ok(())
}

fn load_candidate(
    account: &AccountInfo,
    program: &Pubkey,
    need_key: &Pubkey,
    message_hash: &[u8; 32],
    need: &TimepinNeedV2View,
    spec: &EvidenceSpecV2View,
) -> Result<EvidenceRecordV2View> {
    let candidate: CandidateV2AccountView = decode_exact(
        account,
        program,
        CANDIDATE_ACCOUNT_LEN,
        &CANDIDATE_DISCRIMINATOR,
    )?;
    require!(
        candidate.schema == TIMEPIN_SCHEMA_V2,
        TimepinConsumerError::WrongTimepinSchema
    );
    let (expected, bump) = Pubkey::find_program_address(
        &[CANDIDATE_SEED, need_key.as_ref(), message_hash.as_ref()],
        program,
    );
    require_keys_eq!(
        account.key(),
        expected,
        TimepinConsumerError::WrongCandidatePda
    );
    require!(
        candidate.bump == bump,
        TimepinConsumerError::WrongTimepinBump
    );
    require_keys_eq!(
        candidate.need,
        *need_key,
        TimepinConsumerError::WrongNeedReference
    );
    let record = EvidenceRecordV2View {
        message_hash: *message_hash,
        feed_id: spec.feed_id,
        price: candidate.price,
        conf: candidate.conf,
        exponent: candidate.exponent,
        publish_time: candidate.publish_time,
        prev_publish_time: candidate.prev_publish_time,
        ema_price: candidate.ema_price,
        ema_conf: candidate.ema_conf,
        posted_slot: candidate.posted_slot,
        capture_slot: candidate.capture_slot,
        capture_ts: candidate.capture_ts,
    };
    require!(
        price_message_hash(&record) == *message_hash,
        TimepinConsumerError::WrongMessageHash
    );
    validate_record_against_spec(&record, spec, need.target_ts)?;
    require!(
        record.capture_ts >= need.target_ts && record.capture_ts < need.capture_deadline_ts,
        TimepinConsumerError::CaptureOutsideWindow
    );
    require!(
        record.posted_slot > spec.registered_slot,
        TimepinConsumerError::PostedBeforeRegistration
    );
    require!(
        record.posted_slot <= record.capture_slot,
        TimepinConsumerError::FuturePostedSlot
    );
    let newest_allowed = record
        .capture_ts
        .checked_add(i64::from(spec.max_future_skew_seconds))
        .ok_or(TimepinConsumerError::TimestampOverflow)?;
    require!(
        record.publish_time <= newest_allowed,
        TimepinConsumerError::OracleTimeInFuture
    );
    Ok(record)
}

pub fn authenticate_final(
    need_account: &AccountInfo,
    candidate_account: &AccountInfo,
    program: &Pubkey,
    evidence_spec_hash: &[u8; 32],
    spec: &EvidenceSpecV2View,
    target_ts: i64,
) -> Result<(TerminalTimepinV2View, EvidenceRecordV2View)> {
    let need = load_need(need_account, program, evidence_spec_hash, target_ts)?;
    require!(need.state == NEED_FINAL, TimepinConsumerError::NeedNotFinal);
    let need_key = need_account.key();
    require!(
        evidence_policy_hash_from_spec(spec)? == spec.evidence_policy_hash
            && evidence_spec_hash_from_spec(spec)? == *evidence_spec_hash,
        TimepinConsumerError::WrongEvidenceSpec
    );
    let record = load_candidate(
        candidate_account,
        program,
        &need_key,
        &need.candidate_a_hash,
        &need,
        spec,
    )?;
    Ok((
        TerminalTimepinV2View {
            terminal_kind: NEED_FINAL,
            result_hash: terminal_result_hash(&need_key, &need)?,
        },
        record,
    ))
}

pub fn authenticate_void_terminal(
    need_account: &AccountInfo,
    program: &Pubkey,
    evidence_spec_hash: &[u8; 32],
    target_ts: i64,
) -> Result<TerminalTimepinV2View> {
    let need = load_need(need_account, program, evidence_spec_hash, target_ts)?;
    require!(
        need.state == NEED_AMBIGUOUS || need.state == NEED_EXPIRED,
        TimepinConsumerError::NeedNotVoidTerminal
    );
    let need_key = need_account.key();
    Ok(TerminalTimepinV2View {
        terminal_kind: need.state,
        result_hash: terminal_result_hash(&need_key, &need)?,
    })
}

pub fn validate_record_against_spec(
    record: &EvidenceRecordV2View,
    spec: &EvidenceSpecV2View,
    target_ts: i64,
) -> Result<()> {
    require!(
        record.feed_id == spec.feed_id,
        TimepinConsumerError::WrongFeed
    );
    require!(
        price_message_hash(record) == record.message_hash,
        TimepinConsumerError::WrongMessageHash
    );
    // Must stay byte-for-byte the same decision as
    // rcx-timepin-v2 lifecycle.rs::validate_decision_fields. If Core and Timepin
    // disagree, a shot settles in one and voids in the other. The JS mirrors of
    // both are covered by test/test_client_model_parity.mjs.
    if spec.adapter == ADAPTER_PYTH_MIN_CAPTURE_V2 {
        // MIN-CAPTURE: the earliest print at or after the target.
        // prev_publish_time is not part of the predicate and
        // max_pre_target_gap_seconds is pinned to zero at registration.
        require!(
            record.publish_time >= target_ts,
            TimepinConsumerError::PublishBeforeTarget
        );
    } else {
        require!(
            record.prev_publish_time < target_ts && target_ts <= record.publish_time,
            TimepinConsumerError::DoesNotBracketTarget
        );
        let pre_gap = target_ts
            .checked_sub(record.prev_publish_time)
            .ok_or(TimepinConsumerError::TimestampOverflow)?;
        require!(
            pre_gap <= i64::from(spec.max_pre_target_gap_seconds),
            TimepinConsumerError::PreTargetGapTooLarge
        );
    }
    // Shared by both adapters.
    let post_lag = record
        .publish_time
        .checked_sub(target_ts)
        .ok_or(TimepinConsumerError::TimestampOverflow)?;
    require!(
        post_lag <= i64::from(spec.max_post_target_lag_seconds),
        TimepinConsumerError::PostTargetLagTooLarge
    );
    require!(record.price > 0, TimepinConsumerError::NonPositivePrice);
    require!(
        record.exponent >= i32::from(spec.min_exponent)
            && record.exponent <= i32::from(spec.max_exponent),
        TimepinConsumerError::BadExponent
    );
    let conf = u128::from(record.conf)
        .checked_mul(10_000)
        .ok_or(TimepinConsumerError::MathOverflow)?;
    let price: u128 = record
        .price
        .try_into()
        .map_err(|_| error!(TimepinConsumerError::NonPositivePrice))?;
    let bound = price
        .checked_mul(u128::from(spec.max_confidence_bps))
        .ok_or(TimepinConsumerError::MathOverflow)?;
    require!(conf <= bound, TimepinConsumerError::WideConfidence);
    Ok(())
}

pub fn price_message_hash(record: &EvidenceRecordV2View) -> [u8; 32] {
    hashv(&[
        PRICE_MESSAGE_HASH_DOMAIN,
        record.feed_id.as_ref(),
        &record.price.to_le_bytes(),
        &record.conf.to_le_bytes(),
        &record.exponent.to_le_bytes(),
        &record.publish_time.to_le_bytes(),
        &record.prev_publish_time.to_le_bytes(),
        &record.ema_price.to_le_bytes(),
        &record.ema_conf.to_le_bytes(),
    ])
    .to_bytes()
}

pub fn terminal_result_hash(need_key: &Pubkey, need: &TimepinNeedV2View) -> Result<[u8; 32]> {
    validate_need_shape(need)?;
    match need.state {
        NEED_FINAL => Ok(hashv(&[
            EVIDENCE_SET_HASH_DOMAIN,
            need_key.as_ref(),
            need.candidate_a_hash.as_ref(),
        ])
        .to_bytes()),
        NEED_AMBIGUOUS => Ok(hashv(&[
            EVIDENCE_SET_HASH_DOMAIN,
            need_key.as_ref(),
            need.candidate_a_hash.as_ref(),
            need.candidate_b_hash.as_ref(),
        ])
        .to_bytes()),
        NEED_EXPIRED => Ok(hashv(&[
            EXPIRED_HASH_DOMAIN,
            need_key.as_ref(),
            &need.target_ts.to_le_bytes(),
        ])
        .to_bytes()),
        _ => err!(TimepinConsumerError::WrongTerminalKind),
    }
}

#[error_code]
pub enum TimepinConsumerError {
    #[msg("foreign Timepin account is executable")]
    ExecutableForeignAccount,
    #[msg("foreign account is not owned by the pinned Timepin program")]
    WrongTimepinOwner,
    #[msg("foreign Timepin account has the wrong exact length")]
    BadTimepinLength,
    #[msg("foreign Timepin account has the wrong discriminator")]
    BadTimepinDiscriminator,
    #[msg("foreign Timepin account cannot be decoded exactly")]
    BadTimepinData,
    #[msg("foreign Timepin account uses another schema")]
    WrongTimepinSchema,
    #[msg("foreign Need references another EvidenceSpec")]
    WrongEvidenceSpec,
    #[msg("foreign Need references another target")]
    WrongTarget,
    #[msg("foreign Need has the wrong PDA")]
    WrongNeedPda,
    #[msg("foreign EvidenceSpec has the wrong PDA")]
    WrongEvidenceSpecPda,
    #[msg("foreign Candidate has the wrong PDA")]
    WrongCandidatePda,
    #[msg("foreign terminal Timepin has the wrong PDA")]
    WrongTerminalPda,
    #[msg("foreign Timepin account has a noncanonical bump")]
    WrongTimepinBump,
    #[msg("foreign account references another Need")]
    WrongNeedReference,
    #[msg("Need is not open")]
    NeedNotOpen,
    #[msg("Need is not Final")]
    NeedNotFinal,
    #[msg("Need is not Ambiguous or Expired")]
    NeedNotVoidTerminal,
    #[msg("terminal kind does not match the authenticated Need")]
    WrongTerminalKind,
    #[msg("Timepin terminal/candidate shape is inconsistent")]
    BadTerminalShape,
    #[msg("Candidate message hash does not authenticate its evidence")]
    WrongMessageHash,
    #[msg("terminal result hash does not authenticate its evidence set")]
    WrongResultHash,
    #[msg("terminal Timepin omits its actor")]
    MissingTerminalActor,
    #[msg("Candidate feed does not match its EvidenceSpec")]
    WrongFeed,
    #[msg("Candidate was not captured with Full verification")]
    NotFullVerification,
    #[msg("Candidate source layout length is not PriceUpdateV2")]
    WrongSourceLayout,
    #[msg("Candidate source owner does not match its EvidenceSpec")]
    WrongSourceOwner,
    #[msg("Candidate source PDA does not match its EvidenceSpec")]
    WrongSourcePda,
    #[msg("Candidate write authority does not match its source PDA")]
    WrongWriteAuthority,
    #[msg("Candidate source interval does not bracket the target")]
    DoesNotBracketTarget,
    #[msg("Candidate predecessor gap exceeds the EvidenceSpec")]
    PreTargetGapTooLarge,
    #[msg("Candidate publication lag exceeds the EvidenceSpec")]
    PostTargetLagTooLarge,
    #[msg("Candidate price must be positive")]
    NonPositivePrice,
    #[msg("Candidate exponent is outside the EvidenceSpec")]
    BadExponent,
    #[msg("Candidate confidence exceeds the EvidenceSpec")]
    WideConfidence,
    #[msg("Candidate posted slot is after its capture slot")]
    FuturePostedSlot,
    #[msg("foreign timestamp arithmetic overflowed")]
    TimestampOverflow,
    #[msg("foreign evidence arithmetic overflowed")]
    MathOverflow,
    #[msg("EvidenceSpec fields or generation pins are inconsistent")]
    BadEvidenceSpec,
    #[msg("EvidenceSpec policy hash is not canonical")]
    WrongEvidencePolicy,
    #[msg("Candidate posted slot is not after EvidenceSpec registration")]
    PostedBeforeRegistration,
    #[msg("Candidate capture time is outside the Need window")]
    CaptureOutsideWindow,
    #[msg("Candidate publication time is implausibly ahead of its capture")]
    OracleTimeInFuture,
    // APPENDED AT THE TAIL ON PURPOSE. Anchor assigns error codes by declaration
    // order, so moving this next to DoesNotBracketTarget renumbers every variant
    // below it and breaks anything mapping a numeric code.
    #[msg("Candidate publication time is before the target")]
    PublishBeforeTarget,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EvidenceSpecV2View {
    pub schema: u16,
    pub adapter: u8,
    pub receiver_program: Pubkey,
    pub push_oracle_program: Pubkey,
    pub shard_id: u16,
    pub feed_id: [u8; 32],
    pub required_verification: u8,
    pub target_grid_seconds: u32,
    pub min_open_lead_seconds: u32,
    pub max_target_ahead_seconds: u32,
    pub max_pre_target_gap_seconds: u32,
    pub max_post_target_lag_seconds: u32,
    pub capture_grace_seconds: u32,
    pub max_future_skew_seconds: u16,
    pub min_exponent: i8,
    pub max_exponent: i8,
    pub max_confidence_bps: u32,
    pub evidence_policy_hash: [u8; 32],
    pub receiver_programdata_slot: u64,
    pub receiver_config_hash: [u8; 32],
    pub wormhole_program: Pubkey,
    pub wormhole_programdata_slot: u64,
    pub registered_slot: u64,
}

fn validate_spec_shape(spec: &EvidenceSpecV2View) -> Result<()> {
    require!(
        spec.schema == TIMEPIN_SCHEMA_V2
            // BOTH ADAPTERS, because this file already settles BOTH at :391.
            // It used to read `spec.adapter == 1`, which refused every
            // MIN-CAPTURE spec at registration and made the MIN-CAPTURE branch
            // of validate_record_against_spec UNREACHABLE - a gatekeeper contradicting
            // its own predicate two hundred lines below, and a comment at :394
            // asserting a pin this line forbade.
            && (spec.adapter == ADAPTER_PYTH_PUSH_V2
                || spec.adapter == ADAPTER_PYTH_MIN_CAPTURE_V2)
            && spec.receiver_program != Pubkey::default()
            && spec.push_oracle_program != Pubkey::default()
            && spec.feed_id != [0; 32]
            && spec.required_verification == 1
            && spec.target_grid_seconds > 0
            && spec.min_open_lead_seconds > 0
            && spec.max_target_ahead_seconds >= spec.min_open_lead_seconds
            // THE PRE-GAP IS PINNED IN OPPOSITE DIRECTIONS BY THE TWO
            // ADAPTERS, and this must mirror rcx-timepin-v2 lib.rs:573-583
            // exactly. Under MIN-CAPTURE prev_publish_time is not part of the
            // predicate, so a non-zero bound would be a dead number inside
            // canonical_policy_bytes and therefore inside every spec hash,
            // misleading every later reader; the field cannot be dropped
            // because it is hashed, so it is pinned to zero instead. Under the
            // strict bracket it is load-bearing and must be positive.
            //
            // Timepin refuses each adapter carrying the other's value. So did
            // Core's predicate. Only Core's REGISTRATION check did not, and it
            // pinned the strict-bracket direction unconditionally.
            // Written as a plain boolean rather than an `if` block: this is the
            // inside of a require! macro, and a block-like expression as the
            // right operand of && is the kind of thing that is either fine or a
            // parse error depending on context. There is no compiler on this
            // machine, so the form with no syntax risk wins.
            && ((spec.adapter == ADAPTER_PYTH_MIN_CAPTURE_V2
                && spec.max_pre_target_gap_seconds == 0)
                || (spec.adapter != ADAPTER_PYTH_MIN_CAPTURE_V2
                    && spec.max_pre_target_gap_seconds > 0))
            && spec.max_post_target_lag_seconds > 0
            // THE R2 MIRROR. A print is admissible for target T iff
            // T <= publish_time <= T + lag, so it serves two consecutive targets
            // iff lag >= grid: lag < grid is necessary and sufficient for every
            // print to belong to at most one target. rcx-timepin-v2 refuses a
            // spec that breaks it at lib.rs:603; Core authenticated one happily,
            // which made Core's view of a spec LOOSER than the program that
            // writes specs.
            //
            // Copied from Timepin, not re-derived - two independent derivations
            // of one rule is precisely what made the adapter gate contradict its
            // own predicate. And copied EXACTLY: lag < grid, never lag == grid-1.
            // grid - 1 is a manifest choice that maximises coverage subject to
            // uniqueness; a program demanding the equality would refuse specs
            // that are perfectly legal.
            && spec.max_post_target_lag_seconds < spec.target_grid_seconds
            && spec.capture_grace_seconds > 0
            && spec.min_exponent <= spec.max_exponent
            && spec.max_confidence_bps <= 10_000
            && spec.evidence_policy_hash != [0; 32]
            && spec.receiver_programdata_slot > 0
            && spec.receiver_config_hash != [0; 32]
            && spec.wormhole_program != Pubkey::default()
            && spec.wormhole_programdata_slot > 0
            && spec.registered_slot > spec.receiver_programdata_slot
            && spec.registered_slot > spec.wormhole_programdata_slot,
        TimepinConsumerError::BadEvidenceSpec
    );
    Ok(())
}

fn canonical_policy_bytes(
    spec: &EvidenceSpecV2View,
) -> Result<[u8; EVIDENCE_POLICY_CANONICAL_LEN]> {
    let mut bytes = Vec::with_capacity(EVIDENCE_POLICY_CANONICAL_LEN);
    bytes.extend_from_slice(&spec.schema.to_le_bytes());
    bytes.push(spec.adapter);
    bytes.extend_from_slice(spec.receiver_program.as_ref());
    bytes.extend_from_slice(spec.push_oracle_program.as_ref());
    bytes.extend_from_slice(&spec.shard_id.to_le_bytes());
    bytes.extend_from_slice(&spec.feed_id);
    bytes.push(spec.required_verification);
    bytes.extend_from_slice(&spec.target_grid_seconds.to_le_bytes());
    bytes.extend_from_slice(&spec.min_open_lead_seconds.to_le_bytes());
    bytes.extend_from_slice(&spec.max_target_ahead_seconds.to_le_bytes());
    bytes.extend_from_slice(&spec.max_pre_target_gap_seconds.to_le_bytes());
    bytes.extend_from_slice(&spec.max_post_target_lag_seconds.to_le_bytes());
    bytes.extend_from_slice(&spec.capture_grace_seconds.to_le_bytes());
    bytes.extend_from_slice(&spec.max_future_skew_seconds.to_le_bytes());
    bytes.extend_from_slice(&spec.min_exponent.to_le_bytes());
    bytes.extend_from_slice(&spec.max_exponent.to_le_bytes());
    bytes.extend_from_slice(&spec.max_confidence_bps.to_le_bytes());
    bytes
        .try_into()
        .map_err(|_| error!(TimepinConsumerError::BadTimepinData))
}

fn canonical_spec_bytes(spec: &EvidenceSpecV2View) -> Result<[u8; EVIDENCE_SPEC_CANONICAL_LEN]> {
    let policy = canonical_policy_bytes(spec)?;
    let mut bytes = Vec::with_capacity(EVIDENCE_SPEC_CANONICAL_LEN);
    bytes.extend_from_slice(&policy);
    bytes.extend_from_slice(&spec.receiver_programdata_slot.to_le_bytes());
    bytes.extend_from_slice(&spec.receiver_config_hash);
    bytes.extend_from_slice(spec.wormhole_program.as_ref());
    bytes.extend_from_slice(&spec.wormhole_programdata_slot.to_le_bytes());
    bytes
        .try_into()
        .map_err(|_| error!(TimepinConsumerError::BadTimepinData))
}

pub fn evidence_policy_hash_from_spec(spec: &EvidenceSpecV2View) -> Result<[u8; 32]> {
    let canonical = canonical_policy_bytes(spec)?;
    Ok(hashv(&[EVIDENCE_POLICY_HASH_DOMAIN, canonical.as_ref()]).to_bytes())
}

pub fn evidence_spec_hash_from_spec(spec: &EvidenceSpecV2View) -> Result<[u8; 32]> {
    let canonical = canonical_spec_bytes(spec)?;
    Ok(hashv(&[EVIDENCE_SPEC_HASH_DOMAIN, canonical.as_ref()]).to_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> EvidenceSpecV2View {
        let mut value = EvidenceSpecV2View {
            schema: TIMEPIN_SCHEMA_V2,
            adapter: 1,
            receiver_program: Pubkey::new_from_array([1; 32]),
            push_oracle_program: Pubkey::new_from_array([2; 32]),
            shard_id: 0,
            feed_id: [3; 32],
            required_verification: 1,
            target_grid_seconds: 60,
            min_open_lead_seconds: 30,
            max_target_ahead_seconds: 3_600,
            max_pre_target_gap_seconds: 120,
            // 59, not 120. This fixture carried lag 120 against grid 60 - a spec
            // rcx-timepin-v2 refuses outright - and the R2 mirror above catches
            // it now. It was the fourth place that same broken game was written
            // down; the others were the svm-tests policy fixture and two of its
            // derived deadlines.
            max_post_target_lag_seconds: 59,
            capture_grace_seconds: 60,
            max_future_skew_seconds: 5,
            min_exponent: -12,
            max_exponent: 2,
            max_confidence_bps: 1_000,
            evidence_policy_hash: [0; 32],
            receiver_programdata_slot: 40,
            receiver_config_hash: [4; 32],
            wormhole_program: Pubkey::new_from_array([5; 32]),
            wormhole_programdata_slot: 41,
            registered_slot: 42,
        };
        value.evidence_policy_hash = evidence_policy_hash_from_spec(&value).unwrap();
        value
    }

    fn encode<T: AnchorSerialize>(
        discriminator: &[u8; 8],
        value: &T,
        expected_len: usize,
    ) -> Vec<u8> {
        let mut data = discriminator.to_vec();
        value.serialize(&mut data).unwrap();
        assert_eq!(data.len(), expected_len);
        data
    }

    fn final_accounts(
        program: &Pubkey,
        spec: &EvidenceSpecV2View,
        target_ts: i64,
    ) -> (
        [u8; 32],
        Pubkey,
        TimepinNeedV2View,
        Pubkey,
        CandidateV2AccountView,
    ) {
        let spec_hash = evidence_spec_hash_from_spec(spec).unwrap();
        let schema = TIMEPIN_SCHEMA_V2.to_le_bytes();
        let target = target_ts.to_le_bytes();
        let (need_key, need_bump) = Pubkey::find_program_address(
            &[
                NEED_SEED,
                schema.as_ref(),
                spec_hash.as_ref(),
                target.as_ref(),
            ],
            program,
        );
        let mut candidate = CandidateV2AccountView {
            schema: TIMEPIN_SCHEMA_V2,
            bump: 0,
            need: need_key,
            // Zeroed on purpose: Core never reads rent_payer - who paid for the
            // account is not a fact about the price - but its 32 bytes are what
            // keep every field after it at the offset Timepin writes.
            rent_payer: Pubkey::default(),
            price: 10_000,
            conf: 10,
            exponent: -8,
            publish_time: target_ts,
            prev_publish_time: target_ts - 1,
            ema_price: 9_999,
            ema_conf: 11,
            posted_slot: 43,
            capture_slot: 44,
            capture_ts: target_ts + 1,
        };
        let record = EvidenceRecordV2View {
            message_hash: [0; 32],
            feed_id: spec.feed_id,
            price: candidate.price,
            conf: candidate.conf,
            exponent: candidate.exponent,
            publish_time: candidate.publish_time,
            prev_publish_time: candidate.prev_publish_time,
            ema_price: candidate.ema_price,
            ema_conf: candidate.ema_conf,
            posted_slot: candidate.posted_slot,
            capture_slot: candidate.capture_slot,
            capture_ts: candidate.capture_ts,
        };
        let message_hash = price_message_hash(&record);
        let (candidate_key, candidate_bump) = Pubkey::find_program_address(
            &[CANDIDATE_SEED, need_key.as_ref(), message_hash.as_ref()],
            program,
        );
        candidate.bump = candidate_bump;
        let need = TimepinNeedV2View {
            schema: TIMEPIN_SCHEMA_V2,
            bump: need_bump,
            state: NEED_FINAL,
            evidence_spec_hash: spec_hash,
            target_ts,
            source_deadline_ts: target_ts + 120,
            capture_deadline_ts: target_ts + 180,
            // Zeroes, and they are honest ones: this fixture never exercises
            // close_need, and rent_payer is compared rather than dereferenced.
            // What matters is that the fixture is now 168 bytes like the account
            // Timepin actually writes - a fixture built from Core's own struct is
            // how a 132-byte reader agreed with itself for a day while the other
            // program wrote 276.
            open_refs: 0,
            rent_payer: Pubkey::default(),
            candidate_a_hash: message_hash,
            candidate_b_hash: [0; 32],
        };
        (spec_hash, need_key, need, candidate_key, candidate)
    }

    #[test]
    fn final_compact_accounts_and_result_hash_are_exact() {
        let program = Pubkey::new_from_array([9; 32]);
        let spec = spec();
        let target_ts = 1_800;
        let (spec_hash, need_key, need, candidate_key, candidate) =
            final_accounts(&program, &spec, target_ts);
        let schema = TIMEPIN_SCHEMA_V2.to_le_bytes();
        let (spec_key, _) = Pubkey::find_program_address(
            &[EVIDENCE_SPEC_SEED, schema.as_ref(), spec_hash.as_ref()],
            &program,
        );

        let mut spec_data = encode(
            &EVIDENCE_SPEC_DISCRIMINATOR,
            &spec,
            EVIDENCE_SPEC_ACCOUNT_LEN,
        );
        let mut spec_lamports = 1;
        let spec_info = AccountInfo::new(
            &spec_key,
            false,
            false,
            &mut spec_lamports,
            &mut spec_data,
            &program,
            false,
        );
        let loaded_spec = load_evidence_spec(&spec_info, &program, &spec_hash).unwrap();
        assert_eq!(loaded_spec, spec);

        let mut need_data = encode(&NEED_DISCRIMINATOR, &need, NEED_ACCOUNT_LEN);
        let mut candidate_data =
            encode(&CANDIDATE_DISCRIMINATOR, &candidate, CANDIDATE_ACCOUNT_LEN);
        let mut need_lamports = 1;
        let mut candidate_lamports = 1;
        let need_info = AccountInfo::new(
            &need_key,
            false,
            false,
            &mut need_lamports,
            &mut need_data,
            &program,
            false,
        );
        let candidate_info = AccountInfo::new(
            &candidate_key,
            false,
            false,
            &mut candidate_lamports,
            &mut candidate_data,
            &program,
            false,
        );
        let (terminal, record) = authenticate_final(
            &need_info,
            &candidate_info,
            &program,
            &spec_hash,
            &loaded_spec,
            target_ts,
        )
        .unwrap();
        assert_eq!(terminal.terminal_kind, NEED_FINAL);
        assert_eq!(
            terminal.result_hash,
            terminal_result_hash(&need_key, &need).unwrap()
        );
        assert_eq!(record.message_hash, need.candidate_a_hash);
        assert_eq!(record.feed_id, spec.feed_id);
    }

    /// THE GATE MUST ADMIT EVERY SPEC THE PREDICATE BELOW IT CAN SETTLE.
    ///
    /// validate_spec_shape used to require `adapter == 1` and
    /// `max_pre_target_gap_seconds > 0`, both unconditionally.
    /// validate_record_against_spec has branched on ADAPTER_PYTH_MIN_CAPTURE_V2
    /// since MIN-CAPTURE landed, and
    /// its own comment says the pre-gap "is pinned to zero at registration". So
    /// the file forbade at registration exactly what it promised at settlement,
    /// and the MIN-CAPTURE branch was unreachable: every adapter-2 spec died at
    /// register_ruleset with BadEvidenceSpec, which is the spec the mainnet
    /// manifest carries.
    ///
    /// This test is the pair of that branch. It asserts the gate accepts BOTH
    /// adapters with their OWN pre-gap direction, and refuses each carrying the
    /// other's - mirroring rcx-timepin-v2 lib.rs:573-583, which refuses the same
    /// four combinations. If Core and Timepin ever disagree about which specs are
    /// registrable, one program accepts an economy the other cannot serve.
    #[test]
    fn the_registration_gate_admits_both_adapters_and_crosses_neither() {
        // Adapter 1, strict bracket: the pre-gap is load-bearing and positive.
        let mut push = spec();
        push.adapter = ADAPTER_PYTH_PUSH_V2;
        push.max_pre_target_gap_seconds = 120;
        assert!(validate_spec_shape(&push).is_ok());

        // Adapter 2, MIN-CAPTURE: the pre-gap is pinned to zero. THIS IS THE CASE
        // THAT COULD NOT REGISTER, and it is the one the manifest uses.
        let mut min_capture = spec();
        min_capture.adapter = ADAPTER_PYTH_MIN_CAPTURE_V2;
        min_capture.max_pre_target_gap_seconds = 0;
        assert!(validate_spec_shape(&min_capture).is_ok());

        // Each adapter carrying the other's value is refused, both directions.
        let mut crossed = min_capture;
        crossed.max_pre_target_gap_seconds = 120;
        assert!(validate_spec_shape(&crossed).is_err());

        let mut starved = push;
        starved.max_pre_target_gap_seconds = 0;
        assert!(validate_spec_shape(&starved).is_err());

        // And no third adapter is admitted by widening: the gate names two.
        let mut unknown = spec();
        unknown.adapter = 3;
        unknown.max_pre_target_gap_seconds = 0;
        assert!(validate_spec_shape(&unknown).is_err());
        unknown.max_pre_target_gap_seconds = 120;
        assert!(validate_spec_shape(&unknown).is_err());

        // The two adapters are distinct numbers. If they ever collide the branch
        // in validate_record_against_spec silently becomes unconditional.
        assert_ne!(ADAPTER_PYTH_PUSH_V2, ADAPTER_PYTH_MIN_CAPTURE_V2);
    }

    #[test]
    fn policy_is_generation_independent_while_exact_spec_is_not() {
        let first = spec();
        let mut next_generation = first;
        next_generation.receiver_programdata_slot += 10;
        next_generation.receiver_config_hash[0] ^= 1;
        next_generation.wormhole_programdata_slot += 10;
        next_generation.registered_slot += 20;
        assert_eq!(
            evidence_policy_hash_from_spec(&first).unwrap(),
            evidence_policy_hash_from_spec(&next_generation).unwrap()
        );
        assert_ne!(
            evidence_spec_hash_from_spec(&first).unwrap(),
            evidence_spec_hash_from_spec(&next_generation).unwrap()
        );

        let mut changed_policy = next_generation;
        changed_policy.max_confidence_bps += 1;
        changed_policy.evidence_policy_hash =
            evidence_policy_hash_from_spec(&changed_policy).unwrap();
        assert_ne!(
            evidence_policy_hash_from_spec(&first).unwrap(),
            evidence_policy_hash_from_spec(&changed_policy).unwrap()
        );
    }

    #[test]
    fn wrong_need_spec_candidate_state_and_hash_are_rejected() {
        let program = Pubkey::new_from_array([9; 32]);
        let spec = spec();
        let target_ts = 1_800;
        let (spec_hash, need_key, need, candidate_key, candidate) =
            final_accounts(&program, &spec, target_ts);

        let mut need_data = encode(&NEED_DISCRIMINATOR, &need, NEED_ACCOUNT_LEN);
        let mut need_lamports = 1;
        let wrong_need_key = Pubkey::new_unique();
        let wrong_candidate_key = Pubkey::new_unique();
        let wrong_need_info = AccountInfo::new(
            &wrong_need_key,
            false,
            false,
            &mut need_lamports,
            &mut need_data,
            &program,
            false,
        );
        assert!(load_need(&wrong_need_info, &program, &spec_hash, target_ts).is_err());

        let mut need_data = encode(&NEED_DISCRIMINATOR, &need, NEED_ACCOUNT_LEN);
        let mut candidate_data =
            encode(&CANDIDATE_DISCRIMINATOR, &candidate, CANDIDATE_ACCOUNT_LEN);
        let mut need_lamports = 1;
        let mut candidate_lamports = 1;
        let need_info = AccountInfo::new(
            &need_key,
            false,
            false,
            &mut need_lamports,
            &mut need_data,
            &program,
            false,
        );
        let wrong_candidate_info = AccountInfo::new(
            &wrong_candidate_key,
            false,
            false,
            &mut candidate_lamports,
            &mut candidate_data,
            &program,
            false,
        );
        assert!(authenticate_final(
            &need_info,
            &wrong_candidate_info,
            &program,
            &spec_hash,
            &spec,
            target_ts
        )
        .is_err());
        assert!(load_need(&need_info, &program, &[0x77; 32], target_ts).is_err());

        let mut wrong_state = need;
        wrong_state.state = NEED_CANDIDATE;
        let mut wrong_state_data = encode(&NEED_DISCRIMINATOR, &wrong_state, NEED_ACCOUNT_LEN);
        let mut candidate_data =
            encode(&CANDIDATE_DISCRIMINATOR, &candidate, CANDIDATE_ACCOUNT_LEN);
        let mut wrong_state_lamports = 1;
        let mut candidate_lamports = 1;
        let wrong_state_info = AccountInfo::new(
            &need_key,
            false,
            false,
            &mut wrong_state_lamports,
            &mut wrong_state_data,
            &program,
            false,
        );
        let candidate_info = AccountInfo::new(
            &candidate_key,
            false,
            false,
            &mut candidate_lamports,
            &mut candidate_data,
            &program,
            false,
        );
        assert!(authenticate_final(
            &wrong_state_info,
            &candidate_info,
            &program,
            &spec_hash,
            &spec,
            target_ts
        )
        .is_err());

        let mut tampered_candidate = candidate;
        tampered_candidate.price += 1;
        let mut need_data = encode(&NEED_DISCRIMINATOR, &need, NEED_ACCOUNT_LEN);
        let mut tampered_data = encode(
            &CANDIDATE_DISCRIMINATOR,
            &tampered_candidate,
            CANDIDATE_ACCOUNT_LEN,
        );
        let mut need_lamports = 1;
        let mut candidate_lamports = 1;
        let need_info = AccountInfo::new(
            &need_key,
            false,
            false,
            &mut need_lamports,
            &mut need_data,
            &program,
            false,
        );
        let tampered_info = AccountInfo::new(
            &candidate_key,
            false,
            false,
            &mut candidate_lamports,
            &mut tampered_data,
            &program,
            false,
        );
        assert!(authenticate_final(
            &need_info,
            &tampered_info,
            &program,
            &spec_hash,
            &spec,
            target_ts
        )
        .is_err());
    }
}
