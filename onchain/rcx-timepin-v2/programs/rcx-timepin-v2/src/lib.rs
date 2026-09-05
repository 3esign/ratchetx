//! RCX Timepin v2: immutable-generation Pyth evidence with one permanent Need.
//!
//! The program is permissionless and holds no value, admin, pause, close, or
//! allowlist. It does not claim that the oracle is trust-free: finalized facts
//! still rely on Pyth publishers plus Wormhole guardians and their respective
//! governance. Exact Receiver/config/Wormhole generation pins make any later
//! upgrade fail closed for capture; unanswered Needs can still expire.

use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::{
    config::Config as ReceiverConfig, pda::get_config_address, program::PythSolanaReceiver,
    ID_CONST as PYTH_RECEIVER_ID, PYTH_PUSH_ORACLE_ID,
};
use solana_sha256_hasher::hashv;

mod lifecycle;
pub use lifecycle::*;

declare_id!("C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp");

pub const SCHEMA_VERSION: u16 = 2;
pub const SCHEMA_SEED: [u8; 2] = SCHEMA_VERSION.to_le_bytes();
// Adapter 1: the strict bracket `prev_publish_time < T <= publish_time`.
// EXPERIMENTAL from 2026-09-05 and NOT for a mainnet-class registration. It is
// honest only against a source that delivers every aggregate; the sponsored
// PriceUpdateV2 account is not one. Measured against the real feed it bracketed
// 0 of 25 minute-aligned targets, because the pusher posts on its own schedule
// (~5 s SOL/BTC, ~52 s ETH/BONK/PUMP/JUP/WIF) at a drifting phase.
pub const ADAPTER_PYTH_PUSH_V2: u8 = 1;
// Adapter 2: MIN-CAPTURE. The admissible print for target T is the one with the
// smallest publish_time such that publish_time >= T. See docs/MIN_CAPTURE_SPEC.md.
//
// The two predicates look like a strict and a relaxed form of one rule. They are
// not, and they must never be unified. On a full-aggregate source the strict `<`
// on the left is the only thing excluding intra-second repeats -- messages with
// pub == prev == T that genuinely differ in price, conf and ema (measured: 20 of
// 98 keys carried up to three). Under `publish_time >= T` all of those tie at the
// minimum and the tie-break falls to the submitter. MIN-CAPTURE is safe from this
// ONLY because the sponsored PDA it is pinned to holds one message at a time
// (measured: 235 consecutive sponsored writes, 235 distinct publish times, zero
// duplicates). Change the pin and you change which predicate is safe.
pub const ADAPTER_PYTH_MIN_CAPTURE_V2: u8 = 2;
pub const VERIFICATION_FULL: u8 = 1;
pub const EVIDENCE_SPEC_SEED: &[u8] = b"evidence_spec";
pub const NEED_SEED: &[u8] = b"need";
pub const POLICY_HASH_DOMAIN: &[u8] = b"rcx-timepin:evidence-policy:v2\0";
// The prior prototype hashed only 134 policy bytes. The final ABI adds exact
// generation pins, so its changed preimage has an explicit generation domain.
pub const SPEC_HASH_DOMAIN: &[u8] = b"rcx-timepin:evidence-spec:v2-generation\0";
pub const EVIDENCE_POLICY_CANONICAL_LEN: usize = 134;
pub const EVIDENCE_SPEC_CANONICAL_LEN: usize = 214;

pub const MIN_LEAD_HARD_SECS: u32 = 5;
pub const MAX_GRID_SECS: u32 = 86_400;
pub const MAX_LEAD_SECS: u32 = 86_400;
pub const MAX_TARGET_AHEAD_SECS: u32 = 30 * 86_400;
pub const MAX_GAP_SECS: u32 = 7 * 86_400;
pub const MAX_CAPTURE_GRACE_SECS: u32 = 86_400;
pub const MAX_FUTURE_SKEW_SECS: u16 = 300;
pub const MAX_CONFIDENCE_BPS: u32 = 10_000;
pub const MIN_EXPONENT: i8 = -18;
pub const MAX_EXPONENT: i8 = 18;

pub const NEED_OPEN: u8 = 0;
pub const NEED_CANDIDATE: u8 = 1;
pub const NEED_FINAL: u8 = 2;
pub const NEED_AMBIGUOUS: u8 = 3;
pub const NEED_EXPIRED: u8 = 4;

#[program]
pub mod rcx_timepin_v2 {
    use super::*;

    /// Publish a policy plus exact live Receiver/config/Wormhole generation.
    /// The resulting PDA has no edit or close instruction.
    pub fn register_evidence_spec(
        ctx: Context<RegisterEvidenceSpec>,
        spec_hash: [u8; 32],
        args: EvidenceSpecArgs,
    ) -> Result<()> {
        validate_spec(&args)?;
        let policy_bytes = canonical_policy_bytes(&args)?;
        let policy_hash = evidence_policy_hash(&policy_bytes);
        let canonical = canonical_spec_bytes(&args)?;
        require!(
            spec_hash == evidence_spec_hash(&canonical),
            TimepinV2Error::WrongSpecHash
        );

        let clock = Clock::get()?;
        authenticate_generation_accounts(
            &args,
            &ctx.accounts.receiver_program,
            &ctx.accounts.receiver_program_data,
            &ctx.accounts.receiver_config,
            &ctx.accounts.wormhole_program,
            &ctx.accounts.wormhole_program_data,
            &clock,
        )?;

        let account = &mut ctx.accounts.evidence_spec;
        account.schema = args.schema;
        account.adapter = args.adapter;
        account.receiver_program = args.receiver_program;
        account.push_oracle_program = args.push_oracle_program;
        account.shard_id = args.shard_id;
        account.feed_id = args.feed_id;
        account.required_verification = args.required_verification;
        account.target_grid_seconds = args.target_grid_seconds;
        account.min_open_lead_seconds = args.min_open_lead_seconds;
        account.max_target_ahead_seconds = args.max_target_ahead_seconds;
        account.max_pre_target_gap_seconds = args.max_pre_target_gap_seconds;
        account.max_post_target_lag_seconds = args.max_post_target_lag_seconds;
        account.capture_grace_seconds = args.capture_grace_seconds;
        account.max_future_skew_seconds = args.max_future_skew_seconds;
        account.min_exponent = args.min_exponent;
        account.max_exponent = args.max_exponent;
        account.max_confidence_bps = args.max_confidence_bps;
        account.evidence_policy_hash = policy_hash;
        account.receiver_programdata_slot = args.receiver_programdata_slot;
        account.receiver_config_hash = args.receiver_config_hash;
        account.wormhole_program = args.wormhole_program;
        account.wormhole_programdata_slot = args.wormhole_programdata_slot;
        account.registered_slot = clock.slot;

        emit!(EvidenceSpecRegistered {
            evidence_spec: account.key(),
            spec_hash,
            evidence_policy_hash: policy_hash,
            feed_id: args.feed_id,
            registered_slot: clock.slot,
        });
        Ok(())
    }

    /// Create or authenticate the shared Need for this exact spec and target.
    pub fn open_need(ctx: Context<OpenNeed>, spec_hash: [u8; 32], target_ts: i64) -> Result<()> {
        let spec_info = ctx.accounts.evidence_spec.to_account_info();
        authenticate_spec_account(&ctx.accounts.evidence_spec, &spec_info, &spec_hash)?;

        let need_info = ctx.accounts.need.to_account_info();
        require!(
            need_info.data_len() == 8 + TimepinNeedV2::LEN,
            TimepinV2Error::BadNeedLength
        );
        require!(!need_info.executable, TimepinV2Error::ExecutableNeed);

        let need = &mut ctx.accounts.need;
        if need.schema == SCHEMA_VERSION {
            authenticate_need(
                need,
                &ctx.accounts.evidence_spec,
                &spec_hash,
                target_ts,
                ctx.bumps.need,
            )?;
            emit!(NeedOpened {
                need: need.key(),
                spec_hash,
                target_ts,
                source_deadline_ts: need.source_deadline_ts,
                capture_deadline_ts: need.capture_deadline_ts,
                actor: ctx.accounts.actor.key(),
                created: false,
            });
            return Ok(());
        }

        require!(need.schema == 0, TimepinV2Error::CorruptNeedState);
        let clock = Clock::get()?;
        let (source_deadline_ts, capture_deadline_ts) =
            validate_open(clock.unix_timestamp, target_ts, &ctx.accounts.evidence_spec)?;
        need.schema = SCHEMA_VERSION;
        need.bump = ctx.bumps.need;
        need.state = NEED_OPEN;
        need.evidence_spec_hash = spec_hash;
        need.target_ts = target_ts;
        need.source_deadline_ts = source_deadline_ts;
        need.capture_deadline_ts = capture_deadline_ts;
        need.candidate_a_hash = [0; 32];
        need.candidate_b_hash = [0; 32];
        authenticate_need(
            need,
            &ctx.accounts.evidence_spec,
            &spec_hash,
            target_ts,
            ctx.bumps.need,
        )?;
        emit!(NeedOpened {
            need: need.key(),
            spec_hash,
            target_ts,
            source_deadline_ts,
            capture_deadline_ts,
            actor: ctx.accounts.actor.key(),
            created: true,
        });
        Ok(())
    }

    pub fn open_work_manifest(ctx: Context<OpenWorkManifest>, work_kind: u8) -> Result<()> {
        lifecycle::open_work_manifest_handler(ctx, work_kind)
    }

    pub fn open_work_page(ctx: Context<OpenWorkPage>) -> Result<()> {
        lifecycle::open_work_page_handler(ctx)
    }

    pub fn reserve_work(
        ctx: Context<ReserveWork>,
        work_kind: u8,
        expected_index: u8,
    ) -> Result<()> {
        lifecycle::reserve_work_handler(ctx, work_kind, expected_index)
    }

    pub fn capture_first(
        ctx: Context<CaptureFirst>,
        expected_message_hash: [u8; 32],
    ) -> Result<()> {
        lifecycle::capture_first_handler(ctx, expected_message_hash)
    }

    pub fn capture_conflict(
        ctx: Context<CaptureConflict>,
        expected_message_hash: [u8; 32],
    ) -> Result<()> {
        lifecycle::capture_conflict_handler(ctx, expected_message_hash)
    }

    pub fn finalize(ctx: Context<FinalizeNeed>) -> Result<()> {
        lifecycle::finalize_handler(ctx)
    }

    pub fn expire(ctx: Context<ExpireNeed>) -> Result<()> {
        lifecycle::expire_handler(ctx)
    }
}

#[derive(Accounts)]
#[instruction(spec_hash: [u8; 32], _args: EvidenceSpecArgs)]
pub struct RegisterEvidenceSpec<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + EvidenceSpecV2::LEN,
        seeds = [EVIDENCE_SPEC_SEED, SCHEMA_SEED.as_ref(), spec_hash.as_ref()],
        bump,
    )]
    pub evidence_spec: Box<Account<'info, EvidenceSpecV2>>,
    pub receiver_program: Program<'info, PythSolanaReceiver>,
    pub receiver_program_data: Box<Account<'info, ProgramData>>,
    #[account(address = get_config_address() @ TimepinV2Error::WrongReceiverConfigPda)]
    pub receiver_config: Box<Account<'info, ReceiverConfig>>,
    /// Wormhole is selected only by the exact authenticated Receiver config.
    pub wormhole_program: Program<'info>,
    pub wormhole_program_data: Box<Account<'info, ProgramData>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(spec_hash: [u8; 32], target_ts: i64)]
pub struct OpenNeed<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    #[account(
        seeds = [EVIDENCE_SPEC_SEED, SCHEMA_SEED.as_ref(), spec_hash.as_ref()],
        bump,
    )]
    pub evidence_spec: Box<Account<'info, EvidenceSpecV2>>,
    #[account(
        init_if_needed,
        payer = actor,
        space = 8 + TimepinNeedV2::LEN,
        seeds = [
            NEED_SEED,
            SCHEMA_SEED.as_ref(),
            spec_hash.as_ref(),
            target_ts.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub need: Box<Account<'info, TimepinNeedV2>>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct EvidenceSpecArgs {
    // Generation-independent 134-byte evidence policy, frozen in this order.
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
    // Exact generation pins appended to the full EvidenceSpec hash.
    pub receiver_programdata_slot: u64,
    pub receiver_config_hash: [u8; 32],
    pub wormhole_program: Pubkey,
    pub wormhole_programdata_slot: u64,
}

#[account]
#[derive(Debug, PartialEq, Eq)]
pub struct EvidenceSpecV2 {
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

impl EvidenceSpecV2 {
    pub const LEN: usize = 254;

    pub fn as_args(&self) -> EvidenceSpecArgs {
        EvidenceSpecArgs {
            schema: self.schema,
            adapter: self.adapter,
            receiver_program: self.receiver_program,
            push_oracle_program: self.push_oracle_program,
            shard_id: self.shard_id,
            feed_id: self.feed_id,
            required_verification: self.required_verification,
            target_grid_seconds: self.target_grid_seconds,
            min_open_lead_seconds: self.min_open_lead_seconds,
            max_target_ahead_seconds: self.max_target_ahead_seconds,
            max_pre_target_gap_seconds: self.max_pre_target_gap_seconds,
            max_post_target_lag_seconds: self.max_post_target_lag_seconds,
            capture_grace_seconds: self.capture_grace_seconds,
            max_future_skew_seconds: self.max_future_skew_seconds,
            min_exponent: self.min_exponent,
            max_exponent: self.max_exponent,
            max_confidence_bps: self.max_confidence_bps,
            receiver_programdata_slot: self.receiver_programdata_slot,
            receiver_config_hash: self.receiver_config_hash,
            wormhole_program: self.wormhole_program,
            wormhole_programdata_slot: self.wormhole_programdata_slot,
        }
    }
}

/// The only permanent request and terminal result. Terminal output is derived
/// from `(Need PDA, state, target_ts, candidate hashes)`.
#[account]
#[derive(Debug, PartialEq, Eq)]
pub struct TimepinNeedV2 {
    pub schema: u16,
    pub bump: u8,
    pub state: u8,
    pub evidence_spec_hash: [u8; 32],
    pub target_ts: i64,
    pub source_deadline_ts: i64,
    pub capture_deadline_ts: i64,
    pub candidate_a_hash: [u8; 32],
    pub candidate_b_hash: [u8; 32],
}

impl TimepinNeedV2 {
    pub const LEN: usize = 124;
}

pub fn canonical_policy_bytes(
    args: &EvidenceSpecArgs,
) -> Result<[u8; EVIDENCE_POLICY_CANONICAL_LEN]> {
    let mut bytes = Vec::with_capacity(EVIDENCE_POLICY_CANONICAL_LEN);
    bytes.extend_from_slice(&args.schema.to_le_bytes());
    bytes.push(args.adapter);
    bytes.extend_from_slice(args.receiver_program.as_ref());
    bytes.extend_from_slice(args.push_oracle_program.as_ref());
    bytes.extend_from_slice(&args.shard_id.to_le_bytes());
    bytes.extend_from_slice(&args.feed_id);
    bytes.push(args.required_verification);
    bytes.extend_from_slice(&args.target_grid_seconds.to_le_bytes());
    bytes.extend_from_slice(&args.min_open_lead_seconds.to_le_bytes());
    bytes.extend_from_slice(&args.max_target_ahead_seconds.to_le_bytes());
    bytes.extend_from_slice(&args.max_pre_target_gap_seconds.to_le_bytes());
    bytes.extend_from_slice(&args.max_post_target_lag_seconds.to_le_bytes());
    bytes.extend_from_slice(&args.capture_grace_seconds.to_le_bytes());
    bytes.extend_from_slice(&args.max_future_skew_seconds.to_le_bytes());
    bytes.extend_from_slice(&args.min_exponent.to_le_bytes());
    bytes.extend_from_slice(&args.max_exponent.to_le_bytes());
    bytes.extend_from_slice(&args.max_confidence_bps.to_le_bytes());
    bytes
        .try_into()
        .map_err(|_| error!(TimepinV2Error::BadCanonicalPolicyLength))
}

pub fn canonical_spec_bytes(args: &EvidenceSpecArgs) -> Result<[u8; EVIDENCE_SPEC_CANONICAL_LEN]> {
    let policy = canonical_policy_bytes(args)?;
    let mut bytes = Vec::with_capacity(EVIDENCE_SPEC_CANONICAL_LEN);
    bytes.extend_from_slice(&policy);
    bytes.extend_from_slice(&args.receiver_programdata_slot.to_le_bytes());
    bytes.extend_from_slice(&args.receiver_config_hash);
    bytes.extend_from_slice(args.wormhole_program.as_ref());
    bytes.extend_from_slice(&args.wormhole_programdata_slot.to_le_bytes());
    bytes
        .try_into()
        .map_err(|_| error!(TimepinV2Error::BadCanonicalSpecLength))
}

pub fn evidence_policy_hash(canonical: &[u8; EVIDENCE_POLICY_CANONICAL_LEN]) -> [u8; 32] {
    hashv(&[POLICY_HASH_DOMAIN, canonical.as_ref()]).to_bytes()
}

pub fn evidence_spec_hash(canonical: &[u8; EVIDENCE_SPEC_CANONICAL_LEN]) -> [u8; 32] {
    hashv(&[SPEC_HASH_DOMAIN, canonical.as_ref()]).to_bytes()
}

pub fn validate_spec(args: &EvidenceSpecArgs) -> Result<()> {
    require!(args.schema == SCHEMA_VERSION, TimepinV2Error::WrongSchema);
    require!(
        args.adapter == ADAPTER_PYTH_PUSH_V2 || args.adapter == ADAPTER_PYTH_MIN_CAPTURE_V2,
        TimepinV2Error::WrongAdapter
    );
    require_keys_eq!(
        args.receiver_program,
        PYTH_RECEIVER_ID,
        TimepinV2Error::UnofficialReceiverProgram
    );
    require_keys_eq!(
        args.push_oracle_program,
        PYTH_PUSH_ORACLE_ID,
        TimepinV2Error::UnofficialPushOracleProgram
    );
    require!(
        args.required_verification == VERIFICATION_FULL,
        TimepinV2Error::PartialVerificationPolicy
    );
    require!(
        args.target_grid_seconds > 0 && args.target_grid_seconds <= MAX_GRID_SECS,
        TimepinV2Error::BadTargetGrid
    );
    require!(
        args.min_open_lead_seconds >= MIN_LEAD_HARD_SECS
            && args.min_open_lead_seconds <= MAX_LEAD_SECS,
        TimepinV2Error::BadOpenLead
    );
    require!(
        args.max_target_ahead_seconds >= args.min_open_lead_seconds
            && args.max_target_ahead_seconds <= MAX_TARGET_AHEAD_SECS,
        TimepinV2Error::BadTargetAhead
    );
    // The two adapters pin this same field in OPPOSITE directions, so each is
    // refused carrying the other's value. Under MIN-CAPTURE prev_publish_time is
    // not part of the predicate, so a non-zero bound would be a dead number living
    // inside canonical_policy_bytes and therefore inside every spec hash, where it
    // would mislead every later reader. The field cannot be dropped for the same
    // reason -- it is hashed -- so it is pinned to zero instead.
    if args.adapter == ADAPTER_PYTH_MIN_CAPTURE_V2 {
        require!(
            args.max_pre_target_gap_seconds == 0,
            TimepinV2Error::BadPreTargetGap
        );
    } else {
        require!(
            args.max_pre_target_gap_seconds > 0 && args.max_pre_target_gap_seconds <= MAX_GAP_SECS,
            TimepinV2Error::BadPreTargetGap
        );
    }
    require!(
        args.max_post_target_lag_seconds > 0 && args.max_post_target_lag_seconds <= MAX_GAP_SECS,
        TimepinV2Error::BadPostTargetLag
    );
    require!(
        args.capture_grace_seconds > 0 && args.capture_grace_seconds <= MAX_CAPTURE_GRACE_SECS,
        TimepinV2Error::BadCaptureGrace
    );
    require!(
        args.max_future_skew_seconds <= MAX_FUTURE_SKEW_SECS,
        TimepinV2Error::BadFutureSkew
    );
    require!(
        args.min_exponent >= MIN_EXPONENT
            && args.max_exponent <= MAX_EXPONENT
            && args.min_exponent <= args.max_exponent,
        TimepinV2Error::BadExponentRange
    );
    require!(
        args.max_confidence_bps <= MAX_CONFIDENCE_BPS,
        TimepinV2Error::BadConfidenceBound
    );
    require!(
        args.receiver_programdata_slot > 0
            && args.wormhole_programdata_slot > 0
            && args.receiver_config_hash != [0; 32]
            && args.wormhole_program != Pubkey::default(),
        TimepinV2Error::BadGenerationPins
    );
    Ok(())
}

pub(crate) fn authenticate_spec_account(
    spec: &EvidenceSpecV2,
    info: &AccountInfo,
    expected_hash: &[u8; 32],
) -> Result<()> {
    require!(!info.executable, TimepinV2Error::ExecutableEvidenceSpec);
    require!(
        info.data_len() == 8 + EvidenceSpecV2::LEN,
        TimepinV2Error::BadEvidenceSpecLength
    );
    let args = spec.as_args();
    validate_spec(&args)?;
    let policy = canonical_policy_bytes(&args)?;
    require!(
        evidence_policy_hash(&policy) == spec.evidence_policy_hash,
        TimepinV2Error::WrongPolicyHash
    );
    let canonical = canonical_spec_bytes(&args)?;
    require!(
        evidence_spec_hash(&canonical) == *expected_hash,
        TimepinV2Error::WrongSpecHash
    );
    require!(
        spec.registered_slot > spec.receiver_programdata_slot
            && spec.registered_slot > spec.wormhole_programdata_slot,
        TimepinV2Error::BadRegisteredSlot
    );
    Ok(())
}

pub(crate) fn authenticate_generation_accounts(
    args: &EvidenceSpecArgs,
    receiver_program: &Program<'_, PythSolanaReceiver>,
    receiver_program_data: &Account<'_, ProgramData>,
    receiver_config: &Account<'_, ReceiverConfig>,
    wormhole_program: &Program<'_>,
    wormhole_program_data: &Account<'_, ProgramData>,
    clock: &Clock,
) -> Result<()> {
    require_keys_eq!(
        receiver_program.key(),
        args.receiver_program,
        TimepinV2Error::UnofficialReceiverProgram
    );
    require!(
        receiver_program.programdata_address()? == Some(receiver_program_data.key()),
        TimepinV2Error::WrongReceiverProgramData
    );
    require!(
        !receiver_program_data.to_account_info().executable,
        TimepinV2Error::WrongReceiverProgramData
    );
    require!(
        receiver_program_data.slot == args.receiver_programdata_slot,
        TimepinV2Error::ReceiverGenerationMismatch
    );
    require_keys_eq!(
        receiver_config.key(),
        get_config_address(),
        TimepinV2Error::WrongReceiverConfigPda
    );
    let config_info = receiver_config.to_account_info();
    require!(
        !config_info.executable && config_info.data_len() == ReceiverConfig::LEN,
        TimepinV2Error::BadReceiverConfig
    );
    let config_data = config_info
        .try_borrow_data()
        .map_err(|_| error!(TimepinV2Error::BadReceiverConfig))?;
    let config_hash = hashv(&[config_data.as_ref()]).to_bytes();
    require!(
        config_hash == args.receiver_config_hash,
        TimepinV2Error::ReceiverConfigMismatch
    );
    require_keys_eq!(
        wormhole_program.key(),
        args.wormhole_program,
        TimepinV2Error::WrongWormholeProgram
    );
    require_keys_eq!(
        receiver_config.wormhole,
        args.wormhole_program,
        TimepinV2Error::WrongConfiguredWormhole
    );
    require!(
        wormhole_program.programdata_address()? == Some(wormhole_program_data.key()),
        TimepinV2Error::WrongWormholeProgramData
    );
    require!(
        !wormhole_program_data.to_account_info().executable,
        TimepinV2Error::WrongWormholeProgramData
    );
    require!(
        wormhole_program_data.slot == args.wormhole_programdata_slot,
        TimepinV2Error::WormholeGenerationMismatch
    );
    require!(
        clock.slot > args.receiver_programdata_slot && clock.slot > args.wormhole_programdata_slot,
        TimepinV2Error::GenerationNotObservableYet
    );
    Ok(())
}

pub fn derive_deadlines(spec: &EvidenceSpecV2, target_ts: i64) -> Result<(i64, i64)> {
    let source_deadline_ts = target_ts
        .checked_add(i64::from(spec.max_post_target_lag_seconds))
        .ok_or(TimepinV2Error::TimestampOverflow)?;
    let capture_deadline_ts = source_deadline_ts
        .checked_add(i64::from(spec.capture_grace_seconds))
        .ok_or(TimepinV2Error::TimestampOverflow)?;
    Ok((source_deadline_ts, capture_deadline_ts))
}

pub fn validate_open(now: i64, target_ts: i64, spec: &EvidenceSpecV2) -> Result<(i64, i64)> {
    let lead = target_ts
        .checked_sub(now)
        .ok_or(TimepinV2Error::TimestampOverflow)?;
    require!(
        lead >= i64::from(spec.min_open_lead_seconds),
        TimepinV2Error::OpenTooLate
    );
    require!(
        lead <= i64::from(spec.max_target_ahead_seconds),
        TimepinV2Error::TargetTooFar
    );
    require!(
        target_ts.rem_euclid(i64::from(spec.target_grid_seconds)) == 0,
        TimepinV2Error::TargetMisaligned
    );
    derive_deadlines(spec, target_ts)
}

pub fn authenticate_need(
    need: &TimepinNeedV2,
    spec: &EvidenceSpecV2,
    expected_hash: &[u8; 32],
    expected_target: i64,
    expected_bump: u8,
) -> Result<()> {
    require!(
        need.schema == SCHEMA_VERSION,
        TimepinV2Error::WrongNeedSchema
    );
    require!(need.bump == expected_bump, TimepinV2Error::WrongNeedBump);
    require!(
        need.evidence_spec_hash == *expected_hash,
        TimepinV2Error::WrongNeedSpec
    );
    require!(
        need.target_ts == expected_target,
        TimepinV2Error::WrongNeedTarget
    );
    require!(
        need.target_ts
            .rem_euclid(i64::from(spec.target_grid_seconds))
            == 0,
        TimepinV2Error::TargetMisaligned
    );
    let (source, capture) = derive_deadlines(spec, need.target_ts)?;
    require!(
        need.source_deadline_ts == source,
        TimepinV2Error::CorruptSourceDeadline
    );
    require!(
        need.capture_deadline_ts == capture,
        TimepinV2Error::CorruptCaptureDeadline
    );
    validate_need_shape(need)
}

pub fn validate_need_shape(need: &TimepinNeedV2) -> Result<()> {
    let zero = [0u8; 32];
    match need.state {
        NEED_OPEN | NEED_EXPIRED => require!(
            need.candidate_a_hash == zero && need.candidate_b_hash == zero,
            TimepinV2Error::CorruptCandidateState
        ),
        NEED_CANDIDATE | NEED_FINAL => require!(
            need.candidate_a_hash != zero && need.candidate_b_hash == zero,
            TimepinV2Error::CorruptCandidateState
        ),
        NEED_AMBIGUOUS => require!(
            need.candidate_a_hash != zero
                && need.candidate_b_hash != zero
                && need.candidate_a_hash < need.candidate_b_hash,
            TimepinV2Error::CorruptCandidateState
        ),
        _ => return err!(TimepinV2Error::CorruptNeedState),
    }
    Ok(())
}

#[event]
pub struct EvidenceSpecRegistered {
    pub evidence_spec: Pubkey,
    pub spec_hash: [u8; 32],
    pub evidence_policy_hash: [u8; 32],
    pub feed_id: [u8; 32],
    pub registered_slot: u64,
}

#[event]
pub struct NeedOpened {
    pub need: Pubkey,
    pub spec_hash: [u8; 32],
    pub target_ts: i64,
    pub source_deadline_ts: i64,
    pub capture_deadline_ts: i64,
    pub actor: Pubkey,
    pub created: bool,
}

#[error_code]
pub enum TimepinV2Error {
    #[msg("EvidenceSpec schema is not v2")]
    WrongSchema,
    #[msg("unknown evidence adapter")]
    WrongAdapter,
    #[msg("adapter 1 requires the official upgraded Pyth Receiver program")]
    UnofficialReceiverProgram,
    #[msg("adapter 1 requires the official upgraded Pyth Push Oracle program")]
    UnofficialPushOracleProgram,
    #[msg("adapter 1 requires Full verification")]
    PartialVerificationPolicy,
    #[msg("target grid is outside hard bounds")]
    BadTargetGrid,
    #[msg("opening lead is outside hard bounds")]
    BadOpenLead,
    #[msg("target-ahead bound is invalid")]
    BadTargetAhead,
    #[msg("pre-target source gap bound is invalid")]
    BadPreTargetGap,
    #[msg("post-target source lag bound is invalid")]
    BadPostTargetLag,
    #[msg("capture grace is outside hard bounds")]
    BadCaptureGrace,
    #[msg("future source-clock skew is outside hard bounds")]
    BadFutureSkew,
    #[msg("exponent range is invalid")]
    BadExponentRange,
    #[msg("confidence bound is invalid")]
    BadConfidenceBound,
    #[msg("generation pins are empty or invalid")]
    BadGenerationPins,
    #[msg("canonical evidence-policy length is wrong")]
    BadCanonicalPolicyLength,
    #[msg("canonical EvidenceSpec length is wrong")]
    BadCanonicalSpecLength,
    #[msg("evidence-policy hash is wrong")]
    WrongPolicyHash,
    #[msg("EvidenceSpec hash does not match canonical bytes")]
    WrongSpecHash,
    #[msg("EvidenceSpec account must not be executable")]
    ExecutableEvidenceSpec,
    #[msg("EvidenceSpec account length is wrong")]
    BadEvidenceSpecLength,
    #[msg("Receiver Program does not link to the supplied ProgramData")]
    WrongReceiverProgramData,
    #[msg("Receiver ProgramData slot differs from the pinned generation")]
    ReceiverGenerationMismatch,
    #[msg("Receiver config PDA is wrong")]
    WrongReceiverConfigPda,
    #[msg("Receiver config layout is wrong")]
    BadReceiverConfig,
    #[msg("full Receiver config account hash differs from the pin")]
    ReceiverConfigMismatch,
    #[msg("Wormhole program differs from the Receiver config pin")]
    WrongWormholeProgram,
    #[msg("Receiver config names a different Wormhole program")]
    WrongConfiguredWormhole,
    #[msg("Wormhole Program does not link to the supplied ProgramData")]
    WrongWormholeProgramData,
    #[msg("Wormhole ProgramData slot differs from the pinned generation")]
    WormholeGenerationMismatch,
    #[msg("the generation was not observed in a later Clock slot")]
    GenerationNotObservableYet,
    #[msg("registered slot is inconsistent with pinned generations")]
    BadRegisteredSlot,
    #[msg("Need account length is wrong")]
    BadNeedLength,
    #[msg("Need account must not be executable")]
    ExecutableNeed,
    #[msg("target timestamp arithmetic overflow")]
    TimestampOverflow,
    #[msg("Need is opened after its minimum lead")]
    OpenTooLate,
    #[msg("Need target is too far ahead")]
    TargetTooFar,
    #[msg("Need target is not aligned to its policy grid")]
    TargetMisaligned,
    #[msg("Need schema is wrong")]
    WrongNeedSchema,
    #[msg("Need bump is wrong")]
    WrongNeedBump,
    #[msg("Need EvidenceSpec hash is wrong")]
    WrongNeedSpec,
    #[msg("Need target is wrong")]
    WrongNeedTarget,
    #[msg("Need source deadline is corrupt")]
    CorruptSourceDeadline,
    #[msg("Need capture deadline is corrupt")]
    CorruptCaptureDeadline,
    #[msg("Need state byte is invalid")]
    CorruptNeedState,
    #[msg("Need state and candidate hashes disagree")]
    CorruptCandidateState,
}

#[cfg(test)]
mod tests {
    use super::*;

    const TARGET: i64 = 1_800;

    fn args() -> EvidenceSpecArgs {
        EvidenceSpecArgs {
            schema: SCHEMA_VERSION,
            adapter: ADAPTER_PYTH_PUSH_V2,
            receiver_program: PYTH_RECEIVER_ID,
            push_oracle_program: PYTH_PUSH_ORACLE_ID,
            shard_id: 0,
            feed_id: [3; 32],
            required_verification: VERIFICATION_FULL,
            target_grid_seconds: 600,
            min_open_lead_seconds: 30,
            max_target_ahead_seconds: 604_800,
            max_pre_target_gap_seconds: 900,
            max_post_target_lag_seconds: 900,
            capture_grace_seconds: 120,
            max_future_skew_seconds: 5,
            min_exponent: -12,
            max_exponent: 2,
            max_confidence_bps: 1_000,
            receiver_programdata_slot: 42,
            receiver_config_hash: [9; 32],
            wormhole_program: Pubkey::new_from_array([8; 32]),
            wormhole_programdata_slot: 41,
        }
    }

    fn spec() -> EvidenceSpecV2 {
        let a = args();
        let policy = canonical_policy_bytes(&a).unwrap();
        EvidenceSpecV2 {
            schema: a.schema,
            adapter: a.adapter,
            receiver_program: a.receiver_program,
            push_oracle_program: a.push_oracle_program,
            shard_id: a.shard_id,
            feed_id: a.feed_id,
            required_verification: a.required_verification,
            target_grid_seconds: a.target_grid_seconds,
            min_open_lead_seconds: a.min_open_lead_seconds,
            max_target_ahead_seconds: a.max_target_ahead_seconds,
            max_pre_target_gap_seconds: a.max_pre_target_gap_seconds,
            max_post_target_lag_seconds: a.max_post_target_lag_seconds,
            capture_grace_seconds: a.capture_grace_seconds,
            max_future_skew_seconds: a.max_future_skew_seconds,
            min_exponent: a.min_exponent,
            max_exponent: a.max_exponent,
            max_confidence_bps: a.max_confidence_bps,
            evidence_policy_hash: evidence_policy_hash(&policy),
            receiver_programdata_slot: a.receiver_programdata_slot,
            receiver_config_hash: a.receiver_config_hash,
            wormhole_program: a.wormhole_program,
            wormhole_programdata_slot: a.wormhole_programdata_slot,
            registered_slot: 43,
        }
    }

    fn need(hash: [u8; 32], bump: u8) -> TimepinNeedV2 {
        TimepinNeedV2 {
            schema: SCHEMA_VERSION,
            bump,
            state: NEED_OPEN,
            evidence_spec_hash: hash,
            target_ts: TARGET,
            source_deadline_ts: 2_700,
            capture_deadline_ts: 2_820,
            candidate_a_hash: [0; 32],
            candidate_b_hash: [0; 32],
        }
    }

    #[test]
    fn policy_and_generation_hashes_are_independent_and_complete() {
        let base = args();
        let policy = canonical_policy_bytes(&base).unwrap();
        let full = canonical_spec_bytes(&base).unwrap();
        assert_eq!(policy.len(), 134);
        assert_eq!(full.len(), 214);
        let policy_hash = evidence_policy_hash(&policy);
        let spec_hash = evidence_spec_hash(&full);

        let mut generation = base;
        generation.receiver_programdata_slot += 1;
        assert_eq!(
            evidence_policy_hash(&canonical_policy_bytes(&generation).unwrap()),
            policy_hash
        );
        assert_ne!(
            evidence_spec_hash(&canonical_spec_bytes(&generation).unwrap()),
            spec_hash
        );
        generation = base;
        generation.receiver_config_hash[0] ^= 1;
        assert_eq!(
            evidence_policy_hash(&canonical_policy_bytes(&generation).unwrap()),
            policy_hash
        );
        assert_ne!(
            evidence_spec_hash(&canonical_spec_bytes(&generation).unwrap()),
            spec_hash
        );
        generation = base;
        generation.wormhole_programdata_slot += 1;
        assert_ne!(
            evidence_spec_hash(&canonical_spec_bytes(&generation).unwrap()),
            spec_hash
        );

        let mut policy_tamper = base;
        policy_tamper.max_post_target_lag_seconds += 1;
        assert_ne!(
            evidence_policy_hash(&canonical_policy_bytes(&policy_tamper).unwrap()),
            policy_hash
        );
    }

    #[test]
    fn every_profile_and_source_quality_byte_is_in_the_134_byte_policy() {
        let base = args();
        let original = canonical_policy_bytes(&base).unwrap();
        let mut changes = Vec::new();
        let mut a = base;
        a.receiver_program = Pubkey::new_unique();
        changes.push(a);
        a = base;
        a.push_oracle_program = Pubkey::new_unique();
        changes.push(a);
        a = base;
        a.shard_id += 1;
        changes.push(a);
        a = base;
        a.feed_id[0] ^= 1;
        changes.push(a);
        a = base;
        a.required_verification = 0;
        changes.push(a);
        a = base;
        a.target_grid_seconds += 1;
        changes.push(a);
        a = base;
        a.min_open_lead_seconds += 1;
        changes.push(a);
        a = base;
        a.max_target_ahead_seconds += 1;
        changes.push(a);
        a = base;
        a.max_pre_target_gap_seconds += 1;
        changes.push(a);
        a = base;
        a.max_post_target_lag_seconds += 1;
        changes.push(a);
        a = base;
        a.capture_grace_seconds += 1;
        changes.push(a);
        a = base;
        a.max_future_skew_seconds += 1;
        changes.push(a);
        a = base;
        a.min_exponent += 1;
        changes.push(a);
        a = base;
        a.max_exponent += 1;
        changes.push(a);
        a = base;
        a.max_confidence_bps += 1;
        changes.push(a);
        for changed in changes {
            assert_ne!(canonical_policy_bytes(&changed).unwrap(), original);
        }
    }

    #[test]
    fn exact_compact_account_lengths_are_frozen() {
        let s = spec();
        let canonical = canonical_spec_bytes(&s.as_args()).unwrap();
        let hash = evidence_spec_hash(&canonical);
        let mut spec_bytes = Vec::new();
        s.try_serialize(&mut spec_bytes).unwrap();
        assert_eq!(EvidenceSpecV2::LEN, 254);
        assert_eq!(spec_bytes.len(), 262);
        let mut need_bytes = Vec::new();
        need(hash, 255).try_serialize(&mut need_bytes).unwrap();
        assert_eq!(TimepinNeedV2::LEN, 124);
        assert_eq!(need_bytes.len(), 132);
        assert_eq!(ReceiverConfig::LEN, 370);
    }

    #[test]
    fn official_policy_and_generation_bounds_fail_closed() {
        assert!(validate_spec(&args()).is_ok());
        let mut changed = args();
        changed.receiver_program = Pubkey::new_unique();
        assert!(validate_spec(&changed).is_err());
        changed = args();
        changed.push_oracle_program = Pubkey::new_unique();
        assert!(validate_spec(&changed).is_err());
        changed = args();
        changed.target_grid_seconds = 0;
        assert!(validate_spec(&changed).is_err());
        changed = args();
        changed.min_open_lead_seconds = 4;
        assert!(validate_spec(&changed).is_err());
        changed = args();
        changed.min_exponent = 3;
        changed.max_exponent = 2;
        assert!(validate_spec(&changed).is_err());
        changed = args();
        changed.receiver_programdata_slot = 0;
        assert!(validate_spec(&changed).is_err());
        changed = args();
        changed.receiver_config_hash = [0; 32];
        assert!(validate_spec(&changed).is_err());
    }

    #[test]
    fn opening_deadlines_and_compact_state_shapes_are_checked() {
        let s = spec();
        assert_eq!(validate_open(1_000, TARGET, &s).unwrap(), (2_700, 2_820));
        assert!(validate_open(1_771, TARGET, &s).is_err());
        assert!(validate_open(1_000, TARGET + 1, &s).is_err());
        assert!(derive_deadlines(&s, i64::MAX).is_err());

        let hash = evidence_spec_hash(&canonical_spec_bytes(&s.as_args()).unwrap());
        let mut n = need(hash, 255);
        assert!(authenticate_need(&n, &s, &hash, TARGET, 255).is_ok());
        n.capture_deadline_ts = 999_999;
        assert!(authenticate_need(&n, &s, &hash, TARGET, 255).is_err());
        n = need(hash, 255);
        n.state = NEED_CANDIDATE;
        n.candidate_a_hash = [7; 32];
        assert!(validate_need_shape(&n).is_ok());
        n.state = NEED_FINAL;
        assert!(validate_need_shape(&n).is_ok());
        n.state = NEED_AMBIGUOUS;
        n.candidate_b_hash = [8; 32];
        assert!(validate_need_shape(&n).is_ok());
        n.candidate_a_hash = [9; 32];
        assert!(validate_need_shape(&n).is_err());
        n = need(hash, 255);
        n.state = NEED_EXPIRED;
        assert!(validate_need_shape(&n).is_ok());
    }

    #[test]
    fn public_program_and_official_upgraded_ids_are_pinned() {
        assert_eq!(
            crate::ID.to_string(),
            "C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp"
        );
        assert_eq!(
            PYTH_RECEIVER_ID.to_string(),
            "rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp"
        );
        assert_eq!(
            PYTH_PUSH_ORACLE_ID.to_string(),
            "pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou"
        );
    }
}
