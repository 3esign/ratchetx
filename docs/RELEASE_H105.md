# h105 — Bankr entry and bounded X commands

Deployed2026-08-30. Agent Skill1.3.0, MCP1.2.0 unchanged.

## Delivered scope

- Gold PLAY WITH BANKR landing link opens the existing wallet-approved session
  page. Native anchor; no connection, signature, permission or play on click.
- One100-credit and five-request/500-credit presets reset consent. Each forecast
  remains a separately requested action; the preset never starts autoplay.
- Copyable public stats and one-play X commands bind the exact owner/session.
  Play copies get a public command nonce. No credential is included. Owner
  lifecycle checks clear stale commands, including after async clipboard work.
- `session-play.mjs` supports status, one five-minute directional execution and
  status-only resume across a multi-attempt grant. Stable request IDs bind owner,
  session and external command ID, independently of the prediction intent.
- Private exclusive durable journal precedes dispatch; immediate identical wire
  replay, signed remaining caps, one-open-shot, interval, fresh Pyth, accounting
  and rounded Brier checks retain PASS/PENDING/INCONCLUSIVE distinctions.
- Original one-attempt `session-smoke.mjs` is unchanged. Exact public companions
  are allowlisted in deployment, and skill/catalog/registry digests are aligned.

## Security and limits

Public wallet/session/command IDs and claimed X headers never authorize play.
Ratchet authenticates the private wallet-approved bearer. Bankr must verify its
trusted platform requester before accessing the same user's environment; unknown
or mismatched requester stops. This is NOT cryptographic X identity binding.
A stolen bearer can spend its remaining allowance until revoked/expired.

Manual private `RATCHET_PLAY_SESSION` replacement is still required for each new
grant. No automatic pairing, profile edits, background schedule, transfers,
reloads, new permissions, demo fallback or global Bankr integration is added.
No backend economics, oracle threshold, settlement rule, database migration or
on-chain program is changed. Prior operator credential rotation remains separate.

## Verification

Release baseline batch:12/12 PASS (release safety/version gates, release identity,
session service/HTTP/KV/atomicity/discovery/owner-isolation/UI and original smoke
engine/real-handler contract). New runner fixture and real-handler contract are
separate additional gates. The real-handler fixture uses an in-memory backend,
two commands under one grant and zero external connections; it checks duplicate
delivery, changed intent and stats do not create an extra debit.

Independent review caught string/number command-ID ambiguity, unvalidated status
expiration output and fractional journal timestamps invalidating resume; fixes
must remain covered by the runner tests. Skill forward-check and production
byte readbacks are recorded below after completion.

Browser-control runtime failed during setup with a Windows sandbox ACL error.
UI assertions are isolated DOM fixtures/static checks, not browser visual QA.
No new live Bankr/X execution, real wallet signature or valid capability is used
for this release. The prior owner pilot remains evidence for the old smoke path,
not a claim that the new controller has already completed a live X pilot.

## Publication

Candidate gates PASS:14 isolated suites/gates, runner CLI help and whitespace.
Independent skill routing check passed stranger rejection, owner stats-only and
duplicate-command handling; missing-journal status-only guidance was clarified.
Generic Python skill validator could not run because PyYAML is absent; manual
frontmatter/reference review and repository skill version/digest checks passed.
Production verified2026-08-30T19:41:43.189Z:17/17 readbacks PASS.
Code commit976acae0286671ef6b86cc688a0f2843d30a6297; deployment
dpl_ABvkjDZ4kV4V5fG5MGE8vLsMKmiK; immutable URL
https://ratchetx-4kfwv42i5-3esigns-projects.vercel.app; aliashttps://ratchetx.xyz.
Nine public artifacts match clean release bytes, three API surfaces reporth105,
three private paths remain404, unauthenticated status returns401 and GitHub runner
matches deployed bytes. Guarded DB prerequisite passed; no migration performed.
Runner SHA256:4f83c659ab3e8e4a8a876c705ee55e86d7c66088e9b07076fb3168eb2cf5700c.
This publication record is a subsequent docs-only commit, not a different deploy.
