# The oracle moved on-chain

**20 August 2026**

## What changed

Pyth Price Feeds expose multiple integration surfaces. Ratchet's canonical route uses
Pyth sponsored push-feed accounts on Solana so the game, observatory and settlement
program share the same PriceUpdateV2 identity. The runtime deliberately has no
authenticated Hermes route: a secret cannot add an economic feed or alter the board.

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
| 2 | Coinbase spot | non-Pyth display-only last resort | never seals or settles |

If we ever fall past step 1, `prices.degraded` says so and the page prints it. The banner
states that the quote is display-only; new shots pause until the verifiable
Pyth-on-Solana crossing data returns.

## The accounts

**Corrected 2026-09-05.** This page previously listed a table of v1 push-oracle PDAs. The program and
`lib/onchain_px.js` have used the **v2** pair since the Pyth receiver upgrade, and every address in
that old table was wrong — an agent that trusted this page would have read the wrong accounts.

The two program ids the code pins (`lib/onchain_px.js:70-71`):

- receiver v2 `rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp` — the **owner** of a price account
- price feed v2 `pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou` — the program the **address** is
  derived under, `find_program_address([u16le(shard 0), feed_id], pyt2…)`

Owner and derivation are different programs on purpose; deriving under the owner gives an address
that does not exist.

**The table below is a copy, not the source of truth.** `lib/onchain_px.js:75-83` is, and the
Timepin `EvidenceSpecV2` pins the feed id per spec. If the two ever disagree, the code is right and
this page is stale again.

| Feed | Sponsored shard-0 account | Feed id |
|------|---------------------------|---------|
| SOL  | `7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE` | `ef0d8b6f…c280b56d` |
| BTC  | `APgzQGGdv2qCgBkX6aHVkrGePtBVDDg68GiqaM7rmtf5` | `e62df6c8…4a415b43` |
| ETH  | `7odryi4WfoMFHtv2eubdMgP1pqQMmdiXSK1N2tqZ2nRH` | `ff61491a…34fd0ace` |
| BONK | `3nMpgBXnjBSDYupQQEVR7DZM65zkJCdKy1Up7nkqp99w` | `72b02121…29314419` |
| PUMP | `4KL8nVtrXmLjbbHtrDz5YCHNqmii62oHfr9bsUtx1bgi` | `7a01fca2…b8d5c3b9` |
| JUP  | `EitcZS5LtbR4EyNhCSy56vvUHPhsifSfWFG5gwSkjNpV` | `0a0408d6…be830996` |
| WIF  | `9Sn9FVu6WpufA8yZFSRuxYyFgpBrhc5PpTgB3mq2DcsG` | `4ca4beec…d4cc61fc` |

SOL, BTC and ETH are the core three; the other four are enabled per ruleset. Measured cadence for
the core three, 2026-09-05: SOL and BTC are pushed every 5 s, ETH every ~52 s. That measurement is
what `max_post_target_lag_seconds` must be set from — never a guess.

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
