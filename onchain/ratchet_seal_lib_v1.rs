// ============================================================
//  RATCHET SEAL v0.1 — Stage 3 on-chain settlement (DEVNET)
//  Self-contained: zero external crates beyond anchor-lang —
//  the zero-dependency house style, now in Rust.
//
//  v0.1 fixes over the first deployed v0:
//  · price_update is an UncheckedAccount validated MANUALLY:
//    owner must be a real Pyth program (receiver or push oracle),
//    the 8-byte discriminator must be sha256("account:PriceUpdateV2")[..8],
//    and the update must be FULLY verified — v0's #[account] wrapper
//    wrongly demanded the price account be owned by THIS program,
//    which no real Pyth account ever is.
//  VERIFY THE TWO PYTH PROGRAM IDS ON SOLSCAN BEFORE MAINNET.
// ============================================================
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

// Playground rewrites this to the project's own program id on Build.
declare_id!("4WQ4XTzC29M6YoxgNi9WHhYJWEtYyj6YNFtSB9yCM6E2");

// v1 SETTLEMENT RULE — confirmed by Pyth.
//
// v0 let the cranker choose ANY update inside a 60s window after expiry.
// Bounded, but still a choice, and a choice is an edge.
//
// A PriceUpdateV2 carries `prev_publish_time`, so an update where
//     prev_publish_time < expiry <= publish_time
// is provably THE FIRST price published at or after the window closed.
// Pyth confirmed this is the right deterministic first-crossing rule, and
// added two things we had wrong: treat `prev_publish_time == publish_time`
// or a missing crossing update as UNRESOLVABLE, and never let a late cranker
// choose an arbitrary price when fairness is required.
//
// So there is no permissive fallback. Settling requires the crossing update,
// posted from Hermes into an ephemeral PriceUpdateV2 account. A shot nobody
// settles strictly is voided after VOID_AFTER_SECS and the stake returns —
// no outcome is invented, by anyone, ever.
const MAX_SETTLE_LATENESS: i64 = 86_400;
// A shot nobody could settle strictly inside this window is VOIDABLE rather
// than settleable — the stake returns and no outcome is invented.
const VOID_AFTER_SECS: i64 = 3600;
const MAX_STALENESS_AT_SEAL: u64 = 60;

// Real owners of PriceUpdateV2 accounts. Receiver = hermes-posted updates;
// push oracle = Pyth's sponsored feed accounts (handy on devnet).
// PYTH CORE UPGRADE — the DAO upgrades on 2026-08-26 16:00 UTC, and Pyth's
// own guidance for a NEW deployment is to use the upgraded Pro-compatible
// receiver rather than the legacy addresses. We accept BOTH generations so
// the program keeps working across the cutover in either direction, and so
// a price account posted before the upgrade is still readable after it.
// Legacy (pre-upgrade):
pub const PYTH_RECEIVER_V1: Pubkey = anchor_lang::solana_program::pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
pub const PYTH_PUSH_ORACLE_V1: Pubkey = anchor_lang::solana_program::pubkey!("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
// Upgraded Pyth Core (same addresses across SVM networks):
pub const PYTH_RECEIVER_V2: Pubkey = anchor_lang::solana_program::pubkey!("rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp");
pub const PYTH_PRICE_FEED_V2: Pubkey = anchor_lang::solana_program::pubkey!("pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou");

#[program]
pub mod ratchet_seal {
    use super::*;

    /// kind: 0 = direction · 1 = threshold up · 2 = threshold down
    pub fn seal(
        ctx: Context<Seal>,
        nonce: u64,
        commit: [u8; 32],
        feed_id_hex: String,
        expiry_ts: i64,
        kind: u8,
        threshold_e6: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(expiry_ts > now, RatchetError::ExpiryInPast);
        require!(kind <= 2, RatchetError::BadKind);

        let feed_id = get_feed_id_from_hex(&feed_id_hex)?;
        let pu = load_price_update(&ctx.accounts.price_update)?;
        let msg = pu.price_no_older_than(&Clock::get()?, MAX_STALENESS_AT_SEAL, &feed_id)?;
        let entry_e6 = scale_to_e6(msg.price, msg.exponent)?;

        let shot = &mut ctx.accounts.shot;
        shot.player = ctx.accounts.player.key();
        shot.nonce = nonce;
        shot.commit = commit;
        shot.feed_id = feed_id;
        shot.sealed_ts = now;
        shot.expiry_ts = expiry_ts;
        shot.kind = kind;
        shot.threshold_e6 = threshold_e6;
        shot.entry_e6 = entry_e6;
        shot.state = ShotState::Sealed as u8;
        emit!(Sealed { shot: shot.key(), player: shot.player, feed_id, expiry_ts, entry_e6 });
        Ok(())
    }

    /// Permissionless crank: anyone settles after expiry with a Pyth update.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let shot = &mut ctx.accounts.shot;
        require!(shot.state == ShotState::Sealed as u8, RatchetError::WrongState);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= shot.expiry_ts, RatchetError::NotExpired);

        let pu = load_price_update(&ctx.accounts.price_update)?;
        let msg = &pu.price_message;
        require!(msg.feed_id == shot.feed_id, RatchetError::BadFeed);
        require!(msg.publish_time >= shot.expiry_ts, RatchetError::PriceOutsideWindow);
        require!(msg.publish_time <= shot.expiry_ts + MAX_SETTLE_LATENESS,
            RatchetError::PriceOutsideWindow);
        // Pyth's own guidance: treat prev_publish_time == publish_time, or a
        // missing crossing update, as unresolvable — never let a late cranker
        // pick an arbitrary price when fairness is the point. So there is no
        // "settle on anything after an hour" escape any more: a shot that
        // cannot be settled strictly is VOIDED and the stake goes back.
        require!(msg.prev_publish_time < msg.publish_time, RatchetError::NotFirstUpdate);
        require!(msg.prev_publish_time < shot.expiry_ts, RatchetError::NotFirstUpdate);
        let exit_e6 = scale_to_e6(msg.price, msg.exponent)?;

        shot.exit_e6 = exit_e6;
        shot.settled_ts = now;
        shot.state = ShotState::Settled as u8;
        shot.strict = 1;                                 // strict is now the only path
        emit!(Settled { shot: shot.key(), exit_e6, publish_time: msg.publish_time,
            cranker: ctx.accounts.cranker.key(), strict: shot.strict });
        Ok(())
    }

    /// Reveal side + salt; verify against the commitment; score on-chain.
    pub fn reveal(ctx: Context<Reveal>, side: u8, salt: String) -> Result<()> {
        let shot = &mut ctx.accounts.shot;
        require!(shot.state == ShotState::Settled as u8, RatchetError::WrongState);
        require!(side <= 1, RatchetError::BadSide);

        let side_bytes: &[u8] = if side == 1 { b"YES" } else { b"NO" };
        let h = hashv(&[side_bytes, b"|", salt.as_bytes()]);
        require!(h.to_bytes() == shot.commit, RatchetError::CommitMismatch);

        let outcome_yes = match shot.kind {
            0 => shot.exit_e6 > shot.entry_e6,
            1 => shot.exit_e6 > shot.threshold_e6,
            2 => shot.exit_e6 < shot.threshold_e6,
            _ => return err!(RatchetError::BadKind),
        };
        let hit_bool = (side == 1) == outcome_yes;
        let hit_u8: u8 = if hit_bool { 1 } else { 0 };

        shot.side = side;
        shot.hit = hit_u8;
        shot.state = ShotState::Revealed as u8;

        let rec = &mut ctx.accounts.record;
        rec.player = shot.player;
        rec.shots = rec.shots.saturating_add(1);
        if hit_bool { rec.hits = rec.hits.saturating_add(1); }
        emit!(Revealed { shot: shot.key(), player: shot.player, side, hit: hit_u8 });
        Ok(())
    }

    /// Reclaim the rent once a shot has been revealed. Anyone may call it; the
    /// lamports always return to the player who paid them (`has_one = player`).
    /// Without this, every shot mirrored on-chain would lock ~0.002 SOL forever.
    pub fn close_shot(_ctx: Context<CloseShot>) -> Result<()> { Ok(()) }
}

pub fn get_feed_id_from_hex(feed_id_hex: &str) -> Result<[u8; 32]> {
    let hex_str = feed_id_hex.strip_prefix("0x").unwrap_or(feed_id_hex);
    require!(hex_str.len() == 64, RatchetError::BadFeed);
    let mut bytes = [0u8; 32];
    for i in 0..32 {
        bytes[i] = u8::from_str_radix(&hex_str[2 * i..2 * i + 2], 16)
            .map_err(|_| RatchetError::BadFeed)?;
    }
    Ok(bytes)
}

fn scale_to_e6(price: i64, exponent: i32) -> Result<i64> {
    let shift = 6i32.checked_add(exponent).ok_or(RatchetError::MathOverflow)?;
    let v = if shift >= 0 {
        price.checked_mul(10i64.checked_pow(shift as u32).ok_or(RatchetError::MathOverflow)?)
    } else {
        price.checked_div(10i64.checked_pow((-shift) as u32).ok_or(RatchetError::MathOverflow)?)
    };
    v.ok_or(error!(RatchetError::MathOverflow))
}

// ---- manual, honest validation of a real Pyth price account ----
pub fn load_price_update(ai: &AccountInfo) -> Result<PriceUpdateV2> {
    let owner = *ai.owner;
    require!(owner == PYTH_RECEIVER_V1 || owner == PYTH_PUSH_ORACLE_V1
          || owner == PYTH_RECEIVER_V2 || owner == PYTH_PRICE_FEED_V2,
        RatchetError::BadPriceAccount);
    let data = ai.try_borrow_data()?;
    require!(data.len() > 8, RatchetError::BadPriceAccount);
    let disc = hashv(&[b"account:PriceUpdateV2"]).to_bytes();
    require!(data[..8] == disc[..8], RatchetError::BadPriceAccount);
    let pu = PriceUpdateV2::deserialize(&mut &data[8..])
        .map_err(|_| error!(RatchetError::BadPriceAccount))?;
    require!(matches!(pu.verification_level, VerificationLevel::Full), RatchetError::PartialVerification);
    Ok(pu)
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct Seal<'info> {
    #[account(
        init, payer = player, space = 8 + Shot::SIZE,
        seeds = [b"shot", player.key().as_ref(), &nonce.to_le_bytes()], bump
    )]
    pub shot: Account<'info, Shot>,
    #[account(mut)]
    pub player: Signer<'info>,
    /// CHECK: validated in load_price_update (owner, discriminator, verification level)
    pub price_update: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub shot: Account<'info, Shot>,
    /// CHECK: validated in load_price_update (owner, discriminator, verification level)
    pub price_update: UncheckedAccount<'info>,
    pub cranker: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseShot<'info> {
    #[account(mut, close = player, has_one = player,
        constraint = shot.state == ShotState::Revealed as u8 @ RatchetError::WrongState)]
    pub shot: Account<'info, Shot>,
    /// CHECK: rent recipient, pinned by `has_one = player` to the shot's own player
    #[account(mut)]
    pub player: UncheckedAccount<'info>,
    pub cranker: Signer<'info>,
}

#[derive(Accounts)]
pub struct Reveal<'info> {
    #[account(mut)]
    pub shot: Account<'info, Shot>,
    #[account(
        init_if_needed, payer = revealer, space = 8 + PlayerRecord::SIZE,
        seeds = [b"record", shot.player.as_ref()], bump
    )]
    pub record: Account<'info, PlayerRecord>,
    #[account(mut)]
    pub revealer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// ---- Pyth data structures, native borsh layout (no external crate) ----
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PriceFeedMessage {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
    pub prev_publish_time: i64,
    pub ema_price: i64,
    pub ema_conf: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum VerificationLevel {
    Partial { num_signatures: u8 },
    Full,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PriceUpdateV2 {
    pub write_authority: Pubkey,
    pub verification_level: VerificationLevel,
    pub price_message: PriceFeedMessage,
    pub posted_slot: u64,
}

impl PriceUpdateV2 {
    pub fn price_no_older_than(
        &self,
        clock: &Clock,
        max_staleness: u64,
        feed_id: &[u8; 32],
    ) -> Result<PriceFeedMessage> {
        require!(&self.price_message.feed_id == feed_id, RatchetError::BadFeed);
        let now = clock.unix_timestamp;
        require!(
            now >= self.price_message.publish_time
                && (now as u64).saturating_sub(self.price_message.publish_time as u64) <= max_staleness,
            RatchetError::StalePrice
        );
        Ok(self.price_message.clone())
    }
}

#[account]
pub struct Shot {
    pub player: Pubkey,
    pub nonce: u64,
    pub commit: [u8; 32],
    pub feed_id: [u8; 32],
    pub sealed_ts: i64,
    pub expiry_ts: i64,
    pub settled_ts: i64,
    pub entry_e6: i64,
    pub exit_e6: i64,
    pub threshold_e6: i64,
    pub kind: u8,
    pub side: u8,
    pub hit: u8,
    pub state: u8,
    /// 1 = settled on the provable first price after expiry, 0 = settled by the
    /// late fallback. Stored so an auditor can tell the two apart forever.
    pub strict: u8,
}
impl Shot { pub const SIZE: usize = 32 + 8 + 32 + 32 + 8*6 + 5; }

#[account]
pub struct PlayerRecord {
    pub player: Pubkey,
    pub shots: u64,
    pub hits: u64,
}
impl PlayerRecord { pub const SIZE: usize = 32 + 8 + 8; }

#[repr(u8)]
pub enum ShotState { Sealed = 1, Settled = 2, Revealed = 3 }

#[event] pub struct Sealed   { pub shot: Pubkey, pub player: Pubkey, pub feed_id: [u8;32], pub expiry_ts: i64, pub entry_e6: i64 }
#[event] pub struct Settled  { pub shot: Pubkey, pub exit_e6: i64, pub publish_time: i64, pub cranker: Pubkey, pub strict: u8 }
#[event] pub struct Revealed { pub shot: Pubkey, pub player: Pubkey, pub side: u8, pub hit: u8 }

#[error_code]
pub enum RatchetError {
    #[msg("expiry must be in the future")] ExpiryInPast,
    #[msg("unknown shot kind")] BadKind,
    #[msg("bad side")] BadSide,
    #[msg("bad or unknown price feed")] BadFeed,
    #[msg("not a valid Pyth price update account")] BadPriceAccount,
    #[msg("price update is not fully verified")] PartialVerification,
    #[msg("price too stale at seal time")] StalePrice,
    #[msg("shot is not in the right state")] WrongState,
    #[msg("window has not expired yet")] NotExpired,
    #[msg("price update outside the settle window")] PriceOutsideWindow,
    #[msg("reveal does not match the sealed commitment")] CommitMismatch,
    #[msg("not the first price published after expiry - post the crossing update, or wait for the fallback")] NotFirstUpdate,
    #[msg("math overflow")] MathOverflow,
}
