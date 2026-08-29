# The oracle moved on-chain

**20 August 2026**

## What changed

Pyth Price Feeds expose multiple integration surfaces. Ratchet's canonical route uses
Pyth sponsored push-feed accounts on Solana so the game, observatory and settlement
program share the same PriceUpdateV2 identity. A configured authenticated Hermes route
is labeled display-only failover; it never changes settlement authority.

## What we did instead

Pyth does not only serve prices over HTTP. It also **pushes** sponsored price feeds onto
Solana accounts. Those accounts hold the `PriceUpdateV2` struct that Solana programs
can validate directly.

So the game now reads the oracle where it actually lives.

`lib/onchain_px.js` fetches the seven sponsored feed accounts over Solana JSON-RPC,
decodes them, and validates owner, account discriminator, verification level, feed ID,
age and confidence before a value can enter the game.

### Source order (`lib/prices.js`)

| # | Source | Role | When |
|---|--------|------|------|
| 1 | **Pyth on-chain** — sponsored PriceUpdateV2 accounts on Solana | canonical game and evidence state | always the primary |
| 2 | Pyth Hermes | optional labeled display failover | only when explicitly configured |
| 3 | Coinbase spot | non-Pyth display-only last resort | never seals or settles |

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
```

Unset, `SOLANA_RPC` rotates three public endpoints
(`api.mainnet-beta.solana.com`, `solana-rpc.publicnode.com`, `solana.drpc.org`), sticking
to whichever answered last and failing over on error. It works out of the box; a private
endpoint is one env var and the difference between "works" and "works under load".

Requests are batched **5 accounts per call** — the smallest `getMultipleAccounts` cap we
have actually hit in production. Seven feeds = two calls.
`getPrices()` caches for 3 seconds and collapses concurrent callers into a single upstream
fetch, so a burst of readers costs two RPC calls, not two per reader.

## Why this is better than what it replaced

It avoids splitting live evidence across separate oracle identities, but still depends on
Solana RPC availability and Pyth continuing to sponsor these accounts. Those dependencies
are monitored and surfaced.

It is also **more honest**. The website now reads the exact same account the settlement
program validates on-chain. Before, the page trusted an HTTP endpoint and the program
trusted an account, and you had to take our word that they agreed. Now they are the same
bytes, and anyone can fetch them.

The API transition made the architecture more directly verifiable.
