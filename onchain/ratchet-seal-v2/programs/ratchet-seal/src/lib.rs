//! RATCHET Seal v2.
//!
//! A shot is a non-custodial on-chain receipt. The program never holds the
//! player's game credits or RCX. It binds a hidden YES/NO choice to the exact
//! wallet and game shot, records the Pyth entry price, accepts only the first
//! fully verified sponsored-push checkpoint crossing expiry, and makes
//! equality a void.
//! Sponsored Pyth push updates are checkpointed into a compact program-owned
//! ring buffer, so settlement needs no Hermes API key or trusted data signer.

use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;
use pyth_solana_receiver_sdk::{
    price_update::{get_feed_id_from_hex, PriceUpdateV2, VerificationLevel},
    ID_CONST as PYTH_RECEIVER_ID, PYTH_PUSH_ORACLE_ID,
};

declare_id!("23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX");

const SETTLE_DEADLINE_SECS: i64 = 900;
const MAX_STALENESS_AT_SEAL: u64 = 60;
const MAX_EXPIRY_HORIZON_SECS: i64 = 90_000; // live game max 24h + 1h tolerance
const MAX_CONF_BPS: u128 = 200;
const MAX_SHOT_ID_BYTES: usize = 32;
const SALT_HEX_BYTES: usize = 32;
const CLOCK_CAPACITY: usize = 64;

#[program]
pub mod ratchet_seal {
    use super::*;

    /// `kind`: 0 direction, 1 threshold-up, 2 threshold-down.
    pub fn seal(
        ctx: Context<Seal>,
        nonce: u64,
        commit: [u8; 32],
        shot_id: String,
        feed_id_hex: String,
        expiry_ts: i64,
        kind: u8,
        threshold_e12: i64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;
        require!(expiry_ts > now, RatchetError::ExpiryInPast);
        let latest_expiry = now
            .checked_add(MAX_EXPIRY_HORIZON_SECS)
            .ok_or(RatchetError::MathOverflow)?;
        require!(expiry_ts <= latest_expiry, RatchetError::ExpiryTooFar);
        validate_terms(kind, threshold_e12)?;
        let (shot_id_bytes, shot_id_len) = validate_shot_id(&shot_id)?;

        let feed_id = get_feed_id_from_hex(&feed_id_hex)
            .map_err(|_| error!(RatchetError::BadFeed))?;
        let pu = load_push_price_update(&ctx.accounts.price_update, &feed_id)?;
        let price = pu
            .get_price_no_older_than(&clock, MAX_STALENESS_AT_SEAL, &feed_id)
            .map_err(|_| error!(RatchetError::InvalidSealPrice))?;
        check_confidence(price.price, price.conf)?;
        let entry_e12 = scale_to_e12(price.price, price.exponent)?;

        let shot = &mut ctx.accounts.shot;
        shot.player = ctx.accounts.player.key();
        shot.nonce = nonce;
        shot.commit = commit;
        shot.shot_id = shot_id_bytes;
        shot.shot_id_len = shot_id_len;
        shot.feed_id = feed_id;
        shot.sealed_ts = now;
        shot.expiry_ts = expiry_ts;
        shot.settled_ts = 0;
        shot.entry_e12 = entry_e12;
        shot.exit_e12 = 0;
        shot.threshold_e12 = threshold_e12;
        shot.kind = kind;
        shot.side = 0;
        shot.hit = 0;
        shot.state = ShotState::Sealed as u8;
        shot.strict = 0;
        shot.void_reason = VoidReason::None as u8;

        emit!(Sealed {
            shot: shot.key(),
            player: shot.player,
            shot_id,
            feed_id,
            expiry_ts,
            entry_e12,
        });
        Ok(())
    }

    /// Permissionless capture of a fully verified sponsored Pyth push update.
    /// Duplicate or older observations are harmless no-ops.
    pub fn checkpoint(ctx: Context<Checkpoint>, feed_id: [u8; 32]) -> Result<()> {
        let pu = load_push_price_update(&ctx.accounts.price_update, &feed_id)?;
        let msg = &pu.price_message;
        require!(msg.feed_id == feed_id, RatchetError::BadFeed);
        require!(msg.prev_publish_time < msg.publish_time, RatchetError::NotFirstUpdate);
        check_confidence(msg.price, msg.conf)?;
        let price_e12 = scale_to_e12(msg.price, msg.exponent)?;

        let feed_clock = &mut ctx.accounts.feed_clock;
        if feed_clock.feed_id == [0; 32] {
            feed_clock.feed_id = feed_id;
            feed_clock.bump = ctx.bumps.feed_clock;
        }
        require!(feed_clock.feed_id == feed_id, RatchetError::BadFeed);

        if msg.publish_time <= feed_clock.latest_publish_time {
            return Ok(());
        }

        // Sponsored push accounts are mutable snapshots and may skip source
        // ticks between checkpoints. The Ratchet clock therefore links each
        // verified snapshot to the previous snapshot it actually recorded.
        // On the first checkpoint there is deliberately no historical
        // crossing: a shot must begin after the clock has been initialized.
        let previous_checkpoint_publish_time = feed_clock.latest_publish_time;
        let observation = Observation {
            prev_publish_time: if previous_checkpoint_publish_time == 0 {
                msg.publish_time
            } else {
                previous_checkpoint_publish_time
            },
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
            feed_clock: feed_clock.key(),
            feed_id,
            prev_publish_time: msg.prev_publish_time,
            publish_time: msg.publish_time,
            price_e12,
            posted_slot: pu.posted_slot,
            cranker: ctx.accounts.cranker.key(),
        });
        Ok(())
    }

    /// Permissionless deterministic settlement. Only the unique fully verified
    /// Pyth update satisfying `prev_publish_time < expiry <= publish_time` is
    /// admissible, and only before the liveness deadline.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let shot = &mut ctx.accounts.shot;
        require!(shot.state == ShotState::Sealed as u8, RatchetError::WrongState);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= shot.expiry_ts, RatchetError::NotExpired);
        let deadline = shot
            .expiry_ts
            .checked_add(SETTLE_DEADLINE_SECS)
            .ok_or(RatchetError::MathOverflow)?;
        require!(now < deadline, RatchetError::SettlementDeadlinePassed);

        let feed_clock = &ctx.accounts.feed_clock;
        require!(feed_clock.feed_id == shot.feed_id, RatchetError::BadFeed);
        let observation = feed_clock
            .crossing(shot.expiry_ts)
            .ok_or(RatchetError::CrossingNotCheckpointed)?;
        require!(
            observation.publish_time <= deadline,
            RatchetError::PriceOutsideWindow
        );
        let exit_e12 = observation.price_e12;

        shot.exit_e12 = exit_e12;
        shot.settled_ts = now;
        shot.strict = 1;

        if is_equality(shot, exit_e12)? {
            shot.state = ShotState::Voided as u8;
            shot.void_reason = VoidReason::Equality as u8;
            emit!(Voided {
                shot: shot.key(),
                player: shot.player,
                reason: shot.void_reason,
                exit_e12,
            });
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

    /// Reveal the choice and salt. The v2 preimage is exactly:
    /// `RATCHET|v2|<wallet>|<shot_id>|<YES-or-NO>|<32-lower-hex-salt>`.
    pub fn reveal(ctx: Context<Reveal>, side: u8, salt: String) -> Result<()> {
        let shot = &mut ctx.accounts.shot;
        require!(shot.state == ShotState::Settled as u8, RatchetError::WrongState);
        require!(side <= 1, RatchetError::BadSide);
        validate_salt(&salt)?;

        let shot_id = shot_id_str(shot)?;
        let player = shot.player.to_string();
        let side_bytes: &[u8] = if side == 1 { b"YES" } else { b"NO" };
        let commitment = hashv(&[
            b"RATCHET|v2|",
            player.as_bytes(),
            b"|",
            shot_id.as_bytes(),
            b"|",
            side_bytes,
            b"|",
            salt.as_bytes(),
        ]);
        require!(commitment.to_bytes() == shot.commit, RatchetError::CommitMismatch);

        let outcome_yes = match shot.kind {
            0 => shot.exit_e12 > shot.entry_e12,
            1 => shot.exit_e12 > shot.threshold_e12,
            2 => shot.exit_e12 < shot.threshold_e12,
            _ => return err!(RatchetError::BadKind),
        };
        let hit = u8::from((side == 1) == outcome_yes);
        shot.side = side;
        shot.hit = hit;
        shot.state = ShotState::Revealed as u8;

        let record = &mut ctx.accounts.record;
        record.player = shot.player;
        record.shots = record.shots.saturating_add(1);
        if hit == 1 {
            record.hits = record.hits.saturating_add(1);
        }
        emit!(Revealed {
            shot: shot.key(),
            player: shot.player,
            side,
            hit,
        });
        Ok(())
    }

    /// After the strict window closes, an unresolved sealed shot can only void.
    pub fn void_shot(ctx: Context<VoidShot>) -> Result<()> {
        let shot = &mut ctx.accounts.shot;
        require!(shot.state == ShotState::Sealed as u8, RatchetError::WrongState);
        let deadline = shot
            .expiry_ts
            .checked_add(SETTLE_DEADLINE_SECS)
            .ok_or(RatchetError::MathOverflow)?;
        require!(Clock::get()?.unix_timestamp >= deadline, RatchetError::NotVoidable);
        shot.state = ShotState::Voided as u8;
        shot.void_reason = VoidReason::Deadline as u8;
        emit!(Voided {
            shot: shot.key(),
            player: shot.player,
            reason: shot.void_reason,
            exit_e12: shot.exit_e12,
        });
        Ok(())
    }

    /// Anyone may clean up, but rent always returns to the recorded player.
    pub fn close_shot(_ctx: Context<CloseShot>) -> Result<()> {
        Ok(())
    }
}

fn validate_terms(kind: u8, threshold_e12: i64) -> Result<()> {
    match kind {
        0 => require!(threshold_e12 == 0, RatchetError::BadThreshold),
        1 | 2 => require!(threshold_e12 > 0, RatchetError::BadThreshold),
        _ => return err!(RatchetError::BadKind),
    }
    Ok(())
}

fn validate_shot_id(input: &str) -> Result<([u8; MAX_SHOT_ID_BYTES], u8)> {
    let bytes = input.as_bytes();
    require!(!bytes.is_empty() && bytes.len() <= MAX_SHOT_ID_BYTES, RatchetError::BadShotId);
    require!(
        bytes.iter().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()),
        RatchetError::BadShotId
    );
    let mut out = [0u8; MAX_SHOT_ID_BYTES];
    out[..bytes.len()].copy_from_slice(bytes);
    Ok((out, bytes.len() as u8))
}

fn validate_salt(salt: &str) -> Result<()> {
    let bytes = salt.as_bytes();
    require!(bytes.len() == SALT_HEX_BYTES, RatchetError::BadSalt);
    require!(
        bytes.iter().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b)),
        RatchetError::BadSalt
    );
    Ok(())
}

fn shot_id_str(shot: &Shot) -> Result<&str> {
    let len = shot.shot_id_len as usize;
    require!(len > 0 && len <= MAX_SHOT_ID_BYTES, RatchetError::BadShotId);
    core::str::from_utf8(&shot.shot_id[..len]).map_err(|_| error!(RatchetError::BadShotId))
}

fn is_equality(shot: &Shot, exit_e12: i64) -> Result<bool> {
    match shot.kind {
        0 => Ok(exit_e12 == shot.entry_e12),
        1 | 2 => Ok(exit_e12 == shot.threshold_e12),
        _ => err!(RatchetError::BadKind),
    }
}

fn scale_to_e12(price: i64, exponent: i32) -> Result<i64> {
    let shift = 12i32.checked_add(exponent).ok_or(RatchetError::MathOverflow)?;
    let scaled = if shift >= 0 {
        let factor = 10i64
            .checked_pow(shift as u32)
            .ok_or(RatchetError::MathOverflow)?;
        price.checked_mul(factor)
    } else {
        let divisor = 10i64
            .checked_pow((-shift) as u32)
            .ok_or(RatchetError::MathOverflow)?;
        price.checked_div(divisor)
    };
    scaled.ok_or(error!(RatchetError::MathOverflow))
}

fn check_confidence(price: i64, conf: u64) -> Result<()> {
    require!(price > 0, RatchetError::BadPrice);
    require!(
        (conf as u128).saturating_mul(10_000)
            <= (price as u128).saturating_mul(MAX_CONF_BPS),
        RatchetError::TooUncertain
    );
    Ok(())
}

/// Deserialize only the official upgraded shard-0 sponsored Pyth push feed.
fn load_push_price_update(ai: &AccountInfo, feed_id: &[u8; 32]) -> Result<PriceUpdateV2> {
    require!(*ai.owner == PYTH_RECEIVER_ID, RatchetError::BadPriceAccount);
    let shard_id = 0u16.to_le_bytes();
    let (expected_feed, _) = Pubkey::find_program_address(
        &[shard_id.as_ref(), feed_id.as_ref()],
        &PYTH_PUSH_ORACLE_ID,
    );
    require!(ai.key() == expected_feed, RatchetError::BadPriceAccount);

    let data = ai.try_borrow_data()?;
    let mut slice: &[u8] = &data;
    let update = PriceUpdateV2::try_deserialize(&mut slice)
        .map_err(|_| error!(RatchetError::BadPriceAccount))?;
    require!(
        update.write_authority == expected_feed,
        RatchetError::BadPriceAccount
    );
    require!(
        update.verification_level.gte(VerificationLevel::Full),
        RatchetError::PartialVerification
    );
    Ok(update)
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
    #[account(mut)]
    pub player: Signer<'info>,
    /// CHECK: owner, discriminator and full verification are checked by load_push_price_update.
    pub price_update: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(feed_id: [u8; 32])]
pub struct Checkpoint<'info> {
    #[account(
        init_if_needed,
        payer = cranker,
        space = 8 + FeedClock::SIZE,
        seeds = [b"clock", feed_id.as_ref()],
        bump
    )]
    pub feed_clock: Account<'info, FeedClock>,
    #[account(mut)]
    pub cranker: Signer<'info>,
    /// CHECK: owner, discriminator and full verification are checked by load_push_price_update.
    pub price_update: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub shot: Account<'info, Shot>,
    #[account(seeds = [b"clock", shot.feed_id.as_ref()], bump = feed_clock.bump)]
    pub feed_clock: Account<'info, FeedClock>,
    pub cranker: Signer<'info>,
}

#[derive(Accounts)]
pub struct Reveal<'info> {
    #[account(mut)]
    pub shot: Account<'info, Shot>,
    #[account(
        init_if_needed,
        payer = revealer,
        space = 8 + PlayerRecord::SIZE,
        seeds = [b"record", shot.player.as_ref()],
        bump
    )]
    pub record: Account<'info, PlayerRecord>,
    #[account(mut)]
    pub revealer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VoidShot<'info> {
    #[account(mut)]
    pub shot: Account<'info, Shot>,
    pub cranker: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseShot<'info> {
    #[account(
        mut,
        close = player,
        has_one = player,
        constraint = shot.state == ShotState::Revealed as u8
            || shot.state == ShotState::Voided as u8 @ RatchetError::WrongState
    )]
    pub shot: Account<'info, Shot>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub cranker: Signer<'info>,
}

#[account]
pub struct Shot {
    pub player: Pubkey,
    pub nonce: u64,
    pub commit: [u8; 32],
    pub shot_id: [u8; MAX_SHOT_ID_BYTES],
    pub shot_id_len: u8,
    pub feed_id: [u8; 32],
    pub sealed_ts: i64,
    pub expiry_ts: i64,
    pub settled_ts: i64,
    pub entry_e12: i64,
    pub exit_e12: i64,
    pub threshold_e12: i64,
    pub kind: u8,
    pub side: u8,
    pub hit: u8,
    pub state: u8,
    pub strict: u8,
    pub void_reason: u8,
}

impl Shot {
    pub const SIZE: usize = 32 + 8 + 32 + 32 + 1 + 32 + (8 * 6) + 6;
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
            .filter(|observation| {
                observation.prev_publish_time < expiry_ts
                    && observation.publish_time >= expiry_ts
            })
            .min_by_key(|observation| observation.publish_time)
    }
}

#[account]
pub struct PlayerRecord {
    pub player: Pubkey,
    pub shots: u64,
    pub hits: u64,
}

impl PlayerRecord {
    pub const SIZE: usize = 32 + 8 + 8;
}

#[repr(u8)]
pub enum ShotState {
    Sealed = 1,
    Settled = 2,
    Revealed = 3,
    Voided = 4,
}

#[repr(u8)]
pub enum VoidReason {
    None = 0,
    Equality = 1,
    Deadline = 2,
}

#[event]
pub struct Sealed {
    pub shot: Pubkey,
    pub player: Pubkey,
    pub shot_id: String,
    pub feed_id: [u8; 32],
    pub expiry_ts: i64,
    pub entry_e12: i64,
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
pub struct Checkpointed {
    pub feed_clock: Pubkey,
    pub feed_id: [u8; 32],
    pub prev_publish_time: i64,
    pub publish_time: i64,
    pub price_e12: i64,
    pub posted_slot: u64,
    pub cranker: Pubkey,
}

#[event]
pub struct Revealed {
    pub shot: Pubkey,
    pub player: Pubkey,
    pub side: u8,
    pub hit: u8,
}

#[event]
pub struct Voided {
    pub shot: Pubkey,
    pub player: Pubkey,
    pub reason: u8,
    pub exit_e12: i64,
}

#[error_code]
pub enum RatchetError {
    #[msg("expiry must be in the future")]
    ExpiryInPast,
    #[msg("expiry exceeds the supported game horizon")]
    ExpiryTooFar,
    #[msg("unknown shot kind")]
    BadKind,
    #[msg("threshold is not canonical for this shot kind")]
    BadThreshold,
    #[msg("shot id must be 1-32 lowercase ASCII letters or digits")]
    BadShotId,
    #[msg("salt must be exactly 32 lowercase hexadecimal characters")]
    BadSalt,
    #[msg("bad side")]
    BadSide,
    #[msg("bad or unknown price feed")]
    BadFeed,
    #[msg("not an upgraded Pyth price update account")]
    BadPriceAccount,
    #[msg("price update is not fully verified")]
    PartialVerification,
    #[msg("seal price is stale, mismatched or otherwise invalid")]
    InvalidSealPrice,
    #[msg("shot is not in the required state")]
    WrongState,
    #[msg("window has not expired yet")]
    NotExpired,
    #[msg("price update is outside the strict settle window")]
    PriceOutsideWindow,
    #[msg("reveal does not match the wallet-bound shot commitment")]
    CommitMismatch,
    #[msg("not the first price update crossing expiry")]
    NotFirstUpdate,
    #[msg("the exact first Pyth update crossing expiry has not been checkpointed")]
    CrossingNotCheckpointed,
    #[msg("strict settlement deadline has passed")]
    SettlementDeadlinePassed,
    #[msg("shot is not voidable yet")]
    NotVoidable,
    #[msg("oracle price must be positive")]
    BadPrice,
    #[msg("oracle confidence band is too wide")]
    TooUncertain,
    #[msg("math overflow")]
    MathOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn e12_preserves_small_and_large_feed_precision() {
        assert_eq!(scale_to_e12(33_151, -10).unwrap(), 3_315_100);
        assert_eq!(
            scale_to_e12(9_596_922_313, -8).unwrap(),
            95_969_223_130_000
        );
    }

    #[test]
    fn confidence_limit_is_exactly_two_percent() {
        assert!(check_confidence(1_000_000, 20_000).is_ok());
        assert!(check_confidence(1_000_000, 20_001).is_err());
        assert!(check_confidence(0, 0).is_err());
    }

    #[test]
    fn shot_terms_and_preimage_parts_are_canonical() {
        assert!(validate_terms(0, 0).is_ok());
        assert!(validate_terms(0, 1).is_err());
        assert!(validate_terms(1, 1).is_ok());
        assert!(validate_terms(2, 1).is_ok());
        assert!(validate_terms(3, 1).is_err());
        assert!(validate_shot_id("abc123").is_ok());
        assert!(validate_shot_id("ABC").is_err());
        assert!(validate_salt("0123456789abcdef0123456789abcdef").is_ok());
        assert!(validate_salt("0123456789ABCDEF0123456789ABCDEF").is_err());
    }

    #[test]
    fn upgraded_sol_feed_is_the_expected_sponsored_pda() {
        let feed_id = get_feed_id_from_hex(
            "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
        )
        .unwrap();
        let shard_id = 0u16.to_le_bytes();
        let (address, _) = Pubkey::find_program_address(
            &[shard_id.as_ref(), feed_id.as_ref()],
            &PYTH_PUSH_ORACLE_ID,
        );
        assert_eq!(
            address,
            pubkey!("7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE")
        );
        assert_eq!(PYTH_RECEIVER_ID, pubkey!("rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp"));
    }

    #[test]
    fn clock_selects_the_unique_first_crossing() {
        let mut feed_clock = FeedClock {
            feed_id: [7; 32],
            latest_publish_time: 120,
            head: 3,
            bump: 255,
            observations: vec![
                Observation {
                    prev_publish_time: 90,
                    publish_time: 100,
                    price_e12: 1,
                    posted_slot: 1,
                },
                Observation {
                    prev_publish_time: 100,
                    publish_time: 110,
                    price_e12: 2,
                    posted_slot: 2,
                },
                Observation {
                    prev_publish_time: 110,
                    publish_time: 120,
                    price_e12: 3,
                    posted_slot: 3,
                },
            ],
        };

        assert_eq!(feed_clock.crossing(105).unwrap().publish_time, 110);
        assert_eq!(feed_clock.crossing(110).unwrap().publish_time, 110);
        assert!(feed_clock.crossing(90).is_none());
        assert!(feed_clock.crossing(121).is_none());
    }

    #[test]
    fn first_checkpoint_cannot_invent_a_historical_crossing() {
        let feed_clock = FeedClock {
            feed_id: [8; 32],
            latest_publish_time: 100,
            head: 1,
            bump: 254,
            observations: vec![Observation {
                prev_publish_time: 100,
                publish_time: 100,
                price_e12: 1,
                posted_slot: 1,
            }],
        };

        assert!(feed_clock.crossing(99).is_none());
        assert!(feed_clock.crossing(100).is_none());
    }
}
