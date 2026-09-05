# Finish plan — everything left, in order, until "ready to deploy" (2026-09-02)

> **SUPERSEDED as a plan on 2026-09-05.** The single tracker is
> [`docs/ROAD_TO_MAINNET.md`](ROAD_TO_MAINNET.md); agents enter through
> [`AGENT_ONBOARD.md`](../AGENT_ONBOARD.md). This file is kept as history — do not plan from it, do
> not claim work out of it, and do not update it. Where it disagrees with the tracker, the tracker
> wins. Six overlapping plans is what produced the integration bottleneck this project is fixing.


Live now: h109 (Cold Machine skin on `/` and `/observatory`, h108 server rules, skill 1.5.0).
Legend: **[S]** Semir only (keys, deploys, decisions) · **[C]** Claude · gate = what proves it done.

## 1. Cold Machine cleanup — "between the live site and the spec" [C] · ½ day
The live page is right in colour but still dense; the spec is too clean. Target: keep every number, cut the noise.
- Machine panel: price chips → one quiet row (mono, 11px, no borders); the 6-stat strip keeps borders but drops the double labels; "PROJECTION ONLY · VAULT NOT DEPLOYED" line moves under the floor number as one dim line.
- Chambers: adopt the spec's shot card (state rail + one title + one number + one verdict line) — the same DOM, only CSS; drop the "YES/NO" corner tag into the rail.
- HUD: stats row gets the same gap and one weight; only $RCX stays gold.
- Podium/ladder chips: silver by default, gold only on the payout number.
- Gate: side-by-side screenshot approved by Semir; no test changes needed (skin only) → deploy as h110.

## 2. Observatory as the reputation instrument [C, then S posts] · 1 day
- Verify `/observatory` live (token block, limits verbatim) — done on h109 deploy.
- Add the RPC layer: the crank records per-RPC latency and failure per action (checkpoint/settle/void) into the same feed-health store; one new table on the page ("Runner vs RPC", by provider name). Data source is our own crank, so this needs step 4 first for real numbers; the table ships behind a "no runs yet" empty state meanwhile.
- Distribution [S]: one post per week with one honest number + reproduce link, tagging the provider it measured (the QuickNode pattern). Never a stunt.
- Gate: page shows 7 feeds + settlement counters + limits; first RPC table populated after the devnet crank week.

## 3. Stocks on the same rails [C build, S deploy] · 2 days + 1 day watch
- Verify on Solana mainnet which equity feeds are SPONSORED push accounts (Pyth list); pick 3–5 the trenches trade (TSLA, NVDA, PLTR, COIN, HOOD); record feed ids + shard-0 push PDAs.
- Watch each for a full session day in the observatory before trusting it (open/close behaviour).
- Core 4th build: extend `FEEDS`, rerun LiteSVM battery with an equity feed id, reprint golden vectors, record hashes. **Before freeze — the table is a constant.**
- Server: `PXFEEDS`/`TYPVOL`/board generator + runner asset aliases ("tesla", "nvidia"); UI: Market open (poison dot) / Market closed (silver) + hours line on equity targets.
- Gate: a TSLA shot seals in hours, is refused outside hours with a clear line, and a post-close expiry voids with refund (LiteSVM + one devnet run).

## 4. Core v1 to devnet, then mainnet [S deploys, C everything else] · 1 week
- Devnet flavour as a SEPARATE source dir (`onchain/ratchet-core-devnet/`, faucet mint at a PDA) so mainnet bytes stay `1ba43717…` reproducible. [C]
- `.cmd`: deploy devnet program with `D:\keys\ratchet-core-program.json` (key never leaves the machine), airdrop, run `client/crank.mjs --once --dry` then live. [C writes, S runs]
- Player CLI (`client/play.mjs`: faucet → reload → seal → reveal) for the devnet exercise; open runner left running against two RPCs for the observatory table. [C]
- Gate: full shot life on devnet driven by a stranger's client + our crank; void/forfeit/close
