# RATCHET h56 production audit

Date: 2026-08-22
Status: LIVE ON VERCEL - BOTH DOMAINS VERIFIED; CLOUD SAMPLER ACTIVE

## Verdict

The h56 candidate fixes the reproducible session-recovery failure, removes agent-only
actions from the player killfeed, corrects misleading telemetry and proof status, and
adds a laptop-independent minute sampler path. The full local suite passes: 31 passed,
0 failed, 0 skipped. npm reports 0 known vulnerabilities.

This is an application audit, not an independent smart-contract audit. DEX promotion
must not describe the modeled floor as redeemable or the legacy mainnet settlement
program as the live referee/vault.

## Production evidence observed before h56

- Both public domains served h55 with durable Supabase storage and Pyth-on-chain prices.
- The prior 24-hour observatory contained 735 of 1,440 expected minute samples (51.04%).
- No active local heartbeat process or Windows scheduled task was found. Minute sampling
  therefore depended on traffic or an intermittently running laptop process.
- Historical event 345 is missing: 785 sequence numbers were issued and 784 stored at
  inspection time. This is historical evidence debt and cannot be honestly painted green.
- The vault is not deployed and the displayed floor remains a projection.
- Program 4WQ4XTzC29M6YoxgNi9WHhYJWEtYyj6YNFtSB9yCM6E2 is legacy engineering evidence,
  not the live referee and not a redeemable vault.

## h56 corrections

1. State requests now abort after 12 seconds and retry automatically with bounded
   exponential backoff. Recovery is in-place, so a wallet session is preserved and a
   manual browser refresh is not required.
2. Agent events remain in the append-only evidence log and Arena API, but are filtered
   out of the player-facing killfeed.
3. The proof endpoint now reports sampler freshness and one-hour duty separately from
   Pyth feed health. Missing minutes are disclosed because they can cause a valid shot
   to void/refund.
4. The Black Box cannot claim a complete recoverable log while the event chain is
   missing entry 345. Snapshot existence and chain completeness are separate facts.
5. Ambiguous Coinbase JUP-USD is no longer compared with the Jupiter token's Pyth feed
   or used as its display fallback. It never affected real settlement, which requires
   the Pyth source.
6. A dedicated /api/game?action=heartbeat route samples without an unnecessary Solana
   blockhash request. The included Cloudflare Worker can call it every minute; sampling
   is lease-gated and minute-deduplicated.
7. Public metadata and dependency copy now disclose Supabase/Postgres, server-side
   scoring, the legacy program, and the absence of a vault accurately.

## Verification

- Syntax: game API and Cloudflare worker pass node --check.
- Dedicated heartbeat test: pass; it samples once and returns explicit health.
- Browser recovery: pass with the first state request deliberately hung beyond 12s.
- Responsive/browser suites: pass against the real local page fixture.
- Total: 31 passed, 0 failed, 0 skipped.
- npm audit --omit=dev: 0 vulnerabilities.

## Remaining release gates

1. Vercel h56 deployment and both-domain marker checks are complete.
2. Cloudflare minute scheduler is active; wait for the proof sampler to show at
   least 90% one-hour coverage with a sample age below 120 seconds.
3. Confirm production state reports durable=true, storage=supabase and src=pyth-onchain.
4. Confirm the public state feed contains no agent entries and recovery works under a
   deliberately interrupted request.
5. Keep the historical gap, no-vault status and legacy-program status visible.
6. Only then update the isolated GitHub repository and use the public links for a paid
   DEX submission.
