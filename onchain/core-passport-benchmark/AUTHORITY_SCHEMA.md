# RATCHET Core passport — proposed authority layout

This is an isolated Devnet experiment. It does not touch RCX, production game state, rewards or any mainnet authority.

## Minimal object

- One MPL Core Asset owned by the player.
- Player wallet remains the Asset update authority for human-readable identity metadata.
- One JSON `AppData` partition contains durable RATCHET checkpoint state.
- A separate RATCHET state authority is the `dataAuthority` and can write only that AppData partition.
- The player remains plugin authority so state-authority rotation/recovery cannot be silently captured by the server.
- A player-controlled `FreezeDelegate` freezes the Asset after creation for the non-transferable experiment. This is deliberately weaker than Token-2022 `NonTransferable`; the benchmark must report that difference rather than hide it.

## AppData payload

The JSON payload is canonical and versioned: player, sequence, previous checkpoint hash, checkpoint hash, log index/head, achievement-state root, lifetime XP, best streak, shots, podium wins, RCX burned, epoch day and timestamp. Integer values are decimal strings to avoid JavaScript/DAS precision loss.

## Test questions

1. Can ownership remain with the player while only RATCHET checkpoint data is writable by a separate authority?
2. Does DAS expose every JSON update, and with what indexing delay?
3. What are create/write/fetch costs and compute compared with the Token-2022 baseline?
4. Is player-controlled FreezeDelegate the correct Core model, or should a custom Oracle/lifecycle plugin enforce soulbound behavior?
5. Should many passports use collection-level `LinkedAppData`, or does per-Asset AppData give the safer authority boundary?

The authority layout is intentionally the item requested for Metaplex review before any production design decision.
