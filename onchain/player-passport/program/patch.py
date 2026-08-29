import sys

path = r'd:\Work\Software_Projects\pumpmind\ratchet_phase_a_clean\onchain\player-passport\program\lib.rs'
with open(path, 'r') as f:
    content = f.read()

# 1. Replace TOKEN_2022_PROGRAM_ID with MPL_CORE_PROGRAM_ID
content = content.replace(
    'pub const TOKEN_2022_PROGRAM_ID: Pubkey = anchor_lang::solana_program::pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");',
    'pub const MPL_CORE_PROGRAM_ID: Pubkey = anchor_lang::solana_program::pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcDAJ7n3RoUcg07M9E");'
)
content = content.replace('TOKEN_2022_PROGRAM_ID', 'MPL_CORE_PROGRAM_ID')

# 2. In InitializeRegistry, fix the comment
content = content.replace(
    '/// CHECK: exact owner and minimum mint size are checked; extension parsing is the next Devnet gate.',
    '/// CHECK: exact owner and minimum mint size are checked; this is the Metaplex Core Asset.'
)

# 3. Fix Checkpoint struct
checkpoint_struct_old = '''#[derive(Accounts)]
pub struct Checkpoint<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, PassportConfig>,
    #[account(mut, seeds = [REGISTRY_SEED, registry.player.as_ref()], bump = registry.bump)]
    pub registry: Account<'info, PlayerRegistry>,
    #[account(address = config.attestor @ PassportError::Unauthorized)]
    pub attestor: Signer<'info>,
    /// CHECK: locked to the immutable registry mint and Token-2022 owner.
    #[account(address = registry.passport_mint @ PassportError::WrongMint, owner = MPL_CORE_PROGRAM_ID @ PassportError::WrongTokenProgram)]
    pub passport_mint: UncheckedAccount<'info>,
}'''

checkpoint_struct_new = '''#[derive(Accounts)]
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
}'''

content = content.replace(checkpoint_struct_old, checkpoint_struct_new)

# 4. In checkpoint function, add the CPI at the end before Ok(())
cpi_code = '''
        let app_data_json = format!(
            "{{\\"sequence\\":{},\\"lifetime_xp\\":{},\\"best_streak\\":{},\\"shots\\":{},\\"podium_wins\\":{},\\"burned\\":{},\\"epoch_day\\":{}}}",
            registry.sequence, registry.lifetime_xp, registry.best_streak, registry.shots, registry.podium_wins, registry.burned, registry.epoch_day
        );

        let config_bump = ctx.accounts.config.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &[config_bump]]];

        mpl_core::instructions::WriteExternalPluginAdapterDataV1CpiBuilder::new(&ctx.accounts.mpl_core_program)
            .asset(&ctx.accounts.passport_mint)
            .payer(&ctx.accounts.attestor)
            .authority(Some(&ctx.accounts.config))
            .system_program(&ctx.accounts.system_program)
            .key(mpl_core::types::ExternalPluginAdapterKey::AppData(mpl_core::types::Authority::Address { address: ctx.accounts.config.key() }))
            .data(app_data_json.into_bytes())
            .invoke_signed(signer_seeds)?;

        Ok(())'''

content = content.replace('        Ok(())\n    }\n}', cpi_code + '\n    }\n}')

with open(path, 'w') as f:
    f.write(content)
print('Done!')
