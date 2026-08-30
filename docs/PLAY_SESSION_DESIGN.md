# Bounded Bankr play sessions

2026-08-30 — h101 release candidate. Migration 003 is installed. The HTTP
adapter, canonical shot bridge, owner recovery and private consent page are now
implemented. Check AGENT_HANDOFF.md / AGENT_STATE.json for the actual deployed
commit; code or a green fixture alone is not a hosted Bankr execution proof.

## What the owner authorizes

Open https://ratchetx.xyz/play-session.html in a wallet-capable browser.
An already admitted arena wallet signs a canonical Ed25519 MESSAGE, not a
transaction. The small default is one reserved attempt, 500 play credits per
attempt / total, 30 minutes, and a 60-second minimum interval. Only the user's
signature activates a grant; loading the page does not play or fund anything.

The credential permits only shot and status against that wallet's EXISTING play
credits and public forecasting record. No token transfer, RCX reload, registration,
recipient change, new grant, paid proof purchase or Solana signing is delegated.
Admitted means an existing registered agent with normal RCX qualification OR
existing x402 entry; it does not create an alternative admission path.

A wallet connected on Ratchet can differ from the Bankr-held wallet. Their
balances and records stay separate. Possession of a capability does not prove
Bankr or X-handle authorship. This is off-chain game authorization, not a
Solana session-key program or a token allowance.

## Secret transport and owner controls

The browser creates 256 random secret bits, plus a 128-bit grant ID:
`rxp1.<owner-wallet>.<32hex-id>.<64hex-secret>`.
The owner signs SHA-256 of the WHOLE token and exact limits, domain, network and
version. The server stores only its hash. The bearer is shown only after a matching
grant acknowledgement, never saved by the page or placed in a URL.

Bankr's documented Settings → Env Vars is the intended protected per-user entry
surface. Suggested name: `RATCHET_PLAY_SESSION`. User enters the value ONLY in
the private form, not a chat/prompt/tweet. This is a Bankr per-user CLIENT secret,
not a Ratchet/Vercel server environment variable or shared application credential.
The runtime must inject it server-side
for ratchetx.xyz only, refuse redirects, redact logs and never fall back to an
app owner's secret for another viewer. Those hosted Bankr properties still need
a real private-runtime acceptance test; this page cannot verify them.

Owner status, revoke and recovery require fresh, separately scoped signatures.
Owner status/recovery remain available after expiry or revocation. Optional
browser persistence saves only wallet + session ID; changing connected wallets
must not relabel ownership. A lost grant ACK discards the bearer but retains the
non-secret ID for owner inspection/revoke. Clearing the page/clipboard is NOT
revocation.

Sources: [Bankr advanced features](https://docs.bankr.bot/agent/advanced/),
[viewer/owner permissions](https://docs.bankr.bot/apps/permissions/).

## HTTP contract

One existing function: `/api/game?action=play-session`. No new MCP tool or
thirteenth Vercel function. MCP / skill versions remain 1.2.0.

- GET: public, unsigned availability + machine-readable `agentContract`.
- POST: JSON only, strict action/field allowlist, no query parameters except
  `action=play-session`, no-store/private response, canonical browser Origin only
  (server-side requests may omit Origin).
- Grant/revoke/owner-status/recover:
  `{op, payload: "<exact canonical JSON>", signature: "<base64 Ed25519>"}`.
  The bearer cannot authorize any owner operation.
- Agent requests: `Authorization: Bearer <private capability>`.
  Body `{op:"status"}`, or
  `{op:"shot",intent:{requestId,target,side,p,stake}}`.
- requestId: 32 lowercase hex; target: exact live board target ID; side YES/NO;
  p: 0.01–0.99 at 0.01 precision; stake: integer 100–10,000 AND within the grant.
- A request ID must be retained and reused only for the identical intent. Never
  invent a new ID to work around an ambiguous response.
- Status uses canonical settlement / savePlayer, returning credits, open/closed
  shots and Brier fields. Poll after expiry; 5-second wallet rate cap.
  It does not invoke the broad state route's optional staking/anchor work.
- 202 ATTEMPT_UNRESOLVED / reserved receipt means stop dispatching and inspect
  status or ask for signed owner recovery. It is NOT a failed-payment refund.

Only durable Supabase mode exposes live session operations. Redis/memory tests
do not authorize a production fallback. Build requires guarded-player-v1 readiness.

## Authority, debit and recovery are different operations

The signed budget rule is `gross-reserved-attempts-v1`, NOT accepted calls.
A successful reservation permanently consumes attempt + gross allowance even if
the shot is refused or the response is uncertain. Reservation itself never
debits game credits. A canonical VOID refund does not replenish delegated
authority. Limits must not silently change to accepted-only accounting.

The winning reservation CAS returns a WeakMap-branded in-process permit bound to
exact persisted target/side/p/stake/request ID. Caller JSON cannot forge it.
An internal request also carries a brand and an exact generated body; the canonical
game verifies it before replacing normal wallet-auth verification.

Acceptance is ONE guarded database commit containing:

1. The current fenced player's debit and newly sealed canonical shot.
2. Queued-credit adoption when applicable.
3. The full expected-session CAS and terminal accepted receipt (shot ID).

A receipt is never accepted by an independent follow-up SET. Lost ACK retries
reuse the same guarded commit ID. After an ambiguous ACK, receipt lookup does
not execute another shot. A retained session receipt remains authoritative even
after a shot disappears from the bounded open/closed player ring.

Revocation blocks NEW reservations. Already reserved work may finish, preserving
revokedAt in a full expected-record CAS. Commit admission is additionally bounded
by grant expiry, using min(player lease deadline, grant expiry) at the database.
A branded worker may read its own terminal receipt after expiry/revoke to report
truth; this does not reopen external bearer status or grant fresh authority.

Unknown outcome blocks another attempt AND grant replacement. Recovery takes the
same player lease, reads/tracks the unchanged player without adopting queues, and
atomically writes that fenced player plus reserved → rejected terminal receipt.
This fences late dispatch without scanning historical rings, retrying a shot,
restoring allowance or touching tokens. A terminal accepted request simply
returns the existing receipt. Owner recovery can still safely fail with conflict.

The outer API must await its private sub-handler before its finally releases
leases. Returning its promise without await releases too early and leaks leases
subsequently acquired by the child handler.

## Test and release evidence

Focused suites:

- test_play_session.mjs: exact signed scopes, budgets, concurrent reservations,
  restart/replay, revocation and expiry.
- test_play_session_atomicity.mjs: canonical bridge + player/receipt commit,
  one/two lost ACKs, stale worker, recovery races, retained receipt after ring
  eviction, forged/stale owner commands and database admission expiry.
- test_play_session_http.mjs: actual game handler, grant/shot/status/recovery,
  credits + settlement/outbox, no redispatch, request privacy and lease cleanup.
- test_play_session_page.mjs: synthetic browser controller, canonical signing
  payloads, wallet switches, matching ACK, private credential lifetime, owner
  controls and fail-closed preflight.
- Existing guarded SQL/core tests remain the deployment regression gate.

The separate operator probe tools/play_session_live_probe.mjs uses exact random
off-curve fixture keys only, no real wallet, funds, Pyth update, activity row or
forecast. Actual run result and final suite counts belong in the release manifest.

The new consent page has isolated desktop/mobile browser QA. This is not a
Phantom signature, Bankr viewer-isolation proof, paid mainnet shot or all-site
browser suite. No private key is requested/exported by the real flow.

## Pilot acceptance still requires the user's action

1. Owner opens the LIVE setup page and signs the default bounded grant.
2. Owner stores the bearer in Bankr's private per-user Env Vars form.
3. Bankr inspects public contract, privately calls status, and reports only
   non-secret wallet/session ID, limits and credit balance.
4. After explicit go-ahead, Bankr sends ONE canonical live-board intent.
5. Same-request replay returns its receipt with no second debit.
6. Status after expiry returns terminal outcome / credits / Brier; confirm the
   matching public proof. Revoke and prove new reservations fail.
7. Only after the private-runtime test: exercise X initiation using the same
   isolated user secret. No automatic claim that every X user can invoke it.

Funding is for Bankr's pilot only if needed, under a separately approved exact
wallet and amount. The session does not fund it. Economics, Pyth source,
frozen v2 program and RCX reload rules are unchanged.

## Historical findings and forward recovery

The disconnected foundation exposed a 30-second lease-expiry stale-writer bug.
Guarded application writes and migration 003 close that path; the restored-database
drill also caught legacy INCR resurrecting consumed queued credits across lock
domains. See GUARDED_PLAYER_WRITES.md and GUARDED_DATABASE_CUTOVER.md.

After guarded players exist, never roll back to the old unconditional writer,
remove the guard trigger or reapply migration 001. Recover forward; a pre-cutover
backup is not a live rollback that preserves intervening writes.
