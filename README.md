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
https://ratchetx.vercel.app/api/game?action=state   ->  "v": "h15-2026-08-20"
https://ratchetx.vercel.app/api/proof               ->  "v": "h15-2026-08-20"
```

`api/game.js` and `api/proof.js` in this repo declare `const VERSION = 'h15-2026-08-20'`.
If the live marker and the repo marker match, you are reading the code that is running.
If they ever don't, the repo is stale and you should say so loudly.

## Real rewards, still keyless

**The Champion's Cut**: every reload splits by the same frozen 70/30/0 — 70% burns, 30% is paid
straight to the daily podium's wallets (50/30/20) *inside the reloader's own signed transaction*.
No pool, no custody, no claim button: the server only verifies the legs and refuses anything that
pays a wallet outside the published podium. **The Holder Rule**: champions must keep ≥50% of their
last 7 days' champion pay (balances read from chain) or the seat passes down — anti-dump without
locking anyone's tokens. **The Gearbox**: register with a signature and earn daily play-credits on
your verified on-chain balance — staking with no deposit, so there is nothing to rug.

## The machine cannot be killed — only paused

The token is unkillable (authorities revoked, liquidity protocol-held). The code is unkillable
(this repo). Since h4, the **state** is too: the full hash-chained event log is retained, and
`GET /api/snapshot` exports the machine's entire soul — every player, ladder, burn signature and
log entry — verifiable against the heads players anchor on Solana. `RESURRECTION.md` tells any
stranger how to verify a snapshot (`node restore.mjs snap.json --check`) and bring the whole
machine back on their own hosting, provably intact. Keep snapshots.

## Sealed means sealed — now cryptographically

Since h6 the log records every seal as `sha256("SIDE|salt")` and reveals side + salt at
settlement — so no one (including us, including the Black Box) can read an open shot's side,
and everyone can verify every seal after the fact. Spectator APIs and snapshots never carry
open sides.

## The settlement layer now runs on-chain (devnet)

`ratchet_seal` — an Anchor program with **no custody, no admin, no funds** — is deployed and
proven end to end on Solana devnet:

**Program `4WQ4XTzC29M6YoxgNi9WHhYJWEtYyj6YNFtSB9yCM6E2`**

`seal` writes only `sha256("SIDE|salt")` plus an entry price read from a Pyth **PriceUpdateV2**
account it validates itself (owner, discriminator, Full verification — no trusted deserialiser).
`settle` is a **permissionless crank**: anyone may settle after expiry, and only with a price
published inside `[expiry, expiry+60]`, so a stale quote cannot be smuggled in. `reveal`
recomputes the hash, checks it against the stored commitment, scores hit/miss on-chain and
bumps a `PlayerRecord` PDA. Full transcript with transaction links: [`ONCHAIN.md`](ONCHAIN.md).

Devnet is R&D, not the money path — the live game above still settles on the server, which is
why the proof page exists. Source: `onchain/ratchet_seal_lib.rs` (288 lines, zero crates).

## The whole backend, small enough to read in one sitting

Zero npm dependencies. No framework. No build step. No key that can touch funds.

| file | what it is |
|---|---|
| `index.html` | the entire client — game, Warden, ranks, proof page |
| `api/game.js` | the entire game server: THE BOARD (hourly-generated targets), sealed shots, lazy settlement, XP/ranks, daily + weekly pots, champion payouts, soft-staking, burn-verified reloads, log anchoring |
| `api/proof.js` | the live proof: every claim re-checked against the chain, each able to go red |
| `lib/prices.js` | Pyth Hermes prices, Coinbase fallback — keyless GETs, same source at seal and settle |
| `lib/burn.js` | reads a burn transaction from the chain and credits it only if it is real, recent, supply-reducing, and never seen before |
| `lib/verify.js` | wallet-signature auth (Ed25519 via node:crypto), no JWT, no session store |
| `lib/log.js` | the hash-chained event log and its permissionless on-chain memo anchor |
| `lib/kv.js` | Upstash Redis if configured, honest in-memory fallback if not |
| `api/snapshot.js` | the Black Box: the whole state, downloadable and verifiable by anyone |
| `restore.mjs` | verify a snapshot's hash chain and resurrect the machine into fresh storage |
| `RESURRECTION.md` | the stranger's guide to bringing the machine back |
| `test_harness.mjs` | offline tests over the pure decision functions — `node test_harness.mjs` |
| `CHANGES_2026-08-19.md` | the hardening pass: what was wrong, what changed, why |
| `ONCHAIN.md` | the devnet settlement program: what it proves, with transaction links |

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
(default 1) · `RATCHET_LP_BURN_TX` (optional override for the LP proof line) · **`PYTH_API_KEY`** (required from
2026-08-26 16:00 UTC — the Pyth Core upgrade makes a key mandatory; without it the game falls back
to a thinner price source and says so on the page) · `PYTH_HERMES_URL` (override the Hermes host)

No private key exists anywhere in this system. There is nothing to steal and nothing to rug —
not as a promise, as a property. Read the code; that's what it's for.
