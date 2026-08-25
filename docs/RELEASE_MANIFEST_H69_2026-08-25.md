# RATCHET h69 release manifest

**Status:** built and test-verified 2026-08-25; production status must be established by live endpoint read-back
**Base production release:** h68-2026-08-23 line, commit `58b057f` (includes post-h68 fixes: full-address podium validation, lease-expiry rescue, raised rate limits, savePlayer drain guard)
**Candidate version:** `h69-2026-08-25`

## Scope — two reload-verification bugs, one leak class, workspace hygiene

### 1. Pure burns are honored again (`lib/burn.js`)

The strict podium-snapshot matcher introduced with the Champion's Cut refused every
plain wallet→incinerator burn: no champion legs match no snapshot by construction,
so the player's RCX was already destroyed on-chain and the game paid nothing — while
the page still said "paste the signature and we will credit it." A reload with ZERO
champion legs whose outflow verifiably left circulation is now accepted as
`podiumVersion: 'pure-burn'` and credited at its full outflow. Nothing widens:
transfers to any non-podium wallet, over-cut legs, and mismatched splits are refused
exactly as before (pinned by tests).

### 2. The ghost seat (`lib/burn.js`)

Reconstructing `gross = round(destroyed / 0.70)` rounds one token high whenever the
split carries dust. That token was attributed to the reloader as a phantom
"retained share" even when they held no podium seat, the fabricated entry made
`expected.size !== observed.size`, and **every dust-carrying reload from a wallet
without a podium seat was refused**. The three wallets active in production all held
seats, which is why it never fired. The retained-share reconstruction now applies
only when the reloader has a seat in the snapshot being tested.

### 3. Deploy surface locked down (`.vercelignore`, `.gitignore`, `.gitattributes`)

`onchain/` (which briefly contained unignored local signer keypairs), `docs/`,
`token/`, `agent/`, `ops/`, `supabase/`, `scripts/`, `*.cmd` and `*.md` no longer
upload with a deploy — the deploy is the site and its API, nothing else. Keypair
patterns (`*keypair*.json`, `*.keys/`, `id.json`) are globally ignored in git as
well. `.gitattributes` pins LF for code and CRLF for `.cmd`, ending whole-file EOL
flips that buried real diffs. All published doc links point at GitHub, not the site
(verified by `test_evidence.mjs`), so excluding `docs/` breaks nothing.

### 4. Prototype passport endpoints removed

`api/passport.js` (returned a raw `mintSecretKey`; targeted a case-mangled
program ID) and `api/blink-passport.js` (mainnet blockhash on devnet-prototype
instructions) are removed from the production tree per the Core-experiment
handoff's own rule. The experiment continues in `onchain/core-passport-benchmark/`.

### 5. Expired-row sweeper (`supabase/002_ratchet_kv_sweep.sql`, heartbeat)

Postgres never deletes expired KV rows on its own; they were invisible to reads but
grew the table forever. The minute heartbeat now lets one instance per hour win a
lease and delete bounded batches (500 × ≤8). Guarded: a missing SQL function or a
stub backend can never fail the heartbeat. **Operator step: run
`supabase/002_ratchet_kv_sweep.sql` once in the Supabase SQL editor** — until then
the sweep is a harmless caught error and `swept` stays 0.

## Explicitly unchanged

- No credit economy, payout, podium-selection, settlement-rule, question-generator,
  or UI behavior changed. The 70/30/0 split is untouched — a pure burn gives MORE
  than the split requires, and is credited at outflow exactly as the original
  reload promise stated.
- No Solana program, program authority, token account, mint, or RPC setting changed.
- No transaction was signed and no SOL was spent.

## Verification

- Full runner: **30 passed · 0 failed · 5 skipped** (the five browser-fixture
  suites skip without the layout server, as designed).
- New suite `test_pure_burn.mjs`: 21 assertions — pure burn credited in full;
  empty-podium 100% burn accepted; a champion's manual pure burn accepted;
  snapshot-matching 70/30 reload still verifies via the snapshot path; outside
  transfers, over-cut legs and mismatched splits still refused; 40-token and
  1,000,003-token dusty reloads from a non-seated wallet verify; a seated
  reloader's retained share still reconstructs (948 for the 6,316 shape seen live).
- `node --check` on every changed JavaScript file: pass.
- Playwright startup-recovery suite: pass.

## Deployment gate

Deploy once from the canonical tree only
(`pumpmind\ratchetx\ratchet_phase_a_clean`), confirm both domains report
`h69-2026-08-25` on `/api/game?action=state` and `/api/proof`, confirm
`/api/passport` and `/api/blink-passport` return 404, confirm
`/onchain/core-passport-benchmark/player-keypair.json` returns 404, then run the
state/proof/record/shot smoke checks. Run the 002 sweeper SQL in Supabase. Rotate
the two keypair files that sat unignored in the tree (treat as compromised on
principle). Never report h69 as live before those checks succeed.
