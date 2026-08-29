# The oracle moved on-chain

**20 August 2026**

## What changed

Pyth moved the Core/API-key cutover to **18 August 2026**. The current upgraded Hermes
endpoint is `https://pyth.dourolabs.app/hermes`; authenticated requests use
`PYTH_API_KEY`. Pricing is intentionally not frozen in this repository because Pyth can
change it. Check the current Pyth plan page before making a purchasing decision.

RATCHET's API key is configured as a failover. The live primary route does not depend on
Hermes: it reads Pyth's sponsored push-feed accounts directly from Solana.

## What we did instead

Pyth does not only serve prices over HTTP. It also **pushes** sponsored price feeds onto
Solana as ordinary accounts. Those accounts hold the same `PriceUpdateV2` struct, signed
by the same publishers, that the pull oracle hands you over HTTP. Reading a Solana
account is not something anyone can bill for.

So the game now reads the oracle where it actually lives.

`lib/onchain_px.js` fetches the seven sponsored feed accounts over plain Solana JSON-RPC
and decodes them itself. No oracle SDK and no Pyth API key are required for that route.

### Source order (`lib/prices.js`)

| # | Source | Cost | When |
|---|--------|------|------|
| 1 | **Pyth on-chain** — sponsored accounts on Solana | free | always the primary |
| 2 | Pyth Hermes | current Pyth plan | only if `PYTH_API_KEY` is set |
| 3 | Coinbase spot | free | last resort, and never silent |

If we ever fall past step 1, `prices.degraded` says so and the page prints it. The banner
distinguishes *"still Pyth, different route"* from *"not Pyth at all"*, because those are
very different promises to a player.

## The accounts

Shard-0 push-feed PDAs, derived from `[u16le(0), feed_id]` under the Pyth push oracle
program and checked against Pyth's published sponsored-feed table.

| Feed | Account |
|------|---------|
| SOL  | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` |
| BTC  | `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo` |
| ETH  | `42amVS4KgzR9rA28tkVYqVXjq9Qa8dcZQMbH5EYFX6XC` |
| BONK | `DBE3N8uNjhKPRHfANdwGvCZghWXyLPdqdSbEW2XFwBiX` |
| PUMP | `HMm3GPbdnqGwbkTnUUqCFsH8AMHDdEC3Lg8gcPD3HJSH` |
| JUP  | `7dbob1psH1iZBS7qPsm3Kwbf5DzSXK8Jyg31CTgTnxH5` |
| WIF  | `6B23K3tkb51vLZA14jcEQVCA1pfHptzEHFA93V5dYwbT` |

Anyone can verify a settlement:

```bash
solana account 7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE --url mainnet-beta
```

## What we refuse to read

A price is used only if **all** of this holds:

- the account exists and is owned by one of Pyth's four known programs
- the first 8 bytes equal `sha256("account:PriceUpdateV2")[..8]`
- `verification_level == Full` — a partially-verified update is not good enough
- the `feed_id` inside the account matches the feed we asked for
- `publish_time` is under 120 seconds old (two heartbeats of headroom)
- the decoded price is finite and positive
- the confidence interval is no wider than 2% of the price
- `publish_time` is not more than 5 seconds in the future

A **core** feed (SOL/BTC/ETH) failing any of these throws, and we fall to the next
source. An **optional** feed failing simply drops off the board — its targets disappear
rather than settle on a number we do not trust. That was already the rule; it still is.

## Freshness

Sponsored feeds target a **1-minute heartbeat with a 0.5% deviation trigger**. This is
not a hard availability guarantee. In a moving
market they update constantly. In a dead-flat market they go quiet — which is fine,
because the shortest chamber on the board is five minutes, and a five-minute directional
call in a market that has not moved 0.5% was a coin flip anyway.

Rather than hide this, the page shows each price's publish age. A number that says
`SOL $86.56 3s` is making a checkable claim. A number that wiggles every frame is not.

## Configuration

```
SOLANA_RPC=<your mainnet RPC>     # optional but recommended (SOLANA_RPC_URL also accepted)
PYTH_API_KEY=<key>                # configured failover credential
PYTH_HERMES_URL=https://pyth.dourolabs.app/hermes
PYTH_BENCHMARKS_URL=https://benchmarks.pyth.network/v1  # optional proof-verifier override
```

Unset, `SOLANA_RPC` rotates three public endpoints
(`api.mainnet-beta.solana.com`, `solana-rpc.publicnode.com`, `solana.drpc.org`), sticking
to whichever answered last and failing over on error. It works out of the box; a private
endpoint is one env var and the difference between "works" and "works under load".

Requests are batched **5 accounts per call** — the smallest `getMultipleAccounts` cap we
have actually hit in production (QuickNode's free plan). Seven feeds = two calls.
`getPrices()` caches for 3 seconds and collapses concurrent callers into a single upstream
fetch, so a burst of readers costs two RPC calls, not two per reader.

## Why this is better than what it replaced

It avoids a metered oracle HTTP path, but still depends on Solana RPC availability and
Pyth continuing to sponsor these accounts. Those dependencies are monitored and surfaced.

It is also **more honest**. The website now reads the exact same account the settlement
program validates on-chain. Before, the page trusted an HTTP endpoint and the program
trusted an account, and you had to take our word that they agreed. Now they are the same
bytes, and anyone can fetch them.

The API transition made the architecture more directly verifiable.
