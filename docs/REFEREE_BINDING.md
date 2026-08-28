# The referee, declared per chamber and frozen at seal

Draft spec, 2026-08-28. Addendum to `EPOCH_CHAMBERS.md`. Not built.

## The last single point of failure

Everything else in the v3 design survives us. Questions are a function of the clock, so nobody
can withhold one. Settlement is a public predicate over public data. Scores accumulate in the
program. The client can be hosted by anyone.

And all of it stops the day Pyth stops.

That is not a hypothetical: Pythnet's sunset is already the first entry on this project's own
risk list. And the milder version of the same event has already happened to us
twice without anyone calling it a failure: `lib/onchain_px.js` accepts **four** Pyth program
identities as valid owners of a price account — receiver v1, push oracle v1, receiver v2,
price feed v2 — because accounts posted under each are still out there and still readable.

The frozen program pins exactly one of the four. That is the whole argument in one fact: the
referee we depend on has changed its own program identity at least twice inside the lifetime of
accounts we read, and Seal v2 will be unable to follow it a third time. A machine that dies when one company turns something off is not autonomous. It is
decentralised until the first outage, which is a different and much smaller claim.

## What this does not propose

**Not "add a second oracle."** Two referees on one question means either disagreement with no
tiebreaker, or a tiebreaker that is itself an authority. And it destroys the property that
makes this board mean anything: one referee applied identically to everyone, so that two
players' scores can be compared at all. Reading a second oracle would also double the liveness
dependency — both would have to be checkpointed for a chamber to settle, making the machine
*more* fragile in exchange for feeling more robust.

**Not a registry an admin can extend.** A referee table that someone can add to is a key, and a
key is the thing this whole design exists to remove.

## The rule

A chamber's identity includes its referee:

```
chamber = (referee, feed, duration, epoch)
```

`referee` indexes a table **compiled into the program and frozen with it**. Each entry is the
complete recipe for turning a moment in time into a number:

```
oracle program id          which program owns the account
account derivation         how to find the account for a feed, from its id
admissibility              staleness bound, confidence bound, verification level
crossing predicate         which sample counts as "the price at t"
```

For Pyth that is exactly what v2 already hardcodes. This change does not invent new
machinery; it gives the machinery a name, a number, and a place in the chamber's identity.

**A shot records the referee of the chamber it entered, and is settled by that one — always.**
Not by the newest, not by the best, not by whichever is alive. If a later program version
knows more referees, sealed shots do not care. Nobody's rules change under them after they
have committed.

## What each failure now looks like

**A referee stops publishing.** Chambers already open under it void on the existing deadline —
no crossing checkpointed inside the window, so nothing settles, exactly as the rule already
says. No special case, no new code path, and no shot is left in limbo. New chambers are opened
under a different referee. The machine keeps running with a gap in one instrument's history
rather than an ending.

**A referee starts lying.** It can only corrupt the chambers that named it. Every other
chamber, past and future, is untouched — which is the property a single global oracle
dependency cannot offer at any price.

**A referee is added.** Only by deploying a new program version, under its own registered
freeze ceremony. Changing who settles your shots is precisely the kind of change that should
cost a redeploy and a public date, not a config write.

## The consequence nobody should be spared

Referees live in frozen code, so **the set is finite from the day the program freezes, and the
machine's useful life is bounded by the lifetimes of the oracles in that table.** That is a
real limit and it should be printed on the box rather than engineered around with an escape
hatch that is really an admin key wearing a costume.

The honest framing: this does not make the machine immortal. It makes it **survive the death
of any one referee**, and it makes the dependency legible in every single chamber instead of
buried in a document nobody reads. A frozen program with three referees in its table is
mortal in a way anyone can read off the chain and plan around. A frozen program with one is
mortal in a way that arrives as a surprise.

## Calibration has to follow

A score aggregated across chambers with different referees is a score that mixes measuring
instruments, and averaging across instruments is how a number stops meaning anything.

So the calibration account from `CALIBRATION_ONCHAIN.md` is seeded with the referee too:

```
seeds = ["calib", player, referee_id]
```

One record per player per referee. It fragments reputation, and that is the cost. The
alternative — one number quietly averaged over two instruments that were never calibrated
against each other — is worse, because it looks like more information while being less.

In practice there will be one referee for a long time and this changes nothing visible. It is
cheap to decide now and impossible to fix afterwards, which is the whole reason to decide it
now.

**And a successor inherits the dimension.** A v4 program, deployed under its own id after this
one is frozen, can read every `Calibration` account v3 wrote — ownership gates writes, not
reads, and the layout is published as protocol (`SUCCESSION.md`). What it must not do is add
them up. A record seeded `["calib", player, referee_id]` carries its instrument in its own
address, so flattening two referees into one lifetime score is not a rounding decision, it is
the same error one layer up: a number that looks like more information while being less. A
reader that combines them says which ones it combined, or it is not a reader worth trusting.

## What stays exactly as it is

- `EPOCH_CHAMBERS.md`: the schedule, the entry price as `crossing(opens_at)`, sealing one
  epoch ahead. The referee is added to the chamber's identity; nothing about its timing moves.
- `CROWD_BELIEF.md`: aggregates are per chamber, so they were always per referee. The only
  change is that the referee becomes a field a reader can see rather than an assumption.
- v2 and the freeze on 2026-09-08. Untouched, as with every other v3 document.

## Open

- **How many entries ship in v1 of the table.** One is honest and fragile; three is honest and
  sturdier; ten is a maintenance claim we cannot keep, because every entry is a settlement rule
  we are promising to have got exactly right, forever, with no way to fix it.
- **Whether `feed` should be part of the referee entry or stay separate.** Keeping them
  separate lets one referee cover many feeds, which is how Pyth actually works. Folding them
  together would be simpler to reason about and much larger to store. Undecided.
- **Whether a chamber with no shots should be able to name a referee at all.** It costs nothing
  either way, since no chamber account is created — but the id has to be well defined before
  the first seal, and that ordering deserves a second look when this is written in Rust.
