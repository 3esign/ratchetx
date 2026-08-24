// RATCHET Player Passport v2 — isolated DEVNET registry/checkpoint program.
// Solana Playground rewrites declare_id! to the deployed program address.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_lang::solana_program::instruction::AccountMeta;

declare_id!("11111111111111111111111111111111");

const CONFIG_SEED: &[u8] = b"passport-config";
const REGISTRY_SEED: &[u8] = b"passport";
const CHECKPOINT_DOMAIN: &[u8] = b"RATCHET_PLAYER_PASSPORT_V2\0";
const LEAF_DOMAIN: &[u8] = b"RATCHET_PLAYER_ACHIEVEMENT_LEAF_V1\0";
const NODE_DOMAIN: &[u8] = b"RATCHET_PLAYER_ACHIEVEMENT_NODE_V1\0";
const MAX_FUTURE_SECONDS: i64 = 300;
const MAX_PROOF_DEPTH: usize = 32;
const MIN_MINT_BYTES: usize = 82;
pub const MPL_CORE_PROGRAM_ID: Pubkey = anchor_lang::solana_program::pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
pub const RATCHET_SEAL_PROGRAM_ID: Pubkey = anchor_lang::solana_program::pubkey!("23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX"); // from devnet deploy

#[account]
pub struct Shot {
    pub player: Pubkey,
    pub nonce: u64,
    pub commit: [u8; 32],
    pub shot_id: [u8; 32],
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

// ------------------------------------------------------------
//  Metaplex Core Manual CPI Layouts (Zero Crate Dependencies)
// ------------------------------------------------------------
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub enum PluginAuthority {
    None,
    Owner,
    UpdateAuthority,
    Address { address: Pubkey },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub enum LinkedDataKey {
    LinkedLifecycleHook(Pubkey),
    LinkedAppData(PluginAuthority),
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub enum ExternalPluginAdapterKey {
    LifecycleHook(Pubkey),
    Oracle(Pubkey),
    AppData(PluginAuthority),
    LinkedLifecycleHook(Pubkey),
    LinkedAppData(PluginAuthority),
    DataSection(LinkedDataKey),
    AgentIdentity,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct WriteExternalPluginAdapterDataV1InstructionData {
    pub discriminator: u8,
    pub key: ExternalPluginAdapterKey,
    pub data: Option<Vec<u8>>,
}

#[program]
pub mod ratchet_player_passport {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, attestor: Pubkey) -> Result<()> {
        require!(attestor != Pubkey::default(), PassportError::InvalidAuthority);
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.attestor = attestor;
        config.bump = ctx.bumps.config;
        emit!(ConfigInitialized { admin: config.admin, attestor });
        Ok(())
    }

    pub fn set_attestor(ctx: Context<SetAttestor>, attestor: Pubkey) -> Result<()> {
        require!(attestor != Pubkey::default(), PassportError::InvalidAuthority);
        let old_attestor = ctx.accounts.config.attestor;
        ctx.accounts.config.attestor = attestor;
        emit!(AttestorChanged { old_attestor, new_attestor: attestor });
        Ok(())
    }

    /// Creates exactly one canonical registry PDA for this player wallet.
    pub fn initialize_registry(ctx: Context<InitializeRegistry>) -> Result<()> {
        require!(ctx.accounts.passport_mint.data_len() >= MIN_MINT_BYTES, PassportError::InvalidMint);
        let registry = &mut ctx.accounts.registry;
        registry.player = ctx.accounts.player.key();
        registry.passport_mint = ctx.accounts.passport_mint.key();
        registry.bump = ctx.bumps.registry;
        registry.sequence = 0;
        registry.checkpoint_hash = [0; 32];
        registry.log_index = 0;
        registry.log_head = [0; 32];
        registry.state_root = [0; 32];
        registry.lifetime_xp = 0;
        registry.best_streak = 0;
        registry.shots = 0;
        registry.podium_wins = 0;
        registry.burned = 0;
        registry.epoch_day = 0;
        registry.checkpoint_unix = 0;
        emit!(RegistryInitialized { player: registry.player, passport_mint: registry.passport_mint, registry: registry.key() });
        Ok(())
    }

    pub fn checkpoint(ctx: Context<Checkpoint>, candidate: CheckpointArgs) -> Result<()> {
        require!(candidate.proof.len() <= MAX_PROOF_DEPTH, PassportError::ProofTooDeep);
        let registry = &mut ctx.accounts.registry;
        require!(candidate.sequence == registry.sequence.checked_add(1).ok_or(PassportError::MathOverflow)?, PassportError::BadSequence);
        require!(candidate.previous_checkpoint_hash == registry.checkpoint_hash, PassportError::BrokenCheckpointLink);
        require!(candidate.log_index > registry.log_index, PassportError::LogDidNotAdvance);
        require!(candidate.log_head != registry.log_head, PassportError::LogDidNotAdvance);
        require!(candidate.lifetime_xp >= registry.lifetime_xp, PassportError::MetricRollback);
        require!(candidate.best_streak >= registry.best_streak, PassportError::MetricRollback);
        require!(candidate.shots >= registry.shots, PassportError::MetricRollback);
        require!(candidate.podium_wins >= registry.podium_wins, PassportError::MetricRollback);
        require!(candidate.burned >= registry.burned, PassportError::MetricRollback);
        require!(candidate.epoch_day >= registry.epoch_day, PassportError::MetricRollback);
        require!(candidate.checkpoint_unix >= registry.checkpoint_unix, PassportError::TimestampRollback);
        let now = Clock::get()?.unix_timestamp;
        require!(candidate.checkpoint_unix <= now.checked_add(MAX_FUTURE_SECONDS).ok_or(PassportError::MathOverflow)?, PassportError::FutureTimestamp);

        let leaf = achievement_leaf(registry.player, &candidate);
        require!(verify_merkle_proof(leaf, &candidate.proof, candidate.state_root), PassportError::InvalidMerkleProof);
        let checkpoint_hash = checkpoint_hash(registry.player, registry.passport_mint, &candidate);

        registry.sequence = candidate.sequence;
        registry.checkpoint_hash = checkpoint_hash;
        registry.log_index = candidate.log_index;
        registry.log_head = candidate.log_head;
        registry.state_root = candidate.state_root;
        registry.lifetime_xp = candidate.lifetime_xp;
        registry.best_streak = candidate.best_streak;
        registry.shots = candidate.shots;
        registry.podium_wins = candidate.podium_wins;
        registry.burned = candidate.burned;
        registry.epoch_day = candidate.epoch_day;
        registry.checkpoint_unix = candidate.checkpoint_unix;
        
        let app_data_json = format!(
            "{{\"sequence\":{},\"lifetime_xp\":{},\"best_streak\":{},\"shots\":{},\"podium_wins\":{},\"burned\":{},\"epoch_day\":{}}}",
            registry.sequence, registry.lifetime_xp, registry.best_streak, registry.shots, registry.podium_wins, registry.burned, registry.epoch_day
        );

        // Construct raw Instruction for WriteExternalPluginAdapterDataV1 CPI
        let mpl_core_program_id = MPL_CORE_PROGRAM_ID;

        // Accounts required by Metaplex Core WriteExternalPluginAdapterDataV1
        let accounts = vec![
            AccountMeta::new(ctx.accounts.passport_mint.key(), false), // asset
            AccountMeta::new_readonly(mpl_core_program_id, false), // collection placeholder (None)
            AccountMeta::new(ctx.accounts.attestor.key(), true), // payer
            AccountMeta::new_readonly(ctx.accounts.config.key(), true), // authority (Some(config))
            AccountMeta::new_readonly(mpl_core_program_id, false), // buffer placeholder (None)
            AccountMeta::new_readonly(ctx.accounts.system_program.key(), false), // system_program
            AccountMeta::new_readonly(mpl_core_program_id, false), // log_wrapper placeholder (None)
        ];

        let ix_data = WriteExternalPluginAdapterDataV1InstructionData {
            discriminator: 28,
            key: ExternalPluginAdapterKey::AppData(PluginAuthority::Address { address: ctx.accounts.config.key() }),
            data: Some(app_data_json.into_bytes()),
        };
        
        let mut serialized_data = Vec::new();
        ix_data.serialize(&mut serialized_data)?;

        let instruction = solana_program::instruction::Instruction {
            program_id: mpl_core_program_id,
            accounts,
            data: serialized_data,
        };

        let config_bump = ctx.accounts.config.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &[config_bump]]];

        solana_program::program::invoke_signed(
            &instruction,
            &[
                ctx.accounts.passport_mint.to_account_info(),
                ctx.accounts.mpl_core_program.to_account_info(), // used as placeholder for None accounts with MPL_CORE_PROGRAM_ID
                ctx.accounts.attestor.to_account_info(),
                ctx.accounts.config.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;

        emit!(CheckpointAccepted { player: registry.player, passport_mint: registry.passport_mint, sequence: registry.sequence, checkpoint_hash, log_index: registry.log_index, log_head: registry.log_head, state_root: registry.state_root });
        Ok(())
    }

    pub fn claim_game_xp(ctx: Context<ClaimGameXp>) -> Result<()> {
        let shot = &ctx.accounts.shot;
        let registry = &mut ctx.accounts.registry;
        
        require!(shot.player == ctx.accounts.player.key(), PassportError::Unauthorized);
        // ShotState: Revealed = 3, Voided = 4
        require!(shot.state == 3 || shot.state == 4, PassportError::Unauthorized);
        
        // Award XP only if it was Revealed (not Voided)
        registry.shots = registry.shots.checked_add(1).ok_or(PassportError::MathOverflow)?;
        
        let mut earned_xp = 0;
        if shot.state == 3 {
            if shot.hit == 1 {
                earned_xp = 10;
                registry.lifetime_xp = registry.lifetime_xp.checked_add(10).ok_or(PassportError::MathOverflow)?;
                registry.best_streak = registry.best_streak.checked_add(1).ok_or(PassportError::MathOverflow)?;
                registry.podium_wins = registry.podium_wins.checked_add(1).ok_or(PassportError::MathOverflow)?;
            } else {
                registry.best_streak = 0; // reset streak on miss
            }
        }
        
        let app_data_json = format!(
            "{{\"sequence\":{},\"lifetime_xp\":{},\"best_streak\":{},\"shots\":{},\"podium_wins\":{},\"burned\":{},\"epoch_day\":{}}}",
            registry.sequence, registry.lifetime_xp, registry.best_streak, registry.shots, registry.podium_wins, registry.burned, registry.epoch_day
        );

        let mpl_core_program_id = MPL_CORE_PROGRAM_ID;

        // Core AppData CPI
        let accounts = vec![
            AccountMeta::new(ctx.accounts.passport_mint.key(), false),
            AccountMeta::new_readonly(mpl_core_program_id, false),
            AccountMeta::new(ctx.accounts.player.key(), true), // payer is player
            AccountMeta::new_readonly(ctx.accounts.config.key(), true), // authority
            AccountMeta::new_readonly(mpl_core_program_id, false),
            AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
            AccountMeta::new_readonly(mpl_core_program_id, false),
        ];

        let ix_data = WriteExternalPluginAdapterDataV1InstructionData {
            discriminator: 28,
            key: ExternalPluginAdapterKey::AppData(PluginAuthority::Address { address: ctx.accounts.config.key() }),
            data: Some(app_data_json.into_bytes()),
        };
        
        let mut serialized_data = Vec::new();
        ix_data.serialize(&mut serialized_data)?;

        let instruction = solana_program::instruction::Instruction {
            program_id: mpl_core_program_id,
            accounts,
            data: serialized_data,
        };

        let config_bump = ctx.accounts.config.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &[config_bump]]];

        solana_program::program::invoke_signed(
            &instruction,
            &[
                ctx.accounts.passport_mint.to_account_info(),
                ctx.accounts.mpl_core_program.to_account_info(),
                ctx.accounts.player.to_account_info(),
                ctx.accounts.config.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;
        
        // CPI to ratchet-seal-v2 close_shot
        let instruction_close = solana_program::instruction::Instruction {
            program_id: ctx.accounts.ratchet_seal_program.key(),
            accounts: vec![
                AccountMeta::new(ctx.accounts.shot.key(), false),
                AccountMeta::new(ctx.accounts.player.key(), true),
                AccountMeta::new_readonly(ctx.accounts.player.key(), true),
            ],
            data: vec![211, 130, 172, 41, 129, 85, 133, 15],
        };

        solana_program::program::invoke(
            &instruction_close,
            &[
                ctx.accounts.shot.to_account_info(),
                ctx.accounts.player.to_account_info(),
                ctx.accounts.player.to_account_info(), // passed twice as it acts as both player and cranker
            ],
        )?;

        emit!(GameXpClaimed { player: registry.player, shot: ctx.accounts.shot.key(), hit: shot.hit, lifetime_xp: registry.lifetime_xp, shots: registry.shots });
        Ok(())
    }
}


#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(init, payer = admin, space = PassportConfig::SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, PassportConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetAttestor<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, PassportConfig>,
    #[account(address = config.admin @ PassportError::Unauthorized)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, PassportConfig>,
    #[account(init, payer = player, space = PlayerRegistry::SPACE, seeds = [REGISTRY_SEED, player.key().as_ref()], bump)]
    pub registry: Account<'info, PlayerRegistry>,
    #[account(mut)]
    pub player: Signer<'info>,
    /// CHECK: exact owner and minimum mint size are checked; this is the Metaplex Core Asset.
    #[account(owner = MPL_CORE_PROGRAM_ID @ PassportError::WrongTokenProgram)]
    pub passport_mint: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Checkpoint<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, PassportConfig>,
    #[account(mut, seeds = [REGISTRY_SEED, registry.player.as_ref()], bump = registry.bump)]
    pub registry: Account<'info, PlayerRegistry>,
    #[account(mut, address = config.attestor @ PassportError::Unauthorized)]
    pub attestor: Signer<'info>,
    /// CHECK: locked to the immutable registry asset and Core owner.
    #[account(mut, address = registry.passport_mint @ PassportError::WrongMint, owner = MPL_CORE_PROGRAM_ID @ PassportError::WrongTokenProgram)]
    pub passport_mint: UncheckedAccount<'info>,
    /// CHECK: MPL Core program
    #[account(address = MPL_CORE_PROGRAM_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct PassportConfig { pub admin: Pubkey, pub attestor: Pubkey, pub bump: u8 }
impl PassportConfig { pub const SPACE: usize = 8 + 32 + 32 + 1; }

#[account]
pub struct PlayerRegistry {
    pub player: Pubkey,
    pub passport_mint: Pubkey,
    pub bump: u8,
    pub sequence: u64,
    pub checkpoint_hash: [u8; 32],
    pub log_index: u64,
    pub log_head: [u8; 32],
    pub state_root: [u8; 32],
    pub lifetime_xp: u64,
    pub best_streak: u64,
    pub shots: u64,
    pub podium_wins: u64,
    pub burned: u64,
    pub epoch_day: u64,
    pub checkpoint_unix: i64,
}
impl PlayerRegistry { pub const SPACE: usize = 8 + 32 + 32 + 1 + 8 + 32 + 8 + 32 + 32 + (7 * 8); }

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CheckpointArgs {
    pub sequence: u64,
    pub previous_checkpoint_hash: [u8; 32],
    pub log_index: u64,
    pub log_head: [u8; 32],
    pub state_root: [u8; 32],
    pub lifetime_xp: u64,
    pub best_streak: u64,
    pub shots: u64,
    pub podium_wins: u64,
    pub burned: u64,
    pub epoch_day: u64,
    pub checkpoint_unix: i64,
    pub proof: Vec<MerkleStep>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MerkleStep { pub sibling_left: bool, pub hash: [u8; 32] }

fn achievement_leaf(player: Pubkey, c: &CheckpointArgs) -> [u8; 32] {
    hashv(&[LEAF_DOMAIN, player.as_ref(), &c.lifetime_xp.to_le_bytes(), &c.best_streak.to_le_bytes(), &c.shots.to_le_bytes(), &c.podium_wins.to_le_bytes(), &c.burned.to_le_bytes()]).to_bytes()
}

fn verify_merkle_proof(mut current: [u8; 32], proof: &[MerkleStep], root: [u8; 32]) -> bool {
    for step in proof {
        current = if step.sibling_left { hashv(&[NODE_DOMAIN, &step.hash, &current]).to_bytes() } else { hashv(&[NODE_DOMAIN, &current, &step.hash]).to_bytes() };
    }
    current == root
}

fn checkpoint_hash(player: Pubkey, mint: Pubkey, c: &CheckpointArgs) -> [u8; 32] {
    hashv(&[CHECKPOINT_DOMAIN, player.as_ref(), mint.as_ref(), &c.sequence.to_le_bytes(), &c.previous_checkpoint_hash, &c.log_index.to_le_bytes(), &c.log_head, &c.state_root, &c.lifetime_xp.to_le_bytes(), &c.best_streak.to_le_bytes(), &c.shots.to_le_bytes(), &c.podium_wins.to_le_bytes(), &c.burned.to_le_bytes(), &c.epoch_day.to_le_bytes(), &c.checkpoint_unix.to_le_bytes()]).to_bytes()
}

#[event]
pub struct ConfigInitialized { pub admin: Pubkey, pub attestor: Pubkey }
#[event]
pub struct AttestorChanged { pub old_attestor: Pubkey, pub new_attestor: Pubkey }
#[event]
pub struct RegistryInitialized { pub player: Pubkey, pub passport_mint: Pubkey, pub registry: Pubkey }
#[event]
pub struct CheckpointAccepted { pub player: Pubkey, pub passport_mint: Pubkey, pub sequence: u64, pub checkpoint_hash: [u8; 32], pub log_index: u64, pub log_head: [u8; 32], pub state_root: [u8; 32] }

#[derive(Accounts)]
pub struct ClaimGameXp<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, PassportConfig>,
    #[account(mut, seeds = [REGISTRY_SEED, player.key().as_ref()], bump = registry.bump)]
    pub registry: Account<'info, PlayerRegistry>,
    #[account(mut)]
    pub player: Signer<'info>,
    
    #[account(mut, owner = ratchet_seal_program.key() @ PassportError::InvalidAuthority)]
    pub shot: Account<'info, Shot>,
    
    /// CHECK: Validated by address constraint
    #[account(address = RATCHET_SEAL_PROGRAM_ID)]
    pub ratchet_seal_program: UncheckedAccount<'info>,
    
    /// CHECK: locked to the immutable registry asset and Core owner.
    #[account(mut, address = registry.passport_mint @ PassportError::WrongMint, owner = MPL_CORE_PROGRAM_ID @ PassportError::WrongTokenProgram)]
    pub passport_mint: UncheckedAccount<'info>,
    /// CHECK: MPL Core program
    #[account(address = MPL_CORE_PROGRAM_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct GameXpClaimed { pub player: Pubkey, pub shot: Pubkey, pub hit: u8, pub lifetime_xp: u64, pub shots: u64 }


#[error_code]
pub enum PassportError {
    #[msg("invalid authority")] InvalidAuthority,
    #[msg("unauthorized signer")] Unauthorized,
    #[msg("passport mint is not owned by Core")] WrongTokenProgram,
    #[msg("passport mint does not match the registry")] WrongMint,
    #[msg("invalid Token-2022 mint account")] InvalidMint,
    #[msg("sequence must increment by exactly one")] BadSequence,
    #[msg("previous checkpoint hash does not match")] BrokenCheckpointLink,
    #[msg("RATCHET log index and head must advance")] LogDidNotAdvance,
    #[msg("durable metric cannot decrease")] MetricRollback,
    #[msg("checkpoint timestamp cannot move backward")] TimestampRollback,
    #[msg("checkpoint timestamp is too far in the future")] FutureTimestamp,
    #[msg("achievement proof exceeds maximum depth")] ProofTooDeep,
    #[msg("achievement Merkle proof does not match state root")] InvalidMerkleProof,
    #[msg("math overflow")] MathOverflow,
}
