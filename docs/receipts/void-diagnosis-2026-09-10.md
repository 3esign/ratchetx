# Why one game voided, measured rather than guessed

Recorded 2026-09-10, after a devnet game (player `6T66H7Wu…`, nonce 4) voided on
its entry target instead of being played.

## What I assumed, and why it was wrong

My first guess in chat was a tight capture window: the keeper waits for the
capture deadline, the oracle lag is short, the public RPC is slow, so the window
is missed. Every part of that turned out to be false, and the measurements are
what said so.

The registered EvidenceSpec is `targetGridSeconds: 300`,
`maxPostTargetLagSeconds: 299`, `captureGraceSeconds: 900`. So a capture is
admissible for any Pyth print with `publishTime` inside a **five-minute** window
after the target, and the Need stays capturable for 1 199 seconds. Pyth publishes
about once a second - the accepted candidates all show `publishTime - prevPublishTime = 1`.
So roughly three hundred admissible prints existed for that target.

Accepted captures across the last four games, as `publishTime` relative to target:

| Target | publishTime | capture landed |
|---|---|---|
| 07:00:00 | +191s | +293s |
| 07:05:00 | +205s | +238s |
| 08:30:00 | +61s | +71s |
| 08:35:00 | +75s | +90s |
| 12:30:00 | +10s | +20s |
| **12:25:00** | **none** | **none — `Expire` at +1203s** |

Nothing was tight. The window was five minutes wide with a print a second in it,
and the keepers took none of them.

## What actually happened

The two keepers captured the 12:30:00 target at **+20 seconds** - the fastest of
any game here - and captured the 12:25:00 target not at all. A keeper that is
awake at 12:30:20 and idle from 12:25:00 to 12:29:59 was not slow. It was blind.

`keeper.err` says what it was blind from, once, every ten seconds:

```
failed to get info for accounts SysvarC1ock…,7AviUf9nL…: Minimum context slot has not been reached
```

`readLiveState` discovers Shots with `getProgramAccounts`, takes that response's
context slot, and requires at least that slot from the follow-up
`getMultipleAccountsInfoAndContext`. That requirement is CORRECT and is not the
bug: Shots read at slot N and Needs read at slot N-50 are not one picture of the
chain, and a keeper that mixes them can act on a state that never existed.

The bug is what happens next. A public endpoint is many nodes behind one address,
so the second call routinely lands on a node a few slots behind the first, and
that node answers "Minimum context slot has not been reached" - which means *not
yet*, not *no*. `withReadRetries` retried 429s, dropped connections and timeouts,
and did not recognise this one. So the read threw, the watch loop caught it,
logged, slept ten seconds and asked again with the same slot. For five minutes it
kept landing on nodes that were behind, and a capturable target expired
underneath it.

## The fix

Add it to the retryable set, in both copies of `withReadRetries`
(`ops/g2-crank/public-evidence.mjs` and `tools/g2-devnet-play.mjs`), so the
backoff absorbs a lagging node the way it already absorbs a throttled one. The
consistency requirement is untouched.

Covered by a test in `test_devnet_play.mjs` that fails twice with this exact
message and expects the third call to succeed - because a rule that only shows up
against a live cluster is a rule with no test, and this one hid behind a live
cluster for as long as it existed.

## What this does not fix

Backoff caps at six attempts and 30 seconds, roughly a minute of patience. An
endpoint that lags for longer than that will still lose a target, and the honest
answer there is a second RPC provider rather than a longer sleep. Both keepers
still watch the same public endpoint, which makes their redundancy weaker than it
looks: they are two machines, but one point of failure.
