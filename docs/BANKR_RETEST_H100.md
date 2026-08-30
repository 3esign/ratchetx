# h100: Bankr retest, stable continuation and executable scorecards

2026-08-30. Local candidate; h99 remains production until canary/promotion checks.

## Findings and red baseline

Bankr reported two h99 attempts: `41ea35bc740d` (shot `9fde0319a8a4`) and
`55fe7753034f` (shot `77a7b9c92aa8`). Read-only production inspection confirmed both
actual sealed demo records at 09:28:14Z; neither had a scored result then. Their
reported admission, context sampling and settlement completion are different claims.
Do not call these completed runs or infer that no context regression occurred when
the agent explicitly lacks a retained multi-sample table.

Two code defects were reproduced independently:

1. `ratchet_agent_record` dynamically required removed `api/agent.js`. The live
   MCP request returned HTTP 200 but `result.isError:true` with that module failure.
   The REST report already worked via `game?action=agent-report`.
2. `ratchet_pyth_path` defaulted omitted `to` to a new Date.now on every request,
   while its cursor was bound to page one's `to`. Repeating identical arguments
   plus cursor therefore failed as the clock moved. Local + live positive control:
   explicitly use page one's `to`, and the next page succeeds without overlap.
   The production probe saw 17 observations, page size 2, then HTTP 400 for the
   omitted-to continuation and HTTP 200 for frozen bounds. We do not have Bankr's
   exact second-request arguments, so this is a reproduced matching failure class,
   not a claim to know the precise cause of his individual invalid cursor.

Red tests were committed separately in `6983e55`: pagination 3 pass / 2 fail,
MCP scorecard 0 pass / 3 fail. Existing tests exercised only explicitly fixed `to`
and advertised tool names; neither protected this real client workflow.

## Fix scope

- MCP report dispatches to the same canonical read-only route as REST. No new API
  function, duplicate reducer, registration, payment or settlement is added.
- Missing/invalid identities return structured tool errors, not import exceptions.
- Receipt oracle provenance comes from the retained receipt's `trustBoundary`.
  The obsolete hardcoded `pyth-benchmarks` label is removed. Legacy receipts
  without the field report null, not invented authentication. Full independent
  replay is not claimed.
- The parser validates the opaque v1 cursor before resolving omitted `to`; it
  inherits only that default from the original bound request. Explicit changed
  feed/from/to/source still fails, and normal window/size limits remain enforced.
- An additive `nextRequest` supplies complete tool arguments; null terminates
  pagination. `nextCursor` remains for compatibility. Remote + stdio descriptions
  teach the same continuation contract. MCP version/tool count stay 1.2.0 / 13.
- A fixed query window is NOT an immutable global oracle snapshot. The capture
  archive remains bounded and incomplete; late retained evidence can still appear.
  This change fixes moving request defaults, not completeness or fork policy.
- No oracle collector, seal/settlement rule, credits, RCX, x402, or frontend changes.

## Resolution recommendation: next, not shipped here

Bankr requested a predictable resolution hook. `ratchet_demo_state` already invokes
the canonical game state handler, which can settle after expiry. Adding another
settler or holding a five-minute serverless request would not fix the two failures.

The next bounded change should be a per-shot result envelope on that existing path:
`shotId`, `targetId`, `stage`, `terminal`, `expiry`, `pollAfterSeconds`, outcome,
exact retained exit observation, updated credit balance/Brier and direct proof URLs.
Keep Gauntlet completion separate from shot terminality: VOID is terminal for a
shot but does NOT complete the non-void Gauntlet objective. Current progress derives
latest evidence from HIT/MISS only; do not repurpose it as a universal VOID receipt.

Acceptance: after expiry, one poll returns the terminal canonical receipt when an
admissible exit is available; otherwise explicit pending + retry timing, or VOID
under the existing grace/refund rule. Replay cannot pay twice. No forced outcome,
no guessed exit, no synthetic demo traffic, no on-chain transaction or new worker.
A confidence-expansion case absent from observations remains `not exercised`.

## Verification and release

Targeted tests now pass: five pagination cases, three MCP report cases, existing
Pyth context + agent-report tests. The five-page fixture returns all 105 observations
including same-millisecond neighbours exactly once. Complete suite and protected
production-environment canary pending; no deployment claim yet.

Design reference: [MCP list pagination](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination)
uses opaque cursors and recommends stable continuations. Ratchet's path is a custom
tool result, not one of those protocol list operations; this is design guidance,
not a claim that the tool is implementing MCP list pagination itself.
