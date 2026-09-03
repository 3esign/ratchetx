# RATCHET: The Solana Prediction Machine That Burns Its Own Token

*Pyth-settled market calls, wallet-signed burns, a live player podium, autonomous agents, and an open-source Black Box anyone can verify or resurrect.*

**Play:** [ratchetx.xyz](https://ratchetx.xyz)<br>
**Token:** [$RCX on pump.fun](https://pump.fun/coin/FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump)<br>
**Contract address:** `FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump`<br>
**Source:** [github.com/3esign/ratchetx](https://github.com/3esign/ratchetx)

Most token projects launch a coin and promise to add utility later.

RATCHET starts from the opposite direction. It is a live prediction arcade in which the token is already part of the machine: players fire sealed calls at real markets, outcomes settle from Pyth price data, correct calls return credits and build XP, and every verified RCX reload follows one public rule:

**70% is burned forever. 30% goes directly to players on the live podium. 0% goes to the team.**

No treasury receives the reload. No prize pool takes custody of it. No winner waits for an administrator or presses a claim button. The player reloading the machine signs the Solana transaction that burns and distributes the RCX, and the game credits that transaction only after verifying it on-chain.

That makes RATCHET more than a themed website wrapped around a token. It is an experiment in making a game's economic behavior inspectable, repeatable, and difficult to fake.

## The 60-second version

RATCHET gives every new wallet a one-time starting balance of 5,000 in-game credits.

The Board deals a rotating set of market questions. A player chooses a target, chooses YES or NO, selects a credit stake, and fires a shot. Examples include:

- Will SOL be higher in five minutes?
- Will PUMP clear a stated threshold in thirty minutes?
- Will one asset outperform another over the next hour?
- Will price finish outside a defined range?

The call is sealed before the result is known. When its window closes, RATCHET uses the first valid recorded Pyth price at or after expiry—not whatever price happens to appear when somebody later opens the page.

A hit returns **1.7× the credit stake**. A miss feeds the Machine. The mathematical break-even point is therefore about **58.8% accuracy**: persistent skill can keep a player alive; random guessing eventually runs the balance down.

Correct settled calls also earn XP. XP moves players through COG, PISTON, FLYWHEEL, TURBINE, and REACTOR ranks, unlocking more simultaneous chambers—but never better odds. Rank expands how much of the game you can play at once; it does not secretly improve the result.

There are daily, weekly, and all-time records. The daily podium is intentionally dynamic: today's settled-XP top three take the live seats as they earn them. At 00:00 UTC, the previous day's winners temporarily fill empty seats, then today's third, second, and first place progressively replace them. There is no continuing hold-or-sell condition attached to a podium position.

Anyone can take the podium. It does not close at an arbitrary hour while the day is still being played.

## How one shot becomes a verifiable record

RATCHET does not publish an open player's answer in plain text.

When a shot is fired, the game creates a versioned SHA-256 commitment binding the wallet, shot ID, side, and a random salt. Spectators see the hash, not the answer. After settlement, the side and salt are revealed so anyone can recompute the commitment and confirm that the public answer was not changed after the fact.

This protects the player from spectator copying and creates a tamper-evident before-and-after record. It is important to state the boundary honestly: the server retains the reveal terms until settlement, so this is not zero-knowledge from the operator. The reviewed v2 on-chain referee is a roadmap target, not a claim about the current production game.

The settlement rule is equally explicit:

1. Record the entry price when the shot is accepted.
2. Seal the player's answer.
3. Wait until the prediction window expires.
4. Use the first recorded oracle sample whose publish time crosses the expiry.
5. If no valid sample exists inside the defined 15-minute settlement window, void the shot and refund the credit stake.

That rule removes a subtle but common source of manipulation. Settlement is not “the price when an operator chooses to check.” Checking early, late, or on the next user request should resolve to the same recorded crossing sample.

## A token economy that executes instead of promises

RCX was launched through [pump.fun](https://pump.fun), using the launchpad's open bonding-curve distribution, and graduated into its canonical [PumpSwap](https://swap.pump.fun) market. Pump's own documentation describes graduation as an automatic migration from the bonding curve to PumpSwap; RATCHET's [live Proof page](https://ratchetx.xyz/api/proof) verifies the resulting pool and token state rather than asking readers to trust a graphic.

The RCX mint is a Solana **Token-2022** mint. Its mint authority is revoked. Its freeze authority is revoked. The token's metadata update authority is also null. Those are on-chain account properties, not promises in a roadmap.

Inside the game, RCX is used to reload credits. The payer signs one transaction containing the required token movements:

- **70%:** a supply-reducing Token-2022 burn;
- **30%:** direct transfers to the published live podium, split 50/30/20;
- **0%:** no reload transfer to the creator or a game treasury.

The server then verifies the signature, the mint, the amounts, the destinations, the recency of the transaction, and whether that signature has already been used. Only a valid, unused transaction can create the corresponding game-credit deposit.

The practical result is simple: the reward path does not depend on the game holding player funds. RCX moves from the payer to the burn instruction and current champions inside the payer's transaction. The game's public receipts distinguish tokens burned, RCX received from other players, RCX retained when the payer is also on the podium, and credits created inside the game.

The system has already paid RCX to another player's wallet. Those transfers are linked from the interface and can be inspected on Solscan. RATCHET does not need to ask the community to imagine a future reward system—the first reward history exists today.

Credit stakes use the same economic shape without pretending credits are tokens. A hit returns 1.7× credits. A miss removes the stake from the player balance, with 70% retired from active credit circulation and 30% feeding the daily and weekly competition pots. Credits are internal game accounting units; they are not RCX, not a stablecoin, and not a promise of redemption.

The team is paid through the standard creator-fee path associated with the token's pump.fun/PumpSwap trading activity—not from RCX reloads and not from player credit stakes. That distinction is printed in the game and exposed in the code.

## Why this belongs on Solana

RATCHET uses Solana for the parts that benefit most from a shared public ledger: wallet identity, signed token movement, supply-reducing burns, player-to-player RCX rewards, immutable transaction receipts, and public log anchors.

Solana transactions group instructions into atomic state transitions: either the transaction's instructions succeed together or the transaction fails. That property is what allows one RCX reload to express the complete 70/30/0 rule instead of relying on a sequence of private bookkeeping promises. Solana's low transaction costs and fast execution also make frequent, player-signed game interactions practical rather than ceremonial. The underlying model is documented in [Solana's transaction documentation](https://solana.com/docs/core/transactions).

RATCHET also ships a [Solana Action](https://solana.com/docs/tools/actions) for anchoring the current event-log head. A wallet can publish the current RATCHET hash as a Solana Memo and earn a small once-daily XP reward. In other words, notarizing the game's public memory is itself a game action.

Not every line of the game is on-chain, and we should not pretend otherwise. Credits, XP, boards, leaderboards, and current settlement orchestration live in the server layer today. The RCX movements and anchors are on Solana; the game state is public, exportable, hash-chained, and testable, but it is not yet governed by a fully on-chain referee.

That boundary is a design choice for the current release, not a slogan to hide behind.

## Why Pyth is more than a price widget

Pyth Network is not used merely to decorate the interface with market prices. RATCHET reads sponsored Pyth price-feed accounts on Solana and records the samples used by its settlement rule.

Pyth price data includes the price, confidence interval, exponent, and publish time. Pyth's own [Solana integration guide](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana) emphasizes validating the feed identity and timestamp rather than blindly trusting any account that contains a price. RATCHET surfaces feed age, rejects short-window entries against stale data, records samples over time, and settles at the first valid crossing after expiry.

If the primary on-chain route is unavailable, a thinner fallback may keep display prices visible, but fallback display data is not silently promoted into an eligible real-money settlement source. The Proof page reports the oracle route so the source cannot quietly change behind a green light.

RATCHET also publishes an [Oracle Observatory](https://ratchetx.xyz/api/feeds): a consumer-side record of observed Pyth feed ages, gaps, confidence bands, and settlement impact. It is useful beyond this game because it shows what an application actually experienced while consuming the feeds—not only what an oracle claims in the abstract.

## Security is a collection of mechanisms, not one word

“Trustless” is often used as marketing shorthand. RATCHET takes the narrower and more useful approach: identify each trust boundary and remove or expose it where possible.

The production system currently includes:

- **No server private key capable of moving player funds.** Wallets sign their own RCX burns and reward transfers.
- **No token custody for reloads.** The game verifies a completed transaction; it does not first take possession of a deposit.
- **Revoked mint and freeze authorities.** The live mint account can be inspected independently.
- **Replay-gated reloads.** One Solana transaction signature cannot be credited twice.
- **Published podium destinations.** A reload is rejected if its 30% distribution does not match the current immutable transaction snapshot.
- **Cryptographic shot commitments.** Open answers are hidden from spectators and revealed after settlement.
- **Deterministic first-crossing settlement.** The exit price is tied to recorded oracle time, not operator timing. Operator timing decides only whether a shot settles or refunds, and anyone — including the player — may settle it.
- **Hash-chained events and Solana anchors.** Any wallet can notarize a checkpoint.
- **Export and restore tooling.** The Black Box snapshot includes the state needed to verify and rebuild the machine on fresh storage.
- **Public build identity and tests.** The live h53 release exposes its version, has zero known npm audit vulnerabilities, and passes 26 isolated test suites covering economic invariants, signatures, settlements, snapshots, log verification, responsive layout, and failure paths.

This is an internal engineering audit and public verification surface, not an independent third-party security audit. The distinction matters.

The [Proof endpoint](https://ratchetx.xyz/api/proof) is also allowed to be red. Production currently discloses one historical storage gap at event 345 instead of inventing a replacement row or moving the error to the end of the log. The h53 verifier identifies the actual missing index and reports how many entries were issued and stored. New heads can still be anchored and compared from a known checkpoint, but a complete replay across the missing row is impossible. A proof system that cannot admit damage is only decoration.

## The Warden, public models, and machine-native players

RATCHET is designed for humans and software agents to compete on the same market questions.

The Warden publishes a directional view and an explicit probability. Players can go with it or take the other side. Its hits and misses are both retained, and calibration can be measured with a Brier score. A model that only displays winning predictions is advertising; a model with a permanent error record can become evidence.

The Agent Arena extends the same principle. External agents authenticate with an Ed25519 wallet signature and call the same shot API as a human. There is no privileged “agent endpoint” with easier prices, different settlement, or hidden odds. Agents are published immediately and ranked only after enough settled calls to make a tiny lucky streak less convincing.

Four public house strategies—Momentum, Reversion, Volatility, and Contrarian—play under the same rules and lose in public. The repository includes a zero-dependency reference agent that can first run in demo mode, then graduate to a real signed identity.

The Warden is a labeled heuristic today, not artificial general intelligence. The more interesting long-term goal is not to paste an AI label onto the interface. It is to build a public arena where increasingly capable models can make time-stamped, economically meaningful predictions and accumulate records they cannot quietly edit.

## Open source means you can fork the Machine

The complete RATCHET code is public on [GitHub](https://github.com/3esign/ratchetx). The game core is intentionally small, framework-free, and free of production npm dependencies. The repository includes the serverless endpoints, browser client, oracle decoder, burn verifier, event log, public record, agent example, test suites, snapshot exporter, and restore script.

Anyone can deploy a new instance, inspect the rules, change the markets, build a different Warden, or create a different visual identity. More importantly, anyone can download the canonical Black Box snapshot and verify its envelope and hash chain before restoring it.

That does not mean every fork inherits the canonical game's reputation. A fork must publish its own rules, build marker, proof surface, anchors, and trust boundaries. Open source makes independent machines possible; public history is what makes one of them credible.

The larger idea is a permissionless family of prediction machines: community-run boards, specialist agent tournaments, new oracle-defined questions, and alternative game economies built from the same inspectable primitives. “Run your own casino” is the playful version. The serious version is: **fork a verifiable market game without asking the original operator for permission.**

## What is live, and what is next

RATCHET h53 is live today at [ratchetx.xyz](https://ratchetx.xyz):

- real wallet authentication;
- sealed prediction shots;
- Pyth-based first-crossing settlement;
- 1.7× credit returns on hits;
- daily, weekly, and all-time ladders;
- a dynamic daily RCX podium;
- wallet-signed 70/30/0 reloads;
- verified burns and direct player rewards;
- balance-based, no-deposit credit rewards;
- public agents, Warden records, and challenges;
- Proof, Observatory, Supply Clock, Record, Snapshot, and restore tooling;
- Token-2022 on Solana and a canonical PumpSwap market.

The next phase should deepen the system without pretending unfinished work is already guaranteed:

1. **A hardened v2 on-chain referee.** Permissionless settlement with strict first-crossing time rules, confidence limits, disjoint settle/void deadlines, and cleanup that cannot trap state.
2. **Durable autonomous sampling.** Move the continuous oracle/observatory heartbeat from a local operator process to redundant managed infrastructure with visible liveness and recovery.
3. **Independent security review.** External review of token paths, server invariants, snapshot recovery, and any new Solana program before stronger trust claims are made.
4. **A real vault only if it can be proved safe.** A separately funded vault would require explicit liabilities, no hidden withdrawal authority, redemption rules, and independent review. Until then, the displayed floor remains a clearly labeled, non-redeemable model.
5. **Agent seasons and tournaments.** Longer public records, strategy classes, calibration leagues, challenge markets, and open datasets for researchers and builders.
6. **More Solana-native entry points.** Additional Actions and Blinks for public game actions that remain understandable before a wallet signs them.
7. **A forkable protocol layer.** Tools for communities to launch their own boards and machines while publishing compatible proofs and histories.

These are development directions and open questions, not guaranteed returns or fixed delivery dates. RATCHET should earn the right to make each stronger claim by shipping the mechanism first.

## The Machine's proposition

RATCHET is not asking players to believe that a team will someday create a burn, a game, an agent economy, or a reward loop.

The game is live. The RCX supply has already fallen. Other players have already received tokens. The Board already settles calls from recorded Pyth data. The Warden already has losses in public. The code can already be read. The state can already be exported. The Proof page can already disagree with the marketing.

That last property may be the most important one.

Crypto does not need more systems that can only tell their own success story. It needs machines that preserve evidence, expose boundaries, and make their economic rules harder to change than their slogans.

RATCHET is one such machine, built on Solana.

Fire a shot. Beat the Warden. Take the podium. Verify everything.

---

**Play:** [https://ratchetx.xyz](https://ratchetx.xyz)<br>
**Proof:** [https://ratchetx.xyz/api/proof](https://ratchetx.xyz/api/proof)<br>
**Open source:** [https://github.com/3esign/ratchetx](https://github.com/3esign/ratchetx)<br>
**pump.fun:** [RCX token page](https://pump.fun/coin/FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump)<br>
**PumpSwap:** [Trade RCX/SOL](https://swap.pump.fun/?input=FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump&output=So11111111111111111111111111111111111111112)<br>
**DEXScreener:** [RCX/SOL market](https://dexscreener.com/solana/3gbsebmbbfqrc7wt7crajnkuhxntbfynjhrmedchjusv)<br>
**Telegram:** [https://t.me/rchetx](https://t.me/rchetx)<br>
**X:** [@SonyxEth](https://x.com/SonyxEth)<br>
**CA:** `FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump`

*RATCHET is an experimental prediction game. Credits are internal game units, not tokens and not redeemable claims. RCX is a volatile crypto-asset and can lose value. The modeled floor is not a funded or redeemable vault. This article describes software and game mechanics; it is not financial advice or a promise of future performance.*
