# The site, design direction

`SITE_V2_SPEC.md` says what must be on the screen and where every field comes
from. This says what it should look like and, more usefully, **why** — so that
the next person to add a screen can make it fit without asking.

Owner's brief: at least twice as detailed, careful transaction views and links,
elegant, *ozbiljna neozbiljna zabava*. And, as of 2026-09-06: **we go out on
devnet, openly, without shame.**

---

## 1. What the thing actually is

Before any colour: the subject of this site is **two moments in time and two
prices**. Everything a player does is choosing a direction between them, and
everything the chain records is evidence about them.

That has a direct design consequence, and it is the single most important idea
here: **the natural spine of a shot is a time axis, not a table.** A table is
what you reach for when you have fields; an axis is what you draw when you have a
story. The shot has a story — sealed here, entry here, exit here, revealed here —
and the fields hang off it.

The old page showed a server's opinion as a row of numbers. The new one draws the
line and puts the evidence on it.

## 2. Keep the palette. It was never the problem.

```
--bg    #08090b   near-black, slightly warm
--card  #111319   --card2 #171a20
--gold  #d8ac52   --goldD #85692f
--ink   #f4f1ea   --ink2 #a8a7a2   --dim #6f716f
--ice   #8eb9c8   --red #df6b67    --grn #63bb8a
```

This is brass on dark machine, and it is right for a thing called RatchetX. The
accents are already **desaturated** — that is what keeps it from looking like a
casino, and nobody should "brighten" them. Red and green are muted on purpose: in
this game a loss is not a disaster and a win is not a jackpot, and the colours
should not shout either.

What the palette is missing is **one working distinction**, and adding it is the
main colour decision of this redesign:

- **gold** = the game's own language — targets, credits, the ratchet
- **ice** = *the chain said this* — every value that came from an account, every
  hash, every signature, every explorer link
- **dim** = *we are telling you this* — our labels, our helper text, our sentences

A player who learns that one rule can read the whole site: **anything in ice can
be checked without trusting us.** That is worth more than any amount of ornament,
and it costs one variable used consistently.

## 3. Four depths, and every screen has them

Detail becomes noise the moment it arrives all at once. So every result is built
in four layers, each one gesture from the last:

1. **The sentence.** One plain line, no jargon, no hash. "You said UP on SOL
   between 14:05:00 and 14:10:00. It went from 142.31 to 142.88. You were right."
2. **The shape.** The time axis: sealed, entry, exit, reveal deadline, with the
   two prices and their confidence bands drawn to scale.
3. **The fields.** Everything in `SITE_V2_SPEC` §1, grouped as the seal, the two
   windows, the two prices, the call, the outcome, the seals.
4. **The bytes.** The raw account, hex, copyable, with the command that re-reads
   it from the chain.

Depth 1 is the default. A player who never opens depth 2 still had a complete
experience; a stranger who wants to verify can reach depth 4 in three clicks
without us. **Nothing in the deeper layers is a reward for expertise — it is the
same truth at higher resolution.**

## 4. Serious unserious fun, made concrete

The phrase is not a mood board. It resolves into rules:

**The seriousness is precision.** Numbers are monospace, aligned on the decimal,
never rounded silently. A confidence band is drawn, not described. A hash is
shown in full on hover and truncated in the middle — `a8f3fb4d…c446094d` — never
at the end, because the tail is what people compare.

**The unseriousness is pace and warmth.** The arcade vocabulary already in the
page is good and stays: *chambers*, *kill feed*, *shots fired*. Transitions are
short. Nothing pulses, spins, or celebrates. **The one animation this site is
allowed to be proud of is the price arriving on the axis** — because that is the
moment the game actually happens.

**The line between them:** the game may be playful about *itself* and must never
be playful about *evidence*. No confetti on a win. No sad face on a void. A void
gets the same typographic weight as a hit, because the chain treated them the
same way.

## 5. Devnet, in the open

He said it without shame, so it is designed without apology.

**Not** a yellow warning bar. Not a modal. Not the word "testnet" in small grey
type at the bottom.

A **stamp**: a small ice-coloured mark in the header reading `DEVNET`, in the
same family as the version and the program id, sitting where a serious instrument
would print its calibration. Clicking it opens one paragraph: what devnet is,
that the tokens are test tokens with no value, that the game and the proofs are
identical to what will run on mainnet, and the two program ids with links.

Every explorer link carries `?cluster=devnet` — and per `SITE_V2_SPEC` §4 that
suffix comes from the genesis-hash check, never a build-time constant, because
the day this moves the links must move with it or they become false claims about
real money.

**The tone is a laboratory, not a disclaimer.** People trust a thing that says
exactly what it is.

## 6. Typography and rhythm

Two families, already present, kept:

- a humanist sans for prose — sentences, labels, explanations
- a monospace for anything the chain produced — numbers, hashes, ids, timestamps

**The rule that does the work: never mix them inside one value.** A price is
entirely monospace including its unit. A sentence is entirely sans, and where it
must name a hash, the hash is a monospace chip inside it rather than the sentence
changing font mid-word.

Vertical rhythm on an 8px grid. Cards get one internal padding value, not three.
The current page has inline styles carrying six different paddings; that is the
main reason it reads as busy rather than dense — **density is fine, inconsistency
is not.**

## 7. What to delete

A redesign that only adds is not a redesign.

- The projection numbers labelled "VAULT NOT DEPLOYED". Either the vault exists
  or the number does not appear. A projected floor price beside real settled
  results teaches the reader that our numbers might be aspirational, which
  poisons the ones that are not.
- Every element whose value comes from the legacy server once the page reads G2,
  unless it is in a clearly separate block with its own heading.
- Polling. Not a design note but a design consequence: five calls a minute per
  tab is what took the site down, and a page reading the chain does not need it.

## 8. The one screen that decides whether this works

**The shot view.** If it is beautiful and complete, the site is good even if the
rest is plain. If it is a table of hashes, nothing else will save it.

Build it first, alone, at full quality. Everything else on the site is a route to
it or a list of them.
