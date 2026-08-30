# Bounded owner-session test

Use this only for an explicitly approved owner-session forecast/replay test.
It is not a demo and does not acquire a wallet signer. The owner must already
have Ratchet arena admission and play credits. These credits and the resulting
public record belong to that owner, not necessarily the agent runtime's wallet.

## Before execution

1. The owner creates a fresh permission at
   <https://ratchetx.xyz/play-session.html>. Recommend one attempt, 100 per-attempt
   credits, 100 gross credits, 30 minutes, and a 60-second minimum interval.
   A larger existing credit cap does not change this runner's fixed 100 stake.
2. Store the credential only as `RATCHET_PLAY_SESSION` in the runtime's protected
   agent environment. Never paste it into X, chat, commands, argv, a journal or
   a script. Never print the environment or an HTTP Authorization header.
3. Confirm the expected owner and non-secret session ID from the user's
   approval. Read the current board/Pyth context to choose the exact current
   five-minute directional target. The feed rotates; do not reuse an old ID.
   Choose YES/NO and an honest probability explicitly; no default trading call.
4. Confirm the runtime can execute Node >=18 or Bun with the protected variable,
   restricted outbound HTTPS and a persistent private local file. If it cannot,
   report BLOCKED. Do not emulate the run with demo tools or switch accounts.

Bankr documents per-wallet skill installation and protected environment
variables in its [advanced agent guide](https://docs.bankr.bot/agent/advanced/).
This does not imply that every X user's runtime has the installed skill, secret
or permission. The viewer-scoped cockpit remains read-only and is not used to
forward a credential. No Bankr team-side integration is assumed.

## One deterministic run

For a **status-only** request, do not start the runner or create a journal.
Use the runtime's protected HTTP tool: POST exactly
`https://ratchetx.xyz/api/game?action=play-session`, JSON body `{"op":"status"}`,
Content-Type application/json and Authorization Bearer resolved server-side
from `RATCHET_PLAY_SESSION`. Refuse redirects and use no-store. Never interpolate
or print the resolved header. Report only the verified wallet/session ID,
expiry, attempts/limits, credits and a safe refusal code. This authenticated
read may collect settlement for an existing shot; it cannot submit a new shot.
If protected injection is unavailable, stop instead of exposing the credential.

Use the companion [session-smoke.mjs](../scripts/session-smoke.mjs), installed
with this skill. If the skill loader omitted executable companions, retrieve
that exact file from <https://ratchetx.xyz/skills/ratchetx/scripts/session-smoke.mjs>
without any credential; refuse redirects. Keep it in the private workspace.

After explicit approval, substitute public IDs/intent and a NEW private journal
path in this command (do not put the credential in the command):

```sh
node skills/ratchetx/scripts/session-smoke.mjs --execute --wallet OWNER --session-id SESSION_ID --target CURRENT_TARGET --side YES --p 0.55 --journal ./private/session-test.jsonl
```

The side/probability above are syntax examples, not advice. The journal's parent
directory must exist. The runner exclusively creates the file before dispatch:
never delete or overwrite it to force another run. It contains no bearer or
salt, but it does contain the private pre-reveal forecast intent; do not publish
it or commit it to source control. Retain it in the same protected workspace.

The runner:

- verifies public contract, exact owner/session, unused one-attempt grant,
  existing credits, zero open shots, current five-minute target and Pyth context;
- requires at least 22 minutes left, covering the horizon, oracle timeout and
  polling margin; uses server time, not the phone's clock;
- journals one request ID and exact 100-credit intent before submitting;
- immediately sends the identical POST after acceptance and verifies actual
  HTTP replay, matching retained receipt and `idempotent:true`;
- polls status at bounded intervals, then verifies the exact shot, attempt,
  credit outcome and probability-scored count/Brier change; aggregate Brier is
  checked within its published rounding precision;
- stops on refusal, uncertainty, expiry, revocation or failed evidence. It does
  not change ID/intent, create grants, transfer tokens, reload or use a demo.

Polling is a bounded foreground process, not a hosted scheduler or notification
service. If the runtime interrupts it, use the same journal and status-only
resume, never the execute command with a fresh file:

```sh
node skills/ratchetx/scripts/session-smoke.mjs --resume --wallet OWNER --session-id SESSION_ID --journal ./private/session-test.jsonl
```

Resume cannot submit or replay a shot. Missing wire evidence stays unverified;
it is not inferred from a request map. Rejected/uncertain reservations can use
the allowance without debiting credits. The owner uses signed status/recovery
controls if necessary; the client never expands its own authority.

## Report only the evidence collected

Return the runner's safe summary: result category, shot ID, real wire-replay
status, terminal HIT/MISS/VOID, credits before/after and Brier sample counts.
Concurrent owner activity can make balance attribution inconclusive; say so.

Canonical URLs are `/api/shot?w=OWNER&id=SHOT_ID` and `/api/agent?id=OWNER`.
The shot page remains sealed until settlement. Generic `/api/proof` is system
health, not the specific shot. AgentRun receipt status is a separate retained
evidence audit, not HTTP replay or proof of x402 payment.

Prices come from Pyth PriceUpdateV2 on Solana mainnet. Credits, settlement and
scoring remain server-canonical; `independentPythReplay:false`. One completed
loop is integration evidence, not a claim of predictive skill or global Bankr
availability. The owner can revoke after the bounded test is complete.
