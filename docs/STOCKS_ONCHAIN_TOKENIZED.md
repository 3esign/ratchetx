# Stocks without a key: the tokenized equities ARE sponsored push feeds

Measured 2026-09-02 against Solana mainnet. This reopens a question
`STOCKS_FEEDS.md` closed, and it closes it the other way.

## What we had concluded, and why it was half right

`scripts/check-equity-feeds.mjs` scanned every candidate across all 256 shards
and found **0/10** — no equity feed is pushed on Solana by anyone. That result is
correct and reproduced here: the sponsored account for
`Equity.Index.TSLA/USD` genuinely does not exist.

But the scan asked about `Equity.*` feed ids. Pyth also carries the **tokenized**
stock — the xStock that trades as an SPL token on Solana — and it files those
under a different asset class entirely:

| symbol | Pyth asset_type |
| --- | --- |
| `Equity.US.TSLA/USD` | Equity |
| `Equity.Index.TSLA/USD` | Equity |
| **`Crypto.TSLAX/USD`** | **Crypto** |

Crypto is the class Pyth sponsors on Solana. Nobody scanned it, because nobody
thought to look for Tesla under crypto.

## The measurement

Derived `[u16le(0), feed_id]` under the upgraded push oracle
`pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou`, then read the accounts from
mainnet. The SOL row is the control: it derives to `7AviUf9n…`, the exact
account this program already settles on, so the derivation is sound.

Every row below is `owner == rec2HHDD…` (the Pyth receiver our program requires),
`verification_level == Full`, and carries the feed id we asked for — the same
three checks `load_push_price_update` makes on chain.

| feed | sponsored account | price | conf | age at read |
| --- | --- | --- | --- | --- |
| SOL *(control)* | `7AviUf9n…HmyE` | 99.27 | 1.6 bp | **16 s** |
| `Crypto.TSLAX/USD` | `G8EJV1bq…tcP2` | 353.18 | 3.2 bp | 417 s |
| `Crypto.NVDAX/USD` | `VSgf6jkw…Gix2` | 224.64 | 3.8 bp | 417 s |
| `Crypto.SPYX/USD` | `27Tv3HxU…kBfj` | 769.80 | 4.2 bp | 417 s |
| `Crypto.AAPLX/USD` | `B6c2xp8M…A6P2` | 326.62 | 4.6 bp | 417 s |
| `Crypto.MSTRX/USD` | `4Jf6DZsT…yoyr` | 122.44 | 3.3 bp | 417 s |
| `Crypto.CRCLX/USD` | `FFxq8yAd…AzTa` | 88.85 | 2.9 bp | 417 s |
| `Crypto.COINX/USD` | `GRm3Xf3j…4nrE` | 174.38 | 5.8 bp | **38,760 s** |
| `Crypto.HOODX/USD` | `E9eZfBLK…V33P` | 108.96 | 3.3 bp | **585,798 s** |
| `Equity.Index.TSLA/USD` | `4js3tyQv…btig` | — | — | **account does not exist** |

## What this means

**There is a keyless, on-chain, permissionless price for stocks after all.** It
is the same mechanism as SOL, read the same way, by the same program, with the
same three checks. No Hermes. No API key. No subscription. A stranger with any
RPC can read it, and the frozen program can settle on it with the code it
already has — these are `PriceUpdateV2` accounts at sponsored PDAs, which is
exactly what `load_push_price_update` was written for. **No program change of
any kind is required** — no pull path, no posting, no `PULL_FROM_INDEX`, none of
the equity-pull patch. Only the feed table changes.

That is a strictly better answer than the pull design in `EQUITY_PULL_CANDIDATE.md`,
which is now obsolete: it existed to work around the absence of a sponsored
equity account, and the absence was in the wrong asset class.

**The honest caveat is freshness, and it is a real one.**

Six of these feeds — TSLAX, NVDAX, SPYX, AAPLX, MSTRX, CRCLX — carry the
**identical** `publish_time`. That is one publisher writing them in a batch, and
across two reads 17 s apart none of them moved while SOL wrote twice. Observed
staleness climbed 239 s -> 417 s -> 434 s -> 502 s across four reads spanning
about nine minutes, all on the same unchanged write, while SOL wrote on every
one. So the batch cadence is **at least ~8.5 minutes and was still counting when
we stopped**, against a `MAX_AGE_S` of 120.

COINX at 10.7 hours and HOODX at 6.8 days are not slow, they are abandoned.

## What that permits, and what it forbids

- **It forbids 5-minute stock shots.** A seal needs a price fresher than
  `min(60, max(30, 0.15 × windowSeconds))` seconds. Nothing on a 7-minute
  cadence can clear that on a short window, and the seal would be refused —
  correctly, and every time.
- **It permits long horizons.** The settle rule wants a transition with
  `publish_time >= expiry` inside the grace window. On a 6-hour or 24-hour
  target a 7-minute cadence is ample.
- **It forbids COINX and HOODX outright**, and would forbid any feed whose
  publisher stops. The staleness guard already handles that by dropping the
  target rather than settling it, which is the behaviour we want.

So the shape is: **stocks on long windows, on the maintained feeds, read free
from Solana** — and no stock on a flash window until a publisher proves a
faster cadence. That is a smaller feature than "TSLA higher in 5 minutes", and
it is one nobody needs our permission or our API key to settle.

## The cadence, measured (2026-09-02, 13.4 minutes, 18 polls, 0 errors)

Polled all nine accounts every 20 s and recorded every distinct `publish_time`.

| feed | writes | gap between writes | stale at end |
| --- | --- | --- | --- |
| SOL *(control)* | 18 | 20–61 s, **median 60 s** | 70 s |
| TSLAX, NVDAX, SPYX, AAPLX, MSTRX, CRCLX | 2 each | **exactly 870 s, all six identical** | 712 s |
| COINX | 1 | never wrote | 11.1 hours |
| HOODX | 1 | never wrote | 6.8 days |

SOL's 60 s median is the documented sponsored heartbeat, so the measurement is
calibrated. The six live xStocks share one publisher writing them together on a
**14.5-minute** schedule — the gap is not approximately equal across the six, it
is the same integer.

## What that does to the seal rule, arithmetically

A seal needs an entry price fresher than
`min(60, max(30, 0.15 × windowSeconds))`. That expression is **capped at 60
seconds for every horizon** — a 24-hour target gets the same 60-second bound as
a 5-minute one, because the `min(60, …)` clamps it.

Against an 870-second cadence, a stock price is younger than 60 seconds for
**60/870 ≈ 6.9%** of the time. So roughly **93 out of 100 stock seals would be
refused**, at any horizon, and the 7 that succeed would be whoever happened to
send a message in the minute after a publish.

That is not a feature with a rough edge. It is a feature that does not work, and
the freshness guard is right to refuse it.

## So the decision is a settlement-rule question, and it is the founder's

The mechanism is free, keyless and permissionless — everything that was wanted.
The only thing standing between it and a shippable product is a bound written
for feeds that tick every second. Three honest options:

1. **Leave the rule alone and drop tokenized stocks.** Nothing breaks, the
   finding stays on record, and if a publisher ever speeds up it is a one-line
   feed-table change.
2. **Scale the seal bound to the horizon for slow feeds** — allow an entry price
   up to, say, 2% of the window old, so a 24-hour shot may seal on a 15-minute
   price while a 5-minute shot still demands 60 seconds. This is defensible: on
   a day-long call a 15-minute-old entry is a rounding error. It is also a
   change to the promise the site publishes about seal freshness, and it must be
   published as such, not slipped in.
3. **Wait.** The feeds are new; a publisher may tighten. Costs nothing.

What this is NOT is a case for relaxing the bound globally. The 60-second rule
is what stops a crypto shot sealing on a stale tick, and it should not be
loosened for the seven feeds that meet it easily.

## Also open

1. **Check the price is the instrument we name.** `Crypto.TSLAX/USD` is the
   price of the *tokenized share*, not of TSLA on NASDAQ. It tracks the share
   via the redemption rate (`Crypto.TSLAX/TSLA.RR` exists as its own feed), and
   it can trade at a premium or discount. The card must say TSLAX, not TSLA —
   the same discipline as `PYTH 24/7 INDEX · NOT AN EXCHANGE PRINT`, for a
   different reason.
