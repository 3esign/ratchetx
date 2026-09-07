# RatchetX: less AI conviction, more receipts

Crypto has enough bots telling you what happens next.

RatchetX asks a harder question: will your agent make a call BEFORE the outcome,
say how confident it is, and keep the result on its record afterward?

Think prediction arena meets an AI report card.

## What we just tested

I gave Bankr a limited permission to use my existing Ratchet play-credits.
Then I asked @bankrbot on X to make one five-minute forecast.

Bankr reported choosing SOL higher, staking 10,000 play-credits and assigning its
chosen side a 52% chance. The forecast settled HIT. It reported a net gain of
7,000 play-credits and linked the shot proof.

Those are game credits, not a 7,000-dollar profit or a token transfer.
And one correct call does not prove the agent has an edge. That is the point of
keeping the losses and confidence scores too.

## Why this is more than a bot saying "bullish"

The prediction is sealed before the outcome. Ratchet then resolves it using
captured @PythNetwork price observations from @solana and records the result.

Agents state probabilities, not just directions. Being confidently wrong hurts
more than admitting uncertainty. Over many calls, the scorecard helps distinguish
well-calibrated forecasts from loud guesses.

The permission is bounded: maximum attempts, maximum stake, total allowance and
expiry. It cannot transfer my tokens, reload credits or create another permission.
I can revoke it. A public wallet or session ID is not permission to play.

A 100,000-credit allowance is a ceiling, not an upfront spend. Winning does not
refill it. Each explicit X play command requests one forecast. A stats question
does not play, and a cooldown is not an automatic betting schedule.

That is the useful direction for agent interfaces: ask in normal language,
give narrow authority, and inspect what actually happened.

## What each piece contributes

@bankrbot is the conversational interface in this owner pilot: request a forecast
on X and get a result back. Private session setup is still required; this is not
a claim that every X account is already connected.

@PythNetwork supplies the price evidence. Ratchet reads validated Pyth updates
on Solana, including timestamps and confidence information, to support its rules.

@solana is the foundation for RCX and the on-chain components. MCP gives agents
a structured menu of actions; think of it as an instruction manual they can use
directly instead of guessing how to operate a website.

@Quicknode has been part of our devnet compatibility testing. Constraints found
there shaped how we batch account reads. @metaplex Core has been part of our
player-passport experiments on devnet. These are distinct pieces of the work,
not a claim that either provider runs this forecast or endorses the project.

RCX connects the game to token utility through the ranked play-credit reload
mechanism. The aim is to build something people and agents want to use—not to
promise a token price because a bot won one round.

## What is on-chain today—and what comes next

Pyth price observations are on Solana. RCX and our existing on-chain components
are real. But the current canonical game credits, settlement and scorekeeping
still depend on Ratchet's server. A hash or proof link does not remove that trust.

The next major milestone is moving authoritative game state and rules on-chain:
credits, forecast commitments, settlement, scoring and bounded agent permissions.

The test for success is simple: if our server disappears, independent clients
should still be able to play, settle, revoke and verify. The website and agent
interfaces can remain convenient front ends, not the owners of the truth.

That is what we are building toward. No fake "fully on-chain" label before then.

Come test the game, inspect the receipts, and tell us where the design breaks.
RatchetX: https://ratchetx.xyz

---

## Editorial/evidence notes — not part of the article

Prepared2026-08-30. Draft only; not posted. No ClawPump entry submitted or fee
configuration changed. Do not announce official partnerships or hackathon
acceptance. Confirm any current token-routing details before adding fee claims.

User-provided Bankr screenshot1 reports shot669da614803f, targetH496699Q0,
YES/p0.52, stake10,000, HIT, balance1,452,182→1,459,182, stated16,
Brier0.2905/error0.2304, allowance9/90,000. Screenshot2 repeats that shot with
command2094139084050759779 and the same balance/allowance, but explicitly lacks
verified probability, quote age, entry/exit, payout and XP details in that reply.
Treat these as Bankr-reported, not independent wire-journal verification or a
second play. Public shot API retrieval during drafting returned non-JSON HTML,
so no fresh independent proof verification was claimed. Investigate read-only
before promoting stronger evidence claims; do not create a new play to check.

QuickNode scope: docs/STACK.md (devnet RPC, not current mainnet dependency).
Metaplex scope: docs/POST_WEEK_ONE.md and Core experiment handoff (devnet).
On-chain boundary: docs/ONCHAIN_MIGRATION_PLAN.md; no timeline guarantee.

## ClawPump application draft / unresolved choices

Official form: https://clawpump.tech/ansemhack
Project: RatchetX. Ticker: RCX. Website: https://ratchetx.xyz
Project X: actual account handle required; user has not yet confirmed whether
@SonyxEth is the intended project identity. An X Article link is not an @handle.
Contact email: awaiting owner choice. No inferred personal email.
Suggested track: ClawPump × pump.fun builder/tooling focus, subject to form choices.
One-line pitch:
"An agent-native forecasting arena with Pyth price evidence, probability scorecards and bounded wallet-approved play. Working Bankr owner pilot; building toward on-chain game settlement and agent permissions on Solana."

Official page currently requires registration, X announcement/follow and eligible
tokenization by19September2026; use same X identity for token verification.
Existing-token migration route: https://clawpump.tech/dashboard/migrate
Actual RCX eligibility and configured fee split are unverified. Current public
launch pages advertise65/35, while previously inspected migration UI defaulted
to75/25 and requested a sole fee collector. These are different routes; do not
infer the RCX migration split from the launch page or assume approval of25%
authorizes routing100% through a collector. Confirm exact recipient, payout
wallet, split and authority before any signature; never launch replacement RCX.

Sources checked2026-08-30:
https://clawpump.tech/ansemhack
https://clawpump.tech/docs
https://www.clawpump.tech/analytics
https://github.com/quicknode
https://github.com/pyth-network
