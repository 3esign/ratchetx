# Self-hosting RatchetX

Part of [the Unkillable Roadmap](UNKILLABLE.md): nothing about this game should
require our servers, our domain, or our goodwill. This page documents what you
can run yourself **today**, honestly — including the parts that still depend on
us and when that dependency dies.

## 1. Run the crank (2 minutes, no keys)

Settlement is lazy and permissionless: any request that touches a wallet
settles that wallet's expired shots, and the exit price is the first oracle
sample at or after expiry — the same number no matter who triggers it or when.

```bash
node tools/crank.mjs           # keeps the live game settling, forever
node tools/crank.mjs --once    # single pass
```

Zero dependencies, Node 18+. It stays politely under the public rate limits.
If our own cron ever dies, whoever runs this **is** the infrastructure.

## 2. Run the frontend

The site is a single self-contained `index.html` calling the API with relative
paths. Serve it from anywhere and point it at any API origin:

```bash
git clone https://github.com/3esign/ratchetx && cd ratchetx
npx serve .                    # or python3 -m http.server
```

For a mirror against the live game, put it behind any static host and proxy
`/api/*` to `https://ratchetx.xyz/api/*` (one rewrite rule on Netlify, Caddy,
nginx — anything). Permanent-storage mirrors (Arweave/IPFS) are Ring 3 of the
roadmap and will be linked here when pinned.

## 3. Run the whole API

The backend is plain serverless functions (`api/*.js`) over a Postgres-backed
KV (Supabase) — `vercel dev` runs it locally, any Node host runs it in
production. Environment:

| Variable | What it is |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | your own Postgres/KV (schema in `supabase/*.sql`) |
| `SOLANA_RPC_URL` | any Solana RPC — settlement reads Pyth's on-chain price accounts (free, no API key) |
| `RATCHET_MINT` | the $RCX mint (or your own token for a fork) |
| `RATCHET_SEAL_PROGRAM_ID`, `RATCHET_SEAL_RPC_URL`, `RATCHET_SEAL_CLUSTER`, `RATCHET_SEAL_FEEDS` | on-chain sealing config |
| `PUBLIC_ORIGIN` | your deployment's public URL |
| `PYTH_API_KEY`, `PYTH_HERMES_URL` | optional Hermes failover only — not required |
| `X402_ENABLED`, `X402_ENTRY_USDC_ATOMIC`, `X402_FACILITATOR_URL`, `X402_FACILITATOR_BEARER` | optional standard x402 v2 agent door; prove your own configured recipient, amount, settlement and replay with a funded smoke before enabling |
| `KV_REST_API_URL/TOKEN`, `UPSTASH_REDIS_*` | legacy KV fallbacks — not needed on Supabase |
| `RATCHET_CAPTURE_SECRET`, `RATCHET_LP_BURN_TX`, `CREDIT_PER_TOKEN` | ops extras; safe to omit |

Then `npm test` — the full suite runs against your instance's handlers with a
stubbed KV, so you know your copy behaves exactly like ours.

## 4. What self-hosting means, honestly

Running your own API gives you your **own** game state (your players, your
log), not a live replica of ours — the public state of the live game is fully
exportable at [`/api/snapshot`](https://ratchetx.xyz/api/snapshot) and
`restore.mjs` can resurrect a whole instance from one snapshot file. What no
self-hoster can do is forge history: the event log is hash-chained, anchored to
Solana by players, and the sealed program on mainnet is immutable after
September 8, 2026 ([FREEZE.md](FREEZE.md)).

The remaining hard dependency is the oracle: settlement is only as alive as
Pyth's on-chain price accounts. That dependency is deliberate — it is the one
part of the system that should *not* be ours.
