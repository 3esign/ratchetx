# RATCHET h70 release manifest

**Status:** built and test-verified 2026-08-25 (same evening as h69); production status by live read-back
**Base:** `7a22358` (h69-2026-08-25, verified live)
**Candidate version:** `h70-2026-08-25`

## Scope — three small hardenings, no behavior a player can feel

1. **`action=blockhash` fast path.** The reload signer's hottest request no longer pays
   for a full oracle read, sample pass and challenge sweep it never used — it is now a
   pure RPC passthrough answered before the price fetch.
2. **Anchor log entries are idempotent.** Both anchor paths (explicit and Blink
   auto-credit) now write their log entry with `appendOnce('anchor:<sig>')`, so a
   crash-retry can no longer append the same anchor twice. The XP cooldown and replay
   gates were already idempotent; the log entry was the one non-gated write left.
3. **Shot and challenge ids come from the CSPRNG.** Ids go on-chain (seal v2 requires
   `^[a-z0-9]{1,32}$`) and key replay gates, so `Math.random()` is replaced with
   `crypto.randomBytes` hex (12 chars for shots, 11 for challenges). Old 8-char ids
   remain valid everywhere — nothing parses id shape.

## Explicitly unchanged

No economy, payout, settlement, board, UI, program, authority, or storage behavior
changed. No transaction signed, no SOL spent.

## Verification

Full runner green (browser-fixture suites skip without the layout server, as designed);
`node --check` on changed files: pass.

## Deployment gate

Deploy once from `pumpmind\ratchetx\ratchet_phase_a_clean`, confirm both domains report
`h70-2026-08-25` on state and proof, then smoke-check blockhash, one anchor, and one shot.
