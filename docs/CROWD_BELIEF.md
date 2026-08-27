# The aggregate — a probability with no market behind it

Draft spec, 2026-08-27. Not built. Third and last of the v3 design set, after
`EPOCH_CHAMBERS.md` and `CALIBRATION_ONCHAIN.md`. It does not work without both.

## What is being claimed

A prediction market produces a number by making people trade against each other. The number
is good because losing money hurts, and it requires capital, an order book, and somebody to
list the question.

This produces the same kind of number a different way: many people state a probability,
before the fact, sealed, and are permanently scored on how well those probabilities track
reality. The aggregate is weighted by that score. No capital, no book, no listing, no
resolver.

The claim is not that this is better than a liquid market. A liquid market on a deep
question will beat it. The claim is that it works **where a market cannot exist** — on
questions too small, too fast, or too numerous to attract capital, which is most questions.
Five-minute chambers on four feeds generate hundreds of questions a day, and no order book
will ever form on any of them.

## The timing, which is the whole trick

Commit-reveal is usually a way to stop cheating. Here it does something else: it makes it
safe to publish everyone's belief **before the answer exists**.

```
epoch N, first half     SEAL      commitments only; nothing is visible to anyone
epoch N, second half    REVEAL    side and p_bps opened; the aggregate is derivable and grows
epoch N+1 opens         ENTRY     crossing(opens_at) fixes the reference
epoch N+1 closes        SETTLE    crossing(closes_at); hits and Brier scored
```

Reveal finishes **before the chamber it describes has even opened**. So at the moment the
aggregate is published, its subject has no reference price yet, and nobody who revealed knew
anything a later revealer did not.

Two consequences worth being explicit about, because they are the reasons this is not a toy:

- **Nobody can free-ride the aggregate.** In a market, a late trader reads the price and
  copies it. Here a late revealer has already committed; reading everyone else's answer
  changes nothing they can do. The published crowd number cannot contaminate the crowd that
  produced it — which is a property an order book structurally cannot have.
- **Nobody can cherry-pick which of their forecasts get scored.** If reveal happened during
  the live chamber, a player could watch the price and reveal only the shots that were going
  well, and the whole calibration record would be worthless. Revealing before the entry price
  exists removes the information that would make cherry-picking possible.

Seals that are never revealed are therefore just failures, not strategy. They are still
counted: the calibration account records `sealed` alongside `n`, and a wallet whose revealed
count trails its sealed count is visible to anyone. No penalty is computed for it — the
number is published and the reader draws their own conclusion, which is the same treatment
every other uncomfortable fact in this system gets.

## The aggregate is not stored. It is derived.

Nothing writes an aggregate to the chain. There is no aggregator account, no privileged
publisher, and nothing to trust or corrupt. The number is a pure function of state that is
already on-chain — the revealed shots of a chamber, and the calibration account of each
player who cast one.

Each revealed shot yields a probability for YES:

```
q_i = p_i           if side_i == YES
q_i = 10_000 − p_i  if side_i == NO
```

Weights come from the reader's own read of each player's calibration:

```
eligible:  n_i >= 30  and  index_i > 50
w_i     =  index_i − 50                       // 0..50, linear, capped by construction
crowd   =  Σ w_i · q_i  /  Σ w_i              // the weighted answer
naive   =  Σ q_i / count                       // always published beside it
```

`index` is `(1 − sqrt(brier)) · 100` computed from the integer sums the calibration account
already carries, so no new state is introduced anywhere by this document.

**The naive mean is published next to the weighted one, always.** If the weighting ever
stops beating the simple average, that is the single most important fact about this system
and it should be impossible to hide. Publishing only the flattering number is how every
scoring scheme in this industry has died.

The formula is frozen in the program's constants and its documentation rather than left to
whoever renders it. Two implementations reading the same chain must produce the same number
to the last basis point, or one of them is wrong and can be shown to be wrong.

## Sybil, stated plainly

Weighting by calibration is resistant to sybil attack **only up to the cost of earning a
calibration**, and that cost is real but finite.

A fake identity carries weight only after 30 scored shots with a genuinely better-than-coin-flip
record. Splitting one good forecaster into ten wallets does gain influence, because per-wallet
weight is capped — so the cap trades influence-concentration against sybil-resistance, and
there is no setting that gets both.

The honest position: this is not sybil-proof, it is sybil-*expensive*, and the price is
paid in being right repeatedly rather than in capital. That is a better trade than an order
book offers, and it is not the same thing as a solved problem. Anyone building on this number
should read the participant count and the weight distribution, both of which are on-chain,
before deciding how much to lean on it.

## What can actually be sold

The aggregate is public state. It cannot be paywalled, and pretending otherwise would be the
first dishonest thing in this design.

What is scarce is **asking**. The standard chamber set is fixed in the program — a handful of
feeds and durations, existing for everyone forever, free. A question outside that set is
someone's specific interest, and getting the arena to answer it is a service: an x402 toll
that funds nothing but the asking, paid to the players who answer rather than to us, the same
shape the champion toll already has.

Reading the answer stays free, permanently, for the same reason the proof page is free.

## What has to be true for any of this to matter

- Enough revealed shots per chamber that an aggregate means anything. Below roughly a dozen,
  publish the count and let the number speak for itself rather than dressing it up.
- Calibration accounts with enough history to weight by, which is the slowest part and cannot
  be shortcut. The board is honest and empty before it is honest and useful.
- Epoch chambers, so that every shot in a chamber is an answer to the same question. Without
  that, aggregating is averaging different questions and the result means nothing.

## Order

This is third. `EPOCH_CHAMBERS.md` is first because nothing else is well-defined without it,
`CALIBRATION_ONCHAIN.md` second because the weights come from it, and this last because it is
only arithmetic once those two exist. All three are v3, under a new program id, with their own
ceremony. v2 freezes on 2026-09-08 exactly as registered and is untouched by any of it.
