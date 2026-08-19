# The Machine That Cannot Lie: How RATCHET Turns Radical Transparency Into a Game

*Why we built a degen game with no treasury, no admin keys, and a proof page that would rat us out before we could.*

---

Every token launch says "trust us." The whitepaper promises a burn. The team promises a lockup. The Discord promises utility "soon." And every degen has learned, at some personal expense, what those promises are worth: exactly nothing, because a promise is a thing a person can break, and the person is the part of the system you can't verify.

RATCHET is our attempt to build the opposite object — a game where there is nothing to promise because there is nothing we *could* break. Not "we won't rug." **There is no mechanism by which a rug could occur, and the site checks that claim against the chain every thirty seconds, in public, and will say so in red the moment it stops being true.**

That's the pitch. Here's the machine.

## The game in one breath

Feed the Machine. Fire sealed shots. Beat the Warden. Climb the ranks.

You pick a market call — SOL higher in five minutes, BTC higher in an hour, ETH higher in a day — choose a stake, and fire. Your shot is **sealed**: nobody, not other players, not the Warden, not us, can see your side until the window closes. When it does, the shot settles against **real oracle prices** — the same Pyth feeds Solana's biggest exchanges settle on — and lands as a HIT or a MISS, with XP, in public, on a weekly ladder.

XP comes from being right, not from spending. There is no way to grind rank with volume; accuracy is the only currency the ladder accepts. Ranks run COG → PISTON → FLYWHEEL → TURBINE → REACTOR, and higher ranks unlock more simultaneous chambers — more open shots at once — never better odds. The game respects one thing and it's the same thing the market respects: being right when it counted.

## The Warden

Every player needs an opponent, and ours is an AI with a public criminal record.

The Warden posts a line — a price, a window, and its own probability — and you go WITH it or AGAINST it. Going with it is safe and pays modestly. Going against it and being right is the hardest thing in the game, and pays like it. Every call the Warden has ever made is scored where everyone can see it, wins and losses alike, because an oracle that only shows you its wins is just a horoscope with a UI.

Today the Warden is a stated, deterministic heuristic — we tell you exactly what it is on the page. The LLM brain lands in a later wave. Its record accrues from day one either way, because the sealing and settlement machinery doesn't care how smart the thing being scored is. That's the point of the machinery.

## Sealed until settled

Commit-reveal isn't a new idea. Making it the entire aesthetic of a product is.

Because every action is sealed until it's scored, three chronic diseases of on-chain games are structurally impossible here rather than policed: you cannot be front-run, because there is nothing visible to front-run. You cannot be copy-traded, because there is nothing visible to copy. And the game can never rot into a shill board, because by the time anyone can read a call, it already carries its result. Conviction without a receipt simply does not exist on this site.

## The economics, in one sentence each

Every stake is split by a rule printed on the fire button itself: **70% burned, 30% to the weekly season pot, 0% to the team.**

The season pot pays out **automatically** — the first request after Sunday midnight UTC settles the week, pays the top five on a published curve, and rolls unclaimed shares into the next pot. No button, no operator, no delay.

The team is paid one way only: **the creator fee share on trading volume**, the standard pump.fun mechanism, flowing to a published wallet. We never touch player funds because there is no path in the code by which we could.

And there is no faucet. Nothing mints. Rewards are credits and free play, never emitted tokens — because every play-to-earn economy that printed its rewards died the same death, and we read the autopsies.

## The infrastructure, because "trustless" is an engineering claim

This is the part most launches keep vague. We'd rather show the receipts.

The entire backend is **zero-dependency serverless JavaScript on Vercel** — no framework, no npm packages, small enough to read in one sitting. Prices come from **Pyth** with a Coinbase fallback, both keyless public APIs, and the same source prices a shot at seal and at settle. Chain reads ride a dedicated **Helius** RPC lane with the public RPC as automatic fallback. State lives in **Upstash Redis**.

Settlement is **lazy**: expired shots settle whenever anyone touches the API. There is no cron job, no daemon, no scheduled task — nothing that a human could forget to run, because the graveyard of dead projects is full of machines that needed someone to keep showing up.

Burns are **keyless by construction**. To reload, you send RATCHET from your own wallet to Solana's incinerator address — a plain transfer any wallet can make — and paste the transaction signature. The server reads the chain and credits you only if the transaction succeeded, is recent, your balance fell, the tokens verifiably left circulation, and that signature was never used before. At no point does a private key exist on our side. There is no treasury wallet, no multisig, no custody. The most common rug in history is impossible here for the dullest possible reason: **the wallet that would do the rugging was never created.**

## The log, and the strangers who notarize it

Every seal, every settlement, every reload, every season payout is appended to a **hash-chained event log**. Change any past event and every hash after it breaks — the standard trick, and a good one.

But a hash chain kept by us still requires trusting us about *when* things happened. So we made the timestamping permissionless: **anyone can anchor the log's current head into a Solana memo transaction from their own wallet.** The server verifies the memo matches the real chain of hashes and pays the scribe +25 XP. From that slot forward, Solana itself — not us — timestamps our entire history. The integrity of our books is a game mechanic with a leaderboard, which we think might be the most honest sentence ever written about bookkeeping.

## The proof page, which is the actual product

Everything above is summarized on one page that re-verifies itself against the chain every thirty seconds while you watch: mint authority revoked — read from the mint account, not asserted. Freeze authority revoked. Supply only falls, checked against the first supply ever observed — and if it ever grew, the page goes red and says so before we could spin it. The incinerator's live balance. Recent burns with their signatures. Every green line links to the account or transaction that proves it.

A checklist that can only ever be green is decoration. Every line here is a live query that can genuinely fail. That is the difference between transparency as marketing and transparency as architecture, and it is the entire reason this project exists.

## What we are not claiming

Honesty is the aesthetic, so: the Machine's floor — the number at the center of the game — is **simulated until the vault program ships**, and the page says so in so many words. The real thing, a redemption floor backed by SOL in a program with no withdraw instruction and a revoked upgrade authority, is the endgame — and it ships only after an audit, because an immutable program's bugs are immutable too. We will not rush the one component where a mistake is forever. Until then, the floor is a scoreboard, clearly labeled, and the game stands on its own without it.

The Warden is a heuristic today, an LLM later. Paper credits refill daily so the game is free to try forever; burns buy ranked play. And nothing here is financial advice — it's a game about being right, and most people aren't.

## The road forward

Wave by wave: the Warden gets its LLM brain and starts sealing its answers on-chain, making its record tamper-proof as well as public. The season economy deepens — streaks with burnable freezes, contracts, named challenges. And the vault lands last, audited, converting the floor from a scoreboard into a redeemable claim that no one — including us — can ever lower.

The order is deliberate. Everything that could be shipped without custody shipped first. The one piece that touches real value ships when it has earned the right to be permanent.

## Why we think this matters

The market has spent years learning to discount promises to zero, which is rational. The only thing left worth building is systems whose good behavior is a *property* rather than a pledge — where the interesting question isn't "do you trust the team?" but "did you read the IDL?"

RATCHET is a small, sharp test of that thesis, wearing a game as its clothes: sealed shots, a boss with receipts, a ladder that only pays accuracy, a log notarized by strangers for XP, and a proof page that would betray us in thirty seconds flat.

The floor only goes up. Everything else is sealed until it's over. Come fire a shot — the first ones are free, and the Machine is hungry.

**Play: ratchetx.vercel.app**

---

*RATCHET pays its creators from trading fees only. Player stakes are split 70% burn / 30% season pot / 0% team, enforced in code and printed on the button. This article describes mechanics, not investment advice.*
