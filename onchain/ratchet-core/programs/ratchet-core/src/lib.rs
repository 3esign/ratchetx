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

// ---------------------------------------------------------------------------
//  THE CRANK PURSE
//
//  `checkpoint`, `bind_crossing`, `settle`, `void_shot` and `forfeit` are all
//  permissionless: anybody may call them. That is a property of the design and
//  it is worth very little on its own, because permissionless and unpaid means
//  the work gets done by whoever happens to care -- which is a dependency on a
//  person, exactly what this program exists not to have.
//
//  docs/ONCHAIN_COST.md measures the shape that fixes it. A checkpoint is only
//  useful where a shot expires, and one covers every shot expiring in that
//  publish interval, so the cost of cranking is proportional at low volume and
//  capped at high volume: 1.33 calls per shot at one player, 0.32 at ten
//  thousand. Cost per shot FALLS as the game grows. That is the shape a levy
//  can carry.
//
//  So `seal` puts a few thousand lamports into a purse and the permissionless
//  instructions pay their caller out of it. Cranking stops being charity and
//  becomes a trade.
//
//  THREE PROPERTIES THIS MUST HAVE, AND HOW EACH IS GOT:
//
//  1. It must never become a way to stop the game. The purse is passed through
//     `remaining_accounts`, so no existing account list changes and every
//     instruction still works with no purse in sight -- it simply pays nothing.
//     An empty purse is the same case. The failure mode is "unpaid", never
//     "refused".
//
//  2. It must never touch anybody's money. The purse holds only what seals put
//     in. It is not a pot, it is never a payout source, and nothing in the game
//     can spend it except a cranker collecting a bounty for work already done.
//
//  3. It must not be able to drain its own account below rent exemption, which
//     would delete it mid-game. `pay_cranker` computes the spendable balance as
//     lamports above the rent-exempt minimum and pays at most that.
//
//  BOTH NUMBERS SHIP AT ZERO, exactly as BAND_K_BPS does: the mechanism is
//  audited and deployed, the economics are a later decision made against
//  measured data rather than a guess baked into a freeze. At zero this code is
//  inert -- no levy is taken and no bounty is paid.
// ---------------------------------------------------------------------------
//  ENTRY MODE: where a shot's entry price comes from
//
//  Ruleset 2 takes the entry from the last print before the seal, no older than
//  max_seal_age -- which clamps at 60 seconds for every horizon. That works for
//  a feed on a 60-second heartbeat and fails completely on a slow one: the
//  tokenized equities publish every 870 seconds, so about 7 stock seals in 100
//  would clear the freshness bound and the rest would be refused. Correctly,
//  and every time. docs/STOCKS_DECISION.md has the measurement.
//
//  The tempting fix is to relax the bound on long horizons. It trades a refusal
//  problem for a worse one: a player sealing on a 15-minute-old price knows
//  which way the market moved and the program does not. That is not a rounding
//  error, it is an information asymmetry, and asymmetries get harvested
//  patiently rather than shrinking because the window is long.
//
//  ENTRY_FORWARD takes the entry from the FIRST print at or after the seal:
//
//      prev_publish_time < sealed_ts <= publish_time
//
//  which is the same crossing predicate `bind_crossing` already applies at the
//  other end of the shot, pointed at the other end. Exactly one Pyth message in
//  existence satisfies it. You cannot seal on a stale price if your entry price
//  DOES NOT EXIST YET -- so the freshness bound stops mattering without being
//  relaxed, and the promise gets stronger rather than weaker: from "your entry
//  is recent" to "your entry is unknowable at seal, by anyone, including us".
//
//  It is per feed because it would be a downgrade for a fast one. On SOL's
//  60-second heartbeat, forward-binding a five-minute shot would eat a fifth of
//  the window at the front for no benefit, since SOL already seals ~100% of the
//  time. So: slow feeds bind forward, fast feeds keep the observed entry.
//
//  SHIPS ALL ZERO -- every feed observed, exactly ruleset 2's behaviour --
//  because which feeds are slow is a measurement, and the measurement is
//  running rather than finished.
pub const ENTRY_OBSERVED: u8 = 0;
pub const ENTRY_FORWARD: u8 = 1;
pub const ENTRY_MODE: [u8; 7] = [ENTRY_OBSERVED; 7];

pub const CRANK_PURSE_SEED: &[u8] = b"crank_purse";
/// Taken from the player at `seal` and added to the purse. Ships at 0.
pub const CRANK_LEVY_LAMPORTS: u64 = 0;
/// Paid to the caller of a permissionless instruction. Ships at 0.
///
/// When it is set it must EXCEED the caller's transaction fee (5,000 lamports)
/// or nobody cranks: a bounty at or below cost is charity with extra steps.
pub const CRANK_BOUNTY_LAMPORTS: u64 = 0;

/// The ruleset a shot sealed today is sold under.
pub const RULESET_V2: u16 = 2;
/// The decision band, in basis points of the print's own confidence: a shot
/// whose exit lands within `band_k_bps/10_000 x conf` of its strike voids and
/// refunds, because that is exactly the zone a manipulator pays for.
///
/// It ships at ZERO -- the mechanism exists, the constant does not yet. No k
/// may be chosen from a model: the on-chain layout could not even retain the
/// confidence until now, so there has never been anything to measure one
/// against. It becomes a number after the 72-hour drill, from real rounds.
pub const BAND_K_BPS: u16 = 0;
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

/// Which horizons each feed may be sold at: bit `i` is `HORIZONS[i]`, indexed
/// by `feed_index`. A market whose source cadence cannot resolve a window has
/// no business selling that window -- the shot would void by design, and a
/// void that was predictable at seal is not a refund, it is a wasted chamber.
///
/// Every bit ships OPEN (0x7f = all seven horizons), so this changes nothing
/// today. It exists because the policy belongs in the program, where it is
/// one audited constant, rather than scattered across a server that can be
/// redeployed without anybody noticing.
pub const HORIZON_MASK: [u8; 7] = [0x7f; 7];

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
    pub fn seal<'info>(
        ctx: Context<'info, Seal<'info>>,
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
            &ctx.accounts.player.to_account_info(),
            ctx.remaining_accounts,
            ctx.program_id,
        )
    }

    /// Seal on behalf of a player under a bounded grant. The delegate signs
    /// and pays rent; the credits are the player's; nothing else is reachable.
    pub fn seal_delegated<'info>(
        ctx: Context<'info, SealDelegated<'info>>,
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
            // The delegate pays rent and fees on a delegated seal, so the
            // delegate pays the levy: whoever pays for the transaction pays
            // for the cranking that transaction will need.
            &ctx.accounts.delegate.to_account_info(),
            ctx.remaining_accounts,
            ctx.program_id,
        )
    }

    /// Create the crank purse. Permissionless and idempotent: anybody may call
    /// it, once, and there is nothing to configure. It holds no authority and
    /// no game balance -- only lamports that seals levied and cranker bounties
    /// have not yet taken out.
    ///
    /// Deliberately its own instruction rather than `init_if_needed` on `seal`:
    /// a player's first shot should not silently pay to create shared
    /// infrastructure, and an account that everybody needs should be creatable
    /// by anybody who wants the game to work.
    pub fn init_crank_purse(ctx: Context<InitCrankPurse>) -> Result<()> {
        let purse = &mut ctx.accounts.crank_purse;
        purse.bump = ctx.bumps.crank_purse;
        Ok(())
    }

    /// Permissionless capture of a fully verified sponsored Pyth push update
    /// into the feed clock. Duplicate or older observations are no-ops.
    pub fn checkpoint<'info>(
        ctx: Context<'info, Checkpoint<'info>>,
        feed_index: u8,
    ) -> Result<()> {
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
        let conf_e12 = scale_to_e12(
            i64::try_from(msg.conf).map_err(|_| error!(CoreError::MathOverflow))?,
            msg.exponent,
        )?;
        let observation = Observation {
            prev_publish_time: msg.prev_publish_time,
            publish_time: msg.publish_time,
            price_e12,
            conf_e12,
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
        // Paid for work already done, out of the purse if the caller passed
        // it. Zero, and silent, when they did not or when it is empty.
        let _bounty = pay_cranker(
            purse_in(ctx.remaining_accounts, ctx.program_id),
            &ctx.accounts.cranker.to_account_info(),
        )?;
        Ok(())
    }

    /// Fix a forward shot's entry price to the first print at or after its
    /// seal. Permissionless and idempotent, exactly like `bind_crossing`, and
    /// for the same reason: the answer is a lookup, so who sends it and when
    /// cannot change it.
    pub fn bind_entry<'info>(
        ctx: Context<'info, BindEntry<'info>>,
    ) -> Result<()> {
        require!(ctx.accounts.shot.state == ShotState::Sealed as u8, CoreError::WrongState);
        require!(ctx.accounts.shot.ruleset == RULESET_V2, CoreError::UnknownRuleset);
        require!(
            entry_mode(ctx.accounts.shot.feed_index)? == ENTRY_FORWARD,
            CoreError::EntryAlreadyBound
        );
        bind_entry_from_ring(&mut ctx.accounts.shot, &ctx.accounts.feed_clock)?;
        emit!(EntryBound {
            shot: ctx.accounts.shot.key(),
            player: ctx.accounts.shot.player,
            entry_e12: ctx.accounts.shot.entry_e12,
            sealed_ts: ctx.accounts.shot.sealed_ts,
            publish_time: ctx.accounts.shot.entry_publish_time,
            prev_publish_time: ctx.accounts.shot.entry_prev_publish_time,
            binder: ctx.accounts.cranker.key(),
        });
        let _bounty = pay_cranker(
            purse_in(ctx.remaining_accounts, ctx.program_id),
            &ctx.accounts.cranker.to_account_info(),
        )?;
        Ok(())
    }

    /// Permissionless deterministic settlement: the unique fully verified
    /// update with `prev_publish_time < expiry <= publish_time`, inside the
    /// strict window. Equality voids and refunds. The economy waits for reveal.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(ctx.accounts.shot.state == ShotState::Sealed as u8, CoreError::WrongState);
        require!(now >= ctx.accounts.shot.expiry_ts, CoreError::NotExpired);
        // A shot is settled under the rules it was SOLD under, or not at all.
        // An upgrade that changes what these fields mean must bump RULESET and
        // teach settle the old one; it must never quietly re-price the air.
        require!(ctx.accounts.shot.ruleset == RULESET_V2, CoreError::UnknownRuleset);

        // A forward shot with no entry cannot be scored: there is no strike to
        // compare the exit against. Refusing is right -- the alternative is
        // settling against entry_e12 = 0, which would score every such shot a
        // hit. `bind_entry` is permissionless and idempotent, so this is a
        // "somebody call it" and never a stuck shot; `void_shot` still refunds
        // if nobody ever does.
        require!(ctx.accounts.shot.entry_bound == 1, CoreError::EntryNotBound);

        // Bind first if nobody did. From here down settlement reads only what
        // the shot itself carries, so a ring that wrapped between expiry and
        // this transaction cannot change the answer -- and neither can anyone
        // who chooses when to send it.
        if ctx.accounts.shot.crossing_bound == 0 {
            bind_from_ring(&mut ctx.accounts.shot, &ctx.accounts.feed_clock, now)?;
        }

        let shot = &mut ctx.accounts.shot;
        shot.settled_ts = now;
        let exit_e12 = shot.exit_e12;

        if exit_e12 == shot.entry_e12 {
            let ledger = &mut ctx.accounts.ledger;
            close_position(ledger, shot, Outcome::Void)?;
            shot.state = ShotState::Voided as u8;
            shot.void_reason = VoidReason::Equality as u8;
            emit!(Voided { shot: shot.key(), player: shot.player, reason: shot.void_reason, exit_e12 });
            return Ok(());
        }

        // The decision band, under the number this shot was SOLD under. At
        // k = 0 the band is empty and this is exactly the old rule; the
        // branch exists so that choosing a k later is a constant, not a fork.
        if shot.band_k_bps > 0 {
            let band = decision_band(shot.exit_conf_e12, shot.band_k_bps)?;
            let gap = i128::from(exit_e12)
                .checked_sub(i128::from(shot.entry_e12))
                .ok_or(CoreError::MathOverflow)?
                .unsigned_abs();
            if gap <= band {
                let ledger = &mut ctx.accounts.ledger;
                close_position(ledger, shot, Outcome::Void)?;
                shot.state = ShotState::Voided as u8;
                shot.void_reason = VoidReason::TooClose as u8;
                emit!(Voided { shot: shot.key(), player: shot.player, reason: shot.void_reason, exit_e12 });
                return Ok(());
            }
        }

        shot.state = ShotState::Settled as u8;
        emit!(Settled {
            shot: shot.key(),
            exit_e12,
            publish_time: shot.exit_publish_time,
            posted_slot: shot.exit_posted_slot,
            cranker: ctx.accounts.cranker.key(),
        });
        Ok(())
    }

    /// Permissionless: copy the crossing print into the shot the moment it
    /// exists. It costs one transaction and it is the only thing standing
    /// between a 64-slot ring and an outcome that depends on how busy the feed
    /// happened to be afterwards. Idempotent, so crankers may race freely.
    pub fn bind_crossing<'info>(
        ctx: Context<'info, BindCrossing<'info>>,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(ctx.accounts.shot.state == ShotState::Sealed as u8, CoreError::WrongState);
        require!(now >= ctx.accounts.shot.expiry_ts, CoreError::NotExpired);
        if ctx.accounts.shot.crossing_bound != 0 {
            return Ok(());
        }
        bind_from_ring(&mut ctx.accounts.shot, &ctx.accounts.feed_clock, now)?;
        let shot = &ctx.accounts.shot;
        emit!(CrossingBound {
            shot: shot.key(),
            player: shot.player,
            exit_e12: shot.exit_e12,
            conf_e12: shot.exit_conf_e12,
            prev_publish_time: shot.exit_prev_publish_time,
            publish_time: shot.exit_publish_time,
            posted_slot: shot.exit_posted_slot,
            binder: ctx.accounts.cranker.key(),
        });
        // Paid for work already done, out of the purse if the caller passed
        // it. Zero, and silent, when they did not or when it is empty.
        let _bounty = pay_cranker(
            purse_in(ctx.remaining_accounts, ctx.program_id),
            &ctx.accounts.cranker.to_account_info(),
        )?;
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
        // A bound shot has an answer already; voiding it would put the race
        // back where bind_crossing took it out. It stays voidable only as a
        // last-resort unlock, once even the reveal deadline has gone by.
        let grace = if shot.crossing_bound == 0 { SETTLE_DEADLINE_SECS } else { REVEAL_DEADLINE_SECS };
        let deadline = shot.expiry_ts.checked_add(grace).ok_or(CoreError::MathOverflow)?;
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
    // The three the levy needs. Passed rather than reached for, so the levy
    // cannot quietly acquire access to anything else in the context.
    player_ai: &AccountInfo<'info>,
    remaining_accounts: &[AccountInfo<'info>],
    program_id: &Pubkey,
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    require!((STAKE_MIN..=STAKE_MAX).contains(&stake), CoreError::InvalidStake);
    let base_xp = base_xp_for(minutes)?;
    let feed_id = feed_id_at(feed_index)?;
    horizon_allowed(feed_index, minutes)?;
    let expiry_ts = now.checked_add(i64::from(minutes) * 60).ok_or(CoreError::MathOverflow)?;

    ledger.touch(player, ledger_bump);
    require!(ledger.credits >= stake, CoreError::InsufficientCredits);
    require!(u32::from(ledger.open) < chambers_for(ledger.xp), CoreError::ChambersFull);

    // UNDER ENTRY_FORWARD THE ENTRY IS NOT READ HERE AT ALL. It does not exist
    // yet: it is the first print at or after this instant, and `bind_entry`
    // fixes it once that print lands. The freshness bound is therefore not
    // relaxed, it is inapplicable -- there is no stale price to seal on.
    //
    // The account is still loaded and still checked, because a seal on a feed
    // whose sponsored account is missing, mis-owned or unverified must fail
    // here rather than strand a shot nobody can bind.
    let mode = entry_mode(feed_index)?;
    let pu = load_push_price_update(price_update, &feed_id)?;
    let entry_e12 = if mode == ENTRY_FORWARD {
        require!(pu.price_message.feed_id == feed_id, CoreError::BadFeed);
        0
    } else {
        let price = pu
            .get_price_no_older_than(&clock, max_seal_age(minutes), &feed_id)
            .map_err(|_| error!(CoreError::InvalidSealPrice))?;
        check_confidence(price.price, price.conf)?;
        scale_to_e12(price.price, price.exponent)?
    };

    ledger.credits -= stake;
    ledger.open += 1;
    ledger.sealed = ledger.sealed.saturating_add(1);

    // THE LEVY. Lamports, not credits: the purse pays transaction fees, and
    // credits cannot pay a transaction fee. It is taken from the player's SOL
    // in the same transaction they are already paying rent and fees in.
    //
    // At CRANK_LEVY_LAMPORTS = 0 this whole block is skipped and seal behaves
    // exactly as it did under ruleset 2. When it is set, the purse becomes
    // REQUIRED rather than optional -- a levy that could be dodged by omitting
    // an account is not a levy -- and that requirement activates with the
    // number, not before it.
    if CRANK_LEVY_LAMPORTS > 0 {
        let purse = purse_in(remaining_accounts, program_id)
            .ok_or(CoreError::CrankPurseMissing)?;
        let from = player_ai
            .lamports()
            .checked_sub(CRANK_LEVY_LAMPORTS)
            .ok_or(CoreError::InsufficientLamports)?;
        **player_ai.try_borrow_mut_lamports()? = from;
        **purse.try_borrow_mut_lamports()? = purse
            .lamports()
            .checked_add(CRANK_LEVY_LAMPORTS)
            .ok_or(CoreError::MathOverflow)?;
    }

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
    // Observed entries are bound the moment they are read. Forward entries are
    // not, and `settle` refuses until they are.
    shot.entry_bound = if mode == ENTRY_FORWARD { 0 } else { 1 };
    shot.entry_publish_time = 0;
    shot.entry_prev_publish_time = 0;
    shot.ruleset = RULESET_V2;
    shot.band_k_bps = BAND_K_BPS;
    shot.crossing_bound = 0;
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

/// Copy the crossing print out of the ring and into the shot. Afterwards the
/// shot owns every number its settlement depends on -- price, confidence, the
/// predecessor it bracketed, the slot it was posted in -- so the outcome can be
/// rechecked by anyone from the shot alone, long after the ring has wrapped.
/// Which entry rule a feed sells under. Out-of-range is an error rather than a
/// default: a feed the table does not describe must not quietly get one.
pub fn entry_mode(feed_index: u8) -> Result<u8> {
    ENTRY_MODE
        .get(usize::from(feed_index))
        .copied()
        .ok_or(error!(CoreError::BadFeed))
}

/// Fix a forward shot's entry to the first print at or after its seal.
///
/// The same crossing predicate as the exit -- `prev_publish_time < t <=
/// publish_time` -- with `t` being `sealed_ts` instead of `expiry_ts`. Exactly
/// one Pyth message satisfies it, so this is a lookup and not a choice, and
/// running it twice reaches the same answer or refuses.
fn bind_entry_from_ring(shot: &mut Shot, feed_clock: &FeedClock) -> Result<()> {
    require!(feed_clock.feed_id == shot.feed_id, CoreError::BadFeed);
    require!(shot.entry_bound == 0, CoreError::EntryAlreadyBound);
    let observation = feed_clock
        .crossing(shot.sealed_ts)
        .ok_or(CoreError::CrossingNotCheckpointed)?;
    // The entry must not be a print that predates the seal. `crossing` already
    // guarantees it, and this says so out loud because it is the whole
    // property: an entry nobody could know at seal.
    require!(observation.publish_time >= shot.sealed_ts, CoreError::PriceOutsideWindow);
    check_confidence_e12(observation.price_e12, observation.conf_e12)?;
    shot.entry_e12 = observation.price_e12;
    shot.entry_publish_time = observation.publish_time;
    shot.entry_prev_publish_time = observation.prev_publish_time;
    shot.entry_bound = 1;
    Ok(())
}

fn bind_from_ring(shot: &mut Shot, feed_clock: &FeedClock, now: i64) -> Result<()> {
    require!(feed_clock.feed_id == shot.feed_id, CoreError::BadFeed);
    let deadline = shot.expiry_ts.checked_add(SETTLE_DEADLINE_SECS).ok_or(CoreError::MathOverflow)?;
    require!(now < deadline, CoreError::SettlementDeadlinePassed);
    let observation = feed_clock.crossing(shot.expiry_ts).ok_or(CoreError::CrossingNotCheckpointed)?;
    require!(observation.publish_time <= deadline, CoreError::PriceOutsideWindow);
    shot.exit_e12 = observation.price_e12;
    shot.exit_publish_time = observation.publish_time;
    shot.exit_conf_e12 = observation.conf_e12;
    shot.exit_prev_publish_time = observation.prev_publish_time;
    shot.exit_posted_slot = observation.posted_slot;
    shot.crossing_bound = 1;
    Ok(())
}

/// Half-width of the decision band around the strike, in e12 units. `k` is
/// basis points OF THE PRINT'S OWN CONFIDENCE, so k = 10_000 is exactly one
/// confidence interval either side. A non-positive confidence yields no band:
/// an unusable number must never widen the zone in which the house refunds.
pub fn decision_band(conf_e12: i64, k_bps: u16) -> Result<u128> {
    if k_bps == 0 || conf_e12 <= 0 {
        return Ok(0);
    }
    Ok(u128::try_from(conf_e12)
        .map_err(|_| error!(CoreError::MathOverflow))?
        .checked_mul(u128::from(k_bps))
        .ok_or(CoreError::MathOverflow)?
        / 10_000)
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
/// Find the crank purse among `remaining_accounts`, if the caller passed it.
///
/// Returning `None` rather than erroring is the whole design: a cranker who
/// does not care about the bounty omits the account and the instruction behaves
/// exactly as it did before the purse existed. The address is derived and
/// compared here, so passing some other account cannot redirect a payment.
pub fn purse_in<'a, 'info>(
    remaining: &'a [AccountInfo<'info>],
    program_id: &Pubkey,
) -> Option<&'a AccountInfo<'info>> {
    let (expected, _) = Pubkey::find_program_address(&[CRANK_PURSE_SEED], program_id);
    remaining
        .iter()
        .find(|ai| ai.key() == expected && ai.is_writable && ai.owner == program_id)
}

/// Pay a cranker for work already done, out of the purse, never below the
/// purse's own rent-exempt minimum.
///
/// Every branch that cannot pay returns `Ok(0)` rather than an error. A bounty
/// that could refuse an instruction would turn a funding mechanism into a way
/// to stop settlement, which is the opposite of the point.
pub fn pay_cranker(purse: Option<&AccountInfo>, cranker: &AccountInfo) -> Result<u64> {
    if CRANK_BOUNTY_LAMPORTS == 0 {
        return Ok(0);
    }
    let Some(purse) = purse else { return Ok(0) };
    let floor = Rent::get()?.minimum_balance(purse.data_len());
    let balance = purse.lamports();
    let spendable = balance.saturating_sub(floor);
    let pay = core::cmp::min(CRANK_BOUNTY_LAMPORTS, spendable);
    if pay == 0 {
        return Ok(0);
    }
    // Direct lamport movement: the purse is program-owned, so no CPI and no
    // signer seeds are needed, and there is no path here that can touch an
    // account this program does not own.
    **purse.try_borrow_mut_lamports()? = balance
        .checked_sub(pay)
        .ok_or(CoreError::MathOverflow)?;
    **cranker.try_borrow_mut_lamports()? = cranker
        .lamports()
        .checked_add(pay)
        .ok_or(CoreError::MathOverflow)?;
    Ok(pay)
}

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

pub fn horizon_index_of(minutes: u16) -> Result<usize> {
    HORIZONS
        .iter()
        .position(|(m, _)| *m == minutes)
        .ok_or(error!(CoreError::BadHorizon))
}

/// The matrix rule itself, taking the mask rather than reading the table, so
/// that a closed market can be tested without shipping a closed market.
pub fn horizon_allowed_in(mask: u8, minutes: u16) -> Result<()> {
    let i = horizon_index_of(minutes)?;
    require!(mask & (1u8 << i) != 0, CoreError::HorizonNotOfferedOnFeed);
    Ok(())
}

pub fn horizon_allowed(feed_index: u8, minutes: u16) -> Result<()> {
    let mask = *HORIZON_MASK
        .get(feed_index as usize)
        .ok_or(error!(CoreError::BadFeed))?;
    horizon_allowed_in(mask, minutes)
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

/// The same confidence rule, for values already scaled to e12 as the ring
/// stores them. A forward-bound entry has to clear the bar an observed entry
/// clears at seal, or the slow feed would buy laxity as well as lateness.
fn check_confidence_e12(price_e12: i64, conf_e12: i64) -> Result<()> {
    require!(price_e12 > 0, CoreError::BadPrice);
    require!(conf_e12 >= 0, CoreError::BadPrice);
    require!(
        (conf_e12 as u128).saturating_mul(10_000) <= (price_e12 as u128).saturating_mul(MAX_CONF_BPS),
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
pub struct BindEntry<'info> {
    #[account(mut)]
    pub shot: Account<'info, Shot>,
    #[account(seeds = [b"clock".as_ref(), &[shot.feed_index]], bump = feed_clock.bump)]
    pub feed_clock: Account<'info, FeedClock>,
    #[account(mut)]
    pub cranker: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitCrankPurse<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + CrankPurse::SIZE,
        seeds = [CRANK_PURSE_SEED],
        bump
    )]
    pub crank_purse: Account<'info, CrankPurse>,
    #[account(mut)]
    pub payer: Signer<'info>,
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
    // `mut` because a bounty credits this account. It was read-only while
    // cranking paid nothing; a lamport credit to a non-writable account fails
    // at runtime rather than at compile time, which is the kind of bug that
    // only shows up on a cluster.
    #[account(mut)]
    pub cranker: Signer<'info>,
}

#[derive(Accounts)]
pub struct BindCrossing<'info> {
    #[account(mut)]
    pub shot: Account<'info, Shot>,
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
    /// The confidence of the print this settled on, and the predecessor it
    /// bracketed. Kept WITH the shot so the settlement can be checked later
    /// against the rule that produced it, by anyone, without the ring.
    pub exit_conf_e12: i64,
    pub exit_prev_publish_time: i64,
    pub exit_posted_slot: u64,
    /// Which rules this shot was sold under. A later generation must never
    /// silently reinterpret an older shot.
    pub ruleset: u16,
    /// The decision band in force at SEAL, not at settle: if k ever changes,
    /// shots already in the air keep the number they were sold under.
    pub band_k_bps: u16,
    /// 0 unbound, 1 the crossing has been copied in from the ring.
    pub crossing_bound: u8,
    pub p_bps: u16,
    pub side: u8,
    pub hit: u8,
    pub state: u8,
    pub void_reason: u8,
    /// The publish time the entry was taken from. Under ENTRY_OBSERVED this is
    /// the print that was read at seal; under ENTRY_FORWARD it is the first
    /// print at or after the seal, and is zero until `bind_entry` runs.
    pub entry_publish_time: i64,
    /// Its predecessor, so the crossing that produced the entry can be checked
    /// by a stranger the same way the exit crossing can.
    pub entry_prev_publish_time: i64,
    /// 1 once the entry is fixed. Always 1 at seal under ENTRY_OBSERVED.
    pub entry_bound: u8,
}
impl Shot {
    pub const SIZE: usize =
        32 + 32 + 8 + 32 + 32 + 1 + 2 + 8 + 8 + 8 + (8 * 6) + 2 + 4 + 8 + 8 + 8 + 2 + 2 + 1
        // entry evidence: publish_time, prev_publish_time, entry_bound
        + 8 + 8 + 1;
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
    /// Pyth's confidence for this print, in the same e12 scale as the price.
    /// It was checked at checkpoint and then discarded, which made a decision
    /// band impossible to implement and -- worse -- impossible to audit: a
    /// settled shot did not carry the number the rule would have used.
    pub conf_e12: i64,
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
    pub const SIZE: usize = 32 + 8 + 1 + 1 + 4 + (CLOCK_CAPACITY * 40);
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
/// The crank purse. Holds only what seals levied and pays only cranker
/// bounties; it is never a payout source and no game balance is kept here.
/// The counters are for auditing the flow from outside without replaying every
/// transaction: levied in, paid out, and how many calls were compensated.
#[account]
pub struct CrankPurse {
    pub bump: u8,
    pub levied: u64,
    pub paid: u64,
    pub calls: u64,
}
impl CrankPurse {
    pub const SIZE: usize = 1 + 8 + 8 + 8;
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
    /// The exit landed inside the print's own uncertainty around the strike.
    /// Too close to call is not a loss.
    TooClose = 3,
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
pub struct EntryBound {
    pub shot: Pubkey,
    pub player: Pubkey,
    pub entry_e12: i64,
    pub sealed_ts: i64,
    pub publish_time: i64,
    pub prev_publish_time: i64,
    pub binder: Pubkey,
}
#[event]
pub struct CrossingBound {
    pub shot: Pubkey,
    pub player: Pubkey,
    pub exit_e12: i64,
    pub conf_e12: i64,
    pub prev_publish_time: i64,
    pub publish_time: i64,
    pub posted_slot: u64,
    pub binder: Pubkey,
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
    #[msg("the crank purse account is required while a levy is set")]
    CrankPurseMissing,
    #[msg("this shot's entry price is already bound")]
    EntryAlreadyBound,
    #[msg("this shot's entry price has not been bound yet")]
    EntryNotBound,
    #[msg("not enough lamports to pay the crank levy")]
    InsufficientLamports,
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
    #[msg("this horizon is not offered on this feed")]
    HorizonNotOfferedOnFeed,
    #[msg("shot was sealed under a ruleset this program cannot settle")]
    UnknownRuleset,
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
            exit_conf_e12: 0,
            exit_prev_publish_time: 0,
            exit_posted_slot: 0,
            ruleset: RULESET_V2,
            band_k_bps: 0,
            crossing_bound: 0,
            p_bps: 0,
            side: 1,
            hit: 1,
            state: 2,
            void_reason: 0, entry_publish_time: 0, entry_prev_publish_time: 0, entry_bound: 1,
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
                Observation { prev_publish_time: 90, publish_time: 100, price_e12: 1, conf_e12: 0, posted_slot: 1 },
                Observation { prev_publish_time: 100, publish_time: 110, price_e12: 2, conf_e12: 0, posted_slot: 2 },
                Observation { prev_publish_time: 110, publish_time: 120, price_e12: 3, conf_e12: 0, posted_slot: 3 },
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
                Observation { prev_publish_time: 90, publish_time: 100, price_e12: 1, conf_e12: 0, posted_slot: 1 },
                Observation { prev_publish_time: 120, publish_time: 140, price_e12: 2, conf_e12: 0, posted_slot: 2 },
            ],
        };
        assert!(feed_clock.crossing(110).is_none(), "the missing 100..=120 source interval must void");
        assert_eq!(feed_clock.crossing(130).unwrap().publish_time, 140);
    }

    #[test]
    fn account_sizes_match_layouts() {
        // 217 bytes of G1 layout, plus the 29 bytes G2 added so that a settled
        // shot carries every number its own settlement used, plus 17 for the
        // entry evidence: publish_time, prev_publish_time and the bound flag.
        //
        // A shot must be able to prove BOTH ends of itself to a stranger. It
        // could already prove its exit; under ENTRY_FORWARD the entry is also a
        // crossing somebody bound after the fact, so it needs the same evidence
        // or half the settlement is unauditable.
        //
        // The cost of those 17 bytes is real and small: rent goes from 0.002659
        // to 0.002777 SOL per open shot, which docs/ONCHAIN_COST.md recomputes
        // from this constant rather than restating.
        assert_eq!(Shot::SIZE, 32 + 32 + 8 + 32 + 32 + 1 + 2 + 8 + 8 + 8 + 48 + 2 + 4 + 29 + 17);
        assert_eq!(Shot::SIZE, 263);
        assert_eq!(FeedClock::SIZE, 46 + CLOCK_CAPACITY * 40);
        assert_eq!(PlayerLedger::SIZE, 131);
        assert_eq!(Podium::SIZE, 128);
        assert_eq!(DelegateGrant::SIZE, 105);
    }

    fn sealed_shot(expiry_ts: i64, entry_e12: i64, band_k_bps: u16) -> Shot {
        Shot {
            player: Pubkey::new_unique(),
            delegate: Pubkey::default(),
            nonce: 1,
            commit: [0; 32],
            feed_id: [7; 32],
            feed_index: 0,
            minutes: 5,
            stake: 500,
            xp_base: 22,
            xp_awarded: 0,
            sealed_ts: 0,
            expiry_ts,
            settled_ts: 0,
            entry_e12,
            exit_e12: 0,
            exit_publish_time: 0,
            exit_conf_e12: 0,
            exit_prev_publish_time: 0,
            exit_posted_slot: 0,
            ruleset: RULESET_V2,
            band_k_bps,
            crossing_bound: 0,
            p_bps: 0,
            side: 1,
            hit: 0,
            state: ShotState::Sealed as u8,
            void_reason: 0, entry_publish_time: 0, entry_prev_publish_time: 0, entry_bound: 1,
        }
    }

    fn ring(observations: Vec<Observation>) -> FeedClock {
        FeedClock {
            feed_id: [7; 32],
            latest_publish_time: observations.last().map(|o| o.publish_time).unwrap_or(0),
            head: observations.len() as u8,
            bump: 255,
            observations,
        }
    }

    #[test]
    fn binding_freezes_every_number_the_settlement_will_use() {
        let mut shot = sealed_shot(300, 1_000, 0);
        let clock = ring(vec![
            Observation { prev_publish_time: 280, publish_time: 290, price_e12: 900, conf_e12: 5, posted_slot: 11 },
            Observation { prev_publish_time: 290, publish_time: 305, price_e12: 1_100, conf_e12: 7, posted_slot: 12 },
            Observation { prev_publish_time: 305, publish_time: 320, price_e12: 1_900, conf_e12: 9, posted_slot: 13 },
        ]);
        bind_from_ring(&mut shot, &clock, 301).unwrap();
        assert_eq!(shot.crossing_bound, 1);
        assert_eq!(shot.exit_e12, 1_100);
        assert_eq!(shot.exit_publish_time, 305);
        assert_eq!(shot.exit_prev_publish_time, 290, "the predecessor Pyth signed, not our last checkpoint");
        assert_eq!(shot.exit_conf_e12, 7);
        assert_eq!(shot.exit_posted_slot, 12);
    }

    /// The property `bind_crossing` exists for: once bound, no amount of later
    /// cranking moves the answer. Here the ring is refilled past capacity with
    /// prints that would each have been chosen by a fresh lookup.
    #[test]
    fn a_bound_crossing_survives_a_ring_that_wrapped_entirely() {
        let mut shot = sealed_shot(300, 1_000, 0);
        let clock = ring(vec![
            Observation { prev_publish_time: 290, publish_time: 305, price_e12: 1_100, conf_e12: 7, posted_slot: 12 },
        ]);
        bind_from_ring(&mut shot, &clock, 301).unwrap();
        let bound = (shot.exit_e12, shot.exit_publish_time, shot.exit_conf_e12, shot.exit_posted_slot);

        let mut later = Vec::new();
        for i in 0..(CLOCK_CAPACITY as i64 * 2) {
            later.push(Observation {
                prev_publish_time: 299 + i,
                publish_time: 300 + i,
                price_e12: 5_000 + i,
                conf_e12: 400,
                posted_slot: 900 + i as u64,
            });
        }
        let flooded = ring(later.split_off(later.len() - CLOCK_CAPACITY));
        // A fresh lookup in the flooded ring WOULD pick something else...
        assert_ne!(flooded.crossing(300).map(|o| o.price_e12), Some(bound.0));
        // ...and the shot does not care, because it no longer reads the ring.
        assert_eq!((shot.exit_e12, shot.exit_publish_time, shot.exit_conf_e12, shot.exit_posted_slot), bound);
        assert_eq!(shot.crossing_bound, 1);
    }

    #[test]
    fn binding_refuses_what_settlement_would_have_refused() {
        // No crossing captured at all.
        let mut shot = sealed_shot(300, 1_000, 0);
        let empty = ring(vec![]);
        assert!(bind_from_ring(&mut shot, &empty, 301).is_err());
        assert_eq!(shot.crossing_bound, 0, "a failed bind must leave the shot untouched");

        // A crossing that lands beyond the strict window.
        let late = ring(vec![Observation {
            prev_publish_time: 299,
            publish_time: 300 + SETTLE_DEADLINE_SECS + 1,
            price_e12: 1_100,
            conf_e12: 7,
            posted_slot: 12,
        }]);
        assert!(bind_from_ring(&mut shot, &late, 301).is_err());

        // The wrong feed's clock.
        let mut wrong_feed = sealed_shot(300, 1_000, 0);
        wrong_feed.feed_id = [9; 32];
        let clock = ring(vec![Observation {
            prev_publish_time: 290, publish_time: 305, price_e12: 1_100, conf_e12: 7, posted_slot: 12,
        }]);
        assert!(bind_from_ring(&mut wrong_feed, &clock, 301).is_err());

        // Past the deadline nothing binds: that shot voids, as it always did.
        let mut stale = sealed_shot(300, 1_000, 0);
        assert!(bind_from_ring(&mut stale, &clock, 300 + SETTLE_DEADLINE_SECS).is_err());
    }

    #[test]
    fn the_decision_band_is_zero_until_a_k_is_chosen() {
        // What ships: the mechanism, with no width.
        assert_eq!(BAND_K_BPS, 0);
        assert_eq!(decision_band(1_000_000, BAND_K_BPS).unwrap(), 0);
        // And with a k, it is exactly k basis points of the print's own conf.
        assert_eq!(decision_band(1_000_000, 10_000).unwrap(), 1_000_000);
        assert_eq!(decision_band(1_000_000, 5_000).unwrap(), 500_000);
        assert_eq!(decision_band(1_000_000, 1).unwrap(), 100);
        // An unusable confidence never widens the zone in which the house refunds.
        assert_eq!(decision_band(0, 10_000).unwrap(), 0);
        assert_eq!(decision_band(-5, 10_000).unwrap(), 0);
        assert_eq!(decision_band(i64::MAX, 10_000).unwrap(), i64::MAX as u128);
    }

    #[test]
    fn the_feed_horizon_matrix_ships_fully_open() {
        assert_eq!(HORIZON_MASK.len(), FEEDS.len());
        for feed_index in 0..FEEDS.len() as u8 {
            for (minutes, _) in HORIZONS {
                horizon_allowed(feed_index, minutes)
                    .unwrap_or_else(|_| panic!("feed {feed_index} must still sell {minutes}m"));
            }
        }
        // An unknown horizon is still an unknown horizon, not a closed market.
        assert!(horizon_allowed(0, 7).is_err());
        assert!(horizon_allowed(FEEDS.len() as u8, 5).is_err());
    }

    /// The negative control: the mechanism must actually be able to say no.
    #[test]
    fn a_closed_market_refuses_the_horizons_it_cannot_resolve() {
        // 0b0000_0011 = only the 5m and 10m horizons are open.
        assert!(horizon_allowed_in(0b0000_0011, 5).is_ok());
        assert!(horizon_allowed_in(0b0000_0011, 10).is_ok());
        assert!(horizon_allowed_in(0b0000_0011, 15).is_err());
        assert!(horizon_allowed_in(0b0000_0011, 1440).is_err());
        // 0b0110_0000 = only the two slow horizons, which is what a market
        // that prints a few times an hour could honestly offer.
        assert!(horizon_allowed_in(0b0110_0000, 5).is_err());
        assert!(horizon_allowed_in(0b0110_0000, 360).is_ok());
        assert!(horizon_allowed_in(0b0110_0000, 1440).is_ok());
        assert!(horizon_allowed_in(0, 5).is_err(), "a fully closed market sells nothing");
        assert_eq!(horizon_index_of(1440).unwrap(), 6);
    }

    // ---- THE CRANK PURSE ----------------------------------------------
    //
    // Both numbers ship at zero, so the danger is not that the mechanism
    // misbehaves today -- it does nothing today. The danger is that it ships
    // WRONG and nobody notices until the number is raised, which is the same
    // trap BAND_K_BPS sits in. So these test the shape rather than the effect.

    // ---- ENTRY MODE ---------------------------------------------------

    #[test]
    fn every_feed_ships_on_the_observed_entry() {
        // Which feeds are slow enough to need a forward entry is a measurement,
        // and the measurement is running rather than finished. Until it lands,
        // every feed behaves exactly as it did under ruleset 2.
        assert_eq!(ENTRY_MODE.len(), FEEDS.len(), "one mode per feed, or a feed gets no rule");
        assert!(ENTRY_MODE.iter().all(|m| *m == ENTRY_OBSERVED));
    }

    #[test]
    fn a_feed_outside_the_table_has_no_entry_rule() {
        // Defaulting an unknown feed to ENTRY_OBSERVED would be the dangerous
        // direction: it would sell a slow feed under the fast rule.
        for i in 0..FEEDS.len() {
            assert!(entry_mode(i as u8).is_ok());
        }
        assert!(entry_mode(FEEDS.len() as u8).is_err());
        assert!(entry_mode(255).is_err());
    }

    #[test]
    fn a_forward_entry_is_the_first_print_at_or_after_the_seal() {
        // The same predicate as the exit, pointed at the other end of the shot:
        // prev_publish_time < sealed_ts <= publish_time. Exactly one message
        // satisfies it, so binding is a lookup and not a choice.
        let mut clock = FeedClock {
            feed_id: FEEDS[0], latest_publish_time: 0, bump: 1, head: 0,
            observations: vec![],
        };
        for (prev, pub_t, px) in [(100i64, 160i64, 10_000i64), (160, 220, 11_000), (220, 280, 12_000)] {
            clock.observations.push(Observation {
                prev_publish_time: prev, publish_time: pub_t, price_e12: px,
                conf_e12: 1, posted_slot: 1,
            });
        }
        let mut shot = sealed_shot(9_999, 0, 0);
        shot.feed_id = FEEDS[0];
        shot.feed_index = 0;
        shot.sealed_ts = 200;          // falls inside (160, 220]
        shot.entry_bound = 0;
        bind_entry_from_ring(&mut shot, &clock).unwrap();
        assert_eq!(shot.entry_e12, 11_000, "the print that BRACKETS the seal, not the one before it");
        assert_eq!(shot.entry_publish_time, 220);
        assert_eq!(shot.entry_prev_publish_time, 160);
        assert_eq!(shot.entry_bound, 1);
        // The entry is never a price that existed before the seal. That is the
        // whole property: nobody could know it when the shot was taken.
        assert!(shot.entry_publish_time >= shot.sealed_ts);
    }

    #[test]
    fn an_entry_binds_once_and_then_refuses() {
        let mut clock = FeedClock {
            feed_id: FEEDS[0], latest_publish_time: 0, bump: 1, head: 0,
            observations: vec![Observation {
                prev_publish_time: 160, publish_time: 220, price_e12: 11_000,
                conf_e12: 1, posted_slot: 1,
            }],
        };
        let mut shot = sealed_shot(9_999, 0, 0);
        shot.feed_id = FEEDS[0];
        shot.feed_index = 0;
        shot.sealed_ts = 200;
        shot.entry_bound = 0;
        bind_entry_from_ring(&mut shot, &clock).unwrap();
        let first = shot.entry_e12;
        // A second bind must refuse rather than re-price. Idempotent by
        // refusal, exactly like bind_crossing: whoever sends it and whenever
        // cannot change what the shot is worth.
        assert!(bind_entry_from_ring(&mut shot, &clock).is_err());
        assert_eq!(shot.entry_e12, first);
        clock.observations[0].price_e12 = 99_999;
        assert!(bind_entry_from_ring(&mut shot, &clock).is_err());
        assert_eq!(shot.entry_e12, first, "and a changed ring cannot reach a bound entry");
    }

    #[test]
    fn an_unbindable_entry_refuses_rather_than_scoring_zero() {
        // No observation brackets the seal: the ring has not been checkpointed
        // there. Refusing is the only safe answer -- entry_e12 would be 0, and
        // a strike of zero scores every shot a hit.
        let clock = FeedClock {
            feed_id: FEEDS[0], latest_publish_time: 0, bump: 1, head: 0,
            observations: vec![Observation {
                prev_publish_time: 300, publish_time: 360, price_e12: 11_000,
                conf_e12: 1, posted_slot: 1,
            }],
        };
        let mut shot = sealed_shot(9_999, 0, 0);
        shot.feed_id = FEEDS[0];
        shot.feed_index = 0;
        shot.sealed_ts = 200;
        shot.entry_bound = 0;
        assert!(bind_entry_from_ring(&mut shot, &clock).is_err());
        assert_eq!(shot.entry_bound, 0);
        assert_eq!(shot.entry_e12, 0);
    }

    #[test]
    fn a_forward_entry_clears_the_same_confidence_bar() {
        // A slow feed must not buy laxity along with lateness.
        let clock = FeedClock {
            feed_id: FEEDS[0], latest_publish_time: 0, bump: 1, head: 0,
            observations: vec![Observation {
                prev_publish_time: 160, publish_time: 220, price_e12: 10_000,
                conf_e12: 10_000, posted_slot: 1,          // 100% of price: absurd
            }],
        };
        let mut shot = sealed_shot(9_999, 0, 0);
        shot.feed_id = FEEDS[0];
        shot.feed_index = 0;
        shot.sealed_ts = 200;
        shot.entry_bound = 0;
        assert!(bind_entry_from_ring(&mut shot, &clock).is_err(),
            "a print too uncertain to seal on is too uncertain to bind to");
    }

    #[test]
    fn the_crank_numbers_ship_inert() {
        assert_eq!(CRANK_LEVY_LAMPORTS, 0, "no levy is taken until it is decided");
        assert_eq!(CRANK_BOUNTY_LAMPORTS, 0, "and no bounty is paid");
    }

    #[test]
    fn a_bounty_at_or_below_the_transaction_fee_pays_nobody() {
        // The signature fee is 5,000 lamports. A cranker who spends 5,000 to
        // earn 5,000 has done unpaid work with extra steps, so if this number
        // is ever raised it must clear the fee. Zero is exempt: zero is off.
        const SIGNATURE_FEE: u64 = 5_000;
        assert!(
            CRANK_BOUNTY_LAMPORTS == 0 || CRANK_BOUNTY_LAMPORTS > SIGNATURE_FEE,
            "a bounty must beat the fee it costs to collect, or it is charity with extra steps"
        );
    }

    #[test]
    fn the_levy_must_be_worth_collecting_relative_to_the_bounty() {
        // A levy smaller than a bounty drains the purse faster than seals fill
        // it, which is a slow way to arrive back where we started. It is not
        // wrong -- a purse may be seeded -- but the ratio should be a decision,
        // so this pins that both are currently zero together.
        assert_eq!(
            CRANK_LEVY_LAMPORTS == 0,
            CRANK_BOUNTY_LAMPORTS == 0,
            "levy and bounty must be turned on together, or the purse has one end open"
        );
    }

    #[test]
    fn the_purse_is_not_a_pot() {
        // Size is the whole claim: three counters and a bump. There is no
        // authority field, no owner, no config, and nowhere to record a claim
        // on the balance. The only thing that can leave is a bounty.
        assert_eq!(CrankPurse::SIZE, 1 + 8 + 8 + 8);
    }

    #[test]
    fn the_purse_seed_is_a_constant_not_a_parameter() {
        // One purse, derived from a fixed seed, so no caller can point a
        // payment at an account of their choosing.
        assert_eq!(CRANK_PURSE_SEED, b"crank_purse");
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
        out.push_str(&format!(
            "\"ruleset\":{},\"bandKBps\":{},\"clockCapacity\":{},\"horizonMask\":{:?},\"voidReasons\":{{\"none\":{},\"equality\":{},\"deadline\":{},\"tooClose\":{}}},\n",
            RULESET_V2, BAND_K_BPS, CLOCK_CAPACITY, HORIZON_MASK,
            VoidReason::None as u8, VoidReason::Equality as u8, VoidReason::Deadline as u8, VoidReason::TooClose as u8
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
            ("bind_crossing", instruction::BindCrossing {}.data()),
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
        let shot = Shot { player: wallet, delegate: Pubkey::new_from_array([9u8; 32]), nonce: 42, commit: [7u8; 32], feed_id: FEEDS[3], feed_index: 3, minutes: 30, stake: 2_500, xp_base: 70, xp_awarded: 81, sealed_ts: 1_800_000_000, expiry_ts: 1_800_001_800, settled_ts: 1_800_001_805, entry_e12: 123_456_789_012_345, exit_e12: 123_456_789_999_999, exit_publish_time: 1_800_001_803, exit_conf_e12: 61_728_394, exit_prev_publish_time: 1_800_001_700, exit_posted_slot: 300_000_250, ruleset: RULESET_V2, band_k_bps: BAND_K_BPS, crossing_bound: 1, p_bps: 6500, side: 1, hit: 1, state: 3, void_reason: 0, entry_publish_time: 0, entry_prev_publish_time: 0, entry_bound: 1 };
        let ledger = PlayerLedger { player: wallet, credits: 9_350, xp: 24, streak: 0, best: 1, hits: 1, shots: 2, voids: 1, forfeits: 0, sealed: 3, open: 1, day: 20_833, daily_xp: 24, burned: 700_000, reloaded: 1_000_000, bump: 254 };
        let podium = Podium { day: 20_833, seats: [Seat { player: wallet, daily_xp: 24 }, Seat { player: Pubkey::new_from_array([9u8; 32]), daily_xp: 7 }, Seat::default()] };
        let clock = FeedClock { feed_id: FEEDS[3], latest_publish_time: 1_800_001_803, head: 2, bump: 253, observations: vec![
            Observation { prev_publish_time: 1_800_001_700, publish_time: 1_800_001_700, price_e12: 123_456_789_012_345, conf_e12: 55_000_000, posted_slot: 300_000_000 },
            Observation { prev_publish_time: 1_800_001_700, publish_time: 1_800_001_803, price_e12: 123_456_789_999_999, conf_e12: 61_728_394, posted_slot: 300_000_250 },
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
