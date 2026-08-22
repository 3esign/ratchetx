# The Machine That Cannot Lie: RATCHET, One Day In

*Why we built a degen game with no treasury, no admin keys, real token rewards that pay
peer-to-peer, and a proof page that would rat us out before we could.*

**Play: [ratchetx.xyz](https://ratchetx.xyz) · $RCX on
[pump.fun](https://pump.fun/coin/FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump) ·
CA `FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump` ·
[read the code](https://github.com/3esign/ratchetx)**

---

Every token launch says "trust us." The whitepaper promises a burn. The team promises a lockup.
The Discord promises utility "soon." And every degen has learned, at some personal expense, what
those promises are worth: exactly nothing, because a promise is a thing a person can break, and
the person is the part of the system you can't verify.

RATCHET is the opposite object — a game where there is nothing to promise because there is
nothing we *could* break. Not "we won't rug." **There is no mechanism by which a rug could
occur, and the site checks that claim against the chain every thirty seconds, in public, and
will say so in red the moment it stops being true.**

That was the pitch on day zero. Here's the machine after one day of being real — launched,
graduated to PumpSwap, played by strangers, and upgraded seven times in public, with every
change in the changelog.

## The game in one breath

Fire sealed shots at real markets. Beat the Warden. Climb the ranks. Get paid for being right.

THE BOARD deals a fresh mix of questions every hour — deterministically from the clock, so
every player sees the same board. Evergreen anchors (SOL in 5 minutes, BTC in an hour, PUMP in
30, ETH in a day) plus rotating specials: THE PUMP and THE DUMP, thresholds sized to each
market's real volatility; THE RACE, two assets head-to-head; THE BOX, does the hour end outside
the band. Every question settles on **Pyth oracle prices** — SOL, BTC, ETH, PUMP, BONK, WIF,
JUP — markets so deep no player can move them. That last part is a design law: we launched with
shots on RCX's own price and **removed them the same day**, because a thin market you can trade
is a bet you can settle yourself. The board only asks questions nobody can rig.

XP comes from being right, never from spending. Ranks run COG → PISTON → FLYWHEEL → TURBINE →
REACTOR and unlock more simultaneous chambers — never better odds. There is one currency:
credits. A new wallet is granted 5,000 once; after that, credits come only from reloads, pot
wins and staking — so every shot on the ladder cost someone something.

## Sealed now means cryptographically sealed

On day one, "sealed" was a database column. By the evening it was cryptography — because while
mapping our on-chain roadmap we audited our own core promise and found it soft: an open shot's
side was technically readable through the public log before settlement. Nobody had noticed. We
found it, fixed it, and disclosed it in the changelog the same hour.

New seals write `sha256("RATCHET|v2|wallet|shotId|side|salt")` into the hash-chained log.
Settlement reveals side and salt, so anyone can verify the commitment. Public APIs and snapshots
cannot expose an open side; the server necessarily retains reveal terms until settlement. This
prevents spectator copying and post-hoc answer changes, but it is not zero-knowledge from the
operator, and the article should not pretend otherwise.

## Real rewards, and still no key anywhere

The economy runs one frozen rule at both doors: **70 / 30 / 0.**

Every *stake* feeds the Machine: 70% to the burn counter, 30% to the pots — a daily pot paying
the top 3 (50/30/20) at midnight UTC and a weekly season pot paying the top 5, automatically,
no claim button, unclaimed shares rolling over.

Every *reload* — real RCX burned for ranked credits — splits the same way: **70% burns forever,
30% is paid straight to the daily podium's wallets**, inside the reloader's own signed
transaction. There is no prize pool, no custody, no claim button, because the money never sits
anywhere: it moves player-to-champion in the same block, and the server's only job is to refuse
any reload whose transfers go anywhere but the incinerator or the published podium.

The podium is dynamic: today's settled-XP top three control the 50/30/20 shares immediately.
At the UTC reset, previous-day winners fill empty positions until today's #1, #2 and #3 replace
yesterday's #3, #2 and #1. There is no continuing hold or sell condition. The **Gearbox** is a
separate no-deposit credit feature: register with one signature, keep custody, and the Machine
reads the verified balance without moving tokens.

The team is paid exactly one way: the standard pump.fun creator fee on trading volume, to a
published wallet. 0% of stakes. 0% of reloads. Printed on the buttons, frozen.

## The machine cannot be killed — only paused

The token was born unkillable: mint authority revoked, freeze authority revoked, liquidity
protocol-held on PumpSwap since graduation. Read it from the chain; every proof-page line links
the account that proves it.

The state joined it on day one. Every game event lives in a **hash-chained log, retained in
full**, and any player can anchor the current head into a Solana memo from their own wallet
(+25 XP — our bookkeeping's integrity is a game mechanic with a leaderboard). The entire
machine — every player, every credit, every burn signature, the complete log — exports at
`/api/snapshot`, and the repo ships `restore.mjs` plus a `RESURRECTION.md`: any stranger can
verify a snapshot against the anchored hashes and resurrect the whole game on their own hosting
in fifteen minutes, provably intact. Once a day the log also swallows a **balance root** — a
fingerprint of every player's holdings — so the chain itself notarizes who owned what, in
advance, forever.

Kill our server and you have paused RATCHET. You cannot end it.

## The Warden's first public call was wrong, and that's the point

The Warden — the house AI — posts an hourly line with its own stated probability. You go WITH
it (safe, modest XP) or AGAINST it (×3.4 if you're right). Every call it makes is sealed before
the outcome and settled on the same oracle as everything else, wins and losses alike.

Its first-ever settled call was a miss. It said 36%; the market crossed anyway. That miss sits
on the page with a Brier score attached, because an oracle that only shows you its wins is a
horoscope with a UI. The Warden is a stated heuristic today; a bigger brain lands in a later
wave — and the scoring machinery won't care how smart it gets.

## The infrastructure, because "trustless" is an engineering claim

The whole backend is **zero-dependency serverless JavaScript** — no framework, no packages,
small enough to read in one sitting, and public: the live API returns a build marker
(`h14-2026-08-20` as of this writing) that must match the constant declared in the repo, so you
can verify the code you're reading is the code that's running. Prices come from **Pyth** with a
keyless fallback; the token is **Token-2022** on **Solana**; the market lives on **pump.fun /
PumpSwap**; settlement is lazy — no cron, no daemon, nothing a human could forget to run. And
the on-chain migration is no longer a plan: commit-reveal sealing is live in the game, and the
Anchor settlement program behind it — `ratchet_seal`, holding no funds and answering to no
admin — is **deployed on Solana devnet and has run a full lifecycle in public**. A shot was
sealed as nothing but a hash, settled by a permissionless crank against a Pyth price the
program validated itself, and revealed and scored on-chain — where it recorded that the author
of the program had guessed wrong. Every step has a transaction you can open (`ONCHAIN.md`).
The endgame — an audited vault where a share of the game's own flow becomes SOL vesting to
players, held by a program instead of anyone's wallet — ships only after review, because an
immutable bug is forever and we will not rush the one component where a mistake is permanent.

## What we are not claiming

The settlement program exists on **mainnet**, but its deployed legacy rules are research evidence,
not the live referee or a vault; mirroring stays disabled until reviewed v2 rules are deployed.
The Machine floor is a non-redeemable model until a separately audited and funded vault exists.
The Warden is a labeled heuristic. Early log rows keep their historical commitment version.
Play-credits have disclosed faucets — welcome grant, hit returns, reloads, pots and Gearbox — and
none of them mints RCX. Nothing here is financial advice; it is a game about being right.

## Why we think this matters

The market has spent years learning to discount promises to zero, which is rational. The only
thing left worth building is systems whose good behavior is a *property* rather than a pledge.
RATCHET is a small, sharp test of that thesis wearing a game as its clothes: sealed shots a
cryptographer can check, champions paid inside other players' transactions, a log notarized by
strangers for XP, a machine any of its players could resurrect, and a proof page that would
betray us in thirty seconds flat.

The floor only goes up. Everything else is sealed until it's over. Come fire a shot — the first
ones are free, and the Machine is hungry.

**Play: [ratchetx.xyz](https://ratchetx.xyz)**
**CA: `FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump`**

---

*RATCHET pays its creators from trading fees only. Stakes and reloads split 70% burn / 30% to
players / 0% team, enforced in code and printed on the buttons. This article describes
mechanics, not investment advice.*
