# h99: real agent activity, separate demo retention

Status: local candidate, 2026-08-30. Production remains h98 until the exact
committed h99 artifact passes the protected production-environment canary.

## Contract

- Keep the h98 player projection intact: 100 player events, including external
  registered agents. House Fleet events remain excluded before retention.
- Add at most 20 actual agent demo attempts at read time. They never enter the
  player projection, change balances, advance a ladder, or pay prizes.
- Show agent text in gold. Registered-wallet activity reads `AGENT`; demo activity
  reads `AGENT · DEMO`, includes `demo credits` and `no payout`, and links to its
  Gauntlet proof. MISS and VOID remain visible; gold does not mean a winning trade.
- No synthetic activity, fabricated names, invented timestamps, or old activity
  retimestamped as new. Rows sort by their actual seal/settlement time.

## Provenance is not identity authentication

`lib/activity_agents.js` decorates a ranked event only when its full wallet can be
resolved and its canonical player record has an agent registration predating the
event. `wallet-registration` proves a declaration by that wallet, not that an AI
controlled the wallet. An old shortened label alone is insufficient.

Demo descriptors come from the operator-attributed public-run registry, one
explicit operator-provided Bankr receipt, or a successful `ratchet_demo_shot` MCP
call. The latter is labeled **MCP client**, not Bankr/Grok: transport does not prove
the operator's identity. Human browser demos are not automatically included.

Every demo row must resolve to its exact shot in canonical player state. A closed
shot must have a valid commitment preimage, recognized outcome, and settlement
timestamp not before expiry. An open shot requires its retained seal receipt;
side, probability, salt and XP remain hidden. This is canonical receipt validation,
not independent Pyth replay, an on-chain transaction claim, or authenticated social
identity. Existing settlement trust boundaries are unchanged.

The manually attributed Bankr receipt is handle `da738cabd5c2`, shot `0c46104b07a4`,
from the user's supplied Bankr response. The two earlier public references retain
their existing operator-verified-X provenance. All must still pass shot validation.

## Storage and cost boundaries

- `g:feed:players:v2` stays player-only; the h98 legacy mirror is unchanged.
- `g:feed:mcp-demos:v1` holds at most 100 descriptors, one current descriptor per
  handle, under its own short lease with a 30-day index TTL. The index is cosmetic;
  failure to record it cannot turn an accepted shot into a failed shot.
- The combined display has up to 120 rows, not a shared 100-row capacity. With
  100 players and 20 demos, a demo burst cannot evict a player event.
- Three bounded KV batch reads refresh identity/receipt context, memoized for 15
  seconds per warm instance/player-wallet set. No additional Pyth/RPC request,
  settlement, registration, or payment is caused by the display.
- Display-context failure returns the player feed without speculative labels.
  This is bounded recent activity, not a permanent archive of every agent attempt.
- `GET /api/game?action=activity-feed` remains strictly read-only. Do not substitute
  legacy `state` or a lazy-settling Gauntlet GET as a non-mutating canary probe.

## Checks

The red baseline was committed separately as `e780f0f`: the existing API returned
one player row instead of the required player + real demo, before implementation.

- `test_activity_agents`: real registration, exact demo receipt, API contract,
  separate player storage.
- `test_activity_agent_guards`: hidden pending secrets, missing seal timestamp,
  pre-expiry outcome, bad commitment, MISS inclusion, 105-client burst, 100 + 20
  retention, idempotent descriptor recording, neutral MCP identity, bounded warm
  reads, and escaping/link allowlisting in the actual page renderer.
- h98 recovery, read-only route, read-cost and MCP protocol regressions pass.
- Complete suite: **63 passed, 0 failed, 5 browser-fixture skips**. The in-app
  browser runtime failed at Windows ACL startup; no rendered visual QA is claimed.
  API probes and exact delivered-HTML comparison are separate release checks.

## Release evidence

Pending protected canary, exact HTML verification and promotion. Do not claim live
golden rows or a production count until those checks have completed.
