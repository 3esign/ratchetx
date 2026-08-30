# h103 — deterministic owner-session retest and honest proof links

Candidate: h103-2026-08-30. Agent Skill 1.2.1; MCP stays 1.2.0 (13 tools).
Deployment evidence is appended only after the exact artifact is verified.

## Scope

- Correct report links to `/api/shot?w=OWNER&id=SHOT`; add the canonical report
  link and retained settled-shot links. Open shots remain sealed. A compact
  history receipt may outlive its full closed-shot page: expose availability.
- Preserve legacy `not-yet-replayed`, adding explicit AgentRun receipt meaning
  and `httpSessionReplayStatus:not-assessed`. An AgentRun audit receipt is not
  evidence of HTTP replay, independent historical Pyth replay or x402 payment.
- Remove `Date.now()` fallback from old proof headers. Modern shots lack `t`;
  use the exact retained `g:log:once:seal:<wallet>:<shotId>` receipt and label it
  SEAL RECORDED, not original entry time. Preserve legacy stored timestamps;
  missing evidence displays ENTRY TIME UNAVAILABLE.
- Separate failed unsigned availability GET from uncertain signed POST.
  Explicit GET retries are safe; signed writes retain owner recovery guidance,
  session ID retention and no automatic retry.
- Ship a zero-dependency, one-shot 100-credit Node/Bun client with explicit
  execution approval, expected owner/session, private exclusive journal,
  immediate identical wire replay, bounded polling and status-only resume.
  Bankr installs Skill 1.2.1; no account-bound MCP capability expansion needed.

No game economics, admission, oracle thresholds, settlement selector, guarded
database schema, Solana program, token signing, transfer, reload, Pyth collector,
paid infrastructure or background scheduler changes. Existing credits and
outcomes remain server-canonical using validated Pyth PriceUpdateV2 on Solana
mainnet. `independentPythReplay:false` remains explicit.

## Completed pilot versus remaining test

The prior owner-session pilot used wallet
HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM and shot 16c371304581.
Its public shot page independently showed HIT, 100 credits staked, 170 returned;
the owner report showed 14 stated forecasts, aggregate Brier 0.3011. Bankr
reported final balance 1,452,112 (+70 net). The 75 total calls were cumulative
owner history, not 75 Bankr tests. Neither public page proves caller identity.

Wire replay was NOT executed for that pilot: request-map inspection is not a
second HTTP POST. Bankr later returned HTTP401 SESSION_REVOKED. Do not reuse
the old capability, restore its allowance or create a replacement on the user's
behalf. This release does not spend credits or authorize another live attempt.

## Next user-approved acceptance

Read the installed skill's `references/owner-session-test.md`. The owner creates
one new 30-minute permission, ideally 1 attempt / 100 per-attempt / 100 gross;
stores its bearer privately as RATCHET_PLAY_SESSION in Bankr's agent environment;
then explicitly approves the one-shot test with public wallet/session IDs.
The runner itself never requests or prints that credential.

Choose a current five-minute directional board target, explicit side and p.
No demo fallback, new identity, funding, transfer or reload. Interrupted work
resumes from the same private journal using status only. No full PASS without
durable immediate wire evidence and isolated one-shot accounting. Refusal,
uncertainty, concurrent owner activity, expiry and revocation are honest stopped
or inconclusive outcomes, not excuses for another request ID.

X initiation must still be tested in that user's runtime. Portable code and
prior web/agent execution do not establish global X support. No public secrets
or app-owner credential fallback are allowed. Keep the viewer cockpit read-only.

## Release gates and rollback

Focused batches include the session adapter, guarded writes/recovery, reducer,
report/proof pages, skill discovery, runner fault fixtures and real-handler
runner integration. The latter uses a synthetic in-memory owner and blocked
network; it is not a live funded test. Check exact deployed skill/runbook/runner
bytes, public contract/version, canonical pilot proof/report, and credentialless
private-status refusal. Record counts, exclusions and hashes below.

Forward-only recovery: never remove migration003 guards or restore pre-guarded
h100 writers. h103 changes are additive; keep existing owner revoke/recovery
paths available. Stop distributing the optional runner if its client regresses;
no backend economy rollback is needed. Old h102 signed sessions retain their
same limits and server semantics.

Operator backlog remains separate: coordinated rotation of exposed API/database
credentials, Supabase quota headroom and future on-chain migration. No credential
rotation, paid-plan purchase or new wallet transaction is implied by this release.
