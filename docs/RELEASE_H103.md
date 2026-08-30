# h103 — deterministic owner-session retest and honest proof links

DEPLOYED and public-verified: 2026-08-30T17:41:17.906Z.
Release h103-2026-08-30. Agent Skill 1.2.1; MCP stays 1.2.0 (13 tools).

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

## Pre-release pilot versus then-remaining test

Historical release baseline; see the post-release evidence below for the new pilot.

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

## Acceptance procedure prepared at release

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

## Exact release evidence

- Repository main: https://github.com/3esign/ratchetx.
- Artifact commit: 01ba4f4b22f216c75d65c27339cac3681bd3c380; clean detached
  worktree `.release/ratchetx-h103-20260830`, 334 tracked source files.
- Ordered source-tree SHA256 (h101 definition):
  `98f7909cea85b85d6a6a13920bf67744efafd9afdadba3982d8c6173f5744b6c`.
- Deployment: dpl_9kUJHfdGiBkGpEfgxUUAEgDRmUro, READY, production, domain
  https://ratchetx.xyz; immutable URL
  https://ratchetx-73noy4lq3-3esigns-projects.vercel.app.
- Existing guarded player database prerequisite PASS. No migration was run.
- Exact-artifact 20 focused suites PASS: play_session, play_session_kv,
  play_session_atomicity, play_session_http, play_session_page, critical_paths,
  harness, balance, settle, warden, ranked_remote_protocol, player_write_fencing,
  player_commit_recovery, release_identity, canon, agent_report, shot_page,
  agent_discovery, session_smoke, session_smoke_contract.
- Release-safety and version/digest gates PASS: total22 checks. This is not a
  claim that every repository/browser suite ran. Node24.15.0 tested; Bun and
  actual Bankr X runtime execution were not tested in this release.
- Real-handler fixture proves adjacent identical POSTs dispatch/debit once,
  canonical HIT settlement1000→900→1070, existing13-call Brier .3087→.3011/14,
  and post-preflight ORACLE_STALE refusal without debit/retry. External network
  is blocked. Memory-only status-throttle TTL expiry is explicitly simulated;
  an immediate429 control still passes.
- Vercel59.10.0's actual bundled ignore filter allowed the three intended skill
  files and denied19 private/sibling/helper controls. Public readback also
  confirmed five known private source paths remain404.
- Nineteen production readbacks PASS: six exact static files, skill digest,
  three h103 API identities, canonical pilot proof/report, credentialless401,
  wrong-Origin403 and five private-path404 checks. The public pilot proof now
  displays SEAL RECORDED from retained evidence. No bearer was used.

| Artifact | SHA256 |
|---|---|
| index.html | 3894669b36547ec8a74b7c98642eb5ffddf3fdbfc27abf761b0e308894969f67 |
| play-session.html | f020f7dbb80069ca2f4f37211e1ec032b3cf9b098564f2003b1f76b09ebb4cb7 |
| play-session.js | 221edee9059c5fe71289d8776c69e637a4c0fe9ab117e5af1e43e0586045b2b2 |
| Skill1.2.1 | 1d0955d2c4fbca21eb4299276a78a31cecb2f6322dfeeea61dee364e3bb4afc0 |
| owner-session-test.md | 98d48c1c77b8c8742641b7e929199acf2f98ac3c6aca3fd85c0610a6665d9c23 |
| session-smoke.mjs | 1b6592079a27a912de796d3aa035e67540b7514f982b5cbd850d7998efcc98b5 |

The first readback orchestration command had a syntax error before any requests;
corrected command passed all19. No runtime defect or spending occurred.
Workspace knowledge reference88 is indexed; Solana skill-lint passes. The
optional Python frontmatter validator remains unavailable without PyYAML;
discovery/version tests validate the changed skill's frontmatter and exact digest.

### Historical readiness message before the new pilot

Update the RatchetX skill from 3esign/ratchetx to1.2.1. Read the linked
owner-session-test.md and locate session-smoke.mjs in the installed skill.
Confirm you can execute it with Node or Bun, protected RATCHET_PLAY_SESSION,
and a persistent private journal in this runtime. Do not print the secret.
Do not execute a forecast yet: the previous grant was revoked. No demo
fallback, replacement grant, transfers or reloads. Report readiness and the
runtime; I will create and explicitly authorize the next bounded session.

## Post-release owner pilot: 2026-08-30

Two runs must remain separate. The completed run is shot `6cce3cd29ed6`, not
the prior pilot `16c371304581` or the subsequent stopped preflight.

Bankr reported protected exact-key readiness and the deployed runner SHA256
`1b6592079a27a912de796d3aa035e67540b7514f982b5cbd850d7998efcc98b5`.
After owner approval, it reported session `f1ffe81cfcf79d1c6c3a0d54e4f0c72a`,
target `H496698Q0` (SOL higher in five minutes), YES/p0.55/stake100,
submit HTTP200 and immediate identical replay HTTP200 with idempotent:true.
Its reported receipt hash is
`8ead305b5d0852cf88e22dbc6ad1d6e0f8e5f9dd06dce932f87e2026e50f2fd8`.
The private wire journal was not independently inspected. Label wire replay
Bankr-reported PASS, not independently captured HTTP evidence.

Independent unauthenticated public checks, server dates 18:18:12-13UTC:

- [Shot proof](https://ratchetx.xyz/api/shot?w=HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM&id=6cce3cd29ed6):
  HTTP200, HIT, stake100, return170, rounded entry106.08/exit106.25;
  settlement sample 2026-08-30T18:15:43.000Z; RATCHET SERVER authority and
  pyth-first-observed-after-v3 rule. SHA256 of its published v2 preimage
  exactly matches `68c5080d72d14a03f17eacde4f1cb19f585ac6750ed31ad835e97f5216a964ba`.
- [Owner report](https://ratchetx.xyz/api/agent?id=HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM):
  HTTP200, latest settled shot6cce3cd29ed6, statedCalls15, Brier0.2945,
  PROVISIONAL. Total76 calls describe cumulative owner history, not76 Bankr runs.
- Bankr's balance1452112 ->1452012 ->1452182 is consistent with100 stake and
  170 return (+70 net). HIT/p0.55 contributes squared error0.2025.
  Prior rounded Brier0.3011 across14 calls is compatible with0.2945 across15;
  rounded public aggregates do not independently reveal the exact raw sum.

The public commitment binds wallet, shot ID, side and salt; it does not alone
bind p/stake, prove Bankr authorship or prove HTTP replay. The report's legacy
`not-yet-replayed` is an AgentRun receipt status, with HTTP replay explicitly
`not-assessed`; it does not contradict this separately reported wire test.
No token transfer/reload or new on-chain canonical game settlement is shown.
One owner-scoped Bankr pilot is not global availability to all X users and one
HIT is not evidence of forecasting skill.

### Separate stopped preflight

User then relayed another run: FAILED / ORACLE_STALE / phase:preflight,
journalRetained:false, immediateWireReplayVerified:false, debitObserved:false.
This means the new run reported no shot dispatch; those false values are not
a revision of the completed run's evidence. Preserve its original private
journal. The stopped report supplies no independently checked session identity.

In the pinned runner, age>45s is checked before authenticated session status
and again after status but before journal creation. Thus this output does not
prove the grant is active, unused or usable. It also does not identify whether
publisher cadence, RPC observation or shared relay freshness caused the age.
Do not relax the45s boundary, force an oracle refresh per agent, retry with a
fresh ID, create a grant or switch to demo to obtain another green result.

Closure: preserve completed evidence; owner revokes the latest permission.
Revocation of this new grant is not yet confirmed (the earlier grant was revoked).
This documentation update made no authenticated requests, forecasts, balance
writes, runtime changes or deployment. Reassess onboarding friction separately
from the completed bounded acceptance test.
