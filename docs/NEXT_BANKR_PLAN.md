# Bankr continuation plan — 2026-08-30

## Start here / current evidence

h105 adds the landing CTA, owner-session presets, public copy commands and skill
1.3.0 `session-play.mjs`. MCP stays1.2.0. See RELEASE_H105.md for14 focused gates
and17 production readbacks. New reusable runner passed fixtures and real in-memory
handlers; the new Bankr/X end-to-end pilot is NOT yet verified. Earlier owner
smoke pilots are separate evidence. Do not reuse credentials pasted into chat.

UI-only follow-up235e0b3 adds ten-attempt/10,000-per-attempt/100,000-total/four-hour
preset and explains allowance versus balance, requested stake and cooldown.
UI regression passed. Deployment verification follows in RELEASE_H105.md.
No auto-play, scheduler, secret pairing, profile editing or on-chain migration was
implemented. Bankr's reply behavior is not something Ratchet can guarantee.

## 1. Finish one manual owner pilot — highest priority

- Update Bankr skill from3esign/ratchetx; stage BOTH session-play.mjs and its
  imported session-smoke.mjs. Preserve protected per-user env and durable journals.
- Owner approves a fresh SMALL grant and stores RATCHET_PLAY_SESSION privately.
  Explicitly verify expected owner/session and Bankr trusted requester account.
  No stranger's quote, tag or copied public IDs authorize use of another account.
- Stats first; then one explicitly requested100-credit play, exact wire replay,
  terminal settlement, balances/Brier/proof; next distinct command under same
  grant, then revoke and verify refusal. Reusing one command must not debit twice.
- Preserve sanitized receipt/wire evidence and journal hash; never commit secrets.
  No automatic funding, replacement grants, larger stakes or demo fallback.
- Acceptance: Bankr actually executes the new runner from the owner's X command,
  not just reports readiness. Wrong actor must stop before secret access. If
  trusted requester metadata is unavailable, block rather than infer identity.

## 2. Remove stake-copy friction before wider use

Current COPY ONE PLAY explicitly requests100, regardless of the signed cap.
Add a separate, clearly labeled Requested stake input to the command panel.
Default100, never silently raise to the grant maximum; require an explicit user
selection. Validate integer100–10,000, per-attempt and remaining gross limits;
live runner/server remain authoritative for balance and final acceptance.
Show "allowance remaining" separately from "credit balance" and timestamp reads.
Copy includes exact stake, owner, session and fresh public command ID; no secret.
Acceptance:100vs10,000, invalid/fractional/exhausted values, wallet/session changes,
duplicate command delivery and expired/revoked state covered. Copy never plays.

## 3. Optional auto-play — design first, disabled by default

Cooldown is NOT a schedule. Define a separate owner-approved run plan containing:
owner/session/run ID, stake, frequency, maximum attempts, maximum gross spend,
end time, allowed target scope and explicit strategy/selection discretion.
Its bounds may be narrower, never wider, than the signed grant. Replacing a grant
must not silently renew the run. Unused allowance is not consent to start a run.

First verify whether the owner's Bankr runtime supports durable scheduled jobs
and trustworthy actor/account binding. Do not promise automatic X replies or add
an always-on paid service without approval. If unsupported, keep manual commands.

Use durable state: STOPPED → ARMED → CHECKING → RESERVED → OPEN → SETTLED;
PAUSED/EXPIRED/REVOKED/UNCERTAIN stop new dispatch. One unresolved/open shot at a
time, no overlapping workers or catch-up burst. Stable request ID per run+slot,
atomic lease/fencing and exact replay; persist/fsync before any dispatch.
Pause on stale oracle, refusal, insufficient balance, uncertain transport,
missing journal or concurrent-accounting change. Never auto-reload or create grants.
Owner Stop prevents new reservations; an already reserved attempt may finish.
Revoke must remain available on another device. Stats cannot resume the scheduler.

Acceptance before funded operation: offline fake-clock tests for duplicate jobs,
restart before/after dispatch, two workers, revoke/stop race, replacement grant,
expiry, insufficient funds, stale/conflicting oracle, overlap, missed ticks,
VOID allowance handling and cross-user spoofing. Then one separately approved,
capped owner pilot. No increasing authority simply because the test passed.

## 4. Link-once pairing and other users — separate security project

Today a private bearer authorizes play; public IDs do not. This is NOT a
cryptographic X identity binding. Anyone who steals the bearer can use allowance.
Prove Bankr per-user isolation before expanding. A notification webhook is not
credential delivery. Use a reviewed owner-signed, principal-bound, expiring,
single-use claim protocol if actual runtime support exists; otherwise retain
manual secret setup. Never ask for Bankr master API keys. See section5 of
BANKR_VIDEO_AND_CLAWRENA_PLAN.md and root Solana reference93.

## 5. On-chain roadmap / operational safety

Follow ONCHAIN_MIGRATION_PLAN.md gates, not "move every UI byte on-chain".
First reconcile obligations and rotate previously exposed operator credentials;
check quota headroom. Then define chain-verifiable oracle selection, withholding
and expiry rules; implement atomic credit/debit/idempotency/settlement/scoring
kernel and bounded delegation. The HTTP bearer is NOT a Solana signer.
Require JS/Rust parity, measured cost, adversarial tests and capped pilot before
legacy state migration. Preserve Pyth attribution and current economic rules.
Disable current API/DB/keeper in acceptance testing: independent clients must
still play, settle, revoke and verify. Full-chain success is not claimed today.

## Handoff discipline

Read AGENTS.md and current state/release files; inspect git status before edits.
Batch focused tests; never rerun live-funded tests without fresh explicit scope.
Do not delete another agent's work. Record new pitfalls in root skills/solana.
See reference94 for per-command dedup, owner lifecycle and identity boundaries.
User has very limited usage: prefer one bounded milestone and honest proof over
new architecture sprawl. Hackathon fee routing needs the separate explicit consent
described in BANKR_VIDEO_AND_CLAWRENA_PLAN.md; no fee recipient was changed.
