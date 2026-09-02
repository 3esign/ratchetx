# What we stand on

*A dependency you cannot name is a dependency you cannot check.*

Every product in this category is built on other people's machines. Almost none
of them will tell you which ones, and none of them will tell you what happens to
your money when one of those machines stops.

This is that list. Seven names, what each actually does here, and — the part
normally left out of a credits page — what breaks for you if it goes away.

The last entry is the one we would rather you watched.

---

## Pyth Network — the referee

**What it does here.** Every entry price and every exit price. We read the
sponsored push feeds straight off Solana as raw accounts and decode
`PriceUpdateV2` ourselves rather than trusting a convenience API to tell us what
the chain says. What those feeds actually do, minute by minute, is published in
[the observatory](https://ratchetx.xyz/api/feeds) — including how stale each one
currently is, because a price that is sixty seconds behind the market is a fact
you deserve before you seal, not after.

**If it stops.** Shots defer rather than settle. If no valid sample lands inside
the 15-minute grace window they **void and refund**. We never invent a number,
and we never substitute a different source to keep the game moving: Coinbase
appears only as a clearly-labelled degraded display reference and has never
sealed or settled a real shot.

That refusal is deliberate. A prediction market that will settle on *some* price
when its referee is unavailable is a prediction market whose referee is really
the operator.

## Solana — the ledger

**What it does here.** The ledger for every token fact: the Token-2022 mint,
every burn, every Champion's Cut transfer, every memo anchor, every wallet
signature. Credits, XP and live shot state are still server-side — see the last
entry.

**If it stops.** No burns, no RCX payouts, no anchors. Real shots stop sealing.
Unresolved shots wait for valid Pyth data and then void and refund by the same
rule as always.

## Helius — mainnet RPC

**What it does here.** The endpoint that actually answers when we read oracle
accounts, your token balance, and the mint.

**If it stops.** We rotate to public endpoints automatically. Slower and
rate-limited, the price cache carries more of the load, and the game keeps
running. This is the one dependency on the list with a working understudy.

## QuickNode — devnet RPC

**What it does here.** A secondary RPC used for isolated compatibility and
program tests before anything reaches mainnet. Its five-key cap on
`getMultipleAccounts` is the reason we batch account reads in fives — a
constraint from a test environment that shaped production code, which is worth
saying out loud because that is how real systems actually get their shapes.

**If it stops.** Nothing on mainnet changes. It slows down what we can test, not
what you can play.

## pump.fun — the launch

**What it does here.** $RCX launched there and its liquidity lives in the
PumpSwap pool. It is also the only place the creator earns anything: trading
fees, nothing else, ever. No team allocation, no fee on your play, no cut of the
pot.

It is also why the burn matters. A launchpad token normally has nothing that
removes it from circulation. This one shrinks every time somebody takes a shot,
measured daily off the mint account in [the supply clock](https://ratchetx.xyz/api/supply).

**If it stops.** The token is an ordinary Solana mint and does not depend on the
site that launched it. The pool would be affected; the supply would not. The
burn keeps working regardless, because it happens inside the player's own
transaction rather than ours.

## Vercel — hosting

**What it does here.** The site and every serverless endpoint behind it.

**If it stops.** The page is down. Nothing is lost: the event log is
hash-chained, the whole state exports at
[/api/snapshot](https://ratchetx.xyz/api/snapshot) — or in pages at
[/api/log](https://ratchetx.xyz/api/log?limit=200), which is how you export it
once the log is large enough that one response stops arriving — and anyone may
already have anchored its head into Solana from their own wallet. Killing the
hosting pauses the game. It can no longer end it.

---

## Supabase — the state, and our weakest link

We label it that on our own front page, so let us be precise about what it means.

**What it does here.** Production Postgres holds players, credits, XP, open
shots and the price log. This live game state is durable, and it is **not on a
chain**.

**If it stops — the honest answer.** This is the piece you have to take on
trust, so here is exactly how much, and exactly where the trust runs out.

Every seal, settle, reload and payout is hash-chained: alter one past event and
every hash after it breaks. Anyone can anchor the current head into a Solana
memo transaction from their own wallet, which timestamps our history with a
party that is not us. Scribes earn XP for doing it, because the log's integrity
should be a game mechanic rather than a chore.

What that does **not** cover is a rewrite between anchors. Putting shot records
on Solana directly — compressed, roughly 0.000015 SOL each — is what actually
closes that window, and it is the next thing on the list.

Anchor often. That is why the button is there, and why it pays.

### And here is what it looks like when the weakest link actually moves

In August our own proof page went red and told anyone who looked that the event
log did not verify. It stayed red for days while we worked out why.

Nothing had been tampered with. We had hashed `JSON.stringify` output, whose
byte order is insertion order, and Postgres `jsonb` does not store JSON text —
it parses, and returns keys in its own canonical order. From the Postgres docs,
verbatim: *"jsonb does not preserve the order of object keys."* The day the
backend moved, every entry came back rearranged. Values untouched, bytes
different, every hash unreproducible at once.

Supabase behaved exactly as documented throughout. The bug was ours, and it was
the classic one: hashing the serialization instead of the value.

We recovered 2,058 of 2,059 entries by replaying the key order each event was
written in, and published the arithmetic in [CHAIN_GAP.md](CHAIN_GAP.md). The
single entry we could not recover was never written to disk at all, and it stays
missing and named rather than plausibly reconstructed.

The point for this page: **the dependency that surprises you is not the one you
forgot. It is the one you named, understood, and still under-modelled.** That is
the argument for writing this list rather than a logo wall.

---

## What each dependency is configured with

Names only — never values. Added 2026-08-28 because a dependency you cannot see
the switch for is one you cannot check, and one of these had gone unwritten long
enough to hide a live defect (`SOLANA_WS`, see
`ops/heartbeat-worker/README.md`).

| variable | dependency | if it is unset |
|---|---|---|
| `SOLANA_RPC` / `SOLANA_RPC_URL` | Helius | we rotate three public RPCs — slower, rate-limited, the game still runs |
| `SOLANA_WS` | Helius (websocket) | the capture stream subscribes on public RPCs and silently drops notifications |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase | production state has no store; the site cannot serve real shots |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Upstash | the documented rollback store is unavailable; Supabase remains primary |
| `CAPTURE_SECRET` | our own capture endpoint | the account-transition stream does not run; minute polling carries settlement alone |
| Pyth API key | not accepted by the runtime price path | no secret can add a feed or change the economic board; sponsored on-chain accounts remain canonical |
| `CRANK_INTERVAL_MS` | `tools/crank.mjs` | the local cranker uses its built-in interval |

Every one of these degrades to something stated rather than to silence, which is
the property that makes the list worth publishing.

---

## Why publish this at all

Because a venue that will not name its dependencies is asking you to trust its
operator, and this product's entire claim is that you should not have to.

Every line above is checkable. The oracle accounts are public. The mint is
public. The event log exports in full. The proof page re-runs twenty-odd claims
against Solana on every load and shows its own failures in the same colour as
everyone else's.

If one of these stops and we have described it wrongly here, that is a bug in
this document, and we would rather you found it.

*Live: [ratchetx.xyz](https://ratchetx.xyz) · verify:
[/api/proof](https://ratchetx.xyz/api/proof) ·
[/api/snapshot](https://ratchetx.xyz/api/snapshot) ·
code: [github.com/3esign/ratchetx](https://github.com/3esign/ratchetx)*
