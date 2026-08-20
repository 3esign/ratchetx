# The Machine That Cannot Lie: a keyless prediction arcade on **Solana**, fair-launched on **pump.fun**

### RATCHET has no treasury, no admin key and no promises — only properties you can check. It settles on Pyth oracles, burns 70% of everything, pays its champions peer-to-peer inside other players' own transactions, and its on-chain settlement program has already judged its own author a loser. Here is everything it does, everything it is made of, and everything it proved in its first thirty-six hours.

**Play:** [ratchetx.vercel.app](https://ratchetx.vercel.app) · **Token:** $RCX on [pump.fun](https://pump.fun/coin/FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump)
**CA:** `FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump` (Token-2022) · **Code:** [github.com/3esign/ratchetx](https://github.com/3esign/ratchetx)
**Settlement program (devnet):** `4WQ4XTzC29M6YoxgNi9WHhYJWEtYyj6YNFtSB9yCM6E2`

---

## The thesis, in one paragraph

Every token launch says *trust us*. The whitepaper promises a burn, the team promises a lockup, the Discord promises utility soon. Degens have learned at their own expense what those are worth: nothing, because a promise is a thing a person can break, and the person is the part of the system you cannot verify.

RATCHET was built as the opposite object. Not *we won't rug* — **there is no mechanism by which a rug could occur, and the site re-checks that claim against the chain every thirty seconds, in public, and turns red the moment any part of it stops being true.** Everything below is a property, a transaction, or a line of code you can read. Where something is still a promise, it says so.

## What it is, in one breath

Fire sealed shots at real markets. Beat the Warden. Climb the ladder. Get paid for being right.

**THE BOARD** deals nine fresh questions every hour, generated deterministically from the clock so every player everywhere sees the same board with no coordination. Evergreen anchors — SOL in five minutes, PUMP in thirty, BTC in an hour, ETH in a day — plus rotating specials: **THE PUMP** and **THE DUMP**, thresholds sized to each market's real volatility; **THE RACE**, two assets head to head; **THE BOX**, does the hour close outside the band.

Every question settles on **Pyth oracle prices** — SOL, BTC, ETH, PUMP, BONK, WIF, JUP — markets deep enough that no player can move them. That is a design law, not a preference: RATCHET launched with shots on RCX's own price and **removed them the same day**, because a thin market you can trade is a bet you can settle yourself. The board only asks questions nobody can rig.

## How to play

1. **Open the site and connect a wallet.** Phantom, Solflare, anything standard. Connecting signs a message — it never asks for a transaction, and there is no private key in this system to give it to.
2. **Pick a question and a side.** Each card quotes the level it is asking about, priced off the same oracle that will settle it: `NOW $85.40 · CLEARS $85.95` for a pump, `BREAKS $68,691` for a dump, `BAND $2,403 – $2,434` for the box. Thresholds are struck from the price at *your* seal, so what you see is what you would get by sealing now.
3. **Choose a stake.** 100 (×1 XP), 500 (×2), or 2,500 (×5). Bigger stake, bigger burn, bigger XP.
4. **Fire.** Your side is hashed and sealed. The chamber shows a lock until the window closes.
5. **Settlement is lazy and automatic.** There is no cron job, no daemon, nothing a human could forget to run: the next request that touches your account settles anything that has expired, against the same oracle that priced the entry.

A new wallet is granted **5,000 credits, once**. After that credits come only from reloading, winning pots, or staking — so every shot on the ladder cost someone something real or something earned. Ranks run COG → PISTON → FLYWHEEL → TURBINE → REACTOR and unlock **more simultaneous chambers, never better odds.** XP comes from being right, never from spending.

## How you earn

Three mechanisms, all automatic, none of them requiring anyone to press a button or hold a key.

**1 · The pots.** 30% of every stake feeds two pots on two clocks. The **daily pot** pays the top three 50/30/20 at 00:00 UTC. The **weekly season pot** pays the top five 40/25/15/12/8 on Sunday. Unclaimed shares roll forward. The first daily rollover fired at **00:00:05 UTC on 20 August 2026** and paid 3,150 credits — 1,575 / 945 / 630 — to three wallets, unattended, five seconds after midnight. Nobody triggered it. Nobody could have stopped it.

**2 · The Champion's Cut — real tokens, no custody.** Every *reload* (burning RCX for credits, 1 for 1) splits by the same frozen rule: **70% burns forever, 30% is paid straight to the daily podium's wallets** (50/30/20) **inside the reloader's own signed transaction.** There is no prize pool, no treasury, no claim button, because the money never sits anywhere — it moves player-to-champion in the same block. The server's only job is to read that transaction from the chain and refuse it if a single token went to a wallet outside the published podium.

**3 · The Gearbox — staking with no deposit.** Register with one signature. **Your tokens never move.** The Machine reads your verified on-chain balance and pays 0.1% per day in credits (minimum 1,000 RCX, capped at 1,000,000, so at most 1,000 credits a day). Every staking rug in history required your tokens to be inside their contract. This one cannot rug you because it never takes anything. There is nothing to withdraw because there was never a deposit.

And the anti-dump rule that costs nobody their freedom: **the Holder Rule.** A champion must keep at least half of their last seven days' champion pay in their wallet, or the seat passes silently to the next player up. Nobody's tokens are locked. Dumping just has a published price: the income stops. Your champion console shows a live "safe to sell" number so the rule is never a surprise.

## The economy: 70 / 30 / 0, frozen at both doors

Every **stake**: 70% to the burn counter, 30% to the pots.
Every **reload**: 70% burned on-chain forever, 30% to the champions.
Every door: **0% to the team.**

The creator is paid exactly one way — the standard pump.fun creator fee on trading volume, to a published wallet. Zero percent of stakes. Zero percent of reloads. It is printed on the buttons and it is frozen.

## Sealed means cryptographically sealed

On day one, "sealed" was a database column. By that evening it was cryptography — because while mapping the on-chain roadmap we audited our own core promise and found it soft: an open shot's side was technically readable through the public log before settlement. Nobody had noticed. We found it, fixed it, and disclosed it in the changelog the same hour.

Now every seal writes `sha256("SIDE|salt")` into the hash-chained log — a commitment, not a plaintext secret. Settlement reveals the side and salt, so **anyone can verify every seal after the fact, and nobody — including us, including our own database exports — can read one before.** You cannot be front-run, copy-traded or spied on, and you don't have to take our word for it. The math is the guarantee.

## Nothing here can rug you

**The token was born unkillable.** Mint authority revoked. Freeze authority revoked. Liquidity protocol-held on PumpSwap since graduation. Read it from the chain — every proof-page line links the account that proves it.

RCX graduated on launch day. For context on what that means: pump.fun's graduation rate ran at **1.15% of launches** in 2026, and has historically sat between 0.5% and 2%. Roughly ninety-nine out of a hundred tokens never make it out of the bonding curve.

**The state joined it on day one.** Every game event lives in a hash-chained log, retained in full. Any player can anchor the current head into a Solana memo from their own wallet for +25 XP — our bookkeeping's integrity is a game mechanic with a leaderboard. The entire machine exports at `/api/snapshot`: every player, every credit, every burn signature, the complete log, with a sha256 over the canonical state. The repo ships `restore.mjs` and a `RESURRECTION.md` so any stranger can verify a snapshot against the anchored hashes and bring the whole game back on their own hosting in fifteen minutes, provably intact.

Once a day the log also swallows a **balance root** — a fingerprint of every player's holdings — so when state eventually migrates on-chain, the imported balances can be proven to match a fingerprint that existed long before the migration was announced. Airdrop fairness, solved years early.

**Kill our server and you have paused RATCHET. You cannot end it.**

**And you can check the code you're reading is the code that's running.** Both live endpoints return a build marker — `"v": "h9-2026-08-20"` — that must match the constant declared in the repo. If they ever disagree, the repo is stale and you should say so loudly.

## The Warden's first public call was wrong, and that's the point

The Warden is the house AI. It posts an hourly line with its own stated probability. Go **with** it for safe, modest XP, or **against** it for ×3.4 if you're right. Every call is sealed before the outcome and settled on the same oracle as everything else.

Its first-ever settled call was a miss: it said 36%, the market crossed anyway. That miss sits on the page with a Brier score of 0.4096 attached — exactly `(0.36 − 1)²` — because an oracle that only shows you its wins is a horoscope with a UI.

## The settlement layer is on-chain, and it has already run

RATCHET's on-chain migration is not a roadmap slide. **`ratchet_seal` is deployed on Solana devnet and has executed a complete lifecycle in public, with no server anywhere in the loop.**

| step | what happened | transaction |
|---|---|---|
| `seal` | stored only `sha256("YES\|salt")` + an entry price the program read from Pyth itself | [`5XCSMdr…MQ9i`](https://explorer.solana.com/tx/5XCSMdr3p6qB6m9zpypQ44t5mJkzFrbxA5gAw7vvoZuEbSs2xU4HCaPb6mSrVkonscDpAK1s5rqHRcdGfKTYMQ9i?cluster=devnet) |
| `settle` | a **permissionless crank** fixed the exit price after expiry | [`rYK5kjN…XbFH`](https://explorer.solana.com/tx/rYK5kjNeZ7SzKbkKb4LwJxnrpXKR2aHHr6iZe4ngtq1bFBoTNTB7Fy3Ta5u3U3CiCXCvgPMjeZVC2MeK9MEXbFH?cluster=devnet) |
| `reveal` | recomputed the hash, matched the commitment, scored the shot on-chain | [`4DF4iU4…XdJPg`](https://explorer.solana.com/tx/4DF4iU4hvyjiRv8MiJqxfpCjgGQN9GUWgQNxpm1b7w5ANHtfrjNUokn5BpMXMJYU5bXjgtovp58VcM4MoEfXdJPg?cluster=devnet) |

Result: **YES · $85.1593 → $85.0154 · HIT: no.** The price fell, the YES shot lost, and the program wrote a miss against the wallet that deployed it. Its first act was to judge its own author and find him wrong. That is the entire point of moving settlement onto a chain: a judge that does not know or care who you are.

Three details worth reading closely, because they are where the engineering actually lives:

**It validates the oracle by hand.** The program does not hand a price account to a library and hope. It checks the owner is the Pyth receiver or the Pyth push oracle, that the account discriminator is `sha256("account:PriceUpdateV2")[..8]`, and that the verification level is `Full`. A partially-verified or lookalike account is refused. Prices older than 60 seconds are refused at seal.

**Settlement is permissionless but bounded.** Anyone may crank a shot after expiry — the player need not be online — but only with a price published inside `[expiry, expiry+60]`. During the live run the program **refused to settle for a full minute**, because devnet's Pyth feed publishes in bursts every fifteen to twenty seconds and was running behind the chain clock. It would not accept a price stamped before expiry. Nobody was supervising it.

**It holds nothing.** No custody, no admin, no funds. Which is why the right gate before mainnet is public review rather than a five-figure audit — and why the vault that *will* hold funds is a different story entirely, and will not ship without one.

## Built entirely in a browser

Not a stylistic choice — a constraint that turned into a property. **No command line was used to build any of this. No private key was ever handled by any tool that wasn't the operator's own wallet.**

The program was written, compiled and deployed from **Solana Playground** in a browser tab, signed by a wallet extension. The repo is updated through GitHub's web UI. The site deploys to Vercel. The settlement program's entire source is 288 lines of Rust with **zero external crates** — the Pyth account structures are inlined and validated by hand rather than trusted to a dependency.

The first deploy attempt died mid-upload against a congested public RPC and stranded roughly 1.9 SOL in a loader buffer. Rather than abandon it, we wrote a client script that found the buffer by walking the wallet's own transaction history and closed it back — then redeployed through a private RPC in twenty-six seconds. Every step of that is reproducible: `onchain/smoketest_client.ts` in the repo runs the full seal → settle → reveal cycle from Playground's client tab against your own wallet and prints every signature it makes.

## The stack, and why each piece

- **Solana** — settlement in seconds at fees where a permissionless crank is economically sane. A "anyone can settle this" design is only real if calling it costs a fraction of a cent.
- **pump.fun / PumpSwap** — fair launch with no presale, no team allocation, no private round. Graduation moved liquidity into a protocol-held PumpSwap pool. The creator fee is the team's only revenue, and it is public.
- **Token-2022** — the modern SPL standard, with mint and freeze authority revoked and readable as revoked by anyone.
- **Pyth** — first-party oracle prices, used identically at seal and at settle, via Hermes off-chain and the on-chain receiver in the program. Sponsored price-update accounts are derived deterministically, so the account being read is verifiable rather than configured.
- **Zero-dependency serverless JavaScript** on Vercel with Upstash Redis — no framework, no packages, no build step, small enough to read in one sitting. A backend nobody can audit is a backend nobody has audited.
- **Anchor / Rust** for the settlement program, deployed via Solana Playground.

## Where this sits on Solana

Solana is having its prediction-market moment — 2026 brought fully on-chain prediction markets to the chain, and the category is finally being built natively rather than bolted on. RATCHET is a smaller, sharper object, and deliberately a different one.

It is not a market: there is no order book, no counterparty, no liquidity to bootstrap, and nothing to be adversely selected by. It is an **arcade** — you against a published rule, scored by an oracle, with the house holding nothing. That means it works at any size, on day one, with three players or three thousand.

And unlike most "web3 games", which are ordinary games with a token stapled on, the parts that would normally be a company's private database — the seal, the settlement, the score — are the parts being moved on-chain first. The cosmetic layer can stay a web page forever. The judge cannot.

## What's next

Gated, not dated. Nothing here ships because a roadmap said so; it ships when it can be verified.

- **Mirror live game seals on-chain** — the commitments the game already writes are byte-identical to the ones the program accepts, so this is a plumbing job, not a redesign.
- **Tighten v1 settlement** — today the cranker chooses which Pyth update inside the window to submit. Bounded, but real. v1 removes the choice.
- **The Warden's real brain** — today it is a stated heuristic and says so. The scoring machinery won't care how smart it gets.
- **The vault (Wave 4)** — an audited program PDA where a share of the game's own flow is swapped to SOL by a permissionless crank and vests to players. No new wallet, no fees touched, no key. This is the one component where a mistake is permanent, so it ships after review, or it doesn't ship.

## What we are not claiming

The Machine's floor is **simulated and labeled so** on the page until that audited vault exists. The devnet program is **devnet** — research, not the live money path; the game you play today still settles on our server, which is the entire reason the proof page exists. The Warden is a v0 heuristic. Log entries written before the cryptographic-sealing upgrade contain what they contain — a hash chain cannot be rewritten, and we would not want one that could be.

Rewards are credits and real RCX paid peer-to-peer, **never minted tokens**. There is no faucet, there will never be a faucet, and none of this is financial advice. It is a game about being right, and most people aren't.

## Come try to catch it lying

The market has spent years learning to discount promises to zero, which is rational. The only thing left worth building is systems whose good behaviour is a *property* rather than a pledge: sealed shots a cryptographer can check, champions paid inside other players' transactions, a log notarized by strangers for XP, a machine any of its players could resurrect, a settlement program that judged its own author a loser, and a proof page that would betray us in thirty seconds flat.

Nine public versions in thirty-six hours, every change in the changelog, including the bug we found in ourselves.

The floor only goes up. Everything else is sealed until it's over.

**Play:** [ratchetx.vercel.app](https://ratchetx.vercel.app)
**CA:** `FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump`
**Code:** [github.com/3esign/ratchetx](https://github.com/3esign/ratchetx)

---

*RATCHET pays its creators from pump.fun trading fees only. Stakes and reloads split 70% burn / 30% to players / 0% team, enforced in code and printed on the buttons. This article describes mechanics, not investment advice.*
