# THE ARCADE — one kernel, many games

## The idea underneath your idea

You asked for "a dozen mini games all based on this principle." The useful reframe is that RATCHET
already **is** a kernel, and a game mode is not a new game — it is a new *shape of claim* run through
the same machinery:

```
seal (commit hash, before the outcome)
  → stake (credits at risk, 70/30 to burn/pot)
    → settle (first oracle publish at or after expiry — deterministic, unarguable)
      → credits + XP + ladder + a row in THE RECORD
```

Everything below reuses that whole pipeline. None of it needs a new money path, a new oracle, a new
settlement rule, or a new trust assumption. That is the entire reason a dozen modes is realistic
rather than a rewrite: the hard part is already built and already tested.

Five shapes exist today: `dir` (higher/lower), `thr` (crosses up), `thrDown` (crosses down),
`range` (moves at least X%), `race` (feed A beats feed B).

## The rule that keeps a dozen modes safe

Credits are play-rights, not tokens, but they are still a supply. Today: a hit pays **1.7×**, so
break-even accuracy is **58.8%**, and every stake sends 70% to the burn counter and 30% to the pots.

**Any new mode must have an expected credit return per credit staked no higher than 1.7 × P(win),
and must route its stake through the same 70/30 split.**

Follow that and the economy is unchanged no matter how many modes exist — a mode can add variance,
drama, and identity, but it can never add inflation. Every design below states its payout in those
terms. This is the constraint I would not bend for any amount of fun.

---

## The modes, ranked by (fun × low risk) / build cost

### 1. THE GAUNTLET — a parlay *(recommended first)*
Seal N calls at once. All must hit. Payout `1.7^N`, which is exactly the same edge as playing them
sequentially with full reinvestment — so it is provably not a giveaway.

| N | P(win) at 50% | payout | feels like |
|---|---|---|---|
| 3 | 12.5% | 4.9× | a good night |
| 5 | 3.1% | 14.2× | a story |
| 7 | 0.8% | 41.0× | a screenshot people send each other |

- **Reuses:** everything. `settle()` runs unchanged per leg; the parlay resolves when the last leg does.
- **New:** a `parlay` record grouping shot ids; payout only when every leg is `hit`; any `void` leg
  shrinks N rather than killing the ticket (the honest treatment — a void is not a loss).
- **Why first:** highest drama per line of code, zero new economics, and it makes the *existing*
  chambers more interesting instead of competing with them.

### 2. SURVIVOR — the streak run
Pay an entry, then keep calling. One miss ends the run. Your streak length is the score; a daily pot
splits among the longest runs.

- **Reuses:** `p.streak` already exists and already drives `streakMult`.
- **New:** a run object with its own entry fee and a per-day leaderboard.
- **Why:** it converts "I'll take one shot" into a session. This is the retention mode.

### 3. THE DUEL — your "fighting game"
Already 80% built as the challenge board. What is missing is *presentation*: rounds, a health bar
that drains as the price moves against you, a winner announced with an animation.

- **Reuses:** `challenges` / `accept` end to end. Stakes already match, the level is already struck at
  acceptance rather than at authoring.
- **New:** UI only, plus best-of-3 as a wrapper over three sequential challenges.
- **Why:** the cheapest big win on the list. The mechanic is live and untouched; it just does not
  currently *look* like a fight.

### 4. THE RACE — your "racing game"
Also already built (`race` kind), also invisible. Two feeds, one window, whoever moves further wins.

- **New:** a live track view — two runners advancing along a lane in real time, driven by the price
  paths we already stream for sparklines. Photo-finish when they are within `EPS`.
- **Why:** it is the most watchable thing the oracle can produce and we are currently drawing it as
  a line chart.

### 5. SNIPER — precision instead of binary
Do not call a direction; call a *price*. Score by how close you land. Payout scales continuously,
capped so that a perfect hit pays no more than 1.7× at the same expected value.

- **Why it matters more than it sounds:** it rewards calibration rather than luck, which is exactly
  what the arena's Brier scoring is about, and it produces far richer rows in THE RECORD — a
  distribution of estimates rather than a coin flip.

### 6. BLIND DRAW — the fast one
The board deals you a random target; you only choose a side, in ten seconds, at a fixed small stake.

- **Why:** the entire funnel problem in one mode. A stranger can play before deciding to care.

### 7. RELAY — teams
Four players, four legs, one chained ticket. Each leg only starts when the previous one settles.

- **Why:** the only mode here that makes people bring a friend. Also the only one that needs a group
  abstraction, which is why it is not first.

### 8. THE LONG CALL — the slow one
One call, 30 days, big XP, tiny stake, published on a public page from the moment it is sealed.

- **Why:** the highest-status mode. A sealed 30-day call that comes in is the single most shareable
  artifact this game can produce, and it costs almost nothing to build.

---

## What this does for THE RECORD

This is the part worth being explicit about. Every mode above produces the *same row shape* in the
open dataset — sealed, staked, oracle-settled — but across **different horizons, different claim
types, and different confidence structures**. A corpus with binary calls, precision estimates,
head-to-head duels and 30-day commitments in it is a substantially more valuable research object than
one with 2-minute coin flips alone.

So the arcade is not a distraction from the dataset. It is how the dataset gets its range.

## Build order I would actually follow

1. **THE GAUNTLET** — new mechanic, zero new economics, best drama-per-line.
2. **THE RACE and THE DUEL as presentation** — both mechanics already ship; they just need to look
   like what they are.
3. **SURVIVOR** — the retention mode, once there is enough traffic for a daily run leaderboard to
   have a field.
4. **SNIPER** — the one that makes the dataset genuinely novel.
5. Everything else, in whatever order the players ask for.
