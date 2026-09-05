use anchor_lang::prelude::*;
use anchor_spl::token_2022;
use solana_sha256_hasher::hashv;

pub const CORE_SCHEMA_VERSION: u16 = 2;
pub const CORE_SCHEMA_SEED: [u8; 2] = CORE_SCHEMA_VERSION.to_le_bytes();
pub const TIMEPIN_SCHEMA_VERSION: u16 = 2;
pub const COMPLETION_SCHEMA_VERSION: u16 = 1;

pub const ECONOMY_SEED: &[u8] = b"economy";
pub const RULESET_SEED: &[u8] = b"ruleset";
pub const LEDGER_SEED: &[u8] = b"ledger";
pub const SHOT_SEED: &[u8] = b"shot";
pub const PLAYER_DAY_SEED: &[u8] = b"player_day";
pub const RANK_SHARD_SEED: &[u8] = b"rank_shard";
pub const DAY_FINAL_SEED: &[u8] = b"day_final";
pub const RELOAD_HISTORY_PAGE_SEED: &[u8] = b"reload_history_page";
pub const HISTORY_PAGE_SEED: &[u8] = b"history_page";
pub const WORK_PAGE_SEED: &[u8] = b"work_page";
pub const DELEGATE_GRANT_SEED: &[u8] = b"delegate_grant";

pub const ECONOMY_HASH_DOMAIN: &[u8] = b"rcx-core:economy:g2\0";
pub const RULESET_HASH_DOMAIN: &[u8] = b"rcx-core:ruleset:g2\0";
pub const RULESET_POLICY_LEAF_DOMAIN: &[u8] = b"rcx-core:ruleset-policy:g2\0";
pub const RULESET_POLICY_NODE_DOMAIN: &[u8] = b"rcx-core:ruleset-node:g2\0";
pub const COMMITMENT_DOMAIN: &[u8] = b"rcx-core:commitment:g2\0";
// HistoryPage keeps a rolling commitment over its terminal rows instead of the
// rows themselves. Two domains: one for a row, one for the fold, so a row hash
// can never be replayed as a chain hash.
pub const HISTORY_ROW_DOMAIN: &[u8] = b"rcx-core:history-row:g2\0";
pub const HISTORY_CHAIN_DOMAIN: &[u8] = b"rcx-core:history-chain:g2\0";
pub const LEGACY_LEAF_DOMAIN: &[u8] = b"rcx-core:legacy-leaf:g2\0";
pub const LEGACY_NODE_DOMAIN: &[u8] = b"rcx-core:legacy-node:g2\0";
pub const RESULT_HASH_DOMAIN: &[u8] = b"rcx-core:result:g2\0";
pub const TERMINAL_HASH_DOMAIN: &[u8] = b"rcx-core:terminal:g2\0";
pub const GAME_RESULT_HASH_DOMAIN: &[u8] = b"rcx-core:game-result:g2\0";
pub const RANK_SHARD_FOR_DOMAIN: &[u8] = b"rcx-core:rank-shard-for:g2\0";
pub const RANK_SHARD_HASH_DOMAIN: &[u8] = b"rcx-core:rank-shard:g2\0";
pub const RANK_SHARDS_HASH_DOMAIN: &[u8] = b"rcx-core:rank-shards:g2\0";
pub const DAY_FINAL_HASH_DOMAIN: &[u8] = b"rcx-core:day-final:g2\0";
pub const COMPLETION_RESULT_HASH_DOMAIN: &[u8] = b"rcx-core:completion-result:g2\0";
pub const RELOAD_MEMO_DOMAIN: &[u8] = b"rcx-core:reload-route:g2\0";

pub const ENTRY_OBSERVED: u8 = 1;
pub const ENTRY_FORWARD: u8 = 2;
pub const WORK_KIND_ACTIVATE_ENTRY: u8 = 3;
pub const WORK_KIND_RESOLVE_SHOT: u8 = 4;
pub const WORK_KIND_FORFEIT: u8 = 5;
pub const RECEIPT_PENDING: u8 = 0;
pub const RECEIPT_PAYABLE: u8 = 1;
pub const RECEIPT_NONPAYABLE: u8 = 2;
pub const MAX_MERKLE_PROOF: usize = 32;
pub const MAX_GRID_SECONDS: u32 = 86_400;
pub const MIN_OPEN_LEAD_SECONDS: u32 = 30;
pub const MAX_REVEAL_WINDOW_SECONDS: u32 = 86_400;
pub const MAX_OPEN_POSITIONS: u16 = 64;
pub const MAX_BAND_NUMERATOR: u32 = 1_000_000;
pub const MAX_BASE_XP: u64 = 1_000_000;
pub const MAX_SETTLE_XP: u64 = 1_000_000;
pub const CORE_MIN_EXPONENT: i8 = -12;
pub const CORE_MAX_EXPONENT: i8 = 2;
pub const BRIER_SCALE: u128 = 100_000_000;
pub const XP_CAP_STAKE: u64 = 40_000;
pub const XP_MULT_CAP: u64 = 20;
pub const STREAK_STEP_C: u64 = 15;
pub const STREAK_CAP_C: u64 = 200;
pub const DAY_SECONDS: u32 = 86_400;
pub const RANK_SHARD_COUNT: u8 = 16;
pub const RANK_SHARD_COUNT_USIZE: usize = RANK_SHARD_COUNT as usize;
pub const PER_MILLE: u16 = 1_000;
pub const BURN_PER_MILLE: u16 = 700;
pub const PODIUM_PER_MILLE: u16 = 300;
pub const PODIUM_SEAT_COUNT: usize = 3;
pub const PODIUM_CURVE: [u16; PODIUM_SEAT_COUNT] = [500, 300, 200];
pub const RELOAD_ACTION_NONE: u8 = 0;
pub const RELOAD_ACTION_BURN: u8 = 1;
pub const RELOAD_ACTION_ROUTE: u8 = 2;
pub const RELOAD_ACTION_RETAIN: u8 = 3;
pub const HISTORY_PAGE_CAP: usize = 16;
pub const RELOAD_HISTORY_PAGE_CAP: usize = 32;
pub const WORK_KINDS_PER_SHOT: usize = 3;
pub const WORK_PAGE_CAP: usize = HISTORY_PAGE_CAP * WORK_KINDS_PER_SHOT;
pub const WORK_PAGE_MODE: u8 = 2;
pub const WORK_PAGE_VEC_LENGTH_OFFSET: usize = 83;
pub const WORK_PAGE_RECORDS_OFFSET: usize = 87;
pub const MAX_DELEGATE_LIFETIME_SECONDS: i64 = 30 * 86_400;
pub const MIN_CLEANUP_BOND_LAMPORTS: u64 = 5_000;
pub const MAX_CLEANUP_BOND_LAMPORTS: u64 = 1_000_000;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct EconomyArgs {
    pub schema: u16,
    pub timepin_program: Pubkey,
    pub timepin_schema: u16,
    pub cluster_genesis_hash: [u8; 32],
    pub migration_id: [u8; 32],
    pub legacy_root: [u8; 32],
    pub legacy_snapshot_hash: [u8; 32],
    pub legacy_cutover_slot: u64,
    pub legacy_leaf_count: u32,
    pub legacy_total_credits: u64,
    pub legacy_total_xp: u64,
    pub ruleset_policy_root: [u8; 32],
    pub ruleset_policy_count: u16,
    pub rcx_mint: Pubkey,
    pub rcx_token_program: Pubkey,
    pub rcx_decimals: u8,
    pub raw_units_per_credit: u64,
    pub burn_per_mille: u16,
    pub podium_per_mille: u16,
    pub podium_curve: [u16; PODIUM_SEAT_COUNT],
    pub rank_shard_count: u8,
    pub day_seconds: u32,
    pub hit_payout_num: u64,
    pub hit_payout_den: u64,
    pub settle_xp: u64,
    pub min_stake: u64,
    pub max_stake: u64,
    pub max_open: u16,
    pub cleanup_bond_lamports: u64,
    pub reveal_window_seconds: u32,
    pub max_horizon_seconds: u32,
}

impl EconomyArgs {
    pub const LEN: usize = 372;
}

#[account]
#[derive(Debug, PartialEq, Eq)]
pub struct Economy {
    pub schema: u16,
    pub bump: u8,
    pub economy_hash: [u8; 32],
    pub args: EconomyArgs,
}

impl Economy {
    pub const LEN: usize = 2 + 1 + 32 + EconomyArgs::LEN;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct RulesetArgs {
    pub schema: u16,
    pub economy_hash: [u8; 32],
    pub evidence_spec_hash: [u8; 32],
    pub evidence_policy_hash: [u8; 32],
    pub feed_id: [u8; 32],
    pub entry_mode: u8,
    pub horizon_seconds: u32,
    pub target_grid_seconds: u32,
    pub min_open_lead_seconds: u32,
    pub max_entry_age_seconds: u32,
    pub band_numerator: u32,
    pub band_denominator: u32,
    pub base_xp: u64,
}

impl RulesetArgs {
    pub const LEN: usize = 163;
}

#[account]
#[derive(Debug, PartialEq, Eq)]
pub struct Ruleset {
    pub schema: u16,
    pub bump: u8,
    pub ruleset_hash: [u8; 32],
    pub args: RulesetArgs,
}

impl Ruleset {
    pub const LEN: usize = 2 + 1 + 32 + RulesetArgs::LEN;
}

#[account]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct PlayerLedger {
    pub schema: u16,
    pub bump: u8,
    pub economy_hash: [u8; 32],
    pub player: Pubkey,
    pub credits: u64,
    pub locked_credits: u64,
    pub xp: u64,
    pub legacy_credits: u64,
    pub reload_credits: u64,
    pub payout_credits: u64,
    pub reserved_payout_credits: u64,
    pub retired_credits: u64,
    pub refunded_credits: u64,
    pub legacy_xp: u64,
    pub earned_xp: u64,
    pub reserved_xp: u64,
    pub streak: u32,
    pub best: u32,
    pub hits: u64,
    pub shots: u64,
    pub voids: u64,
    pub forfeits: u64,
    pub sealed: u64,
    pub open: u16,
    pub brier_sum: u128,
    pub next_shot_nonce: u64,
    pub next_reload_nonce: u64,
    pub rcx_burned: u64,
    pub rcx_routed: u64,
    pub rcx_reloaded: u64,
    pub rcx_retained: u64,
}

impl PlayerLedger {
    pub const LEN: usize = 277;

    pub fn initialize(&mut self, bump: u8, economy_hash: [u8; 32], player: Pubkey) {
        self.schema = CORE_SCHEMA_VERSION;
        self.bump = bump;
        self.economy_hash = economy_hash;
        self.player = player;
    }
}

#[account]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Shot {
    pub schema: u16,
    pub bump: u8,
    pub economy_hash: [u8; 32],
    pub ruleset_hash: [u8; 32],
    pub player: Pubkey,
    pub rent_refund: Pubkey,
    pub delegate: Pubkey,
    pub nonce: u64,
    pub commit: [u8; 32],
    pub entry_mode: u8,
    pub state: u8,
    pub void_reason: u8,
    pub stake: u64,
    pub cleanup_bond_lamports: u64,
    pub xp_base: u64,
    pub sealed_ts: i64,
    pub entry_target_ts: i64,
    pub exit_target_ts: i64,
    pub score_day: i64,
    pub rank_shard: u8,
    pub entry_need: Pubkey,
    pub exit_need: Pubkey,
    pub activation_worker: Pubkey,
    pub activation_slot: u64,
    pub activation_ts: i64,
    pub entry_message_hash: [u8; 32],
    pub entry_timepin_result_hash: [u8; 32],
    pub entry_price: i64,
    pub entry_conf: u64,
    pub entry_exponent: i32,
    pub entry_publish_time: i64,
    pub exit_message_hash: [u8; 32],
    pub exit_timepin_result_hash: [u8; 32],
    pub exit_price: i64,
    pub exit_conf: u64,
    pub exit_exponent: i32,
    pub exit_publish_time: i64,
    pub outcome_yes: u8,
    pub settled_ts: i64,
    pub resolution_slot: u64,
    pub reveal_deadline_ts: i64,
    pub side: u8,
    pub p_bps: u16,
    pub hit: u8,
    pub xp_awarded: u64,
    pub resolver: Pubkey,
    pub forfeit_worker: Pubkey,
    pub terminal_slot: u64,
    pub terminal_ts: i64,
    pub revealed_salt: [u8; 32],
    pub resolution_hash: [u8; 32],
    pub terminal_hash: [u8; 32],
}

impl Shot {
    pub const LEN: usize = 772;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ShotResult {
    pub ruleset_hash: [u8; 32],
    pub proof_material: [u8; 32],
    pub state: u8,
    pub void_reason: u8,
    pub stake: u64,
    pub sealed_ts: i64,
    pub entry_target_ts: i64,
    pub exit_target_ts: i64,
    pub side: u8,
    pub p_bps: u16,
    pub delegate: Pubkey,
    pub game_result_hash: [u8; 32],
}

impl ShotResult {
    pub const LEN: usize = 32 + 32 + 1 + 1 + 8 + 8 + 8 + 8 + 1 + 2 + 32 + 32;
}

/// Canonical game facts intentionally omitted from the compact history row.
/// A verifier reads the permanent Timepin accounts and immutable economy/ruleset,
/// derives these values, then recomputes `ShotResult::game_result_hash`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct GameResultFacts {
    pub entry_timepin_result_hash: [u8; 32],
    pub exit_timepin_result_hash: [u8; 32],
    pub outcome_yes: u8,
    pub hit: u8,
    pub xp_awarded: u64,
    pub score_day: i64,
}

impl GameResultFacts {
    pub const LEN: usize = 32 + 32 + 1 + 1 + 8 + 8;
}

#[account]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct HistoryPage {
    pub schema: u16,
    pub bump: u8,
    pub economy_hash: [u8; 32],
    pub player: Pubkey,
    pub page_index: u64,
    /// Slots appended so far, 0..=HISTORY_PAGE_CAP. Replaces `slots.len()`.
    pub pending_count: u8,
    /// Bit i set = slot i has been terminalised. Replaces `slots[i].is_some()`,
    /// and it is what keeps terminalise-once enforceable while still allowing
    /// the out-of-order terminalisation this module's own test pins.
    pub terminal_mask: u16,
    /// Rolling commitment over the terminal rows, in insertion order. The rows
    /// themselves live in the emitted ShotArchived events; nothing on chain has
    /// ever read them (see docs/reviews/opusc-2026-09-05/M3_THE_PAGES.md).
    pub results_root: [u8; 32],
}

impl HistoryPage {
    // Fixed. No Vec, so no 4-byte length prefix and no growth: the account is
    // allocated once at this size and never resized.
    pub const LEN: usize = 2 + 1 + 32 + 32 + 8 + 1 + 2 + 32;
    pub const BASE_LEN: usize = Self::LEN;
    pub const MAX_LEN: usize = Self::LEN;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct WorkRecord {
    pub subject: Pubkey,
    pub work_kind: u8,
    pub disposition: u8,
    pub worker: Pubkey,
    pub result_hash: [u8; 32],
    pub completed_slot: u64,
}

impl WorkRecord {
    pub const LEN: usize = 32 + 1 + 1 + 32 + 32 + 8;
}

#[account]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct WorkPage {
    pub schema: u16,
    pub bump: u8,
    pub economy_hash: [u8; 32],
    pub player: Pubkey,
    pub page_index: u64,
    pub records: Vec<WorkRecord>,
}

impl WorkPage {
    pub const BASE_LEN: usize = 2 + 1 + 32 + 32 + 8 + 4;
    pub const MAX_LEN: usize = Self::BASE_LEN + WORK_PAGE_CAP * WorkRecord::LEN;
}

#[account]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct DelegateGrant {
    pub schema: u16,
    pub bump: u8,
    pub grant_id: [u8; 16],
    pub economy_hash: [u8; 32],
    pub ruleset_hash: [u8; 32],
    pub player: Pubkey,
    pub delegate: Pubkey,
    pub max_stake: u64,
    pub max_gross_stake: u64,
    pub max_shots: u16,
    pub min_interval_seconds: u32,
    pub expires_at_ts: i64,
    pub gross_stake_used: u64,
    pub shots_used: u16,
    pub last_seal_ts: i64,
    pub revoked: u8,
}

impl DelegateGrant {
    pub const LEN: usize = 196;
}

#[account]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct PlayerDay {
    pub schema: u16,
    pub bump: u8,
    pub economy_hash: [u8; 32],
    pub day: i64,
    pub player: Pubkey,
    pub rank_shard: u8,
    pub accepted: u64,
    pub terminal: u64,
    pub xp: u64,
    /// Who funded this account, and therefore who gets the rent back when it is
    /// closed. Requested by Opus B for M2 (room 14:29Z). NOT accompanied by an
    /// `open_refs` counter: the reference count is already `accepted - terminal`,
    /// maintained on every path by record_accepted/record_terminal with an
    /// underflow guard that predates the request. Two copies of one fact is how
    /// they come to disagree.
    pub rent_payer: Pubkey,
}

impl PlayerDay {
    pub const LEN: usize = 132;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RankEntry {
    pub wallet: Pubkey,
    pub xp: u64,
}

impl RankEntry {
    pub const LEN: usize = 40;
}

#[account]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct RankShard {
    pub schema: u16,
    pub bump: u8,
    pub economy_hash: [u8; 32],
    pub day: i64,
    pub shard: u8,
    pub accepted: u64,
    pub terminal: u64,
    pub top: [RankEntry; PODIUM_SEAT_COUNT],
}

impl RankShard {
    pub const LEN: usize = 180;
}

#[account]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct DayFinal {
    pub schema: u16,
    pub bump: u8,
    pub economy_hash: [u8; 32],
    pub day: i64,
    pub accepted: u64,
    pub terminal: u64,
    pub top: [RankEntry; PODIUM_SEAT_COUNT],
    pub shards_hash: [u8; 32],
    pub final_hash: [u8; 32],
    pub finalized_slot: u64,
    pub finalized_ts: i64,
    pub finalizer: Pubkey,
}

impl DayFinal {
    pub const LEN: usize = 291;
}

#[event]
pub struct DayFinalized {
    pub economy_hash: [u8; 32],
    pub day: i64,
    pub accepted: u64,
    pub terminal: u64,
    pub top: [RankEntry; PODIUM_SEAT_COUNT],
    pub shards_hash: [u8; 32],
    pub final_hash: [u8; 32],
    pub finalizer: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ReloadRecord {
    pub day: i64,
    pub day_final_hash: [u8; 32],
    pub gross: u64,
    pub actions: [u8; PODIUM_SEAT_COUNT],
}

impl ReloadRecord {
    pub const LEN: usize = 8 + 32 + 8 + PODIUM_SEAT_COUNT;
}

#[account]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct ReloadHistoryPage {
    pub schema: u16,
    pub bump: u8,
    pub economy_hash: [u8; 32],
    pub player: Pubkey,
    pub page_index: u64,
    pub records: Vec<ReloadRecord>,
}

impl ReloadHistoryPage {
    pub const BASE_LEN: usize = 2 + 1 + 32 + 32 + 8 + 4;
    pub const MAX_LEN: usize = Self::BASE_LEN + RELOAD_HISTORY_PAGE_CAP * ReloadRecord::LEN;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PodiumAllocation {
    pub base_burn: u64,
    pub pool: u64,
    pub shares: [u64; PODIUM_SEAT_COUNT],
    pub dust: u64,
}

impl PodiumAllocation {
    pub const LEN: usize = 48;
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShotState {
    PendingEntry = 1,
    Active = 2,
    AwaitReveal = 3,
    Revealed = 4,
    Voided = 5,
    Forfeited = 6,
    AwaitVoid = 7,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VoidReason {
    None = 0,
    EntryExpired = 1,
    EntryAmbiguous = 2,
    ExitExpired = 3,
    ExitAmbiguous = 4,
    Equality = 5,
    ConfidenceBand = 6,
}

pub fn economy_hash(args: &EconomyArgs) -> Result<[u8; 32]> {
    let mut canonical = Vec::with_capacity(EconomyArgs::LEN);
    args.serialize(&mut canonical)
        .map_err(|_| error!(StateError::SerializationFailed))?;
    require!(
        canonical.len() == EconomyArgs::LEN,
        StateError::WrongCanonicalLength
    );
    Ok(hashv(&[ECONOMY_HASH_DOMAIN, canonical.as_ref()]).to_bytes())
}

pub fn ruleset_hash(args: &RulesetArgs) -> Result<[u8; 32]> {
    let mut canonical = Vec::with_capacity(RulesetArgs::LEN);
    args.serialize(&mut canonical)
        .map_err(|_| error!(StateError::SerializationFailed))?;
    require!(
        canonical.len() == RulesetArgs::LEN,
        StateError::WrongCanonicalLength
    );
    Ok(hashv(&[RULESET_HASH_DOMAIN, canonical.as_ref()]).to_bytes())
}

pub fn validate_economy(args: &EconomyArgs) -> Result<()> {
    require!(args.schema == CORE_SCHEMA_VERSION, StateError::WrongSchema);
    require!(
        args.timepin_program != Pubkey::default(),
        StateError::MissingProgram
    );
    require!(
        args.timepin_schema == TIMEPIN_SCHEMA_VERSION,
        StateError::WrongTimepinSchema
    );
    require!(
        args.cluster_genesis_hash != [0; 32],
        StateError::MissingClusterIdentity
    );
    require!(
        args.migration_id != [0; 32],
        StateError::MissingMigrationIdentity
    );
    if args.legacy_root == [0; 32] {
        require!(
            args.legacy_snapshot_hash == [0; 32]
                && args.legacy_cutover_slot == 0
                && args.legacy_leaf_count == 0
                && args.legacy_total_credits == 0
                && args.legacy_total_xp == 0,
            StateError::BadLegacySnapshot
        );
    } else {
        require!(
            args.legacy_snapshot_hash != [0; 32]
                && args.legacy_cutover_slot > 0
                && args.legacy_leaf_count > 0
                && (args.legacy_total_credits > 0 || args.legacy_total_xp > 0),
            StateError::BadLegacySnapshot
        );
    }
    require!(
        args.ruleset_policy_root != [0; 32],
        StateError::MissingRulesetRoot
    );
    require!(
        args.ruleset_policy_count > 0,
        StateError::MissingRulesetRoot
    );
    require!(
        args.rcx_mint == crate::RCX_MINT
            && args.rcx_token_program == token_2022::ID
            && args.rcx_decimals == crate::RCX_DECIMALS
            && args.raw_units_per_credit == crate::RCX_RAW_UNITS_PER_CREDIT,
        StateError::WrongFrozenRcxPolicy
    );
    require!(
        args.burn_per_mille == BURN_PER_MILLE
            && args.podium_per_mille == PODIUM_PER_MILLE
            && args.burn_per_mille.checked_add(args.podium_per_mille) == Some(PER_MILLE)
            && args.podium_curve == PODIUM_CURVE
            && args.podium_curve.iter().copied().sum::<u16>() == PER_MILLE
            && args.rank_shard_count == RANK_SHARD_COUNT
            && args.day_seconds == DAY_SECONDS,
        StateError::WrongFrozenRankingPolicy
    );
    require!(args.hit_payout_num > 0, StateError::BadPayout);
    require!(args.hit_payout_den > 0, StateError::BadPayout);
    require!(
        args.hit_payout_num <= args.hit_payout_den.saturating_mul(10),
        StateError::BadPayout
    );
    require!(
        args.min_stake > 0 && args.min_stake <= args.max_stake,
        StateError::BadStakeBounds
    );
    let maximum_payout = u128::from(args.max_stake)
        .checked_mul(u128::from(args.hit_payout_num))
        .ok_or(StateError::MathOverflow)?
        / u128::from(args.hit_payout_den);
    require!(
        maximum_payout <= u128::from(u64::MAX),
        StateError::BadPayout
    );
    require!(args.settle_xp <= MAX_SETTLE_XP, StateError::BadSettleXp);
    require!(
        args.max_open > 0 && args.max_open <= MAX_OPEN_POSITIONS,
        StateError::BadMaxOpen
    );
    require!(
        (MIN_CLEANUP_BOND_LAMPORTS..=MAX_CLEANUP_BOND_LAMPORTS)
            .contains(&args.cleanup_bond_lamports),
        StateError::BadCleanupBond
    );
    require!(
        args.reveal_window_seconds > 0 && args.reveal_window_seconds <= MAX_REVEAL_WINDOW_SECONDS,
        StateError::BadRevealWindow
    );
    require!(args.max_horizon_seconds > 0, StateError::BadHorizon);
    Ok(())
}

pub fn validate_ruleset(args: &RulesetArgs, economy: &Economy) -> Result<()> {
    require!(args.schema == CORE_SCHEMA_VERSION, StateError::WrongSchema);
    require!(
        args.economy_hash == economy.economy_hash,
        StateError::WrongEconomy
    );
    require!(
        args.evidence_spec_hash != [0; 32],
        StateError::MissingEvidenceSpec
    );
    require!(
        args.evidence_policy_hash != [0; 32],
        StateError::MissingEvidencePolicy
    );
    require!(args.feed_id != [0; 32], StateError::MissingFeed);
    require!(
        args.entry_mode == ENTRY_OBSERVED || args.entry_mode == ENTRY_FORWARD,
        StateError::BadEntryMode
    );
    require!(
        args.horizon_seconds > 0 && args.horizon_seconds <= economy.args.max_horizon_seconds,
        StateError::BadHorizon
    );
    require!(
        args.target_grid_seconds > 0 && args.target_grid_seconds <= MAX_GRID_SECONDS,
        StateError::BadGrid
    );
    require!(
        args.min_open_lead_seconds >= MIN_OPEN_LEAD_SECONDS
            && args.min_open_lead_seconds <= args.horizon_seconds,
        StateError::BadOpenLead
    );
    if args.entry_mode == ENTRY_FORWARD {
        require!(
            args.horizon_seconds % args.target_grid_seconds == 0,
            StateError::UnalignedHorizon
        );
        require!(args.max_entry_age_seconds == 0, StateError::BadEntryAge);
    } else {
        require!(args.max_entry_age_seconds > 0, StateError::BadEntryAge);
    }
    require!(args.band_denominator > 0, StateError::BadBand);
    require!(
        args.band_numerator <= MAX_BAND_NUMERATOR,
        StateError::BadBand
    );
    require!(
        args.base_xp > 0 && args.base_xp <= MAX_BASE_XP,
        StateError::BadBaseXp
    );
    Ok(())
}

pub fn ruleset_policy_hash(args: &RulesetArgs) -> Result<[u8; 32]> {
    let mut canonical = Vec::with_capacity(RulesetArgs::LEN);
    args.serialize(&mut canonical)
        .map_err(|_| error!(StateError::SerializationFailed))?;
    require!(
        canonical.len() == RulesetArgs::LEN,
        StateError::WrongCanonicalLength
    );
    Ok(hashv(&[
        RULESET_POLICY_LEAF_DOMAIN,
        &canonical[0..2],
        // Economy identity and the exact generation-specific EvidenceSpec are
        // excluded. The next field is Timepin's generation-independent policy
        // hash, so a new Pyth generation needs a new exact ruleset hash while
        // remaining a member of the economy's frozen quality-policy root.
        &canonical[66..],
    ])
    .to_bytes())
}

pub fn fold_ruleset_policy_proof(mut node: [u8; 32], proof: &[[u8; 32]]) -> Result<[u8; 32]> {
    require!(
        proof.len() <= MAX_MERKLE_PROOF,
        StateError::MerkleProofTooLong
    );
    for sibling in proof {
        node = if node <= *sibling {
            hashv(&[RULESET_POLICY_NODE_DOMAIN, node.as_ref(), sibling.as_ref()]).to_bytes()
        } else {
            hashv(&[RULESET_POLICY_NODE_DOMAIN, sibling.as_ref(), node.as_ref()]).to_bytes()
        };
    }
    Ok(node)
}

pub fn require_ruleset_allowed(
    args: &RulesetArgs,
    economy: &Economy,
    proof: &[[u8; 32]],
) -> Result<()> {
    let leaf = ruleset_policy_hash(args)?;
    require!(
        fold_ruleset_policy_proof(leaf, proof)? == economy.args.ruleset_policy_root,
        StateError::RulesetNotAllowed
    );
    Ok(())
}

pub fn require_ledger_conservation(ledger: &PlayerLedger) -> Result<()> {
    let held = u128::from(ledger.credits)
        .checked_add(u128::from(ledger.locked_credits))
        .and_then(|v| v.checked_add(u128::from(ledger.retired_credits)))
        .ok_or(StateError::MathOverflow)?;
    let sourced = u128::from(ledger.legacy_credits)
        .checked_add(u128::from(ledger.reload_credits))
        .and_then(|v| v.checked_add(u128::from(ledger.payout_credits)))
        .ok_or(StateError::MathOverflow)?;
    require!(held == sourced, StateError::LedgerConservationBroken);
    let credit_capacity = sourced
        .checked_add(u128::from(ledger.reserved_payout_credits))
        .ok_or(StateError::MathOverflow)?;
    require!(
        credit_capacity <= u128::from(u64::MAX),
        StateError::LedgerConservationBroken
    );
    let xp = u128::from(ledger.legacy_xp)
        .checked_add(u128::from(ledger.earned_xp))
        .ok_or(StateError::MathOverflow)?;
    require!(
        u128::from(ledger.xp) == xp,
        StateError::LedgerConservationBroken
    );
    let xp_capacity = xp
        .checked_add(u128::from(ledger.reserved_xp))
        .ok_or(StateError::MathOverflow)?;
    require!(
        xp_capacity <= u128::from(u64::MAX),
        StateError::LedgerConservationBroken
    );
    let raw_out = u128::from(ledger.rcx_burned)
        .checked_add(u128::from(ledger.rcx_routed))
        .ok_or(StateError::MathOverflow)?;
    require!(
        u128::from(ledger.rcx_reloaded) == raw_out,
        StateError::RcxConservationBroken
    );
    let accounted_shots = u128::from(ledger.open)
        .checked_add(u128::from(ledger.shots))
        .and_then(|value| value.checked_add(u128::from(ledger.voids)))
        .ok_or(StateError::MathOverflow)?;
    require!(
        u128::from(ledger.sealed) == accounted_shots && ledger.forfeits <= ledger.shots,
        StateError::ShotConservationBroken
    );
    Ok(())
}

pub fn authenticate_economy(economy: &Economy, key: Pubkey) -> Result<()> {
    validate_economy(&economy.args)?;
    let hash = economy_hash(&economy.args)?;
    require!(hash == economy.economy_hash, StateError::WrongEconomyHash);
    let (expected, bump) = Pubkey::find_program_address(
        &[ECONOMY_SEED, CORE_SCHEMA_SEED.as_ref(), hash.as_ref()],
        &crate::ID,
    );
    require_keys_eq!(key, expected, StateError::WrongEconomyPda);
    require!(economy.bump == bump, StateError::WrongBump);
    Ok(())
}

pub fn authenticate_ruleset(ruleset: &Ruleset, economy: &Economy, key: Pubkey) -> Result<()> {
    validate_ruleset(&ruleset.args, economy)?;
    let hash = ruleset_hash(&ruleset.args)?;
    require!(hash == ruleset.ruleset_hash, StateError::WrongRulesetHash);
    let (expected, bump) = Pubkey::find_program_address(
        &[RULESET_SEED, CORE_SCHEMA_SEED.as_ref(), hash.as_ref()],
        &crate::ID,
    );
    require_keys_eq!(key, expected, StateError::WrongRulesetPda);
    require!(ruleset.bump == bump, StateError::WrongBump);
    Ok(())
}

pub fn commitment_hash(
    economy_hash: &[u8; 32],
    ruleset_hash: &[u8; 32],
    player: &Pubkey,
    nonce: u64,
    side: u8,
    p_bps: u16,
    salt: &[u8; 32],
) -> [u8; 32] {
    hashv(&[
        COMMITMENT_DOMAIN,
        crate::ID.as_ref(),
        economy_hash.as_ref(),
        ruleset_hash.as_ref(),
        player.as_ref(),
        &nonce.to_le_bytes(),
        &[side],
        &p_bps.to_le_bytes(),
        salt.as_ref(),
    ])
    .to_bytes()
}

pub fn legacy_leaf(
    cluster_genesis_hash: &[u8; 32],
    migration_id: &[u8; 32],
    snapshot_hash: &[u8; 32],
    cutover_slot: u64,
    player: &Pubkey,
    credits: u64,
    xp: u64,
) -> [u8; 32] {
    hashv(&[
        LEGACY_LEAF_DOMAIN,
        crate::ID.as_ref(),
        CORE_SCHEMA_SEED.as_ref(),
        cluster_genesis_hash.as_ref(),
        migration_id.as_ref(),
        snapshot_hash.as_ref(),
        &cutover_slot.to_le_bytes(),
        player.as_ref(),
        &credits.to_le_bytes(),
        &xp.to_le_bytes(),
    ])
    .to_bytes()
}

pub fn fold_merkle_proof(mut node: [u8; 32], proof: &[[u8; 32]]) -> Result<[u8; 32]> {
    require!(
        proof.len() <= MAX_MERKLE_PROOF,
        StateError::MerkleProofTooLong
    );
    for sibling in proof {
        node = if node <= *sibling {
            hashv(&[LEGACY_NODE_DOMAIN, node.as_ref(), sibling.as_ref()]).to_bytes()
        } else {
            hashv(&[LEGACY_NODE_DOMAIN, sibling.as_ref(), node.as_ref()]).to_bytes()
        };
    }
    Ok(node)
}

pub fn align_up(value: i64, grid: u32) -> Result<i64> {
    require!(value >= 0 && grid > 0, StateError::TimestampOverflow);
    let grid = i64::from(grid);
    let added = value
        .checked_add(grid - 1)
        .ok_or(StateError::TimestampOverflow)?;
    Ok((added / grid) * grid)
}

pub fn scale_to_e12(value: i64, exponent: i32) -> Result<i128> {
    require!(
        (i32::from(CORE_MIN_EXPONENT)..=i32::from(CORE_MAX_EXPONENT)).contains(&exponent),
        StateError::BadExponent
    );
    let power: u32 = (12 + exponent)
        .try_into()
        .map_err(|_| error!(StateError::BadExponent))?;
    let factor = 10i128.checked_pow(power).ok_or(StateError::MathOverflow)?;
    i128::from(value)
        .checked_mul(factor)
        .ok_or(error!(StateError::MathOverflow))
}

pub fn hit_payout(stake: u64, economy: &Economy) -> Result<u64> {
    let product = u128::from(stake)
        .checked_mul(u128::from(economy.args.hit_payout_num))
        .ok_or(StateError::MathOverflow)?;
    let payout = product / u128::from(economy.args.hit_payout_den);
    payout
        .try_into()
        .map_err(|_| error!(StateError::MathOverflow))
}

pub fn brier_score(side: u8, p_bps: u16, outcome_yes: bool) -> Result<u128> {
    require!(side <= 1, StateError::BadSide);
    require!((1..10_000).contains(&p_bps), StateError::BadProbability);
    let yes_probability = if side == 1 {
        i64::from(p_bps)
    } else {
        10_000 - i64::from(p_bps)
    };
    let outcome = if outcome_yes { 10_000i64 } else { 0i64 };
    let error = i128::from(yes_probability - outcome);
    u128::try_from(error * error).map_err(|_| error!(StateError::MathOverflow))
}

pub fn resolution_hash(shot_key: &Pubkey, shot: &Shot) -> [u8; 32] {
    hashv(&[
        RESULT_HASH_DOMAIN,
        shot_key.as_ref(),
        shot.economy_hash.as_ref(),
        shot.ruleset_hash.as_ref(),
        shot.player.as_ref(),
        shot.rent_refund.as_ref(),
        shot.delegate.as_ref(),
        &shot.nonce.to_le_bytes(),
        shot.commit.as_ref(),
        &[shot.entry_mode],
        &[shot.void_reason],
        &shot.stake.to_le_bytes(),
        &shot.cleanup_bond_lamports.to_le_bytes(),
        &shot.xp_base.to_le_bytes(),
        &shot.sealed_ts.to_le_bytes(),
        &shot.entry_target_ts.to_le_bytes(),
        &shot.exit_target_ts.to_le_bytes(),
        &shot.score_day.to_le_bytes(),
        &[shot.rank_shard],
        shot.entry_need.as_ref(),
        shot.exit_need.as_ref(),
        shot.activation_worker.as_ref(),
        &shot.activation_slot.to_le_bytes(),
        &shot.activation_ts.to_le_bytes(),
        shot.entry_message_hash.as_ref(),
        shot.entry_timepin_result_hash.as_ref(),
        &shot.entry_price.to_le_bytes(),
        &shot.entry_conf.to_le_bytes(),
        &shot.entry_exponent.to_le_bytes(),
        &shot.entry_publish_time.to_le_bytes(),
        shot.exit_message_hash.as_ref(),
        shot.exit_timepin_result_hash.as_ref(),
        &shot.exit_price.to_le_bytes(),
        &shot.exit_conf.to_le_bytes(),
        &shot.exit_exponent.to_le_bytes(),
        &shot.exit_publish_time.to_le_bytes(),
        &[shot.outcome_yes],
        &shot.settled_ts.to_le_bytes(),
        &shot.resolution_slot.to_le_bytes(),
        &shot.reveal_deadline_ts.to_le_bytes(),
        shot.resolver.as_ref(),
    ])
    .to_bytes()
}

pub fn terminal_hash(shot_key: &Pubkey, shot: &Shot) -> [u8; 32] {
    hashv(&[
        TERMINAL_HASH_DOMAIN,
        shot_key.as_ref(),
        shot.resolution_hash.as_ref(),
        &[shot.state],
        &[shot.void_reason],
        &[shot.side],
        &shot.p_bps.to_le_bytes(),
        &[shot.hit],
        &shot.xp_awarded.to_le_bytes(),
        shot.forfeit_worker.as_ref(),
        shot.revealed_salt.as_ref(),
        &shot.terminal_slot.to_le_bytes(),
        &shot.terminal_ts.to_le_bytes(),
    ])
    .to_bytes()
}

pub fn is_terminal_shot_state(state: u8) -> bool {
    matches!(
        state,
        value if value == ShotState::Revealed as u8
            || value == ShotState::Voided as u8
            || value == ShotState::Forfeited as u8
    )
}

pub fn validate_compact_result_shape(result: &ShotResult) -> Result<()> {
    require!(
        result.ruleset_hash != [0; 32]
            && result.stake > 0
            && result.sealed_ts > 0
            && result.entry_target_ts > 0
            && result.exit_target_ts > result.entry_target_ts
            && is_terminal_shot_state(result.state),
        StateError::InvalidTerminalShape
    );
    match result.state {
        value if value == ShotState::Revealed as u8 => require!(
            result.void_reason == VoidReason::None as u8
                && result.side <= 1
                && (1..10_000).contains(&result.p_bps),
            StateError::InvalidTerminalShape
        ),
        value if value == ShotState::Voided as u8 => require!(
            matches!(
                result.void_reason,
                value if value == VoidReason::EntryExpired as u8
                    || value == VoidReason::EntryAmbiguous as u8
                    || value == VoidReason::ExitExpired as u8
                    || value == VoidReason::ExitAmbiguous as u8
                    || value == VoidReason::Equality as u8
                    || value == VoidReason::ConfidenceBand as u8
            ) && result.side == 0
                && result.p_bps == 0
                && result.proof_material != [0; 32],
            StateError::InvalidTerminalShape
        ),
        value if value == ShotState::Forfeited as u8 => require!(
            result.void_reason == VoidReason::None as u8
                && result.side == 0
                && result.p_bps == 0
                && result.proof_material != [0; 32],
            StateError::InvalidTerminalShape
        ),
        _ => return err!(StateError::ShotNotTerminal),
    }
    Ok(())
}

pub fn compact_result_commit(
    economy_hash: &[u8; 32],
    player: &Pubkey,
    nonce: u64,
    result: &ShotResult,
) -> Result<[u8; 32]> {
    validate_compact_result_shape(result)?;
    let commit = if result.state == ShotState::Revealed as u8 {
        commitment_hash(
            economy_hash,
            &result.ruleset_hash,
            player,
            nonce,
            result.side,
            result.p_bps,
            &result.proof_material,
        )
    } else {
        result.proof_material
    };
    require!(commit != [0; 32], StateError::InvalidTerminalShape);
    Ok(commit)
}

pub fn validate_game_result_facts(result: &ShotResult, facts: &GameResultFacts) -> Result<()> {
    validate_compact_result_shape(result)?;
    require!(
        facts.outcome_yes <= 1 && facts.hit <= 1 && facts.score_day >= 0,
        StateError::InvalidGameResultFacts
    );
    match result.state {
        value if value == ShotState::Revealed as u8 => require!(
            facts.entry_timepin_result_hash != [0; 32]
                && facts.exit_timepin_result_hash != [0; 32]
                && facts.hit == u8::from((result.side == 1) == (facts.outcome_yes == 1)),
            StateError::InvalidGameResultFacts
        ),
        value if value == ShotState::Forfeited as u8 => require!(
            facts.entry_timepin_result_hash != [0; 32]
                && facts.exit_timepin_result_hash != [0; 32]
                && facts.hit == 0
                && facts.xp_awarded == 0,
            StateError::InvalidGameResultFacts
        ),
        value if value == ShotState::Voided as u8 => {
            let entry_terminal = result.void_reason == VoidReason::EntryExpired as u8
                || result.void_reason == VoidReason::EntryAmbiguous as u8;
            require!(
                facts.entry_timepin_result_hash != [0; 32]
                    && (if entry_terminal {
                        facts.exit_timepin_result_hash == [0; 32]
                    } else {
                        facts.exit_timepin_result_hash != [0; 32]
                    })
                    && facts.outcome_yes == 0
                    && facts.hit == 0
                    && facts.xp_awarded == 0,
                StateError::InvalidGameResultFacts
            );
        }
        _ => return err!(StateError::ShotNotTerminal),
    }
    Ok(())
}

/// Self-verifiable game-only digest. It deliberately excludes rent recipients,
/// cleanup bonds, workers and action timing. The permanent Timepin accounts are
/// the source for `facts`; the history page supplies the rest plus implicit nonce.
pub fn game_result_hash(
    economy_hash: &[u8; 32],
    player: &Pubkey,
    nonce: u64,
    result: &ShotResult,
    facts: &GameResultFacts,
) -> Result<[u8; 32]> {
    validate_game_result_facts(result, facts)?;
    let commit = compact_result_commit(economy_hash, player, nonce, result)?;
    Ok(hashv(&[
        GAME_RESULT_HASH_DOMAIN,
        crate::ID.as_ref(),
        economy_hash.as_ref(),
        player.as_ref(),
        &nonce.to_le_bytes(),
        result.ruleset_hash.as_ref(),
        commit.as_ref(),
        &result.stake.to_le_bytes(),
        &result.sealed_ts.to_le_bytes(),
        &result.entry_target_ts.to_le_bytes(),
        &result.exit_target_ts.to_le_bytes(),
        &[result.state],
        &[result.void_reason],
        &[result.side],
        &result.p_bps.to_le_bytes(),
        result.delegate.as_ref(),
        facts.entry_timepin_result_hash.as_ref(),
        facts.exit_timepin_result_hash.as_ref(),
        &[facts.outcome_yes],
        &[facts.hit],
        &facts.xp_awarded.to_le_bytes(),
        &facts.score_day.to_le_bytes(),
    ])
    .to_bytes())
}

pub fn verify_game_result(
    economy_hash: &[u8; 32],
    player: &Pubkey,
    nonce: u64,
    result: &ShotResult,
    facts: &GameResultFacts,
) -> Result<()> {
    require!(
        result.game_result_hash == game_result_hash(economy_hash, player, nonce, result, facts)?,
        StateError::WrongGameResultHash
    );
    Ok(())
}

impl GameResultFacts {
    pub fn from_terminal_shot(shot: &Shot) -> Self {
        Self {
            entry_timepin_result_hash: shot.entry_timepin_result_hash,
            exit_timepin_result_hash: shot.exit_timepin_result_hash,
            outcome_yes: shot.outcome_yes,
            hit: shot.hit,
            xp_awarded: shot.xp_awarded,
            score_day: shot.score_day,
        }
    }
}

impl ShotResult {
    pub fn from_terminal_shot(shot_key: &Pubkey, shot: &Shot) -> Result<Self> {
        let (expected, bump) = Pubkey::find_program_address(
            &[
                SHOT_SEED,
                shot.economy_hash.as_ref(),
                shot.player.as_ref(),
                &shot.nonce.to_le_bytes(),
            ],
            &crate::ID,
        );
        require_keys_eq!(*shot_key, expected, StateError::WrongShotPda);
        require!(shot.bump == bump, StateError::WrongBump);
        require!(
            shot.schema == CORE_SCHEMA_VERSION
                && shot.economy_hash != [0; 32]
                && shot.ruleset_hash != [0; 32]
                && shot.player != Pubkey::default()
                && shot.rent_refund != Pubkey::default()
                && shot.commit != [0; 32]
                && (shot.entry_mode == ENTRY_OBSERVED || shot.entry_mode == ENTRY_FORWARD)
                && shot.stake > 0
                && shot.sealed_ts > 0
                && shot.entry_target_ts > 0
                && shot.exit_target_ts > shot.entry_target_ts
                && shot.score_day >= 0
                && (MIN_CLEANUP_BOND_LAMPORTS..=MAX_CLEANUP_BOND_LAMPORTS)
                    .contains(&shot.cleanup_bond_lamports)
                && shot.entry_need != Pubkey::default()
                && shot.exit_need != Pubkey::default()
                && shot.entry_need != shot.exit_need,
            StateError::InvalidTerminalShape
        );
        require!(
            is_terminal_shot_state(shot.state),
            StateError::ShotNotTerminal
        );
        require!(
            shot.resolution_hash == resolution_hash(shot_key, shot)
                && shot.terminal_hash == terminal_hash(shot_key, shot),
            StateError::WrongShotHash
        );
        require!(
            shot.resolver != Pubkey::default()
                && shot.resolution_slot > 0
                && shot.settled_ts > 0
                && shot.terminal_slot >= shot.resolution_slot
                && shot.terminal_ts >= shot.settled_ts,
            StateError::InvalidTerminalShape
        );
        let activation_empty = shot.activation_worker == Pubkey::default();
        require!(
            (activation_empty && shot.activation_slot == 0 && shot.activation_ts == 0)
                || (!activation_empty && shot.activation_slot > 0 && shot.activation_ts > 0),
            StateError::InvalidTerminalShape
        );
        match shot.state {
            value if value == ShotState::Revealed as u8 => {
                require!(
                    shot.void_reason == VoidReason::None as u8
                        && shot.forfeit_worker == Pubkey::default()
                        && shot.side <= 1
                        && (1..10_000).contains(&shot.p_bps)
                        && shot.hit <= 1
                        && shot.commit
                            == commitment_hash(
                                &shot.economy_hash,
                                &shot.ruleset_hash,
                                &shot.player,
                                shot.nonce,
                                shot.side,
                                shot.p_bps,
                                &shot.revealed_salt,
                            ),
                    StateError::InvalidTerminalShape
                );
            }
            value if value == ShotState::Voided as u8 => {
                require!(
                    shot.void_reason != VoidReason::None as u8
                        && shot.forfeit_worker == Pubkey::default()
                        && shot.side == 0
                        && shot.p_bps == 0
                        && shot.hit == 0
                        && shot.xp_awarded == 0
                        && shot.revealed_salt == [0; 32],
                    StateError::InvalidTerminalShape
                );
            }
            value if value == ShotState::Forfeited as u8 => {
                require!(
                    shot.void_reason == VoidReason::None as u8
                        && shot.forfeit_worker != Pubkey::default()
                        && shot.side == 0
                        && shot.p_bps == 0
                        && shot.hit == 0
                        && shot.xp_awarded == 0
                        && shot.revealed_salt == [0; 32],
                    StateError::InvalidTerminalShape
                );
            }
            _ => return err!(StateError::ShotNotTerminal),
        }
        let mut result = Self {
            ruleset_hash: shot.ruleset_hash,
            proof_material: if shot.state == ShotState::Revealed as u8 {
                shot.revealed_salt
            } else {
                shot.commit
            },
            state: shot.state,
            void_reason: shot.void_reason,
            stake: shot.stake,
            sealed_ts: shot.sealed_ts,
            entry_target_ts: shot.entry_target_ts,
            exit_target_ts: shot.exit_target_ts,
            side: shot.side,
            p_bps: shot.p_bps,
            delegate: shot.delegate,
            game_result_hash: [0; 32],
        };
        let facts = GameResultFacts::from_terminal_shot(shot);
        result.game_result_hash = game_result_hash(
            &shot.economy_hash,
            &shot.player,
            shot.nonce,
            &result,
            &facts,
        )?;
        verify_game_result(
            &shot.economy_hash,
            &shot.player,
            shot.nonce,
            &result,
            &facts,
        )?;
        Ok(result)
    }
}

pub const fn history_page_index(nonce: u64) -> u64 {
    nonce / HISTORY_PAGE_CAP as u64
}

pub const fn history_page_slot(nonce: u64) -> usize {
    (nonce % HISTORY_PAGE_CAP as u64) as usize
}

pub fn history_page_pda(economy_hash: &[u8; 32], player: &Pubkey, page_index: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            HISTORY_PAGE_SEED,
            economy_hash.as_ref(),
            player.as_ref(),
            &page_index.to_le_bytes(),
        ],
        &crate::ID,
    )
}

impl HistoryPage {
    /// The page is a fixed-size commitment now, so its serialised length does not
    /// depend on how much has happened to it. The arguments are kept, and still
    /// validated, so callers that pass counts keep failing on impossible ones.
    pub fn serialized_len_for(slot_count: usize, terminal_count: usize) -> Result<usize> {
        require!(
            terminal_count <= slot_count && slot_count <= HISTORY_PAGE_CAP,
            StateError::InvalidHistoryPage
        );
        Ok(Self::LEN)
    }

    pub fn max_serialized_len() -> usize {
        Self::MAX_LEN
    }

    pub fn initialize(
        &mut self,
        bump: u8,
        economy_hash: [u8; 32],
        player: Pubkey,
        page_index: u64,
    ) {
        self.schema = CORE_SCHEMA_VERSION;
        self.bump = bump;
        self.economy_hash = economy_hash;
        self.player = player;
        self.page_index = page_index;
        self.pending_count = 0;
        self.terminal_mask = 0;
        self.results_root = [0; 32];
    }

    pub fn terminal_count(&self) -> u8 {
        self.terminal_mask.count_ones() as u8
    }

    pub fn validate_contents(&self) -> Result<()> {
        require!(
            self.schema == CORE_SCHEMA_VERSION
                && self.economy_hash != [0; 32]
                && self.player != Pubkey::default()
                && (self.pending_count as usize) <= HISTORY_PAGE_CAP
                // no bit may be set above the slots actually appended: a mask
                // wider than the page is a corrupt page.
                // WIDENED TO u32 DELIBERATELY: pending_count reaches
                // HISTORY_PAGE_CAP == 16, and `u16 >> 16` is an overflow shift.
                // The workspace sets overflow-checks = true (Cargo.toml:6), so
                // that shift PANICS - a full page would have aborted every later
                // append and every terminalisation, permanently. u32 >> 16 is
                // defined, and pending_count can never reach 32.
                && (self.terminal_mask as u32) >> (self.pending_count as u32) == 0,
            StateError::InvalidHistoryPage
        );
        // The row shape checks that used to run here, over rows committed long
        // ago, now run in commit_terminal on the row about to be committed -
        // strictly earlier, and on the only row that can still be wrong.
        Ok(())
    }

    pub fn append_pending(&mut self, nonce: u64) -> Result<usize> {
        self.validate_contents()?;
        require!(
            (self.pending_count as usize) < HISTORY_PAGE_CAP,
            StateError::HistoryPageFull
        );
        let slot = history_page_slot(nonce);
        require!(
            history_page_index(nonce) == self.page_index
                && slot == self.pending_count as usize,
            StateError::HistoryAppendOutOfOrder
        );
        self.pending_count += 1;
        Ok(slot)
    }

    /// Fold one terminal row into the page's commitment. Returns
    /// (slot, sequence, row_hash); `sequence` is 1-based and is the fold order an
    /// off-chain reader must use, because slots are APPENDED in nonce order and
    /// TERMINALISED OUT OF ORDER - a nonce-ordered fold would not reproduce this
    /// root. The dense 1..=terminal_count sequence is also what makes omission
    /// detectable: the root proves the rows a reader has were not altered, the
    /// sequence proves the reader has all of them.
    pub fn commit_terminal(&mut self, shot_key: &Pubkey, shot: &Shot) -> Result<(usize, u8, [u8; 32])> {
        self.validate_contents()?;
        require!(
            self.economy_hash == shot.economy_hash && self.player == shot.player,
            StateError::InvalidHistoryPage
        );
        require!(
            history_page_index(shot.nonce) == self.page_index,
            StateError::InvalidHistoryPage
        );
        let slot = history_page_slot(shot.nonce);
        require!(
            slot < self.pending_count as usize,
            StateError::HistorySlotMissing
        );
        let bit = 1u16 << slot;
        require!(
            self.terminal_mask & bit == 0,
            StateError::HistorySlotAlreadyTerminal
        );
        let result = ShotResult::from_terminal_shot(shot_key, shot)?;
        validate_compact_result_shape(&result)?;
        require!(
            result.game_result_hash != [0; 32],
            StateError::InvalidHistoryPage
        );
        // Not try_to_vec: borsh 1.x removed it, and the compiler said so
        // (E0599 at this line, lead's source check 14:37Z). AnchorSerialize's
        // own `serialize` is what the rest of this file already uses.
        let mut row_bytes: Vec<u8> = Vec::with_capacity(ShotResult::LEN);
        result
            .serialize(&mut row_bytes)
            .map_err(|_| error!(StateError::InvalidHistoryPage))?;
        let row_hash = hashv(&[
            HISTORY_ROW_DOMAIN,
            &shot.nonce.to_le_bytes(),
            &row_bytes,
        ])
        .to_bytes();
        self.results_root =
            hashv(&[HISTORY_CHAIN_DOMAIN, &self.results_root, &row_hash]).to_bytes();
        self.terminal_mask |= bit;
        self.validate_contents()?;
        Ok((slot, self.terminal_count(), row_hash))
    }
}

pub fn authenticate_history_page(
    page: &HistoryPage,
    key: Pubkey,
    economy_hash: &[u8; 32],
    player: &Pubkey,
    page_index: u64,
) -> Result<()> {
    page.validate_contents()?;
    require!(
        page.economy_hash == *economy_hash
            && page.player == *player
            && page.page_index == page_index,
        StateError::InvalidHistoryPage
    );
    let (expected, bump) = history_page_pda(economy_hash, player, page_index);
    require_keys_eq!(key, expected, StateError::WrongHistoryPagePda);
    require!(page.bump == bump, StateError::WrongBump);
    Ok(())
}

pub const fn reload_history_page_index(nonce: u64) -> u64 {
    nonce / RELOAD_HISTORY_PAGE_CAP as u64
}

pub const fn reload_history_page_slot(nonce: u64) -> usize {
    (nonce % RELOAD_HISTORY_PAGE_CAP as u64) as usize
}

pub fn reload_history_page_pda(
    economy_hash: &[u8; 32],
    player: &Pubkey,
    page_index: u64,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            RELOAD_HISTORY_PAGE_SEED,
            economy_hash.as_ref(),
            player.as_ref(),
            &page_index.to_le_bytes(),
        ],
        &crate::ID,
    )
}

impl ReloadRecord {
    pub fn validate_shape(&self) -> Result<()> {
        require!(
            self.day >= 0
                && self.day_final_hash != [0; 32]
                && self.gross > 0
                && self.actions.iter().all(|action| matches!(
                    *action,
                    RELOAD_ACTION_BURN | RELOAD_ACTION_ROUTE | RELOAD_ACTION_RETAIN
                )),
            StateError::InvalidReloadRecord
        );
        Ok(())
    }
}

impl ReloadHistoryPage {
    pub fn serialized_len_for(record_count: usize) -> Result<usize> {
        require!(
            record_count <= RELOAD_HISTORY_PAGE_CAP,
            StateError::ReloadHistoryPageFull
        );
        Self::BASE_LEN
            .checked_add(
                record_count
                    .checked_mul(ReloadRecord::LEN)
                    .ok_or(StateError::MathOverflow)?,
            )
            .ok_or(error!(StateError::MathOverflow))
    }

    pub fn max_serialized_len() -> usize {
        Self::MAX_LEN
    }

    pub fn initialize(
        &mut self,
        bump: u8,
        economy_hash: [u8; 32],
        player: Pubkey,
        page_index: u64,
    ) {
        self.schema = CORE_SCHEMA_VERSION;
        self.bump = bump;
        self.economy_hash = economy_hash;
        self.player = player;
        self.page_index = page_index;
        self.records = Vec::new();
    }

    pub fn validate_contents(&self) -> Result<()> {
        require!(
            self.schema == CORE_SCHEMA_VERSION
                && self.economy_hash != [0; 32]
                && self.player != Pubkey::default()
                && self.records.len() <= RELOAD_HISTORY_PAGE_CAP,
            StateError::InvalidReloadHistoryPage
        );
        for record in &self.records {
            record.validate_shape()?;
        }
        Ok(())
    }

    pub fn validate_next_nonce(&self, nonce: u64) -> Result<usize> {
        self.validate_contents()?;
        require!(
            self.records.len() < RELOAD_HISTORY_PAGE_CAP,
            StateError::ReloadHistoryPageFull
        );
        let slot = reload_history_page_slot(nonce);
        require!(
            reload_history_page_index(nonce) == self.page_index && slot == self.records.len(),
            StateError::ReloadAppendOutOfOrder
        );
        Ok(slot)
    }

    pub fn append(&mut self, nonce: u64, record: ReloadRecord) -> Result<usize> {
        let slot = self.validate_next_nonce(nonce)?;
        record.validate_shape()?;
        self.records.push(record);
        self.validate_contents()?;
        Ok(slot)
    }
}

pub fn authenticate_reload_history_page(
    page: &ReloadHistoryPage,
    key: Pubkey,
    economy_hash: &[u8; 32],
    player: &Pubkey,
    page_index: u64,
) -> Result<()> {
    page.validate_contents()?;
    require!(
        page.economy_hash == *economy_hash
            && page.player == *player
            && page.page_index == page_index,
        StateError::InvalidReloadHistoryPage
    );
    let (expected, bump) = reload_history_page_pda(economy_hash, player, page_index);
    require_keys_eq!(key, expected, StateError::WrongReloadHistoryPagePda);
    require!(page.bump == bump, StateError::WrongBump);
    Ok(())
}

pub fn work_kind_offset(work_kind: u8) -> Result<usize> {
    match work_kind {
        WORK_KIND_ACTIVATE_ENTRY => Ok(0),
        WORK_KIND_RESOLVE_SHOT => Ok(1),
        WORK_KIND_FORFEIT => Ok(2),
        _ => err!(StateError::InvalidWorkKind),
    }
}

pub const fn work_page_index(nonce: u64) -> u64 {
    nonce / HISTORY_PAGE_CAP as u64
}

pub fn work_page_pda(economy_hash: &[u8; 32], player: &Pubkey, page_index: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            WORK_PAGE_SEED,
            economy_hash.as_ref(),
            player.as_ref(),
            &page_index.to_le_bytes(),
        ],
        &crate::ID,
    )
}

impl WorkRecord {
    pub fn validate_shape(&self) -> Result<()> {
        require!(
            self.subject != Pubkey::default() && work_kind_offset(self.work_kind).is_ok(),
            StateError::InvalidWorkRecord
        );
        match self.disposition {
            RECEIPT_PENDING => require!(
                self.worker == Pubkey::default()
                    && self.result_hash == [0; 32]
                    && self.completed_slot == 0,
                StateError::InvalidWorkRecord
            ),
            RECEIPT_PAYABLE => require!(
                self.worker != Pubkey::default()
                    && self.result_hash != [0; 32]
                    && self.completed_slot > 0,
                StateError::InvalidWorkRecord
            ),
            RECEIPT_NONPAYABLE => require!(
                self.worker == Pubkey::default()
                    && self.result_hash != [0; 32]
                    && self.completed_slot > 0,
                StateError::InvalidWorkRecord
            ),
            _ => return err!(StateError::InvalidWorkDisposition),
        }
        Ok(())
    }
}

impl WorkPage {
    pub fn serialized_len_for(record_count: usize) -> Result<usize> {
        require!(record_count <= WORK_PAGE_CAP, StateError::WorkPageFull);
        Self::BASE_LEN
            .checked_add(
                record_count
                    .checked_mul(WorkRecord::LEN)
                    .ok_or(StateError::MathOverflow)?,
            )
            .ok_or(error!(StateError::MathOverflow))
    }

    pub fn max_serialized_len() -> usize {
        Self::MAX_LEN
    }

    pub fn initialize(
        &mut self,
        bump: u8,
        economy_hash: [u8; 32],
        player: Pubkey,
        page_index: u64,
    ) {
        self.schema = CORE_SCHEMA_VERSION;
        self.bump = bump;
        self.economy_hash = economy_hash;
        self.player = player;
        self.page_index = page_index;
        self.records = Vec::new();
    }

    pub fn validate_contents(&self) -> Result<()> {
        require!(
            self.schema == CORE_SCHEMA_VERSION
                && self.economy_hash != [0; 32]
                && self.player != Pubkey::default()
                && self.records.len() <= WORK_PAGE_CAP,
            StateError::InvalidWorkPage
        );
        for (index, record) in self.records.iter().enumerate() {
            record.validate_shape()?;
            require!(
                !self.records[..index].iter().any(|prior| {
                    prior.subject == record.subject && prior.work_kind == record.work_kind
                }),
                StateError::DuplicateWorkRecord
            );
        }
        Ok(())
    }

    pub fn lookup_optional_index(&self, subject: &Pubkey, work_kind: u8) -> Result<Option<usize>> {
        work_kind_offset(work_kind)?;
        self.validate_contents()?;
        Ok(self
            .records
            .iter()
            .position(|record| record.subject == *subject && record.work_kind == work_kind))
    }

    pub fn lookup_index(&self, subject: &Pubkey, work_kind: u8) -> Result<usize> {
        self.lookup_optional_index(subject, work_kind)?
            .ok_or(error!(StateError::WorkRecordMissing))
    }

    /// Idempotently reserve the only record for `(shot, work_kind)`. A client
    /// places this instruction immediately before Work Market funding in one
    /// atomic transaction. A standalone reservation only prepays page rent; it
    /// grants no worker, sponsor or claim rights and cannot create duplicates.
    pub fn reserve_for_shot(
        &mut self,
        shot_key: &Pubkey,
        shot: &Shot,
        work_kind: u8,
        expected_index: u8,
    ) -> Result<usize> {
        self.validate_contents()?;
        work_kind_offset(work_kind)?;
        let (expected_shot, shot_bump) = Pubkey::find_program_address(
            &[
                SHOT_SEED,
                shot.economy_hash.as_ref(),
                shot.player.as_ref(),
                &shot.nonce.to_le_bytes(),
            ],
            &crate::ID,
        );
        require_keys_eq!(*shot_key, expected_shot, StateError::WrongShotPda);
        require!(shot.bump == shot_bump, StateError::WrongBump);
        require!(
            shot.schema == CORE_SCHEMA_VERSION
                && shot.economy_hash == self.economy_hash
                && shot.player == self.player
                && work_page_index(shot.nonce) == self.page_index,
            StateError::InvalidWorkSubject
        );

        if let Some(index) = self
            .records
            .iter()
            .position(|record| record.subject == *shot_key && record.work_kind == work_kind)
        {
            require!(
                index == usize::from(expected_index),
                StateError::WrongWorkRecordIndex
            );
            return Ok(index);
        }

        require_work_reservable(shot, work_kind)?;
        require!(self.records.len() < WORK_PAGE_CAP, StateError::WorkPageFull);
        require!(
            self.records.len() == usize::from(expected_index),
            StateError::WrongWorkRecordIndex
        );
        self.records.push(WorkRecord {
            subject: *shot_key,
            work_kind,
            disposition: RECEIPT_PENDING,
            worker: Pubkey::default(),
            result_hash: [0; 32],
            completed_slot: 0,
        });
        self.validate_contents()?;
        Ok(self.records.len() - 1)
    }

    pub fn complete_pending(
        &mut self,
        record_index: u8,
        subject: &Pubkey,
        work_kind: u8,
        disposition: u8,
        worker: Pubkey,
        result_hash: [u8; 32],
        completed_slot: u64,
    ) -> Result<()> {
        self.validate_contents()?;
        work_kind_offset(work_kind)?;
        require!(
            disposition == RECEIPT_PAYABLE || disposition == RECEIPT_NONPAYABLE,
            StateError::InvalidWorkDisposition
        );
        let record = self
            .records
            .get_mut(usize::from(record_index))
            .ok_or(error!(StateError::WorkRecordMissing))?;
        require!(
            record.subject == *subject && record.work_kind == work_kind,
            StateError::WrongWorkRecordIndex
        );
        require!(
            record.disposition == RECEIPT_PENDING,
            StateError::WorkRecordNotPending
        );
        let completed = WorkRecord {
            subject: *subject,
            work_kind,
            disposition,
            worker,
            result_hash,
            completed_slot,
        };
        completed.validate_shape()?;
        *record = completed;
        self.validate_contents()?;
        Ok(())
    }
}

pub fn require_work_reservable(shot: &Shot, work_kind: u8) -> Result<()> {
    let eligible = match work_kind {
        WORK_KIND_ACTIVATE_ENTRY => {
            shot.entry_mode == ENTRY_FORWARD
                && shot.state == ShotState::PendingEntry as u8
                && shot.activation_worker == Pubkey::default()
        }
        WORK_KIND_RESOLVE_SHOT => {
            (shot.state == ShotState::PendingEntry as u8 || shot.state == ShotState::Active as u8)
                && shot.resolver == Pubkey::default()
        }
        WORK_KIND_FORFEIT => {
            (shot.state == ShotState::PendingEntry as u8
                || shot.state == ShotState::Active as u8
                || shot.state == ShotState::AwaitReveal as u8)
                && shot.forfeit_worker == Pubkey::default()
        }
        _ => return err!(StateError::InvalidWorkKind),
    };
    require!(eligible, StateError::WorkNotReservable);
    Ok(())
}

pub fn authenticate_work_page(
    page: &WorkPage,
    key: Pubkey,
    economy_hash: &[u8; 32],
    player: &Pubkey,
    page_index: u64,
) -> Result<()> {
    page.validate_contents()?;
    require!(
        page.economy_hash == *economy_hash
            && page.player == *player
            && page.page_index == page_index,
        StateError::InvalidWorkPage
    );
    let (expected, bump) = work_page_pda(economy_hash, player, page_index);
    require_keys_eq!(key, expected, StateError::WrongWorkPagePda);
    require!(page.bump == bump, StateError::WrongBump);
    Ok(())
}

pub fn completion_result_hash(
    shot_key: &Pubkey,
    work_kind: u8,
    terminal_hash: &[u8; 32],
    disposition: u8,
    worker: &Pubkey,
) -> [u8; 32] {
    hashv(&[
        COMPLETION_RESULT_HASH_DOMAIN,
        crate::ID.as_ref(),
        shot_key.as_ref(),
        &[work_kind],
        terminal_hash.as_ref(),
        &[disposition],
        worker.as_ref(),
    ])
    .to_bytes()
}

pub fn reload_route_memo(
    economy_hash: &[u8; 32],
    player: &Pubkey,
    nonce: u64,
    day: i64,
    day_final_hash: &[u8; 32],
    seat_index: u8,
    destination: &Pubkey,
    amount: u64,
) -> [u8; 32] {
    hashv(&[
        RELOAD_MEMO_DOMAIN,
        crate::ID.as_ref(),
        economy_hash.as_ref(),
        player.as_ref(),
        &nonce.to_le_bytes(),
        &day.to_le_bytes(),
        day_final_hash.as_ref(),
        &[seat_index],
        destination.as_ref(),
        &amount.to_le_bytes(),
    ])
    .to_bytes()
}

pub fn delegate_grant_pda(grant: &DelegateGrant) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            DELEGATE_GRANT_SEED,
            CORE_SCHEMA_SEED.as_ref(),
            grant.economy_hash.as_ref(),
            grant.ruleset_hash.as_ref(),
            grant.player.as_ref(),
            grant.delegate.as_ref(),
            grant.grant_id.as_ref(),
        ],
        &crate::ID,
    )
}

pub fn validate_delegate_grant(
    grant: &DelegateGrant,
    economy: &Economy,
    ruleset: &Ruleset,
) -> Result<()> {
    require!(
        grant.schema == CORE_SCHEMA_VERSION
            && grant.grant_id != [0; 16]
            && grant.economy_hash == economy.economy_hash
            && grant.ruleset_hash == ruleset.ruleset_hash
            && ruleset.args.economy_hash == economy.economy_hash
            && grant.player != Pubkey::default()
            && grant.delegate != Pubkey::default()
            && grant.delegate != grant.player
            && grant.max_stake >= economy.args.min_stake
            && grant.max_stake <= economy.args.max_stake
            && grant.max_gross_stake >= grant.max_stake
            && grant.max_shots > 0
            && grant.min_interval_seconds > 0
            && grant.expires_at_ts > 0
            && grant.shots_used <= grant.max_shots
            && grant.gross_stake_used <= grant.max_gross_stake
            && grant.revoked <= 1,
        StateError::InvalidDelegateGrant
    );
    require!(
        u128::from(grant.max_gross_stake)
            <= u128::from(grant.max_stake) * u128::from(grant.max_shots),
        StateError::InvalidDelegateGrant
    );
    if grant.shots_used == 0 {
        require!(
            grant.gross_stake_used == 0 && grant.last_seal_ts == 0,
            StateError::InvalidDelegateGrant
        );
    } else {
        require!(
            grant.gross_stake_used > 0 && grant.last_seal_ts > 0,
            StateError::InvalidDelegateGrant
        );
    }
    Ok(())
}

pub fn validate_new_delegate_grant(
    grant: &DelegateGrant,
    economy: &Economy,
    ruleset: &Ruleset,
    now: i64,
) -> Result<()> {
    validate_delegate_grant(grant, economy, ruleset)?;
    let maximum_expiry = now
        .checked_add(MAX_DELEGATE_LIFETIME_SECONDS)
        .ok_or(StateError::TimestampOverflow)?;
    require!(
        grant.revoked == 0
            && grant.shots_used == 0
            && grant.gross_stake_used == 0
            && grant.last_seal_ts == 0
            && now < grant.expires_at_ts
            && grant.expires_at_ts <= maximum_expiry,
        StateError::InvalidDelegateGrant
    );
    Ok(())
}

pub fn authenticate_delegate_grant(
    grant: &DelegateGrant,
    key: Pubkey,
    economy: &Economy,
    ruleset: &Ruleset,
) -> Result<()> {
    validate_delegate_grant(grant, economy, ruleset)?;
    let (expected, bump) = delegate_grant_pda(grant);
    require_keys_eq!(key, expected, StateError::WrongDelegateGrantPda);
    require!(grant.bump == bump, StateError::WrongBump);
    Ok(())
}

pub fn consume_delegate_grant(
    grant: &mut DelegateGrant,
    economy: &Economy,
    ruleset: &Ruleset,
    now: i64,
    stake: u64,
) -> Result<()> {
    validate_delegate_grant(grant, economy, ruleset)?;
    require!(grant.revoked == 0, StateError::DelegateRevoked);
    require!(now < grant.expires_at_ts, StateError::DelegateExpired);
    require!(
        stake >= economy.args.min_stake && stake <= grant.max_stake,
        StateError::DelegateStakeExceeded
    );
    require!(
        grant.shots_used < grant.max_shots,
        StateError::DelegateShotLimit
    );
    let next_gross = grant
        .gross_stake_used
        .checked_add(stake)
        .ok_or(StateError::MathOverflow)?;
    require!(
        next_gross <= grant.max_gross_stake,
        StateError::DelegateGrossLimit
    );
    if grant.shots_used > 0 {
        let next_allowed = grant
            .last_seal_ts
            .checked_add(i64::from(grant.min_interval_seconds))
            .ok_or(StateError::TimestampOverflow)?;
        require!(now >= next_allowed, StateError::DelegateTooSoon);
    }
    grant.gross_stake_used = next_gross;
    grant.shots_used = grant
        .shots_used
        .checked_add(1)
        .ok_or(StateError::MathOverflow)?;
    grant.last_seal_ts = now;
    Ok(())
}

pub fn revoke_delegate_grant(grant: &mut DelegateGrant) {
    grant.revoked = 1;
}

/// The permanent ledger is the replay tombstone for the one migration claim.
/// A separate per-player claim PDA would duplicate these immutable counters.
pub fn require_legacy_claim_available(ledger: &PlayerLedger, credits: u64, xp: u64) -> Result<()> {
    require!(credits > 0 || xp > 0, StateError::EmptyLegacyClaim);
    require!(
        ledger.legacy_credits == 0 && ledger.legacy_xp == 0,
        StateError::LegacyAlreadyClaimed
    );
    Ok(())
}

pub fn utc_day(timestamp: i64) -> i64 {
    timestamp.div_euclid(i64::from(DAY_SECONDS))
}

pub fn rank_shard_for(player: &Pubkey) -> u8 {
    hashv(&[RANK_SHARD_FOR_DOMAIN, player.as_ref()]).to_bytes()[0] % RANK_SHARD_COUNT
}

pub fn rank_entry_precedes(left: &RankEntry, right: &RankEntry) -> bool {
    let left_empty = left.wallet == Pubkey::default();
    let right_empty = right.wallet == Pubkey::default();
    if left_empty {
        return false;
    }
    if right_empty {
        return true;
    }
    if left.xp != right.xp {
        return left.xp > right.xp;
    }
    left.wallet.to_bytes() < right.wallet.to_bytes()
}

fn merge_rank_candidate(
    candidates: &mut [RankEntry; PODIUM_SEAT_COUNT + 1],
    count: &mut usize,
    candidate: RankEntry,
) {
    if candidate.wallet == Pubkey::default() {
        return;
    }
    for current in candidates.iter_mut().take(*count) {
        if current.wallet == candidate.wallet {
            current.xp = current.xp.max(candidate.xp);
            return;
        }
    }
    candidates[*count] = candidate;
    *count += 1;
}

pub fn upsert_local_top3(
    top: &mut [RankEntry; PODIUM_SEAT_COUNT],
    candidate: RankEntry,
) -> Result<()> {
    require!(
        candidate.wallet != Pubkey::default() && candidate.xp > 0,
        StateError::InvalidRankEntry
    );
    let mut candidates = [RankEntry::default(); PODIUM_SEAT_COUNT + 1];
    let mut count = 0usize;
    for current in top.iter().copied() {
        merge_rank_candidate(&mut candidates, &mut count, current);
    }
    merge_rank_candidate(&mut candidates, &mut count, candidate);
    for index in 1..count {
        let mut cursor = index;
        while cursor > 0 && rank_entry_precedes(&candidates[cursor], &candidates[cursor - 1]) {
            candidates.swap(cursor, cursor - 1);
            cursor -= 1;
        }
    }
    *top = [RankEntry::default(); PODIUM_SEAT_COUNT];
    let retained = count.min(PODIUM_SEAT_COUNT);
    top[..retained].copy_from_slice(&candidates[..retained]);
    Ok(())
}

pub fn merge_top3(
    target: &mut [RankEntry; PODIUM_SEAT_COUNT],
    source: &[RankEntry; PODIUM_SEAT_COUNT],
) -> Result<()> {
    for candidate in source.iter().copied() {
        if candidate.wallet != Pubkey::default() {
            upsert_local_top3(target, candidate)?;
        }
    }
    Ok(())
}

pub fn fold_global_top3(
    shards: &[[RankEntry; PODIUM_SEAT_COUNT]; RANK_SHARD_COUNT_USIZE],
) -> Result<[RankEntry; PODIUM_SEAT_COUNT]> {
    let mut top = [RankEntry::default(); PODIUM_SEAT_COUNT];
    for shard in shards {
        merge_top3(&mut top, shard)?;
    }
    Ok(top)
}

fn append_top_bytes(canonical: &mut Vec<u8>, top: &[RankEntry; PODIUM_SEAT_COUNT]) {
    for entry in top {
        canonical.extend_from_slice(entry.wallet.as_ref());
        canonical.extend_from_slice(&entry.xp.to_le_bytes());
    }
}

pub fn rank_shard_digest(shard: &RankShard) -> Result<[u8; 32]> {
    require!(
        shard.schema == CORE_SCHEMA_VERSION
            && shard.shard < RANK_SHARD_COUNT
            && shard.terminal <= shard.accepted,
        StateError::InvalidRankShard
    );
    let mut previous: Option<RankEntry> = None;
    let mut seen_empty = false;
    for entry in shard.top {
        if entry.wallet == Pubkey::default() {
            require!(entry.xp == 0, StateError::InvalidRankEntry);
            seen_empty = true;
            continue;
        }
        require!(!seen_empty && entry.xp > 0, StateError::InvalidRankEntry);
        require!(
            rank_shard_for(&entry.wallet) == shard.shard,
            StateError::InvalidRankShard
        );
        if let Some(prior) = previous {
            require!(
                prior.wallet != entry.wallet && rank_entry_precedes(&prior, &entry),
                StateError::InvalidRankEntry
            );
        }
        previous = Some(entry);
    }
    let mut canonical = Vec::with_capacity(2 + 32 + 8 + 1 + 8 + 8 + 3 * RankEntry::LEN);
    canonical.extend_from_slice(&shard.schema.to_le_bytes());
    canonical.extend_from_slice(shard.economy_hash.as_ref());
    canonical.extend_from_slice(&shard.day.to_le_bytes());
    canonical.push(shard.shard);
    canonical.extend_from_slice(&shard.accepted.to_le_bytes());
    canonical.extend_from_slice(&shard.terminal.to_le_bytes());
    append_top_bytes(&mut canonical, &shard.top);
    Ok(hashv(&[RANK_SHARD_HASH_DOMAIN, canonical.as_ref()]).to_bytes())
}

pub fn shards_digest(
    economy_hash: &[u8; 32],
    day: i64,
    shard_hashes: &[[u8; 32]; RANK_SHARD_COUNT_USIZE],
) -> [u8; 32] {
    let mut canonical =
        Vec::with_capacity(2 + 32 + 8 + RANK_SHARD_COUNT_USIZE * core::mem::size_of::<[u8; 32]>());
    canonical.extend_from_slice(CORE_SCHEMA_SEED.as_ref());
    canonical.extend_from_slice(economy_hash);
    canonical.extend_from_slice(&day.to_le_bytes());
    for shard_hash in shard_hashes {
        canonical.extend_from_slice(shard_hash);
    }
    hashv(&[RANK_SHARDS_HASH_DOMAIN, canonical.as_ref()]).to_bytes()
}

pub fn day_final_hash(
    economy_hash: &[u8; 32],
    day: i64,
    accepted: u64,
    terminal: u64,
    top: &[RankEntry; PODIUM_SEAT_COUNT],
    shards_hash: &[u8; 32],
) -> [u8; 32] {
    let mut canonical = Vec::with_capacity(2 + 32 + 8 + 8 + 8 + 3 * RankEntry::LEN + 32);
    canonical.extend_from_slice(CORE_SCHEMA_SEED.as_ref());
    canonical.extend_from_slice(economy_hash);
    canonical.extend_from_slice(&day.to_le_bytes());
    canonical.extend_from_slice(&accepted.to_le_bytes());
    canonical.extend_from_slice(&terminal.to_le_bytes());
    append_top_bytes(&mut canonical, top);
    canonical.extend_from_slice(shards_hash);
    hashv(&[DAY_FINAL_HASH_DOMAIN, canonical.as_ref()]).to_bytes()
}

pub fn podium_allocation(gross: u64) -> PodiumAllocation {
    let base_burn = (u128::from(gross) * u128::from(BURN_PER_MILLE) / u128::from(PER_MILLE)) as u64;
    let pool = gross - base_burn;
    let mut shares = [0u64; PODIUM_SEAT_COUNT];
    let mut distributed = 0u64;
    for (index, curve) in PODIUM_CURVE.iter().copied().enumerate() {
        shares[index] = (u128::from(pool) * u128::from(curve) / u128::from(PER_MILLE)) as u64;
        distributed += shares[index];
    }
    PodiumAllocation {
        base_burn,
        pool,
        shares,
        dust: pool - distributed,
    }
}

pub fn podium_actions(
    player: &Pubkey,
    seats: &[Pubkey; PODIUM_SEAT_COUNT],
) -> [u8; PODIUM_SEAT_COUNT] {
    let mut actions = [RELOAD_ACTION_NONE; PODIUM_SEAT_COUNT];
    for (index, seat) in seats.iter().enumerate() {
        let duplicate = seats[..index].iter().any(|prior| prior == seat);
        actions[index] = if *seat == Pubkey::default() || duplicate {
            RELOAD_ACTION_BURN
        } else if seat == player {
            RELOAD_ACTION_RETAIN
        } else {
            RELOAD_ACTION_ROUTE
        };
    }
    actions
}

pub fn require_reload_conservation(
    gross: u64,
    consumed: u64,
    raw_burned: u64,
    raw_routed: u64,
    raw_retained: u64,
) -> Result<()> {
    let gross_accounted = u128::from(consumed)
        .checked_add(u128::from(raw_retained))
        .ok_or(StateError::MathOverflow)?;
    let consumed_accounted = u128::from(raw_burned)
        .checked_add(u128::from(raw_routed))
        .ok_or(StateError::MathOverflow)?;
    require!(
        gross_accounted == u128::from(gross) && consumed_accounted == u128::from(consumed),
        StateError::ReloadConservationBroken
    );
    Ok(())
}

pub fn product_leq_u128_u32(
    left_value: u128,
    left_factor: u32,
    right_value: u128,
    right_factor: u32,
) -> bool {
    wide_mul_u128_u32(left_value, left_factor) <= wide_mul_u128_u32(right_value, right_factor)
}

fn wide_mul_u128_u32(value: u128, factor: u32) -> (u64, u128) {
    const LOW_MASK: u128 = u64::MAX as u128;
    let low = value & LOW_MASK;
    let high = value >> 64;
    let low_product = low * u128::from(factor);
    let middle = high * u128::from(factor) + (low_product >> 64);
    let upper = (middle >> 64) as u64;
    let lower = (middle << 64) | (low_product & LOW_MASK);
    (upper, lower)
}

pub fn terminal_xp_reserve(xp_base: u64, settle_xp: u64) -> Result<u64> {
    xp_base
        .checked_add(settle_xp)
        .ok_or(error!(StateError::MathOverflow))
}

pub fn scale_conf_to_e12(value: u64, exponent: i32) -> Result<u128> {
    require!(
        (i32::from(CORE_MIN_EXPONENT)..=i32::from(CORE_MAX_EXPONENT)).contains(&exponent),
        StateError::BadExponent
    );
    let power: u32 = (12 + exponent)
        .try_into()
        .map_err(|_| error!(StateError::BadExponent))?;
    let factor = 10u128.checked_pow(power).ok_or(StateError::MathOverflow)?;
    u128::from(value)
        .checked_mul(factor)
        .ok_or(error!(StateError::MathOverflow))
}

pub fn seal_xp(base_xp: u64, stake: u64) -> u64 {
    if stake >= XP_CAP_STAKE {
        return base_xp.saturating_mul(XP_MULT_CAP).max(1);
    }
    let square = base_xp.saturating_mul(base_xp).saturating_mul(stake);
    let root = isqrt(square);
    ((root / 5 + 1) / 2).max(1)
}

#[deprecated(
    note = "streak-dependent XP is non-consensus; terminal economics use xp_base + settle_xp"
)]
pub fn skill_xp(xp_base: u64, streak: u32) -> u64 {
    let multiplier = (100 + STREAK_STEP_C.saturating_mul(u64::from(streak))).min(STREAK_CAP_C);
    ((xp_base.saturating_mul(multiplier) + 50) / 100).max(1)
}

pub fn isqrt(n: u64) -> u64 {
    if n < 2 {
        return n;
    }
    let mut low = 1u64;
    let mut high = n.min(u32::MAX as u64 + 1);
    while low + 1 < high {
        let middle = low + (high - low) / 2;
        if middle <= n / middle {
            low = middle;
        } else {
            high = middle;
        }
    }
    low
}

#[error_code]
pub enum StateError {
    #[msg("schema version is not Core G2")]
    WrongSchema,
    #[msg("Timepin schema does not match Core G2")]
    WrongTimepinSchema,
    #[msg("cluster genesis hash is missing")]
    MissingClusterIdentity,
    #[msg("migration id is missing")]
    MissingMigrationIdentity,
    #[msg("economy omits its immutable allowed-ruleset root")]
    MissingRulesetRoot,
    #[msg("legacy root, snapshot hash and cutover slot are inconsistent")]
    BadLegacySnapshot,
    #[msg("required program id is missing")]
    MissingProgram,
    #[msg("RCX mint, token program, decimals or raw-unit ratio differs from frozen policy")]
    WrongFrozenRcxPolicy,
    #[msg("burn, podium, curve, shard or UTC-day settings differ from frozen policy")]
    WrongFrozenRankingPolicy,
    #[msg("payout ratio is outside the hard safety envelope")]
    BadPayout,
    #[msg("settlement XP exceeds the hard safety envelope")]
    BadSettleXp,
    #[msg("stake bounds are invalid")]
    BadStakeBounds,
    #[msg("maximum open position count is invalid")]
    BadMaxOpen,
    #[msg("cleanup bond is outside the frozen liveness bounds")]
    BadCleanupBond,
    #[msg("reveal window is invalid")]
    BadRevealWindow,
    #[msg("horizon is invalid")]
    BadHorizon,
    #[msg("ruleset references another economy")]
    WrongEconomy,
    #[msg("ruleset omits its EvidenceSpec")]
    MissingEvidenceSpec,
    #[msg("ruleset omits its feed")]
    MissingFeed,
    #[msg("entry mode is invalid")]
    BadEntryMode,
    #[msg("target grid is invalid")]
    BadGrid,
    #[msg("minimum opening lead is invalid")]
    BadOpenLead,
    #[msg("forward horizon is not a whole target-grid interval")]
    UnalignedHorizon,
    #[msg("observed-entry age policy is invalid")]
    BadEntryAge,
    #[msg("confidence band ratio is invalid")]
    BadBand,
    #[msg("base XP must be positive")]
    BadBaseXp,
    #[msg("ruleset policy is not a member of the economy's immutable root")]
    RulesetNotAllowed,
    #[msg("ledger sources, available, locked and retired credits do not conserve")]
    LedgerConservationBroken,
    #[msg("RCX raw input does not equal burned plus routed units")]
    RcxConservationBroken,
    #[msg("sealed/open/terminal shot counters do not conserve")]
    ShotConservationBroken,
    #[msg("reload gross/consumed/burned/routed/retained units do not conserve")]
    ReloadConservationBroken,
    #[msg("rank entry is empty, duplicated or out of canonical order")]
    InvalidRankEntry,
    #[msg("rank shard identity, counters or members are invalid")]
    InvalidRankShard,
    #[msg("canonical bytes have an unexpected length")]
    WrongCanonicalLength,
    #[msg("canonical serialization failed")]
    SerializationFailed,
    #[msg("economy hash is not canonical")]
    WrongEconomyHash,
    #[msg("ruleset hash is not canonical")]
    WrongRulesetHash,
    #[msg("economy PDA is not canonical")]
    WrongEconomyPda,
    #[msg("ruleset PDA is not canonical")]
    WrongRulesetPda,
    #[msg("shot PDA is not canonical")]
    WrongShotPda,
    #[msg("shot resolution or terminal hash is not canonical")]
    WrongShotHash,
    #[msg("shot is not terminal")]
    ShotNotTerminal,
    #[msg("terminal shot fields are inconsistent")]
    InvalidTerminalShape,
    #[msg("history page fields or slots are inconsistent")]
    InvalidHistoryPage,
    #[msg("history page PDA is not canonical")]
    WrongHistoryPagePda,
    #[msg("history page already contains sixteen accepted shots")]
    HistoryPageFull,
    #[msg("history placeholders must be appended in nonce order")]
    HistoryAppendOutOfOrder,
    #[msg("history slot was never appended at seal")]
    HistorySlotMissing,
    #[msg("history slot is already terminal")]
    HistorySlotAlreadyTerminal,
    #[msg("compact result facts are inconsistent with the terminal state")]
    InvalidGameResultFacts,
    #[msg("compact result game hash is not canonical")]
    WrongGameResultHash,
    #[msg("work page fields or records are inconsistent")]
    InvalidWorkPage,
    #[msg("work page PDA is not canonical")]
    WrongWorkPagePda,
    #[msg("work page already contains all forty-eight possible records")]
    WorkPageFull,
    #[msg("work record fields are inconsistent")]
    InvalidWorkRecord,
    #[msg("work record disposition is invalid")]
    InvalidWorkDisposition,
    #[msg("work page contains the same subject and kind more than once")]
    DuplicateWorkRecord,
    #[msg("work record subject is not a live shot in this page")]
    InvalidWorkSubject,
    #[msg("work kind cannot be reserved at the shot's current stage")]
    WorkNotReservable,
    #[msg("work record index does not contain the requested subject and kind")]
    WrongWorkRecordIndex,
    #[msg("work record does not exist")]
    WorkRecordMissing,
    #[msg("work record is already terminal")]
    WorkRecordNotPending,
    #[msg("completion work kind is unsupported")]
    InvalidWorkKind,
    #[msg("delegate request id must contain between one and 128 bytes")]
    InvalidDelegateRequestId,
    #[msg("delegate grant fields or counters are inconsistent")]
    InvalidDelegateGrant,
    #[msg("delegate grant PDA is not canonical")]
    WrongDelegateGrantPda,
    #[msg("delegate grant is revoked")]
    DelegateRevoked,
    #[msg("delegate grant is expired")]
    DelegateExpired,
    #[msg("delegated stake exceeds the grant")]
    DelegateStakeExceeded,
    #[msg("delegated shot count is exhausted")]
    DelegateShotLimit,
    #[msg("delegated gross stake is exhausted")]
    DelegateGrossLimit,
    #[msg("delegated seals are too close together")]
    DelegateTooSoon,
    #[msg("delegate request receipt fields are inconsistent")]
    InvalidDelegateRequest,
    #[msg("delegate request receipt PDA is not canonical")]
    WrongDelegateRequestPda,
    #[msg("stored PDA bump is not canonical")]
    WrongBump,
    #[msg("Merkle proof exceeds the frozen maximum depth")]
    MerkleProofTooLong,
    #[msg("timestamp calculation overflowed")]
    TimestampOverflow,
    #[msg("integer calculation overflowed")]
    MathOverflow,
    #[msg("price exponent is outside the Timepin v2 safety envelope")]
    BadExponent,
    #[msg("revealed side is invalid")]
    BadSide,
    #[msg("stated probability must be strictly between 0 and 10000 bps")]
    BadProbability,
    #[msg("packed reload record fields are inconsistent")]
    InvalidReloadRecord,
    #[msg("reload history page identity or records are inconsistent")]
    InvalidReloadHistoryPage,
    #[msg("reload history page PDA is not canonical")]
    WrongReloadHistoryPagePda,
    #[msg("reload history page already contains thirty-two reloads")]
    ReloadHistoryPageFull,
    #[msg("reload records must be appended in canonical nonce order")]
    ReloadAppendOutOfOrder,
    #[msg("legacy migration was already claimed into the permanent ledger")]
    LegacyAlreadyClaimed,
    #[msg("legacy migration claim must add credits or XP")]
    EmptyLegacyClaim,
    #[msg("ruleset omits its generation-independent Timepin evidence policy")]
    MissingEvidencePolicy,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frozen_economy_args() -> EconomyArgs {
        EconomyArgs {
            schema: CORE_SCHEMA_VERSION,
            timepin_program: Pubkey::new_from_array([7; 32]),
            timepin_schema: TIMEPIN_SCHEMA_VERSION,
            cluster_genesis_hash: [5; 32],
            migration_id: [4; 32],
            legacy_root: [8; 32],
            legacy_snapshot_hash: [6; 32],
            legacy_cutover_slot: 123,
            legacy_leaf_count: 2,
            legacy_total_credits: 1_000,
            legacy_total_xp: 500,
            ruleset_policy_root: [9; 32],
            ruleset_policy_count: 1,
            rcx_mint: crate::RCX_MINT,
            rcx_token_program: token_2022::ID,
            rcx_decimals: crate::RCX_DECIMALS,
            raw_units_per_credit: crate::RCX_RAW_UNITS_PER_CREDIT,
            burn_per_mille: BURN_PER_MILLE,
            podium_per_mille: PODIUM_PER_MILLE,
            podium_curve: PODIUM_CURVE,
            rank_shard_count: RANK_SHARD_COUNT,
            day_seconds: DAY_SECONDS,
            hit_payout_num: 185,
            hit_payout_den: 100,
            settle_xp: 2,
            min_stake: 100,
            max_stake: 100_000,
            max_open: 5,
            cleanup_bond_lamports: MIN_CLEANUP_BOND_LAMPORTS,
            reveal_window_seconds: 900,
            max_horizon_seconds: 86_400,
        }
    }

    fn wallet_for_shard(shard: u8, marker: u8) -> Pubkey {
        assert!(shard < RANK_SHARD_COUNT);
        for nonce in 1..=u32::MAX {
            let mut bytes = [marker; 32];
            bytes[..4].copy_from_slice(&nonce.to_le_bytes());
            let wallet = Pubkey::new_from_array(bytes);
            if wallet != Pubkey::default() && rank_shard_for(&wallet) == shard {
                return wallet;
            }
        }
        unreachable!("all shard preimages exhausted")
    }

    fn serialized_len<T: AnchorSerialize>(value: &T) -> usize {
        let mut bytes = Vec::new();
        value.serialize(&mut bytes).unwrap();
        bytes.len()
    }

    fn test_economy_and_ruleset() -> (Economy, Ruleset) {
        let economy_args = frozen_economy_args();
        let economy_hash = economy_hash(&economy_args).unwrap();
        let economy = Economy {
            schema: CORE_SCHEMA_VERSION,
            bump: 1,
            economy_hash,
            args: economy_args,
        };
        let ruleset_args = RulesetArgs {
            schema: CORE_SCHEMA_VERSION,
            economy_hash,
            evidence_spec_hash: [2; 32],
            evidence_policy_hash: [4; 32],
            feed_id: [3; 32],
            entry_mode: ENTRY_FORWARD,
            horizon_seconds: 600,
            target_grid_seconds: 600,
            min_open_lead_seconds: 30,
            max_entry_age_seconds: 0,
            band_numerator: 0,
            band_denominator: 1,
            base_xp: 10,
        };
        let ruleset = Ruleset {
            schema: CORE_SCHEMA_VERSION,
            bump: 1,
            ruleset_hash: ruleset_hash(&ruleset_args).unwrap(),
            args: ruleset_args,
        };
        (economy, ruleset)
    }

    fn terminal_shot(state: ShotState, player: Pubkey, nonce: u64) -> (Pubkey, Shot) {
        let economy_hash = [11; 32];
        let ruleset_hash = [12; 32];
        let (shot_key, bump) = Pubkey::find_program_address(
            &[
                SHOT_SEED,
                economy_hash.as_ref(),
                player.as_ref(),
                &nonce.to_le_bytes(),
            ],
            &crate::ID,
        );
        let mut shot = Shot {
            schema: CORE_SCHEMA_VERSION,
            bump,
            economy_hash,
            ruleset_hash,
            player,
            rent_refund: Pubkey::new_from_array([13; 32]),
            delegate: Pubkey::new_from_array([14; 32]),
            nonce,
            commit: [0; 32],
            entry_mode: ENTRY_FORWARD,
            state: state as u8,
            void_reason: VoidReason::None as u8,
            stake: 100,
            cleanup_bond_lamports: MIN_CLEANUP_BOND_LAMPORTS,
            xp_base: 20,
            sealed_ts: 100,
            entry_target_ts: 120,
            exit_target_ts: 180,
            score_day: 0,
            rank_shard: rank_shard_for(&player),
            entry_need: Pubkey::new_from_array([15; 32]),
            exit_need: Pubkey::new_from_array([16; 32]),
            activation_worker: Pubkey::new_from_array([17; 32]),
            activation_slot: 10,
            activation_ts: 121,
            entry_message_hash: [18; 32],
            entry_timepin_result_hash: [24; 32],
            entry_price: 100,
            entry_conf: 1,
            entry_exponent: -8,
            entry_publish_time: 120,
            exit_message_hash: [19; 32],
            exit_timepin_result_hash: [25; 32],
            exit_price: 110,
            exit_conf: 1,
            exit_exponent: -8,
            exit_publish_time: 180,
            outcome_yes: 1,
            settled_ts: 181,
            resolution_slot: 20,
            reveal_deadline_ts: 240,
            side: 1,
            p_bps: 8_000,
            hit: 1,
            xp_awarded: 22,
            resolver: Pubkey::new_from_array([20; 32]),
            forfeit_worker: Pubkey::default(),
            terminal_slot: 30,
            terminal_ts: 200,
            revealed_salt: [21; 32],
            resolution_hash: [0; 32],
            terminal_hash: [0; 32],
        };
        match state {
            ShotState::Revealed => {}
            ShotState::Voided => {
                shot.void_reason = VoidReason::Equality as u8;
                shot.side = 0;
                shot.p_bps = 0;
                shot.hit = 0;
                shot.xp_awarded = 0;
                shot.revealed_salt = [0; 32];
            }
            ShotState::Forfeited => {
                shot.side = 0;
                shot.p_bps = 0;
                shot.hit = 0;
                shot.xp_awarded = 0;
                shot.forfeit_worker = Pubkey::new_from_array([22; 32]);
                shot.revealed_salt = [0; 32];
            }
            _ => {}
        }
        if state == ShotState::Revealed {
            shot.commit = commitment_hash(
                &shot.economy_hash,
                &shot.ruleset_hash,
                &shot.player,
                shot.nonce,
                shot.side,
                shot.p_bps,
                &shot.revealed_salt,
            );
        } else {
            shot.commit = [23; 32];
        }
        shot.resolution_hash = resolution_hash(&shot_key, &shot);
        shot.terminal_hash = terminal_hash(&shot_key, &shot);
        (shot_key, shot)
    }

    fn delegate_grant(economy: &Economy, ruleset: &Ruleset, expires_at_ts: i64) -> DelegateGrant {
        DelegateGrant {
            schema: CORE_SCHEMA_VERSION,
            bump: 0,
            grant_id: [1; 16],
            economy_hash: economy.economy_hash,
            ruleset_hash: ruleset.ruleset_hash,
            player: Pubkey::new_from_array([31; 32]),
            delegate: Pubkey::new_from_array([32; 32]),
            max_stake: 500,
            max_gross_stake: 1_000,
            max_shots: 2,
            min_interval_seconds: 10,
            expires_at_ts,
            gross_stake_used: 0,
            shots_used: 0,
            last_seal_ts: 0,
            revoked: 0,
        }
    }

    #[test]
    fn frozen_lengths_match_borsh() {
        let args = frozen_economy_args();
        let mut economy_bytes = Vec::new();
        args.serialize(&mut economy_bytes).unwrap();
        assert_eq!(economy_bytes.len(), EconomyArgs::LEN);
        assert!(validate_economy(&args).is_ok());
        let rules = RulesetArgs {
            schema: CORE_SCHEMA_VERSION,
            economy_hash: [1; 32],
            evidence_spec_hash: [2; 32],
            evidence_policy_hash: [4; 32],
            feed_id: [3; 32],
            entry_mode: ENTRY_FORWARD,
            horizon_seconds: 600,
            target_grid_seconds: 600,
            min_open_lead_seconds: 30,
            max_entry_age_seconds: 0,
            band_numerator: 0,
            band_denominator: 1,
            base_xp: 10,
        };
        let mut ruleset_bytes = Vec::new();
        rules.serialize(&mut ruleset_bytes).unwrap();
        assert_eq!(ruleset_bytes.len(), RulesetArgs::LEN);
        let mut rank_entry_bytes = Vec::new();
        RankEntry::default()
            .serialize(&mut rank_entry_bytes)
            .unwrap();
        let mut podium_bytes = Vec::new();
        PodiumAllocation::default()
            .serialize(&mut podium_bytes)
            .unwrap();
        assert_eq!(rank_entry_bytes.len(), RankEntry::LEN);
        assert_eq!(podium_bytes.len(), PodiumAllocation::LEN);

        assert_eq!(
            serialized_len(&Economy {
                schema: CORE_SCHEMA_VERSION,
                bump: 1,
                economy_hash: [1; 32],
                args,
            }),
            Economy::LEN
        );
        assert_eq!(
            serialized_len(&Ruleset {
                schema: CORE_SCHEMA_VERSION,
                bump: 1,
                ruleset_hash: [2; 32],
                args: rules,
            }),
            Ruleset::LEN
        );
        assert_eq!(serialized_len(&PlayerLedger::default()), PlayerLedger::LEN);
        assert_eq!(serialized_len(&Shot::default()), Shot::LEN);
        assert_eq!(serialized_len(&ShotResult::default()), ShotResult::LEN);
        assert_eq!(
            serialized_len(&GameResultFacts::default()),
            GameResultFacts::LEN
        );
        assert_eq!(
            serialized_len(&HistoryPage::default()),
            HistoryPage::BASE_LEN
        );
        assert_eq!(serialized_len(&WorkRecord::default()), WorkRecord::LEN);
        assert_eq!(serialized_len(&WorkPage::default()), WorkPage::BASE_LEN);
        assert_eq!(
            serialized_len(&DelegateGrant::default()),
            DelegateGrant::LEN
        );
        assert_eq!(serialized_len(&ReloadRecord::default()), ReloadRecord::LEN);
        assert_eq!(
            serialized_len(&ReloadHistoryPage::default()),
            ReloadHistoryPage::BASE_LEN
        );
        assert_eq!(serialized_len(&PlayerDay::default()), PlayerDay::LEN);
        assert_eq!(serialized_len(&RankShard::default()), RankShard::LEN);
        assert_eq!(serialized_len(&DayFinal::default()), DayFinal::LEN);
        assert_eq!(EconomyArgs::LEN, 372);
        assert_eq!(Economy::LEN, 407);
        assert_eq!(RulesetArgs::LEN, 163);
        assert_eq!(Ruleset::LEN, 198);
        assert_eq!(PlayerLedger::LEN, 277);
        assert_eq!(Shot::LEN, 772);
        assert_eq!(ShotResult::LEN, 165);
        assert_eq!(GameResultFacts::LEN, 82);
        // M3: the page is a FIXED 110 bytes. BASE_LEN and MAX_LEN are kept as
        // aliases of LEN so callers do not all have to change at once, and
        // pinning all three to the SAME number is the ABI statement - a page
        // whose base and max ever differ again is a page that grows.
        assert_eq!(HistoryPage::LEN, 110);
        assert_eq!(HistoryPage::BASE_LEN, HistoryPage::LEN);
        assert_eq!(HistoryPage::MAX_LEN, HistoryPage::LEN);
        assert_eq!(HistoryPage::max_serialized_len(), HistoryPage::LEN);
        // ...and the length does not move with the contents, which is the whole
        // change. serialized_len_for still validates its arguments; it just no
        // longer computes a size from them.
        assert_eq!(HistoryPage::serialized_len_for(0, 0).unwrap(), HistoryPage::LEN);
        assert_eq!(
            HistoryPage::serialized_len_for(HISTORY_PAGE_CAP, HISTORY_PAGE_CAP).unwrap(),
            HistoryPage::LEN
        );
        assert!(HistoryPage::serialized_len_for(HISTORY_PAGE_CAP + 1, 0).is_err());
        assert!(HistoryPage::serialized_len_for(1, 2).is_err());
        assert_eq!(WorkRecord::LEN, 106);
        assert_eq!(WorkPage::BASE_LEN, 79);
        assert_eq!(WorkPage::MAX_LEN, 5_167);
        assert_eq!(WorkPage::max_serialized_len(), 5_167);
        assert_eq!(WORK_PAGE_VEC_LENGTH_OFFSET, 83);
        assert_eq!(WORK_PAGE_RECORDS_OFFSET, 87);
        assert_eq!(DelegateGrant::LEN, 196);
        assert_eq!(ReloadRecord::LEN, 51);
        assert_eq!(ReloadHistoryPage::BASE_LEN, 79);
        assert_eq!(ReloadHistoryPage::MAX_LEN, 1_711);
        assert_eq!(ReloadHistoryPage::max_serialized_len(), 1_711);
        assert_eq!(RELOAD_HISTORY_PAGE_CAP, 32);
        assert_eq!(PlayerDay::LEN, 132);
        assert_eq!(RankEntry::LEN, 40);
        assert_eq!(RankShard::LEN, 180);
        assert_eq!(DayFinal::LEN, 291);
        assert_eq!(PodiumAllocation::LEN, 48);
    }

    #[test]
    fn frozen_economy_policy_is_exact() {
        let valid = frozen_economy_args();
        assert!(validate_economy(&valid).is_ok());

        let mut args = valid;
        args.cluster_genesis_hash = [0; 32];
        assert!(validate_economy(&args).is_err());
        args = valid;
        args.migration_id = [0; 32];
        assert!(validate_economy(&args).is_err());

        args = valid;
        args.legacy_snapshot_hash = [0; 32];
        assert!(validate_economy(&args).is_err());
        args = valid;
        args.legacy_root = [0; 32];
        assert!(validate_economy(&args).is_err());

        args = valid;
        args.rcx_mint = Pubkey::default();
        assert!(validate_economy(&args).is_err());
        args = valid;
        args.rcx_token_program = Pubkey::default();
        assert!(validate_economy(&args).is_err());
        args = valid;
        args.rcx_decimals = args.rcx_decimals.wrapping_add(1);
        assert!(validate_economy(&args).is_err());
        args = valid;
        args.raw_units_per_credit = args.raw_units_per_credit.saturating_add(1);
        assert!(validate_economy(&args).is_err());

        args = valid;
        args.burn_per_mille -= 1;
        assert!(validate_economy(&args).is_err());
        args = valid;
        args.podium_per_mille -= 1;
        assert!(validate_economy(&args).is_err());
        args = valid;
        args.podium_curve = [501, 299, 200];
        assert!(validate_economy(&args).is_err());
        args = valid;
        args.rank_shard_count -= 1;
        assert!(validate_economy(&args).is_err());
        args = valid;
        args.day_seconds -= 1;
        assert!(validate_economy(&args).is_err());
        args = valid;
        args.cleanup_bond_lamports = MIN_CLEANUP_BOND_LAMPORTS - 1;
        assert!(validate_economy(&args).is_err());
        args = valid;
        args.cleanup_bond_lamports = MAX_CLEANUP_BOND_LAMPORTS + 1;
        assert!(validate_economy(&args).is_err());
    }

    #[test]
    fn ruleset_policy_allows_new_exact_generation_but_not_changed_quality() {
        let (mut economy, ruleset) = test_economy_and_ruleset();
        let baseline = ruleset.args;
        let policy_leaf = ruleset_policy_hash(&baseline).unwrap();
        economy.args.ruleset_policy_root = policy_leaf;
        assert!(require_ruleset_allowed(&baseline, &economy, &[]).is_ok());

        let mut next_generation = baseline;
        next_generation.evidence_spec_hash = [0x55; 32];
        assert_eq!(ruleset_policy_hash(&next_generation).unwrap(), policy_leaf);
        assert_ne!(
            ruleset_hash(&next_generation).unwrap(),
            ruleset_hash(&baseline).unwrap()
        );
        assert!(require_ruleset_allowed(&next_generation, &economy, &[]).is_ok());

        let mut weakened_or_changed_policy = next_generation;
        weakened_or_changed_policy.evidence_policy_hash[0] ^= 1;
        assert_ne!(
            ruleset_policy_hash(&weakened_or_changed_policy).unwrap(),
            policy_leaf
        );
        assert!(require_ruleset_allowed(&weakened_or_changed_policy, &economy, &[]).is_err());
    }

    #[test]
    fn merkle_domains_commit_to_cluster_migration_snapshot_cutover_and_node_kind() {
        let player = Pubkey::new_from_array([4; 32]);
        let cluster = [3; 32];
        let migration = [5; 32];
        let a = legacy_leaf(&cluster, &migration, &[1; 32], 42, &player, 10, 20);
        let b = legacy_leaf(&cluster, &migration, &[2; 32], 42, &player, 10, 20);
        let c = legacy_leaf(&cluster, &migration, &[1; 32], 43, &player, 10, 20);
        let cross_cluster = legacy_leaf(&[6; 32], &migration, &[1; 32], 42, &player, 10, 20);
        let cross_migration = legacy_leaf(&cluster, &[7; 32], &[1; 32], 42, &player, 10, 20);
        assert_eq!(
            a,
            [
                0xce, 0xc0, 0x90, 0x11, 0xf7, 0xb2, 0xa8, 0xd8, 0x91, 0x5c, 0xdc, 0x8f, 0x65, 0x6f,
                0x6f, 0xf4, 0x73, 0xc6, 0x3c, 0x9d, 0x2f, 0x19, 0xa8, 0xc3, 0x86, 0x33, 0xba, 0x72,
                0x8f, 0x6e, 0x69, 0xcd,
            ],
            "Rust leaf bytes must remain identical to the JavaScript v2 vector"
        );
        assert_ne!(a, b);
        assert_ne!(a, c);
        assert_ne!(a, cross_cluster);
        assert_ne!(a, cross_migration);
        assert_ne!(
            fold_merkle_proof(a, &[b]).unwrap(),
            hashv(&[a.as_ref(), b.as_ref()]).to_bytes()
        );
    }

    #[test]
    fn arithmetic_boundaries_are_integer_exact() {
        assert_eq!(align_up(1_001, 600).unwrap(), 1_200);
        assert_eq!(align_up(1_200, 600).unwrap(), 1_200);
        assert_eq!(utc_day(-86_401), -2);
        assert_eq!(utc_day(-1), -1);
        assert_eq!(utc_day(0), 0);
        assert_eq!(utc_day(86_399), 0);
        assert_eq!(utc_day(86_400), 1);
        assert_eq!(scale_to_e12(123_456, -6).unwrap(), 123_456_000_000);
        assert_eq!(brier_score(1, 8_000, true).unwrap(), 4_000_000);
        assert_eq!(brier_score(0, 8_000, true).unwrap(), 64_000_000);
        assert_eq!(terminal_xp_reserve(20, 2).unwrap(), 22);
        assert!(terminal_xp_reserve(u64::MAX, 1).is_err());
        assert!(brier_score(1, 0, true).is_err());
        assert!(scale_to_e12(1, i32::from(CORE_MIN_EXPONENT) - 1).is_err());
        assert!(scale_to_e12(1, i32::from(CORE_MAX_EXPONENT) + 1).is_err());
        assert!(product_leq_u128_u32(u128::MAX, 2, u128::MAX, 3));
        assert!(!product_leq_u128_u32(u128::MAX, 4, u128::MAX, 3));
        assert!(product_leq_u128_u32(7, u32::MAX, 8, u32::MAX));
    }

    #[test]
    fn ranking_is_deterministic_sharded_and_hash_bound() {
        let shard_index = 3u8;
        let first = wallet_for_shard(shard_index, 1);
        let second = wallet_for_shard(shard_index, 2);
        let third = wallet_for_shard(shard_index, 3);
        let fourth = wallet_for_shard(shard_index, 4);

        let mut top = [RankEntry::default(); PODIUM_SEAT_COUNT];
        upsert_local_top3(
            &mut top,
            RankEntry {
                wallet: first,
                xp: 10,
            },
        )
        .unwrap();
        upsert_local_top3(
            &mut top,
            RankEntry {
                wallet: second,
                xp: 30,
            },
        )
        .unwrap();
        upsert_local_top3(
            &mut top,
            RankEntry {
                wallet: third,
                xp: 20,
            },
        )
        .unwrap();
        upsert_local_top3(
            &mut top,
            RankEntry {
                wallet: fourth,
                xp: 5,
            },
        )
        .unwrap();
        assert_eq!(top.map(|entry| entry.xp), [30, 20, 10]);

        upsert_local_top3(
            &mut top,
            RankEntry {
                wallet: first,
                xp: 40,
            },
        )
        .unwrap();
        assert_eq!(top.map(|entry| entry.xp), [40, 30, 20]);
        upsert_local_top3(
            &mut top,
            RankEntry {
                wallet: first,
                xp: 1,
            },
        )
        .unwrap();
        assert_eq!(top[0].xp, 40);
        assert!(upsert_local_top3(
            &mut top,
            RankEntry {
                wallet: Pubkey::default(),
                xp: 100,
            },
        )
        .is_err());

        let tie_a = wallet_for_shard(shard_index, 11);
        let tie_b = wallet_for_shard(shard_index, 12);
        let mut tie_top = [RankEntry::default(); PODIUM_SEAT_COUNT];
        upsert_local_top3(
            &mut tie_top,
            RankEntry {
                wallet: tie_b,
                xp: 50,
            },
        )
        .unwrap();
        upsert_local_top3(
            &mut tie_top,
            RankEntry {
                wallet: tie_a,
                xp: 50,
            },
        )
        .unwrap();
        assert_eq!(
            tie_top[0].wallet,
            if tie_a.to_bytes() < tie_b.to_bytes() {
                tie_a
            } else {
                tie_b
            }
        );

        let mut shard = RankShard {
            schema: CORE_SCHEMA_VERSION,
            bump: 255,
            economy_hash: [13; 32],
            day: -1,
            shard: shard_index,
            accepted: 9,
            terminal: 8,
            top,
        };
        let shard_hash = rank_shard_digest(&shard).unwrap();
        shard.accepted += 1;
        assert_ne!(rank_shard_digest(&shard).unwrap(), shard_hash);
        shard.accepted -= 1;

        let mut shard_hashes = [[0u8; 32]; RANK_SHARD_COUNT_USIZE];
        shard_hashes[usize::from(shard_index)] = shard_hash;
        let all_shards_hash = shards_digest(&shard.economy_hash, shard.day, &shard_hashes);
        shard_hashes[0][0] = 1;
        assert_ne!(
            shards_digest(&shard.economy_hash, shard.day, &shard_hashes),
            all_shards_hash
        );

        let final_hash = day_final_hash(
            &shard.economy_hash,
            shard.day,
            shard.accepted,
            shard.terminal,
            &shard.top,
            &all_shards_hash,
        );
        assert_ne!(
            day_final_hash(
                &shard.economy_hash,
                shard.day + 1,
                shard.accepted,
                shard.terminal,
                &shard.top,
                &all_shards_hash,
            ),
            final_hash
        );

        let wrong_shard_wallet = wallet_for_shard(shard_index + 1, 21);
        shard.top[0].wallet = wrong_shard_wallet;
        assert!(rank_shard_digest(&shard).is_err());

        shard.top = [RankEntry::default(); PODIUM_SEAT_COUNT];
        shard.top[0].xp = 1;
        assert!(rank_shard_digest(&shard).is_err());

        let global_wallet = wallet_for_shard(7, 31);
        let mut shard_tops = [[RankEntry::default(); PODIUM_SEAT_COUNT]; RANK_SHARD_COUNT_USIZE];
        shard_tops[usize::from(shard_index)] = top;
        shard_tops[7][0] = RankEntry {
            wallet: global_wallet,
            xp: 50,
        };
        let global = fold_global_top3(&shard_tops).unwrap();
        assert_eq!(global.map(|entry| entry.xp), [50, 40, 30]);
    }

    #[test]
    fn podium_allocation_actions_and_reload_conserve() {
        assert_eq!(
            podium_allocation(1_000),
            PodiumAllocation {
                base_burn: 700,
                pool: 300,
                shares: [150, 90, 60],
                dust: 0,
            }
        );
        let allocation = podium_allocation(1_001);
        assert_eq!(allocation.base_burn, 700);
        assert_eq!(allocation.pool, 301);
        assert_eq!(allocation.shares, [150, 90, 60]);
        assert_eq!(allocation.dust, 1);
        assert_eq!(podium_allocation(1).dust, 1);

        let player = Pubkey::new_from_array([41; 32]);
        let other = Pubkey::new_from_array([42; 32]);
        let seats = [other, player, Pubkey::default()];
        let actions = podium_actions(&player, &seats);
        assert_eq!(
            actions,
            [
                RELOAD_ACTION_ROUTE,
                RELOAD_ACTION_RETAIN,
                RELOAD_ACTION_BURN,
            ]
        );
        assert_eq!(
            podium_actions(&player, &[other, other, player]),
            [
                RELOAD_ACTION_ROUTE,
                RELOAD_ACTION_BURN,
                RELOAD_ACTION_RETAIN,
            ]
        );

        let raw_burned = allocation.base_burn + allocation.dust + allocation.shares[2];
        let raw_routed = allocation.shares[0];
        let raw_retained = allocation.shares[1];
        let consumed = raw_burned + raw_routed;
        assert!(
            require_reload_conservation(1_001, consumed, raw_burned, raw_routed, raw_retained,)
                .is_ok()
        );
        assert!(require_reload_conservation(
            1_001,
            consumed - 1,
            raw_burned,
            raw_routed,
            raw_retained,
        )
        .is_err());
    }

    #[test]
    fn resolution_and_terminal_hashes_bind_separate_state() {
        let shot_key = Pubkey::new_from_array([51; 32]);
        let mut shot = Shot::default();
        let baseline = resolution_hash(&shot_key, &shot);
        shot.rent_refund = Pubkey::new_from_array([1; 32]);
        assert_ne!(resolution_hash(&shot_key, &shot), baseline);
        shot.rent_refund = Pubkey::default();
        shot.delegate = Pubkey::new_from_array([2; 32]);
        assert_ne!(resolution_hash(&shot_key, &shot), baseline);
        shot.delegate = Pubkey::default();
        shot.cleanup_bond_lamports = MIN_CLEANUP_BOND_LAMPORTS;
        assert_ne!(resolution_hash(&shot_key, &shot), baseline);
        shot.cleanup_bond_lamports = 0;
        shot.activation_worker = Pubkey::new_from_array([3; 32]);
        assert_ne!(resolution_hash(&shot_key, &shot), baseline);
        shot.activation_worker = Pubkey::default();
        shot.activation_slot = 9;
        assert_ne!(resolution_hash(&shot_key, &shot), baseline);
        shot.activation_slot = 0;
        shot.activation_ts = 10;
        assert_ne!(resolution_hash(&shot_key, &shot), baseline);
        shot.activation_ts = 0;
        shot.resolution_slot = 11;
        assert_ne!(resolution_hash(&shot_key, &shot), baseline);
        shot.resolution_slot = 0;
        shot.score_day = 7;
        let day_bound = resolution_hash(&shot_key, &shot);
        assert_ne!(day_bound, baseline);
        shot.score_day = 0;
        shot.rank_shard = 1;
        let shard_bound = resolution_hash(&shot_key, &shot);
        assert_ne!(shard_bound, baseline);

        shot.state = ShotState::Revealed as u8;
        shot.side = 1;
        shot.p_bps = 8_000;
        shot.hit = 1;
        shot.xp_awarded = 22;
        shot.revealed_salt = [4; 32];
        shot.forfeit_worker = Pubkey::new_from_array([5; 32]);
        shot.terminal_slot = 12;
        shot.terminal_ts = 13;
        assert_eq!(resolution_hash(&shot_key, &shot), shard_bound);

        shot.resolution_hash = shard_bound;
        let revealed_terminal = terminal_hash(&shot_key, &shot);
        shot.revealed_salt[0] ^= 1;
        assert_ne!(terminal_hash(&shot_key, &shot), revealed_terminal);
        shot.revealed_salt[0] ^= 1;
        shot.forfeit_worker = Pubkey::new_from_array([6; 32]);
        assert_ne!(terminal_hash(&shot_key, &shot), revealed_terminal);
        shot.forfeit_worker = Pubkey::new_from_array([5; 32]);
        shot.terminal_slot += 1;
        assert_ne!(terminal_hash(&shot_key, &shot), revealed_terminal);
        shot.terminal_slot -= 1;
        shot.terminal_ts += 1;
        assert_ne!(terminal_hash(&shot_key, &shot), revealed_terminal);
        shot.terminal_ts -= 1;
        shot.state = ShotState::Forfeited as u8;
        assert_ne!(terminal_hash(&shot_key, &shot), revealed_terminal);
    }

    #[test]
    fn conservation_reserves_every_possible_terminal_award() {
        let mut ledger = PlayerLedger::default();
        ledger.credits = 900;
        ledger.locked_credits = 100;
        ledger.legacy_credits = 1_000;
        ledger.reserved_payout_credits = 185;
        ledger.xp = 50;
        ledger.legacy_xp = 50;
        ledger.reserved_xp = 22;
        assert!(require_ledger_conservation(&ledger).is_ok());

        ledger.retired_credits = 1;
        assert!(require_ledger_conservation(&ledger).is_err());
        ledger.retired_credits = 0;
        ledger.reserved_payout_credits = u64::MAX;
        assert!(require_ledger_conservation(&ledger).is_err());

        ledger.reserved_payout_credits = 0;
        ledger.rcx_reloaded = 10;
        ledger.rcx_burned = 7;
        ledger.rcx_routed = 3;
        ledger.rcx_retained = 99;
        ledger.next_shot_nonce = 12;
        ledger.next_reload_nonce = 4;
        assert!(require_ledger_conservation(&ledger).is_ok());
        ledger.rcx_routed = 2;
        assert!(require_ledger_conservation(&ledger).is_err());
        ledger.rcx_routed = 3;
        ledger.sealed = 3;
        ledger.open = 1;
        ledger.shots = 1;
        ledger.voids = 1;
        ledger.forfeits = 1;
        assert!(require_ledger_conservation(&ledger).is_ok());
        ledger.forfeits = 2;
        assert!(require_ledger_conservation(&ledger).is_err());
        ledger.forfeits = 1;
        ledger.sealed = 4;
        assert!(require_ledger_conservation(&ledger).is_err());
    }

    #[test]
    fn history_pages_append_sequentially_and_terminalize_out_of_order_once() {
        let player = Pubkey::new_from_array([41; 32]);
        let economy_hash = [11; 32];
        let page_index = 2;
        let (page_key, bump) = history_page_pda(&economy_hash, &player, page_index);
        let mut page = HistoryPage::default();
        page.initialize(bump, economy_hash, player, page_index);
        assert!(
            authenticate_history_page(&page, page_key, &economy_hash, &player, page_index).is_ok()
        );
        assert_eq!(page.append_pending(32).unwrap(), 0);
        assert_eq!(page.append_pending(33).unwrap(), 1);
        assert_eq!(page.append_pending(34).unwrap(), 2);
        assert!(page.append_pending(36).is_err());

        let empty_root = page.results_root;
        let len_before = serialized_len(&page);

        // Terminalise slot 2 first: OUT OF ORDER, which is the property this test
        // is named for and the reason the fold order is a sequence and not a nonce.
        let (shot_key_34, shot_34) = terminal_shot(ShotState::Revealed, player, 34);
        let (slot_34, seq_34, row_34) = page.commit_terminal(&shot_key_34, &shot_34).unwrap();
        assert_eq!((slot_34, seq_34), (2, 1));
        assert_ne!(row_34, [0; 32]);
        assert_ne!(page.results_root, empty_root);
        assert_eq!(page.terminal_count(), 1);
        // ONCE: the same shot cannot be folded in twice.
        assert!(page.commit_terminal(&shot_key_34, &shot_34).is_err());

        let root_after_34 = page.results_root;
        let (shot_key_32, shot_32) = terminal_shot(ShotState::Forfeited, player, 32);
        let (slot_32, seq_32, row_32) = page.commit_terminal(&shot_key_32, &shot_32).unwrap();
        assert_eq!((slot_32, seq_32), (0, 2));
        assert_ne!(row_32, row_34);
        assert_ne!(page.results_root, root_after_34);
        assert_eq!(page.terminal_count(), 2);
        // Slot 1 was appended and never terminalised: no bit, and no row anywhere.
        assert_eq!(page.terminal_mask & (1 << 1), 0);
        assert_ne!(page.terminal_mask & (1 << 2), 0);

        for nonce in 35..48 {
            page.append_pending(nonce).unwrap();
        }
        assert_eq!(page.pending_count as usize, HISTORY_PAGE_CAP);
        assert!(page.append_pending(48).is_err());

        // THE POINT OF THE WHOLE CHANGE, as one assertion: the serialised length
        // is IDENTICAL after zero, one, two and sixteen operations. It replaces
        // three serialized_len_for(3,1)/(3,2)/(16,2) assertions that only made
        // sense while the page grew.
        assert_eq!(serialized_len(&page), len_before);
        assert_eq!(serialized_len(&page), HistoryPage::LEN);

        // The tamper case has no on-chain analogue any more: there is no stored
        // row to corrupt. The property moves EARLIER instead of disappearing -
        // a non-terminal shot is never folded into the root in the first place.
        let (bad_key, bad_shot) = terminal_shot(ShotState::AwaitReveal, player, 35);
        assert!(page.commit_terminal(&bad_key, &bad_shot).is_err());
        assert_eq!(page.terminal_count(), 2);
        assert!(page.validate_contents().is_ok());

        // REGRESSION, and it is the whole reason validate_contents widens to u32:
        // a FULL page must still terminalise. pending_count is HISTORY_PAGE_CAP
        // here, and `u16 >> 16` is an overflow shift that the workspace's
        // overflow-checks = true turns into a panic - which would have bricked
        // every full page forever, silently, on the very first one.
        let (last_key, last_shot) = terminal_shot(ShotState::Revealed, player, 47);
        let (slot_47, seq_47, _row_47) = page.commit_terminal(&last_key, &last_shot).unwrap();
        assert_eq!((slot_47, seq_47), (15, 3));
        assert_ne!(page.terminal_mask & (1 << 15), 0);
        assert!(page.validate_contents().is_ok());
        assert_eq!(serialized_len(&page), HistoryPage::LEN);
    }

    /// THE SIXTEENTH SLOT, ON ITS OWN, BECAUSE AN OFF-BY-ONE HERE PROVES NOTHING.
    ///
    /// validate_contents used to check the mask with `terminal_mask >> pending_count`
    /// on a u16. pending_count reaches HISTORY_PAGE_CAP, which is 16, and a u16
    /// shifted right by 16 is an OVERFLOW SHIFT. This workspace sets
    /// overflow-checks = true (Cargo.toml:6), so that line PANICKED - not
    /// errored, panicked - the moment a page filled. Every full page would have
    /// been bricked: no further append, and no terminalisation of any shot
    /// already in it, permanently and silently, for exactly the players who play
    /// the most.
    ///
    /// The fix widens the shift to u32, which is defined at 16 and where
    /// pending_count can never reach 32. This test exercises the shift at
    /// EXACTLY CAP - not CAP-1, which is defined for a u16 and proves nothing -
    /// and it asserts the boundary explicitly rather than relying on a loop
    /// bound elsewhere in the file being read correctly.
    ///
    /// To see it fail: change `(self.terminal_mask as u32) >> (self.pending_count
    /// as u32)` back to `self.terminal_mask >> self.pending_count` and run this
    /// test. It panics with "attempt to shift right with overflow".
    #[test]
    fn validate_contents_does_not_overflow_shift_on_a_full_page() {
        let player = Pubkey::new_from_array([43; 32]);
        let economy_hash = [13; 32];
        let page_index = 0;
        let (_page_key, bump) = history_page_pda(&economy_hash, &player, page_index);
        let mut page = HistoryPage::default();
        page.initialize(bump, economy_hash, player, page_index);

        // Walk up to the cap one slot at a time, checking the shift at EVERY
        // width, so the boundary cannot be missed by an off-by-one in a loop.
        for nonce in 0..HISTORY_PAGE_CAP as u64 {
            assert_eq!(page.append_pending(nonce).unwrap(), nonce as usize);
            assert!(page.validate_contents().is_ok());
        }

        // THE BOUNDARY, asserted rather than assumed.
        assert_eq!(page.pending_count as usize, HISTORY_PAGE_CAP);
        assert_eq!(page.pending_count, 16);

        // The shift at exactly CAP, with the mask empty...
        assert!(page.validate_contents().is_ok());
        // ...and with EVERY bit set, which is the widest value the mask can hold
        // and the one where `>> 16` had to be defined rather than merely lucky.
        page.terminal_mask = u16::MAX;
        assert_eq!(page.terminal_count(), 16);
        assert!(page.validate_contents().is_ok());
        assert_eq!(serialized_len(&page), HistoryPage::LEN);

        // And the check still REJECTS what it exists to reject: a bit above the
        // slots appended. Widening the shift must not have widened what passes.
        page.terminal_mask = 0;
        page.pending_count = 15;
        page.terminal_mask = 1 << 15;
        assert!(page.validate_contents().is_err());
        page.pending_count = 16;
        assert!(page.validate_contents().is_ok());

        // The paths that call validate_contents are the ones that would have
        // aborted, so exercise them at the cap too rather than the predicate
        // alone: a full page still refuses a seventeenth append with an ERROR.
        page.terminal_mask = 0;
        assert!(page.append_pending(HISTORY_PAGE_CAP as u64).is_err());
        assert_eq!(page.pending_count as usize, HISTORY_PAGE_CAP);
    }

    #[test]
    fn compact_result_reconstructs_commit_and_binds_only_game_facts() {
        let player = Pubkey::new_from_array([42; 32]);
        let (shot_key, mut shot) = terminal_shot(ShotState::Revealed, player, 1);
        let result = ShotResult::from_terminal_shot(&shot_key, &shot).unwrap();
        let facts = GameResultFacts::from_terminal_shot(&shot);
        assert_eq!(serialized_len(&result), 165);
        assert_eq!(result.proof_material, shot.revealed_salt);
        assert_eq!(
            compact_result_commit(&shot.economy_hash, &player, shot.nonce, &result).unwrap(),
            shot.commit
        );
        assert!(
            verify_game_result(&shot.economy_hash, &player, shot.nonce, &result, &facts).is_ok()
        );

        let baseline = result.game_result_hash;
        assert_eq!(
            baseline,
            [
                0xf4, 0xc1, 0x1f, 0x19, 0x14, 0xda, 0x94, 0xfe, 0x8a, 0xdd, 0x4c, 0x6f, 0xbb, 0xd0,
                0x2c, 0xa8, 0xae, 0xda, 0x77, 0xc8, 0xb1, 0xaa, 0x94, 0xd9, 0xd8, 0xab, 0xd0, 0x35,
                0x27, 0x0f, 0xff, 0x4d,
            ]
        );
        let mut changed_facts = facts;
        changed_facts.entry_timepin_result_hash[0] ^= 1;
        assert_ne!(
            game_result_hash(
                &shot.economy_hash,
                &player,
                shot.nonce,
                &result,
                &changed_facts
            )
            .unwrap(),
            baseline
        );
        changed_facts = facts;
        changed_facts.xp_awarded += 1;
        assert_ne!(
            game_result_hash(
                &shot.economy_hash,
                &player,
                shot.nonce,
                &result,
                &changed_facts
            )
            .unwrap(),
            baseline
        );

        let mut changed_result = result;
        changed_result.stake += 1;
        assert_ne!(
            game_result_hash(
                &shot.economy_hash,
                &player,
                shot.nonce,
                &changed_result,
                &facts
            )
            .unwrap(),
            baseline
        );
        assert_ne!(
            game_result_hash(&shot.economy_hash, &player, shot.nonce + 1, &result, &facts).unwrap(),
            baseline
        );

        shot.rent_refund = Pubkey::new_from_array([71; 32]);
        shot.cleanup_bond_lamports += 1;
        shot.activation_worker = Pubkey::new_from_array([72; 32]);
        shot.resolver = Pubkey::new_from_array([73; 32]);
        shot.forfeit_worker = Pubkey::new_from_array([74; 32]);
        assert_eq!(
            game_result_hash(
                &shot.economy_hash,
                &player,
                shot.nonce,
                &result,
                &GameResultFacts::from_terminal_shot(&shot)
            )
            .unwrap(),
            baseline
        );

        let (forfeit_key, forfeited_shot) = terminal_shot(ShotState::Forfeited, player, 2);
        let forfeited = ShotResult::from_terminal_shot(&forfeit_key, &forfeited_shot).unwrap();
        assert_eq!(forfeited.proof_material, forfeited_shot.commit);

        let work_hash = completion_result_hash(
            &shot_key,
            WORK_KIND_RESOLVE_SHOT,
            &baseline,
            RECEIPT_PAYABLE,
            &shot.resolver,
        );
        assert_ne!(
            work_hash,
            completion_result_hash(
                &shot_key,
                WORK_KIND_ACTIVATE_ENTRY,
                &baseline,
                RECEIPT_PAYABLE,
                &shot.resolver,
            )
        );
    }

    #[test]
    fn work_page_reserves_uniquely_and_terminalizes_once() {
        let player = Pubkey::new_from_array([43; 32]);
        let (shot_key, mut shot) = terminal_shot(ShotState::Revealed, player, 7);
        shot.state = ShotState::PendingEntry as u8;
        shot.activation_worker = Pubkey::default();
        shot.resolver = Pubkey::default();
        shot.forfeit_worker = Pubkey::default();

        let page_index = work_page_index(shot.nonce);
        let (page_key, bump) = work_page_pda(&shot.economy_hash, &player, page_index);
        let mut page = WorkPage::default();
        page.initialize(bump, shot.economy_hash, player, page_index);
        assert!(
            authenticate_work_page(&page, page_key, &shot.economy_hash, &player, page_index)
                .is_ok()
        );

        assert_eq!(
            page.reserve_for_shot(&shot_key, &shot, WORK_KIND_ACTIVATE_ENTRY, 0)
                .unwrap(),
            0
        );
        assert_eq!(
            page.reserve_for_shot(&shot_key, &shot, WORK_KIND_ACTIVATE_ENTRY, 0)
                .unwrap(),
            0
        );
        assert!(page
            .reserve_for_shot(&shot_key, &shot, WORK_KIND_ACTIVATE_ENTRY, 1)
            .is_err());
        assert_eq!(
            page.reserve_for_shot(&shot_key, &shot, WORK_KIND_RESOLVE_SHOT, 1)
                .unwrap(),
            1
        );
        assert_eq!(
            page.reserve_for_shot(&shot_key, &shot, WORK_KIND_FORFEIT, 2)
                .unwrap(),
            2
        );
        assert_eq!(page.lookup_index(&shot_key, WORK_KIND_FORFEIT).unwrap(), 2);
        assert!(page.lookup_optional_index(&shot_key, 255).is_err());
        assert_eq!(
            serialized_len(&page),
            WorkPage::serialized_len_for(3).unwrap()
        );

        let worker = Pubkey::new_from_array([44; 32]);
        page.complete_pending(
            0,
            &shot_key,
            WORK_KIND_ACTIVATE_ENTRY,
            RECEIPT_PAYABLE,
            worker,
            [45; 32],
            99,
        )
        .unwrap();
        assert_eq!(page.records[0].worker, worker);
        assert!(page
            .complete_pending(
                0,
                &shot_key,
                WORK_KIND_ACTIVATE_ENTRY,
                RECEIPT_PAYABLE,
                worker,
                [45; 32],
                99,
            )
            .is_err());
        page.complete_pending(
            1,
            &shot_key,
            WORK_KIND_RESOLVE_SHOT,
            RECEIPT_NONPAYABLE,
            Pubkey::default(),
            [46; 32],
            100,
        )
        .unwrap();
        assert!(page
            .complete_pending(
                2,
                &shot_key,
                WORK_KIND_FORFEIT,
                RECEIPT_NONPAYABLE,
                worker,
                [47; 32],
                101,
            )
            .is_err());

        let mut duplicate = page;
        duplicate.records.push(duplicate.records[0]);
        assert!(duplicate.validate_contents().is_err());
    }

    #[test]
    fn delegate_bounds_are_exact() {
        let (economy, ruleset) = test_economy_and_ruleset();
        let now = 1_800_000_000i64;
        let mut grant = delegate_grant(&economy, &ruleset, now + 1_000);
        let (grant_key, bump) = delegate_grant_pda(&grant);
        grant.bump = bump;
        assert!(validate_new_delegate_grant(&grant, &economy, &ruleset, now).is_ok());
        assert!(authenticate_delegate_grant(&grant, grant_key, &economy, &ruleset).is_ok());
        assert!(consume_delegate_grant(&mut grant, &economy, &ruleset, now, 500).is_ok());
        assert_eq!((grant.shots_used, grant.gross_stake_used), (1, 500));
        assert!(consume_delegate_grant(&mut grant, &economy, &ruleset, now + 9, 500).is_err());
        assert_eq!((grant.shots_used, grant.gross_stake_used), (1, 500));
        assert!(consume_delegate_grant(&mut grant, &economy, &ruleset, now + 10, 500).is_ok());
        assert!(consume_delegate_grant(&mut grant, &economy, &ruleset, now + 20, 100).is_err());
        revoke_delegate_grant(&mut grant);
        revoke_delegate_grant(&mut grant);
        assert_eq!(grant.revoked, 1);

        let mut invalid = delegate_grant(&economy, &ruleset, now + 1_000);
        invalid.max_gross_stake = invalid.max_stake - 1;
        assert!(validate_new_delegate_grant(&invalid, &economy, &ruleset, now).is_err());
        invalid = delegate_grant(&economy, &ruleset, now + MAX_DELEGATE_LIFETIME_SECONDS + 1);
        assert!(validate_new_delegate_grant(&invalid, &economy, &ruleset, now).is_err());
        invalid = delegate_grant(&economy, &ruleset, now + 1_000);
        invalid.min_interval_seconds = 0;
        assert!(validate_new_delegate_grant(&invalid, &economy, &ruleset, now).is_err());
    }

    #[test]
    fn reload_history_page_is_bounded_ordered_and_tamper_evident() {
        let economy_hash = [51; 32];
        let player = Pubkey::new_from_array([52; 32]);
        let page_index = 2;
        let (page_key, bump) = reload_history_page_pda(&economy_hash, &player, page_index);
        let mut page = ReloadHistoryPage::default();
        page.initialize(bump, economy_hash, player, page_index);
        assert!(authenticate_reload_history_page(
            &page,
            page_key,
            &economy_hash,
            &player,
            page_index
        )
        .is_ok());
        assert_eq!(
            ReloadHistoryPage::serialized_len_for(0).unwrap(),
            ReloadHistoryPage::BASE_LEN
        );

        let first = ReloadRecord {
            day: 100,
            day_final_hash: [53; 32],
            gross: 10_000,
            actions: [
                RELOAD_ACTION_BURN,
                RELOAD_ACTION_ROUTE,
                RELOAD_ACTION_RETAIN,
            ],
        };
        assert_eq!(page.append(64, first).unwrap(), 0);
        assert!(page.append(64, first).is_err());
        assert!(page.append(66, first).is_err());

        let second = ReloadRecord {
            day: 101,
            day_final_hash: [54; 32],
            gross: 20_000,
            actions: [RELOAD_ACTION_BURN; PODIUM_SEAT_COUNT],
        };
        assert_eq!(page.append(65, second).unwrap(), 1);
        assert_eq!(
            ReloadHistoryPage::serialized_len_for(page.records.len()).unwrap(),
            ReloadHistoryPage::BASE_LEN + 2 * ReloadRecord::LEN
        );

        page.records[0].actions[0] = RELOAD_ACTION_NONE;
        assert!(page.validate_contents().is_err());
        page.records[0].actions[0] = RELOAD_ACTION_BURN;
        page.records[1].day_final_hash = [0; 32];
        assert!(page.validate_contents().is_err());
        page.records[1].day_final_hash = [54; 32];
        assert!(page.validate_contents().is_ok());
        assert!(authenticate_reload_history_page(
            &page,
            Pubkey::new_unique(),
            &economy_hash,
            &player,
            page_index
        )
        .is_err());
        assert!(ReloadHistoryPage::serialized_len_for(RELOAD_HISTORY_PAGE_CAP + 1).is_err());
    }

    #[test]
    fn permanent_ledger_is_the_legacy_claim_tombstone() {
        let mut ledger = PlayerLedger::default();
        assert!(require_legacy_claim_available(&ledger, 0, 0).is_err());
        assert!(require_legacy_claim_available(&ledger, 1, 0).is_ok());
        assert!(require_legacy_claim_available(&ledger, 0, 1).is_ok());

        ledger.legacy_credits = 1;
        assert!(require_legacy_claim_available(&ledger, 1, 0).is_err());
        ledger.legacy_credits = 0;
        ledger.legacy_xp = 1;
        assert!(require_legacy_claim_available(&ledger, 0, 1).is_err());
    }

    #[test]
    fn reload_route_memo_binds_every_routing_fact() {
        let economy_hash = [61; 32];
        let player = Pubkey::new_from_array([62; 32]);
        let final_hash = [63; 32];
        let destination = Pubkey::new_from_array([64; 32]);
        let baseline = reload_route_memo(
            &economy_hash,
            &player,
            7,
            -1,
            &final_hash,
            2,
            &destination,
            99,
        );
        let mut changed_economy = economy_hash;
        changed_economy[0] ^= 1;
        assert_ne!(
            baseline,
            reload_route_memo(
                &changed_economy,
                &player,
                7,
                -1,
                &final_hash,
                2,
                &destination,
                99,
            )
        );
        assert_ne!(
            baseline,
            reload_route_memo(
                &economy_hash,
                &player,
                8,
                -1,
                &final_hash,
                2,
                &destination,
                99,
            )
        );
        assert_ne!(
            baseline,
            reload_route_memo(
                &economy_hash,
                &player,
                7,
                0,
                &final_hash,
                2,
                &destination,
                99,
            )
        );
        assert_ne!(
            baseline,
            reload_route_memo(
                &economy_hash,
                &player,
                7,
                -1,
                &final_hash,
                1,
                &destination,
                99,
            )
        );
        assert_ne!(
            baseline,
            reload_route_memo(
                &economy_hash,
                &player,
                7,
                -1,
                &final_hash,
                2,
                &Pubkey::new_from_array([65; 32]),
                99,
            )
        );
        assert_ne!(
            baseline,
            reload_route_memo(
                &economy_hash,
                &player,
                7,
                -1,
                &final_hash,
                2,
                &destination,
                100,
            )
        );
    }
}
