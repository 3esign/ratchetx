# Player Passport v2 — checkpoint architecture

The passport remains a game object first: one permanent, non-transferable player identity. The technology below it stays invisible during normal play.

## What v2 fixes

The successful v1 Devnet experiment proved Token-2022 storage and transfer rejection, but its mutable metadata was controlled by the disposable player wallet. Its checkpoint hash also did not prove which passport mint, prior checkpoint, RATCHET log head or player-state root produced the values.

V2 therefore defines a strict checkpoint state machine:

- one immutable player and passport mint;
- sequence increases by exactly one;
- every checkpoint commits to the previous checkpoint hash;
- log index and log head must advance;
- lifetime XP, best streak, shots and podium wins cannot decrease;
- timestamp and epoch cannot move backward;
- a domain-separated achievement Merkle root proves player inclusion;
- fixed-width fields avoid ordinary metadata-account reallocations.

The implementation is in `src/checkpoint-v2.mjs` and `src/merkle.mjs`. It is a pure, deterministic model with negative tests. It does not touch production.

## Intended on-chain flow

1. At a durable boundary, RATCHET builds a sorted achievement tree and appends its versioned root to the public event log.
2. A checkpoint proposal contains the player's canonical leaf, Merkle proof, current log head, prior checkpoint hash and next sequence.
3. A small passport program registry enforces one canonical passport mint per player and the v2 transition invariants.
4. The program PDA, not a browser wallet or server hot key, is Token-2022 metadata update authority and performs the metadata CPI only after validation.
5. The UI displays the passport as a player card; proof details remain optional.

## The honest trust boundary

A PDA can enforce transitions but cannot magically know that an off-chain score is true. A Merkle proof proves inclusion in a published RATCHET root, not the truth of the root itself. The near-term root publisher is therefore an explicit attestor. Anchoring its log head on Solana prevents silent historical rewrites but does not make server-side scoring trustless.

That distinction is essential for more complex financial products: integrity, availability and correctness are separate properties. A reputation passport may accept a disclosed attestor. A redeemable financial liability should not; it needs on-chain accounting, independently reproducible state, or a reviewed fraud/consensus mechanism.

## Program gate

Do not deploy a passport authority program until the model is translated into Rust and tested for duplicate initialization, replay, forked roots, decreasing values, wrong mint/player, stale root, authority recovery and CPI account substitution. The first deployment stays Devnet-only and has no authority over RCX, rewards or the production game.
