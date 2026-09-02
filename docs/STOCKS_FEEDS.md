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

- **Free data.** ~~Pyth Hermes serves the signed `Equity.Index.*` updates with no
  API key and no subscription at the keyless endpoint
  `https://pyth.dourolabs.app/hermes`.~~ **This is no longer true — see the
  correction below, measured 2026-09-02.** Both hosts now answer `401`.
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


---

# Correction, 2026-09-02: there is no keyless Hermes any more

The bullet above was right when it was written and is wrong now. Measured today
against both hosts, server-side, no browser involved:

| request | result |
| --- | --- |
| `hermes.pyth.network/v2/updates/price/latest?ids[]=<TSLA>` | **401** |
| `pyth.dourolabs.app/hermes/v2/updates/price/latest?ids[]=<TSLA>` | **401** |
| `hermes.pyth.network/v2/updates/price/latest?ids[]=<SOL>` | **401** |
| `pyth.dourolabs.app/hermes/v2/price_feeds?asset_type=equity` | **200** |

The metadata path is still open, which is why the feed-id verification earlier
the same day succeeded and read as evidence that the host was keyless. It was
evidence about a different endpoint. The one that carries prices is shut.

Pyth's own upgrade page says it plainly: *"The one new requirement is
authentication on Hermes: every Hermes user needs a Pyth API Key"*, and
*"hermes.pyth.network now requires authentication, including for integrations
that were upgraded automatically."* It is not equity-specific and not
host-specific: SOL is refused by the same endpoint that refuses TSLA. The
`dourolabs` mirror was never a keyless alternative; it is the upgraded host.

## What this does to the argument on this page

The pull path's claim was never "cheap". It was **"free, on-chain and
trustless"**, and the free half rested entirely on a keyless Hermes. Read the
consequences in order:

1. **Crypto is untouched.** It never needed Hermes. The program reads sponsored
   `PriceUpdateV2` accounts on Solana, and Pyth confirms on-chain push reads
   need no key. A stranger with any RPC and a keypair can still crank every
   crypto shot this game has, forever. That property is intact.
2. **Equities cannot be settled without a credential.** No equity feed is
   pushed on Solana — this repo's own gate proved 0/10 across all 256 shards —
   so the only way to a signed equity price is Hermes, and Hermes needs a key.
3. **So "the crank is permissionless — anyone can fetch from the public Hermes
   and post" is false for equities.** A stranger cannot crank an equity shot
   with an RPC and a keypair. They need a Pyth account. That is a gate, and the
   whole point of this program is not having one.

## What that settles, and what it does not

**It settles the frozen core: crypto-only.** The feed table is compiled in
permanently. Freezing equities into it would compile in a dependency on a
credential nobody in the future is guaranteed to hold, in the one artifact whose
entire purpose is to outlive us. An immutable program with five feeds that only
a key-holder can settle is worse than an immutable program with seven that
anyone can.

**It does not settle the server game, and should not.** The site already states
`canonicalSettlement: ratchet-server` and already holds credentials for its own
database. A Pyth key there changes nothing about the trust model it publishes.
Stocks can be playable on the site and through Bankr on a key, today, while the
frozen program stays crypto-only — those are different artifacts with different
promises, and only one of them claims to need nobody.

If equities are ever to be permissionless, the route is a self-hosted Hermes
(it is open source) or an independent node provider — Pyth lists Triton, P2P,
extrnode and Liquify. Both are real infrastructure a stranger must run or buy,
which is a different and much weaker claim than "read an account with any RPC".
That is a decision for a later program, not for the one being frozen.
