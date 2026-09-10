# The evidence rent comes back

Recorded 2026-09-10. Devnet only. Deployed and measured on chain.

## What was wrong

`TimepinNeedV2.open_refs` existed in the first version of the program. It was set
to zero at `open_need` and incremented by nothing - the source said so against
itself, in a comment. A count nobody increments is not a guard, so nothing on
chain could ever say "the last game that needed this target has finished", and
two permanent accounts were paid for and never returned:

| Account | Paid by | Lamports |
|---|---|---|
| `TimepinNeedV2` | the player, at seal | 1 503 680 per target |
| `CandidateV2` (the captured price) | the keeper, at capture | 1 254 760 per target |

Measured the day before this change, a keeper serving one player lost **2 439 520
lamports per game** against 90 000 earned. That is why no stranger could honestly
be invited to run one.

## What exists now

Three instructions in Timepin, and one CPI in Core.

- **`hold_need`** creates a `NeedHoldV2` at (need, holder) and increments
  `open_refs`. Permissionless: a hold can only make an account live LONGER, so
  taking one out for somebody else's game wastes your own rent and harms nothing.
  `init` makes a double hold impossible.
- **`release_hold`** decrements and closes, and requires **no signature from the
  holder**. Asking Core to sign would have meant adding accounts to `reveal`,
  `forfeit` and three void paths, and a game whose owner walked away would hold
  evidence for ever. The proof is instead the ABSENCE of the Shot - system-owned,
  zero data, zero lamports - which only the program that owned it could produce.
- **`close_need`** returns the Need's rent to its payer and, in the same
  instruction, the candidate's rent to whoever captured it. It requires all three
  of: a terminal Need, zero holds, and a week past the capture deadline. **The
  week is a belt, not the guarantee** - the counter is - and it exists only to
  cover games sealed by an older Core that took no hold.
- **Core takes the hold at seal**, on all four seal paths, with the Shot as the
  holder. `CandidateV2` gained `rent_payer` so that there is finally an address on
  chain saying whose money bought the account (111 -> 143 bytes).

Every failure mode degrades to an account that stays, never to a game that cannot
settle.

## Evidence

**Exact-SBF**, against the freshly built `.so`, inside `full_forward_lifecycle`:

- after the seal, `open_refs` is 1 on **both** Needs and the hold account exists
- a **stranger** releases the hold once the Shot is closed, and the hold's rent
  lands on the sealer to the lamport
- `close_need` is then refused while the exit target is still held - and it is the
  counter refusing, not the clock, because the clock is a fortnight past
- closing the entry target returns the Need's rent to the sealer **and the
  captured price's rent to the keeper that captured it**

**On devnet**, deployed and played:

| | |
|---|---|
| Timepin deploy | `aQj6D7YV5LomXCeHMKc4ADxT51MGbyqEKEmFYhrHyUv8kmY2TN4ZJTRDPAyupXTinizFrayx1xE9L5S6iX4r1WX` |
| Core deploy | `2ApRZYgiEzYEqcU92MhqrbvUouz8Uxf9SG8jYxKjYrPB37nc2udyZ7RdJ7Sw6kJj3fLgpnGkwiA8WDGhDEV4HZk` |
| On-chain bytes | both dumped back off the chain; sha256 of the leading bytes equals the built artifact exactly, remainder zero padding |

The seal transaction `3ahuvhYxHJ9b` carries `SealForward, HoldNeed, HoldNeed` and
funds two hold accounts with 1 234 440 lamports each. Immediately after it:

```
entry need 9hHzsn356x7T…  open_refs 1   hold present
exit  need ENLR4YRwNX1d…  open_refs 1   hold present
```

That game then voided on its entry target, and the keeper was paid one bond unit
for the void (`22kfV8bHRF2b`, +45 000). With the Shot gone, the sweep released
both holds - `5V2FiKGWdDas…` and `qiAxUUa7giLU…`, sent by the Frankfurt operator,
refunding **1 234 440 lamports each to the player**, who is not the sender. Both
Needs then read:

```
9hHzsn356x7T…  open_refs 0
ENLR4YRwNX1d…  open_refs 0
```

## What is NOT proved here

`close_need` has not run on devnet, and cannot for another week: the delay is
seven days past the capture deadline and it was not shortened for the convenience
of a demonstration. Its behaviour is proved only at exact-SBF level, where the
clock can be moved. A daily `systemd` timer on the independent operator runs the
sweep from now on, so the first real close will happen without anyone
remembering to do it.

## The honest trade

A player now fronts MORE at seal - two hold accounts, 1 234 440 lamports each -
and gets all of it back. Before, 3 007 360 lamports of Need rent burned forever
and the keeper's 2 509 520 burned with it. Nothing burns now; capital is only
held while a game is alive. Bigger deposit, zero destruction.

Mainnet economics are still unsettled and the manifest is still unapproved. This
receipt says the rent can come back. It does not say anyone should go to mainnet.
