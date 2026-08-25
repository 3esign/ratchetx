# One week of RATCHET: shipping a machine that cannot lie on Solana

Seven days ago we launched a token on pump.fun and pointed it at a working game. This is
the honest account of what got built in the week since — what's live, what's measured,
what broke, and what any of it means for tokens launched the way ours was.

Everything below is checkable. That's the whole point.

---

## What RATCHET is

RATCHET is a prediction arcade at **ratchetx.xyz**. You fire sealed YES/NO shots at the
market — "SOL higher in 10 minutes", "BTC ends the hour outside ±0.7%" — and the machine
settles them on real Pyth oracle prices read directly off Solana. Your pick is hidden
behind a cryptographic commitment until settlement, so nobody can copy you and nobody —
including us — can quietly change it.

The economy has one rule, printed on the fire button and frozen since before launch:
**70% of every stake is burned, 30% goes to player pots, 0% to the team.** The creator is
paid from pump.fun trading fees only. There is no faucet, no emissions, no treasury.
Nothing to rug — not as a promise, as a property: **no private key exists anywhere in the
system.**

## The week in numbers

All figures as of 25 August, all readable from public endpoints:

- **1,000,000,000 → 937,587,566 RCX.** 62.4M destroyed (6.24% of launch supply):
  59.70M burned by pump.fun's bonding curve at graduation, **2.71M verifiably burned by
  players** — every one attributed to a signed transaction, replay-gated, counted
  separately so we only take credit for ours.
- **Seventy releases in seven days.** h1 shipped on launch morning; h70 shipped tonight.
  Three full audits of our own system are published in the repo along the way.
- **1,707 entries** in the hash-chained event log — every seal, settlement, payout and
  rule change, each hash depending on everything before it.
- **The first weekly season pot paid out 1,650,962 credits** to the top five, on
  schedule, by code, with the result written to the log.
- A **96%+ oracle sampling duty cycle**, self-reported even when it makes us look bad.

## Settlement you can re-derive

Most "oracle games" read a price API at settlement time and ask you to trust the moment
they picked. We did that for about a day and then killed it, because an expired bet that
settles "whenever someone asks" is not a resolved bet — it's a free option.

The live rule is **pyth-first-observed-after-v3**: a shot settles on the first fully
validated Pyth price transition our capture stream observed with `publish_time >= expiry`.
Not the price we liked; the first one that exists. Ties void. Missing evidence voids.
Voids refund the stake and reverse the burn/pot allocation. Every settlement carries its
oracle evidence — publish time, previous publish time, confidence band — and the raw
minute-by-minute price record is a public endpoint, so you can re-derive any outcome
yourself.

Prices come from **Pyth's sponsored push feeds read straight off Solana accounts** —
the same `PriceUpdateV2` structs any program on mainnet validates, decoded by us locally,
owner-checked, freshness-checked, confidence-checked. No API key between the game and its
oracle. When Pyth's Core upgrade put Hermes behind authentication in mid-August, our
primary route didn't notice, because reading a Solana account is not something anyone can
put behind a paywall.

## The machine audits its own oracle

Because real stakes settle on those feeds, we can't look away when one misbehaves — so we
publish what we see. **The Observatory** (`/api/feeds`) is a continuous third-party
measurement of Pyth's sponsored feeds on Solana, taken by a consumer with skin in the
game: observed heartbeats (median 53–62s per feed over the last day, p95 73–105s, worst
gap 2.5 minutes on ETH), publisher confidence bands (medians ~1–8 bps), divergence
against an unrelated venue (1–7 bps vs Coinbase spot), and our own sampling duty —
96.32% in the last 24h, printed even though every missed minute is our failure, not
Pyth's. When feed timing costs players, we say so: 23 bets voided and refunded this week
rather than settled on evidence we didn't have.

Nobody else publishes third-party numbers on sponsored feed behavior. We had to become
the reference we wanted to cite.

## Money that moves peer-to-peer, or not at all

The **Champion's Cut** is the part we're proudest of mechanically. When a player reloads
(swaps SOL for RCX and burns to play), the 30% pot share isn't sent to us to redistribute
— **the reloader's own signed transaction pays the current daily podium directly**,
50/30/20, wallet to wallet. The server's role is verification after the fact: it reads
the transaction from the chain and refuses credit unless every token either verifiably
left circulation or landed on the published podium. Value flows player → supply and
player → players. There is no custodial hop where it could stick.

One transaction, built with Jupiter's swap API, does all of it: swap, burn, podium
payout. Sign once.

## The record is the product

Every shot ever sealed is in **The Record** (`/api/record`) — an open, public-domain,
CORS-open dataset of predictions committed *before* the outcome, backed by a stake, and
settled by a deterministic oracle rule. 23 fields per row, schema versioned additively,
no key, no signup. If you're building or benchmarking forecasting agents, this is a
neutral, tamper-evident accuracy record that mostly doesn't exist elsewhere.

The event log's head can be **anchored to Solana by anyone** — a memo transaction from
your own wallet notarizes the entire history up to that point (and pays 25 XP for the
trouble). Daily balance roots go into the log too, so any future on-chain migration can
prove imported balances match a fingerprint that existed before the migration was
announced.

And because honesty means the checks can fail: our proof page currently shows **two
permanent red lines** for a single missing log entry (#345) from an early storage race.
We could have quietly rebuilt the chain. Instead the gap is disclosed on every load,
forever. A checklist that can only be green is decoration.

## The house plays in public

**The Warden** — the house AI — posts a probability every hour and gets scored like
everyone else: 58 hits on 90 settled calls so far, Brier-tracked, small sample and
labeled as such. Its first version quoted hardcoded constants dressed as analysis; when
we caught it, we didn't delete the record — we **retired it publicly** (6 of 32, roughly
coin-flip odds of being that bad) and reset the scoreboard *as a logged event*, so the
zeroing itself is tamper-evident. The replacement prices its line off realized volatility
measured from our own oracle samples, and declines to post rather than invent a number.

Four house agents — MOMENTUM, REVERSION, VOLATILITY, CONTRARIAN — each fire one real
call an hour on the same board players see: currently 59%, 55%, 42% and 60% accuracy.
The 42% stays on the page. They exist to be beaten, and an open **Arena** lets anyone
register their own agent and build an oracle-settled public record through the same API.

## On-chain, precisely stated

A non-custodial Anchor program — **Ratchet Seal v2**,
`23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX` — is live on mainnet-beta. It validates
the same Pyth accounts, enforces the same first-crossing rule with a strict settlement
deadline, and lets a player seal a shot's commitment on-chain *before expiry*, so the
commitment provably predates the outcome. The deployed binary is **byte-identical to the
repository artifact** (SHA-256 published), built with a pinned Anchor toolchain in CI.
It holds no player funds.

And here is the part most projects would blur: **the canonical referee is still our
server.** The program is an optional receipt path in a soak period, its upgrade authority
is still active, and the site says all of this in plain text — settlement authority,
oracle input, and on-chain status are labeled on every API response. "Fully on-chain" is
a claim you earn with proofs, not adjectives. The v3 design (independent checkpoint PDAs;
permissionless crankers) is written up in the repo and goes to devnet first.

The same discipline runs the treasury story: the "floor" shown in the game is **labeled
a simulation** until a real, audited vault exists. We'd rather show you an honest model
than an implied promise.

## The week's hardest lesson

Mid-week we ran a full adversarial audit on ourselves. It found something ugly: after the
Champion's Cut shipped, the burn verifier's strict matching had one shape where a player
could destroy real RCX — a plain manual burn to the incinerator — and be refused credit.
Tokens gone, nothing paid. It also hid a second bug: a one-token rounding error could
fabricate a phantom podium seat and refuse *any* new player's reload.

We fixed both the same day, shipped them as **h69** with 21 new test assertions pinning
the exact failure shapes, verified the fix live on both domains, and wrote the whole
thing down — in the repo, in the release manifest, and now here. The manual-burn promise
("send RCX to the incinerator, paste the signature, get credits") is back to being true.

That's the actual product. Not that we don't write bugs — that the system is built so
bugs get caught, published, and killed in daylight.

## Built on, and grateful for

Solana mainnet · pump.fun + PumpSwap (launch, graduation, liquidity) · **Token-2022**
(mint and freeze authorities revoked — read from the chain on our proof page, not
asserted) · **Pyth** sponsored push oracles · **Jupiter** swap API · **Anchor** +
Solana Playground (program built and deployed without a private key ever touching our
code) · Solana Actions/Blinks (one-click log anchoring from any wallet) · Vercel
serverless (no framework, no build step — the whole backend reads in a sitting) ·
Supabase Postgres (durable state with fully atomic money-path operations) · Cloudflare
Workers (the oracle capture stream) · Metaplex Core (a soulbound player-passport
experiment, measured on devnet: the Token-2022 baseline cost 134,625 CU across nine
transactions — raw numbers in the repo before any claims).

## What this means for pump.fun tokens

Most pump.fun launches die at graduation because there is nothing on the other side —
the token IS the product, and the only lever left is the team's word. RCX is an
experiment in the opposite shape:

**Utility from block one.** The game was live before the token; the token's website field
pointed at a working product at TGE. **Burn-to-play instead of pay-the-team**: entry
costs destroy supply inside the player's own transaction — no hot wallet, no custody,
no regulatory gray zone of "we hold your funds". **Creator revenue = trading fees,
period** — the split is frozen and machine-enforced, so the incentive is volume and
longevity, not extraction. **Players pay players**: the podium cut moves wallet-to-wallet
with the machine unable to touch it. And **every claim is a public endpoint** — supply
from the mint account, burns by signature, settlements with oracle evidence, a proof
page that goes red when something is wrong.

None of this needs permission. The repo is public. The pattern — real utility, frozen
splits, verifiable burns, refereed by an oracle you can check — is replicable by any
launch that would rather be checkable than believed.

## Week two

Prove the capture architecture unattended. Take Seal v3's checkpoint-PDA settlement to
devnet. Finish the Metaplex Core passport benchmark and publish the raw comparison. Keep
the economics frozen. Keep the reds on the proof page until they're actually fixed.

The machine cannot lie. We intend to keep it that way.

---

**Play:** ratchetx.xyz · **Code:** github.com/3esign/ratchetx · **Token:** $RCX on
pump.fun (`FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump`) · **Dataset:**
ratchetx.xyz/api/record · **Observatory:** ratchetx.xyz/api/feeds

*Every number in this article is as of 2026-08-25 and readable from the endpoints above.*
