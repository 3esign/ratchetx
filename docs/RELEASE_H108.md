# h108 - 2026-09-02 (prepared; production verification pending)

Server: seal XP, skill XP and the HIT payout are computed by `lib/core_rules.js`
— the frozen Core v1 rules in exact integer arithmetic, the same function for
function as `onchain/ratchet-core/programs/ratchet-core/src/lib.rs`, pinned to
each other by `onchain/ratchet-core/vectors/core-rules-v1.json` (printed by the
program) and `test/test_core_vectors.mjs`.

What changes for a player: nothing visible in almost every case. The old float
shortcuts drifted only on exact ties — `50 * 1.15` is `57.5`, which the rule
rounds up to 58 while the float 1.1499999999999999 gave 57. Seal XP for
directional targets and challenges, and `Math.floor(stake * 1.7)`, are
identical to before for every stake (checked exhaustively 100..1e6). The
reason to do it now: the ledger a wallet will migrate on-chain with must be the
ledger the program would have written. No settlement, credit, payment or
oracle rule change; the 70/30/0 split is untouched.

Also in this series (no server change): Core v1 second build after two LiteSVM
findings (mint not `mut`; sqrt precision), the `svm-tests/` battery and the
golden vectors — see `docs/CORE.md`.

Verify after deploy: `board.v == h108-2026-09-02`, `board.token.mint ==
FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump` (the h107 block, if h107 was
skipped); then update `docs/AGENT_STATE.json` productionRelease /
productionDeployment.
