# Why the storage quota blew, in arithmetic

**2026-09-05, Opus Lead. Evidence tier: host** — measured by reading the shipped
`index.html` and `api/game.js`, not by watching traffic.

`ratchetx.xyz/api/game?action=state` returns
`{"ok":false,"reason":"kv 400: ERR max requests limit exceeded. Limit: 500000, Usage: 500000"}`.
The site is down. It was not traffic.

## One open tab costs five API calls a minute, forever

`index.html` starts four repeating timers at load:

| timer | period | fetches? |
|---|---|---|
| `loadChals` | 30 s | yes |
| `loadArena` | 60 s | yes |
| `loadProof` | 30 s | yes |
| `tryPB` | 6 s | **no** — local, and correctly so |
| a 1 s tick | 1 s | no — it only re-renders "RE-CHECKED Xs AGO" |

So a tab nobody is looking at issues **5 API calls per minute**: 2 + 1 + 2.
That is **7,200 a day**, and each one costs several storage requests — the `state`
branch alone awaits five reads before it answers.

**At a conservative 3 storage requests per API call, one open tab is ~21,600 requests a
day.** A 500,000 allowance is therefore about **23 tab-days**. One tab left open for
three weeks, or five tabs for four days, exhausts it with nobody playing.

Nothing counts requests, so the first sign is the site returning 400.

## And the retry doubled the burn at exactly the wrong moment

`lib/kv.js` `redis()` retries once by default. Every failing call costs **two** requests.
When the failure is *"you are out of requests"*, the retry spends one more of the thing
you have run out of.

Worse, the only quota string it recognised was `daily request limit`. The message that
actually fired is `ERR max requests limit exceeded` — a different plan limit, different
wording — so it fell through to the generic branch **and was retried**.

**Fixed:** any `request limit`, `quota` or `max requests` error is now a quota error, is
flagged `quotaExhausted`, and is never retried. Genuine transients still retry once —
turning off all retries would trade one bug for another, and the test counts attempts in
both cases rather than only asserting that an error propagates.

## What actually fixes the site, cheapest first

1. **Stop polling a hidden tab.** `document.visibilityState !== 'visible'` → skip the
   timer body. Free, and it removes most of the cost, because most open tabs are not
   being looked at.
2. **Slow `loadProof`.** It re-fetches a proof every 30 s; the payload observed today was
   26 hours old. A 5-minute period is still ten times fresher than the data.
3. **Count the requests.** A counter and a printed headroom number turn "the site is
   down" into "we are at 60 % with nine days left". Nothing today could have said that.
4. **Collapse the `state` reads.** Five awaited reads per answer, several of which are the
   same podium record.

None of these costs money, which is the constraint: the answer to an exhausted quota is
fewer requests, not a bigger plan.
