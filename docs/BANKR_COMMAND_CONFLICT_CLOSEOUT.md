# Bounded Bankr command-conflict close-out

2026-08-30. Offline diagnosis and regression coverage only; no production code
change, deployment, API call, real credential, live forecast, replay, transfer
or reload. Not a full audit and not proof of the live incident's root cause.
Source HEAD inspected: 69eaf7b (plus local documentation/test edits).

## Verified locally

The session-play request ID is derived from domain/version, owner wallet,
session ID and external command ID. Prediction intent is deliberately excluded.
An existing request with a different target, side, p or stake produces
COMMAND_CONFLICT in the execute preflight rather than allocating another action.
That branch makes one protected status request and does not dispatch a new shot.

test/test_session_play.mjs now exercises all four changed fields, fresh journal
paths, unchanged retained requests and unchanged shots. Existing coverage also
checks identical redelivery, genuinely distinct command IDs, failure/restart
recovery, expiry/revocation and secret-safe output.

test/test_session_play_contract.mjs exercises actual HTTP handlers, capability
service, game and guarded commits against an in-memory store and fake prices.
It checks two independent commands under one grant, identical submit/replay,
one debit each, duplicate/conflict refusal and status-only reporting. External
fetch is disabled and the test asserts zero attempted external connections.

Batch executed successfully after the test edit:

```text
node --no-maglev --test --test-concurrency=1 test/test_session_play.mjs test/test_session_play_contract.mjs
2 test files passed; 0 failed; 0 skipped; approximately 2.52 seconds.
```

Production runner was not edited. SHA-256 still matches the release record:
4f83c659ab3e8e4a8a876c705ee55e86d7c66088e9b07076fb3168eb2cf5700c.
This hash comparison is local-to-recorded-release, not a fresh production fetch.

## What the public reports do and do not establish

The supplied screenshots report command2094139084050759779 and shot669da614803f,
followed by a COMMAND_CONFLICT response. We do not have the actual runtime
invocations, private journal or captured HTTP evidence from that conflicting run.
Reusing a prior/quoted post ID with freshly chosen intent is plausible, but is
not independently established. A rejected new invocation does not invalidate
an earlier accepted shot or prove that every earlier reported figure was correct.

There are two COMMAND_CONFLICT sites: pre-dispatch duplicate comparison and
later polling if the retained intent differs from the original journal. Do not
infer timing, a zero debit or absence of an accepted shot from the code alone.
The specific phase and previous retained receipt must be established.

## Minimal evidence needed to finish G0-03

Use existing artifacts first, without new gameplay or a new grant:

1. Trusted initiating X post ID, distinguished from quoted/parent post IDs.
2. Actual command ID, expected owner/session and staged runner hash.
3. Normalized original versus attempted intent, or private comparison showing
   which field names differ. Do not expose an open forecast or credential.
4. Captured result phase/category/code, derived request ID and existing shot ID.
5. Whether the run ever sent op:shot, from captured transport/journal evidence;
   map inspection alone is not proof of a wire replay.

Safe Bankr request for an evidence-only follow-up:

> Audit the previous COMMAND_CONFLICT using existing journals and captured
> responses only. Do not call game APIs or submit/replay any forecast. Report
> initiating post ID versus quoted post ID, command/request ID, runner hash,
> failure phase and which intent field names changed. Keep credentials and
> open forecast values private. If those artifacts are unavailable, say
> UNVERIFIED; do not create a grant, new command or substitute demo.

Do not cure uncertain delivery by changing its command ID. Identical redelivery
uses the same ID and the original journal's status-only recovery. Only a genuinely
new explicit owner instruction gets a new ID. Never erase the original journal
or let re-selection of probability/target overwrite its intent.

## Handoff and scope

G0-03 has partial evidence: local guard/replay behavior is verified, historical
live attribution remains open. Do not mark the entire task VERIFIED.
Continue OPERATOR_INDEPENDENCE_PLAN.md; no optional features are reopened.
Next safe work: G0-01 authority inventory and G1-01 current settlement specification,
while obtaining only already-existing sanitized Bankr evidence for G0-03.

The scoped review used Solana reference94 and the auditor checklist. Two older
auditor links (01-supabase-atomic-primitives.md and 02-pyth-feed-integrity.md) were
absent; no broad DB/on-chain audit or live canaries were performed as substitutes.
