# Week-one post (short version, for the timeline)

Use the long-form article for the X Article; this is the standalone post / thread-starter
that links it. Numbers as of 2026-08-25 — re-check /api/game?action=state before posting
if a day has passed.

---

## Single post

One week since $RCX went live on pump.fun. What shipped:

— 62.4M RCX destroyed (2.71M burned by players, every one verified by signature)
— 1,707 entries in a hash-chained public log anyone can anchor to Solana
— settlement on Pyth prices read straight off the chain: the FIRST update after expiry, or a refund
— reloads that pay the podium wallet-to-wallet inside YOUR signed transaction — we never touch it
— a mainnet Anchor program, byte-verified against the repo
— the house AI's record, losses included (its first version went 6/32 — we retired it in public, on the log)
— 70 releases in 7 days, three self-audits published, and one bug that could eat a player's burn — found by auditing ourselves, fixed and shipped with tests the same day

70% of every stake burns. 30% to players. 0% to us. Frozen. No private key exists anywhere in the system.

Full week-one writeup: [ARTICLE LINK]
Play: ratchetx.xyz · Code: github.com/3esign/ratchetx

---

## Thread version (if you'd rather thread it)

**1/** One week since $RCX launched on pump.fun with a working game attached. The rule,
frozen since day one: 70% of every stake burns, 30% to player pots, 0% to the team.
Here's what a week of "the machine cannot lie" actually shipped. 🧵

**2/** Supply: 1B → 937.6M. 62.4M RCX gone — 59.7M at graduation, 2.71M burned by
players. Every player burn is a signed transaction the server verifies off the chain and
counts separately. We only take credit for ours. Live: ratchetx.xyz/api/supply

**3/** Settlement isn't "the price when someone asked." Every shot settles on the FIRST
fully-validated Pyth update at/after expiry, read off Solana accounts — or it voids and
refunds. Ties refund. Missing evidence refunds. The minute-by-minute price record is
public; re-derive any outcome yourself.

**4/** We measure our own oracle and publish it: per-feed heartbeats, confidence bands,
divergence vs Coinbase, and our own 96% sampling duty — plus the 23 bets we refunded
rather than settle without evidence. Nobody publishes third-party numbers on Pyth's
sponsored feeds. Now somebody does. ratchetx.xyz/api/feeds

**5/** Reloads are one signed transaction: Jupiter swap → 70% burn → 30% paid
wallet-to-wallet to the live daily podium (50/30/20). No custodial hop. The server can
only verify and refuse — it can't touch the money. That's the Champion's Cut.

**6/** The house plays in public. The Warden posts a probability every hour and wears
its record: 58/90. Its first version was a lookup table pretending to think (6/32) — we
retired it publicly and logged the reset. Four house agents fire hourly; the one at 42%
stays on the page. Bring your own agent: the Arena API is open.

**7/** On-chain, said precisely: Ratchet Seal v2 is live on mainnet, byte-verified
against the repo, holds no funds, and lets you seal a shot's commitment before expiry.
The canonical referee is still our server — labeled on every response — until v3 earns
it on devnet. "Fully on-chain" is proven, not tweeted.

**8/** The hard part of the week: we audited ourselves and found our burn verifier could
refuse a legitimate manual burn AFTER the tokens were destroyed. Fixed same day, shipped
as h69 with 21 test assertions pinning the bug shapes, verified live, written up. The
product isn't "no bugs." It's bugs dying in daylight.

**9/** Built on: Solana · pump.fun + PumpSwap · Token-2022 (authorities revoked, read
from the mint, not asserted) · Pyth · Jupiter · Anchor + Solana Playground · Blinks ·
Vercel · Supabase · Cloudflare Workers · Metaplex Core (passport experiment, devnet,
raw numbers first).

**10/** For pump.fun launches, the experiment is simple: a token whose only team revenue
is trading fees, whose supply only shrinks, whose payouts move player-to-player, and
whose every claim is an endpoint — including the proof page that shows two RED lines for
our own disclosed log gap. Checkable beats believable.

Full writeup: [ARTICLE LINK] · Play: ratchetx.xyz · Code: github.com/3esign/ratchetx
