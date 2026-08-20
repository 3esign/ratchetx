# The Machine That Cannot Lie: RATCHET, One Day In

*Why we built a degen game with no treasury, no admin keys, real token rewards that pay
peer-to-peer, and a proof page that would rat us out before we could.*

**Play: [ratchetx.vercel.app](https://ratchetx.vercel.app) · $RCX on
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

Now every seal writes `sha256(side|salt)` into the hash-chained log — a commitment, not a
secret in plaintext. Settlement reveals the side and salt, so **anyone can verify every seal
after the fact, and nobody — including us, including our own database exports — can read one
before.** You cannot be front-run, copy-traded, or spied on, and you don't have to take our
word for it: the math is the guarantee.

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

Two rules keep it honest. **The Holder Rule:** a champion must keep at least half of their last
seven days' winnings in their wallet, or the seat silently passes to the next player — nobody's
tokens are locked, but dumping has a published price: the income stops. And **the Gearbox:**
staking with no deposit — register with one signature, your tokens never move, and the Machine
pays daily play-credits on your verified on-chain balance. Every staking rug in history needed
your tokens in their contract; ours can't rug you because it never takes anything.

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
(`h13-2026-08-20` as of this writing) that must match the constant declared in the repo, so you
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

The devnet program is exactly that — **devnet**. It is research, not the live money path;
the game you play today still settles on our server, which is the entire reason the proof page
exists. The Machine's floor is **simulated and labeled so** until that audited vault exists. The Warden
is a v0 heuristic and says so on its own page. Log entries from before the cryptographic-sealing
upgrade contain what they contain — a hash chain cannot be rewritten, and we wouldn't want one
that could. Rewards are play-credits and real RCX to champions, never minted tokens: there is
no faucet, there will never be a faucet, and nothing here is financial advice — it's a game
about being right, and most people aren't.

## Why we think this matters

The market has spent years learning to discount promises to zero, which is rational. The only
thing left worth building is systems whose good behavior is a *property* rather than a pledge.
RATCHET is a small, sharp test of that thesis wearing a game as its clothes: sealed shots a
cryptographer can check, champions paid inside other players' transactions, a log notarized by
strangers for XP, a machine any of its players could resurrect, and a proof page that would
betray us in thirty seconds flat.

The floor only goes up. Everything else is sealed until it's over. Come fire a shot — the first
ones are free, and the Machine is hungry.

**Play: [ratchetx.vercel.app](https://ratchetx.vercel.app)**
**CA: `FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump`**

---

*RATCHET pays its creators from trading fees only. Stakes and reloads split 70% burn / 30% to
players / 0% team, enforced in code and printed on the buttons. This article describes
mechanics, not investment advice.*
