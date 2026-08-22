# Player Passport v2 Devnet program

This folder is an isolated Solana Playground target. It has no authority over RCX, rewards, the production game or mainnet.

1. Create a fresh Anchor project in Solana Playground on **Devnet**.
2. Replace `src/lib.rs` with `lib.rs` from this folder.
3. Build. Playground will replace the placeholder `declare_id!` with the project program ID.
4. Deploy using the disposable funded Playground wallet.
5. Replace `client/client.ts` with `playground-client.ts` and Run once.
6. Save the complete `RATCHET_PASSPORT_V2_DEVNET_REPORT` and transaction signatures.

The client binds the existing disposable v1 passport mint, accepts one frozen cross-language vector, and requires four negative paths to fail: replay, wrong attestor, account substitution and bad Merkle root.

Passing this gate does **not** authorize metadata updates yet. The next gate creates a new disposable Token-2022 mint whose metadata update authority is the config PDA, then adds `invoke_signed` metadata CPI and authority-recovery tests.
