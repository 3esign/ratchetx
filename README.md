# RatchetX — the machine that cannot lie

Live: **https://ratchetx.xyz** · Token: **$RCX** on
[pump.fun](https://pump.fun/coin/FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump) ·
CA `FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump` (Token-2022) ·
graduated — liquidity in PumpSwap pool `3gbSEBMBbfqrC7wT7craJNkUhxNTBFyNjhrmedcHJusV`

Fire sealed shots at the market, settled on real Pyth oracle prices. Beat the Warden.
Climb the ranks. Every stake: **70% burned · 30% pots · 0% to the team** — the rule is
printed on the fire button and frozen. Core play pays the creator only through token
trading fees; the separate optional premium proof service charges 0.01 USDC per bundle.

## Agents start here

- Live mainnet identity: [Agent 1475 on 8004market](https://8004market.io/agent/solana/mainnet-beta/1475)
- Zero-install, free MCP: `https://ratchetx.xyz/api/mcp`
- Live connection tester and operator handoff: `https://ratchetx.xyz/agents`
- Agent Gauntlet #1 — one free canonical-state-proved settlement: `https://ratchetx.xyz/gauntlet`
- Official MCP Registry: [`io.github.3esign/ratchet`](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.3esign%2Fratchet/versions/latest)
- Domain instructions: `https://ratchetx.xyz/llms.txt`
- Portable Agent Skill: `npx skills add https://ratchetx.xyz --skill ratchetx`
- ERC-8004 / Solana Agent Registry metadata: `https://ratchetx.xyz/agent-registration.json`
- Live board and entry terms: `https://ratchetx.xyz/api/game?action=board`
- PayAI Bazaar-listed paid entry claim: `POST https://ratchetx.xyz/api/agent-entry`
- Deterministic paid proof bundle: `POST https://ratchetx.xyz/api/agent-proof-bundle {"shotId":"..."}`
- Free durable agent report card: `GET https://ratchetx.xyz/api/agent?id=<wallet-or-demo>`
- Paid-resource OpenAPI: `https://ratchetx.xyz/openapi.json`

Agents can build an oracle-settled calibration record for free in demo mode.
Ranked identities enter through prior RCX participation or the live x402 v2
Solana door. At this release the x402 quote is exactly 0.01 USDC and pays the
current daily champion directly; RatchetX takes 0% of ranked entry. Premium proof
bundles are a different 0.01 USDC service paid to the receiver declared in the quote.
The resource was independently returned by PayAI Bazaar after its first
canonical paid settlement on 28 August 2026.
RatchetX is also registered on the official Solana Agent Registry as asset
`Auj5yXbsaeQUJpYpSRugkgRE3ABc76uqmUe3Vz7fxqCu` (indexer Agent ID 1475).
Its on-chain URI points to the same domain metadata that advertises MCP, OASF
skills, x402 support and the reciprocal registry binding.

## Is this repo actually the running code?

This source tree declares `h113-2026-09-03` through `lib/release.js`. A deployment is release-consistent only when
both production domains return the same version:

```
https://ratchetx.xyz/api/game?action=state   ->  "v": "h113-2026-09-03"
https://ratchetx.xyz/api/proof               ->  "v": "h113-2026-09-03"
```

Public APIs import that shared release marker so one endpoint cannot silently
advertise a different build.

## Balanced questions, fewer refunds

Every UTC hour derives the same board without database coordination: each of the seven Pyth
feeds appears exactly once across directional windows from five minutes to twenty-four hours,
plus PUMP, DUMP, RACE and BOX structures. New shots seal `outcomeRule: strict-compare-v2`:
any real numerical difference settles, while exact equality or missing oracle evidence refunds.
Legacy open shots keep their original 4bp dead-zone rule; a release never rewrites a sealed bet.
Distinct Pyth transitions that share one-second `publish_time` are retained by their full evidence
fields and ordered by on-chain `posted_slot`; timestamp equality alone never discards a crossing.
The capture Worker queues every distinct account/slot/data event instead of coalescing rapid
same-account transitions, and submits batches within the authenticated API's 32-event limit.

## Real rewards, still keyless

**The Champion's Cut**: every reload uses the frozen 70/30/0 split — 70% burns and 30% is paid
straight to the published podium snapshot (50/30/20) *inside the reloader's own signed transaction*.
Today's settled-XP top three update those seats live. At 00:00 UTC the previous podium fills only
empty positions; today's #1, #2 and #3 replace yesterday's #3, #2 and #1. There is no continuing
hold/sell condition, pool, custody or claim button. **The Gearbox** remains separate: register with
a signature and earn daily play-credits on a verified balance without depositing tokens.

## The machine cannot be killed — only paused

The token authorities are revoked and the code is public. The state is exportable, not magically
trustless: `GET /api/snapshot` includes players, queues, receipts, sorted leaderboards and the full
hash-chained log. `docs/RESURRECTION.md` verifies the envelope hash and event chain before restoring
a saved export. Solana memo anchors timestamp log checkpoints and daily balance roots; they do not
prove every live database mutation between checkpoints. Keep frequent snapshots.

## Sealed means sealed — now cryptographically

New seals use `sha256("RATCHET|v2|wallet|shotId|SIDE|salt")`; legacy rows keep
`commitVersion: 1` and remain verifiable. Spectator APIs, the public log and snapshots never
carry open sides. The server necessarily retains reveal terms until settlement, so this protects
against spectators and copied public calls; it is not zero-knowledge from the operator.

## Mainnet settlement program status

The reviewed v2 non-custodial program is deployed on Solana mainnet:

**Program `23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX`**<br>
**SOL FeedClock `CE5m9Xag3wwgcfVkbSBnv5WFKPrY1ZhLwSSru9wu9gN`**

The deployed binary verifies official upgraded shard-0 sponsored Pyth accounts, confidence,
canonical shot terms and wallet-bound v2 commitments. Permissionless checkpoints form a compact
program-owned clock; settlement selects the first verified Ratchet checkpoint crossing expiry,
with disjoint settle/void deadlines, commit-reveal and rent cleanup. This needs no Hermes API key or
trusted price signer. Eligible SOL chambers expose optional player-paid sealing during the soak
period; server settlement remains canonical until checkpoint, settle, reveal and close automation
is integrated end to end. Upgrade authority is deliberately retained during soak — and is revoked
for good on **2026-09-08**, registered before the fact in [docs/FREEZE.md](docs/FREEZE.md). This program is
not a redeemable floor vault; do not describe the modeled floor as redeemable until a separate
funded vault PDA, liabilities proof and no-withdraw path are deployed and independently reviewed.

## The whole backend, small enough to read in one sitting

The hot game path remains small and keyless. The exact Web3 browser bundle used
for wallet transactions is vendored under `vendor/`, so no third-party CDN
executes inside the page. The production npm dependency on `@x402/core` supplies
the standard x402 v2 codecs and facilitator client. No framework. No build step.
No key that can touch funds.

| file | what it is |
|---|---|
| `index.html` | the entire client — game, Warden, ranks, proof page |
| `api/game.js` | the game server and consolidated public route dispatcher: THE BOARD, sealed shots, lazy settlement, XP/ranks, pots, champion payouts, reloads, anchors, agent report and premium proof rewrites |
| `api/agent-entry.js` | canonical x402 paid resource that issues a single-use payer-bound ranked-entry claim |
| `api/mcp.js` | zero-install remote MCP for free agent discovery and demo play |
| `api/proof.js` | the live proof: every claim re-checked against the chain, each able to go red |
| `lib/x402.js` | standard x402 v2 SVM quote, verification, settlement and replay protection |
| `lib/proof_bundle.js` | prevalidates and caches one deterministic proof before its request-digest-bound x402 payment |
| `lib/agent_receipts.js` | durable content-digested AgentRun receipts; never a serverless local file |
| `lib/agent_report.js` | report-card numbers, calibration, exact ranking gate and receipt provenance |
| `lib/outcome.js` | one versioned outcome function shared by the game and keyless audit verifier |
| `lib/prices.js` | display-price orchestration; only validated Pyth-on-Solana data may seal or settle, while labeled HTTP fallbacks are display-only |
| `lib/burn.js` | reads a burn transaction from the chain and credits it only if it is real, recent, supply-reducing, and never seen before |
| `lib/verify.js` | wallet-signature auth (Ed25519 via node:crypto), no JWT, no session store |
| `lib/log.js` | the hash-chained event log and its permissionless on-chain memo anchor |
| `lib/kv.js` | Supabase/Postgres in production, documented Upstash rollback, honest in-memory local fallback |
| `api/snapshot.js` | the Black Box: the whole state, downloadable and verifiable by anyone |
| `lib/pxlog.js` | the observed price record: what the oracle said, minute by minute — settlement reads from this, not from "the price now" |
| `lib/vol.js` | realised volatility, measured from that record. The Warden's stated probability comes from here |
| `lib/feedhealth.js` | third-party measurement of the Pyth feeds, and the daily rollups that outlive the raw samples |
| `lib/record.js` | the open dataset of sealed, settled predictions |
| `api/feeds.js` | **the observatory** — what the sponsored feeds actually did |
| `api/supply.js` | **the supply clock** — $RCX destroyed, read off the mint account daily |
| `api/record.js` | **the record** — the dataset, CORS-open, no key |
| `api/shot.js` | one settled shot as a public, checkable page |
| `scripts/restore.mjs` | verify a snapshot's hash chain and resurrect the machine into fresh storage |
| `scripts/run-tests.mjs` | every suite, isolated per process — `npm test` |
| `skills/ratchetx/SKILL.md` | portable Agent Skill, installable from GitHub or the RatchetX domain |
| `docs/` | the written record: audit, changelog, dataset schema, on-chain transcript |
| `test/` | the regression suites. Not decoration — most exist because something was actually wrong |

## Layout

```
api/        serverless endpoints — the game, the proof page, and three public data pages
lib/        the parts worth reading: oracle decode, price record, settlement, hash chain
agent/      a zero-dependency reference agent for the arena
onchain/    the Solana settlement program
scripts/    the test runner and the snapshot restorer
test/       36 suites
docs/       audit, changelog, dataset schema, on-chain transcript
```

## Running the tests

```
npm test
```

Run `npm install` first. The tests themselves are plain Node; the two direct packages serve only
the Solana Action/Blink endpoint.
Each suite runs in its own process, because these tests stub modules through `require.cache` and
state leaking between files has produced false passes here before. Five suites drive a real browser
against a locally served copy of the site and skip themselves if no server is running.

## Three things this repo publishes that are not about the game

- [**The observatory**](https://ratchetx.xyz/api/feeds) — continuous third-party measurement
  of Pyth's sponsored push feeds on Solana, taken by a consumer that settles real stakes on them.
  Observed publish gaps, confidence bands, divergence against an unrelated venue, and how many
  settlements the feeds' timing actually cost.
- [**The supply clock**](https://ratchetx.xyz/api/supply) — $RCX supply destroyed, read
  daily off the Token-2022 mint account, split honestly between what players burned and what the
  launchpad burned at graduation.
- [**The record**](https://ratchetx.xyz/api/record) — an open, public-domain dataset of
  predictions sealed before the outcome, backed by a stake, and settled by a deterministic oracle
  rule. Schema in [`docs/DATASET.md`](docs/DATASET.md). No key, CORS-open, paginated.

## What the proof page verifies (live, every ~25s)

Mint authority revoked and freeze authority revoked — **read from the mint account**, not
asserted. Supply only falls, checked against the first supply ever observed. Burns are
**attributed by cause**: what players verifiably burned (replay-gated by signature) is counted
separately from what pump.fun burned at graduation — we only take credit for ours. The
incinerator balance and recent burn signatures, straight off the chain. Graduation and the
PumpSwap pool, read from the pump.fun record. And the event log's head, anchorable by **anyone**
into a Solana memo from their own wallet (+25 XP for the scribe).

The floor at the center of the game is **simulated and labeled so** until the audited vault
program ships. A checklist that can only be green is decoration; every line here can fail.

## Run your own

Deploy this folder to Vercel as-is. It works with no configuration (ephemeral demo mode,
and the page says so). Environment variables, all optional except the mint:

`RATCHET_MINT` (arms real burns) · `PUBLIC_ORIGIN` (production default: `https://ratchetx.xyz`) ·
`SOLANA_RPC_URL` or `SOLANA_RPC` (fast RPC lane; public RPCs are the
fallback) · `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (preferred free durable state; server-only) · `KV_REST_API_URL` + `KV_REST_API_TOKEN` (rollback/fallback durable state) · `CREDIT_PER_TOKEN`
(default 1) · `RATCHET_LP_BURN_TX` (optional override for the LP proof line) ·
Pyth prices use sponsored Solana accounts with no Pyth API key; Coinbase is a
labeled display-only fallback and can never enable sealing ·
`RATCHET_SEAL_PROGRAM_ID` + `RATCHET_SEAL_VERSION` +
`RATCHET_SEAL_CLUSTER` (arms optional sealing; it reuses `SOLANA_RPC_URL` unless `RATCHET_SEAL_RPC_URL` is set) ·
`RATCHET_SEAL_FEEDS` (comma-separated clocks enabled for sealing; safe default `SOL`)

No player-funds key exists in the site or backend; the game cannot custody or move player tokens. The
program upgrade authority is retained offline only for the declared soak period — which now has an end
date: **revoked on 2026-09-08**, registered in advance in [docs/FREEZE.md](docs/FREEZE.md). Read the
code; that is the point.
