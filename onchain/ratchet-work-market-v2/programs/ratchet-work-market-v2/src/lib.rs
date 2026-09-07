//! Ratchet RCX Work Market v2.
//!
//! V2 accepts a work kind only when the chosen immutable completion program
//! owns an exact per-kind `WorkManifest` PDA. A voucher preserves an
//! authoritative completion locator. The locator is either a canonical direct
//! receipt or a slot in a standard packed work page; both are parsed here before
//! funding and again before value can move.

use anchor_lang::prelude::*;
use anchor_spl::{
    memo::{self, BuildMemo, Memo},
    token_2022,
    token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked},
};
use solana_sha256_hasher::hashv;

declare_id!("gBxS1f6uyyGPuW5MzGBukidSb71jdsCb5fZaoSzULE5");

pub const SCHEMA_VERSION: u16 = 2;
pub const MANIFEST_SCHEMA_VERSION: u16 = 1;
pub const COMPLETION_SCHEMA_VERSION: u16 = 1;
pub const RCX_DECIMALS: u8 = 6;
pub const RCX_MINT: Pubkey = pubkey!("FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump");
pub const RECEIPT_PENDING: u8 = 0;
pub const RECEIPT_PAYABLE: u8 = 1;
pub const RECEIPT_NONPAYABLE: u8 = 2;
pub const LOCATOR_MODE_DIRECT_RECEIPT: u8 = 1;
pub const LOCATOR_MODE_PACKED_WORK_PAGE: u8 = 2;
pub const DIRECT_COMPLETION_RECEIPT_LEN: usize = 8 + CompletionReceipt::LEN;
pub const WORK_RECORD_LEN: usize = 106;
pub const MAX_WORK_PAGE_RECORDS: u8 = 48;
pub const WORK_MANIFEST_SEED: &[u8] = b"work_manifest";
pub const SETTLEMENT_MEMO_DOMAIN: &[u8] = b"rcx-work-market:settle:v2\0";

#[program]
pub mod ratchet_work_market_v2 {
    use super::*;

    pub fn fund_rcx_voucher(
        ctx: Context<FundRcxVoucher>,
        nonce: u64,
        work_kind: u8,
        locator_slot: u8,
        amount: u64,
    ) -> Result<()> {
        require!(work_kind > 0, WorkMarketV2Error::InvalidWorkKind);
        require!(amount > 0, WorkMarketV2Error::InvalidAmount);
        require_keys_eq!(
            ctx.accounts.token_program.key(),
            token_2022::ID,
            WorkMarketV2Error::WrongTokenProgram
        );
        require!(
            ctx.accounts.mint.decimals == RCX_DECIMALS,
            WorkMarketV2Error::WrongDecimals
        );

        let completion_program = ctx.accounts.completion_program.key();
        let subject = ctx.accounts.subject.key();
        let completion_locator = ctx.accounts.completion_locator.key();
        let manifest = load_work_manifest(
            &ctx.accounts.work_manifest.to_account_info(),
            &completion_program,
            work_kind,
        )?;
        validate_subject_account(
            &ctx.accounts.subject.to_account_info(),
            &completion_program,
            &manifest,
        )?;
        let completion = load_completion_record(
            &ctx.accounts.completion_locator.to_account_info(),
            &completion_program,
            &subject,
            work_kind,
            locator_slot,
            &manifest,
        )?;
        require!(
            completion.disposition == RECEIPT_PENDING,
            WorkMarketV2Error::CompletionNotPending
        );

        let clock = Clock::get()?;
        let voucher = &mut ctx.accounts.voucher;
        voucher.schema_version = SCHEMA_VERSION;
        voucher.bump = ctx.bumps.voucher;
        voucher.state = VoucherState::Funded as u8;
        voucher.work_kind = work_kind;
        voucher.completion_program = completion_program;
        voucher.subject = subject;
        voucher.completion_locator = completion_locator;
        voucher.locator_slot = locator_slot;
        voucher.sponsor = ctx.accounts.sponsor.key();
        voucher.nonce = nonce;
        voucher.funded_amount = amount;
        voucher.settled_amount = 0;
        voucher.funded_slot = clock.slot;
        voucher.funded_ts = clock.unix_timestamp;
        voucher.beneficiary = Pubkey::default();
        voucher.result_hash = [0u8; 32];

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.sponsor_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.sponsor.to_account_info(),
                },
            ),
            amount,
            RCX_DECIMALS,
        )?;

        emit!(VoucherFundedV2 {
            voucher: voucher.key(),
            sponsor: voucher.sponsor,
            completion_program,
            work_manifest: ctx.accounts.work_manifest.key(),
            subject,
            completion_locator,
            locator_slot,
            work_kind,
            nonce,
            amount,
        });
        Ok(())
    }

    pub fn claim_rcx_voucher(ctx: Context<ClaimRcxVoucher>) -> Result<()> {
        let voucher_key = ctx.accounts.voucher.key();
        let manifest = load_work_manifest(
            &ctx.accounts.work_manifest.to_account_info(),
            &ctx.accounts.voucher.completion_program,
            ctx.accounts.voucher.work_kind,
        )?;
        let receipt = load_completion_record(
            &ctx.accounts.completion_locator.to_account_info(),
            &ctx.accounts.voucher.completion_program,
            &ctx.accounts.voucher.subject,
            ctx.accounts.voucher.work_kind,
            ctx.accounts.voucher.locator_slot,
            &manifest,
        )?;
        require!(
            receipt.disposition == RECEIPT_PAYABLE,
            WorkMarketV2Error::ReceiptNotPayable
        );
        require_keys_eq!(
            ctx.accounts.worker.key(),
            receipt.worker,
            WorkMarketV2Error::WrongWorker
        );
        require_keys_eq!(
            ctx.accounts.token_program.key(),
            token_2022::ID,
            WorkMarketV2Error::WrongTokenProgram
        );

        let amount = ctx.accounts.vault.amount;
        require!(
            amount >= ctx.accounts.voucher.funded_amount,
            WorkMarketV2Error::VaultUnderfunded
        );
        transfer_from_vault(
            &ctx.accounts.voucher,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.worker_token,
            &ctx.accounts.token_program,
            &ctx.accounts.memo_program,
            RECEIPT_PAYABLE,
            &receipt.worker,
            &receipt.result_hash,
            amount,
        )?;
        close_vault(
            &ctx.accounts.voucher,
            &ctx.accounts.vault,
            &ctx.accounts.sponsor,
            &ctx.accounts.token_program,
        )?;

        let voucher = &mut ctx.accounts.voucher;
        voucher.state = VoucherState::Paid as u8;
        voucher.settled_amount = amount;
        voucher.beneficiary = receipt.worker;
        voucher.result_hash = receipt.result_hash;
        emit!(VoucherPaidV2 {
            voucher: voucher_key,
            completion_locator: voucher.completion_locator,
            locator_slot: voucher.locator_slot,
            worker: receipt.worker,
            amount,
        });
        Ok(())
    }

    pub fn refund_rcx_voucher(ctx: Context<RefundRcxVoucher>) -> Result<()> {
        let voucher_key = ctx.accounts.voucher.key();
        let manifest = load_work_manifest(
            &ctx.accounts.work_manifest.to_account_info(),
            &ctx.accounts.voucher.completion_program,
            ctx.accounts.voucher.work_kind,
        )?;
        let receipt = load_completion_record(
            &ctx.accounts.completion_locator.to_account_info(),
            &ctx.accounts.voucher.completion_program,
            &ctx.accounts.voucher.subject,
            ctx.accounts.voucher.work_kind,
            ctx.accounts.voucher.locator_slot,
            &manifest,
        )?;
        require!(
            receipt.disposition == RECEIPT_NONPAYABLE,
            WorkMarketV2Error::ReceiptNotNonpayable
        );
        require_keys_eq!(
            ctx.accounts.token_program.key(),
            token_2022::ID,
            WorkMarketV2Error::WrongTokenProgram
        );

        let amount = ctx.accounts.vault.amount;
        require!(
            amount >= ctx.accounts.voucher.funded_amount,
            WorkMarketV2Error::VaultUnderfunded
        );
        transfer_from_vault(
            &ctx.accounts.voucher,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.sponsor_token,
            &ctx.accounts.token_program,
            &ctx.accounts.memo_program,
            RECEIPT_NONPAYABLE,
            &ctx.accounts.voucher.sponsor,
            &receipt.result_hash,
            amount,
        )?;
        close_vault(
            &ctx.accounts.voucher,
            &ctx.accounts.vault,
            &ctx.accounts.sponsor,
            &ctx.accounts.token_program,
        )?;

        let voucher = &mut ctx.accounts.voucher;
        voucher.state = VoucherState::Refunded as u8;
        voucher.settled_amount = amount;
        voucher.beneficiary = voucher.sponsor;
        voucher.result_hash = receipt.result_hash;
        emit!(VoucherRefundedV2 {
            voucher: voucher_key,
            completion_locator: voucher.completion_locator,
            locator_slot: voucher.locator_slot,
            sponsor: voucher.sponsor,
            amount,
        });
        Ok(())
    }

    pub fn close_voucher(ctx: Context<CloseVoucher>) -> Result<()> {
        require!(
            ctx.accounts.voucher.state == VoucherState::Paid as u8
                || ctx.accounts.voucher.state == VoucherState::Refunded as u8,
            WorkMarketV2Error::VoucherStillFunded
        );
        emit!(VoucherClosedV2 {
            voucher: ctx.accounts.voucher.key(),
            actor: ctx.accounts.actor.key(),
            sponsor: ctx.accounts.voucher.sponsor,
        });
        Ok(())
    }
}

fn transfer_from_vault<'info>(
    voucher: &Account<'info, Voucher>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    destination: &InterfaceAccount<'info, TokenAccount>,
    token_program: &Interface<'info, TokenInterface>,
    memo_program: &Program<'info, Memo>,
    disposition: u8,
    beneficiary: &Pubkey,
    result_hash: &[u8; 32],
    amount: u64,
) -> Result<()> {
    let schema = voucher.schema_version.to_le_bytes();
    let work_kind = [voucher.work_kind];
    let nonce = voucher.nonce.to_le_bytes();
    let bump = [voucher.bump];
    let signer_seeds: &[&[u8]] = &[
        b"voucher",
        schema.as_ref(),
        voucher.completion_program.as_ref(),
        voucher.subject.as_ref(),
        work_kind.as_ref(),
        voucher.sponsor.as_ref(),
        nonce.as_ref(),
        bump.as_ref(),
    ];
    let settlement_digest = settlement_memo(
        voucher,
        &destination.key(),
        disposition,
        beneficiary,
        result_hash,
        amount,
    );
    let settlement_payload = settlement_memo_payload(&settlement_digest);
    memo::build_memo(
        CpiContext::new(memo_program.key(), BuildMemo {}),
        settlement_payload.as_ref(),
    )?;
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: destination.to_account_info(),
                authority: voucher.to_account_info(),
            },
            &[signer_seeds],
        ),
        amount,
        RCX_DECIMALS,
    )
}

pub fn settlement_memo(
    voucher: &Voucher,
    destination_token: &Pubkey,
    disposition: u8,
    beneficiary: &Pubkey,
    result_hash: &[u8; 32],
    amount: u64,
) -> [u8; 32] {
    hashv(&[
        SETTLEMENT_MEMO_DOMAIN,
        crate::ID.as_ref(),
        voucher.completion_program.as_ref(),
        voucher.subject.as_ref(),
        &[voucher.work_kind],
        voucher.sponsor.as_ref(),
        &voucher.nonce.to_le_bytes(),
        voucher.completion_locator.as_ref(),
        &[voucher.locator_slot],
        &[disposition],
        beneficiary.as_ref(),
        destination_token.as_ref(),
        RCX_MINT.as_ref(),
        &amount.to_le_bytes(),
        result_hash.as_ref(),
    ])
    .to_bytes()
}

/// SPL Memo validates its instruction data as UTF-8. A raw SHA-256 digest is
/// therefore not a valid Memo payload in general. Emit the deterministic
/// lowercase hexadecimal representation while keeping the signed preimage and
/// 32-byte digest unchanged.
pub fn settlement_memo_payload(digest: &[u8; 32]) -> [u8; 64] {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut payload = [0u8; 64];
    let mut index = 0;
    while index < digest.len() {
        payload[index * 2] = HEX[usize::from(digest[index] >> 4)];
        payload[index * 2 + 1] = HEX[usize::from(digest[index] & 0x0f)];
        index += 1;
    }
    payload
}

fn close_vault<'info>(
    voucher: &Account<'info, Voucher>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    sponsor: &UncheckedAccount<'info>,
    token_program: &Interface<'info, TokenInterface>,
) -> Result<()> {
    let schema = voucher.schema_version.to_le_bytes();
    let work_kind = [voucher.work_kind];
    let nonce = voucher.nonce.to_le_bytes();
    let bump = [voucher.bump];
    let signer_seeds: &[&[u8]] = &[
        b"voucher",
        schema.as_ref(),
        voucher.completion_program.as_ref(),
        voucher.subject.as_ref(),
        work_kind.as_ref(),
        voucher.sponsor.as_ref(),
        nonce.as_ref(),
        bump.as_ref(),
    ];
    token_interface::close_account(CpiContext::new_with_signer(
        token_program.key(),
        CloseAccount {
            account: vault.to_account_info(),
            destination: sponsor.to_account_info(),
            authority: voucher.to_account_info(),
        },
        &[signer_seeds],
    ))
}

#[derive(Accounts)]
#[instruction(nonce: u64, work_kind: u8, locator_slot: u8, amount: u64)]
pub struct FundRcxVoucher<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,
    /// CHECK: live program-owned subject type is authenticated from WorkManifest.
    pub subject: UncheckedAccount<'info>,
    /// CHECK: owner, layout and pending record are authenticated before funding.
    pub completion_locator: UncheckedAccount<'info>,
    pub completion_program: Program<'info>,
    #[account(
        constraint = completion_program.programdata_address()? == Some(completion_program_data.key()) @ WorkMarketV2Error::WrongProgramData,
        constraint = completion_program_data.upgrade_authority_address.is_none() @ WorkMarketV2Error::CompletionProgramMutable,
    )]
    pub completion_program_data: Account<'info, ProgramData>,
    /// CHECK: owner, PDA, discriminator, exact layout and fields are checked manually.
    pub work_manifest: UncheckedAccount<'info>,
    #[account(
        init,
        payer = sponsor,
        space = 8 + Voucher::LEN,
        seeds = [
            b"voucher",
            SCHEMA_VERSION.to_le_bytes().as_ref(),
            completion_program.key().as_ref(),
            subject.key().as_ref(),
            &[work_kind],
            sponsor.key().as_ref(),
            nonce.to_le_bytes().as_ref(),
        ],
        bump
    )]
    pub voucher: Account<'info, Voucher>,
    #[account(
        init,
        payer = sponsor,
        seeds = [b"vault", voucher.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = voucher,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = RCX_MINT @ WorkMarketV2Error::WrongMint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = sponsor,
        token::token_program = token_program,
    )]
    pub sponsor_token: InterfaceAccount<'info, TokenAccount>,
    #[account(address = token_2022::ID @ WorkMarketV2Error::WrongTokenProgram)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimRcxVoucher<'info> {
    pub actor: Signer<'info>,
    #[account(
        mut,
        seeds = [
            b"voucher",
            voucher.schema_version.to_le_bytes().as_ref(),
            voucher.completion_program.as_ref(),
            voucher.subject.as_ref(),
            &[voucher.work_kind],
            voucher.sponsor.as_ref(),
            voucher.nonce.to_le_bytes().as_ref(),
        ],
        bump = voucher.bump,
        constraint = voucher.state == VoucherState::Funded as u8 @ WorkMarketV2Error::VoucherNotFunded,
    )]
    pub voucher: Account<'info, Voucher>,
    #[account(
        mut,
        seeds = [b"vault", voucher.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = voucher,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(address = RCX_MINT @ WorkMarketV2Error::WrongMint)]
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: fixed by the authenticated completion receipt.
    pub worker: UncheckedAccount<'info>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = worker,
        token::token_program = token_program,
    )]
    pub worker_token: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: immutable producer-owned manifest is checked manually.
    pub work_manifest: UncheckedAccount<'info>,
    /// CHECK: fixed in Voucher; terminal record is checked manually.
    #[account(address = voucher.completion_locator @ WorkMarketV2Error::WrongCompletionLocator)]
    pub completion_locator: UncheckedAccount<'info>,
    /// CHECK: rent destination is permanently fixed in Voucher.
    #[account(mut, address = voucher.sponsor @ WorkMarketV2Error::WrongSponsor)]
    pub sponsor: UncheckedAccount<'info>,
    #[account(address = token_2022::ID @ WorkMarketV2Error::WrongTokenProgram)]
    pub token_program: Interface<'info, TokenInterface>,
    #[account(address = memo::ID @ WorkMarketV2Error::WrongMemoProgram)]
    pub memo_program: Program<'info, Memo>,
}

#[derive(Accounts)]
pub struct RefundRcxVoucher<'info> {
    pub actor: Signer<'info>,
    #[account(
        mut,
        seeds = [
            b"voucher",
            voucher.schema_version.to_le_bytes().as_ref(),
            voucher.completion_program.as_ref(),
            voucher.subject.as_ref(),
            &[voucher.work_kind],
            voucher.sponsor.as_ref(),
            voucher.nonce.to_le_bytes().as_ref(),
        ],
        bump = voucher.bump,
        constraint = voucher.state == VoucherState::Funded as u8 @ WorkMarketV2Error::VoucherNotFunded,
    )]
    pub voucher: Account<'info, Voucher>,
    #[account(
        mut,
        seeds = [b"vault", voucher.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = voucher,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(address = RCX_MINT @ WorkMarketV2Error::WrongMint)]
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: immutable producer-owned manifest is checked manually.
    pub work_manifest: UncheckedAccount<'info>,
    /// CHECK: fixed in Voucher; terminal record is checked manually.
    #[account(address = voucher.completion_locator @ WorkMarketV2Error::WrongCompletionLocator)]
    pub completion_locator: UncheckedAccount<'info>,
    /// CHECK: token and rent destinations are permanently fixed in Voucher.
    #[account(mut, address = voucher.sponsor @ WorkMarketV2Error::WrongSponsor)]
    pub sponsor: UncheckedAccount<'info>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = sponsor,
        token::token_program = token_program,
    )]
    pub sponsor_token: InterfaceAccount<'info, TokenAccount>,
    #[account(address = token_2022::ID @ WorkMarketV2Error::WrongTokenProgram)]
    pub token_program: Interface<'info, TokenInterface>,
    #[account(address = memo::ID @ WorkMarketV2Error::WrongMemoProgram)]
    pub memo_program: Program<'info, Memo>,
}

#[derive(Accounts)]
pub struct CloseVoucher<'info> {
    pub actor: Signer<'info>,
    #[account(
        mut,
        close = sponsor,
        seeds = [
            b"voucher",
            voucher.schema_version.to_le_bytes().as_ref(),
            voucher.completion_program.as_ref(),
            voucher.subject.as_ref(),
            &[voucher.work_kind],
            voucher.sponsor.as_ref(),
            voucher.nonce.to_le_bytes().as_ref(),
        ],
        bump = voucher.bump,
        has_one = sponsor @ WorkMarketV2Error::WrongSponsor,
    )]
    pub voucher: Account<'info, Voucher>,
    /// CHECK: constrained by has_one and receives only its own voucher rent.
    #[account(mut)]
    pub sponsor: UncheckedAccount<'info>,
}

#[account]
pub struct Voucher {
    pub schema_version: u16,
    pub bump: u8,
    pub state: u8,
    pub work_kind: u8,
    pub completion_program: Pubkey,
    pub subject: Pubkey,
    pub completion_locator: Pubkey,
    pub locator_slot: u8,
    pub sponsor: Pubkey,
    pub nonce: u64,
    pub funded_amount: u64,
    pub settled_amount: u64,
    pub funded_slot: u64,
    pub funded_ts: i64,
    pub beneficiary: Pubkey,
    pub result_hash: [u8; 32],
}

impl Voucher {
    pub const LEN: usize = 2 + 1 + 1 + 1 + 32 + 32 + 32 + 1 + 32 + 8 + 8 + 8 + 8 + 8 + 32 + 32;
}

#[repr(u8)]
pub enum VoucherState {
    Funded = 0,
    Paid = 1,
    Refunded = 2,
}

/// Canonical account bytes that each compatible completion program must own.
///
/// There is one account per work kind. Its producer instruction must write only
/// compile-time constants and expose no authority, edit or close path.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
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
    /// Absolute account-data offset of packed record zero. Zero in direct mode.
    pub records_offset: u16,
    /// Frozen packed record width. Zero in direct mode.
    pub entry_len: u16,
    pub locator_capacity: u8,
}

impl WorkManifest {
    pub const LEN: usize = 34;
}

/// Standard packed completion record v1. Borsh encoding is exactly 106 bytes.
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
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq)]
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
    pub const LEN: usize = 117;
}

pub fn account_discriminator(name: &[u8]) -> [u8; 8] {
    let digest = hashv(&[b"account:", name]).to_bytes();
    digest[0..8].try_into().expect("eight-byte slice")
}

pub fn work_manifest_address(completion_program: &Pubkey, work_kind: u8) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            WORK_MANIFEST_SEED,
            &MANIFEST_SCHEMA_VERSION.to_le_bytes(),
            &[work_kind],
        ],
        completion_program,
    )
}

fn validate_manifest_definition(manifest: &WorkManifest, work_kind: u8) -> Result<()> {
    require!(
        manifest.schema_version == MANIFEST_SCHEMA_VERSION,
        WorkMarketV2Error::WrongManifestSchema
    );
    require!(
        work_kind > 0 && manifest.work_kind == work_kind,
        WorkMarketV2Error::WrongManifestWorkKind
    );
    require!(
        manifest.completion_schema_version == COMPLETION_SCHEMA_VERSION,
        WorkMarketV2Error::WrongManifestCompletionSchema
    );
    require!(
        manifest.subject_account_size >= 10
            && manifest.subject_discriminator != [0; 8]
            && manifest.locator_discriminator != [0; 8],
        WorkMarketV2Error::BadManifestDefinition
    );
    match manifest.locator_mode {
        LOCATOR_MODE_DIRECT_RECEIPT => require!(
            manifest.locator_capacity == 1
                && manifest.locator_schema_version == COMPLETION_SCHEMA_VERSION
                && manifest.records_offset == 0
                && manifest.entry_len == 0,
            WorkMarketV2Error::BadManifestDefinition
        ),
        LOCATOR_MODE_PACKED_WORK_PAGE => require!(
            manifest.locator_capacity > 0
                && manifest.locator_capacity <= MAX_WORK_PAGE_RECORDS
                && usize::from(manifest.records_offset) >= 14
                && usize::from(manifest.entry_len) == WORK_RECORD_LEN,
            WorkMarketV2Error::BadManifestDefinition
        ),
        _ => return err!(WorkMarketV2Error::BadManifestDefinition),
    }
    Ok(())
}

fn load_work_manifest(
    account: &AccountInfo,
    completion_program: &Pubkey,
    work_kind: u8,
) -> Result<WorkManifest> {
    require!(!account.executable, WorkMarketV2Error::ExecutableManifest);
    require_keys_eq!(
        *account.owner,
        *completion_program,
        WorkMarketV2Error::WrongManifestOwner
    );
    let (expected, expected_bump) = work_manifest_address(completion_program, work_kind);
    require_keys_eq!(account.key(), expected, WorkMarketV2Error::WrongManifestPda);
    let data = account
        .try_borrow_data()
        .map_err(|_| error!(WorkMarketV2Error::BadManifestData))?;
    require!(
        data.len() == 8 + WorkManifest::LEN,
        WorkMarketV2Error::BadManifestLength
    );
    require!(
        data[0..8] == account_discriminator(b"WorkManifest"),
        WorkMarketV2Error::BadManifestDiscriminator
    );
    let mut payload: &[u8] = &data[8..];
    let manifest = WorkManifest::deserialize(&mut payload)
        .map_err(|_| error!(WorkMarketV2Error::BadManifestData))?;
    require!(payload.is_empty(), WorkMarketV2Error::BadManifestData);
    require!(
        manifest.bump == expected_bump,
        WorkMarketV2Error::WrongManifestBump
    );
    validate_manifest_definition(&manifest, work_kind)?;
    Ok(manifest)
}

fn validate_subject_account(
    account: &AccountInfo,
    completion_program: &Pubkey,
    manifest: &WorkManifest,
) -> Result<()> {
    require!(!account.executable, WorkMarketV2Error::ExecutableSubject);
    require_keys_eq!(
        *account.owner,
        *completion_program,
        WorkMarketV2Error::WrongSubjectOwner
    );
    let data = account
        .try_borrow_data()
        .map_err(|_| error!(WorkMarketV2Error::BadProducerAccountData))?;
    require!(
        data.len() == usize::from(manifest.subject_account_size),
        WorkMarketV2Error::BadSubjectLayout
    );
    require!(
        data[0..8] == manifest.subject_discriminator,
        WorkMarketV2Error::BadSubjectLayout
    );
    require!(
        u16::from_le_bytes([data[8], data[9]]) == manifest.subject_schema_version,
        WorkMarketV2Error::BadSubjectLayout
    );
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CompletionRecordView {
    disposition: u8,
    worker: Pubkey,
    result_hash: [u8; 32],
}

fn load_completion_record(
    account: &AccountInfo,
    completion_program: &Pubkey,
    subject: &Pubkey,
    work_kind: u8,
    locator_slot: u8,
    manifest: &WorkManifest,
) -> Result<CompletionRecordView> {
    require!(!account.executable, WorkMarketV2Error::ExecutableLocator);
    require_keys_eq!(
        *account.owner,
        *completion_program,
        WorkMarketV2Error::WrongLocatorOwner
    );
    let data = account
        .try_borrow_data()
        .map_err(|_| error!(WorkMarketV2Error::BadLocatorData))?;
    require!(data.len() >= 10, WorkMarketV2Error::BadLocatorLayout);
    require!(
        data[0..8] == manifest.locator_discriminator,
        WorkMarketV2Error::BadLocatorDiscriminator
    );
    require!(
        u16::from_le_bytes([data[8], data[9]]) == manifest.locator_schema_version,
        WorkMarketV2Error::WrongLocatorSchema
    );

    let record = match manifest.locator_mode {
        LOCATOR_MODE_DIRECT_RECEIPT => load_direct_completion_receipt(
            account.key(),
            &data,
            completion_program,
            subject,
            work_kind,
            locator_slot,
        )?,
        LOCATOR_MODE_PACKED_WORK_PAGE => load_packed_work_record(&data, locator_slot, manifest)?,
        _ => return err!(WorkMarketV2Error::BadManifestDefinition),
    };
    validate_completion_identity(&record, subject, work_kind)?;
    validate_completion_record(&record)?;
    Ok(CompletionRecordView {
        disposition: record.disposition,
        worker: record.worker,
        result_hash: record.result_hash,
    })
}

fn load_direct_completion_receipt(
    key: Pubkey,
    data: &[u8],
    completion_program: &Pubkey,
    subject: &Pubkey,
    work_kind: u8,
    locator_slot: u8,
) -> Result<WorkRecord> {
    require!(locator_slot == 0, WorkMarketV2Error::LocatorSlotOutOfRange);
    let (expected, expected_bump) = Pubkey::find_program_address(
        &[b"completion", subject.as_ref(), &[work_kind]],
        completion_program,
    );
    require_keys_eq!(key, expected, WorkMarketV2Error::WrongDirectReceiptPda);
    require!(
        data.len() == DIRECT_COMPLETION_RECEIPT_LEN,
        WorkMarketV2Error::BadDirectReceiptLength
    );
    require!(
        data[10] == expected_bump,
        WorkMarketV2Error::WrongDirectReceiptBump
    );
    let record = WorkRecord {
        subject: read_pubkey(data, 13)?,
        work_kind: data[12],
        disposition: data[11],
        worker: read_pubkey(data, 45)?,
        result_hash: read_array_32(data, 77)?,
        completed_slot: read_u64(data, 109)?,
    };
    if record.disposition == RECEIPT_PENDING {
        require!(
            read_i64(data, 117)? == 0,
            WorkMarketV2Error::MalformedPendingCompletion
        );
    }
    Ok(record)
}

fn load_packed_work_record(
    data: &[u8],
    locator_slot: u8,
    manifest: &WorkManifest,
) -> Result<WorkRecord> {
    let records_offset = usize::from(manifest.records_offset);
    let len_offset = records_offset
        .checked_sub(4)
        .ok_or_else(|| error!(WorkMarketV2Error::BadManifestDefinition))?;
    require!(
        data.len() >= records_offset,
        WorkMarketV2Error::BadPackedPageLength
    );
    let record_count = usize::try_from(read_u32(data, len_offset)?)
        .map_err(|_| error!(WorkMarketV2Error::BadPackedPageLength))?;
    require!(
        record_count <= usize::from(manifest.locator_capacity),
        WorkMarketV2Error::PackedPageOverCapacity
    );
    let expected_len = records_offset
        .checked_add(
            record_count
                .checked_mul(WORK_RECORD_LEN)
                .ok_or_else(|| error!(WorkMarketV2Error::BadPackedPageLength))?,
        )
        .ok_or_else(|| error!(WorkMarketV2Error::BadPackedPageLength))?;
    require!(
        data.len() == expected_len,
        WorkMarketV2Error::BadPackedPageLength
    );
    let index = usize::from(locator_slot);
    require!(
        index < record_count,
        WorkMarketV2Error::LocatorSlotOutOfRange
    );
    let start = records_offset + index * WORK_RECORD_LEN;
    let end = start + WORK_RECORD_LEN;
    let mut record_bytes: &[u8] = &data[start..end];
    let record = WorkRecord::deserialize(&mut record_bytes)
        .map_err(|_| error!(WorkMarketV2Error::BadPackedRecordData))?;
    require!(
        record_bytes.is_empty(),
        WorkMarketV2Error::BadPackedRecordData
    );
    Ok(record)
}

fn validate_completion_record(record: &WorkRecord) -> Result<()> {
    match record.disposition {
        RECEIPT_PENDING => require!(
            record.worker == Pubkey::default()
                && record.result_hash == [0; 32]
                && record.completed_slot == 0,
            WorkMarketV2Error::MalformedPendingCompletion
        ),
        RECEIPT_PAYABLE => require!(
            record.worker != Pubkey::default()
                && record.result_hash != [0; 32]
                && record.completed_slot > 0,
            WorkMarketV2Error::MalformedPayableCompletion
        ),
        RECEIPT_NONPAYABLE => require!(
            record.worker == Pubkey::default()
                && record.result_hash != [0; 32]
                && record.completed_slot > 0,
            WorkMarketV2Error::MalformedNonpayableCompletion
        ),
        _ => return err!(WorkMarketV2Error::BadCompletionDisposition),
    }
    Ok(())
}

fn validate_completion_identity(
    record: &WorkRecord,
    subject: &Pubkey,
    work_kind: u8,
) -> Result<()> {
    require_keys_eq!(
        record.subject,
        *subject,
        WorkMarketV2Error::WrongCompletionSubject
    );
    require!(
        record.work_kind == work_kind,
        WorkMarketV2Error::WrongCompletionWorkKind
    );
    Ok(())
}

fn read_u32(data: &[u8], offset: usize) -> Result<u32> {
    let bytes = data
        .get(offset..offset + 4)
        .ok_or_else(|| error!(WorkMarketV2Error::BadLocatorData))?;
    Ok(u32::from_le_bytes(
        bytes
            .try_into()
            .map_err(|_| error!(WorkMarketV2Error::BadLocatorData))?,
    ))
}

fn read_u64(data: &[u8], offset: usize) -> Result<u64> {
    let bytes = data
        .get(offset..offset + 8)
        .ok_or_else(|| error!(WorkMarketV2Error::BadLocatorData))?;
    Ok(u64::from_le_bytes(
        bytes
            .try_into()
            .map_err(|_| error!(WorkMarketV2Error::BadLocatorData))?,
    ))
}

fn read_i64(data: &[u8], offset: usize) -> Result<i64> {
    let bytes = data
        .get(offset..offset + 8)
        .ok_or_else(|| error!(WorkMarketV2Error::BadLocatorData))?;
    Ok(i64::from_le_bytes(
        bytes
            .try_into()
            .map_err(|_| error!(WorkMarketV2Error::BadLocatorData))?,
    ))
}

fn read_pubkey(data: &[u8], offset: usize) -> Result<Pubkey> {
    Ok(Pubkey::new_from_array(read_array_32(data, offset)?))
}

fn read_array_32(data: &[u8], offset: usize) -> Result<[u8; 32]> {
    data.get(offset..offset + 32)
        .ok_or_else(|| error!(WorkMarketV2Error::BadLocatorData))?
        .try_into()
        .map_err(|_| error!(WorkMarketV2Error::BadLocatorData))
}

#[event]
pub struct VoucherFundedV2 {
    pub voucher: Pubkey,
    pub sponsor: Pubkey,
    pub completion_program: Pubkey,
    pub work_manifest: Pubkey,
    pub subject: Pubkey,
    pub completion_locator: Pubkey,
    pub locator_slot: u8,
    pub work_kind: u8,
    pub nonce: u64,
    pub amount: u64,
}

#[event]
pub struct VoucherPaidV2 {
    pub voucher: Pubkey,
    pub completion_locator: Pubkey,
    pub locator_slot: u8,
    pub worker: Pubkey,
    pub amount: u64,
}

#[event]
pub struct VoucherRefundedV2 {
    pub voucher: Pubkey,
    pub completion_locator: Pubkey,
    pub locator_slot: u8,
    pub sponsor: Pubkey,
    pub amount: u64,
}

#[event]
pub struct VoucherClosedV2 {
    pub voucher: Pubkey,
    pub actor: Pubkey,
    pub sponsor: Pubkey,
}

#[error_code]
pub enum WorkMarketV2Error {
    #[msg("amount must be nonzero")]
    InvalidAmount,
    #[msg("work kind zero is reserved")]
    InvalidWorkKind,
    #[msg("only the Token-2022 program is accepted")]
    WrongTokenProgram,
    #[msg("only the canonical SPL Memo program is accepted")]
    WrongMemoProgram,
    #[msg("mint is not RCX")]
    WrongMint,
    #[msg("RCX decimals are wrong")]
    WrongDecimals,
    #[msg("completion program data account is wrong")]
    WrongProgramData,
    #[msg("completion program still has an upgrade authority")]
    CompletionProgramMutable,
    #[msg("manifest must not be executable")]
    ExecutableManifest,
    #[msg("manifest has the wrong completion-program owner")]
    WrongManifestOwner,
    #[msg("manifest PDA is wrong")]
    WrongManifestPda,
    #[msg("manifest length is wrong")]
    BadManifestLength,
    #[msg("manifest discriminator is wrong")]
    BadManifestDiscriminator,
    #[msg("manifest bytes are malformed")]
    BadManifestData,
    #[msg("manifest schema is unsupported")]
    WrongManifestSchema,
    #[msg("manifest bump is wrong")]
    WrongManifestBump,
    #[msg("manifest does not advertise this work kind")]
    WrongManifestWorkKind,
    #[msg("manifest completion-receipt schema is unsupported")]
    WrongManifestCompletionSchema,
    #[msg("manifest account policies are malformed")]
    BadManifestDefinition,
    #[msg("subject must not be executable")]
    ExecutableSubject,
    #[msg("subject is not owned by the completion program")]
    WrongSubjectOwner,
    #[msg("subject type, schema or exact account size is wrong")]
    BadSubjectLayout,
    #[msg("completion locator must not be executable")]
    ExecutableLocator,
    #[msg("completion locator is not owned by the completion program")]
    WrongLocatorOwner,
    #[msg("completion locator header is malformed")]
    BadLocatorLayout,
    #[msg("completion locator does not match the voucher")]
    WrongCompletionLocator,
    #[msg("locator slot is outside the live records")]
    LocatorSlotOutOfRange,
    #[msg("completion locator bytes could not be borrowed")]
    BadLocatorData,
    #[msg("completion locator discriminator is wrong")]
    BadLocatorDiscriminator,
    #[msg("completion locator schema is wrong")]
    WrongLocatorSchema,
    #[msg("canonical direct completion receipt PDA is wrong")]
    WrongDirectReceiptPda,
    #[msg("canonical direct completion receipt length is wrong")]
    BadDirectReceiptLength,
    #[msg("canonical direct completion receipt bump is wrong")]
    WrongDirectReceiptBump,
    #[msg("packed work page has a malformed or non-canonical length")]
    BadPackedPageLength,
    #[msg("packed work page exceeds its manifest capacity")]
    PackedPageOverCapacity,
    #[msg("packed work record bytes are malformed")]
    BadPackedRecordData,
    #[msg("completion record subject is wrong")]
    WrongCompletionSubject,
    #[msg("completion record work kind is wrong")]
    WrongCompletionWorkKind,
    #[msg("completion record disposition is invalid")]
    BadCompletionDisposition,
    #[msg("pending completion record has nonzero terminal fields")]
    MalformedPendingCompletion,
    #[msg("payable completion record lacks a worker, result hash, or completed slot")]
    MalformedPayableCompletion,
    #[msg("nonpayable completion record has a worker or lacks a result hash/completed slot")]
    MalformedNonpayableCompletion,
    #[msg("funding requires a reserved pending completion record")]
    CompletionNotPending,
    #[msg("producer account bytes could not be borrowed")]
    BadProducerAccountData,
    #[msg("voucher is not funded")]
    VoucherNotFunded,
    #[msg("voucher is still funded")]
    VoucherStillFunded,
    #[msg("vault balance fell below the funded amount")]
    VaultUnderfunded,
    #[msg("completion record is not payable")]
    ReceiptNotPayable,
    #[msg("completion record is not terminally nonpayable")]
    ReceiptNotNonpayable,
    #[msg("worker does not match the completion record")]
    WrongWorker,
    #[msg("sponsor does not match the voucher")]
    WrongSponsor,
}

#[cfg(test)]
mod tests {
    use super::*;
    use spl_token_2022_interface::{
        extension::{
            memo_transfer::{memo_required, MemoTransfer},
            BaseStateWithExtensions, BaseStateWithExtensionsMut, ExtensionType,
            StateWithExtensions, StateWithExtensionsMut,
        },
        state::{Account as SplTokenAccount, AccountState},
    };

    fn manifest(mode: u8) -> WorkManifest {
        let direct = mode == LOCATOR_MODE_DIRECT_RECEIPT;
        WorkManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            bump: 250,
            work_kind: 4,
            completion_schema_version: COMPLETION_SCHEMA_VERSION,
            locator_mode: mode,
            subject_schema_version: 2,
            subject_account_size: 716,
            subject_discriminator: [1; 8],
            locator_schema_version: if direct { COMPLETION_SCHEMA_VERSION } else { 2 },
            locator_discriminator: if direct {
                account_discriminator(b"CompletionReceipt")
            } else {
                account_discriminator(b"WorkPage")
            },
            records_offset: if direct { 0 } else { 87 },
            entry_len: if direct { 0 } else { WORK_RECORD_LEN as u16 },
            locator_capacity: if direct { 1 } else { MAX_WORK_PAGE_RECORDS },
        }
    }

    fn pending(subject: Pubkey, work_kind: u8) -> WorkRecord {
        WorkRecord {
            subject,
            work_kind,
            ..WorkRecord::default()
        }
    }

    fn packed_page(records_offset: usize, records: &[WorkRecord]) -> Vec<u8> {
        let mut data = vec![0u8; records_offset];
        let count = u32::try_from(records.len()).unwrap().to_le_bytes();
        data[records_offset - 4..records_offset].copy_from_slice(&count);
        for record in records {
            record.serialize(&mut data).unwrap();
        }
        data
    }

    #[test]
    fn frozen_layouts_match_borsh() {
        let mut manifest_bytes = Vec::new();
        manifest(LOCATOR_MODE_PACKED_WORK_PAGE)
            .serialize(&mut manifest_bytes)
            .unwrap();
        assert_eq!(manifest_bytes.len(), WorkManifest::LEN);
        assert_eq!(WorkManifest::LEN, 34);
        assert_eq!(8 + WorkManifest::LEN, 42);
        assert_eq!(Voucher::LEN, 238);
        assert_eq!(8 + Voucher::LEN, 246);
        assert_eq!(CompletionReceipt::LEN, 117);
        assert_eq!(DIRECT_COMPLETION_RECEIPT_LEN, 125);

        let record = WorkRecord {
            subject: Pubkey::new_from_array([3; 32]),
            work_kind: 4,
            disposition: RECEIPT_PAYABLE,
            worker: Pubkey::new_from_array([5; 32]),
            result_hash: [6; 32],
            completed_slot: 7,
        };
        let mut bytes = Vec::new();
        record.serialize(&mut bytes).unwrap();
        assert_eq!(bytes.len(), WORK_RECORD_LEN);
        assert_eq!(&bytes[0..32], &[3; 32]);
        assert_eq!(bytes[32], 4);
        assert_eq!(bytes[33], RECEIPT_PAYABLE);
        assert_eq!(&bytes[34..66], &[5; 32]);
        assert_eq!(&bytes[66..98], &[6; 32]);
        assert_eq!(&bytes[98..106], &7u64.to_le_bytes());

        assert_eq!(
            87 + usize::from(MAX_WORK_PAGE_RECORDS) * WORK_RECORD_LEN,
            5_175
        );
    }

    #[test]
    fn account_discriminators_are_frozen() {
        assert_eq!(
            account_discriminator(b"WorkManifest"),
            [0xbb, 0xe5, 0xaf, 0x48, 0xf1, 0x12, 0xa4, 0x55]
        );
        assert_eq!(
            account_discriminator(b"CompletionReceipt"),
            [0xf9, 0x72, 0x2d, 0xf7, 0x8d, 0xc8, 0x52, 0x9d]
        );
    }

    #[test]
    fn manifest_modes_are_structurally_exact() {
        assert!(validate_manifest_definition(&manifest(LOCATOR_MODE_DIRECT_RECEIPT), 4).is_ok());
        assert!(validate_manifest_definition(&manifest(LOCATOR_MODE_PACKED_WORK_PAGE), 4).is_ok());

        let mut bad = manifest(LOCATOR_MODE_DIRECT_RECEIPT);
        bad.locator_capacity = 2;
        assert!(validate_manifest_definition(&bad, 4).is_err());
        bad = manifest(LOCATOR_MODE_DIRECT_RECEIPT);
        bad.records_offset = 1;
        assert!(validate_manifest_definition(&bad, 4).is_err());
        bad = manifest(LOCATOR_MODE_PACKED_WORK_PAGE);
        bad.locator_capacity = 0;
        assert!(validate_manifest_definition(&bad, 4).is_err());
        bad = manifest(LOCATOR_MODE_PACKED_WORK_PAGE);
        bad.locator_capacity = MAX_WORK_PAGE_RECORDS + 1;
        assert!(validate_manifest_definition(&bad, 4).is_err());
        bad = manifest(LOCATOR_MODE_PACKED_WORK_PAGE);
        bad.entry_len = WORK_RECORD_LEN as u16 - 1;
        assert!(validate_manifest_definition(&bad, 4).is_err());
        bad = manifest(LOCATOR_MODE_PACKED_WORK_PAGE);
        bad.records_offset = 13;
        assert!(validate_manifest_definition(&bad, 4).is_err());
        bad = manifest(LOCATOR_MODE_PACKED_WORK_PAGE);
        bad.locator_mode = 255;
        assert!(validate_manifest_definition(&bad, 4).is_err());
    }

    #[test]
    fn wrong_or_zero_work_kind_and_receipt_schema_are_rejected() {
        let valid = manifest(LOCATOR_MODE_PACKED_WORK_PAGE);
        assert!(validate_manifest_definition(&valid, 3).is_err());
        assert!(validate_manifest_definition(&valid, 0).is_err());
        let mut bad = valid;
        bad.completion_schema_version = 2;
        assert!(validate_manifest_definition(&bad, 4).is_err());
    }

    #[test]
    fn manifest_pda_is_per_program_per_kind() {
        let a = Pubkey::new_from_array([3; 32]);
        let b = Pubkey::new_from_array([4; 32]);
        let (a4, _) = work_manifest_address(&a, 4);
        let (a5, _) = work_manifest_address(&a, 5);
        let (b4, _) = work_manifest_address(&b, 4);
        assert_ne!(a4, a5);
        assert_ne!(a4, b4);
    }

    #[test]
    fn pending_and_terminal_invariants_are_total() {
        let subject = Pubkey::new_from_array([3; 32]);
        let mut record = pending(subject, 4);
        assert!(validate_completion_record(&record).is_ok());

        record.worker = Pubkey::new_from_array([4; 32]);
        assert!(validate_completion_record(&record).is_err());
        record.worker = Pubkey::default();
        record.result_hash = [5; 32];
        assert!(validate_completion_record(&record).is_err());
        record.result_hash = [0; 32];
        record.completed_slot = 1;
        assert!(validate_completion_record(&record).is_err());

        record.disposition = RECEIPT_PAYABLE;
        assert!(validate_completion_record(&record).is_err());
        record.worker = Pubkey::new_from_array([4; 32]);
        assert!(validate_completion_record(&record).is_err());
        record.result_hash = [5; 32];
        assert!(validate_completion_record(&record).is_ok());

        record.disposition = RECEIPT_NONPAYABLE;
        assert!(validate_completion_record(&record).is_err());
        record.worker = Pubkey::default();
        assert!(validate_completion_record(&record).is_ok());
        record.completed_slot = 0;
        assert!(validate_completion_record(&record).is_err());
        record.disposition = 9;
        assert!(validate_completion_record(&record).is_err());
    }

    #[test]
    fn record_identity_prevents_cross_subject_and_cross_kind_funding() {
        let subject = Pubkey::new_from_array([3; 32]);
        let record = pending(subject, 4);
        assert!(validate_completion_identity(&record, &subject, 4).is_ok());
        assert!(
            validate_completion_identity(&record, &Pubkey::new_from_array([4; 32]), 4).is_err()
        );
        assert!(validate_completion_identity(&record, &subject, 5).is_err());
    }

    #[test]
    fn packed_page_parser_rejects_missing_trailing_and_over_capacity_records() {
        let config = manifest(LOCATOR_MODE_PACKED_WORK_PAGE);
        let records = [
            pending(Pubkey::new_from_array([3; 32]), 3),
            pending(Pubkey::new_from_array([4; 32]), 4),
        ];
        let page = packed_page(usize::from(config.records_offset), &records);
        assert_eq!(
            load_packed_work_record(&page, 1, &config).unwrap(),
            records[1]
        );
        assert!(load_packed_work_record(&page, 2, &config).is_err());

        let mut trailing = page.clone();
        trailing.push(0);
        assert!(load_packed_work_record(&trailing, 0, &config).is_err());
        assert!(load_packed_work_record(&page[..page.len() - 1], 0, &config).is_err());

        let too_many = vec![
            pending(Pubkey::new_from_array([8; 32]), 4);
            usize::from(MAX_WORK_PAGE_RECORDS) + 1
        ];
        let over = packed_page(usize::from(config.records_offset), &too_many);
        assert!(load_packed_work_record(&over, 0, &config).is_err());
    }

    #[test]
    fn full_packed_loader_requires_exact_owner_header_and_length() {
        let config = manifest(LOCATOR_MODE_PACKED_WORK_PAGE);
        let completion_program = Pubkey::new_from_array([7; 32]);
        let wrong_owner = Pubkey::new_from_array([8; 32]);
        let subject = Pubkey::new_from_array([3; 32]);
        let locator_key = Pubkey::new_from_array([9; 32]);
        let record = pending(subject, 4);
        let mut data = packed_page(usize::from(config.records_offset), &[record]);
        data[0..8].copy_from_slice(&config.locator_discriminator);
        data[8..10].copy_from_slice(&config.locator_schema_version.to_le_bytes());

        let mut lamports = 1u64;
        {
            let wrong = AccountInfo::new(
                &locator_key,
                false,
                false,
                &mut lamports,
                &mut data,
                &wrong_owner,
                false,
            );
            assert!(
                load_completion_record(&wrong, &completion_program, &subject, 4, 0, &config)
                    .is_err()
            );
        }
        {
            let correct = AccountInfo::new(
                &locator_key,
                false,
                false,
                &mut lamports,
                &mut data,
                &completion_program,
                false,
            );
            let loaded =
                load_completion_record(&correct, &completion_program, &subject, 4, 0, &config)
                    .unwrap();
            assert_eq!(loaded.disposition, RECEIPT_PENDING);
        }

        data.push(0);
        let trailing = AccountInfo::new(
            &locator_key,
            false,
            false,
            &mut lamports,
            &mut data,
            &completion_program,
            false,
        );
        assert!(
            load_completion_record(&trailing, &completion_program, &subject, 4, 0, &config)
                .is_err()
        );
    }

    #[test]
    fn direct_receipt_parser_is_canonical_and_pending_safe() {
        let program = Pubkey::new_from_array([7; 32]);
        let subject = Pubkey::new_from_array([3; 32]);
        let work_kind = 4;
        let (key, bump) = Pubkey::find_program_address(
            &[b"completion", subject.as_ref(), &[work_kind]],
            &program,
        );
        let mut data = vec![0u8; DIRECT_COMPLETION_RECEIPT_LEN];
        data[8..10].copy_from_slice(&COMPLETION_SCHEMA_VERSION.to_le_bytes());
        data[10] = bump;
        data[11] = RECEIPT_PENDING;
        data[12] = work_kind;
        data[13..45].copy_from_slice(subject.as_ref());
        let parsed =
            load_direct_completion_receipt(key, &data, &program, &subject, work_kind, 0).unwrap();
        assert_eq!(parsed, pending(subject, work_kind));
        assert!(validate_completion_record(&parsed).is_ok());

        assert!(load_direct_completion_receipt(
            Pubkey::new_unique(),
            &data,
            &program,
            &subject,
            work_kind,
            0
        )
        .is_err());
        assert!(
            load_direct_completion_receipt(key, &data, &program, &subject, work_kind, 1).is_err()
        );
        let mut nonzero_ts = data;
        nonzero_ts[117..125].copy_from_slice(&1i64.to_le_bytes());
        assert!(
            load_direct_completion_receipt(key, &nonzero_ts, &program, &subject, work_kind, 0)
                .is_err()
        );
    }

    fn voucher_for_memo() -> Voucher {
        Voucher {
            schema_version: SCHEMA_VERSION,
            bump: 250,
            state: VoucherState::Funded as u8,
            work_kind: 4,
            completion_program: Pubkey::new_from_array([1; 32]),
            subject: Pubkey::new_from_array([2; 32]),
            completion_locator: Pubkey::new_from_array([3; 32]),
            locator_slot: 7,
            sponsor: Pubkey::new_from_array([4; 32]),
            nonce: 8,
            funded_amount: 9,
            settled_amount: 0,
            funded_slot: 10,
            funded_ts: 11,
            beneficiary: Pubkey::default(),
            result_hash: [0; 32],
        }
    }

    #[test]
    fn settlement_memo_binds_every_value_movement_fact() {
        let voucher = voucher_for_memo();
        let destination = Pubkey::new_from_array([5; 32]);
        let beneficiary = Pubkey::new_from_array([6; 32]);
        let result_hash = [7; 32];
        let baseline = settlement_memo(
            &voucher,
            &destination,
            RECEIPT_PAYABLE,
            &beneficiary,
            &result_hash,
            12,
        );
        assert_ne!(
            baseline,
            settlement_memo(
                &voucher,
                &Pubkey::new_from_array([8; 32]),
                RECEIPT_PAYABLE,
                &beneficiary,
                &result_hash,
                12,
            )
        );
        assert_ne!(
            baseline,
            settlement_memo(
                &voucher,
                &destination,
                RECEIPT_NONPAYABLE,
                &beneficiary,
                &result_hash,
                12,
            )
        );
        assert_ne!(
            baseline,
            settlement_memo(
                &voucher,
                &destination,
                RECEIPT_PAYABLE,
                &Pubkey::new_from_array([9; 32]),
                &result_hash,
                12,
            )
        );
        assert_ne!(
            baseline,
            settlement_memo(
                &voucher,
                &destination,
                RECEIPT_PAYABLE,
                &beneficiary,
                &[10; 32],
                12,
            )
        );
        assert_ne!(
            baseline,
            settlement_memo(
                &voucher,
                &destination,
                RECEIPT_PAYABLE,
                &beneficiary,
                &result_hash,
                13,
            )
        );
        let mut changed = voucher_for_memo();
        changed.completion_locator = Pubkey::new_from_array([11; 32]);
        assert_ne!(
            baseline,
            settlement_memo(
                &changed,
                &destination,
                RECEIPT_PAYABLE,
                &beneficiary,
                &result_hash,
                12,
            )
        );
    }

    #[test]
    fn real_token_2022_destination_fixture_requires_incoming_memo() {
        let account_len = ExtensionType::try_calculate_account_len::<SplTokenAccount>(&[
            ExtensionType::MemoTransfer,
        ])
        .unwrap();
        let mut data = vec![0u8; account_len];
        {
            let mut state =
                StateWithExtensionsMut::<SplTokenAccount>::unpack_uninitialized(&mut data).unwrap();
            let extension = state.init_extension::<MemoTransfer>(true).unwrap();
            extension.require_incoming_transfer_memos = true.into();
            state.base.mint = RCX_MINT;
            state.base.owner = Pubkey::new_from_array([6; 32]);
            state.base.state = AccountState::Initialized;
            state.pack_base();
            state.init_account_type().unwrap();
        }
        let state = StateWithExtensions::<SplTokenAccount>::unpack(&data).unwrap();
        assert_eq!(
            state.get_extension_types().unwrap(),
            vec![ExtensionType::MemoTransfer]
        );
        assert!(memo_required(&state));
        assert_eq!(
            memo::ID.to_string(),
            "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
        );
    }

    #[test]
    fn settlement_memo_payload_is_lowercase_hex_utf8() {
        let digest = [0xabu8; 32];
        let payload = settlement_memo_payload(&digest);
        assert_eq!(
            payload,
            *b"abababababababababababababababababababababababababababababababab"
        );
        assert_eq!(
            std::str::from_utf8(&payload).unwrap(),
            "abababababababababababababababababababababababababababababababab"
        );
    }

    #[test]
    fn token_identity_is_exact() {
        assert_eq!(SCHEMA_VERSION, 2);
        assert_eq!(RCX_DECIMALS, 6);
        assert_eq!(
            RCX_MINT.to_string(),
            "FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump"
        );
        assert_eq!(
            token_2022::ID.to_string(),
            "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        );
    }
}
