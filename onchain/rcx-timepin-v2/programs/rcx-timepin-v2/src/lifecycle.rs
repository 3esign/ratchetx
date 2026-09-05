//! Compact Timepin v2 capture, terminal state, and optional sponsored work.
//!
//! Candidate accounts retain only irreducible signed-message fields and capture
//! coordinates. `TimepinNeedV2` itself becomes the terminal artifact. Optional
//! packed work rows affect attribution only; they never gate evidence or expiry.

use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::{
    config::Config as ReceiverConfig,
    pda::get_config_address,
    price_update::{PriceUpdateV2, VerificationLevel},
    program::PythSolanaReceiver,
};
use solana_sha256_hasher::hashv;

use crate::{
    authenticate_generation_accounts, authenticate_need, authenticate_spec_account,
    validate_need_shape, EvidenceSpecV2, TimepinNeedV2, TimepinV2Error,
    ADAPTER_PYTH_MIN_CAPTURE_V2, EVIDENCE_SPEC_SEED, NEED_AMBIGUOUS, NEED_CANDIDATE, NEED_EXPIRED,
    NEED_FINAL, NEED_OPEN, NEED_SEED, SCHEMA_SEED, SCHEMA_VERSION,
};

pub const CANDIDATE_SEED: &[u8] = b"candidate";
pub const WORK_MANIFEST_SEED: &[u8] = b"work_manifest";
pub const WORK_PAGE_SEED: &[u8] = b"work_page";
pub const WORK_MANIFEST_SCHEMA_VERSION: u16 = 1;
pub const WORK_MANIFEST_SCHEMA_SEED: [u8; 2] = WORK_MANIFEST_SCHEMA_VERSION.to_le_bytes();
pub const COMPLETION_SCHEMA_VERSION: u16 = 1;
pub const WORK_PAGE_SCHEMA_VERSION: u16 = 1;
pub const LOCATOR_MODE_PACKED_WORK_PAGE: u8 = 2;
pub const WORK_KIND_FIRST_CAPTURE: u8 = 1;
pub const WORK_KIND_TERMINALIZE: u8 = 2;
pub const RECEIPT_PENDING: u8 = 0;
pub const RECEIPT_PAYABLE: u8 = 1;
pub const RECEIPT_NONPAYABLE: u8 = 2;
pub const WORK_PAGE_CAP: usize = 2;
pub const WORK_RECORD_LEN: usize = 106;
pub const WORK_PAGE_RECORDS_OFFSET: usize = 47;
pub const PRICE_UPDATE_V2_LAYOUT_LEN: usize = 134;

pub const PRICE_MESSAGE_HASH_DOMAIN: &[u8] = b"rcx-timepin:pyth-price-message:v2\0";
pub const EVIDENCE_SET_HASH_DOMAIN: &[u8] = b"rcx-timepin:evidence-set:v2\0";
pub const EXPIRED_HASH_DOMAIN: &[u8] = b"rcx-timepin:expired:v2\0";
pub const COMPLETION_RESULT_HASH_DOMAIN: &[u8] = b"rcx-timepin:completion-result:v2\0";

#[derive(Accounts)]
#[instruction(work_kind: u8)]
pub struct OpenWorkManifest<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    #[account(
        init_if_needed,
        payer = actor,
        space = 8 + WorkManifest::LEN,
        seeds = [
            WORK_MANIFEST_SEED,
            WORK_MANIFEST_SCHEMA_SEED.as_ref(),
            &[work_kind],
        ],
        bump,
    )]
    pub work_manifest: Box<Account<'info, WorkManifest>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenWorkPage<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    #[account(
        seeds = [
            EVIDENCE_SPEC_SEED,
            SCHEMA_SEED.as_ref(),
            need.evidence_spec_hash.as_ref(),
        ],
        bump,
    )]
    pub evidence_spec: Box<Account<'info, EvidenceSpecV2>>,
    #[account(
        seeds = [
            NEED_SEED,
            SCHEMA_SEED.as_ref(),
            need.evidence_spec_hash.as_ref(),
            need.target_ts.to_le_bytes().as_ref(),
        ],
        bump = need.bump,
    )]
    pub need: Box<Account<'info, TimepinNeedV2>>,
    #[account(
        init_if_needed,
        payer = actor,
        space = 8 + WorkPage::BASE_LEN,
        seeds = [WORK_PAGE_SEED, need.key().as_ref()],
        bump,
    )]
    pub work_page: Box<Account<'info, WorkPage>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(_work_kind: u8, _expected_index: u8)]
pub struct ReserveWork<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    #[account(
        seeds = [
            EVIDENCE_SPEC_SEED,
            SCHEMA_SEED.as_ref(),
            need.evidence_spec_hash.as_ref(),
        ],
        bump,
    )]
    pub evidence_spec: Box<Account<'info, EvidenceSpecV2>>,
    #[account(
        seeds = [
            NEED_SEED,
            SCHEMA_SEED.as_ref(),
            need.evidence_spec_hash.as_ref(),
            need.target_ts.to_le_bytes().as_ref(),
        ],
        bump = need.bump,
    )]
    pub need: Box<Account<'info, TimepinNeedV2>>,
    #[account(
        mut,
        seeds = [WORK_PAGE_SEED, need.key().as_ref()],
        bump = work_page.bump,
    )]
    pub work_page: Box<Account<'info, WorkPage>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(expected_message_hash: [u8; 32])]
pub struct CaptureFirst<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    #[account(
        seeds = [
            EVIDENCE_SPEC_SEED,
            SCHEMA_SEED.as_ref(),
            need.evidence_spec_hash.as_ref(),
        ],
        bump,
    )]
    pub evidence_spec: Box<Account<'info, EvidenceSpecV2>>,
    #[account(
        mut,
        seeds = [
            NEED_SEED,
            SCHEMA_SEED.as_ref(),
            need.evidence_spec_hash.as_ref(),
            need.target_ts.to_le_bytes().as_ref(),
        ],
        bump = need.bump,
    )]
    pub need: Box<Account<'info, TimepinNeedV2>>,
    #[account(
        init_if_needed,
        payer = actor,
        space = 8 + CandidateV2::LEN,
        seeds = [CANDIDATE_SEED, need.key().as_ref(), expected_message_hash.as_ref()],
        bump,
    )]
    pub candidate: Box<Account<'info, CandidateV2>>,
    pub receiver_program: Program<'info, PythSolanaReceiver>,
    pub receiver_program_data: Box<Account<'info, ProgramData>>,
    #[account(address = get_config_address() @ TimepinV2Error::WrongReceiverConfigPda)]
    pub receiver_config: Box<Account<'info, ReceiverConfig>>,
    pub wormhole_program: Program<'info>,
    pub wormhole_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: owner, exact PDA/layout, Full verification, write authority,
    /// source interval, confidence, generation, and slots are checked manually.
    pub price_update: UncheckedAccount<'info>,
    /// CHECK: must be the canonical writable WorkPage PDA. A system-owned,
    /// zero-data account means no sponsored work and is accepted as absence.
    #[account(mut)]
    pub work_page: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(expected_message_hash: [u8; 32])]
pub struct CaptureConflict<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    #[account(
        seeds = [
            EVIDENCE_SPEC_SEED,
            SCHEMA_SEED.as_ref(),
            need.evidence_spec_hash.as_ref(),
        ],
        bump,
    )]
    pub evidence_spec: Box<Account<'info, EvidenceSpecV2>>,
    #[account(
        mut,
        seeds = [
            NEED_SEED,
            SCHEMA_SEED.as_ref(),
            need.evidence_spec_hash.as_ref(),
            need.target_ts.to_le_bytes().as_ref(),
        ],
        bump = need.bump,
    )]
    pub need: Box<Account<'info, TimepinNeedV2>>,
    #[account(
        seeds = [CANDIDATE_SEED, need.key().as_ref(), need.candidate_a_hash.as_ref()],
        bump = candidate_a.bump,
    )]
    pub candidate_a: Box<Account<'info, CandidateV2>>,
    #[account(
        init,
        payer = actor,
        space = 8 + CandidateV2::LEN,
        seeds = [CANDIDATE_SEED, need.key().as_ref(), expected_message_hash.as_ref()],
        bump,
    )]
    pub candidate_b: Box<Account<'info, CandidateV2>>,
    pub receiver_program: Program<'info, PythSolanaReceiver>,
    pub receiver_program_data: Box<Account<'info, ProgramData>>,
    #[account(address = get_config_address() @ TimepinV2Error::WrongReceiverConfigPda)]
    pub receiver_config: Box<Account<'info, ReceiverConfig>>,
    pub wormhole_program: Program<'info>,
    pub wormhole_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: authenticated identically to CaptureFirst.
    pub price_update: UncheckedAccount<'info>,
    /// CHECK: exact canonical optional WorkPage is authenticated in the handler.
    #[account(mut)]
    pub work_page: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeNeed<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    #[account(
        seeds = [
            EVIDENCE_SPEC_SEED,
            SCHEMA_SEED.as_ref(),
            need.evidence_spec_hash.as_ref(),
        ],
        bump,
    )]
    pub evidence_spec: Box<Account<'info, EvidenceSpecV2>>,
    #[account(
        mut,
        seeds = [
            NEED_SEED,
            SCHEMA_SEED.as_ref(),
            need.evidence_spec_hash.as_ref(),
            need.target_ts.to_le_bytes().as_ref(),
        ],
        bump = need.bump,
    )]
    pub need: Box<Account<'info, TimepinNeedV2>>,
    #[account(
        seeds = [CANDIDATE_SEED, need.key().as_ref(), need.candidate_a_hash.as_ref()],
        bump = candidate.bump,
    )]
    pub candidate: Box<Account<'info, CandidateV2>>,
    /// CHECK: exact canonical optional WorkPage is authenticated in the handler.
    #[account(mut)]
    pub work_page: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ExpireNeed<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    #[account(
        seeds = [
            EVIDENCE_SPEC_SEED,
            SCHEMA_SEED.as_ref(),
            need.evidence_spec_hash.as_ref(),
        ],
        bump,
    )]
    pub evidence_spec: Box<Account<'info, EvidenceSpecV2>>,
    #[account(
        mut,
        seeds = [
            NEED_SEED,
            SCHEMA_SEED.as_ref(),
            need.evidence_spec_hash.as_ref(),
            need.target_ts.to_le_bytes().as_ref(),
        ],
        bump = need.bump,
    )]
    pub need: Box<Account<'info, TimepinNeedV2>>,
    /// CHECK: exact canonical optional WorkPage is authenticated in the handler.
    #[account(mut)]
    pub work_page: UncheckedAccount<'info>,
}

/// Producer-owned immutable descriptor consumed by Work Market v2.
#[account]
#[derive(Debug, PartialEq, Eq)]
pub struct WorkManifest {
    pub schema_version: u16,
    pub bump: u8,
    pub work_kind: u8,
    pub completion_schema_version: u16,
    pub locator_mode: u8,
    pub subject_schema_version: u16,
    pub subject_account_size: u16,
    pub subject_discriminator: [u8; 8],
    pub locator_schema_version: u16,
    pub locator_discriminator: [u8; 8],
    pub records_offset: u16,
    pub entry_len: u16,
    pub locator_capacity: u8,
}

impl WorkManifest {
    pub const LEN: usize = 34;
}

/// Standard packed completion record v1; Borsh encoding is exactly 106 bytes.
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
    pub const LEN: usize = WORK_RECORD_LEN;

    fn validate_shape(&self) -> Result<()> {
        require!(
            matches!(
                self.work_kind,
                WORK_KIND_FIRST_CAPTURE | WORK_KIND_TERMINALIZE
            ),
            TimepinLifecycleError::InvalidWorkKind
        );
        require!(
            self.subject != Pubkey::default(),
            TimepinLifecycleError::InvalidWorkRecord
        );
        match self.disposition {
            RECEIPT_PENDING => require!(
                self.worker == Pubkey::default()
                    && self.result_hash == [0; 32]
                    && self.completed_slot == 0,
                TimepinLifecycleError::InvalidWorkRecord
            ),
            RECEIPT_PAYABLE => require!(
                self.worker != Pubkey::default()
                    && self.result_hash != [0; 32]
                    && self.completed_slot > 0,
                TimepinLifecycleError::InvalidWorkRecord
            ),
            RECEIPT_NONPAYABLE => require!(
                self.worker == Pubkey::default()
                    && self.result_hash != [0; 32]
                    && self.completed_slot > 0,
                TimepinLifecycleError::InvalidWorkRecord
            ),
            _ => return err!(TimepinLifecycleError::InvalidWorkDisposition),
        }
        Ok(())
    }
}

#[account]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct WorkPage {
    pub schema: u16,
    pub bump: u8,
    pub need: Pubkey,
    pub records: Vec<WorkRecord>,
}

impl WorkPage {
    pub const BASE_LEN: usize = 2 + 1 + 32 + 4;
    pub const MAX_LEN: usize = Self::BASE_LEN + WORK_PAGE_CAP * WorkRecord::LEN;

    pub fn serialized_len_for(record_count: usize) -> Result<usize> {
        require!(
            record_count <= WORK_PAGE_CAP,
            TimepinLifecycleError::WorkPageFull
        );
        Self::BASE_LEN
            .checked_add(
                record_count
                    .checked_mul(WorkRecord::LEN)
                    .ok_or(TimepinLifecycleError::MathOverflow)?,
            )
            .ok_or(error!(TimepinLifecycleError::MathOverflow))
    }

    fn initialize(&mut self, bump: u8, need: Pubkey) {
        self.schema = WORK_PAGE_SCHEMA_VERSION;
        self.bump = bump;
        self.need = need;
        self.records = Vec::new();
    }

    fn validate_contents(&self) -> Result<()> {
        require!(
            self.schema == WORK_PAGE_SCHEMA_VERSION
                && self.need != Pubkey::default()
                && self.records.len() <= WORK_PAGE_CAP,
            TimepinLifecycleError::InvalidWorkPage
        );
        for (index, record) in self.records.iter().enumerate() {
            record.validate_shape()?;
            require!(
                !self.records[..index].iter().any(|prior| {
                    prior.subject == record.subject && prior.work_kind == record.work_kind
                }),
                TimepinLifecycleError::DuplicateWorkRecord
            );
        }
        Ok(())
    }

    fn reserve(&mut self, subject: Pubkey, work_kind: u8, expected_index: u8) -> Result<usize> {
        self.validate_contents()?;
        if let Some(index) = self
            .records
            .iter()
            .position(|record| record.subject == subject && record.work_kind == work_kind)
        {
            require!(
                index == usize::from(expected_index)
                    && self.records[index].disposition == RECEIPT_PENDING,
                TimepinLifecycleError::WrongWorkRecordIndex
            );
            return Ok(index);
        }
        require!(
            self.records.len() < WORK_PAGE_CAP,
            TimepinLifecycleError::WorkPageFull
        );
        require!(
            self.records.len() == usize::from(expected_index),
            TimepinLifecycleError::WrongWorkRecordIndex
        );
        self.records.push(WorkRecord {
            subject,
            work_kind,
            disposition: RECEIPT_PENDING,
            worker: Pubkey::default(),
            result_hash: [0; 32],
            completed_slot: 0,
        });
        self.validate_contents()?;
        Ok(self.records.len() - 1)
    }

    fn complete_pending(
        &mut self,
        index: usize,
        subject: Pubkey,
        work_kind: u8,
        disposition: u8,
        worker: Pubkey,
        result_hash: [u8; 32],
        completed_slot: u64,
    ) -> Result<()> {
        let record = self
            .records
            .get_mut(index)
            .ok_or(TimepinLifecycleError::WorkRecordMissing)?;
        require!(
            record.subject == subject
                && record.work_kind == work_kind
                && record.disposition == RECEIPT_PENDING,
            TimepinLifecycleError::WorkRecordNotPending
        );
        let completed = WorkRecord {
            subject,
            work_kind,
            disposition,
            worker,
            result_hash,
            completed_slot,
        };
        completed.validate_shape()?;
        *record = completed;
        self.validate_contents()
    }
}

/// Compact permanent evidence. Feed/source/verification metadata is committed
/// by the Need's exact spec and is revalidated at capture, not duplicated here.
#[account]
#[derive(Debug, PartialEq, Eq)]
pub struct CandidateV2 {
    pub schema: u16,
    pub bump: u8,
    pub need: Pubkey,
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

impl CandidateV2 {
    pub const LEN: usize = 111;
}

pub fn open_work_manifest_handler(ctx: Context<OpenWorkManifest>, work_kind: u8) -> Result<()> {
    require!(
        ctx.accounts.work_manifest.to_account_info().data_len() == 8 + WorkManifest::LEN,
        TimepinLifecycleError::WrongAccountLength
    );
    let expected = work_manifest_definition(ctx.bumps.work_manifest, work_kind)?;
    let manifest = &mut ctx.accounts.work_manifest;
    if manifest.schema_version == 0 {
        manifest.set_inner(expected);
    } else {
        require!(
            ***manifest == expected,
            TimepinLifecycleError::ImmutableAccountMismatch
        );
    }
    Ok(())
}

fn work_manifest_definition(bump: u8, work_kind: u8) -> Result<WorkManifest> {
    require_supported_work_kind(work_kind)?;
    let subject_discriminator: [u8; 8] = TimepinNeedV2::DISCRIMINATOR
        .try_into()
        .map_err(|_| error!(TimepinLifecycleError::WrongAccountDiscriminator))?;
    let locator_discriminator: [u8; 8] = WorkPage::DISCRIMINATOR
        .try_into()
        .map_err(|_| error!(TimepinLifecycleError::WrongAccountDiscriminator))?;
    Ok(WorkManifest {
        schema_version: WORK_MANIFEST_SCHEMA_VERSION,
        bump,
        work_kind,
        completion_schema_version: COMPLETION_SCHEMA_VERSION,
        locator_mode: LOCATOR_MODE_PACKED_WORK_PAGE,
        subject_schema_version: SCHEMA_VERSION,
        subject_account_size: u16::try_from(8 + TimepinNeedV2::LEN)
            .map_err(|_| error!(TimepinLifecycleError::MathOverflow))?,
        subject_discriminator,
        locator_schema_version: WORK_PAGE_SCHEMA_VERSION,
        locator_discriminator,
        records_offset: u16::try_from(WORK_PAGE_RECORDS_OFFSET)
            .map_err(|_| error!(TimepinLifecycleError::MathOverflow))?,
        entry_len: u16::try_from(WorkRecord::LEN)
            .map_err(|_| error!(TimepinLifecycleError::MathOverflow))?,
        locator_capacity: WORK_PAGE_CAP as u8,
    })
}

pub fn open_work_page_handler(ctx: Context<OpenWorkPage>) -> Result<()> {
    authenticate_lifecycle(&ctx.accounts.evidence_spec, &ctx.accounts.need)?;
    require!(
        matches!(ctx.accounts.need.state, NEED_OPEN | NEED_CANDIDATE),
        TimepinLifecycleError::TerminalOrWrongState
    );
    let need_key = ctx.accounts.need.key();
    let page = &mut ctx.accounts.work_page;
    if page.schema == 0 {
        page.initialize(ctx.bumps.work_page, need_key);
    }
    authenticate_work_account(page, page.key(), need_key)
}

pub fn reserve_work_handler(
    ctx: Context<ReserveWork>,
    work_kind: u8,
    expected_index: u8,
) -> Result<()> {
    authenticate_lifecycle(&ctx.accounts.evidence_spec, &ctx.accounts.need)?;
    require_work_reservable(&ctx.accounts.need, work_kind)?;
    let need_key = ctx.accounts.need.key();
    let page = &mut ctx.accounts.work_page;
    authenticate_work_account(page, page.key(), need_key)?;
    let index = page.reserve(need_key, work_kind, expected_index)?;
    require!(
        index == usize::from(expected_index),
        TimepinLifecycleError::WrongWorkRecordIndex
    );
    let new_len = work_account_len(page)?;
    fund_rent_growth(
        &ctx.accounts.actor,
        &page.to_account_info(),
        &ctx.accounts.system_program,
        new_len,
    )?;
    if page.to_account_info().data_len() != new_len {
        page.to_account_info().resize(new_len)?;
    }
    Ok(())
}

fn require_supported_work_kind(work_kind: u8) -> Result<()> {
    require!(
        matches!(work_kind, WORK_KIND_FIRST_CAPTURE | WORK_KIND_TERMINALIZE),
        TimepinLifecycleError::InvalidWorkKind
    );
    Ok(())
}

fn require_work_reservable(need: &TimepinNeedV2, work_kind: u8) -> Result<()> {
    require_supported_work_kind(work_kind)?;
    validate_need_shape(need)?;
    let eligible = match work_kind {
        WORK_KIND_FIRST_CAPTURE => need.state == NEED_OPEN,
        WORK_KIND_TERMINALIZE => matches!(need.state, NEED_OPEN | NEED_CANDIDATE),
        _ => false,
    };
    require!(eligible, TimepinLifecycleError::WorkNotReservable);
    Ok(())
}

fn work_page_pda(need: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[WORK_PAGE_SEED, need.as_ref()], &crate::ID)
}

fn work_account_len(page: &WorkPage) -> Result<usize> {
    WorkPage::serialized_len_for(page.records.len())?
        .checked_add(8)
        .ok_or(error!(TimepinLifecycleError::MathOverflow))
}

fn authenticate_work_page(page: &WorkPage, key: Pubkey, need: Pubkey) -> Result<()> {
    page.validate_contents()?;
    require!(page.need == need, TimepinLifecycleError::InvalidWorkPage);
    let (expected, bump) = work_page_pda(&need);
    require_keys_eq!(key, expected, TimepinLifecycleError::WrongWorkPagePda);
    require!(page.bump == bump, TimepinLifecycleError::WrongWorkPageBump);
    Ok(())
}

fn authenticate_work_account(
    page: &Account<'_, WorkPage>,
    key: Pubkey,
    need: Pubkey,
) -> Result<()> {
    authenticate_work_page(page, key, need)?;
    require!(
        page.to_account_info().data_len() == work_account_len(page)?,
        TimepinLifecycleError::WrongAccountLength
    );
    Ok(())
}

fn is_logically_uninitialized(account: &AccountInfo<'_>) -> bool {
    account.data_len() == 0
        && *account.owner == anchor_lang::system_program::ID
        && !account.executable
}

fn load_optional_work_page(account: &AccountInfo<'_>, need: Pubkey) -> Result<Option<WorkPage>> {
    let (expected, _) = work_page_pda(&need);
    require_keys_eq!(
        account.key(),
        expected,
        TimepinLifecycleError::WrongWorkPagePda
    );
    require!(account.is_writable, TimepinLifecycleError::ReadonlyWorkPage);
    if is_logically_uninitialized(account) {
        return Ok(None);
    }
    require!(
        !account.executable && *account.owner == crate::ID,
        TimepinLifecycleError::InvalidWorkPage
    );
    let data = account
        .try_borrow_data()
        .map_err(|_| error!(TimepinLifecycleError::InvalidWorkPage))?;
    let mut bytes: &[u8] = &data;
    let page = WorkPage::try_deserialize(&mut bytes)
        .map_err(|_| error!(TimepinLifecycleError::InvalidWorkPage))?;
    // Do not require `bytes.is_empty()`: Anchor may deserialize through an
    // internal slice. Exact dynamic length below is the trailing-byte policy.
    authenticate_work_page(&page, account.key(), need)?;
    require!(
        account.data_len() == work_account_len_value(&page)?,
        TimepinLifecycleError::WrongAccountLength
    );
    drop(data);
    Ok(Some(page))
}

fn work_account_len_value(page: &WorkPage) -> Result<usize> {
    WorkPage::serialized_len_for(page.records.len())?
        .checked_add(8)
        .ok_or(error!(TimepinLifecycleError::MathOverflow))
}

#[derive(Clone, Copy)]
struct WorkCompletion {
    work_kind: u8,
    disposition: u8,
    worker: Pubkey,
    action_fact_hash: [u8; 32],
}

fn apply_optional_work_completions(
    account: &AccountInfo<'_>,
    need: Pubkey,
    completions: &[WorkCompletion],
    completed_slot: u64,
) -> Result<()> {
    let Some(mut page) = load_optional_work_page(account, need)? else {
        return Ok(());
    };
    let changed = apply_work_completions_to_page(&mut page, need, completions, completed_slot)?;
    if changed {
        let mut data = account
            .try_borrow_mut_data()
            .map_err(|_| error!(TimepinLifecycleError::InvalidWorkPage))?;
        let mut destination: &mut [u8] = &mut data;
        page.try_serialize(&mut destination)
            .map_err(|_| error!(TimepinLifecycleError::InvalidWorkPage))?;
        require!(
            destination.is_empty(),
            TimepinLifecycleError::WrongAccountLength
        );
    }
    Ok(())
}

fn apply_work_completions_to_page(
    page: &mut WorkPage,
    need: Pubkey,
    completions: &[WorkCompletion],
    completed_slot: u64,
) -> Result<bool> {
    let mut changed = false;
    for completion in completions {
        require_supported_work_kind(completion.work_kind)?;
        let Some(index) = page
            .records
            .iter()
            .position(|record| record.subject == need && record.work_kind == completion.work_kind)
        else {
            continue;
        };
        let result_hash = completion_result_hash(
            &need,
            completion.work_kind,
            &completion.action_fact_hash,
            completion.disposition,
            &completion.worker,
        );
        page.complete_pending(
            index,
            need,
            completion.work_kind,
            completion.disposition,
            completion.worker,
            result_hash,
            completed_slot,
        )?;
        changed = true;
    }
    Ok(changed)
}

fn validate_optional_work_page(account: &AccountInfo<'_>, need: Pubkey) -> Result<()> {
    load_optional_work_page(account, need).map(|_| ())
}

fn fund_rent_growth<'info>(
    payer: &Signer<'info>,
    destination: &AccountInfo<'info>,
    system_program: &Program<'info, System>,
    new_len: usize,
) -> Result<()> {
    let required = Rent::get()?.minimum_balance(new_len);
    let current = destination.lamports();
    if required > current {
        anchor_lang::system_program::transfer(
            CpiContext::new(
                system_program.key(),
                anchor_lang::system_program::Transfer {
                    from: payer.to_account_info(),
                    to: destination.clone(),
                },
            ),
            required
                .checked_sub(current)
                .ok_or(TimepinLifecycleError::MathOverflow)?,
        )?;
    }
    Ok(())
}

pub fn capture_first_handler(
    ctx: Context<CaptureFirst>,
    expected_message_hash: [u8; 32],
) -> Result<()> {
    let spec = &ctx.accounts.evidence_spec;
    let need_key = ctx.accounts.need.key();
    authenticate_lifecycle(spec, &ctx.accounts.need)?;
    let clock = Clock::get()?;
    authenticate_capture_generation(
        spec,
        &ctx.accounts.receiver_program,
        &ctx.accounts.receiver_program_data,
        &ctx.accounts.receiver_config,
        &ctx.accounts.wormhole_program,
        &ctx.accounts.wormhole_program_data,
        &clock,
    )?;
    let candidate = load_evidence(
        spec,
        &ctx.accounts.need,
        &ctx.accounts.price_update.to_account_info(),
        &clock,
    )?;
    require!(
        price_message_hash(&spec.feed_id, &candidate) == expected_message_hash,
        TimepinLifecycleError::WrongExpectedMessageHash
    );

    let actor = ctx.accounts.actor.key();
    match ctx.accounts.need.state {
        NEED_OPEN => {
            require!(
                ctx.accounts.need.candidate_a_hash == [0; 32]
                    && ctx.accounts.need.candidate_b_hash == [0; 32],
                TimepinLifecycleError::CorruptNeed
            );
            require!(
                ctx.accounts.candidate.schema == 0,
                TimepinLifecycleError::CandidateAlreadyInitialized
            );
            write_candidate(
                &mut ctx.accounts.candidate,
                ctx.bumps.candidate,
                need_key,
                &candidate,
            );
            apply_optional_work_completions(
                &ctx.accounts.work_page.to_account_info(),
                need_key,
                &[WorkCompletion {
                    work_kind: WORK_KIND_FIRST_CAPTURE,
                    disposition: RECEIPT_PAYABLE,
                    worker: actor,
                    action_fact_hash: expected_message_hash,
                }],
                clock.slot,
            )?;
            let need = &mut ctx.accounts.need;
            need.state = NEED_CANDIDATE;
            need.candidate_a_hash = expected_message_hash;
            need.candidate_b_hash = [0; 32];
            emit!(EvidenceCapturedV2 {
                need: need_key,
                message_hash: expected_message_hash,
                actor,
                disposition: CaptureDispositionV2::Candidate as u8,
                state: NEED_CANDIDATE,
            });
        }
        NEED_CANDIDATE => {
            require!(
                ctx.accounts.need.candidate_a_hash == expected_message_hash
                    && ctx.accounts.need.candidate_b_hash == [0; 32],
                TimepinLifecycleError::UseConflictInstruction
            );
            authenticate_candidate(
                &ctx.accounts.candidate,
                ctx.accounts.candidate.key(),
                spec,
                &ctx.accounts.need,
                need_key,
                expected_message_hash,
            )?;
            validate_optional_work_page(&ctx.accounts.work_page.to_account_info(), need_key)?;
            emit!(EvidenceCapturedV2 {
                need: need_key,
                message_hash: expected_message_hash,
                actor,
                disposition: CaptureDispositionV2::Duplicate as u8,
                state: NEED_CANDIDATE,
            });
        }
        _ => return err!(TimepinLifecycleError::TerminalOrWrongState),
    }
    Ok(())
}

pub fn capture_conflict_handler(
    ctx: Context<CaptureConflict>,
    expected_message_hash: [u8; 32],
) -> Result<()> {
    let spec = &ctx.accounts.evidence_spec;
    let need_key = ctx.accounts.need.key();
    authenticate_lifecycle(spec, &ctx.accounts.need)?;
    require!(
        ctx.accounts.need.state == NEED_CANDIDATE
            && ctx.accounts.need.candidate_a_hash != [0; 32]
            && ctx.accounts.need.candidate_b_hash == [0; 32],
        TimepinLifecycleError::CandidateRequired
    );
    let first_hash = ctx.accounts.need.candidate_a_hash;
    authenticate_candidate(
        &ctx.accounts.candidate_a,
        ctx.accounts.candidate_a.key(),
        spec,
        &ctx.accounts.need,
        need_key,
        first_hash,
    )?;

    let clock = Clock::get()?;
    authenticate_capture_generation(
        spec,
        &ctx.accounts.receiver_program,
        &ctx.accounts.receiver_program_data,
        &ctx.accounts.receiver_config,
        &ctx.accounts.wormhole_program,
        &ctx.accounts.wormhole_program_data,
        &clock,
    )?;
    let candidate = load_evidence(
        spec,
        &ctx.accounts.need,
        &ctx.accounts.price_update.to_account_info(),
        &clock,
    )?;
    require!(
        price_message_hash(&spec.feed_id, &candidate) == expected_message_hash,
        TimepinLifecycleError::WrongExpectedMessageHash
    );
    require!(
        expected_message_hash != first_hash,
        TimepinLifecycleError::DuplicateMustUseFirstCapture
    );
    write_candidate(
        &mut ctx.accounts.candidate_b,
        ctx.bumps.candidate_b,
        need_key,
        &candidate,
    );
    let (candidate_a_hash, candidate_b_hash) = if first_hash < expected_message_hash {
        (first_hash, expected_message_hash)
    } else {
        (expected_message_hash, first_hash)
    };
    let need = &mut ctx.accounts.need;
    need.state = NEED_AMBIGUOUS;
    need.candidate_a_hash = candidate_a_hash;
    need.candidate_b_hash = candidate_b_hash;
    let result_hash = terminal_result_hash(need_key, need)?;
    let actor = ctx.accounts.actor.key();
    apply_optional_work_completions(
        &ctx.accounts.work_page.to_account_info(),
        need_key,
        &[WorkCompletion {
            work_kind: WORK_KIND_TERMINALIZE,
            disposition: RECEIPT_PAYABLE,
            worker: actor,
            action_fact_hash: result_hash,
        }],
        clock.slot,
    )?;
    emit!(EvidenceCapturedV2 {
        need: need_key,
        message_hash: expected_message_hash,
        actor,
        disposition: CaptureDispositionV2::Ambiguous as u8,
        state: NEED_AMBIGUOUS,
    });
    emit!(NeedTerminalizedV2 {
        need: need_key,
        terminal_kind: NEED_AMBIGUOUS,
        result_hash,
        actor,
    });
    Ok(())
}

pub fn finalize_handler(ctx: Context<FinalizeNeed>) -> Result<()> {
    let spec = &ctx.accounts.evidence_spec;
    let need_key = ctx.accounts.need.key();
    authenticate_lifecycle(spec, &ctx.accounts.need)?;
    require!(
        ctx.accounts.need.state == NEED_CANDIDATE
            && ctx.accounts.need.candidate_a_hash != [0; 32]
            && ctx.accounts.need.candidate_b_hash == [0; 32],
        TimepinLifecycleError::CandidateRequired
    );
    let candidate_hash = ctx.accounts.need.candidate_a_hash;
    authenticate_candidate(
        &ctx.accounts.candidate,
        ctx.accounts.candidate.key(),
        spec,
        &ctx.accounts.need,
        need_key,
        candidate_hash,
    )?;
    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= ctx.accounts.need.capture_deadline_ts,
        TimepinLifecycleError::CaptureWindowOpen
    );
    ctx.accounts.need.state = NEED_FINAL;
    let result_hash = terminal_result_hash(need_key, &ctx.accounts.need)?;
    let actor = ctx.accounts.actor.key();
    apply_optional_work_completions(
        &ctx.accounts.work_page.to_account_info(),
        need_key,
        &[WorkCompletion {
            work_kind: WORK_KIND_TERMINALIZE,
            disposition: RECEIPT_PAYABLE,
            worker: actor,
            action_fact_hash: result_hash,
        }],
        clock.slot,
    )?;
    emit!(NeedTerminalizedV2 {
        need: need_key,
        terminal_kind: NEED_FINAL,
        result_hash,
        actor,
    });
    Ok(())
}

pub fn expire_handler(ctx: Context<ExpireNeed>) -> Result<()> {
    let spec = &ctx.accounts.evidence_spec;
    let need_key = ctx.accounts.need.key();
    authenticate_lifecycle(spec, &ctx.accounts.need)?;
    require!(
        ctx.accounts.need.state == NEED_OPEN
            && ctx.accounts.need.candidate_a_hash == [0; 32]
            && ctx.accounts.need.candidate_b_hash == [0; 32],
        TimepinLifecycleError::UnansweredNeedRequired
    );
    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= ctx.accounts.need.capture_deadline_ts,
        TimepinLifecycleError::CaptureWindowOpen
    );
    ctx.accounts.need.state = NEED_EXPIRED;
    let result_hash = terminal_result_hash(need_key, &ctx.accounts.need)?;
    let actor = ctx.accounts.actor.key();
    apply_optional_work_completions(
        &ctx.accounts.work_page.to_account_info(),
        need_key,
        &[
            WorkCompletion {
                work_kind: WORK_KIND_FIRST_CAPTURE,
                disposition: RECEIPT_NONPAYABLE,
                worker: Pubkey::default(),
                action_fact_hash: result_hash,
            },
            WorkCompletion {
                work_kind: WORK_KIND_TERMINALIZE,
                disposition: RECEIPT_PAYABLE,
                worker: actor,
                action_fact_hash: result_hash,
            },
        ],
        clock.slot,
    )?;
    emit!(NeedTerminalizedV2 {
        need: need_key,
        terminal_kind: NEED_EXPIRED,
        result_hash,
        actor,
    });
    Ok(())
}

fn authenticate_lifecycle(
    spec: &Account<EvidenceSpecV2>,
    need: &Account<TimepinNeedV2>,
) -> Result<()> {
    let spec_info = spec.to_account_info();
    authenticate_spec_account(spec, &spec_info, &need.evidence_spec_hash)?;
    let need_info = need.to_account_info();
    require!(!need_info.executable, TimepinLifecycleError::ExecutableNeed);
    require!(
        need_info.data_len() == 8 + TimepinNeedV2::LEN,
        TimepinLifecycleError::BadNeedLength
    );
    let target = need.target_ts.to_le_bytes();
    let (_, canonical_bump) = Pubkey::find_program_address(
        &[
            NEED_SEED,
            SCHEMA_SEED.as_ref(),
            need.evidence_spec_hash.as_ref(),
            target.as_ref(),
        ],
        &crate::ID,
    );
    authenticate_need(
        need,
        spec,
        &need.evidence_spec_hash,
        need.target_ts,
        canonical_bump,
    )
}

#[allow(clippy::too_many_arguments)]
fn authenticate_capture_generation(
    spec: &EvidenceSpecV2,
    receiver_program: &Program<'_, PythSolanaReceiver>,
    receiver_program_data: &Account<'_, ProgramData>,
    receiver_config: &Account<'_, ReceiverConfig>,
    wormhole_program: &Program<'_>,
    wormhole_program_data: &Account<'_, ProgramData>,
    clock: &Clock,
) -> Result<()> {
    authenticate_generation_accounts(
        &spec.as_args(),
        receiver_program,
        receiver_program_data,
        receiver_config,
        wormhole_program,
        wormhole_program_data,
        clock,
    )?;
    require!(
        clock.slot >= spec.registered_slot
            && spec.registered_slot > spec.receiver_programdata_slot
            && spec.registered_slot > spec.wormhole_programdata_slot,
        TimepinV2Error::BadRegisteredSlot
    );
    Ok(())
}

fn sponsored_price_address(spec: &EvidenceSpecV2) -> Pubkey {
    // Push code is deliberately not a truth pin. Its official ID and PDA bind
    // the sponsored mutable source/liveness path; Receiver code, full config,
    // and Wormhole code are the generation-pinned authentication boundary.
    let shard = spec.shard_id.to_le_bytes();
    Pubkey::find_program_address(
        &[shard.as_ref(), spec.feed_id.as_ref()],
        &spec.push_oracle_program,
    )
    .0
}

pub fn price_message_hash(feed_id: &[u8; 32], candidate: &CandidateV2) -> [u8; 32] {
    hashv(&[
        PRICE_MESSAGE_HASH_DOMAIN,
        feed_id.as_ref(),
        &candidate.price.to_le_bytes(),
        &candidate.conf.to_le_bytes(),
        &candidate.exponent.to_le_bytes(),
        &candidate.publish_time.to_le_bytes(),
        &candidate.prev_publish_time.to_le_bytes(),
        &candidate.ema_price.to_le_bytes(),
        &candidate.ema_conf.to_le_bytes(),
    ])
    .to_bytes()
}

fn validate_decision_fields(
    spec: &EvidenceSpecV2,
    need: &TimepinNeedV2,
    candidate: &CandidateV2,
) -> Result<()> {
    if spec.adapter == ADAPTER_PYTH_MIN_CAPTURE_V2 {
        // MIN-CAPTURE: the earliest print at or after the target. finalize picks
        // the minimum over everything submitted, so admissibility here is only
        // "not before the target". prev_publish_time is not part of the predicate
        // and max_pre_target_gap_seconds is pinned to zero at registration.
        require!(
            candidate.publish_time >= need.target_ts,
            TimepinLifecycleError::PublishBeforeTarget
        );
    } else {
        require!(
            candidate.prev_publish_time < need.target_ts
                && need.target_ts <= candidate.publish_time,
            TimepinLifecycleError::DoesNotBracketTarget
        );
        let pre_gap = need
            .target_ts
            .checked_sub(candidate.prev_publish_time)
            .ok_or(TimepinLifecycleError::TimestampOverflow)?;
        require!(
            pre_gap <= i64::from(spec.max_pre_target_gap_seconds),
            TimepinLifecycleError::PreTargetGapTooLarge
        );
    }
    // Shared by both adapters: this bound is what keeps either rule finite.
    let post_lag = candidate
        .publish_time
        .checked_sub(need.target_ts)
        .ok_or(TimepinLifecycleError::TimestampOverflow)?;
    require!(
        post_lag <= i64::from(spec.max_post_target_lag_seconds),
        TimepinLifecycleError::PostTargetLagTooLarge
    );
    require!(
        candidate.publish_time <= need.source_deadline_ts,
        TimepinLifecycleError::SourceAfterDeadline
    );
    require!(candidate.price > 0, TimepinLifecycleError::NonPositivePrice);
    require!(
        candidate.exponent >= i32::from(spec.min_exponent)
            && candidate.exponent <= i32::from(spec.max_exponent),
        TimepinLifecycleError::ExponentOutOfBounds
    );
    let confidence = u128::from(candidate.conf)
        .checked_mul(10_000)
        .ok_or(TimepinLifecycleError::MathOverflow)?;
    let allowed = (candidate.price as u128)
        .checked_mul(u128::from(spec.max_confidence_bps))
        .ok_or(TimepinLifecycleError::MathOverflow)?;
    require!(
        confidence <= allowed,
        TimepinLifecycleError::ConfidenceTooWide
    );
    Ok(())
}

fn validate_posted_slots(registered_slot: u64, posted_slot: u64, observed_slot: u64) -> Result<()> {
    require!(
        posted_slot > registered_slot,
        TimepinLifecycleError::PostedBeforeOrAtRegistration
    );
    require!(
        posted_slot <= observed_slot,
        TimepinLifecycleError::PostedSlotInFuture
    );
    Ok(())
}

fn load_evidence(
    spec: &EvidenceSpecV2,
    need: &TimepinNeedV2,
    account: &AccountInfo,
    clock: &Clock,
) -> Result<CandidateV2> {
    require!(
        matches!(need.state, NEED_OPEN | NEED_CANDIDATE),
        TimepinLifecycleError::TerminalOrWrongState
    );
    require!(
        clock.unix_timestamp >= need.target_ts,
        TimepinLifecycleError::TargetNotReached
    );
    require!(
        clock.unix_timestamp < need.capture_deadline_ts,
        TimepinLifecycleError::CaptureWindowClosed
    );
    require!(!account.executable, TimepinLifecycleError::ExecutableSource);
    require_keys_eq!(
        *account.owner,
        spec.receiver_program,
        TimepinLifecycleError::WrongReceiverOwner
    );
    let expected_source = sponsored_price_address(spec);
    require_keys_eq!(
        account.key(),
        expected_source,
        TimepinLifecycleError::WrongSponsoredPriceAccount
    );
    require!(
        account.data_len() == PRICE_UPDATE_V2_LAYOUT_LEN,
        TimepinLifecycleError::BadPriceAccountData
    );
    let data = account
        .try_borrow_data()
        .map_err(|_| error!(TimepinLifecycleError::BadPriceAccountData))?;
    let mut slice: &[u8] = &data;
    let update = PriceUpdateV2::try_deserialize(&mut slice)
        .map_err(|_| error!(TimepinLifecycleError::BadPriceAccountData))?;
    require!(
        matches!(update.verification_level, VerificationLevel::Full),
        TimepinLifecycleError::PartialVerification
    );
    require_keys_eq!(
        update.write_authority,
        expected_source,
        TimepinLifecycleError::WrongWriteAuthority
    );
    validate_posted_slots(spec.registered_slot, update.posted_slot, clock.slot)?;
    let message = update.price_message;
    require!(
        message.feed_id == spec.feed_id,
        TimepinLifecycleError::WrongFeed
    );
    let candidate = CandidateV2 {
        schema: SCHEMA_VERSION,
        bump: 0,
        need: Pubkey::default(),
        price: message.price,
        conf: message.conf,
        exponent: message.exponent,
        publish_time: message.publish_time,
        prev_publish_time: message.prev_publish_time,
        ema_price: message.ema_price,
        ema_conf: message.ema_conf,
        posted_slot: update.posted_slot,
        capture_slot: clock.slot,
        capture_ts: clock.unix_timestamp,
    };
    validate_decision_fields(spec, need, &candidate)?;
    let newest_allowed = clock
        .unix_timestamp
        .checked_add(i64::from(spec.max_future_skew_seconds))
        .ok_or(TimepinLifecycleError::TimestampOverflow)?;
    require!(
        candidate.publish_time <= newest_allowed,
        TimepinLifecycleError::OracleTimeInFuture
    );
    Ok(candidate)
}

fn authenticate_candidate(
    candidate: &Account<'_, CandidateV2>,
    candidate_key: Pubkey,
    spec: &EvidenceSpecV2,
    need: &TimepinNeedV2,
    need_key: Pubkey,
    expected_hash: [u8; 32],
) -> Result<()> {
    require!(
        candidate.to_account_info().data_len() == 8 + CandidateV2::LEN,
        TimepinLifecycleError::CorruptCandidate
    );
    let (expected_key, expected_bump) = Pubkey::find_program_address(
        &[CANDIDATE_SEED, need_key.as_ref(), expected_hash.as_ref()],
        &crate::ID,
    );
    require_keys_eq!(
        candidate_key,
        expected_key,
        TimepinLifecycleError::WrongCandidatePda
    );
    require!(
        candidate.schema == SCHEMA_VERSION
            && candidate.bump == expected_bump
            && candidate.need == need_key,
        TimepinLifecycleError::CorruptCandidate
    );
    require!(
        candidate.capture_ts >= need.target_ts && candidate.capture_ts < need.capture_deadline_ts,
        TimepinLifecycleError::CorruptCandidate
    );
    validate_posted_slots(
        spec.registered_slot,
        candidate.posted_slot,
        candidate.capture_slot,
    )
    .map_err(|_| error!(TimepinLifecycleError::CorruptCandidate))?;
    validate_decision_fields(spec, need, candidate)?;
    require!(
        price_message_hash(&spec.feed_id, candidate) == expected_hash,
        TimepinLifecycleError::CorruptCandidateHash
    );
    Ok(())
}

fn write_candidate(destination: &mut CandidateV2, bump: u8, need: Pubkey, candidate: &CandidateV2) {
    *destination = CandidateV2 {
        schema: SCHEMA_VERSION,
        bump,
        need,
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
}

pub fn terminal_result_hash(need_key: Pubkey, need: &TimepinNeedV2) -> Result<[u8; 32]> {
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
        _ => err!(TimepinLifecycleError::TerminalStateRequired),
    }
}

pub fn completion_result_hash(
    subject: &Pubkey,
    work_kind: u8,
    action_fact_hash: &[u8; 32],
    disposition: u8,
    worker: &Pubkey,
) -> [u8; 32] {
    hashv(&[
        COMPLETION_RESULT_HASH_DOMAIN,
        subject.as_ref(),
        &[work_kind],
        action_fact_hash.as_ref(),
        &[disposition],
        worker.as_ref(),
    ])
    .to_bytes()
}

#[repr(u8)]
enum CaptureDispositionV2 {
    Candidate = 1,
    Duplicate = 2,
    Ambiguous = 3,
}

#[event]
pub struct EvidenceCapturedV2 {
    pub need: Pubkey,
    pub message_hash: [u8; 32],
    pub actor: Pubkey,
    pub disposition: u8,
    pub state: u8,
}

#[event]
pub struct NeedTerminalizedV2 {
    pub need: Pubkey,
    pub terminal_kind: u8,
    pub result_hash: [u8; 32],
    pub actor: Pubkey,
}

#[error_code]
pub enum TimepinLifecycleError {
    #[msg("Need account must not be executable")]
    ExecutableNeed,
    #[msg("Need account length is wrong")]
    BadNeedLength,
    #[msg("Need state or candidate hashes are corrupt")]
    CorruptNeed,
    #[msg("Need is terminal or incompatible with this instruction")]
    TerminalOrWrongState,
    #[msg("target has not been reached")]
    TargetNotReached,
    #[msg("capture window has closed")]
    CaptureWindowClosed,
    #[msg("capture window is still open")]
    CaptureWindowOpen,
    #[msg("price account must not be executable")]
    ExecutableSource,
    #[msg("price account is not owned by the pinned Pyth Receiver")]
    WrongReceiverOwner,
    #[msg("price account is not the pinned sponsored shard PDA")]
    WrongSponsoredPriceAccount,
    #[msg("Pyth price account data is invalid")]
    BadPriceAccountData,
    #[msg("Pyth message is not fully verified")]
    PartialVerification,
    #[msg("Pyth write authority is not the sponsored shard PDA")]
    WrongWriteAuthority,
    #[msg("Pyth posted slot is not strictly after EvidenceSpec registration")]
    PostedBeforeOrAtRegistration,
    #[msg("Pyth posted slot is ahead of the Solana clock")]
    PostedSlotInFuture,
    #[msg("Pyth feed does not match the EvidenceSpec")]
    WrongFeed,
    #[msg("signed Pyth interval does not bracket the target")]
    DoesNotBracketTarget,
    #[msg("signed predecessor is outside the policy gap")]
    PreTargetGapTooLarge,
    #[msg("signed publication is outside the policy lag")]
    PostTargetLagTooLarge,
    #[msg("signed publication is after the source deadline")]
    SourceAfterDeadline,
    #[msg("Pyth price must be positive")]
    NonPositivePrice,
    #[msg("Pyth exponent is outside the policy range")]
    ExponentOutOfBounds,
    #[msg("Pyth confidence is wider than the policy bound")]
    ConfidenceTooWide,
    #[msg("Pyth publication time is implausibly ahead of Solana Clock")]
    OracleTimeInFuture,
    #[msg("timestamp arithmetic overflow")]
    TimestampOverflow,
    #[msg("integer arithmetic overflow")]
    MathOverflow,
    #[msg("computed message hash differs from the instruction argument")]
    WrongExpectedMessageHash,
    #[msg("Candidate account is already initialized inconsistently")]
    CandidateAlreadyInitialized,
    #[msg("a different message must use capture_conflict")]
    UseConflictInstruction,
    #[msg("duplicate message must use capture_first")]
    DuplicateMustUseFirstCapture,
    #[msg("one Candidate is required")]
    CandidateRequired,
    #[msg("an unanswered Open Need is required")]
    UnansweredNeedRequired,
    #[msg("Candidate PDA is wrong")]
    WrongCandidatePda,
    #[msg("Candidate fields or account length are corrupt")]
    CorruptCandidate,
    #[msg("Candidate message hash is corrupt")]
    CorruptCandidateHash,
    #[msg("terminal Need state is required")]
    TerminalStateRequired,
    #[msg("work kind is unsupported")]
    InvalidWorkKind,
    #[msg("work is no longer reservable")]
    WorkNotReservable,
    #[msg("WorkPage fields are invalid")]
    InvalidWorkPage,
    #[msg("WorkPage PDA is wrong")]
    WrongWorkPagePda,
    #[msg("WorkPage bump is wrong")]
    WrongWorkPageBump,
    #[msg("optional WorkPage must be writable")]
    ReadonlyWorkPage,
    #[msg("WorkPage has reached its fixed capacity")]
    WorkPageFull,
    #[msg("WorkPage contains duplicate subject/kind records")]
    DuplicateWorkRecord,
    #[msg("work record index is wrong")]
    WrongWorkRecordIndex,
    #[msg("work record is missing")]
    WorkRecordMissing,
    #[msg("work record is not pending")]
    WorkRecordNotPending,
    #[msg("work disposition is invalid")]
    InvalidWorkDisposition,
    #[msg("work record shape is invalid")]
    InvalidWorkRecord,
    #[msg("account length is wrong")]
    WrongAccountLength,
    #[msg("account discriminator width is wrong")]
    WrongAccountDiscriminator,
    #[msg("immutable account differs from compiled constants")]
    ImmutableAccountMismatch,
    // APPENDED HERE ON PURPOSE, and it must stay at the tail. Anchor assigns
    // error codes by declaration order, so moving this up next to its relatives
    // (DoesNotBracketTarget, PreTargetGapTooLarge) silently renumbers every
    // variant below it -- every client mapping a numeric code, every vector and
    // every test asserting a number. Reading out of place is the cost of not
    // breaking them.
    #[msg("signed publication is before the target")]
    PublishBeforeTarget,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        canonical_policy_bytes, evidence_policy_hash, ADAPTER_PYTH_PUSH_V2, VERIFICATION_FULL,
    };
    use pyth_solana_receiver_sdk::{ID_CONST as PYTH_RECEIVER_ID, PYTH_PUSH_ORACLE_ID};

    fn spec() -> EvidenceSpecV2 {
        let mut value = EvidenceSpecV2 {
            schema: SCHEMA_VERSION,
            adapter: ADAPTER_PYTH_PUSH_V2,
            receiver_program: PYTH_RECEIVER_ID,
            push_oracle_program: PYTH_PUSH_ORACLE_ID,
            shard_id: 0,
            feed_id: [3; 32],
            required_verification: VERIFICATION_FULL,
            target_grid_seconds: 60,
            min_open_lead_seconds: 30,
            max_target_ahead_seconds: 3_600,
            max_pre_target_gap_seconds: 120,
            max_post_target_lag_seconds: 120,
            capture_grace_seconds: 60,
            max_future_skew_seconds: 5,
            min_exponent: -12,
            max_exponent: 2,
            max_confidence_bps: 1_000,
            evidence_policy_hash: [0; 32],
            receiver_programdata_slot: 40,
            receiver_config_hash: [9; 32],
            wormhole_program: Pubkey::new_from_array([8; 32]),
            wormhole_programdata_slot: 41,
            registered_slot: 42,
        };
        value.evidence_policy_hash =
            evidence_policy_hash(&canonical_policy_bytes(&value.as_args()).unwrap());
        value
    }

    fn need(state: u8) -> TimepinNeedV2 {
        let (a, b) = match state {
            NEED_CANDIDATE | NEED_FINAL => ([7; 32], [0; 32]),
            NEED_AMBIGUOUS => ([7; 32], [8; 32]),
            _ => ([0; 32], [0; 32]),
        };
        TimepinNeedV2 {
            schema: SCHEMA_VERSION,
            bump: 255,
            state,
            evidence_spec_hash: [4; 32],
            target_ts: 1_800,
            source_deadline_ts: 1_920,
            capture_deadline_ts: 1_980,
            candidate_a_hash: a,
            candidate_b_hash: b,
        }
    }

    // ---- Structural properties, proved from the parameters themselves --------
    // Written by the lead and injected into a cloud copy before being handed
    // over (docs/reviews/opus-lead-2026-09-05/STRUCTURAL_TESTS.md); landed here
    // because lifecycle.rs is my claim. These need no cadence measurement. A 24 h
    // run tells us how ALIVE the game is; these say what is TRUE of it, and they
    // are decided by arithmetic the moment a spec is registered.

    /// Under MIN-CAPTURE a print is admissible for target T iff
    ///     T <= publish_time <= T + lag
    /// so a single print serves two consecutive targets T and T+grid iff
    ///     T+grid <= publish_time <= T+lag,  i.e. iff  lag >= grid.
    /// Therefore lag < grid is NECESSARY AND SUFFICIENT for every print to
    /// belong to at most one target. No measurement can establish this and no
    /// measurement can refute it.
    fn serves_two_targets(lag: i64, grid: i64) -> bool {
        let t = 1_800i64;
        (t..=t + lag).any(|p| p >= t + grid && p <= t + grid + lag)
    }

    #[test]
    fn lag_below_grid_is_exactly_the_condition_for_unique_target_assignment() {
        for grid in [30i64, 60, 300] {
            for lag in 1..grid {
                assert!(!serves_two_targets(lag, grid), "lag {lag} grid {grid}");
            }
        }
        for grid in [30i64, 60, 300] {
            assert!(serves_two_targets(grid, grid), "grid {grid}");
            assert!(serves_two_targets(grid + 1, grid));
        }
    }

    #[test]
    fn the_spec_does_not_yet_enforce_it_and_that_is_the_gap() {
        // Documents the hole rather than the fix. It is DESIGNED TO FAIL the day
        // the `lag < grid` invariant lands in validate_spec, and that failure is
        // the signal to delete this test -- never to weaken the rule.
        //
        // This is not hypothetical: releases/g2-mainnet-economy.json proposes
        // grid 60 with lag 120 for ETH, BONK, PUMP, JUP and WIF -- exactly the
        // pair below -- so five of seven feeds would today register a spec in
        // which one print settles two consecutive targets.
        let mut args = spec().as_args();
        args.target_grid_seconds = 60;
        args.max_post_target_lag_seconds = 120; // twice the grid
        assert!(
            crate::validate_spec(&args).is_ok(),
            "if this now fails, the invariant landed - remove this test"
        );
    }

    fn candidate() -> CandidateV2 {
        CandidateV2 {
            schema: SCHEMA_VERSION,
            bump: 254,
            need: Pubkey::new_from_array([5; 32]),
            price: 10_000,
            conf: 10,
            exponent: -8,
            publish_time: 1_800,
            prev_publish_time: 1_799,
            ema_price: 9_999,
            ema_conf: 11,
            posted_slot: 43,
            capture_slot: 44,
            capture_ts: 1_801,
        }
    }

    #[test]
    fn compact_candidate_and_work_abi_sizes_are_exact() {
        let mut candidate_bytes = Vec::new();
        candidate().try_serialize(&mut candidate_bytes).unwrap();
        assert_eq!(CandidateV2::LEN, 111);
        assert_eq!(candidate_bytes.len(), 119);

        let mut record_bytes = Vec::new();
        WorkRecord {
            subject: Pubkey::new_unique(),
            work_kind: WORK_KIND_FIRST_CAPTURE,
            disposition: RECEIPT_PENDING,
            worker: Pubkey::default(),
            result_hash: [0; 32],
            completed_slot: 0,
        }
        .serialize(&mut record_bytes)
        .unwrap();
        assert_eq!(record_bytes.len(), 106);
        assert_eq!(WorkPage::BASE_LEN, 39);
        assert_eq!(WORK_PAGE_RECORDS_OFFSET, 47);
        assert_eq!(WorkPage::MAX_LEN, 251);
        assert_eq!(8 + WorkPage::MAX_LEN, 259);
        assert_eq!(WorkManifest::LEN, 34);
        assert_eq!(8 + WorkManifest::LEN, 42);
        for work_kind in [WORK_KIND_FIRST_CAPTURE, WORK_KIND_TERMINALIZE] {
            let manifest = work_manifest_definition(253, work_kind).unwrap();
            assert_eq!(manifest.schema_version, 1);
            assert_eq!(manifest.bump, 253);
            assert_eq!(manifest.work_kind, work_kind);
            assert_eq!(manifest.completion_schema_version, 1);
            assert_eq!(manifest.locator_mode, 2);
            assert_eq!(manifest.subject_schema_version, SCHEMA_VERSION);
            assert_eq!(manifest.subject_account_size, 132);
            assert_eq!(manifest.subject_discriminator, TimepinNeedV2::DISCRIMINATOR);
            assert_eq!(manifest.locator_schema_version, 1);
            assert_eq!(manifest.locator_discriminator, WorkPage::DISCRIMINATOR);
            assert_eq!(manifest.records_offset, 47);
            assert_eq!(manifest.entry_len, 106);
            assert_eq!(manifest.locator_capacity, 2);
        }
    }

    #[test]
    fn compact_candidate_recomputes_the_unchanged_message_hash() {
        let feed = spec().feed_id;
        let original = candidate();
        let hash = price_message_hash(&feed, &original);
        let mut metadata_only = candidate();
        metadata_only.capture_slot += 10;
        metadata_only.capture_ts += 10;
        metadata_only.posted_slot += 1;
        assert_eq!(price_message_hash(&feed, &metadata_only), hash);
        let mut changed_message = candidate();
        changed_message.price += 1;
        assert_ne!(price_message_hash(&feed, &changed_message), hash);
        let mut changed_feed = feed;
        changed_feed[0] ^= 1;
        assert_ne!(price_message_hash(&changed_feed, &original), hash);
    }

    #[test]
    fn capture_must_be_strictly_after_registration_slot() {
        assert!(validate_posted_slots(42, 43, 43).is_ok());
        assert!(validate_posted_slots(42, 42, 43).is_err());
        assert!(validate_posted_slots(42, 41, 43).is_err());
        assert!(validate_posted_slots(42, 44, 43).is_err());
    }

    #[test]
    fn no_work_page_records_never_gate_permissionless_completion() {
        let subject = Pubkey::new_unique();
        let mut page = WorkPage::default();
        page.initialize(255, subject);
        let changed = apply_work_completions_to_page(
            &mut page,
            subject,
            &[WorkCompletion {
                work_kind: WORK_KIND_FIRST_CAPTURE,
                disposition: RECEIPT_PAYABLE,
                worker: Pubkey::new_unique(),
                action_fact_hash: [1; 32],
            }],
            50,
        )
        .unwrap();
        assert!(!changed);
        assert!(page.records.is_empty());
    }

    #[test]
    fn two_record_sponsored_path_completes_each_kind_once() {
        let subject = Pubkey::new_unique();
        let first_worker = Pubkey::new_unique();
        let terminal_worker = Pubkey::new_unique();
        let first_fact = [1; 32];
        let terminal_fact = [2; 32];
        let mut page = WorkPage::default();
        page.initialize(255, subject);
        assert_eq!(
            page.reserve(subject, WORK_KIND_FIRST_CAPTURE, 0).unwrap(),
            0
        );
        assert_eq!(page.reserve(subject, WORK_KIND_TERMINALIZE, 1).unwrap(), 1);
        assert!(apply_work_completions_to_page(
            &mut page,
            subject,
            &[WorkCompletion {
                work_kind: WORK_KIND_FIRST_CAPTURE,
                disposition: RECEIPT_PAYABLE,
                worker: first_worker,
                action_fact_hash: first_fact,
            }],
            50,
        )
        .unwrap());
        assert!(apply_work_completions_to_page(
            &mut page,
            subject,
            &[WorkCompletion {
                work_kind: WORK_KIND_TERMINALIZE,
                disposition: RECEIPT_PAYABLE,
                worker: terminal_worker,
                action_fact_hash: terminal_fact,
            }],
            60,
        )
        .unwrap());
        assert_eq!(page.records[0].disposition, RECEIPT_PAYABLE);
        assert_eq!(page.records[0].worker, first_worker);
        assert_eq!(
            page.records[0].result_hash,
            completion_result_hash(
                &subject,
                WORK_KIND_FIRST_CAPTURE,
                &first_fact,
                RECEIPT_PAYABLE,
                &first_worker,
            )
        );
        assert_eq!(page.records[1].disposition, RECEIPT_PAYABLE);
        assert_eq!(page.records[1].worker, terminal_worker);
        assert!(page.validate_contents().is_ok());
    }

    #[test]
    fn expiry_makes_capture_nonpayable_and_terminalization_payable() {
        let subject = Pubkey::new_unique();
        let terminal_worker = Pubkey::new_unique();
        let fact = terminal_result_hash(subject, &need(NEED_EXPIRED)).unwrap();
        let mut page = WorkPage::default();
        page.initialize(255, subject);
        page.reserve(subject, WORK_KIND_FIRST_CAPTURE, 0).unwrap();
        page.reserve(subject, WORK_KIND_TERMINALIZE, 1).unwrap();
        assert!(apply_work_completions_to_page(
            &mut page,
            subject,
            &[
                WorkCompletion {
                    work_kind: WORK_KIND_FIRST_CAPTURE,
                    disposition: RECEIPT_NONPAYABLE,
                    worker: Pubkey::default(),
                    action_fact_hash: fact,
                },
                WorkCompletion {
                    work_kind: WORK_KIND_TERMINALIZE,
                    disposition: RECEIPT_PAYABLE,
                    worker: terminal_worker,
                    action_fact_hash: fact,
                },
            ],
            70,
        )
        .unwrap());
        assert_eq!(page.records[0].disposition, RECEIPT_NONPAYABLE);
        assert_eq!(page.records[0].worker, Pubkey::default());
        assert_eq!(page.records[1].disposition, RECEIPT_PAYABLE);
        assert_eq!(page.records[1].worker, terminal_worker);
        assert!(page.validate_contents().is_ok());
    }

    #[test]
    fn reservability_and_terminal_hashes_are_state_derived() {
        assert!(require_work_reservable(&need(NEED_OPEN), WORK_KIND_FIRST_CAPTURE).is_ok());
        assert!(require_work_reservable(&need(NEED_OPEN), WORK_KIND_TERMINALIZE).is_ok());
        assert!(require_work_reservable(&need(NEED_CANDIDATE), WORK_KIND_FIRST_CAPTURE).is_err());
        assert!(require_work_reservable(&need(NEED_CANDIDATE), WORK_KIND_TERMINALIZE).is_ok());
        assert!(require_work_reservable(&need(NEED_FINAL), WORK_KIND_TERMINALIZE).is_err());

        let subject = Pubkey::new_unique();
        let final_hash = terminal_result_hash(subject, &need(NEED_FINAL)).unwrap();
        let ambiguous_hash = terminal_result_hash(subject, &need(NEED_AMBIGUOUS)).unwrap();
        let expired_hash = terminal_result_hash(subject, &need(NEED_EXPIRED)).unwrap();
        assert_ne!(final_hash, ambiguous_hash);
        assert_ne!(final_hash, expired_hash);
        assert_ne!(ambiguous_hash, expired_hash);
        assert!(terminal_result_hash(subject, &need(NEED_OPEN)).is_err());
    }

    // ------------------------------------------------------------------
    // MIN_CAPTURE_SPEC.md section 7 -- the settlement predicate, negatively.
    //
    // Until these existed there was NO host or SBF test that called
    // validate_decision_fields negatively at any level. That is not a gap in
    // coverage, it is the reason a rule that settles 11 % of real targets
    // reached the build queue unchallenged: nothing ever asked it to refuse.
    //
    // Each case mirrors one already green in test/test_client_model_parity.mjs,
    // so the JS model and the program are asserted rung for rung on the same
    // ladder. If the two ever disagree, one of the two suites goes red.
    // ------------------------------------------------------------------

    fn assert_err(result: Result<()>, expected: &str) {
        let message = result
            .expect_err("expected this candidate to be refused")
            .to_string();
        assert!(
            message.contains(expected),
            "expected error containing {expected}, got {message}"
        );
    }

    /// A spec on the mainnet-class adapter. The pre-gap is pinned to zero
    /// because validate_spec refuses adapter 2 with any other value.
    fn min_capture_spec() -> EvidenceSpecV2 {
        let mut value = spec();
        value.adapter = ADAPTER_PYTH_MIN_CAPTURE_V2;
        value.max_pre_target_gap_seconds = 0;
        value
    }

    /// A candidate whose publish/prev pair is set explicitly. `need(NEED_OPEN)`
    /// targets 1_800, so these are all relative to that second.
    fn at(publish_time: i64, prev_publish_time: i64) -> CandidateV2 {
        let mut value = candidate();
        value.publish_time = publish_time;
        value.prev_publish_time = prev_publish_time;
        value
    }

    #[test]
    fn min_capture_accepts_the_target_second_and_refuses_the_one_before() {
        let spec = min_capture_spec();
        let need = need(NEED_OPEN);
        validate_decision_fields(&spec, &need, &at(1_800, 1_799)).unwrap();
        assert_err(
            validate_decision_fields(&spec, &need, &at(1_799, 1_798)),
            "PublishBeforeTarget",
        );
    }

    #[test]
    fn min_capture_accepts_a_print_later_than_the_target_and_the_bracket_does_not() {
        // The measured failure, turned into an assertion. Over 442 targets the
        // bracket settles 11.1 % on SOL/BTC and 0-1.6 % on the slow feeds, while
        // MIN-CAPTURE settles 100.0 % on every one: the sponsored pusher posts on
        // its own schedule at a phase that sweeps, so the print that actually
        // lands is usually not the one that brackets the target second.
        let late = at(1_804, 1_803);
        validate_decision_fields(&min_capture_spec(), &need(NEED_OPEN), &late).unwrap();
        assert_err(
            validate_decision_fields(&spec(), &need(NEED_OPEN), &late),
            "DoesNotBracketTarget",
        );
    }

    #[test]
    fn the_two_adapters_disagree_on_an_intra_second_repeat_deliberately() {
        // pub == prev == T. On a full-aggregate source these repeats carry
        // genuinely different prices, conf and ema -- measured 20 of 98 keys
        // with up to three distinct signed messages. The strict `<` on the left
        // is the only thing excluding them, which is why the two predicates
        // must never be "unified" into one. MIN-CAPTURE is safe from the tie
        // only because the sponsored PDA holds one message at a time.
        let repeat = at(1_800, 1_800);
        validate_decision_fields(&min_capture_spec(), &need(NEED_OPEN), &repeat).unwrap();
        assert_err(
            validate_decision_fields(&spec(), &need(NEED_OPEN), &repeat),
            "DoesNotBracketTarget",
        );
    }

    #[test]
    fn the_post_target_lag_bound_is_what_keeps_min_capture_finite() {
        let spec = min_capture_spec();
        let need = need(NEED_OPEN);
        let edge = need.target_ts + i64::from(spec.max_post_target_lag_seconds);
        // source_deadline_ts is 1_920 and the lag bound is 120, so the lag edge
        // sits exactly on the deadline; one second past it must fail on the lag.
        validate_decision_fields(&spec, &need, &at(edge, edge - 1)).unwrap();
        assert_err(
            validate_decision_fields(&spec, &need, &at(edge + 1, edge)),
            "PostTargetLagTooLarge",
        );
    }

    #[test]
    fn the_pre_target_gap_is_live_under_the_bracket_and_inert_under_min_capture() {
        // A print whose predecessor is far behind the target. The bracket
        // refuses it on the gap; MIN-CAPTURE has no opinion, because
        // prev_publish_time is not part of its predicate at all.
        let mut bracket = spec();
        bracket.max_pre_target_gap_seconds = 5;
        let stale = at(1_800, 1_700);
        assert_err(
            validate_decision_fields(&bracket, &need(NEED_OPEN), &stale),
            "PreTargetGapTooLarge",
        );
        validate_decision_fields(&min_capture_spec(), &need(NEED_OPEN), &stale).unwrap();
    }

    #[test]
    fn the_bracket_still_refuses_a_predecessor_at_or_after_the_target() {
        // Guards the branch I moved: adapter 1 must behave exactly as before.
        assert_err(
            validate_decision_fields(&spec(), &need(NEED_OPEN), &at(1_801, 1_800)),
            "DoesNotBracketTarget",
        );
    }

    #[test]
    fn publish_before_target_stays_at_the_tail_of_the_error_enum() {
        // Anchor assigns error codes by DECLARATION ORDER, so a new variant is
        // only safe at the end. Moving PublishBeforeTarget up next to its
        // relatives -- which is exactly what a tidy-minded reader would do,
        // because it reads badly where it is -- silently renumbers every variant
        // below it and breaks every client, vector and test that maps a number.
        //
        // That rule was a comment. A comment is a hope. This is the same rule as
        // an assertion: the new variant must sit after every variant that existed
        // before it, and the ones clients already map must keep their order.
        use TimepinLifecycleError::*;
        let tail = PublishBeforeTarget as u32;
        for (name, code) in [
            ("DoesNotBracketTarget", DoesNotBracketTarget as u32),
            ("PreTargetGapTooLarge", PreTargetGapTooLarge as u32),
            ("PostTargetLagTooLarge", PostTargetLagTooLarge as u32),
            ("ImmutableAccountMismatch", ImmutableAccountMismatch as u32),
        ] {
            assert!(
                code < tail,
                "{name} is {code} and PublishBeforeTarget is {tail}: the new variant \
                 was moved out of the tail and every code below it has shifted"
            );
        }
        // And the three the predicate itself returns must stay in their original
        // relative order, which is what pins them for anyone decoding a receipt.
        assert!((DoesNotBracketTarget as u32) < (PreTargetGapTooLarge as u32));
        assert!((PreTargetGapTooLarge as u32) < (PostTargetLagTooLarge as u32));
    }
}
