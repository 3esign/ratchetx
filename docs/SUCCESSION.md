# Succession — what happens to a frozen program's history

Research note, 2026-08-28. Written because "it is immutable afterwards" is the right thing to
worry about before the fact, and because the answer changes two of the v3 specs.

## The question

An immutable program cannot be upgraded, so every future version is a **new program id**.
That is not a limitation to design around; it is the only shape succession has on Solana once
the authority is gone. The real question is narrower and answerable:

**How much is lost at the boundary between one version and the next?**

## What the record shows: Serum

The clearest case is Serum. Its program's upgrade keys were held by FTX rather than by the SRM
DAO, and when FTX collapsed the key stopped being a convenience and became a liability
overnight — a live key in the hands of an entity in bankruptcy proceedings, capable of
changing a program the whole Solana DeFi stack was routing through.

Nobody could revoke it, because revoking requires holding it. The ecosystem's only available
remedy was to **fork the program under a new id** — OpenBook, deployed 14 November 2022 — and
re-integrate everything downstream around the new address.

Two things follow, and they point in opposite directions from where intuition puts them:

- **A retained upgrade key is not neutral while unused.** It is a dormant liability that
  activates when its holder does, and its holder's future is not something you control. This
  is the strongest available argument for 2026-09-08 and it is an empirical one.
- **Succession happened anyway, and it cost the state.** OpenBook is a separate program with
  its own markets. Nothing carried across by itself.

So: freezing does not create the succession problem. Succession is the permanent condition of
any program anyone will still care about in three years. Freezing only removes the illusion
that you could have avoided it.

## Can a successor read its predecessor?

Yes, and we do not have to take documentation's word for it, because **our own deployed
program does exactly this on every settlement.**

`ratchet_seal` reads a `PriceUpdateV2` account that belongs to Pyth's receiver — a different
program entirely — checks its owner, deserializes it, and settles a shot on the result. That
has run on mainnet since 23 August. A program reading another program's account is not a
theoretical capability here; it is the mechanism the whole game already stands on.

The rule is asymmetric and it is the asymmetry that matters: **ownership gates writes, not
reads.** Solana's own account documentation states the write rule flatly — *"Only the
account's owner program can modify its data or debit lamports"* — and says nothing restricting
reads, because there is nothing to restrict. An account is public data.

So a v4 program can read every `Calibration` account v3 ever wrote, treat them as prior
history, and require nobody's permission or cooperation to do it. Not ours, not the player's,
not v3's.

Three things have to be true for that to work, and all three are decisions to make now:

1. **The account layout is published as protocol, not as an implementation detail.** A
   successor that has to guess the layout is a successor that gets it wrong.
2. **The account is identifiable.** Owner must equal the v3 program id, and the Anchor
   discriminator — `sha256("account:Calibration")[..8]` — must match. Together those make
   spoofing an old record impossible: an attacker would have to get v3 to write it.
3. **The record must still exist.** Which is the part that was not specified, and is the
   reason this note exists.

## The amendment: the calibration account must have no close instruction

`Shot` accounts are closable, deliberately — they are receipts, the rent comes back, and the
events survive in transaction history.

A `Calibration` account is the opposite. It is the history. If it can be closed, then a
player's record can be erased — and worse, **a frozen program's records could be destroyed
after the program can no longer be changed to prevent it.**

An account can only be closed by the program that owns it. So a program that ships without a
close instruction, and is then frozen, produces records that **literally cannot be destroyed
by anyone, ever** — not by us, not by the player, not by a future authority, because there is
no future authority and no instruction that could do it.

That is worth stating plainly because it inverts how immutability usually feels. Immutability
is not only the cost of never fixing a bug. It is also the thing that makes a record permanent
in a way nothing else on a computer is.

**Cost, stated:** the rent on a `Calibration` account is locked forever. At the layout in
`CALIBRATION_ONCHAIN.md` that is 161 bytes, so `(128 + 161) x 3480 x 2 = 2,011,440` lamports
— **0.00201144 SOL per player, permanently**, or 20.1 SOL at ten thousand players. Computed
from the rent formula, not measured against a node; it is quoted here so the price of a
permanent record is printed next to the claim rather than discovered later.

**The other cost, stated:** if the layout has a mistake in it, that is permanent too. A
successor can read around a bad field but can never repair one. Which is the actual argument
for studying the layout before freezing rather than reaching for governance to fix it later.

## What this does not solve

- **A successor can read history but cannot continue it.** v4 accumulates into its own
  accounts. A reader combining v3 and v4 records is combining two instruments and must say so,
  the same discipline the referee binding already imposes.
- **Nothing forces a successor to read anything.** Continuity is available, not guaranteed. A
  v4 that ignores v3 is possible and nobody could stop it — which is correct, because the
  alternative is a mechanism that constrains future programs, and that mechanism would be an
  authority.
- **Reading old records does not make them comparable.** If v4 changes the settlement rule,
  v3 scores measure something else. Same trap as `ldg2` -> `ldg3`, one layer up.

## Amendments this note produces

- `CALIBRATION_ONCHAIN.md` — no close instruction for the calibration PDA; layout published as
  protocol; the permanent-rent cost stated.
- `REFEREE_BINDING.md` — already seeds the calibration account by referee; add that a
  successor reading v3 records inherits the referee dimension and must not flatten it.

Neither changes v2, and neither changes 2026-09-08.
