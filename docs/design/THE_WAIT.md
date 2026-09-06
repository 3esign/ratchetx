# The twenty minutes, and what the page does with them

**Design decision, lead, 2026-09-06.** OpusB measured it: a player waits about
twenty minutes after their target before a result exists. Three hundred seconds
of game, then eleven hundred and ninety-nine seconds of evidence window.

`MINIGAME_SIXTY.md` shortens the clock for a new ruleset. This is the other half,
and it is needed anyway: **the 300-second game will always have this wait, and
the answer is not a better spinner.**

---

## 1. Why a spinner is the wrong instrument

A spinner says *something is happening and you cannot see it*. That is exactly
false here. Something is happening and it is **the most interesting thing in the
entire product**: the oracle is publishing prices, an observer is choosing the
admissible one, and the chain is refusing everything that arrives outside the
window.

A spinner over that is not a neutral placeholder. It throws away the one span of
time when the player would actually watch the machine work.

## 2. The wait is the demo

The design already has the instrument: **the time axis.** During the wait, the
axis is not decoration behind a result — it is the live view, and it fills in.

```
SEALED ─────┬─────────────── ENTRY ──────────────┬───────── EXIT ────── REVEAL BY
            │                  ▓▓▓ admissible    │            ░░░
         you here            ● 142.3106       waiting      (not yet)
                               00:05:02
                               captured 2s after the target
```

Four things arrive, in order, and each one is a small event with a timestamp:

1. **the entry window opens** — the bar starts filling
2. **a print lands inside it** — a dot appears on the axis with its confidence
   band, and the page says how many seconds after the target it arrived
3. **the same for the exit**
4. **settlement** — the line between the two prices draws itself and the sentence
   appears

Nothing is faked and nothing is animated for its own sake. Every one of those is
a real account changing on chain, and the page is reading it.

## 3. What it says while nothing is arriving

Between events the page states the fact, not a feeling:

> Waiting for a price at or after 00:10:00. Any print published in the next
> **4:58** counts; the first one wins. If none arrives, the shot is returned.

That sentence does four things a spinner cannot. It says what is being waited
for, when it stops mattering, which print will be chosen — and it names the
outcome if none comes, so a void is never a surprise. **A player who reads it
once understands MIN-CAPTURE without the words MIN-CAPTURE.**

## 4. The countdown is to the deadline, never to a guess

Show the time remaining in the **capture window**, which is a fact:
`target + lag + grace`, derived from the spec.

Never show an estimate of when the price will arrive. We do not know, the oracle
does not promise, and a countdown that runs out while nothing happens teaches the
player that our numbers are decorative. **A deadline is honest; an estimate is a
promise we did not make.**

## 5. The player may leave

Stated plainly on the page, once: settlement is permissionless and does not need
the browser open. Close the tab, come back, the result is there.

Half of what makes a twenty-minute wait feel bad is not knowing whether leaving
breaks it. **It does not, and saying so is free.**

## 6. What this rules out

- No spinner, anywhere in the settlement path.
- No progress bar that fills at a rate we invented.
- No "estimated time to result".
- No cheerful copy about patience. State the mechanism; the mechanism is
  genuinely interesting and the player is not a child.
- No polling. Reads are on visibility and on the deadlines the spec already
  gives, which are known in advance — the page knows exactly when something can
  next happen, so it does not need to ask repeatedly.

## 7. Why this is worth building before Sixty

Sixty makes the wait four minutes. Four minutes of blank screen is still a bad
product, and the same view fixes both. **Build the view, then shorten the clock;
the view is what makes the short clock feel fast rather than just brief.**
