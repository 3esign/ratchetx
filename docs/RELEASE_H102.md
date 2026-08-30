# h102 — retain the actual session refusal

DEPLOYED and public-verified: 2026-08-30T15:40:34.862Z.
Scope: additive diagnostic codes in the existing game and bounded-session adapter.
No oracle thresholds, credit rules, session allowance, signatures, database schema,
Solana program, token transfer, collector or MCP tool changed. MCP stays 1.2.0.

## External report and the evidence boundary

Bankr's user-supplied report describes a 100-credit YES / p=0.55 attempt on
H496695Q0 (FLASH PUMP, five minutes), rejected under a one-attempt grant.
It reports unchanged credits (1,452,042), exhausted attempts (1/1), and identical
replay returning the retained rejection without another spend. The displayed
Brier 0.3087 over 13 calls is existing history, not a score for the rejected shot.

A bounded production-log read independently located the POST /api/game HTTP 409
at 2026-08-30T15:18:07.020Z. No inner diagnostic was recorded. h101 replaced every
definite inner 4xx with SHOT_REFUSED, so the historical exact cause is unknown.
Do not rewrite that receipt, infer the cause from a later price, or call this a
successful forecast/settlement. The intent hash binds the requested intent; it
does not prove shot acceptance or an oracle outcome.

## Reproduction and fix

The independent, network-blocked real-handler fixture reproduced the exact
target, stake, probability and starting balance using a synthetic owner:

- Fresh price: accepted, credits 1,451,942, one open shot.
- Five-minute price age 45 seconds: accepted; age 46 seconds: rejected.
- Confidence 201 bps: rejected (the existing limit is 200 bps).
- Rejected cases: credits unchanged, one reservation / gross 100 consumed.
- Healthy data restored before replay: same rejected receipt, no redispatch.

These are controls, not evidence of which condition caused Bankr's live refusal.

Canonical refusal branches now supply stable codes. The adapter persists only
allowlisted codes as request.result.code and supplies a fixed safe explanation
in refusal. It never stores/reflects raw inner error text or provider details.
Unknown 4xx and legacy receipts remain SHOT_REFUSED. Outer HTTP 409 / SHOT_REFUSED
is preserved for compatibility. Exact replay can still return HTTP 200 / ok:true;
clients MUST inspect request.state. Successful receipt retrieval is not successful
gameplay. Status also carries the retained code in the session's request record.

Known codes include ORACLE_STALE, ORACLE_CONFIDENCE_TOO_WIDE, FEED_UNAVAILABLE,
TARGET_UNAVAILABLE, CHAMBERS_FULL, INSUFFICIENT_CREDITS, PLAYER_BUSY and RATE_LIMITED.
The full dictionary is published in the public session discovery contract.
Owner-recovered receipts retain RECOVERED_NO_DISPATCH without an added game
refusal label. 5xx/ambiguous outcomes remain reserved for fenced owner recovery. No retry,
replacement grant, allowance refund or second forecast is performed automatically.

## Next owner-approved acceptance

The tested grant has consumed its one attempt. Its expiry is
2026-08-30T15:35:00.008Z. Do not reuse it for another forecast or restore its budget.

1. Owner creates a NEW bounded grant on /play-session.html: one attempt, 100
   credits per attempt and gross, 30 minutes; keep the normal interval/consent.
2. Replace the value of RATCHET_PLAY_SESSION in Bankr's private per-user Agent
   tool environment. Never put the value in chat, X or an app-owner fallback.
3. Read live discovery, then private status and the public board/Pyth context.
   Choose an eligible fresh five-minute target; a preflight is advisory, not a
   reservation or a promise that the later canonical observation will pass.
4. Explicitly authorize one 100-credit shot, retain its ID and exact intent,
   replay it once, and inspect request.state (not merely HTTP status).
5. Accepted: read status after expiry and report exact shot ID, outcome, credit
   delta, Brier delta and proof. Rejected: report retained refusal code and stop.
   Unresolved: stop dispatching and request owner status/recovery.
6. Owner revokes afterward. X initiation is a separate runtime test, using that
   same per-user protected injection, never a globally shared capability.

No new funding is needed if the confirmed existing credit balance covers 100.
No token transfer, reload or funded mainnet transaction is authorized by this test.

### Message to Bankr (only after owner creates the new grant)

Read https://ratchetx.xyz/api/game?action=play-session and verify h102 or later.
Use my newly replaced RATCHET_PLAY_SESSION through protected server-side HTTPS
injection only to ratchetx.xyz; refuse redirects and never print the secret.
Check status and report the owner, expiry and remaining limits. If it is a fresh
one-attempt session with at least 100 credits of allowance and game balance, I
authorize ONE 100-credit forecast on a currently eligible five-minute target.
Read shared Pyth context first; stop before submitting if the input is unsuitable.
Persist the request ID and exact intent, submit once, and replay the same request
once. HTTP 200 is not acceptance: inspect request.state. If rejected, report
request.result.code and refusal and STOP; do not use a new ID. If accepted,
read status after expiry (no faster than five seconds) and report the terminal
outcome, credits and Brier delta with the exact shot/proof. If reserved/uncertain,
stop and ask for owner recovery. No transfers, reloads, additional attempts or
public secret output. Identify the runtime used; do not claim global X support.

## Release verification

Deployment: dpl_Ms76fJAEbzhwpB5691o8QayRGJ68, READY, production, aliased to
https://ratchetx.xyz. Immutable URL:
https://ratchetx-asr4unrv4-3esigns-projects.vercel.app

Clean artifact commit: 1362d541d9c53561baceaed4cb86c7c2419cf1e9.
329 tracked files; ordered source-tree SHA-256 (same definition as h101):
b923eab28d2cf8a615e6b36b3cf687338429e946d6568cdefca8f5ec131ffb9f.
Existing guarded database build prerequisite PASS. No migration reapplied.

Final exact-artifact batch: 17 checks passed (15 focused suites plus release
safety and protocol-version gates), zero failed. Suites: play_session,
play_session_kv, play_session_atomicity, play_session_http, play_session_page,
critical_paths, harness, balance, settle, warden, ranked_remote_protocol,
player_write_fencing, player_commit_recovery, release_identity and canon.
The first candidate batch's Warden failure was an incorrect test working
directory (ENOENT), not a game failure; rerun from test/ passed, then the final
batch used each suite's correct directory. No full-suite success is implied.
The regression also kills a process-memory mutant restoring the old lossy code.

Eight public read-back checks passed in one non-spending batch: exact root HTML,
consent HTML and JS bytes; h102 enabled private/no-store session discovery and
refusal dictionary; h102 core board; h102 shared Pyth context; private 401 without
a credential; private 403 for the wrong browser Origin. No real session token,
grant, forecast, credits or wallet transaction was used during this verification.

Static SHA-256 (unchanged from h101-ui1):

| File | SHA-256 |
|---|---|
| index.html | 3894669b36547ec8a74b7c98642eb5ffddf3fdbfc27abf761b0e308894969f67 |
| play-session.html | f020f7dbb80069ca2f4f37211e1ec032b3cf9b098564f2003b1f76b09ebb4cb7 |
| play-session.js | 7df309d594874da723e6d05b77bb8446030a343987ff14d64a593dac8813b32a |

Workspace lesson: skills/solana/references/83-session-refusal-evidence-and-replay.md,
linked in that skill. Its existing frontmatter was unchanged; the optional
quick_validate.py check could not run because bundled Python lacks PyYAML.
Reference/path and runtime verification were completed without installing a new
dependency. This is not a failed runtime test.

Forward-only recovery remains required: never roll back to pre-guarded h100
writers or remove migration 003's guard trigger. h101 can read the new codes.
