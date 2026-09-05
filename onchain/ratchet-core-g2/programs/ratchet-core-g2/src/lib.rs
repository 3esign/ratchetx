//! Ratchet Core G2: a content-addressed, operator-independent game kernel.
//!
//! Solana accounts are the only economic ledger. Core consumes immutable
//! Timepin v2 evidence, never an RPC response or caller-decoded price. There is
//! no administrator, arbitrary credit grant or database fallback. Rich Shots
//! are transient; every terminal path atomically preserves a compact result,
//! rewards cleanup, and returns the remaining rent to its immutable payer.

use anchor_lang::prelude::*;
use anchor_spl::{
    memo::{self, BuildMemo, Memo},
    token_2022,
    token_interface::{self, Burn, Mint, TokenAccount, TokenInterface, TransferChecked},
};
use spl_token_2022_interface::{
    extension::{
        metadata_pointer::MetadataPointer, BaseStateWithExtensions, ExtensionType,
        StateWithExtensions,
    },
    state::{Account as SplTokenAccount, AccountState, Mint as SplMint},
};
use spl_token_metadata_interface::state::TokenMetadata;

pub mod foreign_timepin;
pub mod state;

use foreign_timepin::{
    authenticate_final, authenticate_void_terminal, load_evidence_spec, load_need, load_open_need,
    validate_record_against_spec, EvidenceRecordV2View, EvidenceSpecV2View, NEED_AMBIGUOUS,
    NEED_EXPIRED,
};
use state::*;

declare_id!("cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN");

pub const RCX_MINT: Pubkey = pubkey!("FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump");
pub const RCX_DECIMALS: u8 = 6;
pub const RCX_RAW_UNITS_PER_CREDIT: u64 = 1_000_000;
pub const RCX_MINT_ACCOUNT_LEN: usize = 409;
pub const RCX_METADATA_URI: &str =
    "https://ipfs.io/ipfs/bafkreig5iupjirb2lgufnfehecq4vrnsxr5h54p2jp3o3h64p6wnclg26a";
pub const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey =
    pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const WORK_MANIFEST_SEED: &[u8] = b"work_manifest";
pub const WORK_MANIFEST_SCHEMA_VERSION: u16 = 1;
pub const WORK_MANIFEST_SCHEMA_SEED: [u8; 2] = WORK_MANIFEST_SCHEMA_VERSION.to_le_bytes();

/// Immutable, producer-owned ABI descriptor consumed by frozen Work Market v2.
/// It has no authority, edit, or close instruction.
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

#[program]
pub mod ratchet_core_g2 {
    use super::*;

    pub fn register_economy(
        ctx: Context<RegisterEconomy>,
        expected_hash: [u8; 32],
        args: EconomyArgs,
    ) -> Result<()> {
        validate_economy(&args)?;
        require!(
            economy_hash(&args)? == expected_hash,
            CoreG2Error::WrongExpectedHash
        );
        require_keys_eq!(
            ctx.accounts.timepin_program.key(),
            args.timepin_program,
            CoreG2Error::WrongTimepinProgram
        );
        require!(
            ctx.accounts.timepin_program.executable,
            CoreG2Error::TimepinProgramNotExecutable
        );
        if args.legacy_root != [0; 32] {
            require!(
                args.legacy_cutover_slot <= Clock::get()?.slot,
                CoreG2Error::FutureLegacyCutover
            );
        }
        let economy = &mut ctx.accounts.economy;
        require_exact_len(&economy.to_account_info(), Economy::LEN)?;
        if economy.schema == 0 {
            economy.set_inner(Economy {
                schema: CORE_SCHEMA_VERSION,
                bump: ctx.bumps.economy,
                economy_hash: expected_hash,
                args,
            });
        } else {
            require!(
                economy.economy_hash == expected_hash,
                CoreG2Error::WrongExpectedHash
            );
            require!(economy.args == args, CoreG2Error::ImmutableAccountMismatch);
        }
        authenticate_economy(economy, economy.key())?;
        Ok(())
    }

    pub fn register_ruleset(
        ctx: Context<RegisterRuleset>,
        expected_hash: [u8; 32],
        args: RulesetArgs,
        policy_proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        require_exact_len(&ctx.accounts.economy.to_account_info(), Economy::LEN)?;
        authenticate_economy(&ctx.accounts.economy, ctx.accounts.economy.key())?;
        validate_ruleset(&args, &ctx.accounts.economy)?;
        require_ruleset_allowed(&args, &ctx.accounts.economy, &policy_proof)?;
        require!(
            ruleset_hash(&args)? == expected_hash,
            CoreG2Error::WrongExpectedHash
        );
        let spec = load_evidence_spec(
            &ctx.accounts.evidence_spec.to_account_info(),
            &ctx.accounts.economy.args.timepin_program,
            &args.evidence_spec_hash,
        )?;
        require_spec_ruleset_match(&spec, &args)?;

        let ruleset = &mut ctx.accounts.ruleset;
        require_exact_len(&ruleset.to_account_info(), Ruleset::LEN)?;
        if ruleset.schema == 0 {
            ruleset.set_inner(Ruleset {
                schema: CORE_SCHEMA_VERSION,
                bump: ctx.bumps.ruleset,
                ruleset_hash: expected_hash,
                args,
            });
        } else {
            require!(
                ruleset.ruleset_hash == expected_hash,
                CoreG2Error::WrongExpectedHash
            );
            require!(ruleset.args == args, CoreG2Error::ImmutableAccountMismatch);
        }
        authenticate_ruleset(ruleset, &ctx.accounts.economy, ruleset.key())?;
        Ok(())
    }

    pub fn open_ledger(ctx: Context<OpenLedger>) -> Result<()> {
        require_exact_len(&ctx.accounts.economy.to_account_info(), Economy::LEN)?;
        authenticate_economy(&ctx.accounts.economy, ctx.accounts.economy.key())?;
        let player = ctx.accounts.player.key();
        initialize_or_authenticate_ledger(
            &mut ctx.accounts.ledger,
            ctx.bumps.ledger,
            ctx.accounts.economy.economy_hash,
            player,
        )?;
        emit!(LedgerOpened {
            economy_hash: ctx.accounts.economy.economy_hash,
            player,
            ledger: ctx.accounts.ledger.key(),
        });
        Ok(())
    }

    /// Open the one canonical, append-only history page that contains the
    /// ledger's next shot nonce. The page stores one byte per live shot and is
    /// enlarged with the immutable result only when that shot terminalizes.
    pub fn open_history_page(ctx: Context<OpenHistoryPage>, page_index: u64) -> Result<()> {
        require_exact_len(&ctx.accounts.economy.to_account_info(), Economy::LEN)?;
        authenticate_economy(&ctx.accounts.economy, ctx.accounts.economy.key())?;
        authenticate_ledger(
            &ctx.accounts.ledger,
            ctx.accounts.economy.economy_hash,
            ctx.accounts.player.key(),
        )?;
        require!(
            page_index == history_page_index(ctx.accounts.ledger.next_shot_nonce),
            CoreG2Error::WrongHistoryPage
        );
        let page = &mut ctx.accounts.history_page;
        if page.schema == 0 {
            page.initialize(
                ctx.bumps.history_page,
                ctx.accounts.economy.economy_hash,
                ctx.accounts.player.key(),
                page_index,
            );
        }
        authenticate_history_account(
            page,
            page.key(),
            &ctx.accounts.economy.economy_hash,
            &ctx.accounts.player.key(),
            page_index,
        )?;
        Ok(())
    }

    /// Open the canonical empty packed reload page containing the ledger's
    /// next reload nonce. Each page is created once at base size; reloads pay
    /// only their record's marginal rent and never create per-reload accounts.
    pub fn open_reload_page(ctx: Context<OpenReloadPage>, page_index: u64) -> Result<()> {
        require_exact_len(&ctx.accounts.economy.to_account_info(), Economy::LEN)?;
        authenticate_economy(&ctx.accounts.economy, ctx.accounts.economy.key())?;
        authenticate_ledger(
            &ctx.accounts.ledger,
            ctx.accounts.economy.economy_hash,
            ctx.accounts.player.key(),
        )?;
        require!(
            page_index == reload_history_page_index(ctx.accounts.ledger.next_reload_nonce),
            CoreG2Error::WrongReloadHistoryPage
        );
        let page = &mut ctx.accounts.reload_history_page;
        page.initialize(
            ctx.bumps.reload_history_page,
            ctx.accounts.economy.economy_hash,
            ctx.accounts.player.key(),
            page_index,
        );
        authenticate_reload_history_account(
            page,
            page.key(),
            &ctx.accounts.economy.economy_hash,
            &ctx.accounts.player.key(),
            page_index,
        )?;
        Ok(())
    }

    /// Open a canonical empty WorkPage before any reservations grow it.
    /// Historical pages remain openable while any of their shots may still
    /// need permissionless Work Market funding; the actor alone pays its rent.
    pub fn open_work_page(ctx: Context<OpenWorkPage>, page_index: u64) -> Result<()> {
        require_exact_len(&ctx.accounts.economy.to_account_info(), Economy::LEN)?;
        authenticate_economy(&ctx.accounts.economy, ctx.accounts.economy.key())?;
        authenticate_ledger(
            &ctx.accounts.ledger,
            ctx.accounts.economy.economy_hash,
            ctx.accounts.player.key(),
        )?;
        let last_nonce = ctx
            .accounts
            .ledger
            .next_shot_nonce
            .checked_sub(1)
            .ok_or(CoreG2Error::WrongWorkPage)?;
        require!(
            page_index <= work_page_index(last_nonce),
            CoreG2Error::WrongWorkPage
        );
        let page = &mut ctx.accounts.work_page;
        if page.schema == 0 {
            page.initialize(
                ctx.bumps.work_page,
                ctx.accounts.economy.economy_hash,
                ctx.accounts.player.key(),
                page_index,
            );
        }
        authenticate_work_account(
            page,
            page.key(),
            &ctx.accounts.economy.economy_hash,
            &ctx.accounts.player.key(),
            page_index,
        )?;
        Ok(())
    }

    /// Permissionlessly publish the one immutable ABI manifest for a supported
    /// work kind. Init-if-needed makes the canonical PDA idempotent and
    /// reclaims a merely dust-funded system address.
    pub fn open_work_manifest(ctx: Context<OpenWorkManifest>, work_kind: u8) -> Result<()> {
        require!(
            matches!(
                work_kind,
                WORK_KIND_ACTIVATE_ENTRY | WORK_KIND_RESOLVE_SHOT | WORK_KIND_FORFEIT
            ),
            CoreG2Error::WrongWorkKind
        );
        require_exact_len(
            &ctx.accounts.work_manifest.to_account_info(),
            WorkManifest::LEN,
        )?;
        let subject_discriminator: [u8; 8] = Shot::DISCRIMINATOR
            .try_into()
            .map_err(|_| error!(CoreG2Error::WrongAccountDiscriminator))?;
        let locator_discriminator: [u8; 8] = WorkPage::DISCRIMINATOR
            .try_into()
            .map_err(|_| error!(CoreG2Error::WrongAccountDiscriminator))?;
        let expected = WorkManifest {
            schema_version: WORK_MANIFEST_SCHEMA_VERSION,
            bump: ctx.bumps.work_manifest,
            work_kind,
            completion_schema_version: COMPLETION_SCHEMA_VERSION,
            locator_mode: WORK_PAGE_MODE,
            subject_schema_version: CORE_SCHEMA_VERSION,
            subject_account_size: u16::try_from(8 + Shot::LEN)
                .map_err(|_| error!(CoreG2Error::MathOverflow))?,
            subject_discriminator,
            locator_schema_version: CORE_SCHEMA_VERSION,
            locator_discriminator,
            records_offset: u16::try_from(state::WORK_PAGE_RECORDS_OFFSET)
                .map_err(|_| error!(CoreG2Error::MathOverflow))?,
            entry_len: u16::try_from(WorkRecord::LEN)
                .map_err(|_| error!(CoreG2Error::MathOverflow))?,
            locator_capacity: WORK_PAGE_CAP as u8,
        };
        let manifest = &mut ctx.accounts.work_manifest;
        if manifest.schema_version == 0 {
            manifest.set_inner(expected);
        } else {
            require!(
                ***manifest == expected,
                CoreG2Error::ImmutableAccountMismatch
            );
        }
        Ok(())
    }

    /// Prepay one canonical bounded WorkPage row. Work Market funding places
    /// this immediately before its own fund instruction in the same atomic
    /// transaction and stores expected_index as the permanent locator slot.
    pub fn reserve_work(
        ctx: Context<ReserveWork>,
        work_kind: u8,
        expected_index: u8,
    ) -> Result<()> {
        authenticate_shot_kernel(
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            &ctx.accounts.ledger,
            &ctx.accounts.shot,
        )?;
        let page_index = work_page_index(ctx.accounts.shot.nonce);
        let page = &mut ctx.accounts.work_page;
        authenticate_work_account(
            page,
            page.key(),
            &ctx.accounts.shot.economy_hash,
            &ctx.accounts.shot.player,
            page_index,
        )?;
        let index = page.reserve_for_shot(
            &ctx.accounts.shot.key(),
            &ctx.accounts.shot,
            work_kind,
            expected_index,
        )?;
        require!(
            index == usize::from(expected_index)
                && page.records[index].disposition == RECEIPT_PENDING,
            CoreG2Error::WrongWorkRecord
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

    /// Atomically consume canonical RCX, route yesterday's immutable Champion's
    /// Cut, burn every unrouteable unit, and issue non-redeemable play credits.
    ///
    /// There is deliberately no pure-burn compatibility path. The exact
    /// DayFinal and all three canonical destination addresses are mandatory, so
    /// a caller cannot omit a winner or choose an older/live podium.
    pub fn reload_rcx<'info>(
        ctx: Context<'info, ReloadRcx<'info>>,
        nonce: u64,
        gross: u64,
        expected_day_final_hash: [u8; 32],
    ) -> Result<()> {
        require!(gross > 0, CoreG2Error::InvalidAmount);
        require_keys_eq!(
            ctx.accounts.token_program.key(),
            token_2022::ID,
            CoreG2Error::WrongTokenProgram
        );
        authenticate_rcx_mint(&ctx.accounts.mint)?;
        require_exact_len(&ctx.accounts.economy.to_account_info(), Economy::LEN)?;
        authenticate_economy(&ctx.accounts.economy, ctx.accounts.economy.key())?;
        let player = ctx.accounts.player.key();
        initialize_or_authenticate_ledger(
            &mut ctx.accounts.ledger,
            ctx.bumps.ledger,
            ctx.accounts.economy.economy_hash,
            player,
        )?;
        require!(
            nonce == ctx.accounts.ledger.next_reload_nonce,
            CoreG2Error::WrongReloadNonce
        );
        let reload_page_index = reload_history_page_index(nonce);
        authenticate_reload_history_account(
            &ctx.accounts.reload_history_page,
            ctx.accounts.reload_history_page.key(),
            &ctx.accounts.economy.economy_hash,
            &player,
            reload_page_index,
        )?;
        ctx.accounts
            .reload_history_page
            .validate_next_nonce(nonce)?;
        require!(
            ctx.accounts.player_token.amount >= gross,
            CoreG2Error::InsufficientRcx
        );

        let current_day = utc_day(Clock::get()?.unix_timestamp);
        let payout_day = current_day
            .checked_sub(1)
            .ok_or(CoreG2Error::TimestampOverflow)?;
        authenticate_day_final(
            &ctx.accounts.day_final,
            ctx.accounts.economy.economy_hash,
            payout_day,
        )?;
        require!(
            ctx.accounts.day_final.final_hash == expected_day_final_hash,
            CoreG2Error::WrongDayFinalHash
        );
        require!(
            ctx.remaining_accounts.len() == PODIUM_SEAT_COUNT,
            CoreG2Error::WrongRemainingAccounts
        );

        let allocation = podium_allocation(gross);
        let seats = ctx.accounts.day_final.top.map(|entry| entry.wallet);
        let mut actions = podium_actions(&player, &seats);
        let mut raw_burned = allocation
            .base_burn
            .checked_add(allocation.dust)
            .ok_or(CoreG2Error::MathOverflow)?;
        let mut raw_routed = 0u64;
        let mut raw_retained = 0u64;

        // Validate every destination before the first CPI. Only an exact,
        // genuinely absent ATA turns that seat into burn; malformed or readonly
        // existing accounts fail instead of silently degrading the route.
        for index in 0..PODIUM_SEAT_COUNT {
            let destination = &ctx.remaining_accounts[index];
            let seat = seats[index];
            let share = allocation.shares[index];
            if seat == Pubkey::default() {
                require_keys_eq!(
                    destination.key(),
                    anchor_lang::system_program::ID,
                    CoreG2Error::WrongSeatAccount
                );
                actions[index] = RELOAD_ACTION_BURN;
                raw_burned = raw_burned
                    .checked_add(share)
                    .ok_or(CoreG2Error::MathOverflow)?;
                continue;
            }

            let expected_ata = canonical_rcx_ata(&seat);
            require_keys_eq!(
                destination.key(),
                expected_ata,
                CoreG2Error::WrongSeatAccount
            );
            if seat == player {
                actions[index] = RELOAD_ACTION_RETAIN;
                raw_retained = raw_retained
                    .checked_add(share)
                    .ok_or(CoreG2Error::MathOverflow)?;
            } else if is_logically_uninitialized(destination) {
                actions[index] = RELOAD_ACTION_BURN;
                raw_burned = raw_burned
                    .checked_add(share)
                    .ok_or(CoreG2Error::MathOverflow)?;
            } else {
                authenticate_seat_ata(destination, &seat)?;
                actions[index] = RELOAD_ACTION_ROUTE;
                raw_routed = raw_routed
                    .checked_add(share)
                    .ok_or(CoreG2Error::MathOverflow)?;
            }
        }

        let consumed = raw_burned
            .checked_add(raw_routed)
            .ok_or(CoreG2Error::MathOverflow)?;
        require_reload_conservation(gross, consumed, raw_burned, raw_routed, raw_retained)?;
        let credits = consumed / RCX_RAW_UNITS_PER_CREDIT;
        require!(credits > 0, CoreG2Error::InvalidAmount);

        let ledger = &mut ctx.accounts.ledger;
        require_ledger_conservation(ledger)?;
        let next_reload_nonce = nonce.checked_add(1).ok_or(CoreG2Error::MathOverflow)?;
        let next_credits = ledger
            .credits
            .checked_add(credits)
            .ok_or(CoreG2Error::MathOverflow)?;
        let next_reload_credits = ledger
            .reload_credits
            .checked_add(credits)
            .ok_or(CoreG2Error::MathOverflow)?;
        let next_rcx_reloaded = ledger
            .rcx_reloaded
            .checked_add(consumed)
            .ok_or(CoreG2Error::MathOverflow)?;
        let next_rcx_burned = ledger
            .rcx_burned
            .checked_add(raw_burned)
            .ok_or(CoreG2Error::MathOverflow)?;
        let next_rcx_routed = ledger
            .rcx_routed
            .checked_add(raw_routed)
            .ok_or(CoreG2Error::MathOverflow)?;
        let next_rcx_retained = ledger
            .rcx_retained
            .checked_add(raw_retained)
            .ok_or(CoreG2Error::MathOverflow)?;

        let reload_page = &mut ctx.accounts.reload_history_page;
        reload_page.append(
            nonce,
            ReloadRecord {
                day: payout_day,
                day_final_hash: ctx.accounts.day_final.final_hash,
                gross,
                actions,
            },
        )?;
        let new_reload_page_len = reload_history_account_len(reload_page)?;
        fund_rent_growth(
            &ctx.accounts.player,
            &reload_page.to_account_info(),
            &ctx.accounts.system_program,
            new_reload_page_len,
        )?;
        if reload_page.to_account_info().data_len() != new_reload_page_len {
            reload_page.to_account_info().resize(new_reload_page_len)?;
        }

        for index in 0..PODIUM_SEAT_COUNT {
            if actions[index] == RELOAD_ACTION_ROUTE {
                let route_memo = reload_route_memo(
                    &ctx.accounts.economy.economy_hash,
                    &player,
                    nonce,
                    payout_day,
                    &ctx.accounts.day_final.final_hash,
                    index as u8,
                    &ctx.remaining_accounts[index].key(),
                    allocation.shares[index],
                );
                let route_memo_payload = lowercase_hex_digest(&route_memo);
                memo::build_memo(
                    CpiContext::new(ctx.accounts.memo_program.key(), BuildMemo {}),
                    route_memo_payload.as_ref(),
                )?;
                token_interface::transfer_checked(
                    CpiContext::new(
                        ctx.accounts.token_program.key(),
                        TransferChecked {
                            from: ctx.accounts.player_token.to_account_info(),
                            mint: ctx.accounts.mint.to_account_info(),
                            to: ctx.remaining_accounts[index].clone(),
                            authority: ctx.accounts.player.to_account_info(),
                        },
                    ),
                    allocation.shares[index],
                    RCX_DECIMALS,
                )?;
            }
        }
        if raw_burned > 0 {
            token_interface::burn(
                CpiContext::new(
                    ctx.accounts.token_program.key(),
                    Burn {
                        mint: ctx.accounts.mint.to_account_info(),
                        from: ctx.accounts.player_token.to_account_info(),
                        authority: ctx.accounts.player.to_account_info(),
                    },
                ),
                raw_burned,
            )?;
        }

        ledger.credits = next_credits;
        ledger.reload_credits = next_reload_credits;
        ledger.next_reload_nonce = next_reload_nonce;
        ledger.rcx_reloaded = next_rcx_reloaded;
        ledger.rcx_burned = next_rcx_burned;
        ledger.rcx_routed = next_rcx_routed;
        ledger.rcx_retained = next_rcx_retained;
        require_ledger_conservation(ledger)?;

        emit!(RcxReloaded {
            economy_hash: ctx.accounts.economy.economy_hash,
            player,
            nonce,
            gross,
            consumed,
            raw_burned,
            raw_routed,
            raw_retained,
            credits,
            day: payout_day,
            day_final_hash: ctx.accounts.day_final.final_hash,
        });
        Ok(())
    }

    /// Permissionlessly materialize one immutable UTC scoreboard after every
    /// accepted shot assigned to that day has reached a terminal state.
    pub fn finalize_day(
        ctx: Context<FinalizeDay>,
        day: i64,
        expected_hash: [u8; 32],
    ) -> Result<()> {
        require_exact_len(&ctx.accounts.economy.to_account_info(), Economy::LEN)?;
        authenticate_economy(&ctx.accounts.economy, ctx.accounts.economy.key())?;
        require!(day >= 0, CoreG2Error::InvalidDay);
        let day_end = day
            .checked_add(1)
            .and_then(|value| value.checked_mul(i64::from(DAY_SECONDS)))
            .ok_or(CoreG2Error::TimestampOverflow)?;
        let clock = Clock::get()?;
        require!(clock.unix_timestamp >= day_end, CoreG2Error::DayStillOpen);
        require!(
            ctx.remaining_accounts.len() == RANK_SHARD_COUNT_USIZE,
            CoreG2Error::WrongRemainingAccounts
        );

        let economy_hash = ctx.accounts.economy.economy_hash;
        let mut accepted = 0u64;
        let mut terminal = 0u64;
        let mut top = [RankEntry::default(); PODIUM_SEAT_COUNT];
        let mut shard_hashes = [[0u8; 32]; RANK_SHARD_COUNT_USIZE];
        for index in 0..RANK_SHARD_COUNT_USIZE {
            let shard = load_rank_shard_or_empty(
                &ctx.remaining_accounts[index],
                economy_hash,
                day,
                index as u8,
            )?;
            accepted = accepted
                .checked_add(shard.accepted)
                .ok_or(CoreG2Error::MathOverflow)?;
            terminal = terminal
                .checked_add(shard.terminal)
                .ok_or(CoreG2Error::MathOverflow)?;
            merge_top3(&mut top, &shard.top)?;
            shard_hashes[index] = rank_shard_digest(&shard)?;
        }
        require!(accepted == terminal, CoreG2Error::DayIncomplete);
        let shards_hash = shards_digest(&economy_hash, day, &shard_hashes);
        let final_hash = day_final_hash(&economy_hash, day, accepted, terminal, &top, &shards_hash);
        require!(final_hash == expected_hash, CoreG2Error::WrongDayFinalHash);

        ctx.accounts.day_final.set_inner(DayFinal {
            schema: CORE_SCHEMA_VERSION,
            bump: ctx.bumps.day_final,
            economy_hash,
            day,
            accepted,
            terminal,
            top,
            shards_hash,
            final_hash,
            finalized_slot: clock.slot,
            finalized_ts: clock.unix_timestamp,
            finalizer: ctx.accounts.actor.key(),
        });
        authenticate_day_final(&ctx.accounts.day_final, economy_hash, day)?;
        emit!(DayFinalized {
            economy_hash,
            day,
            accepted,
            terminal,
            top,
            shards_hash,
            final_hash,
            finalizer: ctx.accounts.actor.key(),
        });
        Ok(())
    }

    pub fn claim_legacy(
        ctx: Context<ClaimLegacy>,
        credits: u64,
        xp: u64,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        require_exact_len(&ctx.accounts.economy.to_account_info(), Economy::LEN)?;
        authenticate_economy(&ctx.accounts.economy, ctx.accounts.economy.key())?;
        require!(
            ctx.accounts.economy.args.legacy_root != [0; 32],
            CoreG2Error::NoLegacySnapshot
        );
        require!(
            Clock::get()?.slot >= ctx.accounts.economy.args.legacy_cutover_slot,
            CoreG2Error::FutureLegacyCutover
        );
        let player = ctx.accounts.player.key();
        let economy_hash = ctx.accounts.economy.economy_hash;
        initialize_or_authenticate_ledger(
            &mut ctx.accounts.ledger,
            ctx.bumps.ledger,
            economy_hash,
            player,
        )?;
        require_legacy_claim_available(&ctx.accounts.ledger, credits, xp)?;
        require!(
            credits <= ctx.accounts.economy.args.legacy_total_credits
                && xp <= ctx.accounts.economy.args.legacy_total_xp,
            CoreG2Error::LegacyClaimExceedsManifest
        );
        let leaf = legacy_leaf(
            &ctx.accounts.economy.args.cluster_genesis_hash,
            &ctx.accounts.economy.args.migration_id,
            &ctx.accounts.economy.args.legacy_snapshot_hash,
            ctx.accounts.economy.args.legacy_cutover_slot,
            &player,
            credits,
            xp,
        );
        require!(
            fold_merkle_proof(leaf, &proof)? == ctx.accounts.economy.args.legacy_root,
            CoreG2Error::InvalidLegacyProof
        );

        let ledger = &mut ctx.accounts.ledger;
        require_ledger_conservation(ledger)?;
        ledger.credits = ledger
            .credits
            .checked_add(credits)
            .ok_or(CoreG2Error::MathOverflow)?;
        ledger.legacy_credits = ledger
            .legacy_credits
            .checked_add(credits)
            .ok_or(CoreG2Error::MathOverflow)?;
        ledger.xp = ledger.xp.checked_add(xp).ok_or(CoreG2Error::MathOverflow)?;
        ledger.legacy_xp = ledger
            .legacy_xp
            .checked_add(xp)
            .ok_or(CoreG2Error::MathOverflow)?;
        require_ledger_conservation(ledger)?;

        emit!(LegacyClaimed {
            economy_hash,
            player,
            credits,
            xp,
            leaf,
            snapshot_hash: ctx.accounts.economy.args.legacy_snapshot_hash,
            cutover_slot: ctx.accounts.economy.args.legacy_cutover_slot,
        });
        Ok(())
    }

    /// Create or update one player-authorized bounded delegate grant. A grant
    /// is permanently bound to one immutable ruleset, and therefore to exactly
    /// that ruleset's entry mode. Updating never resets cumulative usage and a
    /// revoked grant cannot be revived.
    #[allow(clippy::too_many_arguments)]
    pub fn grant_delegate(
        ctx: Context<GrantDelegate>,
        grant_id: [u8; 16],
        max_stake: u64,
        max_gross_stake: u64,
        max_shots: u16,
        min_interval_seconds: u32,
        expires_at_ts: i64,
    ) -> Result<()> {
        require_exact_len(&ctx.accounts.economy.to_account_info(), Economy::LEN)?;
        require_exact_len(&ctx.accounts.ruleset.to_account_info(), Ruleset::LEN)?;
        require_exact_len(
            &ctx.accounts.delegate_grant.to_account_info(),
            DelegateGrant::LEN,
        )?;
        authenticate_economy(&ctx.accounts.economy, ctx.accounts.economy.key())?;
        authenticate_ruleset(
            &ctx.accounts.ruleset,
            &ctx.accounts.economy,
            ctx.accounts.ruleset.key(),
        )?;

        let now = Clock::get()?.unix_timestamp;
        let proposal = DelegateGrant {
            schema: CORE_SCHEMA_VERSION,
            bump: ctx.bumps.delegate_grant,
            grant_id,
            economy_hash: ctx.accounts.economy.economy_hash,
            ruleset_hash: ctx.accounts.ruleset.ruleset_hash,
            player: ctx.accounts.player.key(),
            delegate: ctx.accounts.delegate.key(),
            max_stake,
            max_gross_stake,
            max_shots,
            min_interval_seconds,
            expires_at_ts,
            gross_stake_used: 0,
            shots_used: 0,
            last_seal_ts: 0,
            revoked: 0,
        };
        validate_new_delegate_grant(&proposal, &ctx.accounts.economy, &ctx.accounts.ruleset, now)?;

        let grant = &mut ctx.accounts.delegate_grant;
        if grant.schema == 0 {
            grant.set_inner(proposal);
        } else {
            authenticate_delegate_grant(
                grant,
                grant.key(),
                &ctx.accounts.economy,
                &ctx.accounts.ruleset,
            )?;
            require!(grant.revoked == 0, StateError::DelegateRevoked);
            let updated = DelegateGrant {
                gross_stake_used: grant.gross_stake_used,
                shots_used: grant.shots_used,
                last_seal_ts: grant.last_seal_ts,
                ..proposal
            };
            validate_delegate_grant(&updated, &ctx.accounts.economy, &ctx.accounts.ruleset)?;
            grant.set_inner(updated);
        }
        authenticate_delegate_grant(
            grant,
            grant.key(),
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
        )
    }

    /// Irreversibly stop new seals under a grant. Existing Shots remain safely
    /// completable by their frozen delegate even after this bit is set.
    pub fn revoke_delegate(ctx: Context<RevokeDelegate>) -> Result<()> {
        require_exact_len(&ctx.accounts.economy.to_account_info(), Economy::LEN)?;
        require_exact_len(&ctx.accounts.ruleset.to_account_info(), Ruleset::LEN)?;
        require_exact_len(
            &ctx.accounts.delegate_grant.to_account_info(),
            DelegateGrant::LEN,
        )?;
        authenticate_economy(&ctx.accounts.economy, ctx.accounts.economy.key())?;
        authenticate_ruleset(
            &ctx.accounts.ruleset,
            &ctx.accounts.economy,
            ctx.accounts.ruleset.key(),
        )?;
        authenticate_delegate_grant(
            &ctx.accounts.delegate_grant,
            ctx.accounts.delegate_grant.key(),
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
        )?;
        require_keys_eq!(
            ctx.accounts.player.key(),
            ctx.accounts.delegate_grant.player,
            CoreG2Error::WrongDelegateAuthority
        );
        revoke_delegate_grant(&mut ctx.accounts.delegate_grant);
        Ok(())
    }

    pub fn seal_forward(
        ctx: Context<SealForward>,
        nonce: u64,
        commit: [u8; 32],
        stake: u64,
        entry_target_ts: i64,
        score_day: i64,
    ) -> Result<()> {
        authenticate_kernel(
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            &ctx.accounts.ledger,
            ctx.accounts.player.key(),
        )?;
        let rules = &ctx.accounts.ruleset.args;
        require!(
            rules.entry_mode == ENTRY_FORWARD,
            CoreG2Error::WrongEntryMode
        );
        require!(commit != [0; 32], CoreG2Error::EmptyCommitment);
        require!(
            nonce == ctx.accounts.ledger.next_shot_nonce,
            CoreG2Error::WrongShotNonce
        );
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;
        let earliest = now
            .checked_add(i64::from(rules.min_open_lead_seconds))
            .ok_or(CoreG2Error::TimestampOverflow)?;
        let expected_entry = align_up(earliest, rules.target_grid_seconds)?;
        require!(entry_target_ts == expected_entry, CoreG2Error::WrongTarget);
        let exit_target_ts = entry_target_ts
            .checked_add(i64::from(rules.horizon_seconds))
            .ok_or(CoreG2Error::TimestampOverflow)?;
        load_open_need(
            &ctx.accounts.entry_need.to_account_info(),
            &ctx.accounts.economy.args.timepin_program,
            &rules.evidence_spec_hash,
            entry_target_ts,
        )?;
        let exit_need = load_open_need(
            &ctx.accounts.exit_need.to_account_info(),
            &ctx.accounts.economy.args.timepin_program,
            &rules.evidence_spec_hash,
            exit_target_ts,
        )?;
        require_keys_neq!(
            ctx.accounts.entry_need.key(),
            ctx.accounts.exit_need.key(),
            CoreG2Error::SameNeed
        );
        let reveal_deadline_ts = fixed_reveal_deadline(
            exit_target_ts,
            exit_need.source_deadline_ts,
            exit_need.capture_deadline_ts,
            ctx.accounts.economy.args.reveal_window_seconds,
        )?;
        require!(
            score_day == utc_day(reveal_deadline_ts),
            CoreG2Error::WrongScoreDay
        );
        let player = ctx.accounts.player.key();
        let rank_shard = rank_shard_for(&player);
        initialize_or_authenticate_player_day(
            &mut ctx.accounts.player_day,
            ctx.bumps.player_day,
            ctx.accounts.economy.economy_hash,
            score_day,
            player,
            rank_shard,
        )?;
        initialize_or_authenticate_rank_shard(
            &mut ctx.accounts.rank_shard,
            ctx.bumps.rank_shard,
            ctx.accounts.economy.economy_hash,
            score_day,
            rank_shard,
        )?;
        reserve_history_slot(
            &mut ctx.accounts.history_page,
            ctx.accounts.economy.economy_hash,
            player,
            nonce,
            &ctx.accounts.player,
            &ctx.accounts.system_program,
        )?;

        debit_seal(
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            &mut ctx.accounts.ledger,
            stake,
            nonce,
        )?;
        write_shot(
            &mut ctx.accounts.shot,
            ctx.bumps.shot,
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            player,
            player,
            Pubkey::default(),
            nonce,
            commit,
            stake,
            now,
            ShotState::PendingEntry as u8,
            entry_target_ts,
            exit_target_ts,
            score_day,
            rank_shard,
            reveal_deadline_ts,
            ctx.accounts.entry_need.key(),
            ctx.accounts.exit_need.key(),
        );
        deposit_cleanup_bond(
            &ctx.accounts.player,
            &ctx.accounts.shot,
            &ctx.accounts.system_program,
            ctx.accounts.economy.args.cleanup_bond_lamports,
        )?;
        record_accepted(&mut ctx.accounts.player_day, &mut ctx.accounts.rank_shard)?;
        emit!(ShotSealed {
            shot: ctx.accounts.shot.key(),
            player,
            economy_hash: ctx.accounts.economy.economy_hash,
            ruleset_hash: ctx.accounts.ruleset.ruleset_hash,
            nonce,
            stake,
            entry_mode: ENTRY_FORWARD,
            entry_target_ts,
            exit_target_ts,
            score_day,
            reveal_deadline_ts,
        });
        Ok(())
    }

    /// Delegate-signed forward seal under one bounded grant and one permanent
    /// request receipt. The delegate pays all transient rent and the cleanup
    /// bond; its address is frozen as the Shot rent recipient.
    #[allow(clippy::too_many_arguments)]
    pub fn seal_forward_delegated(
        ctx: Context<SealForwardDelegated>,
        nonce: u64,
        commit: [u8; 32],
        stake: u64,
        entry_target_ts: i64,
        score_day: i64,
    ) -> Result<()> {
        require_exact_len(
            &ctx.accounts.delegate_grant.to_account_info(),
            DelegateGrant::LEN,
        )?;
        authenticate_kernel(
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            &ctx.accounts.ledger,
            ctx.accounts.delegate_grant.player,
        )?;
        authenticate_delegate_grant(
            &ctx.accounts.delegate_grant,
            ctx.accounts.delegate_grant.key(),
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
        )?;
        require_keys_eq!(
            ctx.accounts.delegate.key(),
            ctx.accounts.delegate_grant.delegate,
            CoreG2Error::WrongDelegateAuthority
        );
        let rules = &ctx.accounts.ruleset.args;
        require!(
            rules.entry_mode == ENTRY_FORWARD,
            CoreG2Error::WrongEntryMode
        );
        require!(commit != [0; 32], CoreG2Error::EmptyCommitment);
        require!(
            nonce == ctx.accounts.ledger.next_shot_nonce,
            CoreG2Error::WrongShotNonce
        );
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;
        let earliest = now
            .checked_add(i64::from(rules.min_open_lead_seconds))
            .ok_or(CoreG2Error::TimestampOverflow)?;
        let expected_entry = align_up(earliest, rules.target_grid_seconds)?;
        require!(entry_target_ts == expected_entry, CoreG2Error::WrongTarget);
        let exit_target_ts = entry_target_ts
            .checked_add(i64::from(rules.horizon_seconds))
            .ok_or(CoreG2Error::TimestampOverflow)?;
        load_open_need(
            &ctx.accounts.entry_need.to_account_info(),
            &ctx.accounts.economy.args.timepin_program,
            &rules.evidence_spec_hash,
            entry_target_ts,
        )?;
        let exit_need = load_open_need(
            &ctx.accounts.exit_need.to_account_info(),
            &ctx.accounts.economy.args.timepin_program,
            &rules.evidence_spec_hash,
            exit_target_ts,
        )?;
        require_keys_neq!(
            ctx.accounts.entry_need.key(),
            ctx.accounts.exit_need.key(),
            CoreG2Error::SameNeed
        );
        let reveal_deadline_ts = fixed_reveal_deadline(
            exit_target_ts,
            exit_need.source_deadline_ts,
            exit_need.capture_deadline_ts,
            ctx.accounts.economy.args.reveal_window_seconds,
        )?;
        require!(
            score_day == utc_day(reveal_deadline_ts),
            CoreG2Error::WrongScoreDay
        );
        let player = ctx.accounts.delegate_grant.player;
        let delegate = ctx.accounts.delegate.key();
        let rank_shard = rank_shard_for(&player);
        initialize_or_authenticate_player_day(
            &mut ctx.accounts.player_day,
            ctx.bumps.player_day,
            ctx.accounts.economy.economy_hash,
            score_day,
            player,
            rank_shard,
        )?;
        initialize_or_authenticate_rank_shard(
            &mut ctx.accounts.rank_shard,
            ctx.bumps.rank_shard,
            ctx.accounts.economy.economy_hash,
            score_day,
            rank_shard,
        )?;
        reserve_history_slot(
            &mut ctx.accounts.history_page,
            ctx.accounts.economy.economy_hash,
            player,
            nonce,
            &ctx.accounts.delegate,
            &ctx.accounts.system_program,
        )?;
        // Rent-free replay protection is canonical: the delegate signs this
        // explicit nonce, the writable ledger serializes contenders, and the
        // Shot PDA can be initialized only once for (economy, player, nonce).
        // Deduplicating an upstream Bankr/X request is a client concern.
        consume_delegate_grant(
            &mut ctx.accounts.delegate_grant,
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            now,
            stake,
        )?;
        debit_seal(
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            &mut ctx.accounts.ledger,
            stake,
            nonce,
        )?;
        write_shot(
            &mut ctx.accounts.shot,
            ctx.bumps.shot,
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            player,
            delegate,
            delegate,
            nonce,
            commit,
            stake,
            now,
            ShotState::PendingEntry as u8,
            entry_target_ts,
            exit_target_ts,
            score_day,
            rank_shard,
            reveal_deadline_ts,
            ctx.accounts.entry_need.key(),
            ctx.accounts.exit_need.key(),
        );
        deposit_cleanup_bond(
            &ctx.accounts.delegate,
            &ctx.accounts.shot,
            &ctx.accounts.system_program,
            ctx.accounts.economy.args.cleanup_bond_lamports,
        )?;
        record_accepted(&mut ctx.accounts.player_day, &mut ctx.accounts.rank_shard)?;
        emit!(ShotSealed {
            shot: ctx.accounts.shot.key(),
            player,
            economy_hash: ctx.accounts.economy.economy_hash,
            ruleset_hash: ctx.accounts.ruleset.ruleset_hash,
            nonce,
            stake,
            entry_mode: ENTRY_FORWARD,
            entry_target_ts,
            exit_target_ts,
            score_day,
            reveal_deadline_ts,
        });
        Ok(())
    }

    pub fn seal_observed(
        ctx: Context<SealObserved>,
        nonce: u64,
        commit: [u8; 32],
        stake: u64,
        entry_target_ts: i64,
        exit_target_ts: i64,
        score_day: i64,
    ) -> Result<()> {
        authenticate_kernel(
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            &ctx.accounts.ledger,
            ctx.accounts.player.key(),
        )?;
        let rules = &ctx.accounts.ruleset.args;
        require!(
            rules.entry_mode == ENTRY_OBSERVED,
            CoreG2Error::WrongEntryMode
        );
        require!(commit != [0; 32], CoreG2Error::EmptyCommitment);
        require!(
            nonce == ctx.accounts.ledger.next_shot_nonce,
            CoreG2Error::WrongShotNonce
        );
        let spec = load_evidence_spec(
            &ctx.accounts.evidence_spec.to_account_info(),
            &ctx.accounts.economy.args.timepin_program,
            &rules.evidence_spec_hash,
        )?;
        require_spec_ruleset_match(&spec, rules)?;
        let (entry_timepin, entry) = authenticate_final(
            &ctx.accounts.entry_need.to_account_info(),
            &ctx.accounts.entry_candidate.to_account_info(),
            &ctx.accounts.economy.args.timepin_program,
            &rules.evidence_spec_hash,
            &spec,
            entry_target_ts,
        )?;
        validate_record_against_spec(&entry, &spec, entry_target_ts)?;
        require!(entry.feed_id == rules.feed_id, CoreG2Error::WrongFeed);
        let now = Clock::get()?.unix_timestamp;
        require!(entry.publish_time <= now, CoreG2Error::FutureEntry);
        let age = now
            .checked_sub(entry.publish_time)
            .ok_or(CoreG2Error::TimestampOverflow)?;
        require!(
            age <= i64::from(rules.max_entry_age_seconds),
            CoreG2Error::StaleEntry
        );
        let expected_exit = align_up(
            now.checked_add(i64::from(rules.horizon_seconds))
                .ok_or(CoreG2Error::TimestampOverflow)?,
            rules.target_grid_seconds,
        )?;
        require!(exit_target_ts == expected_exit, CoreG2Error::WrongTarget);
        let exit_need = load_open_need(
            &ctx.accounts.exit_need.to_account_info(),
            &ctx.accounts.economy.args.timepin_program,
            &rules.evidence_spec_hash,
            exit_target_ts,
        )?;
        require_keys_neq!(
            ctx.accounts.entry_need.key(),
            ctx.accounts.exit_need.key(),
            CoreG2Error::SameNeed
        );
        let reveal_deadline_ts = fixed_reveal_deadline(
            exit_target_ts,
            exit_need.source_deadline_ts,
            exit_need.capture_deadline_ts,
            ctx.accounts.economy.args.reveal_window_seconds,
        )?;
        require!(
            score_day == utc_day(reveal_deadline_ts),
            CoreG2Error::WrongScoreDay
        );
        let player = ctx.accounts.player.key();
        let rank_shard = rank_shard_for(&player);
        initialize_or_authenticate_player_day(
            &mut ctx.accounts.player_day,
            ctx.bumps.player_day,
            ctx.accounts.economy.economy_hash,
            score_day,
            player,
            rank_shard,
        )?;
        initialize_or_authenticate_rank_shard(
            &mut ctx.accounts.rank_shard,
            ctx.bumps.rank_shard,
            ctx.accounts.economy.economy_hash,
            score_day,
            rank_shard,
        )?;
        reserve_history_slot(
            &mut ctx.accounts.history_page,
            ctx.accounts.economy.economy_hash,
            player,
            nonce,
            &ctx.accounts.player,
            &ctx.accounts.system_program,
        )?;

        debit_seal(
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            &mut ctx.accounts.ledger,
            stake,
            nonce,
        )?;
        write_shot(
            &mut ctx.accounts.shot,
            ctx.bumps.shot,
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            player,
            player,
            Pubkey::default(),
            nonce,
            commit,
            stake,
            now,
            ShotState::Active as u8,
            entry_target_ts,
            exit_target_ts,
            score_day,
            rank_shard,
            reveal_deadline_ts,
            ctx.accounts.entry_need.key(),
            ctx.accounts.exit_need.key(),
        );
        ctx.accounts.shot.entry_timepin_result_hash = entry_timepin.result_hash;
        write_entry(&mut ctx.accounts.shot, &entry);
        deposit_cleanup_bond(
            &ctx.accounts.player,
            &ctx.accounts.shot,
            &ctx.accounts.system_program,
            ctx.accounts.economy.args.cleanup_bond_lamports,
        )?;
        record_accepted(&mut ctx.accounts.player_day, &mut ctx.accounts.rank_shard)?;
        emit!(ShotSealed {
            shot: ctx.accounts.shot.key(),
            player,
            economy_hash: ctx.accounts.economy.economy_hash,
            ruleset_hash: ctx.accounts.ruleset.ruleset_hash,
            nonce,
            stake,
            entry_mode: ENTRY_OBSERVED,
            entry_target_ts,
            exit_target_ts,
            score_day,
            reveal_deadline_ts,
        });
        Ok(())
    }

    /// Delegate-signed observed seal with the authenticated entry evidence
    /// bound into the permanent request intent.
    #[allow(clippy::too_many_arguments)]
    pub fn seal_observed_delegated(
        ctx: Context<SealObservedDelegated>,
        nonce: u64,
        commit: [u8; 32],
        stake: u64,
        entry_target_ts: i64,
        exit_target_ts: i64,
        score_day: i64,
    ) -> Result<()> {
        require_exact_len(
            &ctx.accounts.delegate_grant.to_account_info(),
            DelegateGrant::LEN,
        )?;
        authenticate_kernel(
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            &ctx.accounts.ledger,
            ctx.accounts.delegate_grant.player,
        )?;
        authenticate_delegate_grant(
            &ctx.accounts.delegate_grant,
            ctx.accounts.delegate_grant.key(),
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
        )?;
        require_keys_eq!(
            ctx.accounts.delegate.key(),
            ctx.accounts.delegate_grant.delegate,
            CoreG2Error::WrongDelegateAuthority
        );
        let rules = &ctx.accounts.ruleset.args;
        require!(
            rules.entry_mode == ENTRY_OBSERVED,
            CoreG2Error::WrongEntryMode
        );
        require!(commit != [0; 32], CoreG2Error::EmptyCommitment);
        require!(
            nonce == ctx.accounts.ledger.next_shot_nonce,
            CoreG2Error::WrongShotNonce
        );
        let spec = load_evidence_spec(
            &ctx.accounts.evidence_spec.to_account_info(),
            &ctx.accounts.economy.args.timepin_program,
            &rules.evidence_spec_hash,
        )?;
        require_spec_ruleset_match(&spec, rules)?;
        let (entry_timepin, entry) = authenticate_final(
            &ctx.accounts.entry_need.to_account_info(),
            &ctx.accounts.entry_candidate.to_account_info(),
            &ctx.accounts.economy.args.timepin_program,
            &rules.evidence_spec_hash,
            &spec,
            entry_target_ts,
        )?;
        validate_record_against_spec(&entry, &spec, entry_target_ts)?;
        require!(entry.feed_id == rules.feed_id, CoreG2Error::WrongFeed);
        let now = Clock::get()?.unix_timestamp;
        require!(entry.publish_time <= now, CoreG2Error::FutureEntry);
        let age = now
            .checked_sub(entry.publish_time)
            .ok_or(CoreG2Error::TimestampOverflow)?;
        require!(
            age <= i64::from(rules.max_entry_age_seconds),
            CoreG2Error::StaleEntry
        );
        let expected_exit = align_up(
            now.checked_add(i64::from(rules.horizon_seconds))
                .ok_or(CoreG2Error::TimestampOverflow)?,
            rules.target_grid_seconds,
        )?;
        require!(exit_target_ts == expected_exit, CoreG2Error::WrongTarget);
        let exit_need = load_open_need(
            &ctx.accounts.exit_need.to_account_info(),
            &ctx.accounts.economy.args.timepin_program,
            &rules.evidence_spec_hash,
            exit_target_ts,
        )?;
        require_keys_neq!(
            ctx.accounts.entry_need.key(),
            ctx.accounts.exit_need.key(),
            CoreG2Error::SameNeed
        );
        let reveal_deadline_ts = fixed_reveal_deadline(
            exit_target_ts,
            exit_need.source_deadline_ts,
            exit_need.capture_deadline_ts,
            ctx.accounts.economy.args.reveal_window_seconds,
        )?;
        require!(
            score_day == utc_day(reveal_deadline_ts),
            CoreG2Error::WrongScoreDay
        );
        let player = ctx.accounts.delegate_grant.player;
        let delegate = ctx.accounts.delegate.key();
        let rank_shard = rank_shard_for(&player);
        initialize_or_authenticate_player_day(
            &mut ctx.accounts.player_day,
            ctx.bumps.player_day,
            ctx.accounts.economy.economy_hash,
            score_day,
            player,
            rank_shard,
        )?;
        initialize_or_authenticate_rank_shard(
            &mut ctx.accounts.rank_shard,
            ctx.bumps.rank_shard,
            ctx.accounts.economy.economy_hash,
            score_day,
            rank_shard,
        )?;
        reserve_history_slot(
            &mut ctx.accounts.history_page,
            ctx.accounts.economy.economy_hash,
            player,
            nonce,
            &ctx.accounts.delegate,
            &ctx.accounts.system_program,
        )?;
        // The signed canonical nonce plus the serialized ledger and one-shot
        // Shot PDA are the on-chain replay boundary. Upstream request IDs are
        // deliberately not persisted per shot; clients deduplicate them.
        consume_delegate_grant(
            &mut ctx.accounts.delegate_grant,
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            now,
            stake,
        )?;
        debit_seal(
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            &mut ctx.accounts.ledger,
            stake,
            nonce,
        )?;
        write_shot(
            &mut ctx.accounts.shot,
            ctx.bumps.shot,
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            player,
            delegate,
            delegate,
            nonce,
            commit,
            stake,
            now,
            ShotState::Active as u8,
            entry_target_ts,
            exit_target_ts,
            score_day,
            rank_shard,
            reveal_deadline_ts,
            ctx.accounts.entry_need.key(),
            ctx.accounts.exit_need.key(),
        );
        ctx.accounts.shot.entry_timepin_result_hash = entry_timepin.result_hash;
        write_entry(&mut ctx.accounts.shot, &entry);
        deposit_cleanup_bond(
            &ctx.accounts.delegate,
            &ctx.accounts.shot,
            &ctx.accounts.system_program,
            ctx.accounts.economy.args.cleanup_bond_lamports,
        )?;
        record_accepted(&mut ctx.accounts.player_day, &mut ctx.accounts.rank_shard)?;
        emit!(ShotSealed {
            shot: ctx.accounts.shot.key(),
            player,
            economy_hash: ctx.accounts.economy.economy_hash,
            ruleset_hash: ctx.accounts.ruleset.ruleset_hash,
            nonce,
            stake,
            entry_mode: ENTRY_OBSERVED,
            entry_target_ts,
            exit_target_ts,
            score_day,
            reveal_deadline_ts,
        });
        Ok(())
    }

    pub fn activate_entry(ctx: Context<ActivateEntry>) -> Result<()> {
        authenticate_shot_kernel(
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            &ctx.accounts.ledger,
            &ctx.accounts.shot,
        )?;
        require!(
            ctx.accounts.shot.state == ShotState::PendingEntry as u8,
            CoreG2Error::WrongState
        );
        require!(
            ctx.accounts.shot.entry_mode == ENTRY_FORWARD,
            CoreG2Error::WrongEntryMode
        );
        require_keys_eq!(
            ctx.accounts.entry_need.key(),
            ctx.accounts.shot.entry_need,
            CoreG2Error::WrongNeed
        );
        let rules = &ctx.accounts.ruleset.args;
        let spec = load_evidence_spec(
            &ctx.accounts.evidence_spec.to_account_info(),
            &ctx.accounts.economy.args.timepin_program,
            &rules.evidence_spec_hash,
        )?;
        require_spec_ruleset_match(&spec, rules)?;
        let (entry_timepin, entry) = authenticate_final(
            &ctx.accounts.entry_need.to_account_info(),
            &ctx.accounts.entry_candidate.to_account_info(),
            &ctx.accounts.economy.args.timepin_program,
            &rules.evidence_spec_hash,
            &spec,
            ctx.accounts.shot.entry_target_ts,
        )?;
        validate_record_against_spec(&entry, &spec, ctx.accounts.shot.entry_target_ts)?;
        require!(entry.feed_id == rules.feed_id, CoreG2Error::WrongFeed);

        write_entry(&mut ctx.accounts.shot, &entry);
        ctx.accounts.shot.entry_timepin_result_hash = entry_timepin.result_hash;
        let clock = Clock::get()?;
        ctx.accounts.shot.state = ShotState::Active as u8;
        ctx.accounts.shot.activation_worker = ctx.accounts.actor.key();
        ctx.accounts.shot.activation_slot = clock.slot;
        ctx.accounts.shot.activation_ts = clock.unix_timestamp;
        complete_optional_work(
            &ctx.accounts.work_page.to_account_info(),
            &ctx.accounts.shot.economy_hash,
            &ctx.accounts.shot.player,
            ctx.accounts.shot.nonce,
            &ctx.accounts.shot.key(),
            WORK_KIND_ACTIVATE_ENTRY,
            RECEIPT_PAYABLE,
            ctx.accounts.actor.key(),
            ctx.accounts.shot.entry_timepin_result_hash,
            clock.slot,
        )?;
        emit!(EntryActivated {
            shot: ctx.accounts.shot.key(),
            actor: ctx.accounts.actor.key(),
            entry_message_hash: entry.message_hash,
        });
        Ok(())
    }

    pub fn void_pending_entry(ctx: Context<VoidPendingEntry>) -> Result<()> {
        authenticate_shot_kernel(
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            &ctx.accounts.ledger,
            &ctx.accounts.shot,
        )?;
        authenticate_shot_score_accounts(
            &ctx.accounts.shot,
            &ctx.accounts.player_day,
            &ctx.accounts.rank_shard,
        )?;
        require!(
            ctx.accounts.shot.state == ShotState::PendingEntry as u8,
            CoreG2Error::WrongState
        );
        require_keys_eq!(
            ctx.accounts.entry_need.key(),
            ctx.accounts.shot.entry_need,
            CoreG2Error::WrongNeed
        );
        let terminal = authenticate_void_terminal(
            &ctx.accounts.entry_need.to_account_info(),
            &ctx.accounts.economy.args.timepin_program,
            &ctx.accounts.ruleset.args.evidence_spec_hash,
            ctx.accounts.shot.entry_target_ts,
        )?;
        let reason = terminal_void_reason(terminal.terminal_kind, true)?;
        ctx.accounts.shot.entry_timepin_result_hash = terminal.result_hash;
        let clock = Clock::get()?;
        refund_void(
            &ctx.accounts.economy,
            &mut ctx.accounts.ledger,
            &mut ctx.accounts.shot,
            reason,
            ctx.accounts.actor.key(),
            &clock,
        )?;
        record_terminal(
            &mut ctx.accounts.player_day,
            &mut ctx.accounts.rank_shard,
            0,
        )?;
        let hash = ctx.accounts.shot.terminal_hash;
        let shot_key = ctx.accounts.shot.key();
        complete_optional_work(
            &ctx.accounts.work_page.to_account_info(),
            &ctx.accounts.shot.economy_hash,
            &ctx.accounts.shot.player,
            ctx.accounts.shot.nonce,
            &shot_key,
            WORK_KIND_ACTIVATE_ENTRY,
            RECEIPT_NONPAYABLE,
            Pubkey::default(),
            hash,
            clock.slot,
        )?;
        complete_optional_work(
            &ctx.accounts.work_page.to_account_info(),
            &ctx.accounts.shot.economy_hash,
            &ctx.accounts.shot.player,
            ctx.accounts.shot.nonce,
            &shot_key,
            WORK_KIND_RESOLVE_SHOT,
            RECEIPT_PAYABLE,
            ctx.accounts.actor.key(),
            ctx.accounts.shot.resolution_hash,
            clock.slot,
        )?;
        complete_optional_work(
            &ctx.accounts.work_page.to_account_info(),
            &ctx.accounts.shot.economy_hash,
            &ctx.accounts.shot.player,
            ctx.accounts.shot.nonce,
            &shot_key,
            WORK_KIND_FORFEIT,
            RECEIPT_NONPAYABLE,
            Pubkey::default(),
            hash,
            clock.slot,
        )?;
        archive_terminal_shot(
            &mut ctx.accounts.history_page,
            &mut ctx.accounts.shot,
            &ctx.accounts.actor,
            &ctx.accounts.system_program,
        )?;
        emit!(ShotVoided {
            shot: ctx.accounts.shot.key(),
            actor: ctx.accounts.actor.key(),
            reason,
            result_hash: hash,
        });
        Ok(())
    }

    pub fn settle_final(ctx: Context<SettleFinal>) -> Result<()> {
        authenticate_shot_kernel(
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            &ctx.accounts.ledger,
            &ctx.accounts.shot,
        )?;
        authenticate_shot_score_accounts(
            &ctx.accounts.shot,
            &ctx.accounts.player_day,
            &ctx.accounts.rank_shard,
        )?;
        require!(
            ctx.accounts.shot.state == ShotState::Active as u8,
            CoreG2Error::WrongState
        );
        require_keys_eq!(
            ctx.accounts.exit_need.key(),
            ctx.accounts.shot.exit_need,
            CoreG2Error::WrongNeed
        );
        let rules = &ctx.accounts.ruleset.args;
        let spec = load_evidence_spec(
            &ctx.accounts.evidence_spec.to_account_info(),
            &ctx.accounts.economy.args.timepin_program,
            &rules.evidence_spec_hash,
        )?;
        require_spec_ruleset_match(&spec, rules)?;
        let exit_need = load_need(
            &ctx.accounts.exit_need.to_account_info(),
            &ctx.accounts.economy.args.timepin_program,
            &rules.evidence_spec_hash,
            ctx.accounts.shot.exit_target_ts,
        )?;
        let (exit_timepin, exit) = authenticate_final(
            &ctx.accounts.exit_need.to_account_info(),
            &ctx.accounts.exit_candidate.to_account_info(),
            &ctx.accounts.economy.args.timepin_program,
            &rules.evidence_spec_hash,
            &spec,
            ctx.accounts.shot.exit_target_ts,
        )?;
        validate_record_against_spec(&exit, &spec, ctx.accounts.shot.exit_target_ts)?;
        require!(exit.feed_id == rules.feed_id, CoreG2Error::WrongFeed);
        let reveal_deadline_ts = fixed_reveal_deadline(
            ctx.accounts.shot.exit_target_ts,
            exit_need.source_deadline_ts,
            exit_need.capture_deadline_ts,
            ctx.accounts.economy.args.reveal_window_seconds,
        )?;
        require!(
            reveal_deadline_ts == ctx.accounts.shot.reveal_deadline_ts,
            CoreG2Error::BadTimepinDeadline
        );

        let entry_scaled = scale_to_e12(
            ctx.accounts.shot.entry_price,
            ctx.accounts.shot.entry_exponent,
        )?;
        let exit_scaled = scale_to_e12(exit.price, exit.exponent)?;
        let delta = if exit_scaled >= entry_scaled {
            u128::try_from(exit_scaled - entry_scaled)
                .map_err(|_| error!(CoreG2Error::MathOverflow))?
        } else {
            u128::try_from(entry_scaled - exit_scaled)
                .map_err(|_| error!(CoreG2Error::MathOverflow))?
        };
        let entry_conf = scale_conf_to_e12(
            ctx.accounts.shot.entry_conf,
            ctx.accounts.shot.entry_exponent,
        )?;
        let exit_conf = scale_conf_to_e12(exit.conf, exit.exponent)?;
        let reference_conf = entry_conf.max(exit_conf);
        let in_band = product_leq_u128_u32(
            delta,
            rules.band_denominator,
            reference_conf,
            rules.band_numerator,
        );

        write_exit(&mut ctx.accounts.shot, &exit);
        ctx.accounts.shot.exit_timepin_result_hash = exit_timepin.result_hash;
        let clock = Clock::get()?;
        ctx.accounts.shot.resolver = ctx.accounts.actor.key();
        ctx.accounts.shot.settled_ts = clock.unix_timestamp;
        ctx.accounts.shot.resolution_slot = clock.slot;
        if delta == 0 || (rules.band_numerator > 0 && in_band) {
            let reason = if delta == 0 {
                VoidReason::Equality as u8
            } else {
                VoidReason::ConfidenceBand as u8
            };
            ctx.accounts.shot.state = ShotState::AwaitVoid as u8;
            ctx.accounts.shot.void_reason = reason;
            ctx.accounts.shot.outcome_yes = 0;
        } else {
            ctx.accounts.shot.state = ShotState::AwaitReveal as u8;
            ctx.accounts.shot.void_reason = VoidReason::None as u8;
            ctx.accounts.shot.outcome_yes = u8::from(exit_scaled > entry_scaled);
        }
        ctx.accounts.shot.resolution_hash =
            resolution_hash(&ctx.accounts.shot.key(), &ctx.accounts.shot);
        ctx.accounts.shot.terminal_hash = [0; 32];
        require_ledger_conservation(&ctx.accounts.ledger)?;
        let hash = ctx.accounts.shot.resolution_hash;
        complete_optional_work(
            &ctx.accounts.work_page.to_account_info(),
            &ctx.accounts.shot.economy_hash,
            &ctx.accounts.shot.player,
            ctx.accounts.shot.nonce,
            &ctx.accounts.shot.key(),
            WORK_KIND_RESOLVE_SHOT,
            RECEIPT_PAYABLE,
            ctx.accounts.actor.key(),
            hash,
            clock.slot,
        )?;
        emit!(ShotResolved {
            shot: ctx.accounts.shot.key(),
            actor: ctx.accounts.actor.key(),
            state: ctx.accounts.shot.state,
            outcome_yes: ctx.accounts.shot.outcome_yes,
            result_hash: hash,
        });
        Ok(())
    }

    /// Permissionlessly terminalize an equality/confidence-band resolution.
    /// Settlement fixes the resolver and result hash; this instruction only
    /// applies the deterministic refund and daily terminal counters.
    pub fn finalize_resolved_void(ctx: Context<FinalizeResolvedVoid>) -> Result<()> {
        authenticate_shot_kernel(
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            &ctx.accounts.ledger,
            &ctx.accounts.shot,
        )?;
        authenticate_shot_score_accounts(
            &ctx.accounts.shot,
            &ctx.accounts.player_day,
            &ctx.accounts.rank_shard,
        )?;
        require!(
            ctx.accounts.shot.state == ShotState::AwaitVoid as u8,
            CoreG2Error::WrongState
        );
        require!(
            ctx.accounts.shot.void_reason == VoidReason::Equality as u8
                || ctx.accounts.shot.void_reason == VoidReason::ConfidenceBand as u8,
            CoreG2Error::BadShotShape
        );
        require!(
            ctx.accounts.shot.resolver != Pubkey::default()
                && ctx.accounts.shot.resolution_hash
                    == resolution_hash(&ctx.accounts.shot.key(), &ctx.accounts.shot),
            CoreG2Error::BadShotShape
        );
        let clock = Clock::get()?;
        finalize_void_accounting(
            &ctx.accounts.economy,
            &mut ctx.accounts.ledger,
            &mut ctx.accounts.shot,
            &clock,
        )?;
        record_terminal(
            &mut ctx.accounts.player_day,
            &mut ctx.accounts.rank_shard,
            0,
        )?;
        let shot_key = ctx.accounts.shot.key();
        complete_optional_work(
            &ctx.accounts.work_page.to_account_info(),
            &ctx.accounts.shot.economy_hash,
            &ctx.accounts.shot.player,
            ctx.accounts.shot.nonce,
            &shot_key,
            WORK_KIND_FORFEIT,
            RECEIPT_NONPAYABLE,
            Pubkey::default(),
            ctx.accounts.shot.terminal_hash,
            clock.slot,
        )?;
        archive_terminal_shot(
            &mut ctx.accounts.history_page,
            &mut ctx.accounts.shot,
            &ctx.accounts.actor,
            &ctx.accounts.system_program,
        )?;
        emit!(ShotVoided {
            shot: ctx.accounts.shot.key(),
            actor: ctx.accounts.actor.key(),
            reason: ctx.accounts.shot.void_reason,
            result_hash: ctx.accounts.shot.terminal_hash,
        });
        Ok(())
    }

    pub fn void_active_shot(ctx: Context<VoidActiveShot>) -> Result<()> {
        authenticate_shot_kernel(
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            &ctx.accounts.ledger,
            &ctx.accounts.shot,
        )?;
        authenticate_shot_score_accounts(
            &ctx.accounts.shot,
            &ctx.accounts.player_day,
            &ctx.accounts.rank_shard,
        )?;
        require!(
            ctx.accounts.shot.state == ShotState::Active as u8,
            CoreG2Error::WrongState
        );
        require_keys_eq!(
            ctx.accounts.exit_need.key(),
            ctx.accounts.shot.exit_need,
            CoreG2Error::WrongNeed
        );
        let terminal = authenticate_void_terminal(
            &ctx.accounts.exit_need.to_account_info(),
            &ctx.accounts.economy.args.timepin_program,
            &ctx.accounts.ruleset.args.evidence_spec_hash,
            ctx.accounts.shot.exit_target_ts,
        )?;
        let reason = terminal_void_reason(terminal.terminal_kind, false)?;
        ctx.accounts.shot.exit_timepin_result_hash = terminal.result_hash;
        let clock = Clock::get()?;
        refund_void(
            &ctx.accounts.economy,
            &mut ctx.accounts.ledger,
            &mut ctx.accounts.shot,
            reason,
            ctx.accounts.actor.key(),
            &clock,
        )?;
        record_terminal(
            &mut ctx.accounts.player_day,
            &mut ctx.accounts.rank_shard,
            0,
        )?;
        let hash = ctx.accounts.shot.terminal_hash;
        let shot_key = ctx.accounts.shot.key();
        complete_optional_work(
            &ctx.accounts.work_page.to_account_info(),
            &ctx.accounts.shot.economy_hash,
            &ctx.accounts.shot.player,
            ctx.accounts.shot.nonce,
            &shot_key,
            WORK_KIND_RESOLVE_SHOT,
            RECEIPT_PAYABLE,
            ctx.accounts.actor.key(),
            ctx.accounts.shot.resolution_hash,
            clock.slot,
        )?;
        complete_optional_work(
            &ctx.accounts.work_page.to_account_info(),
            &ctx.accounts.shot.economy_hash,
            &ctx.accounts.shot.player,
            ctx.accounts.shot.nonce,
            &shot_key,
            WORK_KIND_FORFEIT,
            RECEIPT_NONPAYABLE,
            Pubkey::default(),
            hash,
            clock.slot,
        )?;
        archive_terminal_shot(
            &mut ctx.accounts.history_page,
            &mut ctx.accounts.shot,
            &ctx.accounts.actor,
            &ctx.accounts.system_program,
        )?;
        emit!(ShotVoided {
            shot: ctx.accounts.shot.key(),
            actor: ctx.accounts.actor.key(),
            reason,
            result_hash: hash,
        });
        Ok(())
    }

    pub fn reveal(ctx: Context<RevealShot>, side: u8, p_bps: u16, salt: [u8; 32]) -> Result<()> {
        authenticate_shot_kernel(
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            &ctx.accounts.ledger,
            &ctx.accounts.shot,
        )?;
        authenticate_shot_score_accounts(
            &ctx.accounts.shot,
            &ctx.accounts.player_day,
            &ctx.accounts.rank_shard,
        )?;
        require!(
            ctx.accounts.shot.state == ShotState::AwaitReveal as u8,
            CoreG2Error::WrongState
        );
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;
        require!(
            now < ctx.accounts.shot.reveal_deadline_ts,
            CoreG2Error::RevealClosed
        );
        let expected = commitment_hash(
            &ctx.accounts.shot.economy_hash,
            &ctx.accounts.shot.ruleset_hash,
            &ctx.accounts.shot.player,
            ctx.accounts.shot.nonce,
            side,
            p_bps,
            &salt,
        );
        require!(
            expected == ctx.accounts.shot.commit,
            CoreG2Error::CommitmentMismatch
        );
        let score = brier_score(side, p_bps, ctx.accounts.shot.outcome_yes == 1)?;
        release_terminal_capacity(
            &ctx.accounts.economy,
            &mut ctx.accounts.ledger,
            &ctx.accounts.shot,
        )?;
        retire_locked_stake(&mut ctx.accounts.ledger, ctx.accounts.shot.stake)?;
        let hit = (side == 1) == (ctx.accounts.shot.outcome_yes == 1);
        ctx.accounts.ledger.shots = ctx
            .accounts
            .ledger
            .shots
            .checked_add(1)
            .ok_or(CoreG2Error::MathOverflow)?;
        ctx.accounts.ledger.brier_sum = ctx
            .accounts
            .ledger
            .brier_sum
            .checked_add(score)
            .ok_or(CoreG2Error::MathOverflow)?;
        let gained = if hit {
            let payout = hit_payout(ctx.accounts.shot.stake, &ctx.accounts.economy)?;
            ctx.accounts.ledger.credits = ctx
                .accounts
                .ledger
                .credits
                .checked_add(payout)
                .ok_or(CoreG2Error::MathOverflow)?;
            ctx.accounts.ledger.payout_credits = ctx
                .accounts
                .ledger
                .payout_credits
                .checked_add(payout)
                .ok_or(CoreG2Error::MathOverflow)?;
            ctx.accounts.ledger.hits = ctx
                .accounts
                .ledger
                .hits
                .checked_add(1)
                .ok_or(CoreG2Error::MathOverflow)?;
            ctx.accounts
                .shot
                .xp_base
                .checked_add(ctx.accounts.economy.args.settle_xp)
                .ok_or(CoreG2Error::MathOverflow)?
        } else {
            ctx.accounts.economy.args.settle_xp
        };
        ctx.accounts.ledger.xp = ctx
            .accounts
            .ledger
            .xp
            .checked_add(gained)
            .ok_or(CoreG2Error::MathOverflow)?;
        ctx.accounts.ledger.earned_xp = ctx
            .accounts
            .ledger
            .earned_xp
            .checked_add(gained)
            .ok_or(CoreG2Error::MathOverflow)?;
        ctx.accounts.shot.state = ShotState::Revealed as u8;
        ctx.accounts.shot.side = side;
        ctx.accounts.shot.p_bps = p_bps;
        ctx.accounts.shot.hit = u8::from(hit);
        ctx.accounts.shot.xp_awarded = gained;
        ctx.accounts.shot.forfeit_worker = Pubkey::default();
        ctx.accounts.shot.revealed_salt = salt;
        ctx.accounts.shot.terminal_slot = clock.slot;
        ctx.accounts.shot.terminal_ts = clock.unix_timestamp;
        ctx.accounts.shot.terminal_hash =
            terminal_hash(&ctx.accounts.shot.key(), &ctx.accounts.shot);
        record_terminal(
            &mut ctx.accounts.player_day,
            &mut ctx.accounts.rank_shard,
            gained,
        )?;
        require_ledger_conservation(&ctx.accounts.ledger)?;
        let shot_key = ctx.accounts.shot.key();
        complete_optional_work(
            &ctx.accounts.work_page.to_account_info(),
            &ctx.accounts.shot.economy_hash,
            &ctx.accounts.shot.player,
            ctx.accounts.shot.nonce,
            &shot_key,
            WORK_KIND_FORFEIT,
            RECEIPT_NONPAYABLE,
            Pubkey::default(),
            ctx.accounts.shot.terminal_hash,
            clock.slot,
        )?;
        archive_terminal_shot(
            &mut ctx.accounts.history_page,
            &mut ctx.accounts.shot,
            &ctx.accounts.player,
            &ctx.accounts.system_program,
        )?;
        emit!(ShotRevealed {
            shot: ctx.accounts.shot.key(),
            player: ctx.accounts.player.key(),
            side,
            p_bps,
            hit: u8::from(hit),
            xp_awarded: gained,
            result_hash: ctx.accounts.shot.terminal_hash,
        });
        Ok(())
    }

    /// Reveal an existing delegated Shot using its frozen delegate signer.
    /// Grant expiry or revocation cannot strand an already committed play.
    pub fn reveal_delegated(
        ctx: Context<RevealDelegatedShot>,
        side: u8,
        p_bps: u16,
        salt: [u8; 32],
    ) -> Result<()> {
        authenticate_shot_kernel(
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            &ctx.accounts.ledger,
            &ctx.accounts.shot,
        )?;
        authenticate_shot_score_accounts(
            &ctx.accounts.shot,
            &ctx.accounts.player_day,
            &ctx.accounts.rank_shard,
        )?;
        require!(
            ctx.accounts.shot.delegate != Pubkey::default()
                && ctx.accounts.shot.rent_refund == ctx.accounts.shot.delegate,
            CoreG2Error::WrongDelegateAuthority
        );
        require_keys_eq!(
            ctx.accounts.delegate.key(),
            ctx.accounts.shot.delegate,
            CoreG2Error::WrongDelegateAuthority
        );
        require!(
            ctx.accounts.shot.state == ShotState::AwaitReveal as u8,
            CoreG2Error::WrongState
        );
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;
        require!(
            now < ctx.accounts.shot.reveal_deadline_ts,
            CoreG2Error::RevealClosed
        );
        let expected = commitment_hash(
            &ctx.accounts.shot.economy_hash,
            &ctx.accounts.shot.ruleset_hash,
            &ctx.accounts.shot.player,
            ctx.accounts.shot.nonce,
            side,
            p_bps,
            &salt,
        );
        require!(
            expected == ctx.accounts.shot.commit,
            CoreG2Error::CommitmentMismatch
        );
        let score = brier_score(side, p_bps, ctx.accounts.shot.outcome_yes == 1)?;
        release_terminal_capacity(
            &ctx.accounts.economy,
            &mut ctx.accounts.ledger,
            &ctx.accounts.shot,
        )?;
        retire_locked_stake(&mut ctx.accounts.ledger, ctx.accounts.shot.stake)?;
        let hit = (side == 1) == (ctx.accounts.shot.outcome_yes == 1);
        ctx.accounts.ledger.shots = ctx
            .accounts
            .ledger
            .shots
            .checked_add(1)
            .ok_or(CoreG2Error::MathOverflow)?;
        ctx.accounts.ledger.brier_sum = ctx
            .accounts
            .ledger
            .brier_sum
            .checked_add(score)
            .ok_or(CoreG2Error::MathOverflow)?;
        let gained = if hit {
            let payout = hit_payout(ctx.accounts.shot.stake, &ctx.accounts.economy)?;
            ctx.accounts.ledger.credits = ctx
                .accounts
                .ledger
                .credits
                .checked_add(payout)
                .ok_or(CoreG2Error::MathOverflow)?;
            ctx.accounts.ledger.payout_credits = ctx
                .accounts
                .ledger
                .payout_credits
                .checked_add(payout)
                .ok_or(CoreG2Error::MathOverflow)?;
            ctx.accounts.ledger.hits = ctx
                .accounts
                .ledger
                .hits
                .checked_add(1)
                .ok_or(CoreG2Error::MathOverflow)?;
            ctx.accounts
                .shot
                .xp_base
                .checked_add(ctx.accounts.economy.args.settle_xp)
                .ok_or(CoreG2Error::MathOverflow)?
        } else {
            ctx.accounts.economy.args.settle_xp
        };
        ctx.accounts.ledger.xp = ctx
            .accounts
            .ledger
            .xp
            .checked_add(gained)
            .ok_or(CoreG2Error::MathOverflow)?;
        ctx.accounts.ledger.earned_xp = ctx
            .accounts
            .ledger
            .earned_xp
            .checked_add(gained)
            .ok_or(CoreG2Error::MathOverflow)?;
        ctx.accounts.shot.state = ShotState::Revealed as u8;
        ctx.accounts.shot.side = side;
        ctx.accounts.shot.p_bps = p_bps;
        ctx.accounts.shot.hit = u8::from(hit);
        ctx.accounts.shot.xp_awarded = gained;
        ctx.accounts.shot.forfeit_worker = Pubkey::default();
        ctx.accounts.shot.revealed_salt = salt;
        ctx.accounts.shot.terminal_slot = clock.slot;
        ctx.accounts.shot.terminal_ts = clock.unix_timestamp;
        ctx.accounts.shot.terminal_hash =
            terminal_hash(&ctx.accounts.shot.key(), &ctx.accounts.shot);
        record_terminal(
            &mut ctx.accounts.player_day,
            &mut ctx.accounts.rank_shard,
            gained,
        )?;
        require_ledger_conservation(&ctx.accounts.ledger)?;
        let shot_key = ctx.accounts.shot.key();
        complete_optional_work(
            &ctx.accounts.work_page.to_account_info(),
            &ctx.accounts.shot.economy_hash,
            &ctx.accounts.shot.player,
            ctx.accounts.shot.nonce,
            &shot_key,
            WORK_KIND_FORFEIT,
            RECEIPT_NONPAYABLE,
            Pubkey::default(),
            ctx.accounts.shot.terminal_hash,
            clock.slot,
        )?;
        archive_terminal_shot(
            &mut ctx.accounts.history_page,
            &mut ctx.accounts.shot,
            &ctx.accounts.delegate,
            &ctx.accounts.system_program,
        )?;
        emit!(ShotRevealed {
            shot: ctx.accounts.shot.key(),
            player: ctx.accounts.shot.player,
            side,
            p_bps,
            hit: u8::from(hit),
            xp_awarded: gained,
            result_hash: ctx.accounts.shot.terminal_hash,
        });
        Ok(())
    }

    pub fn forfeit(ctx: Context<ForfeitShot>) -> Result<()> {
        authenticate_shot_kernel(
            &ctx.accounts.economy,
            &ctx.accounts.ruleset,
            &ctx.accounts.ledger,
            &ctx.accounts.shot,
        )?;
        authenticate_shot_score_accounts(
            &ctx.accounts.shot,
            &ctx.accounts.player_day,
            &ctx.accounts.rank_shard,
        )?;
        require!(
            ctx.accounts.shot.state == ShotState::AwaitReveal as u8,
            CoreG2Error::WrongState
        );
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp >= ctx.accounts.shot.reveal_deadline_ts,
            CoreG2Error::ForfeitNotOpen
        );
        apply_forfeit(
            &ctx.accounts.economy,
            &mut ctx.accounts.ledger,
            &mut ctx.accounts.shot,
            ctx.accounts.actor.key(),
            &clock,
        )?;
        record_terminal(
            &mut ctx.accounts.player_day,
            &mut ctx.accounts.rank_shard,
            0,
        )?;
        require_ledger_conservation(&ctx.accounts.ledger)?;
        let hash = ctx.accounts.shot.terminal_hash;
        let shot_key = ctx.accounts.shot.key();
        complete_optional_work(
            &ctx.accounts.work_page.to_account_info(),
            &ctx.accounts.shot.economy_hash,
            &ctx.accounts.shot.player,
            ctx.accounts.shot.nonce,
            &shot_key,
            WORK_KIND_FORFEIT,
            RECEIPT_PAYABLE,
            ctx.accounts.actor.key(),
            hash,
            clock.slot,
        )?;
        archive_terminal_shot(
            &mut ctx.accounts.history_page,
            &mut ctx.accounts.shot,
            &ctx.accounts.actor,
            &ctx.accounts.system_program,
        )?;
        emit!(ShotForfeited {
            shot: ctx.accounts.shot.key(),
            actor: ctx.accounts.actor.key(),
            result_hash: hash,
        });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(expected_hash: [u8; 32])]
pub struct RegisterEconomy<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    #[account(
        init_if_needed,
        payer = actor,
        space = 8 + Economy::LEN,
        seeds = [ECONOMY_SEED, CORE_SCHEMA_SEED.as_ref(), expected_hash.as_ref()],
        bump,
    )]
    pub economy: Box<Account<'info, Economy>>,
    /// CHECK: key and executable flag are matched to immutable EconomyArgs.
    pub timepin_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(expected_hash: [u8; 32])]
pub struct RegisterRuleset<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    pub economy: Box<Account<'info, Economy>>,
    #[account(
        init_if_needed,
        payer = actor,
        space = 8 + Ruleset::LEN,
        seeds = [RULESET_SEED, CORE_SCHEMA_SEED.as_ref(), expected_hash.as_ref()],
        bump,
    )]
    pub ruleset: Box<Account<'info, Ruleset>>,
    /// CHECK: exact owner, PDA, discriminator, length and policy hash are checked.
    pub evidence_spec: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenLedger<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    pub economy: Box<Account<'info, Economy>>,
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + PlayerLedger::LEN,
        seeds = [LEDGER_SEED, economy.economy_hash.as_ref(), player.key().as_ref()],
        bump,
    )]
    pub ledger: Box<Account<'info, PlayerLedger>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(page_index: u64)]
pub struct OpenHistoryPage<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    pub economy: Box<Account<'info, Economy>>,
    /// CHECK: identity is authenticated through the canonical ledger PDA.
    pub player: UncheckedAccount<'info>,
    #[account(
        seeds = [LEDGER_SEED, economy.economy_hash.as_ref(), player.key().as_ref()],
        bump = ledger.bump,
    )]
    pub ledger: Box<Account<'info, PlayerLedger>>,
    #[account(
        init_if_needed,
        payer = actor,
        space = 8 + HistoryPage::BASE_LEN,
        seeds = [
            HISTORY_PAGE_SEED,
            economy.economy_hash.as_ref(),
            player.key().as_ref(),
            page_index.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub history_page: Box<Account<'info, HistoryPage>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(page_index: u64)]
pub struct OpenReloadPage<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    pub economy: Box<Account<'info, Economy>>,
    /// CHECK: identity is authenticated through the canonical ledger PDA.
    pub player: UncheckedAccount<'info>,
    #[account(
        seeds = [LEDGER_SEED, economy.economy_hash.as_ref(), player.key().as_ref()],
        bump = ledger.bump,
    )]
    pub ledger: Box<Account<'info, PlayerLedger>>,
    #[account(
        init,
        payer = actor,
        space = 8 + ReloadHistoryPage::BASE_LEN,
        seeds = [
            RELOAD_HISTORY_PAGE_SEED,
            economy.economy_hash.as_ref(),
            player.key().as_ref(),
            page_index.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub reload_history_page: Box<Account<'info, ReloadHistoryPage>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(page_index: u64)]
pub struct OpenWorkPage<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    pub economy: Box<Account<'info, Economy>>,
    /// CHECK: identity is authenticated through the canonical ledger PDA.
    pub player: UncheckedAccount<'info>,
    #[account(
        seeds = [LEDGER_SEED, economy.economy_hash.as_ref(), player.key().as_ref()],
        bump = ledger.bump,
    )]
    pub ledger: Box<Account<'info, PlayerLedger>>,
    #[account(
        init_if_needed,
        payer = actor,
        space = 8 + WorkPage::BASE_LEN,
        seeds = [
            WORK_PAGE_SEED,
            economy.economy_hash.as_ref(),
            player.key().as_ref(),
            page_index.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub work_page: Box<Account<'info, WorkPage>>,
    pub system_program: Program<'info, System>,
}

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
#[instruction(_work_kind: u8, _expected_index: u8)]
pub struct ReserveWork<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    pub economy: Box<Account<'info, Economy>>,
    pub ruleset: Box<Account<'info, Ruleset>>,
    #[account(
        seeds = [
            LEDGER_SEED,
            economy.economy_hash.as_ref(),
            shot.player.as_ref(),
        ],
        bump = ledger.bump,
    )]
    pub ledger: Box<Account<'info, PlayerLedger>>,
    #[account(
        seeds = [
            SHOT_SEED,
            shot.economy_hash.as_ref(),
            shot.player.as_ref(),
            shot.nonce.to_le_bytes().as_ref(),
        ],
        bump = shot.bump,
    )]
    pub shot: Box<Account<'info, Shot>>,
    #[account(
        mut,
        seeds = [
            WORK_PAGE_SEED,
            shot.economy_hash.as_ref(),
            shot.player.as_ref(),
            work_page_index(shot.nonce).to_le_bytes().as_ref(),
        ],
        bump = work_page.bump,
    )]
    pub work_page: Box<Account<'info, WorkPage>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct ReloadRcx<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    pub economy: Box<Account<'info, Economy>>,
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + PlayerLedger::LEN,
        seeds = [LEDGER_SEED, economy.economy_hash.as_ref(), player.key().as_ref()],
        bump,
    )]
    pub ledger: Box<Account<'info, PlayerLedger>>,
    pub day_final: Box<Account<'info, DayFinal>>,
    #[account(
        mut,
        seeds = [
            RELOAD_HISTORY_PAGE_SEED,
            economy.economy_hash.as_ref(),
            player.key().as_ref(),
            reload_history_page_index(nonce).to_le_bytes().as_ref(),
        ],
        bump = reload_history_page.bump,
    )]
    pub reload_history_page: Box<Account<'info, ReloadHistoryPage>>,
    #[account(mut, address = RCX_MINT @ CoreG2Error::WrongMint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = player,
        token::token_program = token_program,
    )]
    pub player_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    #[account(address = memo::ID @ CoreG2Error::WrongMemoProgram)]
    pub memo_program: Program<'info, Memo>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(day: i64)]
pub struct FinalizeDay<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    pub economy: Box<Account<'info, Economy>>,
    #[account(
        init,
        payer = actor,
        space = 8 + DayFinal::LEN,
        seeds = [
            DAY_FINAL_SEED,
            economy.economy_hash.as_ref(),
            day.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub day_final: Box<Account<'info, DayFinal>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimLegacy<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    pub economy: Box<Account<'info, Economy>>,
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + PlayerLedger::LEN,
        seeds = [LEDGER_SEED, economy.economy_hash.as_ref(), player.key().as_ref()],
        bump,
    )]
    pub ledger: Box<Account<'info, PlayerLedger>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(grant_id: [u8; 16])]
pub struct GrantDelegate<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    pub economy: Box<Account<'info, Economy>>,
    pub ruleset: Box<Account<'info, Ruleset>>,
    /// CHECK: any nonzero pubkey other than the player may be named; the
    /// grant validator enforces that restriction and no signature is needed.
    pub delegate: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + DelegateGrant::LEN,
        seeds = [
            DELEGATE_GRANT_SEED,
            CORE_SCHEMA_SEED.as_ref(),
            economy.economy_hash.as_ref(),
            ruleset.ruleset_hash.as_ref(),
            player.key().as_ref(),
            delegate.key().as_ref(),
            grant_id.as_ref(),
        ],
        bump,
    )]
    pub delegate_grant: Box<Account<'info, DelegateGrant>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeDelegate<'info> {
    pub economy: Box<Account<'info, Economy>>,
    pub ruleset: Box<Account<'info, Ruleset>>,
    #[account(
        mut,
        seeds = [
            DELEGATE_GRANT_SEED,
            CORE_SCHEMA_SEED.as_ref(),
            delegate_grant.economy_hash.as_ref(),
            delegate_grant.ruleset_hash.as_ref(),
            delegate_grant.player.as_ref(),
            delegate_grant.delegate.as_ref(),
            delegate_grant.grant_id.as_ref(),
        ],
        bump = delegate_grant.bump,
    )]
    pub delegate_grant: Box<Account<'info, DelegateGrant>>,
    #[account(address = delegate_grant.player)]
    pub player: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(
    nonce: u64,
    _commit: [u8; 32],
    _stake: u64,
    _entry_target_ts: i64,
    score_day: i64
)]
pub struct SealForward<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    pub economy: Box<Account<'info, Economy>>,
    pub ruleset: Box<Account<'info, Ruleset>>,
    #[account(
        mut,
        seeds = [LEDGER_SEED, economy.economy_hash.as_ref(), player.key().as_ref()],
        bump = ledger.bump,
    )]
    pub ledger: Box<Account<'info, PlayerLedger>>,
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + PlayerDay::LEN,
        seeds = [
            PLAYER_DAY_SEED,
            economy.economy_hash.as_ref(),
            score_day.to_le_bytes().as_ref(),
            player.key().as_ref(),
        ],
        bump,
    )]
    pub player_day: Box<Account<'info, PlayerDay>>,
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + RankShard::LEN,
        seeds = [
            RANK_SHARD_SEED,
            economy.economy_hash.as_ref(),
            score_day.to_le_bytes().as_ref(),
            rank_shard_for(&player.key()).to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub rank_shard: Box<Account<'info, RankShard>>,
    #[account(
        mut,
        seeds = [
            HISTORY_PAGE_SEED,
            economy.economy_hash.as_ref(),
            player.key().as_ref(),
            history_page_index(nonce).to_le_bytes().as_ref(),
        ],
        bump = history_page.bump,
    )]
    pub history_page: Box<Account<'info, HistoryPage>>,
    #[account(
        init,
        payer = player,
        space = 8 + Shot::LEN,
        seeds = [
            SHOT_SEED,
            economy.economy_hash.as_ref(),
            player.key().as_ref(),
            nonce.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub shot: Box<Account<'info, Shot>>,
    /// CHECK: authenticated as an exact read-only Timepin Need.
    pub entry_need: UncheckedAccount<'info>,
    /// CHECK: authenticated as an exact read-only Timepin Need.
    pub exit_need: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(
    nonce: u64,
    _commit: [u8; 32],
    _stake: u64,
    _entry_target_ts: i64,
    score_day: i64
)]
pub struct SealForwardDelegated<'info> {
    #[account(mut)]
    pub delegate: Signer<'info>,
    pub economy: Box<Account<'info, Economy>>,
    pub ruleset: Box<Account<'info, Ruleset>>,
    #[account(
        mut,
        seeds = [
            DELEGATE_GRANT_SEED,
            CORE_SCHEMA_SEED.as_ref(),
            economy.economy_hash.as_ref(),
            ruleset.ruleset_hash.as_ref(),
            delegate_grant.player.as_ref(),
            delegate.key().as_ref(),
            delegate_grant.grant_id.as_ref(),
        ],
        bump = delegate_grant.bump,
    )]
    pub delegate_grant: Box<Account<'info, DelegateGrant>>,
    #[account(
        mut,
        seeds = [
            LEDGER_SEED,
            economy.economy_hash.as_ref(),
            delegate_grant.player.as_ref(),
        ],
        bump = ledger.bump,
    )]
    pub ledger: Box<Account<'info, PlayerLedger>>,
    #[account(
        init_if_needed,
        payer = delegate,
        space = 8 + PlayerDay::LEN,
        seeds = [
            PLAYER_DAY_SEED,
            economy.economy_hash.as_ref(),
            score_day.to_le_bytes().as_ref(),
            delegate_grant.player.as_ref(),
        ],
        bump,
    )]
    pub player_day: Box<Account<'info, PlayerDay>>,
    #[account(
        init_if_needed,
        payer = delegate,
        space = 8 + RankShard::LEN,
        seeds = [
            RANK_SHARD_SEED,
            economy.economy_hash.as_ref(),
            score_day.to_le_bytes().as_ref(),
            rank_shard_for(&delegate_grant.player).to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub rank_shard: Box<Account<'info, RankShard>>,
    #[account(
        mut,
        seeds = [
            HISTORY_PAGE_SEED,
            economy.economy_hash.as_ref(),
            delegate_grant.player.as_ref(),
            history_page_index(nonce).to_le_bytes().as_ref(),
        ],
        bump = history_page.bump,
    )]
    pub history_page: Box<Account<'info, HistoryPage>>,
    #[account(
        init,
        payer = delegate,
        space = 8 + Shot::LEN,
        seeds = [
            SHOT_SEED,
            economy.economy_hash.as_ref(),
            delegate_grant.player.as_ref(),
            nonce.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub shot: Box<Account<'info, Shot>>,
    /// CHECK: authenticated as an exact read-only Timepin Need.
    pub entry_need: UncheckedAccount<'info>,
    /// CHECK: authenticated as an exact read-only Timepin Need.
    pub exit_need: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(
    nonce: u64,
    _commit: [u8; 32],
    _stake: u64,
    _entry_target_ts: i64,
    _exit_target_ts: i64,
    score_day: i64
)]
pub struct SealObserved<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    pub economy: Box<Account<'info, Economy>>,
    pub ruleset: Box<Account<'info, Ruleset>>,
    #[account(
        mut,
        seeds = [LEDGER_SEED, economy.economy_hash.as_ref(), player.key().as_ref()],
        bump = ledger.bump,
    )]
    pub ledger: Box<Account<'info, PlayerLedger>>,
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + PlayerDay::LEN,
        seeds = [
            PLAYER_DAY_SEED,
            economy.economy_hash.as_ref(),
            score_day.to_le_bytes().as_ref(),
            player.key().as_ref(),
        ],
        bump,
    )]
    pub player_day: Box<Account<'info, PlayerDay>>,
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + RankShard::LEN,
        seeds = [
            RANK_SHARD_SEED,
            economy.economy_hash.as_ref(),
            score_day.to_le_bytes().as_ref(),
            rank_shard_for(&player.key()).to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub rank_shard: Box<Account<'info, RankShard>>,
    #[account(
        mut,
        seeds = [
            HISTORY_PAGE_SEED,
            economy.economy_hash.as_ref(),
            player.key().as_ref(),
            history_page_index(nonce).to_le_bytes().as_ref(),
        ],
        bump = history_page.bump,
    )]
    pub history_page: Box<Account<'info, HistoryPage>>,
    #[account(
        init,
        payer = player,
        space = 8 + Shot::LEN,
        seeds = [
            SHOT_SEED,
            economy.economy_hash.as_ref(),
            player.key().as_ref(),
            nonce.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub shot: Box<Account<'info, Shot>>,
    /// CHECK: exact foreign account checks are performed by the Timepin consumer.
    pub evidence_spec: UncheckedAccount<'info>,
    /// CHECK: exact foreign account checks are performed by the Timepin consumer.
    pub entry_need: UncheckedAccount<'info>,
    /// CHECK: exact foreign account checks are performed by the Timepin consumer.
    pub entry_candidate: UncheckedAccount<'info>,
    /// CHECK: authenticated as an exact read-only Timepin Need.
    pub exit_need: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(
    nonce: u64,
    _commit: [u8; 32],
    _stake: u64,
    _entry_target_ts: i64,
    _exit_target_ts: i64,
    score_day: i64
)]
pub struct SealObservedDelegated<'info> {
    #[account(mut)]
    pub delegate: Signer<'info>,
    pub economy: Box<Account<'info, Economy>>,
    pub ruleset: Box<Account<'info, Ruleset>>,
    #[account(
        mut,
        seeds = [
            DELEGATE_GRANT_SEED,
            CORE_SCHEMA_SEED.as_ref(),
            economy.economy_hash.as_ref(),
            ruleset.ruleset_hash.as_ref(),
            delegate_grant.player.as_ref(),
            delegate.key().as_ref(),
            delegate_grant.grant_id.as_ref(),
        ],
        bump = delegate_grant.bump,
    )]
    pub delegate_grant: Box<Account<'info, DelegateGrant>>,
    #[account(
        mut,
        seeds = [
            LEDGER_SEED,
            economy.economy_hash.as_ref(),
            delegate_grant.player.as_ref(),
        ],
        bump = ledger.bump,
    )]
    pub ledger: Box<Account<'info, PlayerLedger>>,
    #[account(
        init_if_needed,
        payer = delegate,
        space = 8 + PlayerDay::LEN,
        seeds = [
            PLAYER_DAY_SEED,
            economy.economy_hash.as_ref(),
            score_day.to_le_bytes().as_ref(),
            delegate_grant.player.as_ref(),
        ],
        bump,
    )]
    pub player_day: Box<Account<'info, PlayerDay>>,
    #[account(
        init_if_needed,
        payer = delegate,
        space = 8 + RankShard::LEN,
        seeds = [
            RANK_SHARD_SEED,
            economy.economy_hash.as_ref(),
            score_day.to_le_bytes().as_ref(),
            rank_shard_for(&delegate_grant.player).to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub rank_shard: Box<Account<'info, RankShard>>,
    #[account(
        mut,
        seeds = [
            HISTORY_PAGE_SEED,
            economy.economy_hash.as_ref(),
            delegate_grant.player.as_ref(),
            history_page_index(nonce).to_le_bytes().as_ref(),
        ],
        bump = history_page.bump,
    )]
    pub history_page: Box<Account<'info, HistoryPage>>,
    #[account(
        init,
        payer = delegate,
        space = 8 + Shot::LEN,
        seeds = [
            SHOT_SEED,
            economy.economy_hash.as_ref(),
            delegate_grant.player.as_ref(),
            nonce.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub shot: Box<Account<'info, Shot>>,
    /// CHECK: exact foreign account checks are performed by the Timepin consumer.
    pub evidence_spec: UncheckedAccount<'info>,
    /// CHECK: exact foreign account checks are performed by the Timepin consumer.
    pub entry_need: UncheckedAccount<'info>,
    /// CHECK: exact foreign account checks are performed by the Timepin consumer.
    pub entry_candidate: UncheckedAccount<'info>,
    /// CHECK: authenticated as an exact read-only Timepin Need.
    pub exit_need: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ActivateEntry<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    pub economy: Box<Account<'info, Economy>>,
    pub ruleset: Box<Account<'info, Ruleset>>,
    pub ledger: Box<Account<'info, PlayerLedger>>,
    #[account(
        mut,
        seeds = [
            SHOT_SEED,
            shot.economy_hash.as_ref(),
            shot.player.as_ref(),
            shot.nonce.to_le_bytes().as_ref(),
        ],
        bump = shot.bump,
    )]
    pub shot: Box<Account<'info, Shot>>,
    /// CHECK: exact canonical PDA and optional-absence shape are checked before
    /// a bounded scan; an existing page must be writable for atomic completion.
    #[account(mut)]
    pub work_page: UncheckedAccount<'info>,
    /// CHECK: exact foreign account checks are performed by the Timepin consumer.
    pub evidence_spec: UncheckedAccount<'info>,
    /// CHECK: exact foreign account checks are performed by the Timepin consumer.
    pub entry_need: UncheckedAccount<'info>,
    /// CHECK: exact foreign account checks are performed by the Timepin consumer.
    pub entry_candidate: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct VoidPendingEntry<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    pub economy: Box<Account<'info, Economy>>,
    pub ruleset: Box<Account<'info, Ruleset>>,
    #[account(mut)]
    pub ledger: Box<Account<'info, PlayerLedger>>,
    #[account(
        mut,
        close = rent_refund,
        seeds = [
            SHOT_SEED,
            shot.economy_hash.as_ref(),
            shot.player.as_ref(),
            shot.nonce.to_le_bytes().as_ref(),
        ],
        bump = shot.bump,
    )]
    pub shot: Box<Account<'info, Shot>>,
    #[account(
        mut,
        seeds = [
            PLAYER_DAY_SEED,
            shot.economy_hash.as_ref(),
            shot.score_day.to_le_bytes().as_ref(),
            shot.player.as_ref(),
        ],
        bump = player_day.bump,
    )]
    pub player_day: Box<Account<'info, PlayerDay>>,
    #[account(
        mut,
        seeds = [
            RANK_SHARD_SEED,
            shot.economy_hash.as_ref(),
            shot.score_day.to_le_bytes().as_ref(),
            shot.rank_shard.to_le_bytes().as_ref(),
        ],
        bump = rank_shard.bump,
    )]
    pub rank_shard: Box<Account<'info, RankShard>>,
    #[account(
        mut,
        seeds = [
            HISTORY_PAGE_SEED,
            shot.economy_hash.as_ref(),
            shot.player.as_ref(),
            history_page_index(shot.nonce).to_le_bytes().as_ref(),
        ],
        bump = history_page.bump,
    )]
    pub history_page: Box<Account<'info, HistoryPage>>,
    /// CHECK: exact canonical optional WorkPage is authenticated in the handler.
    #[account(mut)]
    pub work_page: UncheckedAccount<'info>,
    /// CHECK: immutable close recipient is frozen into Shot at seal.
    #[account(mut, address = shot.rent_refund)]
    pub rent_refund: UncheckedAccount<'info>,
    /// CHECK: exact foreign account checks are performed by the Timepin consumer.
    pub entry_need: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleFinal<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    pub economy: Box<Account<'info, Economy>>,
    pub ruleset: Box<Account<'info, Ruleset>>,
    #[account(mut)]
    pub ledger: Box<Account<'info, PlayerLedger>>,
    #[account(
        mut,
        seeds = [
            SHOT_SEED,
            shot.economy_hash.as_ref(),
            shot.player.as_ref(),
            shot.nonce.to_le_bytes().as_ref(),
        ],
        bump = shot.bump,
    )]
    pub shot: Box<Account<'info, Shot>>,
    /// CHECK: exact canonical PDA and optional-absence shape are checked before
    /// a bounded scan; an existing page must be writable for atomic completion.
    #[account(mut)]
    pub work_page: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [
            PLAYER_DAY_SEED,
            shot.economy_hash.as_ref(),
            shot.score_day.to_le_bytes().as_ref(),
            shot.player.as_ref(),
        ],
        bump = player_day.bump,
    )]
    pub player_day: Box<Account<'info, PlayerDay>>,
    #[account(
        mut,
        seeds = [
            RANK_SHARD_SEED,
            shot.economy_hash.as_ref(),
            shot.score_day.to_le_bytes().as_ref(),
            shot.rank_shard.to_le_bytes().as_ref(),
        ],
        bump = rank_shard.bump,
    )]
    pub rank_shard: Box<Account<'info, RankShard>>,
    /// CHECK: exact foreign account checks are performed by the Timepin consumer.
    pub evidence_spec: UncheckedAccount<'info>,
    /// CHECK: exact foreign account checks are performed by the Timepin consumer.
    pub exit_need: UncheckedAccount<'info>,
    /// CHECK: exact foreign account checks are performed by the Timepin consumer.
    pub exit_candidate: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct FinalizeResolvedVoid<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    pub economy: Box<Account<'info, Economy>>,
    pub ruleset: Box<Account<'info, Ruleset>>,
    #[account(mut)]
    pub ledger: Box<Account<'info, PlayerLedger>>,
    #[account(
        mut,
        close = rent_refund,
        seeds = [
            SHOT_SEED,
            shot.economy_hash.as_ref(),
            shot.player.as_ref(),
            shot.nonce.to_le_bytes().as_ref(),
        ],
        bump = shot.bump,
    )]
    pub shot: Box<Account<'info, Shot>>,
    #[account(
        mut,
        seeds = [
            PLAYER_DAY_SEED,
            shot.economy_hash.as_ref(),
            shot.score_day.to_le_bytes().as_ref(),
            shot.player.as_ref(),
        ],
        bump = player_day.bump,
    )]
    pub player_day: Box<Account<'info, PlayerDay>>,
    #[account(
        mut,
        seeds = [
            RANK_SHARD_SEED,
            shot.economy_hash.as_ref(),
            shot.score_day.to_le_bytes().as_ref(),
            shot.rank_shard.to_le_bytes().as_ref(),
        ],
        bump = rank_shard.bump,
    )]
    pub rank_shard: Box<Account<'info, RankShard>>,
    #[account(
        mut,
        seeds = [
            HISTORY_PAGE_SEED,
            shot.economy_hash.as_ref(),
            shot.player.as_ref(),
            history_page_index(shot.nonce).to_le_bytes().as_ref(),
        ],
        bump = history_page.bump,
    )]
    pub history_page: Box<Account<'info, HistoryPage>>,
    /// CHECK: exact canonical optional WorkPage is authenticated in the handler.
    #[account(mut)]
    pub work_page: UncheckedAccount<'info>,
    /// CHECK: immutable close recipient is frozen into Shot at seal.
    #[account(mut, address = shot.rent_refund)]
    pub rent_refund: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VoidActiveShot<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    pub economy: Box<Account<'info, Economy>>,
    pub ruleset: Box<Account<'info, Ruleset>>,
    #[account(mut)]
    pub ledger: Box<Account<'info, PlayerLedger>>,
    #[account(
        mut,
        close = rent_refund,
        seeds = [
            SHOT_SEED,
            shot.economy_hash.as_ref(),
            shot.player.as_ref(),
            shot.nonce.to_le_bytes().as_ref(),
        ],
        bump = shot.bump,
    )]
    pub shot: Box<Account<'info, Shot>>,
    #[account(
        mut,
        seeds = [
            PLAYER_DAY_SEED,
            shot.economy_hash.as_ref(),
            shot.score_day.to_le_bytes().as_ref(),
            shot.player.as_ref(),
        ],
        bump = player_day.bump,
    )]
    pub player_day: Box<Account<'info, PlayerDay>>,
    #[account(
        mut,
        seeds = [
            RANK_SHARD_SEED,
            shot.economy_hash.as_ref(),
            shot.score_day.to_le_bytes().as_ref(),
            shot.rank_shard.to_le_bytes().as_ref(),
        ],
        bump = rank_shard.bump,
    )]
    pub rank_shard: Box<Account<'info, RankShard>>,
    #[account(
        mut,
        seeds = [
            HISTORY_PAGE_SEED,
            shot.economy_hash.as_ref(),
            shot.player.as_ref(),
            history_page_index(shot.nonce).to_le_bytes().as_ref(),
        ],
        bump = history_page.bump,
    )]
    pub history_page: Box<Account<'info, HistoryPage>>,
    /// CHECK: exact canonical optional WorkPage is authenticated in the handler.
    #[account(mut)]
    pub work_page: UncheckedAccount<'info>,
    /// CHECK: immutable close recipient is frozen into Shot at seal.
    #[account(mut, address = shot.rent_refund)]
    pub rent_refund: UncheckedAccount<'info>,
    /// CHECK: exact foreign account checks are performed by the Timepin consumer.
    pub exit_need: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevealShot<'info> {
    pub economy: Box<Account<'info, Economy>>,
    pub ruleset: Box<Account<'info, Ruleset>>,
    #[account(mut)]
    pub ledger: Box<Account<'info, PlayerLedger>>,
    #[account(
        mut,
        close = rent_refund,
        seeds = [
            SHOT_SEED,
            shot.economy_hash.as_ref(),
            shot.player.as_ref(),
            shot.nonce.to_le_bytes().as_ref(),
        ],
        bump = shot.bump,
    )]
    pub shot: Box<Account<'info, Shot>>,
    #[account(
        mut,
        seeds = [
            PLAYER_DAY_SEED,
            shot.economy_hash.as_ref(),
            shot.score_day.to_le_bytes().as_ref(),
            shot.player.as_ref(),
        ],
        bump = player_day.bump,
    )]
    pub player_day: Box<Account<'info, PlayerDay>>,
    #[account(
        mut,
        seeds = [
            RANK_SHARD_SEED,
            shot.economy_hash.as_ref(),
            shot.score_day.to_le_bytes().as_ref(),
            shot.rank_shard.to_le_bytes().as_ref(),
        ],
        bump = rank_shard.bump,
    )]
    pub rank_shard: Box<Account<'info, RankShard>>,
    #[account(
        mut,
        seeds = [
            HISTORY_PAGE_SEED,
            shot.economy_hash.as_ref(),
            shot.player.as_ref(),
            history_page_index(shot.nonce).to_le_bytes().as_ref(),
        ],
        bump = history_page.bump,
    )]
    pub history_page: Box<Account<'info, HistoryPage>>,
    /// CHECK: exact canonical optional WorkPage is authenticated in the handler.
    #[account(mut)]
    pub work_page: UncheckedAccount<'info>,
    #[account(mut, address = shot.player)]
    pub player: Signer<'info>,
    /// CHECK: immutable close recipient is frozen into Shot at seal.
    #[account(mut, address = shot.rent_refund)]
    pub rent_refund: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevealDelegatedShot<'info> {
    pub economy: Box<Account<'info, Economy>>,
    pub ruleset: Box<Account<'info, Ruleset>>,
    #[account(mut)]
    pub ledger: Box<Account<'info, PlayerLedger>>,
    #[account(
        mut,
        close = rent_refund,
        seeds = [
            SHOT_SEED,
            shot.economy_hash.as_ref(),
            shot.player.as_ref(),
            shot.nonce.to_le_bytes().as_ref(),
        ],
        bump = shot.bump,
    )]
    pub shot: Box<Account<'info, Shot>>,
    #[account(
        mut,
        seeds = [
            PLAYER_DAY_SEED,
            shot.economy_hash.as_ref(),
            shot.score_day.to_le_bytes().as_ref(),
            shot.player.as_ref(),
        ],
        bump = player_day.bump,
    )]
    pub player_day: Box<Account<'info, PlayerDay>>,
    #[account(
        mut,
        seeds = [
            RANK_SHARD_SEED,
            shot.economy_hash.as_ref(),
            shot.score_day.to_le_bytes().as_ref(),
            shot.rank_shard.to_le_bytes().as_ref(),
        ],
        bump = rank_shard.bump,
    )]
    pub rank_shard: Box<Account<'info, RankShard>>,
    #[account(
        mut,
        seeds = [
            HISTORY_PAGE_SEED,
            shot.economy_hash.as_ref(),
            shot.player.as_ref(),
            history_page_index(shot.nonce).to_le_bytes().as_ref(),
        ],
        bump = history_page.bump,
    )]
    pub history_page: Box<Account<'info, HistoryPage>>,
    /// CHECK: exact canonical optional WorkPage is authenticated in the handler.
    #[account(mut)]
    pub work_page: UncheckedAccount<'info>,
    #[account(mut, address = shot.delegate)]
    pub delegate: Signer<'info>,
    /// CHECK: immutable close recipient is frozen into Shot at seal.
    #[account(mut, address = shot.rent_refund)]
    pub rent_refund: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ForfeitShot<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    pub economy: Box<Account<'info, Economy>>,
    pub ruleset: Box<Account<'info, Ruleset>>,
    #[account(mut)]
    pub ledger: Box<Account<'info, PlayerLedger>>,
    #[account(
        mut,
        close = rent_refund,
        seeds = [
            SHOT_SEED,
            shot.economy_hash.as_ref(),
            shot.player.as_ref(),
            shot.nonce.to_le_bytes().as_ref(),
        ],
        bump = shot.bump,
    )]
    pub shot: Box<Account<'info, Shot>>,
    #[account(
        mut,
        seeds = [
            PLAYER_DAY_SEED,
            shot.economy_hash.as_ref(),
            shot.score_day.to_le_bytes().as_ref(),
            shot.player.as_ref(),
        ],
        bump = player_day.bump,
    )]
    pub player_day: Box<Account<'info, PlayerDay>>,
    #[account(
        mut,
        seeds = [
            RANK_SHARD_SEED,
            shot.economy_hash.as_ref(),
            shot.score_day.to_le_bytes().as_ref(),
            shot.rank_shard.to_le_bytes().as_ref(),
        ],
        bump = rank_shard.bump,
    )]
    pub rank_shard: Box<Account<'info, RankShard>>,
    #[account(
        mut,
        seeds = [
            HISTORY_PAGE_SEED,
            shot.economy_hash.as_ref(),
            shot.player.as_ref(),
            history_page_index(shot.nonce).to_le_bytes().as_ref(),
        ],
        bump = history_page.bump,
    )]
    pub history_page: Box<Account<'info, HistoryPage>>,
    /// CHECK: exact canonical optional WorkPage is authenticated in the handler.
    #[account(mut)]
    pub work_page: UncheckedAccount<'info>,
    /// CHECK: immutable close recipient is frozen into Shot at seal.
    #[account(mut, address = shot.rent_refund)]
    pub rent_refund: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

fn require_exact_len(account: &AccountInfo<'_>, payload_len: usize) -> Result<()> {
    require!(
        account.data_len() == 8 + payload_len,
        CoreG2Error::WrongAccountLength
    );
    Ok(())
}

fn history_account_len(page: &HistoryPage) -> Result<usize> {
    let terminal_count = page.slots.iter().filter(|slot| slot.is_some()).count();
    HistoryPage::serialized_len_for(page.slots.len(), terminal_count)?
        .checked_add(8)
        .ok_or(error!(CoreG2Error::MathOverflow))
}

fn authenticate_history_account(
    page: &Account<'_, HistoryPage>,
    key: Pubkey,
    economy_hash: &[u8; 32],
    player: &Pubkey,
    page_index: u64,
) -> Result<()> {
    authenticate_history_page(page, key, economy_hash, player, page_index)?;
    require!(
        page.to_account_info().data_len() == history_account_len(page)?,
        CoreG2Error::WrongAccountLength
    );
    Ok(())
}

fn reload_history_account_len(page: &ReloadHistoryPage) -> Result<usize> {
    ReloadHistoryPage::serialized_len_for(page.records.len())?
        .checked_add(8)
        .ok_or(error!(CoreG2Error::MathOverflow))
}

fn authenticate_reload_history_account(
    page: &Account<'_, ReloadHistoryPage>,
    key: Pubkey,
    economy_hash: &[u8; 32],
    player: &Pubkey,
    page_index: u64,
) -> Result<()> {
    authenticate_reload_history_page(page, key, economy_hash, player, page_index)?;
    require!(
        page.to_account_info().data_len() == reload_history_account_len(page)?,
        CoreG2Error::WrongAccountLength
    );
    Ok(())
}

fn work_account_len(page: &WorkPage) -> Result<usize> {
    WorkPage::serialized_len_for(page.records.len())?
        .checked_add(8)
        .ok_or(error!(CoreG2Error::MathOverflow))
}

fn authenticate_work_account(
    page: &Account<'_, WorkPage>,
    key: Pubkey,
    economy_hash: &[u8; 32],
    player: &Pubkey,
    page_index: u64,
) -> Result<()> {
    authenticate_work_page(page, key, economy_hash, player, page_index)?;
    require!(
        page.to_account_info().data_len() == work_account_len(page)?,
        CoreG2Error::WrongAccountLength
    );
    Ok(())
}

fn load_optional_work_page(
    account: &AccountInfo<'_>,
    economy_hash: &[u8; 32],
    player: &Pubkey,
    page_index: u64,
) -> Result<Option<WorkPage>> {
    let (expected, _) = work_page_pda(economy_hash, player, page_index);
    require_keys_eq!(account.key(), expected, CoreG2Error::WrongWorkPage);
    require!(account.is_writable, CoreG2Error::ReadonlyWorkPage);
    if is_logically_uninitialized(account) {
        return Ok(None);
    }
    require!(
        !account.executable && *account.owner == crate::ID,
        CoreG2Error::WrongWorkPage
    );
    let data = account
        .try_borrow_data()
        .map_err(|_| error!(CoreG2Error::WrongWorkPage))?;
    let mut bytes: &[u8] = &data;
    let page =
        WorkPage::try_deserialize(&mut bytes).map_err(|_| error!(CoreG2Error::WrongWorkPage))?;
    authenticate_work_page(&page, account.key(), economy_hash, player, page_index)?;
    require!(
        account.data_len() == work_account_len(&page)?,
        CoreG2Error::WrongAccountLength
    );
    drop(data);
    Ok(Some(page))
}

#[allow(clippy::too_many_arguments)]
fn complete_optional_work(
    account: &AccountInfo<'_>,
    economy_hash: &[u8; 32],
    player: &Pubkey,
    nonce: u64,
    subject: &Pubkey,
    work_kind: u8,
    disposition: u8,
    worker: Pubkey,
    action_fact_hash: [u8; 32],
    completed_slot: u64,
) -> Result<()> {
    require!(action_fact_hash != [0; 32], CoreG2Error::BadWorkFact);
    let page_index = work_page_index(nonce);
    let Some(mut page) = load_optional_work_page(account, economy_hash, player, page_index)? else {
        return Ok(());
    };
    let Some(index) = page.lookup_optional_index(subject, work_kind)? else {
        return Ok(());
    };
    let index = u8::try_from(index).map_err(|_| error!(CoreG2Error::MathOverflow))?;
    let result_hash =
        completion_result_hash(subject, work_kind, &action_fact_hash, disposition, &worker);
    page.complete_pending(
        index,
        subject,
        work_kind,
        disposition,
        worker,
        result_hash,
        completed_slot,
    )?;
    let mut data = account
        .try_borrow_mut_data()
        .map_err(|_| error!(CoreG2Error::WrongWorkPage))?;
    let mut destination: &mut [u8] = &mut data;
    page.try_serialize(&mut destination)
        .map_err(|_| error!(CoreG2Error::WrongWorkPage))?;
    require!(destination.is_empty(), CoreG2Error::WrongAccountLength);
    Ok(())
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
                .ok_or(CoreG2Error::MathOverflow)?,
        )?;
    }
    Ok(())
}

fn reserve_history_slot<'info>(
    page: &mut Account<'info, HistoryPage>,
    economy_hash: [u8; 32],
    player: Pubkey,
    nonce: u64,
    payer: &Signer<'info>,
    system_program: &Program<'info, System>,
) -> Result<()> {
    let page_index = history_page_index(nonce);
    authenticate_history_account(page, page.key(), &economy_hash, &player, page_index)?;
    page.append_pending(nonce)?;
    let new_len = history_account_len(page)?;
    fund_rent_growth(payer, &page.to_account_info(), system_program, new_len)?;
    page.to_account_info().resize(new_len)?;
    Ok(())
}

fn deposit_cleanup_bond<'info>(
    payer: &Signer<'info>,
    shot: &Account<'info, Shot>,
    system_program: &Program<'info, System>,
    amount: u64,
) -> Result<()> {
    anchor_lang::system_program::transfer(
        CpiContext::new(
            system_program.key(),
            anchor_lang::system_program::Transfer {
                from: payer.to_account_info(),
                to: shot.to_account_info(),
            },
        ),
        amount,
    )
}

fn archive_terminal_shot<'info>(
    history_page: &mut Account<'info, HistoryPage>,
    shot: &mut Account<'info, Shot>,
    actor: &Signer<'info>,
    system_program: &Program<'info, System>,
) -> Result<()> {
    let shot_key = shot.key();
    let page_index = history_page_index(shot.nonce);
    authenticate_history_account(
        history_page,
        history_page.key(),
        &shot.economy_hash,
        &shot.player,
        page_index,
    )?;
    let slot = history_page.insert_terminal(&shot_key, shot)?;
    let facts = GameResultFacts::from_terminal_shot(shot);
    let result = history_page.slots[slot]
        .as_ref()
        .ok_or(error!(CoreG2Error::BadShotShape))?;
    verify_game_result(&shot.economy_hash, &shot.player, shot.nonce, result, &facts)?;

    let new_len = history_account_len(history_page)?;
    let required = Rent::get()?.minimum_balance(new_len);
    let current = history_page.to_account_info().lamports();
    let shot_balance = shot.to_account_info().lamports();
    let (from_shot, actor_top_up) =
        archive_funding_plan(required, current, shot_balance, shot.cleanup_bond_lamports)?;
    if from_shot > 0 {
        shot.sub_lamports(from_shot)?;
        history_page.add_lamports(from_shot)?;
    }
    if actor_top_up > 0 {
        anchor_lang::system_program::transfer(
            CpiContext::new(
                system_program.key(),
                anchor_lang::system_program::Transfer {
                    from: actor.to_account_info(),
                    to: history_page.to_account_info(),
                },
            ),
            actor_top_up,
        )?;
    }
    history_page.to_account_info().resize(new_len)?;
    shot.sub_lamports(shot.cleanup_bond_lamports)?;
    actor.add_lamports(shot.cleanup_bond_lamports)?;
    Ok(())
}

/// Plans terminal history growth against the current cluster rent rate. The
/// cleanup bond is never consumed by realloc: any remaining shortfall belongs
/// to the permissionless terminal actor.
fn archive_funding_plan(
    required_balance: u64,
    current_balance: u64,
    shot_balance: u64,
    cleanup_bond: u64,
) -> Result<(u64, u64)> {
    require!(
        shot_balance >= cleanup_bond,
        CoreG2Error::CleanupBondMissing
    );
    let shortfall = required_balance.saturating_sub(current_balance);
    let shot_surplus = shot_balance
        .checked_sub(cleanup_bond)
        .ok_or(CoreG2Error::MathOverflow)?;
    let from_shot = shortfall.min(shot_surplus);
    let actor_top_up = shortfall
        .checked_sub(from_shot)
        .ok_or(CoreG2Error::MathOverflow)?;
    Ok((from_shot, actor_top_up))
}

fn canonical_rcx_ata(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), token_2022::ID.as_ref(), RCX_MINT.as_ref()],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    .0
}

// A predictable PDA/ATA can be pre-funded by anybody. Lamports alone must not
// let a dust sender convert an otherwise absent system account into a permanent
// protocol veto. Program ownership and zero data define logical absence.
fn is_logically_uninitialized(account: &AccountInfo<'_>) -> bool {
    account.data_len() == 0
        && *account.owner == anchor_lang::system_program::ID
        && !account.executable
}

fn lowercase_hex_digest(digest: &[u8; 32]) -> [u8; 64] {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = [0u8; 64];
    for (index, byte) in digest.iter().copied().enumerate() {
        encoded[index * 2] = HEX[usize::from(byte >> 4)];
        encoded[index * 2 + 1] = HEX[usize::from(byte & 0x0f)];
    }
    encoded
}

fn authenticate_rcx_mint(mint: &InterfaceAccount<'_, Mint>) -> Result<()> {
    let info = mint.to_account_info();
    require_keys_eq!(*info.owner, token_2022::ID, CoreG2Error::WrongTokenProgram);
    require_keys_eq!(info.key(), RCX_MINT, CoreG2Error::WrongMint);
    require!(
        info.data_len() == RCX_MINT_ACCOUNT_LEN,
        CoreG2Error::WrongMintLayout
    );
    require!(
        mint.is_initialized
            && mint.decimals == RCX_DECIMALS
            && mint.mint_authority.is_none()
            && mint.freeze_authority.is_none(),
        CoreG2Error::WrongMintLayout
    );

    let data = info
        .try_borrow_data()
        .map_err(|_| error!(CoreG2Error::WrongMintLayout))?;
    let state = StateWithExtensions::<SplMint>::unpack(&data)
        .map_err(|_| error!(CoreG2Error::WrongMintLayout))?;
    let extension_types = state
        .get_extension_types()
        .map_err(|_| error!(CoreG2Error::WrongMintLayout))?;
    require!(
        extension_types.len() == 2
            && extension_types.contains(&ExtensionType::MetadataPointer)
            && extension_types.contains(&ExtensionType::TokenMetadata),
        CoreG2Error::WrongMintExtensions
    );
    let pointer = state
        .get_extension::<MetadataPointer>()
        .map_err(|_| error!(CoreG2Error::WrongMintExtensions))?;
    let pointer_authority: Option<Pubkey> = pointer.authority.into();
    let metadata_address: Option<Pubkey> = pointer.metadata_address.into();
    require!(
        pointer_authority.is_none() && metadata_address == Some(RCX_MINT),
        CoreG2Error::WrongMintExtensions
    );
    let metadata = state
        .get_variable_len_extension::<TokenMetadata>()
        .map_err(|_| error!(CoreG2Error::WrongMintExtensions))?;
    let update_authority: Option<Pubkey> = metadata.update_authority.into();
    require!(
        update_authority.is_none()
            && metadata.mint == RCX_MINT
            && metadata.name == "RatchetX"
            && metadata.symbol == "RCX"
            && metadata.uri == RCX_METADATA_URI
            && metadata.additional_metadata.is_empty(),
        CoreG2Error::WrongMintExtensions
    );
    Ok(())
}

fn authenticate_seat_ata(account: &AccountInfo<'_>, seat: &Pubkey) -> Result<()> {
    require!(!account.executable, CoreG2Error::MalformedSeatAccount);
    require!(account.is_writable, CoreG2Error::ReadonlySeatAccount);
    require_keys_eq!(
        *account.owner,
        token_2022::ID,
        CoreG2Error::MalformedSeatAccount
    );
    let data = account
        .try_borrow_data()
        .map_err(|_| error!(CoreG2Error::MalformedSeatAccount))?;
    let state = StateWithExtensions::<SplTokenAccount>::unpack(&data)
        .map_err(|_| error!(CoreG2Error::MalformedSeatAccount))?;
    require_keys_eq!(state.base.mint, RCX_MINT, CoreG2Error::WrongSeatMint);
    require_keys_eq!(state.base.owner, *seat, CoreG2Error::WrongSeatOwner);
    require!(
        state.base.state == AccountState::Initialized,
        CoreG2Error::MalformedSeatAccount
    );
    Ok(())
}

fn load_rank_shard_or_empty(
    account: &AccountInfo<'_>,
    economy_hash: [u8; 32],
    day: i64,
    shard_index: u8,
) -> Result<RankShard> {
    let day_seed = day.to_le_bytes();
    let shard_seed = [shard_index];
    let (expected, bump) = Pubkey::find_program_address(
        &[
            RANK_SHARD_SEED,
            economy_hash.as_ref(),
            day_seed.as_ref(),
            shard_seed.as_ref(),
        ],
        &crate::ID,
    );
    require_keys_eq!(account.key(), expected, CoreG2Error::WrongRankShardPda);
    if is_logically_uninitialized(account) {
        return Ok(RankShard {
            schema: CORE_SCHEMA_VERSION,
            bump,
            economy_hash,
            day,
            shard: shard_index,
            accepted: 0,
            terminal: 0,
            top: [RankEntry::default(); PODIUM_SEAT_COUNT],
        });
    }
    require!(
        !account.executable && *account.owner == crate::ID,
        CoreG2Error::WrongRankShard
    );
    require!(
        account.data_len() == 8 + RankShard::LEN,
        CoreG2Error::WrongAccountLength
    );
    let data = account
        .try_borrow_data()
        .map_err(|_| error!(CoreG2Error::WrongRankShard))?;
    let mut bytes: &[u8] = &data;
    let value =
        RankShard::try_deserialize(&mut bytes).map_err(|_| error!(CoreG2Error::WrongRankShard))?;
    require!(
        value.schema == CORE_SCHEMA_VERSION
            && value.bump == bump
            && value.economy_hash == economy_hash
            && value.day == day
            && value.shard == shard_index,
        CoreG2Error::WrongRankShard
    );
    rank_shard_digest(&value)?;
    Ok(value)
}

fn authenticate_day_final(
    day_final: &Account<'_, DayFinal>,
    economy_hash: [u8; 32],
    day: i64,
) -> Result<()> {
    require_exact_len(&day_final.to_account_info(), DayFinal::LEN)?;
    require!(
        day_final.schema == CORE_SCHEMA_VERSION
            && day_final.economy_hash == economy_hash
            && day_final.day == day
            && day_final.accepted == day_final.terminal
            && day_final.shards_hash != [0; 32]
            && day_final.finalizer != Pubkey::default()
            && day_final.finalized_slot > 0,
        CoreG2Error::WrongDayFinal
    );
    let day_end = day
        .checked_add(1)
        .and_then(|value| value.checked_mul(i64::from(DAY_SECONDS)))
        .ok_or(CoreG2Error::TimestampOverflow)?;
    require!(
        day_final.finalized_ts >= day_end,
        CoreG2Error::WrongDayFinal
    );
    let day_seed = day.to_le_bytes();
    let (expected, bump) = Pubkey::find_program_address(
        &[DAY_FINAL_SEED, economy_hash.as_ref(), day_seed.as_ref()],
        &crate::ID,
    );
    require_keys_eq!(day_final.key(), expected, CoreG2Error::WrongDayFinalPda);
    require!(day_final.bump == bump, CoreG2Error::WrongBump);

    let mut previous: Option<RankEntry> = None;
    let mut seen_empty = false;
    for entry in day_final.top {
        if entry.wallet == Pubkey::default() {
            require!(entry.xp == 0, CoreG2Error::WrongDayFinal);
            seen_empty = true;
            continue;
        }
        require!(!seen_empty && entry.xp > 0, CoreG2Error::WrongDayFinal);
        if let Some(prior) = previous {
            require!(
                prior.wallet != entry.wallet && rank_entry_precedes(&prior, &entry),
                CoreG2Error::WrongDayFinal
            );
        }
        previous = Some(entry);
    }
    require!(
        day_final.final_hash
            == day_final_hash(
                &economy_hash,
                day,
                day_final.accepted,
                day_final.terminal,
                &day_final.top,
                &day_final.shards_hash,
            ),
        CoreG2Error::WrongDayFinalHash
    );
    Ok(())
}

fn fixed_reveal_deadline(
    exit_target_ts: i64,
    source_deadline_ts: i64,
    capture_deadline_ts: i64,
    reveal_window_seconds: u32,
) -> Result<i64> {
    require!(
        exit_target_ts >= 0
            && source_deadline_ts >= exit_target_ts
            && capture_deadline_ts >= source_deadline_ts,
        CoreG2Error::BadTimepinDeadline
    );
    let reveal_deadline_ts = capture_deadline_ts
        .checked_add(i64::from(reveal_window_seconds))
        .ok_or(CoreG2Error::TimestampOverflow)?;
    require!(
        reveal_deadline_ts > capture_deadline_ts,
        CoreG2Error::BadTimepinDeadline
    );
    Ok(reveal_deadline_ts)
}

fn initialize_or_authenticate_player_day(
    player_day: &mut Account<'_, PlayerDay>,
    bump: u8,
    economy_hash: [u8; 32],
    day: i64,
    player: Pubkey,
    rank_shard: u8,
) -> Result<()> {
    require_exact_len(&player_day.to_account_info(), PlayerDay::LEN)?;
    if player_day.schema == 0 {
        player_day.set_inner(PlayerDay {
            schema: CORE_SCHEMA_VERSION,
            bump,
            economy_hash,
            day,
            player,
            rank_shard,
            accepted: 0,
            terminal: 0,
            xp: 0,
        });
    }
    authenticate_player_day(player_day, economy_hash, day, player, rank_shard)
}

fn authenticate_player_day(
    player_day: &Account<'_, PlayerDay>,
    economy_hash: [u8; 32],
    day: i64,
    player: Pubkey,
    rank_shard: u8,
) -> Result<()> {
    require_exact_len(&player_day.to_account_info(), PlayerDay::LEN)?;
    require!(
        player_day.schema == CORE_SCHEMA_VERSION
            && player_day.economy_hash == economy_hash
            && player_day.day == day
            && player_day.player == player
            && player_day.rank_shard == rank_shard
            && rank_shard == rank_shard_for(&player)
            && player_day.terminal <= player_day.accepted,
        CoreG2Error::WrongPlayerDay
    );
    let day_seed = day.to_le_bytes();
    let (expected, bump) = Pubkey::find_program_address(
        &[
            PLAYER_DAY_SEED,
            economy_hash.as_ref(),
            day_seed.as_ref(),
            player.as_ref(),
        ],
        &crate::ID,
    );
    require_keys_eq!(player_day.key(), expected, CoreG2Error::WrongPlayerDayPda);
    require!(player_day.bump == bump, CoreG2Error::WrongBump);
    Ok(())
}

fn initialize_or_authenticate_rank_shard(
    rank_shard: &mut Account<'_, RankShard>,
    bump: u8,
    economy_hash: [u8; 32],
    day: i64,
    shard: u8,
) -> Result<()> {
    require_exact_len(&rank_shard.to_account_info(), RankShard::LEN)?;
    if rank_shard.schema == 0 {
        rank_shard.set_inner(RankShard {
            schema: CORE_SCHEMA_VERSION,
            bump,
            economy_hash,
            day,
            shard,
            accepted: 0,
            terminal: 0,
            top: [RankEntry::default(); PODIUM_SEAT_COUNT],
        });
    }
    authenticate_rank_shard(rank_shard, economy_hash, day, shard)
}

fn authenticate_rank_shard(
    rank_shard: &Account<'_, RankShard>,
    economy_hash: [u8; 32],
    day: i64,
    shard: u8,
) -> Result<()> {
    require_exact_len(&rank_shard.to_account_info(), RankShard::LEN)?;
    require!(
        rank_shard.schema == CORE_SCHEMA_VERSION
            && rank_shard.economy_hash == economy_hash
            && rank_shard.day == day
            && rank_shard.shard == shard
            && shard < RANK_SHARD_COUNT,
        CoreG2Error::WrongRankShard
    );
    let day_seed = day.to_le_bytes();
    let shard_seed = [shard];
    let (expected, bump) = Pubkey::find_program_address(
        &[
            RANK_SHARD_SEED,
            economy_hash.as_ref(),
            day_seed.as_ref(),
            shard_seed.as_ref(),
        ],
        &crate::ID,
    );
    require_keys_eq!(rank_shard.key(), expected, CoreG2Error::WrongRankShardPda);
    require!(rank_shard.bump == bump, CoreG2Error::WrongBump);
    rank_shard_digest(rank_shard)?;
    Ok(())
}

fn authenticate_score_accounts(
    player_day: &Account<'_, PlayerDay>,
    rank_shard: &Account<'_, RankShard>,
) -> Result<()> {
    require!(
        player_day.economy_hash == rank_shard.economy_hash
            && player_day.day == rank_shard.day
            && player_day.rank_shard == rank_shard.shard,
        CoreG2Error::WrongScoreAccounts
    );
    authenticate_player_day(
        player_day,
        player_day.economy_hash,
        player_day.day,
        player_day.player,
        player_day.rank_shard,
    )?;
    authenticate_rank_shard(
        rank_shard,
        rank_shard.economy_hash,
        rank_shard.day,
        rank_shard.shard,
    )
}

fn authenticate_shot_score_accounts(
    shot: &Account<'_, Shot>,
    player_day: &Account<'_, PlayerDay>,
    rank_shard: &Account<'_, RankShard>,
) -> Result<()> {
    require!(
        shot.economy_hash == player_day.economy_hash
            && shot.score_day == player_day.day
            && shot.player == player_day.player
            && shot.rank_shard == player_day.rank_shard
            && shot.economy_hash == rank_shard.economy_hash
            && shot.score_day == rank_shard.day
            && shot.rank_shard == rank_shard.shard,
        CoreG2Error::WrongScoreAccounts
    );
    authenticate_score_accounts(player_day, rank_shard)
}

fn record_accepted(
    player_day: &mut Account<'_, PlayerDay>,
    rank_shard: &mut Account<'_, RankShard>,
) -> Result<()> {
    authenticate_score_accounts(player_day, rank_shard)?;
    player_day.accepted = player_day
        .accepted
        .checked_add(1)
        .ok_or(CoreG2Error::MathOverflow)?;
    rank_shard.accepted = rank_shard
        .accepted
        .checked_add(1)
        .ok_or(CoreG2Error::MathOverflow)?;
    authenticate_score_accounts(player_day, rank_shard)
}

fn record_terminal(
    player_day: &mut Account<'_, PlayerDay>,
    rank_shard: &mut Account<'_, RankShard>,
    gained_xp: u64,
) -> Result<()> {
    authenticate_score_accounts(player_day, rank_shard)?;
    require!(
        player_day.terminal < player_day.accepted && rank_shard.terminal < rank_shard.accepted,
        CoreG2Error::ScoreCounterUnderflow
    );
    let next_player_terminal = player_day
        .terminal
        .checked_add(1)
        .ok_or(CoreG2Error::MathOverflow)?;
    let next_shard_terminal = rank_shard
        .terminal
        .checked_add(1)
        .ok_or(CoreG2Error::MathOverflow)?;
    let next_xp = player_day
        .xp
        .checked_add(gained_xp)
        .ok_or(CoreG2Error::MathOverflow)?;
    if next_xp > 0 {
        upsert_local_top3(
            &mut rank_shard.top,
            RankEntry {
                wallet: player_day.player,
                xp: next_xp,
            },
        )?;
    }
    player_day.terminal = next_player_terminal;
    player_day.xp = next_xp;
    rank_shard.terminal = next_shard_terminal;
    authenticate_score_accounts(player_day, rank_shard)
}

fn initialize_or_authenticate_ledger(
    ledger: &mut Account<'_, PlayerLedger>,
    bump: u8,
    economy_hash: [u8; 32],
    player: Pubkey,
) -> Result<()> {
    require_exact_len(&ledger.to_account_info(), PlayerLedger::LEN)?;
    if ledger.schema == 0 {
        let mut value = PlayerLedger::default();
        value.initialize(bump, economy_hash, player);
        ledger.set_inner(value);
    }
    authenticate_ledger(ledger, economy_hash, player)
}

fn authenticate_ledger(
    ledger: &Account<'_, PlayerLedger>,
    economy_hash: [u8; 32],
    player: Pubkey,
) -> Result<()> {
    require_exact_len(&ledger.to_account_info(), PlayerLedger::LEN)?;
    require!(
        ledger.schema == CORE_SCHEMA_VERSION,
        CoreG2Error::WrongLedger
    );
    require!(
        ledger.economy_hash == economy_hash,
        CoreG2Error::WrongLedger
    );
    require_keys_eq!(ledger.player, player, CoreG2Error::WrongLedger);
    let (expected, bump) = Pubkey::find_program_address(
        &[LEDGER_SEED, economy_hash.as_ref(), player.as_ref()],
        &crate::ID,
    );
    require_keys_eq!(ledger.key(), expected, CoreG2Error::WrongLedgerPda);
    require!(ledger.bump == bump, CoreG2Error::WrongBump);
    require!(
        ledger.sealed == ledger.next_shot_nonce,
        CoreG2Error::WrongShotNonce
    );
    require_ledger_conservation(ledger)?;
    Ok(())
}

fn authenticate_kernel(
    economy: &Account<'_, Economy>,
    ruleset: &Account<'_, Ruleset>,
    ledger: &Account<'_, PlayerLedger>,
    player: Pubkey,
) -> Result<()> {
    require_exact_len(&economy.to_account_info(), Economy::LEN)?;
    require_exact_len(&ruleset.to_account_info(), Ruleset::LEN)?;
    authenticate_economy(economy, economy.key())?;
    authenticate_ruleset(ruleset, economy, ruleset.key())?;
    authenticate_ledger(ledger, economy.economy_hash, player)?;
    require!(
        ledger.open <= economy.args.max_open,
        CoreG2Error::TooManyOpen
    );
    Ok(())
}

fn authenticate_shot_kernel(
    economy: &Account<'_, Economy>,
    ruleset: &Account<'_, Ruleset>,
    ledger: &Account<'_, PlayerLedger>,
    shot: &Account<'_, Shot>,
) -> Result<()> {
    authenticate_kernel(economy, ruleset, ledger, shot.player)?;
    require_exact_len(&shot.to_account_info(), Shot::LEN)?;
    require!(shot.schema == CORE_SCHEMA_VERSION, CoreG2Error::WrongShot);
    require!(
        shot.economy_hash == economy.economy_hash,
        CoreG2Error::WrongShot
    );
    require!(
        shot.ruleset_hash == ruleset.ruleset_hash,
        CoreG2Error::WrongShot
    );
    require!(
        shot.entry_mode == ruleset.args.entry_mode,
        CoreG2Error::WrongShot
    );
    require!(shot.commit != [0; 32], CoreG2Error::WrongShot);
    require!(
        shot.stake >= economy.args.min_stake && shot.stake <= economy.args.max_stake,
        CoreG2Error::WrongShot
    );
    let (expected, bump) = Pubkey::find_program_address(
        &[
            SHOT_SEED,
            shot.economy_hash.as_ref(),
            shot.player.as_ref(),
            &shot.nonce.to_le_bytes(),
        ],
        &crate::ID,
    );
    require_keys_eq!(shot.key(), expected, CoreG2Error::WrongShotPda);
    require!(shot.bump == bump, CoreG2Error::WrongBump);
    require!(
        shot.entry_need != Pubkey::default()
            && shot.exit_need != Pubkey::default()
            && shot.entry_need != shot.exit_need,
        CoreG2Error::BadShotShape
    );
    let grid = i64::from(ruleset.args.target_grid_seconds);
    require!(
        shot.entry_target_ts >= 0
            && shot.exit_target_ts > shot.entry_target_ts
            && shot.entry_target_ts % grid == 0
            && shot.exit_target_ts % grid == 0,
        CoreG2Error::BadShotShape
    );
    require!(
        shot.nonce < ledger.next_shot_nonce
            && shot.rank_shard == rank_shard_for(&shot.player)
            && shot.reveal_deadline_ts > shot.exit_target_ts
            && shot.score_day == utc_day(shot.reveal_deadline_ts),
        CoreG2Error::BadShotShape
    );
    match shot.state {
        value if value == ShotState::PendingEntry as u8 => {
            require!(shot.entry_mode == ENTRY_FORWARD, CoreG2Error::BadShotShape);
            require!(
                shot.entry_message_hash == [0; 32]
                    && shot.exit_message_hash == [0; 32]
                    && shot.resolution_hash == [0; 32]
                    && shot.terminal_hash == [0; 32],
                CoreG2Error::BadShotShape
            );
            require!(
                ledger.open > 0 && ledger.locked_credits >= shot.stake,
                CoreG2Error::BadShotShape
            );
        }
        value if value == ShotState::Active as u8 => {
            require!(
                shot.entry_message_hash != [0; 32]
                    && shot.exit_message_hash == [0; 32]
                    && shot.resolution_hash == [0; 32]
                    && shot.terminal_hash == [0; 32],
                CoreG2Error::BadShotShape
            );
            require!(
                ledger.open > 0 && ledger.locked_credits >= shot.stake,
                CoreG2Error::BadShotShape
            );
        }
        value if value == ShotState::AwaitReveal as u8 => {
            require!(
                shot.entry_message_hash != [0; 32]
                    && shot.exit_message_hash != [0; 32]
                    && shot.resolution_hash != [0; 32]
                    && shot.terminal_hash == [0; 32]
                    && shot.outcome_yes <= 1
                    && shot.settled_ts > 0,
                CoreG2Error::BadShotShape
            );
            require!(
                shot.resolution_hash == resolution_hash(&shot.key(), shot),
                CoreG2Error::BadShotShape
            );
            require!(
                ledger.open > 0 && ledger.locked_credits >= shot.stake,
                CoreG2Error::BadShotShape
            );
        }
        value if value == ShotState::AwaitVoid as u8 => {
            require!(
                shot.entry_message_hash != [0; 32]
                    && shot.exit_message_hash != [0; 32]
                    && shot.resolution_hash != [0; 32]
                    && shot.terminal_hash == [0; 32]
                    && (shot.void_reason == VoidReason::Equality as u8
                        || shot.void_reason == VoidReason::ConfidenceBand as u8)
                    && shot.outcome_yes == 0
                    && shot.resolver != Pubkey::default()
                    && shot.resolution_slot > 0
                    && shot.settled_ts > 0,
                CoreG2Error::BadShotShape
            );
            require!(
                shot.resolution_hash == resolution_hash(&shot.key(), shot),
                CoreG2Error::BadShotShape
            );
            require!(
                ledger.open > 0 && ledger.locked_credits >= shot.stake,
                CoreG2Error::BadShotShape
            );
        }
        value
            if value == ShotState::Revealed as u8
                || value == ShotState::Voided as u8
                || value == ShotState::Forfeited as u8 =>
        {
            require!(
                shot.resolution_hash != [0; 32]
                    && shot.terminal_hash != [0; 32]
                    && shot.resolution_hash == resolution_hash(&shot.key(), shot)
                    && shot.terminal_hash == terminal_hash(&shot.key(), shot),
                CoreG2Error::BadShotShape
            );
        }
        _ => return err!(CoreG2Error::WrongState),
    }
    Ok(())
}

fn require_spec_ruleset_match(spec: &EvidenceSpecV2View, rules: &RulesetArgs) -> Result<()> {
    require!(
        spec.evidence_policy_hash == rules.evidence_policy_hash && spec.feed_id == rules.feed_id,
        CoreG2Error::RulesetSpecMismatch
    );
    require!(
        spec.target_grid_seconds == rules.target_grid_seconds
            && spec.min_open_lead_seconds == rules.min_open_lead_seconds
            && spec.required_verification == 1
            && spec.min_exponent >= CORE_MIN_EXPONENT
            && spec.max_exponent <= CORE_MAX_EXPONENT,
        CoreG2Error::RulesetSpecMismatch
    );
    let extra_lead = if rules.entry_mode == ENTRY_FORWARD {
        rules.min_open_lead_seconds
    } else {
        0
    };
    let required_ahead = rules
        .horizon_seconds
        .checked_add(rules.target_grid_seconds.saturating_sub(1))
        .and_then(|value| value.checked_add(extra_lead))
        .ok_or(CoreG2Error::MathOverflow)?;
    require!(
        spec.max_target_ahead_seconds >= required_ahead,
        CoreG2Error::RulesetSpecMismatch
    );
    Ok(())
}

fn debit_seal(
    economy: &Account<'_, Economy>,
    ruleset: &Account<'_, Ruleset>,
    ledger: &mut Account<'_, PlayerLedger>,
    stake: u64,
    nonce: u64,
) -> Result<()> {
    require!(
        ruleset.args.economy_hash == economy.economy_hash,
        CoreG2Error::WrongRuleset
    );
    require!(
        stake >= economy.args.min_stake && stake <= economy.args.max_stake,
        CoreG2Error::StakeOutOfBounds
    );
    require!(
        ledger.open < economy.args.max_open,
        CoreG2Error::TooManyOpen
    );
    require!(nonce == ledger.next_shot_nonce, CoreG2Error::WrongShotNonce);
    let xp_base = seal_xp(ruleset.args.base_xp, stake);
    let payout_reserve = hit_payout(stake, economy)?;
    let xp_reserve = terminal_xp_reserve(xp_base, economy.args.settle_xp)?;
    ledger.reserved_payout_credits = ledger
        .reserved_payout_credits
        .checked_add(payout_reserve)
        .ok_or(CoreG2Error::MathOverflow)?;
    ledger.reserved_xp = ledger
        .reserved_xp
        .checked_add(xp_reserve)
        .ok_or(CoreG2Error::MathOverflow)?;
    ledger.credits = ledger
        .credits
        .checked_sub(stake)
        .ok_or(CoreG2Error::InsufficientCredits)?;
    ledger.locked_credits = ledger
        .locked_credits
        .checked_add(stake)
        .ok_or(CoreG2Error::MathOverflow)?;
    ledger.sealed = ledger
        .sealed
        .checked_add(1)
        .ok_or(CoreG2Error::MathOverflow)?;
    ledger.next_shot_nonce = nonce.checked_add(1).ok_or(CoreG2Error::MathOverflow)?;
    ledger.open = ledger
        .open
        .checked_add(1)
        .ok_or(CoreG2Error::MathOverflow)?;
    require_ledger_conservation(ledger)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn write_shot(
    shot: &mut Account<'_, Shot>,
    bump: u8,
    economy: &Account<'_, Economy>,
    ruleset: &Account<'_, Ruleset>,
    player: Pubkey,
    rent_refund: Pubkey,
    delegate: Pubkey,
    nonce: u64,
    commit: [u8; 32],
    stake: u64,
    sealed_ts: i64,
    state: u8,
    entry_target_ts: i64,
    exit_target_ts: i64,
    score_day: i64,
    rank_shard: u8,
    reveal_deadline_ts: i64,
    entry_need: Pubkey,
    exit_need: Pubkey,
) {
    let mut value = Shot::default();
    value.schema = CORE_SCHEMA_VERSION;
    value.bump = bump;
    value.economy_hash = economy.economy_hash;
    value.ruleset_hash = ruleset.ruleset_hash;
    value.player = player;
    value.rent_refund = rent_refund;
    value.delegate = delegate;
    value.nonce = nonce;
    value.commit = commit;
    value.entry_mode = ruleset.args.entry_mode;
    value.state = state;
    value.void_reason = VoidReason::None as u8;
    value.stake = stake;
    value.cleanup_bond_lamports = economy.args.cleanup_bond_lamports;
    value.xp_base = seal_xp(ruleset.args.base_xp, stake);
    value.sealed_ts = sealed_ts;
    value.entry_target_ts = entry_target_ts;
    value.exit_target_ts = exit_target_ts;
    value.score_day = score_day;
    value.rank_shard = rank_shard;
    value.reveal_deadline_ts = reveal_deadline_ts;
    value.entry_need = entry_need;
    value.exit_need = exit_need;
    shot.set_inner(value);
}

fn write_entry(shot: &mut Account<'_, Shot>, record: &EvidenceRecordV2View) {
    shot.entry_message_hash = record.message_hash;
    shot.entry_price = record.price;
    shot.entry_conf = record.conf;
    shot.entry_exponent = record.exponent;
    shot.entry_publish_time = record.publish_time;
}

fn write_exit(shot: &mut Account<'_, Shot>, record: &EvidenceRecordV2View) {
    shot.exit_message_hash = record.message_hash;
    shot.exit_price = record.price;
    shot.exit_conf = record.conf;
    shot.exit_exponent = record.exponent;
    shot.exit_publish_time = record.publish_time;
}

fn terminal_void_reason(terminal_kind: u8, entry: bool) -> Result<u8> {
    match (terminal_kind, entry) {
        (NEED_EXPIRED, true) => Ok(VoidReason::EntryExpired as u8),
        (NEED_AMBIGUOUS, true) => Ok(VoidReason::EntryAmbiguous as u8),
        (NEED_EXPIRED, false) => Ok(VoidReason::ExitExpired as u8),
        (NEED_AMBIGUOUS, false) => Ok(VoidReason::ExitAmbiguous as u8),
        _ => err!(CoreG2Error::WrongState),
    }
}

fn refund_void(
    economy: &Account<'_, Economy>,
    ledger: &mut Account<'_, PlayerLedger>,
    shot: &mut Account<'_, Shot>,
    reason: u8,
    resolver: Pubkey,
    clock: &Clock,
) -> Result<()> {
    let shot_key = shot.key();
    shot.void_reason = reason;
    shot.outcome_yes = 0;
    shot.settled_ts = clock.unix_timestamp;
    shot.resolution_slot = clock.slot;
    shot.resolver = resolver;
    shot.resolution_hash = resolution_hash(&shot_key, shot);
    finalize_void_accounting(economy, ledger, shot, clock)
}

fn finalize_void_accounting(
    economy: &Account<'_, Economy>,
    ledger: &mut Account<'_, PlayerLedger>,
    shot: &mut Account<'_, Shot>,
    clock: &Clock,
) -> Result<()> {
    let shot_key = shot.key();
    release_terminal_capacity(economy, ledger, shot)?;
    ledger.locked_credits = ledger
        .locked_credits
        .checked_sub(shot.stake)
        .ok_or(CoreG2Error::LockedCreditsUnderflow)?;
    ledger.credits = ledger
        .credits
        .checked_add(shot.stake)
        .ok_or(CoreG2Error::MathOverflow)?;
    ledger.refunded_credits = ledger
        .refunded_credits
        .checked_add(shot.stake)
        .ok_or(CoreG2Error::MathOverflow)?;
    ledger.open = ledger
        .open
        .checked_sub(1)
        .ok_or(CoreG2Error::OpenCounterUnderflow)?;
    ledger.voids = ledger
        .voids
        .checked_add(1)
        .ok_or(CoreG2Error::MathOverflow)?;
    shot.state = ShotState::Voided as u8;
    shot.side = 0;
    shot.p_bps = 0;
    shot.hit = 0;
    shot.xp_awarded = 0;
    shot.forfeit_worker = Pubkey::default();
    shot.revealed_salt = [0; 32];
    shot.terminal_slot = clock.slot;
    shot.terminal_ts = clock.unix_timestamp;
    shot.terminal_hash = terminal_hash(&shot_key, shot);
    require_ledger_conservation(ledger)?;
    Ok(())
}

fn apply_forfeit(
    economy: &Account<'_, Economy>,
    ledger: &mut Account<'_, PlayerLedger>,
    shot: &mut Account<'_, Shot>,
    worker: Pubkey,
    clock: &Clock,
) -> Result<()> {
    release_terminal_capacity(economy, ledger, shot)?;
    retire_locked_stake(ledger, shot.stake)?;
    ledger.shots = ledger
        .shots
        .checked_add(1)
        .ok_or(CoreG2Error::MathOverflow)?;
    ledger.forfeits = ledger
        .forfeits
        .checked_add(1)
        .ok_or(CoreG2Error::MathOverflow)?;
    ledger.brier_sum = ledger
        .brier_sum
        .checked_add(BRIER_SCALE)
        .ok_or(CoreG2Error::MathOverflow)?;
    shot.state = ShotState::Forfeited as u8;
    shot.side = 0;
    shot.p_bps = 0;
    shot.hit = 0;
    shot.xp_awarded = 0;
    shot.forfeit_worker = worker;
    shot.revealed_salt = [0; 32];
    shot.terminal_slot = clock.slot;
    shot.terminal_ts = clock.unix_timestamp;
    shot.terminal_hash = terminal_hash(&shot.key(), shot);
    require_ledger_conservation(ledger)?;
    Ok(())
}

fn release_terminal_capacity(
    economy: &Account<'_, Economy>,
    ledger: &mut Account<'_, PlayerLedger>,
    shot: &Account<'_, Shot>,
) -> Result<()> {
    let payout_reserve = hit_payout(shot.stake, economy)?;
    let xp_reserve = terminal_xp_reserve(shot.xp_base, economy.args.settle_xp)?;
    ledger.reserved_payout_credits = ledger
        .reserved_payout_credits
        .checked_sub(payout_reserve)
        .ok_or(CoreG2Error::TerminalReserveUnderflow)?;
    ledger.reserved_xp = ledger
        .reserved_xp
        .checked_sub(xp_reserve)
        .ok_or(CoreG2Error::TerminalReserveUnderflow)?;
    require_ledger_conservation(ledger)?;
    Ok(())
}

fn retire_locked_stake(ledger: &mut Account<'_, PlayerLedger>, stake: u64) -> Result<()> {
    ledger.locked_credits = ledger
        .locked_credits
        .checked_sub(stake)
        .ok_or(CoreG2Error::LockedCreditsUnderflow)?;
    ledger.retired_credits = ledger
        .retired_credits
        .checked_add(stake)
        .ok_or(CoreG2Error::MathOverflow)?;
    ledger.open = ledger
        .open
        .checked_sub(1)
        .ok_or(CoreG2Error::OpenCounterUnderflow)?;
    Ok(())
}

#[event]
pub struct LedgerOpened {
    pub economy_hash: [u8; 32],
    pub player: Pubkey,
    pub ledger: Pubkey,
}

#[event]
pub struct RcxReloaded {
    pub economy_hash: [u8; 32],
    pub player: Pubkey,
    pub nonce: u64,
    pub gross: u64,
    pub consumed: u64,
    pub raw_burned: u64,
    pub raw_routed: u64,
    pub raw_retained: u64,
    pub credits: u64,
    pub day: i64,
    pub day_final_hash: [u8; 32],
}

#[event]
pub struct LegacyClaimed {
    pub economy_hash: [u8; 32],
    pub player: Pubkey,
    pub credits: u64,
    pub xp: u64,
    pub leaf: [u8; 32],
    pub snapshot_hash: [u8; 32],
    pub cutover_slot: u64,
}

#[event]
pub struct ShotSealed {
    pub shot: Pubkey,
    pub player: Pubkey,
    pub economy_hash: [u8; 32],
    pub ruleset_hash: [u8; 32],
    pub nonce: u64,
    pub stake: u64,
    pub entry_mode: u8,
    pub entry_target_ts: i64,
    pub exit_target_ts: i64,
    pub score_day: i64,
    pub reveal_deadline_ts: i64,
}

#[event]
pub struct EntryActivated {
    pub shot: Pubkey,
    pub actor: Pubkey,
    pub entry_message_hash: [u8; 32],
}

#[event]
pub struct ShotVoided {
    pub shot: Pubkey,
    pub actor: Pubkey,
    pub reason: u8,
    pub result_hash: [u8; 32],
}

#[event]
pub struct ShotResolved {
    pub shot: Pubkey,
    pub actor: Pubkey,
    pub state: u8,
    pub outcome_yes: u8,
    pub result_hash: [u8; 32],
}

#[event]
pub struct ShotRevealed {
    pub shot: Pubkey,
    pub player: Pubkey,
    pub side: u8,
    pub p_bps: u16,
    pub hit: u8,
    pub xp_awarded: u64,
    pub result_hash: [u8; 32],
}

#[event]
pub struct ShotForfeited {
    pub shot: Pubkey,
    pub actor: Pubkey,
    pub result_hash: [u8; 32],
}

#[error_code]
pub enum CoreG2Error {
    #[msg("caller supplied a noncanonical content hash")]
    WrongExpectedHash,
    #[msg("immutable content-addressed account already contains different bytes")]
    ImmutableAccountMismatch,
    #[msg("Timepin program does not match the immutable economy")]
    WrongTimepinProgram,
    #[msg("pinned Timepin program is not executable")]
    TimepinProgramNotExecutable,
    #[msg("legacy economy has no migration snapshot")]
    NoLegacySnapshot,
    #[msg("legacy cutover slot is still in the future")]
    FutureLegacyCutover,
    #[msg("legacy Merkle proof does not reach the immutable root")]
    InvalidLegacyProof,
    #[msg("legacy claim exceeds immutable snapshot totals")]
    LegacyClaimExceedsManifest,
    #[msg("RCX amount must purchase at least one whole play credit")]
    InvalidAmount,
    #[msg("reload nonce is not the ledger's next canonical nonce")]
    WrongReloadNonce,
    #[msg("player token account does not contain the declared gross RCX")]
    InsufficientRcx,
    #[msg("only the canonical Token-2022 program may burn RCX")]
    WrongTokenProgram,
    #[msg("only the canonical SPL Memo program may precede routed RCX transfers")]
    WrongMemoProgram,
    #[msg("token mint is not canonical RCX")]
    WrongMint,
    #[msg("RCX mint decimals are not canonical")]
    WrongDecimals,
    #[msg("RCX mint byte layout is not the frozen mainnet layout")]
    WrongMintLayout,
    #[msg("RCX mint extensions or immutable metadata are not canonical")]
    WrongMintExtensions,
    #[msg("instruction supplied the wrong number of remaining accounts")]
    WrongRemainingAccounts,
    #[msg("podium seat account is not the canonical RCX ATA or empty placeholder")]
    WrongSeatAccount,
    #[msg("existing podium destination is not a valid Token-2022 account")]
    MalformedSeatAccount,
    #[msg("existing podium destination must be writable")]
    ReadonlySeatAccount,
    #[msg("podium destination holds a different mint")]
    WrongSeatMint,
    #[msg("podium destination belongs to a different wallet")]
    WrongSeatOwner,
    #[msg("immutable day-final hash does not match")]
    WrongDayFinalHash,
    #[msg("day-final identity or contents are inconsistent")]
    WrongDayFinal,
    #[msg("day-final PDA is not canonical")]
    WrongDayFinalPda,
    #[msg("UTC day must be nonnegative")]
    InvalidDay,
    #[msg("UTC day is not closed yet")]
    DayStillOpen,
    #[msg("not every accepted shot for the day is terminal")]
    DayIncomplete,
    #[msg("rank shard identity or contents are inconsistent")]
    WrongRankShard,
    #[msg("rank shard PDA is not canonical")]
    WrongRankShardPda,
    #[msg("player-day identity or counters are inconsistent")]
    WrongPlayerDay,
    #[msg("player-day PDA is not canonical")]
    WrongPlayerDayPda,
    #[msg("shot, player-day and rank shard do not describe one score record")]
    WrongScoreAccounts,
    #[msg("terminal score accounting exceeds accepted shots")]
    ScoreCounterUnderflow,
    #[msg("shot nonce is not the ledger's next canonical nonce")]
    WrongShotNonce,
    #[msg("Timepin deadlines do not match the deadline frozen at seal")]
    BadTimepinDeadline,
    #[msg("shot score day does not match its frozen reveal deadline")]
    WrongScoreDay,
    #[msg("account has noncanonical trailing or missing bytes")]
    WrongAccountLength,
    #[msg("account discriminator does not have the canonical eight-byte shape")]
    WrongAccountDiscriminator,
    #[msg("history page is not the page containing the ledger's next nonce")]
    WrongHistoryPage,
    #[msg("work kind is not supported by this producer generation")]
    WrongWorkKind,
    #[msg("work page is not the canonical optional page for this shot")]
    WrongWorkPage,
    #[msg("canonical work page must be writable")]
    ReadonlyWorkPage,
    #[msg("reserved work row or expected locator index is inconsistent")]
    WrongWorkRecord,
    #[msg("work completion fact hash must be nonzero")]
    BadWorkFact,
    #[msg("transient Shot no longer contains its immutable cleanup bond")]
    CleanupBondMissing,
    #[msg("player ledger identity is inconsistent")]
    WrongLedger,
    #[msg("player ledger PDA is not canonical")]
    WrongLedgerPda,
    #[msg("ruleset identity is inconsistent")]
    WrongRuleset,
    #[msg("shot identity is inconsistent")]
    WrongShot,
    #[msg("shot PDA is not canonical")]
    WrongShotPda,
    #[msg("stored PDA bump is not canonical")]
    WrongBump,
    #[msg("shot fields do not match its lifecycle state")]
    BadShotShape,
    #[msg("ruleset and immutable Timepin EvidenceSpec differ")]
    RulesetSpecMismatch,
    #[msg("shot uses the wrong entry mode")]
    WrongEntryMode,
    #[msg("commitment must not be zero")]
    EmptyCommitment,
    #[msg("requested Timepin target is not canonical")]
    WrongTarget,
    #[msg("entry and exit cannot use the same Timepin Need")]
    SameNeed,
    #[msg("Timepin Need does not match the permanent shot")]
    WrongNeed,
    #[msg("evidence feed does not match the immutable ruleset")]
    WrongFeed,
    #[msg("observed entry is from the future")]
    FutureEntry,
    #[msg("observed entry is older than the immutable ruleset permits")]
    StaleEntry,
    #[msg("instruction is not valid for the current shot state")]
    WrongState,
    #[msg("stake is outside immutable economy bounds")]
    StakeOutOfBounds,
    #[msg("player already has the maximum number of open shots")]
    TooManyOpen,
    #[msg("player has insufficient on-chain credits")]
    InsufficientCredits,
    #[msg("locked credit accounting would underflow")]
    LockedCreditsUnderflow,
    #[msg("open-shot accounting would underflow")]
    OpenCounterUnderflow,
    #[msg("terminal payout or XP reserve would underflow")]
    TerminalReserveUnderflow,
    #[msg("reveal window is closed")]
    RevealClosed,
    #[msg("forfeit window is not open")]
    ForfeitNotOpen,
    #[msg("revealed value does not match the sealed commitment")]
    CommitmentMismatch,
    #[msg("timestamp arithmetic overflowed")]
    TimestampOverflow,
    #[msg("integer arithmetic overflowed")]
    MathOverflow,
    #[msg("transaction signer is not the exact player-authorized delegate")]
    WrongDelegateAuthority,
    #[msg("reload page is not the canonical page containing the next reload nonce")]
    WrongReloadHistoryPage,
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;

    #[test]
    fn archive_funding_preserves_bond_and_uses_actor_only_for_remainder() {
        assert_eq!(
            archive_funding_plan(1_000, 200, 1_000, 100).unwrap(),
            (800, 0)
        );
        assert_eq!(
            archive_funding_plan(1_200, 200, 500, 100).unwrap(),
            (400, 600)
        );
        assert_eq!(archive_funding_plan(200, 1_000, 500, 100).unwrap(), (0, 0));
        assert!(archive_funding_plan(1_000, 200, 99, 100).is_err());
    }

    #[test]
    fn memo_digest_payload_is_exact_lowercase_ascii_hex() {
        let mut digest = [0u8; 32];
        digest[0] = 0x01;
        digest[1] = 0xaf;
        digest[31] = 0xff;
        let payload = lowercase_hex_digest(&digest);
        assert_eq!(payload.len(), 64);
        assert!(payload
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte)));
        assert_eq!(&payload[..4], b"01af");
        assert_eq!(&payload[62..], b"ff");
        assert!(core::str::from_utf8(&payload).is_ok());
    }

    #[test]
    fn optional_work_loader_accepts_exact_dynamic_page() {
        let economy_hash = [0x31; 32];
        let player = Pubkey::new_from_array([0x32; 32]);
        let page_index = 7;
        let (page_key, bump) = work_page_pda(&economy_hash, &player, page_index);
        let subject = Pubkey::new_from_array([0x33; 32]);
        let mut page = WorkPage::default();
        page.initialize(bump, economy_hash, player, page_index);
        for work_kind in [
            WORK_KIND_ACTIVATE_ENTRY,
            WORK_KIND_RESOLVE_SHOT,
            WORK_KIND_FORFEIT,
        ] {
            page.records.push(WorkRecord {
                subject,
                work_kind,
                disposition: RECEIPT_PENDING,
                worker: Pubkey::default(),
                result_hash: [0; 32],
                completed_slot: 0,
            });
        }
        let mut data = vec![0u8; work_account_len(&page).unwrap()];
        page.try_serialize(&mut data.as_mut_slice()).unwrap();
        let mut lamports = Rent::default().minimum_balance(data.len());
        let owner = crate::ID;
        let account = AccountInfo::new(
            &page_key,
            false,
            true,
            &mut lamports,
            &mut data,
            &owner,
            false,
        );
        let loaded = load_optional_work_page(&account, &economy_hash, &player, page_index).unwrap();
        assert_eq!(loaded.unwrap(), page);
    }

    #[test]
    fn work_manifest_abi_matches_work_market_v2() {
        let shot_discriminator: [u8; 8] = Shot::DISCRIMINATOR.try_into().unwrap();
        let page_discriminator: [u8; 8] = WorkPage::DISCRIMINATOR.try_into().unwrap();
        assert_eq!(WorkManifest::LEN, 34);
        assert_eq!(8 + Shot::LEN, 780);
        assert_eq!(state::WORK_PAGE_RECORDS_OFFSET, 87);
        assert_eq!(WorkRecord::LEN, 106);
        assert_eq!(WORK_PAGE_CAP, 48);
        assert_eq!(
            shot_discriminator,
            [0xe1, 0xa2, 0xa8, 0x12, 0xcf, 0xc1, 0xf1, 0x6b]
        );
        assert_eq!(
            page_discriminator,
            [0x95, 0xd0, 0xd6, 0xe2, 0xe0, 0x5a, 0xd6, 0x94]
        );
        assert_eq!(
            WorkManifest::DISCRIMINATOR,
            &[0xbb, 0xe5, 0xaf, 0x48, 0xf1, 0x12, 0xa4, 0x55]
        );
    }

    #[test]
    fn delegation_surface_and_direct_seal_discriminators_are_exact() {
        assert_eq!(
            instruction::SealForward::DISCRIMINATOR,
            &[0x8a, 0x4a, 0x00, 0xf1, 0xf6, 0x7f, 0x89, 0xfe]
        );
        assert_eq!(
            instruction::SealObserved::DISCRIMINATOR,
            &[0xc9, 0xa4, 0x34, 0xda, 0x35, 0x8c, 0x1c, 0x92]
        );
        assert_eq!(
            instruction::Reveal::DISCRIMINATOR,
            &[0x09, 0x23, 0x3b, 0xbe, 0xa7, 0xf9, 0x4c, 0x73]
        );
        assert_eq!(
            instruction::GrantDelegate::DISCRIMINATOR,
            &[0xfa, 0xa9, 0x6e, 0xd9, 0x29, 0xa0, 0x61, 0xb8]
        );
        assert_eq!(
            instruction::RevokeDelegate::DISCRIMINATOR,
            &[0x8e, 0x42, 0x62, 0x7e, 0x66, 0x3c, 0x5c, 0xa3]
        );
        assert_eq!(
            instruction::SealForwardDelegated::DISCRIMINATOR,
            &[0x2a, 0xee, 0x51, 0x11, 0x20, 0x39, 0xde, 0x65]
        );
        assert_eq!(
            instruction::SealObservedDelegated::DISCRIMINATOR,
            &[0xd8, 0x7f, 0x78, 0x19, 0xe5, 0x49, 0xbd, 0x63]
        );
        assert_eq!(
            instruction::RevealDelegated::DISCRIMINATOR,
            &[0x04, 0xfe, 0xf8, 0x33, 0x2a, 0x2d, 0xd2, 0x0a]
        );
        assert_eq!(DelegateGrant::LEN, 196);
    }
}
