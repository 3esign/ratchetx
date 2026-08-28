# Chambers as a function of the clock

Draft spec, 2026-08-27. Not built.

## The last thing the server decides

Settlement is already checkable: the oracle prints a price, the program reads it, anyone can
re-run the arithmetic. Reveal is checkable. Closure is permissionless. What is *not*
checkable is the question itself — the server decides which chamber exists, on which feed,
expiring when. A player has to take the offered question on trust, and there is no way to
prove a question was not chosen badly, because there is nothing to check it against.

That is the last discretionary act in the system, and it is removable. A chamber does not
have to be *offered*. It can simply **exist**, as a consequence of what time it is.

## The rule

Every chamber is `(feed, duration, epoch)`, where

```
epoch        = floor(unix_seconds / duration)
opens_at     = epoch * duration
closes_at    = opens_at + duration
```

For every supported feed and every supported duration, every epoch exists. Always, for
everyone, without anybody publishing it. There is no listing, no schedule, no calendar, and
nothing to withhold — the chamber for SOL, five minutes, epoch 5 956 271 is as real as
arithmetic, whether or not our site is up.

Deriving the chamber id costs one division. Nothing is stored, and no account is created for
a chamber: a shot records `(feed, duration, epoch)` and settlement recovers both boundaries
from them.

## The entry price stops depending on when you clicked

This is the part that matters more than the schedule.

v2 reads `entry_e12` at seal time. Two players sealing the same direction shot eleven seconds
apart are answering **different questions**, against different references, and neither can
compare their result to the other. It is fair — nobody chose it — but it is not *the same
question*, and everything interesting downstream needs it to be.

Under epoch chambers, the reference is not read at seal time at all:

```
entry = FeedClock.crossing(opens_at)      // the first verified print at or after the open
exit  = FeedClock.crossing(closes_at)     // the same rule, one boundary later
```

The same crossing rule that settles a chamber opens the next one. The close of epoch N is the
open of epoch N+1. No new oracle machinery, no second read path, no "price when the button
was pressed" — `crossing()` already exists in v2 and already does exactly this.

Three things fall out of that one change:

- **Every player in a chamber answers the identical question**, so their results are
  comparable for the first time.
- **A crowd probability becomes meaningful.** The aggregate of sealed confidences in a
  chamber is a genuine prior over one well-defined event, not an average over a hundred
  slightly different events.
- **Calibration becomes comparable across players**, which is what the on-chain accumulator
  in `CALIBRATION_ONCHAIN.md` needs in order to mean anything beyond one wallet's history.

## Sealing happens one epoch ahead

You seal into epoch **N+1** while epoch N is running. Sealing closes the moment N+1 opens.

The alternative — sealing into the epoch you are already inside — leaks. Someone sealing at
second 290 of a 300-second chamber has watched almost the whole question resolve. The Brier
score would punish them for stating low confidence, so it is not *unscored*, but it is still
an asymmetry between two players in the same chamber, and this system does not ship
asymmetries it can remove.

One epoch ahead removes it completely. Everyone in a chamber sealed before its open price
existed. The wait is bounded by one duration, and with several durations running at once
(one minute, five, fifteen, an hour) there is always something opening soon.

**Consequence to accept:** you cannot play a chamber on impulse the second you arrive. That
is a real cost in feel, paid for the property that no two players in a chamber ever had
different information. It is the same trade the seal already makes by hiding your side until
reveal, and it should be stated in the UI rather than smoothed over.

## The amendment: the clock cannot hold a chamber open

Added 2026-08-28, after checking this spec against the deployed program instead of against
the idea of it. **As written above, this design cannot be built on v2's clock**, and the
reason is worth keeping because it is not obvious.

`FeedClock` is a ring buffer of `CLOCK_CAPACITY = 64` observations per feed, and `crossing(t)`
finds the one where `prev_publish_time < t <= publish_time`. That observation is only
findable while it is still one of the 64.

v2 never noticed, because v2 does not need history. `entry_e12` is computed at seal time and
**written into the Shot** (`lib.rs:72`), and the single `crossing()` call in the whole program
is `crossing(shot.expiry_ts)` at settlement (`lib.rs:169`) — one boundary, looked up while it
is still fresh. Sixty-four slots is enormous for that.

The rule above changes it: `entry = crossing(opens_at)` is resolved **at settlement**, so two
observations must survive simultaneously, exactly `duration` apart. The ring must therefore
span the entire chamber:

| duration | ring must span | max average checkpoint interval that still works |
|---|---|---|
| 60 s | 60 s | 0.94 s |
| 300 s | 300 s | 4.7 s |
| 900 s | 900 s | 14.1 s |
| 3600 s | 3600 s | 56.3 s |

Sponsored Pyth push feeds update far faster than 0.94 s, and `checkpoint` is permissionless,
so an ordinary attentive cranker keeps the ring roughly a minute deep. Every duration above
one minute breaks, and one minute is marginal.

Worse, it is cheap to do on purpose. Sixty-four fresh checkpoints — about 0.00032 SOL in
signatures — flush the ring and **void every open chamber on that feed at once**. Against v2
the identical spam achieves nothing, because each Shot already carries its own entry price.
Moving the entry price out of the Shot is what creates the vector.

### The fix is to filter what enters the ring, not to grow it

Growing `CLOCK_CAPACITY` buys a constant factor and leaves the attack intact. The real
mistake is that the ring advances with **cranker behaviour** when this entire design rests on
things advancing with **the clock**.

So: record an observation only when it straddles an epoch boundary of a supported duration.
A boundary already recorded is a duplicate and a no-op — exactly like `publish_time <=
latest_publish_time` is today — so spam cannot advance the ring at all. The ring stops being a
price feed and becomes what this spec actually needs, a list of chamber boundaries.

One clock per **(feed, duration)**, not one per feed. A shared clock over the union of all
durations advances every 60 s, giving 64 minutes of depth against a 3600 s chamber that needs
60 — true but with four minutes to spare, which is not a margin, it is a coincidence. Split by
duration and the depth is `64 x duration`:

| duration | depth | chamber needs |
|---|---|---|
| 60 s | 1.1 h | 0.02 h |
| 300 s | 5.3 h | 0.08 h |
| 900 s | 16.0 h | 0.25 h |
| 3600 s | 64.0 h | 1.00 h |

**Cost.** 7 feeds x 4 durations = 28 accounts at 0.01552080 SOL rent = **0.4346 SOL, once**,
for the whole system forever. They are created once and never per chamber, so the claim above
— that a chamber creates no account and an empty chamber leaves no trace — survives intact.
That was the property worth protecting, and it is still true.

**What this costs in honesty.** "No account is created" was slightly too clean even before
this. There was always one `FeedClock` per feed. The amendment makes it 28 instead of 7, and
the number is fixed by the program rather than by how many people play.

## What this does not change

- **v2 is untouched.** This is a v3 rule, under a new program id, with its own ceremony.
  The freeze on 2026-09-08 happens exactly as registered.
- **Credits, XP and the podium stay off-chain for now.** This spec moves the *question*, which
  is the part that carries trust. Moving the arcade is a different, much duller project.
- **Cranking stays permissionless and unpaid.** Checkpointing a boundary is already something
  anyone may do, and now it serves two chambers at once — the close of one and the open of
  the next — so the work per chamber halves.

## Why this is the piece that had to come first

The other two moves toward the frame — a client anyone can host, and a crank nobody has to
be trusted to run — are consequences. Neither one changes where the trust boundary sits;
they change who is standing on our side of it.

This one moves the boundary. After it, the only thing the server does that a player cannot
verify is bookkeeping about credits. The question, the reference, the settlement, the score
and the record are all facts about the chain and the clock.

## Open, and honestly open

- **Duration set.** Which durations exist is itself a choice, and a program that supports
  `{60, 300, 900, 3600}` has chosen four. The honest version is that the set is fixed in the
  program and frozen with it — a constant anyone can read, not a switch anybody can flip.
- **Empty chambers.** Most epochs will have no players. That is fine and still costs nothing:
  no *chamber* account is ever created, and a chamber with no shots leaves no trace. The fixed
  boundary clocks above exist whether or not anybody plays, which is the point of them.
- **Boundary checkpoints.** If nobody checkpoints a boundary inside the grace window, the
  chamber voids for everyone in it — the same rule v2 already applies to a missed crossing,
  applied to two boundaries instead of one. Voiding a whole chamber at once is more visible
  than voiding one shot, and that visibility is a feature: it makes the liveness dependency
  impossible to ignore.
- **The first epoch after deploy** has no preceding epoch to seal from. It is simply empty.
