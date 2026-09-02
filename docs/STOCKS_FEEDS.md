# Equities on RatchetX — the feed work, before the core is frozen

The referee table (`FEEDS` in `onchain/ratchet-core`) is a compiled-in constant.
Anything not in it when the core is frozen can never be called. So the equity
feed ids have to be settled now, and settled correctly.

## The finding that changes the design

Pyth publishes **two** feeds per US ticker:

| kind | symbol | when it prices |
|---|---|---|
| market hours | `Equity.US.<T>/USD` | only while the exchange is open |
| **24/7 index** | `Equity.Index.<T>/USD` | **continuously, "PYTH PRICE IN USD FOR &lt;T&gt; 24/7"** |

The **sponsored push feeds on Solana mainnet are the `Equity.Index.*` ones** —
the Pyth changelog lists `Equity.Index.META/ORCL/PLTR/AMZN/COIN` going live, on
the same default 1-minute heartbeat / 0.5% deviation as the crypto feeds.

That removes the whole market-hours problem. A 24/7 index feed never closes, so
a stock target behaves exactly like SOL: seal any time, settle on the first
print past expiry. **No "market closed" state, no hours table, no new rule.**
The earlier plan's open/closed UI is not needed — drop it.

What it does mean, and must be said plainly on the target: an `Equity.Index`
price is *Pyth's* continuous price for the name, not the exchange's last trade.
Overnight it is a synthetic mark. That belongs in the target label, not buried.

## Verified feed ids and their shard-0 push accounts

Push account = `findProgramAddress([u16le(0), feed_id], pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou)`
— the same derivation the program already enforces in `load_push_price_update`.

| ticker | kind | feed id | shard-0 push account |
|---|---|---|---|
| TSLA | **Index 24/7** | `e6da44bff5b8b06897a3739dd331b440d6662595bb862e37046892c568ae3fc0` | `4js3tyQv7Ljb9kiWkB3zBaoUq689HF9qL6JTfamcbtig` |
| TSLA | US hours | `16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1` | `Ayoy1gwnhWiycXt31Jj14MDPwnmcERXEg6zTybju8kYo` |
| NVDA | **Index 24/7** | `a470c4ac46f44b547b2cba52338f311fb642b79375ce5f0cfd5cb5b99227b852` | `DrMQPTkUTAWNtgxcgLQQDHXqq667AHzMvvsnpsCcXtju` |
| NVDA | US hours | `b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593` | `BpsV4NCkHxC3FzykhvwMqo3Xkntm2EyPWdC92fVum1Xh` |
| PLTR | US hours | `11a70634863ddffb71f2b11f2cff29f73f3db8f6d0b78c49f2b5f4ad36e885f0` | `J8a2hEH8gFwe1PhHrQkz19Y2qXv3XYtN5TRp24KCixKr` |
| COIN | US hours | `fee33f2a978bf32dd6b662b65ba8083c6773b494f8401194ec1870c640860245` | `2ctzeAF3nZRfvzCsrC4D4mHEgMpRqT2YM7qwRJ5vHHta` |
| HOOD | US hours | `306736a4035846ba15a3496eed57225b64cc19230a50d14f3ed20fd7219b7849` | `5tQB19sUG39h8UipEy6zaHJqxVy7ixMnaT9UTN3vPgMd` |

Source: Pyth Hermes `GET /v2/price_feeds?query=<T>&asset_type=equity`.
PDAs derived locally with `@solana/web3.js` — no network, reproducible.

### The complete 24/7 Index set (what actually goes in the table)

These are the sponsored `Equity.Index.*` feeds and their shard-0 push accounts —
the ones a stock target would use, no market hours:

| ticker | feed id (Index 24/7) | shard-0 push account |
|---|---|---|
| TSLA | `e6da44bff5b8b06897a3739dd331b440d6662595bb862e37046892c568ae3fc0` | `4js3tyQv7Ljb9kiWkB3zBaoUq689HF9qL6JTfamcbtig` |
| NVDA | `a470c4ac46f44b547b2cba52338f311fb642b79375ce5f0cfd5cb5b99227b852` | `DrMQPTkUTAWNtgxcgLQQDHXqq667AHzMvvsnpsCcXtju` |
| PLTR | `52c7c6b70032b7151c8d0febf684f14318e1e13315976e171267639955400bb9` | `8STTMeEVT2LrWFwbrGuxgYsSYrZvEPiDrYJ3FVJVR1Xj` |
| COIN | `49387483ff50427bf0ff5928082b0cf16331421067c59f4c582a07aa117db1ac` | `4RK9ma1VdZUn2UeYVTfYGXBPTzdZ3UdaQSudrSX7cDx9` |
| HOOD | `4a4f96283d157d08b7b8aa596363f7978587d4fa59a77dcb90f84af7d870a630` | `Ei8W2FRPJbexWLsiRnvi6VF2Ne3YWVt66ucDqZyC8HV8` |

## Gate before any of this reaches the referee table

A feed id is not enough. For each candidate, on mainnet:

1. **The push account must exist** and be owned by the receiver
   `rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp`. If it does not exist, the feed
   is published by Pyth but **not sponsored on Solana**, and the program could
   never read it. This is the single check that decides inclusion.
2. **Watch it for a day in the observatory** — cadence, stale tail, confidence.
   An equity index feed that goes quiet at 3am is a void machine, and we would
   rather learn that from our own instrument than from a refunded player.
3. Only then: core 4th build (extend `FEEDS`, rerun the LiteSVM battery with an
   equity feed id, reprint the golden vectors, record the hashes).

Check 1 is one RPC call per account: `getAccountInfo(<push account>)` and
compare `owner`. It needs an RPC the cloud bridge does not have, so it ships as a
script for the machine that does:

    node scripts/check-equity-feeds.mjs [your-rpc-url]     # or double-click CHECK_EQUITY_FEEDS.cmd

It checks all five, verifies the receiver owner, and prints price / confidence /
freshness for each — writing `equity_gate_check.txt`. Only the ✓ rows
(exists · receiver-owned · Full-verified · fresh) may enter the frozen table.

## Then, and only then

- Server: add the tickers to the board generator with an equity-appropriate
  volatility, and to the Bankr runner's asset aliases (`tesla`, `nvidia`,
  `palantir`, `coinbase`, `robinhood`) so "ratchetx tesla up 5 min 500" resolves.
- UI: a target label that names the feed honestly — `Pyth 24/7 index`, not
  "NASDAQ". No open/closed chrome needed.
- Observatory: equities become rows in the same table; nobody else publishes how
  sponsored equity feeds behave, and we would be measuring with money on it.
