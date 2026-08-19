# RATCHET — the machine that cannot lie

Live: **https://ratchetx.vercel.app** · Token: **$RCX** on
[pump.fun](https://pump.fun/coin/FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump) ·
CA `FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump` (Token-2022) ·
graduated — liquidity in PumpSwap pool `3gbSEBMBbfqrC7wT7craJNkUhxNTBFyNjhrmedcHJusV`

Fire sealed shots at the market, settled on real Pyth oracle prices. Beat the Warden.
Climb the ranks. Every stake: **70% burned · 30% pots · 0% to the team** — the rule is
printed on the fire button and frozen. The creator is paid from trading fees only.

## Is this repo actually the running code?

Don't take our word for it — the site tells you. Both live endpoints return a build marker:

```
https://ratchetx.vercel.app/api/game?action=state   ->  "v": "h2-2026-08-19"
https://ratchetx.vercel.app/api/proof               ->  "v": "h2-2026-08-19"
```

`api/game.js` and `api/proof.js` in this repo declare `const VERSION = 'h2-2026-08-19'`.
If the live marker and the repo marker match, you are reading the code that is running.
If they ever don't, the repo is stale and you should say so loudly.

## The whole backend, small enough to read in one sitting

Zero npm dependencies. No framework. No build step. No key that can touch funds.

| file | what it is |
|---|---|
| `index.html` | the entire client — game, Warden, ranks, proof page |
| `api/game.js` | the entire game server: sealed shots, lazy settlement, XP/ranks, daily + weekly pots, burn-verified reloads, log anchoring |
| `api/proof.js` | the live proof: every claim re-checked against the chain, each able to go red |
| `lib/prices.js` | Pyth Hermes prices, Coinbase fallback — keyless GETs, same source at seal and settle |
| `lib/burn.js` | reads a burn transaction from the chain and credits it only if it is real, recent, supply-reducing, and never seen before |
| `lib/verify.js` | wallet-signature auth (Ed25519 via node:crypto), no JWT, no session store |
| `lib/log.js` | the hash-chained event log and its permissionless on-chain memo anchor |
| `lib/kv.js` | Upstash Redis if configured, honest in-memory fallback if not |
| `test_harness.mjs` | offline tests over the pure decision functions — `node test_harness.mjs` |
| `CHANGES_2026-08-19.md` | the hardening pass: what was wrong, what changed, why |

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

`RATCHET_MINT` (arms real burns) · `SOLANA_RPC_URL` (fast RPC lane; public RPCs are the
fallback) · `KV_REST_API_URL` + `KV_REST_API_TOKEN` (durable state) · `CREDIT_PER_TOKEN`
(default 1) · `RATCHET_LP_BURN_TX` (optional override for the LP proof line)

No private key exists anywhere in this system. There is nothing to steal and nothing to rug —
not as a promise, as a property. Read the code; that's what it's for.
