# What twenty-one of twenty-one does not know

**Lead, 2026-09-06, written the hour the gate went green.**

The gate says it itself, and it is the most useful sentence in the whole file:

> ALL CHECKS PASS. This says the tree is ready; it does not authorise anything.

A green gate is the most dangerous moment a project has, because it is the moment
everyone stops looking. This is the list of what it does not cover, written now
rather than discovered later, by the person whose rows they are.

---

## 1. One game, one player, one feed, once

The whole of L1 and L2 rests on **a single shot**: nonce 0, one player, SOL, one
entry and one exit, settled and revealed at about 01:20 UTC.

That proves the machine can complete a game. It does not prove:

- **a second shot** — nonce 1 has never existed, so `next_shot_nonce`
  incrementing, a second HistoryPage slot and the `terminal_mask` second bit are
  all untested against a real chain
- **two players at once** — every PDA is per-player, so this is likely fine and
  "likely fine" is exactly the phrase that precedes an incident
- **the sixteenth shot**, where a HistoryPage fills and page_index rolls
- **any feed but SOL**, though the manifest approved seven
- **a losing shot.** The one game that has ever completed was a HIT. The `hit=0`
  path, the XP-that-is-not-awarded path and the losing sentence have never run
  on chain

## 2. Every void reason is untested on chain

`Equality`, `ConfidenceBand`, `EntryExpired`, `ExitExpired` — four outcomes a
real player will meet, and **not one has ever happened**. The unit tests cover
them; the chain has never produced one.

The confidence band is the one to worry about. It is the only rule that voids a
shot for a reason the player cannot see coming, and it is the sentence the design
works hardest to explain. It has never fired.

## 3. Nothing has been played by a stranger

Every transaction so far was sent by our own tooling with our own keypair. That
means the browser path — a wallet the user controls, a signature in an extension,
a reveal key stored on a device and used later — has not been exercised by
anyone. `admission.enabled` is still false, so it cannot be yet.

**The gate has no row for "a person, not a script."** That is not a defect in the
gate; it is the boundary of what a gate can ask.

## 4. The delegated path is entirely unproven

`grant_delegate` and `seal_forward_delegated` have never run. Every bound —
per-shot cap, total, count, interval, expiry, revocation — is tested only in
JavaScript against a struct I typed. **An untested bound is a bound nobody should
trust an agent with**, and that is why the delegate proof asks for a REFUSAL
rather than a success.

## 5. The airdrop root is verified by one implementation

Mine reproduces a root the chain accepted, which is strong. But the seventeen-leaf
tree that would actually pay players has never been folded by the Rust, and the
economy's `legacyRoot` is still zero, so `claim_legacy` for those seventeen would
refuse today. It is verified as arithmetic, not as a claim.

## 6. Two accounts that will one day fill

`HistoryPage` holds sixteen slots and `PlayerDay` accumulates. Both have rollover
paths — page_index incrementing, a day closing — that unit tests cover and no
chain has performed. M2 and M3 made the rent recoverable; nothing has recovered
any yet.

## 7. What the gate structurally cannot ask

- whether the game is **fun**
- whether the site is **understandable** to someone who has not read the program
- whether the numbers are **fair**, as opposed to correctly computed
- whether anyone **wants** to play it

Those are the questions that decide whether this succeeds, and there is no row
for any of them. A green gate means we built the thing we said we would build. It
says nothing at all about whether it was worth building, and honest engineering
does not get to answer that question.

---

## What I would do with this list

Not add twenty-one more rows. A gate that asks everything asks nothing, and this
one earned its authority by being small and by refusing to go green on things it
could not measure.

The right use is **order**: a second shot and a losing shot before anyone
celebrates, a void of each kind before the site opens to strangers, the delegate
refusal before Bankr, and the seventeen-leaf tree through the Rust before anyone
is told they have an airdrop coming.

None of that is a blocker. All of it is cheaper tonight than after somebody has
played.
