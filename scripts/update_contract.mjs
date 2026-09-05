import fs from 'node:fs';

const filePath = 'D:/Work/Software_Projects/pumpmind/ratchetx/ratchet_phase_a_clean/onchain/ratchet-core/programs/ratchet-core/src/lib.rs';
let content = fs.readFileSync(filePath, 'utf8');

const instructions = `
    pub fn initialize_migration(ctx: Context<InitializeMigration>, root: [u8; 32]) -> Result<()> {
        let state = &mut ctx.accounts.migration_state;
        state.authority = ctx.accounts.authority.key();
        state.root = root;
        Ok(())
    }

    pub fn update_migration_root(ctx: Context<UpdateMigrationRoot>, root: [u8; 32]) -> Result<()> {
        require!(ctx.accounts.migration_state.authority == ctx.accounts.authority.key(), CoreError::Unauthorized);
        ctx.accounts.migration_state.root = root;
        Ok(())
    }

    pub fn claim_legacy_balance(ctx: Context<ClaimLegacyBalance>, cr: u64, xp: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        let mut leaf_data = [0u8; 48];
        leaf_data[0..32].copy_from_slice(&ctx.accounts.player.key().to_bytes());
        leaf_data[32..40].copy_from_slice(&cr.to_le_bytes());
        leaf_data[40..48].copy_from_slice(&xp.to_le_bytes());
        let leaf = solana_program::hash::hashv(&[&leaf_data]).to_bytes();

        require!(verify_proof(&proof, &ctx.accounts.migration_state.root, &leaf), CoreError::InvalidMerkleProof);

        let claim = &mut ctx.accounts.claim;
        require!(!claim.claimed, CoreError::AlreadyClaimed);
        claim.claimed = true;

        let ledger = &mut ctx.accounts.player_ledger;
        if ledger.player == Pubkey::default() {
            ledger.player = ctx.accounts.player.key();
        }
        ledger.xp = ledger.xp.saturating_add(xp);

        if cr > 0 {
            let seeds = &[b"vault".as_ref(), &[ctx.bumps.vault_token_account]];
            let signer = &[&seeds[..]];
            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.player_token_account.to_account_info(),
                authority: ctx.accounts.vault_token_account.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            token::transfer(CpiContext::new_with_signer(cpi_program, cpi_accounts, signer), cr)?;
        }

        Ok(())
    }
`;

content = content.replace('    pub fn void_shot', instructions + '\n    pub fn void_shot');

const helpersAndStructs = `
fn verify_proof(proof: &[[u8; 32]], root: &[u8; 32], leaf: &[u8; 32]) -> bool {
    let mut computed_hash = *leaf;
    for proof_element in proof.iter() {
        if computed_hash <= *proof_element {
            computed_hash = solana_program::hash::hashv(&[&computed_hash, proof_element]).to_bytes();
        } else {
            computed_hash = solana_program::hash::hashv(&[proof_element, &computed_hash]).to_bytes();
        }
    }
    computed_hash == *root
}

#[account]
pub struct MigrationState {
    pub authority: Pubkey,
    pub root: [u8; 32],
}

#[account]
pub struct MigrationClaim {
    pub claimed: bool,
}

#[derive(Accounts)]
pub struct InitializeMigration<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32,
        seeds = [b"migration"],
        bump
    )]
    pub migration_state: Account<'info, MigrationState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateMigrationRoot<'info> {
    #[account(mut, seeds = [b"migration"], bump)]
    pub migration_state: Account<'info, MigrationState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimLegacyBalance<'info> {
    #[account(seeds = [b"migration"], bump)]
    pub migration_state: Account<'info, MigrationState>,

    #[account(
        init,
        payer = player,
        space = 8 + 1,
        seeds = [b"claim", player.key().as_ref()],
        bump
    )]
    pub claim: Account<'info, MigrationClaim>,

    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        init_if_needed,
        payer = player,
        space = 8 + PlayerLedger::SIZE,
        seeds = [b"player", player.key().as_ref()],
        bump
    )]
    pub player_ledger: Account<'info, PlayerLedger>,

    #[account(mut)]
    pub player_token_account: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault_token_account: Account<'info, TokenAccount>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}
`;

content = content.replace('// Helper to execute VOID (Refund and reverse penalty)', helpersAndStructs + '\n// Helper to execute VOID (Refund and reverse penalty)');

const errorReplacements = `    #[msg("Invalid Merkle Proof")]
    InvalidMerkleProof,
    #[msg("Already Claimed")]
    AlreadyClaimed,
    #[msg("Unauthorized")]
    Unauthorized,
}`;
content = content.replace('    NotVoidableYet,\n}', '    NotVoidableYet,\n' + errorReplacements);

fs.writeFileSync(filePath, content);
console.log('Contract updated successfully.');
