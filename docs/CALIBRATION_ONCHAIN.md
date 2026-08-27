# On-chain calibration — the one number nobody can grant you

Draft spec, 2026-08-27. Not built. Written first, as usual.

## What this is for

Every prediction venue publishes a number about its users. Polymarket and Kalshi publish
profit. Newer venues publish tiers and points. All of those measure how much you played,
or how much you risked, and all of them can be bought.

Calibration cannot. It asks a different question: **when you said 75%, were you right about
three times in four?** You cannot buy that, you cannot vote it, and you cannot claim it.
You have to have said the number *before* the outcome existed, on a record nobody can edit
afterwards — which is exactly what a sealed commit-reveal shot settled by an oracle already
produces. The game manufactures the raw material for a reputation primitive as a side
effect of being a game.

Today that score is computed off our own server and shown on our own site. Anyone who wants
to use it has to trust us. This spec moves it on-chain, where nobody has to.

## The decision that shapes everything: no attestor

`onchain/player-passport` already exists and takes the opposite approach: an `attestor`
signs a checkpoint carrying a Merkle `state_root`, and the chain records what the attestor
said. That is the right design for achievements, which are things a game *awards*.

It is the wrong design here, and adopting it would destroy the point. A calibration score
signed by us is a self-reported score with extra steps. The whole claim is that no one
grants it.

So the accumulator lives in the **seal** lineage, not the passport. The seal program is the
only party that can increment a score without being trusted, because it does not take
anyone's word for anything: it read the Pyth price itself, it verified the commitment
hash itself, and it computed the hit itself. It is not attesting to a result. It *is* the
result.

The passport keeps the things that genuinely need attestation. Calibration is the one
number that needs none, and it should be visibly different in kind.

> **Naming collision to settle first.** `onchain/ratchet-seal-v3` currently holds a PvP
> match program (`create_match` / `join_match` / `settle_match`) that takes a `wager` and
> therefore holds funds. That is a different product from the seal successor, and it should
> not inherit the "seal v3" name. It also deserves its own look before anything ships:
> the site's standing claim is that no key can touch player funds, and a wager escrow is
> the first thing here that would hold any.

## The change to the sealed commitment

v2 seals a side and a salt:

```
RATCHET|v2|<wallet>|<shot_id>|<YES-or-NO>|<32-lower-hex-salt>
```

A Brier score needs the *confidence*, and it needs it sealed — a probability supplied after
the fact is worth nothing. So v3 seals it:

```
RATCHET|v3|<wallet>|<shot_id>|<YES-or-NO>|<p_bps>|<32-lower-hex-salt>
```

`p_bps` is the player's stated probability that **their own chosen side** is correct, in
basis points, `1..=9999`. `reveal` takes `side`, `p_bps` and `salt`, rebuilds the hash, and
refuses on any mismatch exactly as v2 does. A confidence that does not reproduce the
commitment is not a confidence.

The game's chip row (55/65/75/85/95) is a UI convention, not a protocol rule. The program
accepts any value in range, because `p = 5000` on every shot is a legitimate strategy that
scores exactly 50 — the "always say fifty" baseline, self-describing, and worth letting
people demonstrate.

## What actually gets scored, and why it is not gameable

**Only `kind == 0` shots increment the accumulator.**

A direction shot is measured against the oracle's own print at seal time. The player does
not choose the reference, so the question is structurally close to a coin flip and cannot
be selected for easiness. Threshold shots (`kind 1` / `kind 2`) let the player pick the
strike, and "will BTC be above $1 in five minutes" is a 99% question anyone can farm. Those
stay sealable — they are useful receipts — but they score nothing.

That single restriction is what separates this from every reputation scheme that failed.
It costs one comparison.

**The residual, stated rather than hidden:** a very short horizon approaches a coin flip
and a long one does not, so horizon is part of what a score means. The accumulator stores
the horizon sum so a reader can see the average rather than assume it.

## State

One PDA per player, seeds `["calib", player]`, written only by `reveal`.

```rust
#[account]
pub struct Calibration {
    pub player: Pubkey,
    pub n: u64,               // scored shots (kind 0, revealed)
    pub sum_sq_err: u64,      // Σ (p_bps − hit·10_000)²   — each term ≤ 1e8
    pub sum_p_bps: u64,       // Σ p_bps                    — mean stated confidence
    pub hits: u64,            // base rate
    pub sum_horizon_s: u64,   // Σ (expiry_ts − sealed_ts)
    pub bin_n:    [u32; 10],  // reliability curve, bucketed by p_bps / 1000
    pub bin_hits: [u32; 10],
    pub bump: u8,
}
```

Everything is an integer sum. No floats, no division, no square roots on-chain — a program
that cannot overflow is worth more than one that formats nicely. Readers derive:

```
brier      = sum_sq_err / (n * 1e8)
index      = (1 − sqrt(brier)) * 100        # FRI scale: 100 clairvoyant, 50 = "always 50%"
sharpness  = sum_p_bps / n
base rate  = hits / n
curve      = bin_hits[i] / bin_n[i]
```

`sum_sq_err` overflows u64 after roughly 1.8 × 10¹¹ shots, which is not a number this game
will produce.

Storing the ten bins on-chain costs 80 bytes and buys the thing that makes a calibration
score legible instead of oracular: two players with the same index and different curves are
wrong in different ways, and the curve is what shows it. It is also the full Murphy
decomposition — reliability, resolution, uncertainty — recoverable by anyone, from the
chain, without us.

## Reveal, in full

1. verify `state == Settled` and the commitment (v3 preimage, including `p_bps`)
2. score `hit` exactly as v2 does
3. if `kind == 0`, open the `Calibration` PDA `init_if_needed` and add:
   `n += 1`, `sum_sq_err += (p_bps − hit·10_000)²`, `sum_p_bps += p_bps`,
   `hits += hit`, `sum_horizon_s += expiry_ts − sealed_ts`,
   `bin_n[p_bps/1000] += 1`, `bin_hits[p_bps/1000] += hit`
4. emit `Revealed` with `p_bps` added

`reveal` stays permissionless. Anyone may reveal a settled shot; the credit lands on
`shot.player`, never on the revealer. A stranger who reveals your shot does you a favour
and gains nothing, which is the same shape as `close_shot`.

## How another program uses it

`Calibration` is an ordinary account. Any Solana program can read it with a standard
deserialize and gate on it — a lending market weighting a liquidation oracle, a DAO
weighting a vote, an agent marketplace pricing a subscription by the seller's track record.
The read costs nothing and needs no permission from us, which is the property that makes
this infrastructure rather than a leaderboard.

Ship alongside: a `ratchet-calibration` crate with the account layout and the derivation
helpers, so integrating is copy-paste rather than archaeology.

## What this score does not mean

It is scoped to direction shots on the feeds this program settles, over the horizons the
player chose. It is not a general forecasting rating and must never be sold as one. Someone
calibrated on five-minute SOL is not thereby calibrated on elections, and the account
carries the horizon sum precisely so that nobody can pretend otherwise.

## Order of work

1. Settle the naming collision, and look hard at the wager escrow before it ships.
2. v3 program: commitment with `p_bps`, `Calibration` PDA, `kind 0` gate. Devnet.
3. Devnet exercise, the same two-shot drill v2 got — every instruction run once, signatures recorded.
4. The reader crate and one worked integration example.
5. Mainnet only after the same registered-freeze discipline v2 got, under its own key.

None of it touches v2. v2 freezes on September 8 as promised, and stays exactly what it is.
