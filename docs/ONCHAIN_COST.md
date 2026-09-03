# What it costs, who pays, and how the machine feeds itself

**Measured 2026-09-03 from the program's own constants.** Reproduce with
`node tools/onchain_cost.mjs`; the numbers are pinned to `lib.rs` by
`test/test_onchain_cost.mjs`, so a change to an account layout fails the test
rather than quietly making this page wrong.

Before this, nothing in the repository carried a lamports figure of any kind.
G4 asks for "costs for 1, 100 and 1,000 active agents using measured actions per
agent, not a guessed SOL/USD forecast" — and the whole migration plan sat
downstream of an assumption nobody had checked.

## What is exact here, and what is not

Two of the three cost components are arithmetic over constants already compiled
into the program, so they are exact today and needed no devnet:

- **rent** = `(128 + bytes) × 3480 lamports/byte-year × 2 years` — Solana's own
  `ACCOUNT_STORAGE_OVERHEAD`, `DEFAULT_LAMPORTS_PER_BYTE_YEAR` and
  `DEFAULT_EXEMPTION_THRESHOLD`. Account sizes are lifted from `lib.rs` by
  evaluating the program's own `SIZE` expressions.
- **base fee** = 5,000 lamports per signature.

The third is not computable from source, and the tool refuses to invent it:

- **compute units**, and therefore any priority fee, need a real transaction on a
  real cluster. They are reported as UNMEASURED. There is no dollar figure
  anywhere in the tool, and a test fails if one appears.

The distinction matters because **the exact part dominates**, so the design
question is answerable now rather than after a devnet campaign.

## The numbers

| account | bytes | rent (SOL) | held |
| --- | --- | --- | --- |
| `Shot` | 254 | 0.002659 | until `close_shot` |
| `PlayerLedger` | 139 | 0.001858 | forever |
| `LegacyClaim` | 9 | 0.000954 | forever |
| `DelegateGrant` | 113 | 0.001677 | until revoked |
| `Podium` | 136 | 0.001837 | forever, shared |
| `FeedClock` | 2614 | 0.019084 | forever, shared, ×7 feeds |

One shot end to end is four transactions — `seal`, `settle`, `reveal`,
`close_shot` — so **0.00002 SOL spent** in fees and **0.002659 SOL locked** while
the chamber is open.

At three open chambers each:

| players | locked (SOL) | spent per cycle (SOL) |
| --- | --- | --- |
| 1 | 0.146 | 0.00006 |
| 100 | 1.214 | 0.006 |
| 1,000 | 10.923 | 0.06 |

**A thousand players is affordable, and the assumption the plan rested on
survives contact with arithmetic.** Per player it is 0.0108 SOL to exist on
chain with three chambers open — and that is the *player's* SOL, held as a
refundable deposit, not the house's.

Locked and spent are different kinds of money and must never be added: rent
comes back, fees do not. Conflating them would make the game look about 130×
more expensive than it is.

## The one recurring cost, and why it is not what it looks like

Every other line above is a deposit. The crank is not: somebody must send
`checkpoint` transactions, and the program cannot run on a timer.

The naive reading is a fixed daily bill — every feed, every minute, forever:
**10,080 tx/day = 0.0504 SOL/day**. On that reading the game needs a sponsor,
and a sponsor is a dependency on someone caring, which is the thing this whole
machine exists not to have.

But a checkpoint is only *useful* where a shot expires. `settle` wants the
unique update with `prev_publish_time < expiry ≤ publish_time`, so **one
checkpoint covers a whole publish interval of expiries at once** — every shot
expiring in that minute settles off the same observation. So the real cost is

```
checkpoints/day = min( minutes that actually contain an expiry , 1440 ) × feeds
```

which is **proportional at low volume and capped at high volume**:

| players | shots/day | checkpoints/day | per shot | SOL/day | levy per seal |
| --- | --- | --- | --- | --- | --- |
| 1 | 3 | 4 | 1.33 | 0.00002 | 13,334 lamports |
| 100 | 300 | 296 | 0.99 | 0.00148 | 9,867 lamports |
| 1,000 | 3,000 | 2,596 | 0.87 | 0.01298 | 8,654 lamports |
| 10,000 | 30,000 | 9,567 | 0.32 | 0.0478 | 3,189 lamports |

**Cost per shot falls as the game grows.** That is the shape a self-funding fee
needs, and it is a property of the design as built rather than something bolted
on afterwards.

## The principle: find the ground in the chain

Every place this machine depends on *somebody caring* is a place it is not yet
independent. The pattern that fixes each one is the same: **make the action pay
for itself out of the flow it is already part of**, and make the failure mode
"unpaid but still permissionless" rather than "stopped".

Three instances, in increasing order of elegance.

### 1. `close_shot` pays for itself out of what it releases

`close_shot` returns 0.002659 SOL of rent to the player. Today nobody is paid to
call it, so chambers sit closed-but-unreclaimed and the player's deposit stays
locked for no reason.

Paying the caller a slice of the rent it recovers needs **no purse, no levy and
no funding rule at all** — the action is self-financing by construction. This is
the purest case: the money to do the work is created by doing the work.

### 2. The crank is funded at seal, and degrades honestly

`seal` carries a small levy into a `CrankPurse` PDA. `checkpoint`,
`bind_crossing`, `settle`, `void_shot` and `forfeit` — all already
permissionless — pay their caller from it.

The bounty must **exceed** the caller's transaction fee or nobody cranks; an
instruction that is permissionless in theory and unpaid in practice gets cranked
by whoever happens to care, which is exactly where the game stands today. At
twice the fee (10,000 lamports a call) the levy at 1,000 players is 8,654
lamports per seal — against the 20,000 the player already spends on their own
shot's four transactions. It is noise inside a cost they are paying regardless.

`ONCHAIN_MIGRATION_PLAN.md` G4 demands the depletion behaviour be stated, so:
**when the purse is empty the bounty is zero and every instruction still works.**
They stop paying, they do not stop functioning. The game degrades to where it is
today — permissionless but uncompensated — and never to stopped. The purse only
ever holds what players put in, so nothing here promises perpetual sponsorship,
and no fee is ever deducted from a pot.

The honest failure mode is the other end: **cheap at scale, expensive per head
when almost nobody is playing.** At one player the levy is 13,334 lamports a
seal. That is survivable, and it is the direction you want the error in — a game
nobody plays is not expensive in absolute terms.

### 3. Blocker 8 is the crank problem wearing a different hat

"A mutable sponsored account is not an archive": a crossing nobody captured is
unrecoverable, and the Hermes path that could re-fetch it now requires a paid
key, which the standing rule forbids in the settlement path.

But look at *why* a crossing goes uncaptured — **nobody was paid to capture it.**
The bounty makes capture profitable, so coverage improves as the game grows,
which is the same curve as the table above. Combined with the `FeedClock.gaps`
counter proposed in `CORE_G3_ARCHIVE.md`, blocker 8 stops being a hole to argue
about and becomes a number that is *measured on chain and shrinking*: the gaps
counter reports the failure, the bounty reduces it.

That is not a workaround for the missing archive. It is a better answer than the
archive would have been, because it needs no external store, no key, and no
trust in whoever runs it.

## What Arweave can and cannot do here

Worth stating plainly, since it comes up:

- **It cannot solve blocker 8.** The archive problem is not storage, it is
  *authenticity*. Arweave stores bytes permanently; it cannot manufacture the
  Pyth signature we no longer have access to. Archiving unsigned observations
  proves nothing a stranger should believe.
- **It could host the client permanently.** That is a real "no ongoing payment"
  win, and a different problem: today the site lives on Vercel and stops if the
  account does. A one-time upload never renews and never goes down. The trade is
  immutability — updates mean a new upload, and a name that resolves to the
  latest one.

The first is worth being clear about so nobody spends a month on it. The second
is worth doing, and belongs with G6 (retire the server) rather than here.

## Still unmeasured

Named so nothing here is mistaken for a complete G4:

- compute units per instruction, and priority fees under real congestion
- account contention at 1,000 players — several settles racing one `FeedClock`
- failed-transaction fees, which are charged and are not in any table above
- RPC cost and rate limits at 1,000 players
- the void rate, which changes how many shots reach `reveal` at all

Every one of these needs a real cluster. What this page settles is the part
arithmetic can reach, and the part it reaches is the part that decides the
design: **the money works, and the one recurring cost can be made to come from
the flow rather than from a sponsor.**
