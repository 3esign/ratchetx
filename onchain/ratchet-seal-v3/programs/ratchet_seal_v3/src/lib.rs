use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::{
    price_update::{PriceUpdateV2, VerificationLevel},
    ID_CONST as PYTH_RECEIVER_ID,
};

declare_id!("CqVGgsJpkWm4KtSzQkLk4LaRikgxnRrhbYGietTtu7AB");

pub const CRANKER_BOUNTY: u64 = 1_000_000; // 0.001 SOL
const MAX_CONF_BPS: u128 = 200;

#[program]
pub mod ratchet_seal_v3 {
    use super::*;

    pub fn create_match(
        ctx: Context<CreateMatch>,
        feed_id: [u8; 32],
        side: u8,
        kind: u8,
        target_bps: i32,
        duration_secs: i64,
        wager: u64,
    ) -> Result<()> {
        let game = &mut ctx.accounts.game;
        
        require!(wager > 0, RatchetError::InvalidWager);
        require!(duration_secs >= 10 && duration_secs <= 86400, RatchetError::InvalidDuration);
        require!(kind <= 2, RatchetError::BadKind);
        require!(side <= 1, RatchetError::BadSide);

        game.creator = ctx.accounts.creator.key();
        game.challenger = Pubkey::default();
        game.feed_id = feed_id;
        game.side = side;
        game.kind = kind;
        game.target_bps = target_bps;
        game.duration_secs = duration_secs;
        game.wager = wager;
        game.created_ts = Clock::get()?.unix_timestamp;
        game.joined_ts = 0;
        game.state = MatchState::Open as u8;

        // Transfer Wager + Cranker Bounty
        let total_deposit = wager.checked_add(CRANKER_BOUNTY).ok_or(RatchetError::MathOverflow)?;
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: game.to_account_info(),
                },
            ),
            total_deposit,
        )?;

        emit!(MatchCreated {
            game: game.key(),
            creator: game.creator,
            feed_id,
            wager,
        });
        Ok(())
    }

    pub fn join_match(ctx: Context<JoinMatch>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.state == MatchState::Open as u8, RatchetError::WrongState);

        game.challenger = ctx.accounts.challenger.key();
        game.joined_ts = Clock::get()?.unix_timestamp;
        game.state = MatchState::Active as u8;

        // Transfer Matching Wager
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.challenger.to_account_info(),
                    to: game.to_account_info(),
                },
            ),
            game.wager,
        )?;

        emit!(MatchJoined {
            game: game.key(),
            challenger: game.challenger,
            joined_ts: game.joined_ts,
        });
        Ok(())
    }

    pub fn settle_match(ctx: Context<SettleMatch>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.state == MatchState::Active as u8, RatchetError::WrongState);
        
        let now = Clock::get()?.unix_timestamp;
        let expiry_ts = game.joined_ts.checked_add(game.duration_secs).unwrap();
        require!(now >= expiry_ts, RatchetError::NotExpired);

        // Verify Entry Pyth Oracle (first tick AFTER joined_ts)
        let entry_pu = load_price_update(&ctx.accounts.entry_update)?;
        require!(&entry_pu.price_message.feed_id == &game.feed_id, RatchetError::BadFeed);
        require!(entry_pu.price_message.publish_time >= game.joined_ts, RatchetError::NotFirstUpdate);
        require!(entry_pu.price_message.prev_publish_time < game.joined_ts, RatchetError::NotFirstUpdate);
        require!(is_confidence_acceptable(entry_pu.price_message.price, entry_pu.price_message.conf), RatchetError::TooUncertain);

        // Verify Exit Pyth Oracle (first tick AFTER expiry_ts)
        let exit_pu = load_price_update(&ctx.accounts.exit_update)?;
        require!(&exit_pu.price_message.feed_id == &game.feed_id, RatchetError::BadFeed);
        require!(exit_pu.price_message.publish_time >= expiry_ts, RatchetError::NotFirstUpdate);
        require!(exit_pu.price_message.prev_publish_time < expiry_ts, RatchetError::NotFirstUpdate);
        require!(is_confidence_acceptable(exit_pu.price_message.price, exit_pu.price_message.conf), RatchetError::TooUncertain);

        let entry_e12 = scale_to_e12(entry_pu.price_message.price, entry_pu.price_message.exponent)?;
        let exit_e12 = scale_to_e12(exit_pu.price_message.price, exit_pu.price_message.exponent)?;

        // Calculate thresholds and winner
        let threshold_e12 = match game.kind {
            0 => entry_e12,
            1 | 2 => {
                let shift = entry_e12.checked_mul(game.target_bps as i64).unwrap().checked_div(10000).unwrap();
                entry_e12.checked_add(shift).unwrap()
            },
            _ => return err!(RatchetError::BadKind),
        };

        // Determine outcome
        // kind 0: UP from entry
        // kind 1: UP from entry + target_bps
        // kind 2: DOWN from entry - target_bps (target_bps is negative)
        let outcome_yes = match game.kind {
            0 | 1 => exit_e12 > threshold_e12,
            2 => exit_e12 < threshold_e12,
            _ => return err!(RatchetError::BadKind),
        };

        let is_equality = exit_e12 == threshold_e12;
        let creator_won = (game.side == 1) == outcome_yes;

        game.state = MatchState::Settled as u8;

        // Payouts
        let total_pot = game.wager.checked_mul(2).unwrap();
        
        // 1. Pay Cranker Bounty
        **game.to_account_info().try_borrow_mut_lamports()? = game.to_account_info().lamports().checked_sub(CRANKER_BOUNTY).unwrap();
        **ctx.accounts.cranker.to_account_info().try_borrow_mut_lamports()? = ctx.accounts.cranker.to_account_info().lamports().checked_add(CRANKER_BOUNTY).unwrap();

        // 2. Pay Winner (or refund on equality)
        if is_equality {
            **game.to_account_info().try_borrow_mut_lamports()? = game.to_account_info().lamports().checked_sub(total_pot).unwrap();
            **ctx.accounts.creator.to_account_info().try_borrow_mut_lamports()? = ctx.accounts.creator.to_account_info().lamports().checked_add(game.wager).unwrap();
            **ctx.accounts.challenger.to_account_info().try_borrow_mut_lamports()? = ctx.accounts.challenger.to_account_info().lamports().checked_add(game.wager).unwrap();
        } else if creator_won {
            **game.to_account_info().try_borrow_mut_lamports()? = game.to_account_info().lamports().checked_sub(total_pot).unwrap();
            **ctx.accounts.creator.to_account_info().try_borrow_mut_lamports()? = ctx.accounts.creator.to_account_info().lamports().checked_add(total_pot).unwrap();
        } else {
            **game.to_account_info().try_borrow_mut_lamports()? = game.to_account_info().lamports().checked_sub(total_pot).unwrap();
            **ctx.accounts.challenger.to_account_info().try_borrow_mut_lamports()? = ctx.accounts.challenger.to_account_info().lamports().checked_add(total_pot).unwrap();
        }

        emit!(MatchSettled {
            game: game.key(),
            creator_won,
            is_equality,
            entry_e12,
            exit_e12,
        });

        Ok(())
    }

    pub fn cancel_match(ctx: Context<CancelMatch>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.state == MatchState::Open as u8, RatchetError::WrongState);
        
        // Refund Creator (Wager + Cranker Bounty)
        let refund = game.wager.checked_add(CRANKER_BOUNTY).unwrap();
        **game.to_account_info().try_borrow_mut_lamports()? = game.to_account_info().lamports().checked_sub(refund).unwrap();
        **ctx.accounts.creator.to_account_info().try_borrow_mut_lamports()? = ctx.accounts.creator.to_account_info().lamports().checked_add(refund).unwrap();

        game.state = MatchState::Voided as u8;
        Ok(())
    }

    pub fn purge_zombie(ctx: Context<PurgeZombie>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.state == MatchState::Open as u8, RatchetError::WrongState);
        
        let now = Clock::get()?.unix_timestamp;
        require!(now > game.created_ts + 86400, RatchetError::NotExpired);

        // Refund Creator Wager + Bounty
        let refund = game.wager.checked_add(CRANKER_BOUNTY).unwrap();
        **game.to_account_info().try_borrow_mut_lamports()? = game.to_account_info().lamports().checked_sub(refund).unwrap();
        **ctx.accounts.creator.to_account_info().try_borrow_mut_lamports()? = ctx.accounts.creator.to_account_info().lamports().checked_add(refund).unwrap();
        
        game.state = MatchState::Voided as u8;
        // Rent automatically goes to the caller because of close = caller in the struct!
        Ok(())
    }
}

// ------------------------------------------------------------------
// UTILS
// ------------------------------------------------------------------

fn scale_to_e12(price: i64, exponent: i32) -> Result<i64> {
    let shift = 12i32.checked_add(exponent).ok_or(RatchetError::MathOverflow)?;
    let scaled = if shift >= 0 {
        let factor = 10i64.checked_pow(shift as u32).ok_or(RatchetError::MathOverflow)?;
        price.checked_mul(factor)
    } else {
        let divisor = 10i64.checked_pow((-shift) as u32).ok_or(RatchetError::MathOverflow)?;
        price.checked_div(divisor)
    };
    scaled.ok_or(error!(RatchetError::MathOverflow))
}

fn is_confidence_acceptable(price: i64, conf: u64) -> bool {
    if price <= 0 { return false; }
    let conf_bound = (conf as u128).saturating_mul(10_000);
    let price_bound = (price as u128).saturating_mul(MAX_CONF_BPS);
    conf_bound <= price_bound
}

fn load_price_update(ai: &AccountInfo) -> Result<PriceUpdateV2> {
    require!(*ai.owner == PYTH_RECEIVER_ID, RatchetError::BadPriceAccount);
    let data = ai.try_borrow_data()?;
    let mut slice: &[u8] = &data;
    let update = PriceUpdateV2::try_deserialize(&mut slice).map_err(|_| error!(RatchetError::BadPriceAccount))?;
    require!(update.verification_level == VerificationLevel::Full, RatchetError::PartialVerification);
    Ok(update)
}

// ------------------------------------------------------------------
// ACCOUNTS & INSTRUCTIONS
// ------------------------------------------------------------------

#[derive(Accounts)]
pub struct CreateMatch<'info> {
    #[account(
        init, payer = creator, space = 8 + GameMatch::SIZE,
        seeds = [b"match", creator.key().as_ref(), Clock::get().unwrap().unix_timestamp.to_le_bytes().as_ref()], bump
    )]
    pub game: Account<'info, GameMatch>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinMatch<'info> {
    #[account(mut)]
    pub game: Account<'info, GameMatch>,
    #[account(mut)]
    pub challenger: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleMatch<'info> {
    #[account(mut, close = creator)]
    pub game: Account<'info, GameMatch>,
    /// CHECK: Safe
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
    /// CHECK: Safe
    #[account(mut)]
    pub challenger: UncheckedAccount<'info>,
    /// CHECK: Pyth
    pub entry_update: UncheckedAccount<'info>,
    /// CHECK: Pyth
    pub exit_update: UncheckedAccount<'info>,
    #[account(mut)]
    pub cranker: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelMatch<'info> {
    #[account(mut, close = creator)]
    pub game: Account<'info, GameMatch>,
    #[account(mut, address = game.creator @ RatchetError::Unauthorized)]
    pub creator: Signer<'info>,
}

#[derive(Accounts)]
pub struct PurgeZombie<'info> {
    #[account(mut, close = caller)]
    pub game: Account<'info, GameMatch>,
    /// CHECK: Safe refund
    #[account(mut, address = game.creator)]
    pub creator: UncheckedAccount<'info>,
    #[account(mut)]
    pub caller: Signer<'info>,
}

#[account]
pub struct GameMatch {
    pub creator: Pubkey,
    pub challenger: Pubkey,
    pub feed_id: [u8; 32],
    pub wager: u64,
    pub created_ts: i64,
    pub joined_ts: i64,
    pub duration_secs: i64,
    pub target_bps: i32,
    pub kind: u8,
    pub side: u8,
    pub state: u8,
}
impl GameMatch { pub const SIZE: usize = 32 + 32 + 32 + 8 + 8 + 8 + 8 + 4 + 1 + 1 + 1; }

#[repr(u8)]
pub enum MatchState { Open = 0, Active = 1, Settled = 2, Voided = 3 }

#[event] pub struct MatchCreated { pub game: Pubkey, pub creator: Pubkey, pub feed_id: [u8; 32], pub wager: u64 }
#[event] pub struct MatchJoined { pub game: Pubkey, pub challenger: Pubkey, pub joined_ts: i64 }
#[event] pub struct MatchSettled { pub game: Pubkey, pub creator_won: bool, pub is_equality: bool, pub entry_e12: i64, pub exit_e12: i64 }

#[error_code]
pub enum RatchetError {
    #[msg("unauthorized")] Unauthorized,
    #[msg("invalid wager")] InvalidWager,
    #[msg("invalid duration")] InvalidDuration,
    #[msg("bad kind")] BadKind,
    #[msg("bad side")] BadSide,
    #[msg("wrong state")] WrongState,
    #[msg("not expired")] NotExpired,
    #[msg("bad feed")] BadFeed,
    #[msg("not first update")] NotFirstUpdate,
    #[msg("too uncertain")] TooUncertain,
    #[msg("math overflow")] MathOverflow,
    #[msg("bad price account")] BadPriceAccount,
    #[msg("partial verification")] PartialVerification,
}
