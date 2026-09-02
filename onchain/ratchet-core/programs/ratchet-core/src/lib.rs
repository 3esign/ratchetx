//! RatchetX Core v1 — the whole game as one frozen Solana program.
//!
//! Descends from Ratchet Seal v2 (mainnet, reproducible, frozen 2026-09-08):
//! the same sponsored-Pyth checkpoint clock, the same first-crossing settle,
//! the same equality-is-void rule. What v2 left on the server is here:
//!
//! * play credits (non-redeemable, never a token), staked and paid 1.7x;
//! * RCX reload: the player burns 70% and pays 30% straight to the daily
//!   podium in one transaction — the program never holds a token;
//! * XP, streak, rank, chambers, the daily podium;
//! * a bounded delegate grant for agents that cannot hold a wallet;
//! * a one-time Merkle claim of the legacy (server) balance.
//!
//! No admin, no upgrade path by design, no config account: every rule and
//! every referee is a constant compiled into these bytes. What is not here
//! (Brier/calibration, epoch chambers, crowd aggregates) belongs to a successor
//! program that reads these accounts — never to an upgrade of this one.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_interface::{self, Burn, Mint, TokenAccount, TokenInterface, TransferChecked};
use pyth_solana_receiver_sdk::{
    price_update::{PriceUpdateV2, VerificationLevel},
    ID_CONST as PYTH_RECEIVER_ID, PYTH_PUSH_ORACLE_ID,
};
use solana_sha256_hasher::hashv;

declare_id!("6sJn9CfSwD3Jt8V6vYyHq5hYmLKdDmaTgqwHY5czpPBv");

// ---------------------------------------------------------------------------
// Frozen rules. Change one and you have a different game under a new id.
// ---------------------------------------------------------------------------

/// $RCX mint (pump.fun launch). Reloads burn this and only this.
pub const RCX_MINT: Pubkey = pubkey!("FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump");
/// Legacy balance Merkle root (server snapshot). Zero until the G5 snapshot
/// build; a zero root admits no claim.
pub const LEGACY_ROOT: [u8; 32] = [0u8; 32];

pub const STAKE_MIN: u64 = 100;
pub const STAKE_MAX: u64 = 1_000_000_000;
/// HIT returns floor(stake * 17 / 10).
pub const HIT_PAYOUT_NUM: u64 = 17;
pub const HIT_PAYOUT_DEN: u64 = 10;
pub const SETTLE_XP: u64 = 1;
pub const XP_MULT_CAP: u64 = 20;
/// The stake at which the XP multiplier reaches its cap: STAKE_MIN · 20².
pub const XP_CAP_STAKE: u64 = STAKE_MIN * XP_MULT_CAP * XP_MULT_CAP;
/// streak multiplier = min(2.00, 1 + 0.15 * streak), in hundredths.
pub const STREAK_STEP_C: u64 = 15;
pub const STREAK_CAP_C: u64 = 200;
pub const RANK_XP: [u64; 5] = [0, 300, 900, 2200, 5000];
/// Reload split, frozen 2026-08-18: 70% burned, 30% to the live daily podium
/// (50/30/20), 0% to anyone else. Shares in thousandths.
pub const BURN_PER_MILLE: u64 = 700;
pub const PODIUM_CURVE_PER_MILLE: [u64; 3] = [500, 300, 200];
/// A shot with no captured crossing inside this window voids and refunds.
/// Was 900 s (the G1 "checkpoint race" assumed a PvP counterparty racing to
/// pin the price); with the credit pool as counterparty a long window is a
/// free option for the player whenever no runner is live, so 2026-09-02 it
/// became two minutes — longer than any sponsored feed's cadence, shorter
/// than any option worth waiting for.
pub const SETTLE_DEADLINE_SECS: i64 = 120;
/// A settled shot that is never revealed forfeits after this long past expiry.
pub const REVEAL_DEADLINE_SECS: i64 = 3_600;
pub const MAX_CONF_BPS: u128 = 200;
pub const SALT_HEX_BYTES: usize = 32;
pub const CLOCK_CAPACITY: usize = 64;
pub const SECONDS_PER_DAY: i64 = 86_400;

/// Supported horizons (minutes) and their base XP, exactly the live board.
pub const HORIZONS: [(u16, u64); 7] = [
    (5, 10),
    (10, 11),
    (15, 12),
    (30, 14),
    (60, 16),
    (360, 20),
    (1440, 24),
];

/// The referee table: Pyth feed ids, compiled in. Index = feed_index.
pub const FEEDS: [[u8; 32]; 7] = [
    hex32(b"ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"), // SOL
    hex32(b"e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43"), // BTC
    hex32(b"ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"), // ETH
    hex32(b"72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419"), // BONK
    hex32(b"4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc"), // WIF
    hex32(b"0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996"), // JUP
    hex32(b"7a01fca212788bba7c5bf8c9efd576a8a722f070d2c17596ff7bb609b8d5c3b9"), // PUMP
];

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
pub mod ratchet_core {
    use super::*;

    // ----------------------------------------------------------------- reload

    /// Burn RCX for play credits, 1 credit per whole token. In the same
    /// transaction 70% is burned and 30% is paid to the current daily podium
    /// (50/30/20) — to the seats' associated token accounts passed as
    /// `remaining_accounts` in seat order. A missing or unfunded seat share
    /// is burned too. Nothing is ever held by the program.
    pub fn reload<'info>(ctx: Context<'info, Reload<'info>>, amount: u64) -> Result<()> {
        require!(amount > 0, CoreError::InvalidAmount);
        let decimals = ctx.accounts.mint.decimals;
        let unit = 10u64
            .checked_pow(decimals as u32)
            .ok_or(CoreError::MathOverflow)?;
        let credits = amount / unit;
        require!(credits > 0, CoreError::InvalidAmount);

        let now = Clock::get()?.unix_timestamp;
        let today = day_of(now);
        let podium = &ctx.accounts.podium;
        let podium_live = podium.day == today || podium.day + 1 == today;

        let mut burn_amount = amount
            .checked_mul(BURN_PER_MILLE)
            .ok_or(CoreError::MathOverflow)?
            / 1000;
        let podium_amount = amount - burn_amount;
        let mut paid = 0u64;
        let mut paid_seats = 0u8;
        if podium_live && podium_amount > 0 {
            let program_id = ctx.accounts.token_program.key();
            let mint_key = ctx.accounts.mint.key();
            for (i, seat) in podium.seats.iter().enumerate() {
                if seat.player == Pubkey::default() {
                    continue;
                }
                let share = podium_amount
                    .checked_mul(PODIUM_CURVE_PER_MILLE[i])
                    .ok_or(CoreError::MathOverflow)?
                    / 1000;
                if share == 0 {
                    continue;
                }
                let expected = get_associated_token_address_with_program_id(&seat.player, &mint_key, &program_id);
                let Some(dest) = ctx.remaining_accounts.iter().find(|a| a.key() == expected) else { continue };
                // Destination must already exist and hold this mint; otherwise burn.
                if dest.owner != &program_id || dest.data_len() < 165 {
                    continue;
                }
                token_interface::transfer_checked(
                    CpiContext::new(
                        ctx.accounts.token_program.key(),
                        TransferChecked {
                            from: ctx.accounts.player_token.to_account_info(),
                            mint: ctx.accounts.mint.to_account_info(),
                            to: dest.clone(),
                            authority: ctx.accounts.player.to_account_info(),
                        },
                    ),
                    share,
                    decimals,
                )?;
                paid = paid.checked_add(share).ok_or(CoreError::MathOverflow)?;
                paid_seats += 1;
            }
        }
        // Whatever the podium did not take is burned: 100% of the reload leaves
        // the player's hands, 0% reaches anyone but champions and the fire.
        burn_amount = amount - paid;
        token_interface::burn(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.player_token.to_account_info(),
                    authority: ctx.accounts.player.to_account_info(),
                },
            ),
            burn_amount,
        )?;

        let ledger = &mut ctx.accounts.ledger;
        ledger.touch(ctx.accounts.player.key(), ctx.bumps.ledger);
        ledger.credits = ledger.credits.checked_add(credits).ok_or(CoreError::MathOverflow)?;
        ledger.burned = ledger.burned.saturating_add(burn_amount);
        ledger.reloaded = ledger.reloaded.saturating_add(amount);
        emit!(Reloaded {
            player: ctx.accounts.player.key(),
            amount,
            burned: burn_amount,
            podium_paid: paid,
            podium_seats: paid_seats,
            credits,
        });
        Ok(())
    }

    // ------------------------------------------------------------------- play

    /// Seal a directional call with the player's own signature.
    pub fn seal(
        ctx: Context<Seal>,
        nonce: u64,
        commit: [u8; 32],
        feed_index: u8,
        minutes: u16,
        stake: u64,
    ) -> Result<()> {
        let player = ctx.accounts.player.key();
        seal_inner(
            &mut ctx.accounts.shot,
            &mut ctx.accounts.ledger,
            ctx.bumps.ledger,
            &ctx.accounts.price_update,
            player,
            nonce,
            commit,
            feed_index,
            minutes,
            stake,
            None,
        )
    }

    /// Seal on behalf of a player under a bounded grant. The delegate signs
    /// and pays rent; the credits are the player's; nothing else is reachable.
    pub fn seal_delegated(
        ctx: Context<SealDelegated>,
        nonce: u64,
        commit: [u8; 32],
        feed_index: u8,
        minutes: u16,
        stake: u64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let grant = &mut ctx.accounts.grant;
        require!(grant.expiry_ts > now, CoreError::GrantExpired);
        require!(stake <= grant.max_stake, CoreError::StakeExceedsGrant);
        require!(stake <= grant.allowance, CoreError::AllowanceExhausted);
        grant.allowance -= stake;
        grant.used = grant.used.saturating_add(stake);
        grant.shots = grant.shots.saturating_add(1);
        let player = grant.player;
        seal_inner(
            &mut ctx.accounts.shot,
            &mut ctx.accounts.ledger,
            ctx.bumps.ledger,
            &ctx.accounts.price_update,
            player,
            nonce,
            commit,
            feed_index,
            minutes,
            stake,
            Some(ctx.accounts.delegate.key()),
        )
    }

    /// Permissionless capture of a fully verified sponsored Pyth push update
    /// into the feed clock. Duplicate or older observations are no-ops.
    pub fn checkpoint(ctx: Context<Checkpoint>, feed_index: u8) -> Result<()> {
        let feed_id = feed_id_at(feed_index)?;
        let pu = load_push_price_update(&ctx.accounts.price_update, &feed_id)?;
        let msg = &pu.price_message;
        require!(msg.feed_id == feed_id, CoreError::BadFeed);
        require!(msg.prev_publish_time < msg.publish_time, CoreError::NotFirstUpdate);
        check_confidence(msg.price, msg.conf)?;
        let price_e12 = scale_to_e12(msg.price, msg.exponent)?;

        let feed_clock = &mut ctx.accounts.feed_clock;
        if feed_clock.feed_id == [0; 32] {
            feed_clock.feed_id = feed_id;
            feed_clock.bump = ctx.bumps.feed_clock;
        }
        require!(feed_clock.feed_id == feed_id, CoreError::BadFeed);
        if msg.publish_time <= feed_clock.latest_publish_time {
            return Ok(());
        }
        // Preserve the predecessor signed into the Pyth message.  The
        // protocol clock may have missed one or more source updates; using
        // its own last checkpoint here would fabricate coverage across that
        // gap and let a late cranker choose a favourable later price.
        let observation = Observation {
            prev_publish_time: msg.prev_publish_time,
            publish_time: msg.publish_time,
            price_e12,
            posted_slot: pu.posted_slot,
        };
        if feed_clock.observations.len() < CLOCK_CAPACITY {
            feed_clock.observations.push(observation);
            feed_clock.head = (feed_clock.observations.len() % CLOCK_CAPACITY) as u8;
        } else {
            let index = feed_clock.head as usize;
            feed_clock.observations[index] = observation;
            feed_clock.head = ((index + 1) % CLOCK_CAPACITY) as u8;
        }
        feed_clock.latest_publish_time = msg.publish_time;
        emit!(Checkpointed {
            feed_id,
            prev_publish_time: msg.prev_publish_time,
            publish_time: msg.publish_time,
            price_e12,
            posted_slot: pu.posted_slot,
            cranker: ctx.accounts.cranker.key(),
        });
        Ok(())
    }

    /// Permissionless deterministic settlement: the unique fully verified
    /// update with `prev_publish_time < expiry <= publish_time`, inside the
    /// strict window. Equality voids and refunds. The economy waits for reveal.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let shot = &mut ctx.accounts.shot;
        require!(shot.state == ShotState::Sealed as u8, CoreError::WrongState);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= shot.expiry_ts, CoreError::NotExpired);
        let deadline = shot.expiry_ts.checked_add(SETTLE_DEADLINE_SECS).ok_or(CoreError::MathOverflow)?;
        require!(now < deadline, CoreError::SettlementDeadlinePassed);

        let feed_clock = &ctx.accounts.feed_clock;
        require!(feed_clock.feed_id == shot.feed_id, CoreError::BadFeed);
        let observation = feed_clock.crossing(shot.expiry_ts).ok_or(CoreError::CrossingNotCheckpointed)?;
        require!(observation.publish_time <= deadline, CoreError::PriceOutsideWindow);
        let exit_e12 = observation.price_e12;
        shot.exit_e12 = exit_e12;
        shot.exit_publish_time = observation.publish_time;
        shot.settled_ts = now;

        if exit_e12 == shot.entry_e12 {
            let ledger = &mut ctx.accounts.ledger;
            close_position(ledger, shot, Outcome::Void)?;
            shot.state = ShotState::Voided as u8;
            shot.void_reason = VoidReason::Equality as u8;
            emit!(Voided { shot: shot.key(), player: shot.player, reason: shot.void_reason, exit_e12 });
            return Ok(());
        }
        shot.state = ShotState::Settled as u8;
        emit!(Settled {
            shot: shot.key(),
            exit_e12,
            publish_time: observation.publish_time,
            posted_slot: observation.posted_slot,
            cranker: ctx.accounts.cranker.key(),
        });
        Ok(())
    }

    /// Reveal side, stated probability and salt; score the shot. Preimage:
    /// `RATCHET|v3|<wallet>|<nonce>|<YES-or-NO>|<p_bps>|<32-lower-hex-salt>`.
    /// `p_bps` is 0 (not stated) or 100..=9900. Anyone holding the salt may
    /// reveal; the outcome is a pure function of the sealed data.
    pub fn reveal(ctx: Context<Reveal>, side: u8, p_bps: u16, salt: String) -> Result<()> {
        let shot = &mut ctx.accounts.shot;
        require!(shot.state == ShotState::Settled as u8, CoreError::WrongState);
        require!(side <= 1, CoreError::BadSide);
        require!(p_bps == 0 || (100..=9900).contains(&p_bps), CoreError::BadProbability);
        validate_salt(&salt)?;
        let side_bytes: &[u8] = if side == 1 { b"YES" } else { b"NO" };
        let commitment = hashv(&[
            b"RATCHET|v3|",
            shot.player.to_string().as_bytes(),
            b"|",
            shot.nonce.to_string().as_bytes(),
            b"|",
            side_bytes,
            b"|",
            p_bps.to_string().as_bytes(),
            b"|",
            salt.as_bytes(),
        ]);
        require!(commitment.to_bytes() == shot.commit, CoreError::CommitMismatch);

        let outcome_yes = shot.exit_e12 > shot.entry_e12;
        let hit = (side == 1) == outcome_yes;
        shot.side = side;
        shot.p_bps = p_bps;
        shot.hit = u8::from(hit);
        shot.state = ShotState::Revealed as u8;

        let now = Clock::get()?.unix_timestamp;
        let ledger = &mut ctx.accounts.ledger;
        let gained = close_position(ledger, shot, if hit { Outcome::Hit } else { Outcome::Miss })?;
        shot.xp_awarded = gained;
        ledger.roll_day(now);
        ledger.daily_xp = ledger.daily_xp.saturating_add(gained);
        ctx.accounts.podium.consider(day_of(now), ledger.player, ledger.daily_xp);
        emit!(Revealed {
            shot: shot.key(),
            player: shot.player,
            side,
            p_bps,
            hit: shot.hit,
            xp: gained,
            credits_back: if hit { hit_payout(shot.stake) } else { 0 },
        });
        Ok(())
    }

    /// A settled shot nobody reveals in time is a MISS. Anyone may enforce it.
    pub fn forfeit(ctx: Context<Forfeit>) -> Result<()> {
        let shot = &mut ctx.accounts.shot;
        require!(shot.state == ShotState::Settled as u8, CoreError::WrongState);
        let now = Clock::get()?.unix_timestamp;
        let deadline = shot.expiry_ts.checked_add(REVEAL_DEADLINE_SECS).ok_or(CoreError::MathOverflow)?;
        require!(now >= deadline, CoreError::NotForfeitableYet);
        shot.state = ShotState::Forfeited as u8;
        let ledger = &mut ctx.accounts.ledger;
        close_position(ledger, shot, Outcome::Forfeit)?;
        emit!(Forfeited { shot: shot.key(), player: shot.player });
        Ok(())
    }

    /// After the strict window closes, an unsettled shot can only void.
    pub fn void_shot(ctx: Context<VoidShot>) -> Result<()> {
        let shot = &mut ctx.accounts.shot;
        require!(shot.state == ShotState::Sealed as u8, CoreError::WrongState);
        let deadline = shot.expiry_ts.checked_add(SETTLE_DEADLINE_SECS).ok_or(CoreError::MathOverflow)?;
        require!(Clock::get()?.unix_timestamp >= deadline, CoreError::NotVoidable);
        let ledger = &mut ctx.accounts.ledger;
        close_position(ledger, shot, Outcome::Void)?;
        shot.state = ShotState::Voided as u8;
        shot.void_reason = VoidReason::Deadline as u8;
        emit!(Voided { shot: shot.key(), player: shot.player, reason: shot.void_reason, exit_e12: shot.exit_e12 });
        Ok(())
    }

    /// Anyone may clean up a finished shot; rent always returns to the player.
    pub fn close_shot(_ctx: Context<CloseShot>) -> Result<()> {
        Ok(())
    }

    // --------------------------------------------------------------- delegate

    /// Grant a delegate the right to seal for you within bounds. Re-granting
    /// replaces the bounds; nothing else about the ledger is reachable.
    pub fn grant_delegate(ctx: Context<GrantDelegate>, allowance: u64, max_stake: u64, expiry_ts: i64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(expiry_ts > now && expiry_ts <= now + 30 * SECONDS_PER_DAY, CoreError::BadGrant);
        require!(max_stake >= STAKE_MIN && max_stake <= allowance, CoreError::BadGrant);
        let grant = &mut ctx.accounts.grant;
        grant.player = ctx.accounts.player.key();
        grant.delegate = ctx.accounts.delegate.key();
        grant.allowance = allowance;
        grant.max_stake = max_stake;
        grant.expiry_ts = expiry_ts;
        grant.bump = ctx.bumps.grant;
        Ok(())
    }

    pub fn revoke_delegate(_ctx: Context<RevokeDelegate>) -> Result<()> {
        Ok(())
    }

    // -------------------------------------------------------------- migration

    /// One-time claim of the legacy server balance against the compiled
    /// Merkle root. Leaf = sha256(wallet || credits_le || xp_le).
    pub fn claim_legacy(ctx: Context<ClaimLegacy>, credits: u64, xp: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        require!(LEGACY_ROOT != [0u8; 32], CoreError::NoMigration);
        require!(proof.len() <= 32, CoreError::InvalidMerkleProof);
        let player = ctx.accounts.player.key();
        let mut leaf_data = [0u8; 48];
        leaf_data[0..32].copy_from_slice(player.as_ref());
        leaf_data[32..40].copy_from_slice(&credits.to_le_bytes());
        leaf_data[40..48].copy_from_slice(&xp.to_le_bytes());
        let leaf = hashv(&[&leaf_data]).to_bytes();
        require!(verify_proof(&proof, &LEGACY_ROOT, &leaf), CoreError::InvalidMerkleProof);
        let ledger = &mut ctx.accounts.ledger;
        ledger.touch(player, ctx.bumps.ledger);
        ledger.credits = ledger.credits.checked_add(credits).ok_or(CoreError::MathOverflow)?;
        ledger.xp = ledger.xp.checked_add(xp).ok_or(CoreError::MathOverflow)?;
        ctx.accounts.claim.claimed = true;
        emit!(LegacyClaimed { player, credits, xp });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Shared logic
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn seal_inner<'info>(
    shot: &mut Account<'info, Shot>,
    ledger: &mut Account<'info, PlayerLedger>,
    ledger_bump: u8,
    price_update: &UncheckedAccount<'info>,
    player: Pubkey,
    nonce: u64,
    commit: [u8; 32],
    feed_index: u8,
    minutes: u16,
    stake: u64,
    delegate: Option<Pubkey>,
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    require!((STAKE_MIN..=STAKE_MAX).contains(&stake), CoreError::InvalidStake);
    let base_xp = base_xp_for(minutes)?;
    let feed_id = feed_id_at(feed_index)?;
    let expiry_ts = now.checked_add(i64::from(minutes) * 60).ok_or(CoreError::MathOverflow)?;

    ledger.touch(player, ledger_bump);
    require!(ledger.credits >= stake, CoreError::InsufficientCredits);
    require!(u32::from(ledger.open) < chambers_for(ledger.xp), CoreError::ChambersFull);

    let pu = load_push_price_update(price_update, &feed_id)?;
    let price = pu
        .get_price_no_older_than(&clock, max_seal_age(minutes), &feed_id)
        .map_err(|_| error!(CoreError::InvalidSealPrice))?;
    check_confidence(price.price, price.conf)?;
    let entry_e12 = scale_to_e12(price.price, price.exponent)?;

    ledger.credits -= stake;
    ledger.open += 1;
    ledger.sealed = ledger.sealed.saturating_add(1);

    shot.player = player;
    shot.delegate = delegate.unwrap_or_default();
    shot.nonce = nonce;
    shot.commit = commit;
    shot.feed_id = feed_id;
    shot.feed_index = feed_index;
    shot.minutes = minutes;
    shot.stake = stake;
    shot.xp_base = seal_xp(base_xp, stake);
    shot.sealed_ts = now;
    shot.expiry_ts = expiry_ts;
    shot.entry_e12 = entry_e12;
    shot.state = ShotState::Sealed as u8;
    emit!(Sealed {
        shot: shot.key(),
        player,
        delegate: shot.delegate,
        nonce,
        feed_index,
        minutes,
        stake,
        expiry_ts,
        entry_e12,
    });
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Outcome {
    Hit,
    Miss,
    Void,
    Forfeit,
}

/// Apply the credit and XP consequence of a finished shot. Returns XP gained.
fn close_position(ledger: &mut PlayerLedger, shot: &Shot, outcome: Outcome) -> Result<u64> {
    require!(ledger.player == shot.player, CoreError::WrongPlayer);
    ledger.open = ledger.open.saturating_sub(1);
    let gained = match outcome {
        Outcome::Void => {
            ledger.credits = ledger.credits.checked_add(shot.stake).ok_or(CoreError::MathOverflow)?;
            ledger.voids = ledger.voids.saturating_add(1);
            0
        }
        Outcome::Hit => {
            ledger.shots = ledger.shots.saturating_add(1);
            ledger.hits = ledger.hits.saturating_add(1);
            let skill = skill_xp(shot.xp_base, ledger.streak);
            ledger.streak = ledger.streak.saturating_add(1);
            if ledger.streak > ledger.best {
                ledger.best = ledger.streak;
            }
            ledger.credits = ledger.credits.checked_add(hit_payout(shot.stake)).ok_or(CoreError::MathOverflow)?;
            skill + SETTLE_XP
        }
        Outcome::Miss => {
            ledger.shots = ledger.shots.saturating_add(1);
            ledger.streak = 0;
            SETTLE_XP
        }
        Outcome::Forfeit => {
            ledger.shots = ledger.shots.saturating_add(1);
            ledger.forfeits = ledger.forfeits.saturating_add(1);
            ledger.streak = 0;
            0
        }
    };
    ledger.xp = ledger.xp.checked_add(gained).ok_or(CoreError::MathOverflow)?;
    Ok(gained)
}

pub fn day_of(unix_ts: i64) -> u64 {
    (unix_ts.max(0) / SECONDS_PER_DAY) as u64
}

pub fn hit_payout(stake: u64) -> u64 {
    stake.saturating_mul(HIT_PAYOUT_NUM) / HIT_PAYOUT_DEN
}

/// max(1, round(base_xp * min(20, sqrt(stake / 100)))) — the live rule, with
/// the rounding done exactly in integers (half rounds up), not in floats.
/// The multiplier caps at 20 from `XP_CAP_STAKE` on. Below it, with
/// S = base_xp² · stake, `round(sqrt(S) / 10)` is the largest n with
/// (n − ½)² ≤ S / 100, i.e. 5(2n − 1) ≤ isqrt(S).
pub fn seal_xp(base_xp: u64, stake: u64) -> u64 {
    if stake >= XP_CAP_STAKE {
        return base_xp.saturating_mul(XP_MULT_CAP).max(1);
    }
    let s = isqrt(base_xp.saturating_mul(base_xp).saturating_mul(stake));
    ((s / 5 + 1) / 2).max(1)
}

/// max(1, round(xp_base * min(2, 1 + 0.15 * streak))).
pub fn skill_xp(xp_base: u64, streak: u32) -> u64 {
    let mult_c = (100 + STREAK_STEP_C.saturating_mul(u64::from(streak))).min(STREAK_CAP_C);
    ((xp_base.saturating_mul(mult_c) + 50) / 100).max(1)
}

pub fn rank_of(xp: u64) -> u32 {
    let mut rank = 0u32;
    for (i, threshold) in RANK_XP.iter().enumerate() {
        if xp >= *threshold {
            rank = i as u32;
        }
    }
    rank
}

/// min(4, rank + 1) + 1: two chambers for a new wallet, five at the top.
pub fn chambers_for(xp: u64) -> u32 {
    (rank_of(xp) + 1).min(4) + 1
}

/// min(60, max(30, round(0.15 * window_seconds))) — the live seal rule.
pub fn max_seal_age(minutes: u16) -> u64 {
    let window = u64::from(minutes) * 60;
    ((window * 15 + 50) / 100).clamp(30, 60)
}

pub fn base_xp_for(minutes: u16) -> Result<u64> {
    HORIZONS
        .iter()
        .find(|(m, _)| *m == minutes)
        .map(|(_, xp)| *xp)
        .ok_or(error!(CoreError::BadHorizon))
}

pub fn feed_id_at(index: u8) -> Result<[u8; 32]> {
    FEEDS.get(index as usize).copied().ok_or(error!(CoreError::BadFeed))
}

pub fn isqrt(n: u64) -> u64 {
    if n < 2 {
        return n;
    }
    let mut x = (n as f64).sqrt() as u64;
    while x.saturating_mul(x) > n {
        x -= 1;
    }
    while (x + 1).saturating_mul(x + 1) <= n {
        x += 1;
    }
    x
}

fn validate_salt(salt: &str) -> Result<()> {
    let bytes = salt.as_bytes();
    require!(bytes.len() == SALT_HEX_BYTES, CoreError::BadSalt);
    require!(bytes.iter().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b)), CoreError::BadSalt);
    Ok(())
}

fn scale_to_e12(price: i64, exponent: i32) -> Result<i64> {
    let shift = 12i32.checked_add(exponent).ok_or(CoreError::MathOverflow)?;
    let scaled = if shift >= 0 {
        let factor = 10i64.checked_pow(shift as u32).ok_or(CoreError::MathOverflow)?;
        price.checked_mul(factor)
    } else {
        let divisor = 10i64.checked_pow((-shift) as u32).ok_or(CoreError::MathOverflow)?;
        price.checked_div(divisor)
    };
    scaled.ok_or(error!(CoreError::MathOverflow))
}

fn check_confidence(price: i64, conf: u64) -> Result<()> {
    require!(price > 0, CoreError::BadPrice);
    require!(
        (conf as u128).saturating_mul(10_000) <= (price as u128).saturating_mul(MAX_CONF_BPS),
        CoreError::TooUncertain
    );
    Ok(())
}

/// Deserialize only the official upgraded shard-0 sponsored Pyth push feed.
fn load_push_price_update(ai: &AccountInfo, feed_id: &[u8; 32]) -> Result<PriceUpdateV2> {
    require!(*ai.owner == PYTH_RECEIVER_ID, CoreError::BadPriceAccount);
    let shard_id = 0u16.to_le_bytes();
    let (expected_feed, _) = Pubkey::find_program_address(&[shard_id.as_ref(), feed_id.as_ref()], &PYTH_PUSH_ORACLE_ID);
    require!(ai.key() == expected_feed, CoreError::BadPriceAccount);
    let data = ai.try_borrow_data()?;
    let mut slice: &[u8] = &data;
    let update = PriceUpdateV2::try_deserialize(&mut slice).map_err(|_| error!(CoreError::BadPriceAccount))?;
    require!(update.write_authority == expected_feed, CoreError::BadPriceAccount);
    require!(update.verification_level.gte(VerificationLevel::Full), CoreError::PartialVerification);
    Ok(update)
}

fn verify_proof(proof: &[[u8; 32]], root: &[u8; 32], leaf: &[u8; 32]) -> bool {
    let mut computed = *leaf;
    for element in proof {
        computed = if computed <= *element {
            hashv(&[&computed, element]).to_bytes()
        } else {
            hashv(&[element, &computed]).to_bytes()
        };
    }
    computed == *root
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Reload<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + PlayerLedger::SIZE,
        seeds = [b"player", player.key().as_ref()],
        bump
    )]
    pub ledger: Account<'info, PlayerLedger>,
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + Podium::SIZE,
        seeds = [b"podium"],
        bump
    )]
    pub podium: Account<'info, Podium>,
    #[account(mut, address = RCX_MINT @ CoreError::WrongMint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = player,
        token::token_program = token_program,
    )]
    pub player_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct Seal<'info> {
    #[account(
        init,
        payer = player,
        space = 8 + Shot::SIZE,
        seeds = [b"shot", player.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub shot: Account<'info, Shot>,
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + PlayerLedger::SIZE,
        seeds = [b"player", player.key().as_ref()],
        bump
    )]
    pub ledger: Account<'info, PlayerLedger>,
    #[account(mut)]
    pub player: Signer<'info>,
    /// CHECK: owner, derivation, discriminator and verification level are checked in load_push_price_update.
    pub price_update: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct SealDelegated<'info> {
    #[account(
        mut,
        seeds = [b"grant", grant.player.as_ref(), delegate.key().as_ref()],
        bump = grant.bump,
        has_one = delegate @ CoreError::WrongDelegate,
    )]
    pub grant: Account<'info, DelegateGrant>,
    #[account(
        init,
        payer = delegate,
        space = 8 + Shot::SIZE,
        seeds = [b"shot", grant.player.as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub shot: Account<'info, Shot>,
    #[account(
        init_if_needed,
        payer = delegate,
        space = 8 + PlayerLedger::SIZE,
        seeds = [b"player", grant.player.as_ref()],
        bump
    )]
    pub ledger: Account<'info, PlayerLedger>,
    #[account(mut)]
    pub delegate: Signer<'info>,
    /// CHECK: checked in load_push_price_update.
    pub price_update: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(feed_index: u8)]
pub struct Checkpoint<'info> {
    #[account(
        init_if_needed,
        payer = cranker,
        space = 8 + FeedClock::SIZE,
        seeds = [b"clock".as_ref(), &[feed_index]],
        bump
    )]
    pub feed_clock: Account<'info, FeedClock>,
    #[account(mut)]
    pub cranker: Signer<'info>,
    /// CHECK: checked in load_push_price_update.
    pub price_update: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub shot: Account<'info, Shot>,
    #[account(mut, seeds = [b"player", shot.player.as_ref()], bump = ledger.bump)]
    pub ledger: Account<'info, PlayerLedger>,
    #[account(seeds = [b"clock".as_ref(), &[shot.feed_index]], bump = feed_clock.bump)]
    pub feed_clock: Account<'info, FeedClock>,
    pub cranker: Signer<'info>,
}

#[derive(Accounts)]
pub struct Reveal<'info> {
    #[account(mut)]
    pub shot: Account<'info, Shot>,
    #[account(mut, seeds = [b"player", shot.player.as_ref()], bump = ledger.bump)]
    pub ledger: Account<'info, PlayerLedger>,
    #[account(
        init_if_needed,
        payer = revealer,
        space = 8 + Podium::SIZE,
        seeds = [b"podium"],
        bump
    )]
    pub podium: Account<'info, Podium>,
    #[account(mut)]
    pub revealer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Forfeit<'info> {
    #[account(mut)]
    pub shot: Account<'info, Shot>,
    #[account(mut, seeds = [b"player", shot.player.as_ref()], bump = ledger.bump)]
    pub ledger: Account<'info, PlayerLedger>,
    pub cranker: Signer<'info>,
}

#[derive(Accounts)]
pub struct VoidShot<'info> {
    #[account(mut)]
    pub shot: Account<'info, Shot>,
    #[account(mut, seeds = [b"player", shot.player.as_ref()], bump = ledger.bump)]
    pub ledger: Account<'info, PlayerLedger>,
    pub cranker: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseShot<'info> {
    #[account(
        mut,
        close = player,
        has_one = player,
        constraint = shot.state == ShotState::Revealed as u8
            || shot.state == ShotState::Voided as u8
            || shot.state == ShotState::Forfeited as u8 @ CoreError::WrongState
    )]
    pub shot: Account<'info, Shot>,
    /// CHECK: has_one pins this rent recipient to the player stored in the shot.
    #[account(mut)]
    pub player: UncheckedAccount<'info>,
    pub cranker: Signer<'info>,
}

#[derive(Accounts)]
pub struct GrantDelegate<'info> {
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + DelegateGrant::SIZE,
        seeds = [b"grant", player.key().as_ref(), delegate.key().as_ref()],
        bump
    )]
    pub grant: Account<'info, DelegateGrant>,
    #[account(mut)]
    pub player: Signer<'info>,
    /// CHECK: any pubkey may be named as delegate; it only gains what the grant says.
    pub delegate: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeDelegate<'info> {
    #[account(
        mut,
        close = player,
        has_one = player,
        seeds = [b"grant", player.key().as_ref(), delegate.key().as_ref()],
        bump = grant.bump
    )]
    pub grant: Account<'info, DelegateGrant>,
    #[account(mut)]
    pub player: Signer<'info>,
    /// CHECK: seed only.
    pub delegate: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ClaimLegacy<'info> {
    #[account(
        init,
        payer = player,
        space = 8 + LegacyClaim::SIZE,
        seeds = [b"claim", player.key().as_ref()],
        bump
    )]
    pub claim: Account<'info, LegacyClaim>,
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + PlayerLedger::SIZE,
        seeds = [b"player", player.key().as_ref()],
        bump
    )]
    pub ledger: Account<'info, PlayerLedger>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
pub struct Shot {
    pub player: Pubkey,
    pub delegate: Pubkey,
    pub nonce: u64,
    pub commit: [u8; 32],
    pub feed_id: [u8; 32],
    pub feed_index: u8,
    pub minutes: u16,
    pub stake: u64,
    pub xp_base: u64,
    pub xp_awarded: u64,
    pub sealed_ts: i64,
    pub expiry_ts: i64,
    pub settled_ts: i64,
    pub entry_e12: i64,
    pub exit_e12: i64,
    pub exit_publish_time: i64,
    pub p_bps: u16,
    pub side: u8,
    pub hit: u8,
    pub state: u8,
    pub void_reason: u8,
}
impl Shot {
    pub const SIZE: usize = 32 + 32 + 8 + 32 + 32 + 1 + 2 + 8 + 8 + 8 + (8 * 6) + 2 + 4;
}

#[account]
pub struct PlayerLedger {
    pub player: Pubkey,
    pub credits: u64,
    pub xp: u64,
    pub streak: u32,
    pub best: u32,
    pub hits: u64,
    pub shots: u64,
    pub voids: u64,
    pub forfeits: u64,
    pub sealed: u64,
    pub open: u16,
    pub day: u64,
    pub daily_xp: u64,
    pub burned: u64,
    pub reloaded: u64,
    pub bump: u8,
}
impl PlayerLedger {
    pub const SIZE: usize = 32 + 8 + 8 + 4 + 4 + (8 * 5) + 2 + 8 + 8 + 8 + 8 + 1;
    fn touch(&mut self, player: Pubkey, bump: u8) {
        if self.player == Pubkey::default() {
            self.player = player;
            self.bump = bump;
        }
    }
    fn roll_day(&mut self, now: i64) {
        let today = day_of(now);
        if self.day != today {
            self.day = today;
            self.daily_xp = 0;
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct Seat {
    pub player: Pubkey,
    pub daily_xp: u64,
}

/// The live daily podium: top three wallets by XP earned today (UTC).
#[account]
pub struct Podium {
    pub day: u64,
    pub seats: [Seat; 3],
}
impl Podium {
    pub const SIZE: usize = 8 + 3 * (32 + 8);
    fn consider(&mut self, today: u64, player: Pubkey, daily_xp: u64) {
        if self.day != today {
            self.day = today;
            self.seats = [Seat::default(); 3];
        }
        let mut seats: Vec<Seat> = self.seats.iter().copied().filter(|s| s.player != Pubkey::default() && s.player != player).collect();
        seats.push(Seat { player, daily_xp });
        seats.sort_by(|a, b| b.daily_xp.cmp(&a.daily_xp).then(a.player.to_bytes().cmp(&b.player.to_bytes())));
        let mut out = [Seat::default(); 3];
        for (i, s) in seats.into_iter().take(3).enumerate() {
            out[i] = s;
        }
        self.seats = out;
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct Observation {
    pub prev_publish_time: i64,
    pub publish_time: i64,
    pub price_e12: i64,
    pub posted_slot: u64,
}

#[account]
pub struct FeedClock {
    pub feed_id: [u8; 32],
    pub latest_publish_time: i64,
    pub head: u8,
    pub bump: u8,
    pub observations: Vec<Observation>,
}
impl FeedClock {
    pub const SIZE: usize = 32 + 8 + 1 + 1 + 4 + (CLOCK_CAPACITY * 32);
    fn crossing(&self, expiry_ts: i64) -> Option<Observation> {
        self.observations
            .iter()
            .copied()
            .filter(|o| o.prev_publish_time < expiry_ts && o.publish_time >= expiry_ts)
            .min_by_key(|o| o.publish_time)
    }
}

#[account]
pub struct DelegateGrant {
    pub player: Pubkey,
    pub delegate: Pubkey,
    pub allowance: u64,
    pub max_stake: u64,
    pub used: u64,
    pub shots: u64,
    pub expiry_ts: i64,
    pub bump: u8,
}
impl DelegateGrant {
    pub const SIZE: usize = 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1;
}

#[account]
pub struct LegacyClaim {
    pub claimed: bool,
}
impl LegacyClaim {
    pub const SIZE: usize = 1;
}

#[repr(u8)]
pub enum ShotState {
    Sealed = 1,
    Settled = 2,
    Revealed = 3,
    Voided = 4,
    Forfeited = 5,
}

#[repr(u8)]
pub enum VoidReason {
    None = 0,
    Equality = 1,
    Deadline = 2,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct Reloaded {
    pub player: Pubkey,
    pub amount: u64,
    pub burned: u64,
    pub podium_paid: u64,
    pub podium_seats: u8,
    pub credits: u64,
}
#[event]
pub struct Sealed {
    pub shot: Pubkey,
    pub player: Pubkey,
    pub delegate: Pubkey,
    pub nonce: u64,
    pub feed_index: u8,
    pub minutes: u16,
    pub stake: u64,
    pub expiry_ts: i64,
    pub entry_e12: i64,
}
#[event]
pub struct Checkpointed {
    pub feed_id: [u8; 32],
    pub prev_publish_time: i64,
    pub publish_time: i64,
    pub price_e12: i64,
    pub posted_slot: u64,
    pub cranker: Pubkey,
}
#[event]
pub struct Settled {
    pub shot: Pubkey,
    pub exit_e12: i64,
    pub publish_time: i64,
    pub posted_slot: u64,
    pub cranker: Pubkey,
}
#[event]
pub struct Revealed {
    pub shot: Pubkey,
    pub player: Pubkey,
    pub side: u8,
    pub p_bps: u16,
    pub hit: u8,
    pub xp: u64,
    pub credits_back: u64,
}
#[event]
pub struct Forfeited {
    pub shot: Pubkey,
    pub player: Pubkey,
}
#[event]
pub struct Voided {
    pub shot: Pubkey,
    pub player: Pubkey,
    pub reason: u8,
    pub exit_e12: i64,
}
#[event]
pub struct LegacyClaimed {
    pub player: Pubkey,
    pub credits: u64,
    pub xp: u64,
}

#[error_code]
pub enum CoreError {
    #[msg("amount must be at least one whole token")]
    InvalidAmount,
    #[msg("wrong mint")]
    WrongMint,
    #[msg("stake out of range")]
    InvalidStake,
    #[msg("unsupported horizon")]
    BadHorizon,
    #[msg("bad or unknown price feed")]
    BadFeed,
    #[msg("not enough play credits")]
    InsufficientCredits,
    #[msg("all forecast chambers are open")]
    ChambersFull,
    #[msg("not an upgraded Pyth price update account")]
    BadPriceAccount,
    #[msg("price update is not fully verified")]
    PartialVerification,
    #[msg("seal price is stale, mismatched or otherwise invalid")]
    InvalidSealPrice,
    #[msg("oracle price must be positive")]
    BadPrice,
    #[msg("oracle confidence band is too wide")]
    TooUncertain,
    #[msg("not the first price update crossing expiry")]
    NotFirstUpdate,
    #[msg("shot is not in the required state")]
    WrongState,
    #[msg("window has not expired yet")]
    NotExpired,
    #[msg("strict settlement deadline has passed")]
    SettlementDeadlinePassed,
    #[msg("the exact first Pyth update crossing expiry has not been checkpointed")]
    CrossingNotCheckpointed,
    #[msg("price update is outside the strict settle window")]
    PriceOutsideWindow,
    #[msg("bad side")]
    BadSide,
    #[msg("probability must be 0 or 100..=9900 basis points")]
    BadProbability,
    #[msg("salt must be exactly 32 lowercase hexadecimal characters")]
    BadSalt,
    #[msg("reveal does not match the wallet-bound shot commitment")]
    CommitMismatch,
    #[msg("shot is not forfeitable yet")]
    NotForfeitableYet,
    #[msg("shot is not voidable yet")]
    NotVoidable,
    #[msg("ledger does not belong to this shot's player")]
    WrongPlayer,
    #[msg("grant expired")]
    GrantExpired,
    #[msg("stake exceeds the grant's per-shot maximum")]
    StakeExceedsGrant,
    #[msg("grant allowance exhausted")]
    AllowanceExhausted,
    #[msg("bad grant bounds")]
    BadGrant,
    #[msg("wrong delegate")]
    WrongDelegate,
    #[msg("no legacy migration compiled into this program")]
    NoMigration,
    #[msg("invalid Merkle proof")]
    InvalidMerkleProof,
    #[msg("math overflow")]
    MathOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::{Discriminator, InstructionData};

    #[test]
    fn xp_matches_the_server_formulas() {
        // base 10 (5 min), stake 100 -> mult 1.00 -> 10
        assert_eq!(seal_xp(10, 100), 10);
        // stake 500 -> sqrt(5)=2.236 -> 22.36 -> 22 ; server: round(10*2.236)=22
        assert_eq!(seal_xp(10, 500), 22);
        // stake 10,000 -> sqrt(100)=10 -> 100
        assert_eq!(seal_xp(10, 10_000), 100);
        // stake 1e9 -> capped at 20x
        assert_eq!(seal_xp(24, 1_000_000_000), 480);
        // rounding is exact: 24*sqrt(1.05)=24.59 -> 25 (a hundredths sqrt gave 24)
        assert_eq!(seal_xp(24, 105), 25);
        assert_eq!(seal_xp(16, 107), 17);
        assert_eq!(seal_xp(10, 39_999), 200);
        assert_eq!(seal_xp(10, 40_000), 200);
        assert_eq!(seal_xp(10, 40_001), 200);
        assert_eq!(seal_xp(1, 100), 1);
        assert_eq!(skill_xp(22, 0), 22);
        assert_eq!(skill_xp(22, 1), 25); // 22*1.15=25.3
        assert_eq!(skill_xp(50, 1), 58); // exact tie 57.5 rounds up (floats gave 57)
        assert_eq!(skill_xp(1, 0), 1);
        assert_eq!(skill_xp(22, 10), 44); // capped 2.0
        assert_eq!(hit_payout(500), 850);
        assert_eq!(hit_payout(101), 171);
    }

    #[test]
    fn ranks_chambers_and_seal_age_match_the_live_rules() {
        assert_eq!(rank_of(0), 0);
        assert_eq!(rank_of(299), 0);
        assert_eq!(rank_of(300), 1);
        assert_eq!(rank_of(5000), 4);
        assert_eq!(chambers_for(0), 2);
        assert_eq!(chambers_for(900), 4);
        assert_eq!(chambers_for(2200), 5);
        assert_eq!(chambers_for(999_999), 5);
        assert_eq!(max_seal_age(5), 45);
        assert_eq!(max_seal_age(1), 30);
        assert_eq!(max_seal_age(360), 60);
        assert_eq!(base_xp_for(30).unwrap(), 14);
        assert!(base_xp_for(7).is_err());
    }

    #[test]
    fn feed_table_is_the_live_referee_table() {
        assert_eq!(FEEDS[0][0], 0xef);
        assert_eq!(FEEDS[6][31], 0xb9);
        let shard_id = 0u16.to_le_bytes();
        let (address, _) = Pubkey::find_program_address(&[shard_id.as_ref(), FEEDS[0].as_ref()], &PYTH_PUSH_ORACLE_ID);
        assert_eq!(address, pubkey!("7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE"));
        assert_eq!(PYTH_RECEIVER_ID, pubkey!("rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp"));
    }

    #[test]
    fn podium_keeps_top_three_and_resets_daily() {
        let mut p = Podium { day: 0, seats: [Seat::default(); 3] };
        let a = Pubkey::new_unique();
        let b = Pubkey::new_unique();
        let c = Pubkey::new_unique();
        let d = Pubkey::new_unique();
        p.consider(10, a, 5);
        p.consider(10, b, 9);
        p.consider(10, c, 7);
        p.consider(10, d, 1);
        assert_eq!(p.seats[0].player, b);
        assert_eq!(p.seats[1].player, c);
        assert_eq!(p.seats[2].player, a);
        p.consider(10, a, 20);
        assert_eq!(p.seats[0].player, a);
        assert_eq!(p.seats[1].player, b);
        p.consider(11, d, 1);
        assert_eq!(p.day, 11);
        assert_eq!(p.seats[0].player, d);
        assert_eq!(p.seats[1].player, Pubkey::default());
    }

    #[test]
    fn close_position_conserves_credits_by_rule() {
        let mut l = PlayerLedger {
            player: Pubkey::new_unique(),
            credits: 1000,
            xp: 0,
            streak: 0,
            best: 0,
            hits: 0,
            shots: 0,
            voids: 0,
            forfeits: 0,
            sealed: 0,
            open: 1,
            day: 0,
            daily_xp: 0,
            burned: 0,
            reloaded: 0,
            bump: 0,
        };
        let shot = Shot {
            player: l.player,
            delegate: Pubkey::default(),
            nonce: 1,
            commit: [0; 32],
            feed_id: FEEDS[0],
            feed_index: 0,
            minutes: 5,
            stake: 500,
            xp_base: 22,
            xp_awarded: 0,
            sealed_ts: 0,
            expiry_ts: 300,
            settled_ts: 0,
            entry_e12: 1,
            exit_e12: 2,
            exit_publish_time: 0,
            p_bps: 0,
            side: 1,
            hit: 1,
            state: 2,
            void_reason: 0,
        };
        assert_eq!(close_position(&mut l, &shot, Outcome::Hit).unwrap(), 23);
        assert_eq!(l.credits, 1850);
        assert_eq!(l.streak, 1);
        l.open = 1;
        assert_eq!(close_position(&mut l, &shot, Outcome::Miss).unwrap(), 1);
        assert_eq!(l.credits, 1850);
        assert_eq!(l.streak, 0);
        l.open = 1;
        assert_eq!(close_position(&mut l, &shot, Outcome::Void).unwrap(), 0);
        assert_eq!(l.credits, 2350);
        l.open = 1;
        assert_eq!(close_position(&mut l, &shot, Outcome::Forfeit).unwrap(), 0);
        assert_eq!(l.credits, 2350);
        assert_eq!(l.xp, 24);
    }

    #[test]
    fn clock_selects_the_unique_first_crossing() {
        let feed_clock = FeedClock {
            feed_id: [7; 32],
            latest_publish_time: 120,
            head: 3,
            bump: 255,
            observations: vec![
                Observation { prev_publish_time: 90, publish_time: 100, price_e12: 1, posted_slot: 1 },
                Observation { prev_publish_time: 100, publish_time: 110, price_e12: 2, posted_slot: 2 },
                Observation { prev_publish_time: 110, publish_time: 120, price_e12: 3, posted_slot: 3 },
            ],
        };
        assert_eq!(feed_clock.crossing(105).unwrap().publish_time, 110);
        assert_eq!(feed_clock.crossing(110).unwrap().publish_time, 110);
        assert!(feed_clock.crossing(90).is_none());
        assert!(feed_clock.crossing(121).is_none());
    }

    #[test]
    fn clock_never_fabricates_coverage_across_a_source_gap() {
        let feed_clock = FeedClock {
            feed_id: [7; 32],
            latest_publish_time: 140,
            head: 2,
            bump: 255,
            observations: vec![
                Observation { prev_publish_time: 90, publish_time: 100, price_e12: 1, posted_slot: 1 },
                Observation { prev_publish_time: 120, publish_time: 140, price_e12: 2, posted_slot: 2 },
            ],
        };
        assert!(feed_clock.crossing(110).is_none(), "the missing 100..=120 source interval must void");
        assert_eq!(feed_clock.crossing(130).unwrap().publish_time, 140);
    }

    #[test]
    fn account_sizes_match_layouts() {
        assert_eq!(Shot::SIZE, 32 + 32 + 8 + 32 + 32 + 1 + 2 + 8 + 8 + 8 + 48 + 2 + 4);
        assert_eq!(PlayerLedger::SIZE, 131);
        assert_eq!(Podium::SIZE, 128);
        assert_eq!(DelegateGrant::SIZE, 105);
    }

    /// Prints the golden vectors consumed by `test/test_core_vectors.mjs`.
    /// `cargo test print_golden_vectors -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn print_golden_vectors() {
        let stakes: [u64; 22] = [
            100, 101, 105, 107, 149, 150, 225, 499, 500, 999, 1000, 2499, 2500, 9999, 10_000, 39_999,
            40_000, 40_001, 100_000, 1_000_000, 999_999_999, 1_000_000_000,
        ];
        let mut out = String::from("{\n");
        out.push_str(&format!(
            "\"program\":\"{}\",\"stake\":{{\"min\":{},\"max\":{},\"xpCapStake\":{}}},\"hitPayout\":[{},{}],\"settleXp\":{},\"rankXp\":{:?},\"maxConfBps\":{},\"settleDeadlineSecs\":{},\"revealDeadlineSecs\":{},\"burnPerMille\":{},\"podiumPerMille\":{:?},\n",
            crate::ID, STAKE_MIN, STAKE_MAX, XP_CAP_STAKE, HIT_PAYOUT_NUM, HIT_PAYOUT_DEN, SETTLE_XP, RANK_XP, MAX_CONF_BPS,
            SETTLE_DEADLINE_SECS, REVEAL_DEADLINE_SECS, BURN_PER_MILLE, PODIUM_CURVE_PER_MILLE
        ));
        out.push_str("\"horizons\":[");
        for (i, (m, b)) in HORIZONS.iter().enumerate() {
            out.push_str(&format!("{}{{\"minutes\":{},\"baseXp\":{},\"maxSealAge\":{}}}", if i > 0 { "," } else { "" }, m, b, max_seal_age(*m)));
        }
        out.push_str("],\n\"feeds\":[");
        for (i, f) in FEEDS.iter().enumerate() {
            let (addr, _) = Pubkey::find_program_address(&[0u16.to_le_bytes().as_ref(), f.as_ref()], &PYTH_PUSH_ORACLE_ID);
            let hex: String = f.iter().map(|b| format!("{:02x}", b)).collect();
            out.push_str(&format!("{}{{\"index\":{},\"feedId\":\"{}\",\"pushAccount\":\"{}\"}}", if i > 0 { "," } else { "" }, i, hex, addr));
        }
        out.push_str("],\n\"sealXp\":[");
        let mut first = true;
        for (_, b) in HORIZONS.iter() {
            for st in stakes.iter() {
                out.push_str(&format!("{}[{},{},{}]", if first { "" } else { "," }, b, st, seal_xp(*b, *st)));
                first = false;
            }
        }
        out.push_str("],\n\"skillXp\":[");
        first = true;
        for x in [1u64, 10, 22, 50, 57, 90, 100, 110, 480].iter() {
            for k in 0u32..=12 {
                out.push_str(&format!("{}[{},{},{}]", if first { "" } else { "," }, x, k, skill_xp(*x, k)));
                first = false;
            }
        }
        let wallet = Pubkey::new_from_array([7u8; 32]);
        let salt = "0123456789abcdef0123456789abcdef";
        out.push_str("],\n\"hitPayoutVectors\":[");
        for (i, st) in stakes.iter().enumerate() {
            out.push_str(&format!("{}[{},{}]", if i > 0 { "," } else { "" }, st, hit_payout(*st)));
        }
        out.push_str("],\n\"rank\":[");
        let xps = [0u64, 1, 299, 300, 301, 899, 900, 2199, 2200, 4999, 5000, 5001, 999_999];
        for (i, xp) in xps.iter().enumerate() {
            out.push_str(&format!("{}[{},{},{}]", if i > 0 { "," } else { "" }, xp, rank_of(*xp), chambers_for(*xp)));
        }
        let h = hashv(&[b"RATCHET|v3|", wallet.to_string().as_bytes(), b"|", b"42", b"|", b"YES", b"|", b"6500", b"|", salt.as_bytes()]);
        let hex: String = h.to_bytes().iter().map(|b| format!("{:02x}", b)).collect();
        // Instruction data (Anchor discriminator + Borsh args) and account
        // discriminators, so a client's encoder can be checked offline.
        let hx = |b: &[u8]| -> String { b.iter().map(|x| format!("{:02x}", x)).collect() };
        let ix: Vec<(&str, Vec<u8>)> = vec![
            ("reload", instruction::Reload { amount: 1_500_000 }.data()),
            ("seal", instruction::Seal { nonce: 42, commit: [7u8; 32], feed_index: 0, minutes: 5, stake: 500 }.data()),
            ("seal_delegated", instruction::SealDelegated { nonce: 42, commit: [7u8; 32], feed_index: 6, minutes: 1440, stake: 1_000_000_000 }.data()),
            ("checkpoint", instruction::Checkpoint { feed_index: 3 }.data()),
            ("settle", instruction::Settle {}.data()),
            ("reveal", instruction::Reveal { side: 1, p_bps: 6500, salt: salt.to_string() }.data()),
            ("forfeit", instruction::Forfeit {}.data()),
            ("void_shot", instruction::VoidShot {}.data()),
            ("close_shot", instruction::CloseShot {}.data()),
            ("grant_delegate", instruction::GrantDelegate { allowance: 10_000, max_stake: 500, expiry_ts: 1_800_000_000 }.data()),
            ("revoke_delegate", instruction::RevokeDelegate {}.data()),
            ("claim_legacy", instruction::ClaimLegacy { credits: 5_000, xp: 321, proof: vec![[1u8; 32], [2u8; 32]] }.data()),
        ];
        out.push_str("],\n\"ix\":{");
        for (i, (name, data)) in ix.iter().enumerate() {
            out.push_str(&format!("{}\"{}\":\"{}\"", if i > 0 { "," } else { "" }, name, hx(data)));
        }
        out.push_str("},\n\"accounts\":{");
        let accs: Vec<(&str, [u8; 8], usize)> = vec![
            ("Shot", Shot::DISCRIMINATOR.try_into().unwrap(), 8 + Shot::SIZE),
            ("PlayerLedger", PlayerLedger::DISCRIMINATOR.try_into().unwrap(), 8 + PlayerLedger::SIZE),
            ("Podium", Podium::DISCRIMINATOR.try_into().unwrap(), 8 + Podium::SIZE),
            ("FeedClock", FeedClock::DISCRIMINATOR.try_into().unwrap(), 8 + FeedClock::SIZE),
            ("DelegateGrant", DelegateGrant::DISCRIMINATOR.try_into().unwrap(), 8 + DelegateGrant::SIZE),
            ("LegacyClaim", LegacyClaim::DISCRIMINATOR.try_into().unwrap(), 8 + LegacyClaim::SIZE),
        ];
        for (i, (name, disc, size)) in accs.iter().enumerate() {
            out.push_str(&format!("{}\"{}\":{{\"discriminator\":\"{}\",\"size\":{}}}", if i > 0 { "," } else { "" }, name, hx(disc), size));
        }
        let (ledger_pda, _) = Pubkey::find_program_address(&[b"player", wallet.as_ref()], &crate::ID);
        let (shot_pda, _) = Pubkey::find_program_address(&[b"shot", wallet.as_ref(), &42u64.to_le_bytes()], &crate::ID);
        let (clock_pda, _) = Pubkey::find_program_address(&[b"clock".as_ref(), &[3u8]], &crate::ID);
        let (podium_pda, _) = Pubkey::find_program_address(&[b"podium"], &crate::ID);
        let (grant_pda, _) = Pubkey::find_program_address(&[b"grant", wallet.as_ref(), Pubkey::new_from_array([9u8; 32]).as_ref()], &crate::ID);
        let (claim_pda, _) = Pubkey::find_program_address(&[b"claim", wallet.as_ref()], &crate::ID);
        // Serialized account samples (discriminator + Borsh), for parsers.
        let shot = Shot { player: wallet, delegate: Pubkey::new_from_array([9u8; 32]), nonce: 42, commit: [7u8; 32], feed_id: FEEDS[3], feed_index: 3, minutes: 30, stake: 2_500, xp_base: 70, xp_awarded: 81, sealed_ts: 1_800_000_000, expiry_ts: 1_800_001_800, settled_ts: 1_800_001_805, entry_e12: 123_456_789_012_345, exit_e12: 123_456_789_999_999, exit_publish_time: 1_800_001_803, p_bps: 6500, side: 1, hit: 1, state: 3, void_reason: 0 };
        let ledger = PlayerLedger { player: wallet, credits: 9_350, xp: 24, streak: 0, best: 1, hits: 1, shots: 2, voids: 1, forfeits: 0, sealed: 3, open: 1, day: 20_833, daily_xp: 24, burned: 700_000, reloaded: 1_000_000, bump: 254 };
        let podium = Podium { day: 20_833, seats: [Seat { player: wallet, daily_xp: 24 }, Seat { player: Pubkey::new_from_array([9u8; 32]), daily_xp: 7 }, Seat::default()] };
        let clock = FeedClock { feed_id: FEEDS[3], latest_publish_time: 1_800_001_803, head: 2, bump: 253, observations: vec![
            Observation { prev_publish_time: 1_800_001_700, publish_time: 1_800_001_700, price_e12: 123_456_789_012_345, posted_slot: 300_000_000 },
            Observation { prev_publish_time: 1_800_001_700, publish_time: 1_800_001_803, price_e12: 123_456_789_999_999, posted_slot: 300_000_250 },
        ] };
        let grant = DelegateGrant { player: wallet, delegate: Pubkey::new_from_array([9u8; 32]), allowance: 10_000, max_stake: 500, used: 1_000, shots: 2, expiry_ts: 1_800_000_000, bump: 252 };
        let mut samples: Vec<(&str, Vec<u8>)> = Vec::new();
        let mut b = Vec::new(); shot.try_serialize(&mut b).unwrap(); samples.push(("Shot", b));
        let mut b = Vec::new(); ledger.try_serialize(&mut b).unwrap(); samples.push(("PlayerLedger", b));
        let mut b = Vec::new(); podium.try_serialize(&mut b).unwrap(); samples.push(("Podium", b));
        let mut b = Vec::new(); clock.try_serialize(&mut b).unwrap(); samples.push(("FeedClock", b));
        let mut b = Vec::new(); grant.try_serialize(&mut b).unwrap(); samples.push(("DelegateGrant", b));
        out.push_str("},\n\"samples\":{");
        for (i, (name, data)) in samples.iter().enumerate() {
            out.push_str(&format!("{}\"{}\":\"{}\"", if i > 0 { "," } else { "" }, name, hx(data)));
        }
        out.push_str(&format!(
            "}},\n\"pdas\":{{\"wallet\":\"{}\",\"delegate\":\"{}\",\"ledger\":\"{}\",\"shot42\":\"{}\",\"clock3\":\"{}\",\"podium\":\"{}\",\"grant\":\"{}\",\"claim\":\"{}\"",
            wallet, Pubkey::new_from_array([9u8; 32]), ledger_pda, shot_pda, clock_pda, podium_pda, grant_pda, claim_pda
        ));
        out.push_str(&format!(
            "}},\n\"commit\":{{\"wallet\":\"{}\",\"nonce\":42,\"side\":\"YES\",\"pBps\":6500,\"salt\":\"{}\",\"preimage\":\"RATCHET|v3|{}|42|YES|6500|{}\",\"sha256\":\"{}\"}}\n}}\n",
            wallet, salt, wallet, salt, hex
        ));
        print!("GOLDEN_VECTORS_BEGIN\n{}GOLDEN_VECTORS_END\n", out);
    }
}
