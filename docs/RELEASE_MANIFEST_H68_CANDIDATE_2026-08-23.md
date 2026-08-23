# RATCHET h68 release candidate manifest

**Status:** release candidate; production status must be established by Git/Vercel and live endpoint read-back
**Base production commit:** `c321798c36258ace77c0963067f5ae8c22b75799` (`h67-2026-08-23`)
**Candidate version:** `h68-2026-08-23`

## Scope

- One shared v1/v2 commitment implementation now creates and verifies seals.
- Public shot proof verifies v2 as `RATCHET|v2|wallet|shotId|SIDE|salt` and still verifies legacy v1.
- Negative tests reject a changed wallet, shot id, or salt.
- State, Proof, and Record identify `ratchet-server` as the canonical settlement authority.
- Pyth wording now says “first fully validated transition captured by RATCHET” rather than claiming
  an unseen global first update.
- Proof exposes latest-anchor age and distance from the current log head. The declared SLO is green
  through 24 hours and 500 entries, warning after either threshold, and red after 72 hours or 2,000 entries.
- Record schema 3 adds `settlementAuthority` and `oracleSource` without changing existing meanings.
- The mobile audit uses the current `.tgt` cards and lexical `STATE` object.

## Explicitly unchanged

- No credit economy, payout, podium, settlement-rule, question-generator, wallet, or UI behavior changed.
- No Solana program, program authority, token account, mint, or RPC setting changed.
- No transaction was signed and no SOL was spent.
- The optional mainnet Seal v2 remains evidence of pre-expiry commitment only; it is not the canonical referee.

## Verification

- Focused commitment, shot-page, Record, and Record API tests: pass.
- Full runner: 28 passed, 5 fixture-browser suites skipped, 1 startup-browser test initially lacked
  the clean clone's Playwright dependency.
- The single startup recovery test was rerun with the existing local dependency installation and passed.
- `git diff --check`: pass.
- `node --check` on all changed JavaScript files: pass.

## Deployment gate

Promotion requires: review the diff, commit it, deploy once, confirm both domains report
`h68-2026-08-23`, run state/proof/record/shot smoke checks, then have the user sign one current log-head
anchor. Never report h68 as live before those checks succeed.
