# h101 production release — bounded owner-approved play

Latest public verification: 2026-08-30T15:02:28.056Z (h101-ui1).

## UI-only mobile readiness hotfix

- Deployment: dpl_eq1opEjU2aKbGS3mnakFeYEQGDMw, READY and aliased to ratchetx.xyz.
- Immutable URL: https://ratchetx-7gfm0z8rh-3esigns-projects.vercel.app
- Clean isolated artifact: be553c742e66f04786f857c7a731c90a8001cad2.
- 328 tracked source files; same ordered-hash definition below:
  9af036f5f9dd1a55ea147cdf104077567869d614164d17fea1a27e725120e0c7.
- API build remains h101; only play-session.html/js and the focused page test
  changed. No signing contract, database, game, economic or program change.
- Mobile screenshots exposed a UX gate: apiEnabled started false, but connect
  did not run the separate top-of-page availability check. Connected wallet and
  checked consent therefore still left signing disabled without a nearby reason.
- Connect now makes one unsigned same-origin GET. Failed readiness is explained
  beside the disabled action with explicit read-only retry. Consent and the
  pre-signature contract recheck remain required. No automatic grant retry.
- Focused page suite, release safety and version checks passed on the exact clean
  artifact. No repeated full suite or live database mutation was needed.
- Independent mobile390 synthetic browser cases passed connect/consent/ready and
  unavailable/inline-retry/ready: zero signatures, zero POSTs, no page errors or
  horizontal overflow. Browser plugin bootstrap was blocked by Windows ACLs;
  isolated Playwright fixtures were used, not the user's wallet/browser profile.
- Four production GET checks passed: both modified assets match exact bytes,
  session API enabled and no-store/private with shot/status rights, core board OK.
- Build-time guarded database prerequisite PASS. No new credentials or migration.

Updated static SHA-256:

| File | SHA-256 |
|---|---|
| play-session.html | f020f7dbb80069ca2f4f37211e1ec032b3cf9b098564f2003b1f76b09ebb4cb7 |
| play-session.js | 7df309d594874da723e6d05b77bb8446030a343987ff14d64a593dac8813b32a |

The root game and vercel.json hashes remain as recorded below. Actual owner
grant and private Bankr gameplay remain user-driven acceptance, not claims of
this UI verification. Lesson recorded in workspace Solana reference 82.

## Initial full h101 release (historical evidence)

Verified: 2026-08-30T13:47:30.236Z.

- Release: h101-2026-08-30.
- Deployment: dpl_CQfeCv7FAWgL1sHocBWYzmkgXYUk (READY, production).
- Immutable deployment: https://ratchetx-rfg8vbzml-3esigns-projects.vercel.app
- Canonical domain: https://ratchetx.xyz
- Artifact commit: 1b503da6c759cf37c70fc87229c2ab6d98a4e1c0.
- Application implementation commit: 9be7c0efe024127ba7dec78de7d614c0730edbcd.
- Source: canonical ratchetx repository main, isolated clean detached release
  worktree. No local env, backup or credentials copied to the artifact.
- 327 tracked source files hashed. Ordered source tree SHA-256:
  c19b0742304807795fe01ab669616a24ab921e27b502fbf8f1a9ccfb03307035.
  Definition: sort Git tracked paths; hash each exact file; join
  `<file SHA256>  <path>` with LF; hash the resulting text without final LF.
- MCP, Agent Skill, ERC-8004 stay 1.2.0; 13 MCP tools / 12 API functions.
- Database prerequisite: existing Supabase project, migration 003,
  guarded-player-v1; build-time readiness PASS.
- No Solana program or economic parameter was changed.

## Public read-back

17 non-spending checks passed in one production batch:

- Root game HTML, play-session.html and play-session.js return 200 and match
  exact release bytes.
- Board, shared Pyth context and play-session discovery return h101.
- Session discovery is enabled, shot/status-only, no-store, and exposes a
  precise agentContract.
- MCP tools/list returns 13 tools; MCP discovery and registry return 200.
- Missing credential and invalid owner signature: structured 401.
- Other browser Origin: structured 403.
- Transfer/unsupported scope: structured 400.
- Every private-route rejection is no-store.
- .env, backup manifest, operator probe and migration SQL are not served (404).

Static artifact SHA-256:

| File | SHA-256 |
|---|---|
| index.html | 3894669b36547ec8a74b7c98642eb5ffddf3fdbfc27abf761b0e308894969f67 |
| play-session.html | 0601cce9808b14d13be743dee4889cc293f24f404c50de0b60c0568644f7940b |
| play-session.js | b5b183c146e6a77b9a22542d482eb0d81b07e43cf57974219726a98c9cd777c2 |
| vercel.json (source) | bca4abae7af6b90fc740ecc1817355e3a0c9ac5bee243d9a935b08b89d237c59 |

## Tests and what they prove

A complete batch against clean 0f50fc8 produced 75 passing suites, one failing
documentation-env scanner and five skipped legacy browser suites (no :8247
fixture). Every new session service/atomicity/HTTP/page suite passed.

The failure was a real boundary error in the scanner: the private Bankr CLIENT
secret name was assumed to be a Ratchet server env var. Commit 1a53950 changed
only that test and its documentation. Targeted rerun passed 126 checks, including
a negative assertion that Ratchet server code must NOT read that client secret.
Thus all 76 applicable suites were validated; do not describe the first full
batch as having had zero failures. The five legacy browser suites remain skipped.

Independent new-page desktop 1280 and mobile 390 browser QA passed layout,
no overflow / page errors, disabled-preflight controls. Synthetic browser tests
cover wallet changes, exact signature payloads, consent, grant ACK, secret
clearing, metadata ownership and recovery. No real wallet was signed.

The real PostgREST probe used an off-curve, unowned random fixture wallet.
19 requests proved one CAS winner, stale refusal, player/receipt atomicity,
stale-session rollback, exact replay and changed-commit refusal. Exact cleanup
PASS; zero real-player rows read, zero chain calls.
Probe ID: e38858215c5ba3a40995a0dabaded92f.
See tools/play_session_live_probe.mjs and GUARDED_DATABASE_CUTOVER.md.

## Failed build and correction

The first Vercel attempt (dpl_rCaDpgnLYDauJSFhcAR6m5kab1MZ) passed database readiness
but failed because introducing buildCommand defaulted the output to nonexistent
public/. It never replaced live h100. Commit 1b503da explicitly sets
outputDirectory to "." for the existing root static site; the focused build-gate
test now pins both readiness command and root output. Game/authorization/UI bytes
were unchanged from the full regression batch. The second build completed and
was read back as above.

[Official Vercel output-directory contract](https://vercel.com/docs/builds/configure-a-build#output-directory).

## Truth and permission boundaries

The deployed feature is an OFF-CHAIN Ratchet play capability backed by guarded
database state. Pyth inputs remain validated Solana PriceUpdateV2 observations;
canonical credit/outcome/Brier settlement remains the existing server reducer.
It is not native Bankr Solana signing, a token allowance, a new Pyth collector,
global X installation, proof of autonomous Bankr authorship or a funded pilot.

Owner controls: https://ratchetx.xyz/play-session.html
Agent discovery: https://ratchetx.xyz/api/game?action=play-session

Default owner consent: 1 reserved attempt, 500 existing play credits per attempt
and total, 30-minute expiry, 60-second minimum interval. Signature is a message,
not a transaction. It grants no transfer/reload/registration authority.

No user's wallet grant, token transfer, reload or forecast was executed here.
Next acceptance is user-driven: sign the bounded grant, privately store
RATCHET_PLAY_SESSION in the user's Bankr Env Vars form, verify private status,
then explicitly approve one short-horizon shot plus replay and terminal result.
Choose a horizon that completes before the grant expires for the first test.

## Recovery / remaining work

Never roll back to h100's unconditional player writer after guarded player state
exists. Do not remove the guard trigger or reapply migration 001. Recover forward.
User revocation stops new session reservations; already-reserved work can finish
within signed expiry. Owner status/recovery survives revoke/expiry and never
redispatches or restores allowance. Normal owner gameplay remains available.

Before claiming Bankr-X integration complete, demonstrate protected per-viewer
secret injection without app-owner fallback, one explicitly approved shot,
stable replay, terminal Brier/credits/proof and revocation. Funding is only for
Bankr's test if needed and requires exact separately approved wallet/amount.

Exposed API/database credentials still require coordinated rotation. No rotation
or paid plan upgrade was performed. Supabase quota warning and future runtime
pinning (package engines currently >=18, deployment used Node 24) remain separate
operator work, not reasons to claim this pilot already demonstrated.
