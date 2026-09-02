# Equities on RatchetX — free, on-chain, trustless (the pull path), before freeze

The referee table (`FEEDS` in `onchain/ratchet-core`) is compiled in. Anything
not in it when the core is frozen can never be called. So equities have to be
settled before freeze — and settled correctly. This doc records the real finding
and the one path that is free, on-chain and trustless.

## The finding (corrects the earlier version of this file)

An earlier draft of this doc claimed the `Equity.Index.*` feeds are **sponsored
push feeds on Solana**. That was **wrong**. The gate proves it:
`scripts/check-equity-feeds.mjs` scanned every candidate on all 256 shards and
found **0/10** — no equity feed is pushed on Solana, on any shard, by anyone
(the SOL control row is ✓, so the scan is sound). Pyth, Chainlink, Switchboard
and RedStone **all** gate equities behind a **pull** model, not a free push
account. There is no free sponsored equity push to read the way SOL is read.

That does not kill stocks. It changes the mechanism from *push* to *pull*.

## Push vs pull, in our terms

- **Push (what SOL/crypto uses):** Pyth keeps a `PriceUpdateV2` account updated
  at a sponsored PDA `[u16le(0), feed_id]`. Our `checkpoint` just **reads** it —
  the whole cost is one account read; the crank pays nothing to keep it fresh.
  No equity feed is sponsored this way.
- **Pull (what equities need):** nobody keeps an equity account on-chain for
  free. Instead the crank **fetches** a Pyth-signed price from Hermes and
  **posts** it as a temporary `PriceUpdateV2` via the Pyth receiver, in the same
  transaction that reads it, then closes that account to reclaim its rent. The
  posted account is the *same struct* our program already parses — only its
  provenance differs (posted per-update vs. sponsored-permanent).

## Why the pull path is still free and still trustless

- **Free data.** Pyth Hermes serves the signed `Equity.Index.*` updates with no
  API key and no subscription at the keyless endpoint
  `https://pyth.dourolabs.app/hermes`. (Avoid the legacy `hermes.pyth.network`
  — it began requiring an API key on 2026-08-26. Use the keyless host.)
- **Near-zero on-chain cost.** The crank posts the update (an ed25519
  verification + a receiver post instruction), the program reads it, and the tx
  closes the update account (`closeUpdateAccounts: true`) so the rent comes
  back. Net cost ≈ the ordinary Solana transaction fee — a fraction of a cent —
  plus a little compute. No standing rent, no subscription, no licence.
- **Still trustless.** The price is **Pyth-signed** and **receiver-verified
  on-chain**; our program keeps every check it does today (owner = the Pyth
  receiver, Full verification, `feed_id` match, freshness, confidence ≤ 200 bp).
  The crank is **permissionless** — anyone can fetch from the public Hermes and
  post — so there is no founder in the loop. The settle rule (first observation
  with `prev_publish < expiry ≤ publish`, equality voids) is **unchanged**.
- **Same safety valve.** An equity shot settles only if some crank posts a
  crossing update within the 120 s window; if none does, it **voids and
  refunds**, exactly like a quiet feed today. Nobody can be cheated by absence.

The honest difference from crypto: SOL is *free to read*, equities are *cheap to
post*. The crank does a little more work (fetch + post) per equity update
instead of a bare read. That is the whole tradeoff — a few extra lamports and
some compute on the crank, no money to any provider.

## The program change (pre-freeze, small, self-contained)

Today `load_push_price_update` enforces the sponsored shard-0 PDA
`[u16le(0), feed_id]`. For equity feed indices, add a checkpoint variant that
accepts a **posted** receiver-owned `PriceUpdateV2` (the account the crank just
created) instead of the PDA account — keeping **every other check** (owner =
`rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp`, Full, `feed_id` match, freshness,
confidence). Everything downstream — the clock ring, `crossing`, `settle`,
`reveal`, XP, payout — is untouched, because it all operates on the recorded
observation, not on how the price got on-chain. So this is one localized change
to how a price enters, tested with the LiteSVM battery using an equity feed id,
reprinted into the golden vectors, hashed into `docs/CORE.md` as the 4th (or
combined-with-legacy) build.

The crank side (`client/crank.mjs`) gains an equity branch: for an open equity
shot near expiry, fetch the `Equity.Index` update from Hermes, post it via
`@pythnetwork/pyth-solana-receiver`, then checkpoint/settle against it in the
same tx. The mainnet client already imports the receiver SDK pattern; the runner
stays a single stranger-runnable process.

## The alternatives, and why pull-from-Pyth wins

| path | free? | trustless? | notes |
|---|---|---|---|
| **Pyth pull (Equity.Index)** | **yes** (Hermes keyless; rent reclaimed) | **yes** (Pyth-signed, permissionless crank) | **recommended** — same oracle we already use, one small program change |
| Chainlink Data Streams (US equities/ETFs) | no | pull/verified | launched Jan 2026, but Solana equity access is Data Streams (pull) and likely needs credentials/licensing — a new dependency |
| Switchboard On-Demand | ~ (pull, custom feed) | yes | Solana-native pull; equities need a custom feed wired to a data provider (Polygon/Twelve Data), which may carry licensing |
| RedStone (Wormhole Queries) | ~ | yes | RWA/tokenized focus; pull via Wormhole Queries, more moving parts |
| self-sponsor a Pyth push feed | no (we pay to crank a standing account) | **no** — it then depends on us | rejected: reintroduces a founder dependency |

## Verified `Equity.Index` feed ids (now the pull feed ids)

Same ids, still valid — they are what the crank passes to Hermes and what the
program matches on. Their shard-0 push accounts do **not** exist (that is the
0/10 finding); these are pull feeds.

| ticker | feed id (Equity.Index, 24/7) |
|---|---|
| TSLA | `e6da44bff5b8b06897a3739dd331b440d6662595bb862e37046892c568ae3fc0` |
| NVDA | `a470c4ac46f44b547b2cba52338f311fb642b79375ce5f0cfd5cb5b99227b852` |
| PLTR | `52c7c6b70032b7151c8d0febf684f14318e1e13315976e171267639955400bb9` |
| COIN | `49387483ff50427bf0ff5928082b0cf16331421067c59f4c582a07aa117db1ac` |
| HOOD | `4a4f96283d157d08b7b8aa596363f7978587d4fa59a77dcb90f84af7d870a630` |

Source: Pyth Hermes `GET /v2/price_feeds?query=<T>&asset_type=equity`. An
`Equity.Index` price is Pyth's continuous 24/7 price for the name, a synthetic
mark overnight — so the target must label it `Pyth 24/7 index`, not "NASDAQ".

## Founder decision

Stocks are possible, free, on-chain and trustless via the Pyth pull path, at the
cost of one pre-freeze program change and a slightly busier crank. The decision
is *whether to spend that engineering before freeze*:

- **Do it:** add the equity pull-checkpoint variant + crank branch, gate one
  equity feed through the LiteSVM battery, fold it into the pre-freeze build.
  Stocks ship on the same trustless rails as SOL.
- **Defer:** freeze crypto-only now; equities can never be added after freeze
  (the table is compiled in), so deferring means a *separate* stock program
  later, or waiting for Pyth to sponsor equity push (may never happen).

Because the table is frozen forever, this is the one stocks question that must be
answered *before* the freeze, not after.
