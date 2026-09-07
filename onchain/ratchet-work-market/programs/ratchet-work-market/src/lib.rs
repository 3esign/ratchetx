//! Ratchet RCX Work Market v1.
//!
//! A sponsor locks existing RCX for one exact subject/work pair. The program
//! that owns that subject later writes a durable canonical CompletionReceipt.
//! Anyone can then route every vault unit to the fixed worker, or back to the
//! sponsor only when the receipt says the work is terminally nonpayable.
//!
//! This program never mints, burns, ranks, settles a game, chooses a worker,
//! owns a global purse or exposes an admin withdrawal. Canonical work happens
//! before and independently of voucher claim.

use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022,
    token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked},
};
use solana_sha256_hasher::hashv;

declare_id!("EdwrtcJ254e5BDSHbY6oZosdjPBrXLMZc9PzkmR9GBVD");

pub const SCHEMA_VERSION: u16 = 1;
pub const COMPLETION_SCHEMA_VERSION: u16 = 1;
pub const RCX_DECIMALS: u8 = 6;
pub const RCX_MINT: Pubkey = pubkey!("FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump");
pub const RECEIPT_PAYABLE: u8 = 1;
pub const RECEIPT_NONPAYABLE: u8 = 2;

#[program]
pub mod ratchet_work_market {
    use super::*;

    pub fn fund_rcx_voucher(
        ctx: Context<FundRcxVoucher>,
        nonce: u64,
        work_kind: u8,
        amount: u64,
    ) -> Result<()> {
        require!(work_kind > 0, WorkMarketError::InvalidWorkKind);
        require!(amount > 0, WorkMarketError::InvalidAmount);
        require_keys_eq!(
            ctx.accounts.token_program.key(),
            token_2022::ID,
            WorkMarketError::WrongTokenProgram
        );
        require!(
            ctx.accounts.completion_program.executable,
            WorkMarketError::CompletionProgramNotExecutable
        );
        require!(
            !ctx.accounts.subject.executable,
            WorkMarketError::ExecutableSubject
        );
        require_keys_eq!(
            *ctx.accounts.subject.owner,
            ctx.accounts.completion_program.key(),
            WorkMarketError::WrongSubjectOwner
        );
        require!(
            ctx.accounts.mint.decimals == RCX_DECIMALS,
            WorkMarketError::WrongDecimals
        );

        let clock = Clock::get()?;
        let voucher = &mut ctx.accounts.voucher;
        voucher.schema_version = SCHEMA_VERSION;
        voucher.bump = ctx.bumps.voucher;
        voucher.state = VoucherState::Funded as u8;
        voucher.work_kind = work_kind;
        voucher.completion_program = ctx.accounts.completion_program.key();
        voucher.subject = ctx.accounts.subject.key();
        voucher.sponsor = ctx.accounts.sponsor.key();
        voucher.nonce = nonce;
        voucher.funded_amount = amount;
        voucher.settled_amount = 0;
        voucher.funded_slot = clock.slot;
        voucher.funded_ts = clock.unix_timestamp;
        voucher.completion_receipt = Pubkey::default();
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

        emit!(VoucherFunded {
            voucher: voucher.key(),
            sponsor: voucher.sponsor,
            completion_program: voucher.completion_program,
            subject: voucher.subject,
            work_kind,
            nonce,
            amount,
        });
        Ok(())
    }

    pub fn claim_rcx_voucher(ctx: Context<ClaimRcxVoucher>) -> Result<()> {
        let voucher_key = ctx.accounts.voucher.key();
        let receipt =
            load_completion_receipt(&ctx.accounts.completion_receipt, &ctx.accounts.voucher)?;
        require!(
            receipt.disposition == RECEIPT_PAYABLE,
            WorkMarketError::ReceiptNotPayable
        );
        require_keys_eq!(
            ctx.accounts.worker.key(),
            receipt.worker,
            WorkMarketError::WrongWorker
        );
        require_keys_eq!(
            ctx.accounts.token_program.key(),
            token_2022::ID,
            WorkMarketError::WrongTokenProgram
        );

        let amount = ctx.accounts.vault.amount;
        require!(
            amount >= ctx.accounts.voucher.funded_amount,
            WorkMarketError::VaultUnderfunded
        );
        transfer_from_vault(
            &ctx.accounts.voucher,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.worker_token,
            &ctx.accounts.token_program,
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
        voucher.completion_receipt = ctx.accounts.completion_receipt.key();
        voucher.beneficiary = receipt.worker;
        voucher.result_hash = receipt.result_hash;
        emit!(VoucherPaid {
            voucher: voucher_key,
            receipt: voucher.completion_receipt,
            worker: receipt.worker,
            amount,
        });
        Ok(())
    }

    pub fn refund_rcx_voucher(ctx: Context<RefundRcxVoucher>) -> Result<()> {
        let voucher_key = ctx.accounts.voucher.key();
        let receipt =
            load_completion_receipt(&ctx.accounts.completion_receipt, &ctx.accounts.voucher)?;
        require!(
            receipt.disposition == RECEIPT_NONPAYABLE,
            WorkMarketError::ReceiptNotNonpayable
        );
        require_keys_eq!(
            ctx.accounts.token_program.key(),
            token_2022::ID,
            WorkMarketError::WrongTokenProgram
        );

        let amount = ctx.accounts.vault.amount;
        require!(
            amount >= ctx.accounts.voucher.funded_amount,
            WorkMarketError::VaultUnderfunded
        );
        transfer_from_vault(
            &ctx.accounts.voucher,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.sponsor_token,
            &ctx.accounts.token_program,
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
        voucher.completion_receipt = ctx.accounts.completion_receipt.key();
        voucher.beneficiary = voucher.sponsor;
        voucher.result_hash = receipt.result_hash;
        emit!(VoucherRefunded {
            voucher: voucher_key,
            receipt: voucher.completion_receipt,
            sponsor: voucher.sponsor,
            amount,
        });
        Ok(())
    }

    pub fn close_voucher(ctx: Context<CloseVoucher>) -> Result<()> {
        require!(
            ctx.accounts.voucher.state == VoucherState::Paid as u8
                || ctx.accounts.voucher.state == VoucherState::Refunded as u8,
            WorkMarketError::VoucherStillFunded
        );
        emit!(VoucherClosed {
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
#[instruction(nonce: u64, work_kind: u8, amount: u64)]
pub struct FundRcxVoucher<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,
    /// CHECK: runtime checks bind this existing subject to completion_program.
    pub subject: UncheckedAccount<'info>,
    /// CHECK: executable is checked before any RCX moves.
    pub completion_program: UncheckedAccount<'info>,
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
    #[account(mut, address = RCX_MINT @ WorkMarketError::WrongMint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = sponsor,
        token::token_program = token_program,
    )]
    pub sponsor_token: InterfaceAccount<'info, TokenAccount>,
    #[account(address = token_2022::ID @ WorkMarketError::WrongTokenProgram)]
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
        constraint = voucher.state == VoucherState::Funded as u8 @ WorkMarketError::VoucherNotFunded,
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
    #[account(address = RCX_MINT @ WorkMarketError::WrongMint)]
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
    /// CHECK: owner, PDA, discriminator, layout and fields are checked manually.
    pub completion_receipt: UncheckedAccount<'info>,
    /// CHECK: rent destination is the sponsor permanently stored in voucher.
    #[account(mut, address = voucher.sponsor @ WorkMarketError::WrongSponsor)]
    pub sponsor: UncheckedAccount<'info>,
    #[account(address = token_2022::ID @ WorkMarketError::WrongTokenProgram)]
    pub token_program: Interface<'info, TokenInterface>,
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
        constraint = voucher.state == VoucherState::Funded as u8 @ WorkMarketError::VoucherNotFunded,
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
    #[account(address = RCX_MINT @ WorkMarketError::WrongMint)]
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: owner, PDA, discriminator, layout and fields are checked manually.
    pub completion_receipt: UncheckedAccount<'info>,
    /// CHECK: both token and rent destinations are fixed to the stored sponsor.
    #[account(mut, address = voucher.sponsor @ WorkMarketError::WrongSponsor)]
    pub sponsor: UncheckedAccount<'info>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = sponsor,
        token::token_program = token_program,
    )]
    pub sponsor_token: InterfaceAccount<'info, TokenAccount>,
    #[account(address = token_2022::ID @ WorkMarketError::WrongTokenProgram)]
    pub token_program: Interface<'info, TokenInterface>,
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
        has_one = sponsor @ WorkMarketError::WrongSponsor,
    )]
    pub voucher: Account<'info, Voucher>,
    /// CHECK: address is constrained by has_one and only receives its own rent.
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
    pub sponsor: Pubkey,
    pub nonce: u64,
    pub funded_amount: u64,
    pub settled_amount: u64,
    pub funded_slot: u64,
    pub funded_ts: i64,
    pub completion_receipt: Pubkey,
    pub beneficiary: Pubkey,
    pub result_hash: [u8; 32],
}

impl Voucher {
    pub const LEN: usize = 2 + 1 + 1 + 1 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 32 + 32 + 32;
}

#[repr(u8)]
pub enum VoucherState {
    Funded = 0,
    Paid = 1,
    Refunded = 2,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CompletionReceiptView {
    disposition: u8,
    worker: Pubkey,
    result_hash: [u8; 32],
}

fn load_completion_receipt(
    account: &AccountInfo,
    voucher: &Voucher,
) -> Result<CompletionReceiptView> {
    require!(!account.executable, WorkMarketError::ExecutableReceipt);
    require_keys_eq!(
        *account.owner,
        voucher.completion_program,
        WorkMarketError::WrongReceiptOwner
    );
    let (expected, expected_bump) = Pubkey::find_program_address(
        &[
            b"completion",
            voucher.subject.as_ref(),
            &[voucher.work_kind],
        ],
        &voucher.completion_program,
    );
    require_keys_eq!(account.key(), expected, WorkMarketError::WrongReceiptPda);
    let data = account
        .try_borrow_data()
        .map_err(|_| error!(WorkMarketError::BadReceiptData))?;
    require!(
        data.len() == 8 + CompletionReceipt::LEN,
        WorkMarketError::BadReceiptLength
    );
    let discriminator = hashv(&[b"account:CompletionReceipt"]).to_bytes();
    require!(
        data[0..8] == discriminator[0..8],
        WorkMarketError::BadReceiptDiscriminator
    );

    let schema = u16::from_le_bytes([data[8], data[9]]);
    let bump = data[10];
    let disposition = data[11];
    let work_kind = data[12];
    let subject = Pubkey::new_from_array(
        data[13..45]
            .try_into()
            .map_err(|_| error!(WorkMarketError::BadReceiptData))?,
    );
    let worker = Pubkey::new_from_array(
        data[45..77]
            .try_into()
            .map_err(|_| error!(WorkMarketError::BadReceiptData))?,
    );
    let result_hash: [u8; 32] = data[77..109]
        .try_into()
        .map_err(|_| error!(WorkMarketError::BadReceiptData))?;
    require!(
        schema == COMPLETION_SCHEMA_VERSION,
        WorkMarketError::WrongReceiptSchema
    );
    require!(bump == expected_bump, WorkMarketError::WrongReceiptBump);
    require!(
        disposition == RECEIPT_PAYABLE || disposition == RECEIPT_NONPAYABLE,
        WorkMarketError::BadReceiptDisposition
    );
    require!(
        work_kind == voucher.work_kind,
        WorkMarketError::WrongReceiptWorkKind
    );
    require_keys_eq!(
        subject,
        voucher.subject,
        WorkMarketError::WrongReceiptSubject
    );
    if disposition == RECEIPT_PAYABLE {
        require!(
            worker != Pubkey::default(),
            WorkMarketError::MissingReceiptWorker
        );
    }
    Ok(CompletionReceiptView {
        disposition,
        worker,
        result_hash,
    })
}

/// Canonical account layout a compatible completion program must retain.
///
/// The Work Market authenticates the account owner and PDA under that program;
/// it never accepts decoded fields supplied directly by a caller.
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
    pub const LEN: usize = 2 + 1 + 1 + 1 + 32 + 32 + 32 + 8 + 8;
}

#[event]
pub struct VoucherFunded {
    pub voucher: Pubkey,
    pub sponsor: Pubkey,
    pub completion_program: Pubkey,
    pub subject: Pubkey,
    pub work_kind: u8,
    pub nonce: u64,
    pub amount: u64,
}

#[event]
pub struct VoucherPaid {
    pub voucher: Pubkey,
    pub receipt: Pubkey,
    pub worker: Pubkey,
    pub amount: u64,
}

#[event]
pub struct VoucherRefunded {
    pub voucher: Pubkey,
    pub receipt: Pubkey,
    pub sponsor: Pubkey,
    pub amount: u64,
}

#[event]
pub struct VoucherClosed {
    pub voucher: Pubkey,
    pub actor: Pubkey,
    pub sponsor: Pubkey,
}

#[error_code]
pub enum WorkMarketError {
    #[msg("amount must be nonzero")]
    InvalidAmount,
    #[msg("work kind zero is reserved")]
    InvalidWorkKind,
    #[msg("only the Token-2022 program is accepted")]
    WrongTokenProgram,
    #[msg("mint is not RCX")]
    WrongMint,
    #[msg("RCX decimals are wrong")]
    WrongDecimals,
    #[msg("completion program is not executable")]
    CompletionProgramNotExecutable,
    #[msg("subject must not be executable")]
    ExecutableSubject,
    #[msg("subject is not owned by the completion program")]
    WrongSubjectOwner,
    #[msg("voucher is not funded")]
    VoucherNotFunded,
    #[msg("voucher is still funded")]
    VoucherStillFunded,
    #[msg("vault balance fell below the funded amount")]
    VaultUnderfunded,
    #[msg("receipt must not be executable")]
    ExecutableReceipt,
    #[msg("receipt has the wrong program owner")]
    WrongReceiptOwner,
    #[msg("receipt PDA is wrong")]
    WrongReceiptPda,
    #[msg("receipt length is wrong")]
    BadReceiptLength,
    #[msg("receipt discriminator is wrong")]
    BadReceiptDiscriminator,
    #[msg("receipt bytes are malformed")]
    BadReceiptData,
    #[msg("receipt schema is unsupported")]
    WrongReceiptSchema,
    #[msg("receipt bump is wrong")]
    WrongReceiptBump,
    #[msg("receipt disposition is invalid")]
    BadReceiptDisposition,
    #[msg("receipt work kind is wrong")]
    WrongReceiptWorkKind,
    #[msg("receipt subject is wrong")]
    WrongReceiptSubject,
    #[msg("payable receipt has no worker")]
    MissingReceiptWorker,
    #[msg("receipt is not payable")]
    ReceiptNotPayable,
    #[msg("receipt is not terminally nonpayable")]
    ReceiptNotNonpayable,
    #[msg("worker does not match the receipt")]
    WrongWorker,
    #[msg("sponsor does not match the voucher")]
    WrongSponsor,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layouts_are_fixed() {
        assert_eq!(Voucher::LEN, 237);
        assert_eq!(CompletionReceipt::LEN, 117);
    }

    #[test]
    fn token_identity_is_exact() {
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
