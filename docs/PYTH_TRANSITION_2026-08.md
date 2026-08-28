# The referee moved, thirteen days before we freeze

Research note, 2026-08-28. Sources are Pyth's own DAO forum and developer docs, read today;
every claim about *our* system is checked against our code or our live endpoints and says
which.

## What happened

**Pyth Core on Solana upgraded on 26 August 2026, 16:00 UTC** — two days ago — under
`OP-PIP-131: Pyth Core Deprecation (SVM)`. Four changes matter here:

| change | what it means for a consumer |
|---|---|
| legacy Pythnet emitter `G9LV2mp9…` replaced by upgraded Core data source `6R92oFT6…` | the thing producing the numbers is a different program |
| update fee on SVM receivers `1` → `0` lamports | cheaper, and irrelevant to us: we read accounts, we do not post updates |
| Wormhole receiver `HDwcJBJX…` upgraded to enable guardian-set migration | see below — this is the one that matters |
| Hermes now requires an API key | our fallback path, already gated on `PYTH_API_KEY` |

The guardian-set change is the one worth stating plainly. Pyth's proposal describes
permissionless `close_guardian_set` and `initialize` calls that migrate attestation **from the
Wormhole guardian set to a Pyth-controlled 5-key multisig.** The proposal is explicit that the
migration itself is not part of that vote, so the timing is not fully public.

We do not editorialise about whether that is good for Pyth. What it is, for us, is a change in
the trust model of the only referee this game has, executed thirteen days before we make our
pin permanent, by a process we neither control nor were asked about.

## Where that leaves us: checked, not assumed

**We are on the upgraded stack already, deliberately.** The program's manifest pins
`pyth-solana-receiver-sdk = "=2.0.0"` with the `pro-compatible` feature, and
`load_push_price_update` requires `*ai.owner == PYTH_RECEIVER_ID` — the upgraded receiver
`rec2HHDD…`, alone. The error string has said `not an upgraded Pyth price update account`
since deploy. This was not luck; the program was built for the new generation before the
migration ran.

**It still works after the upgrade.** `/api/proof` reports, live: *"program 23k3…ZEEX is
executable and owns the SOL FeedClock checked now"*, and the observatory shows all seven feeds
at 100% usable over 24 hours with last publishes 36–82 s old.

**One thing is not green.** The same page reports *"5/7 sponsored accounts current · oldest
received event 263s ago"*. Two of seven are behind, and the page does not say which. That is
the open item this note leaves behind, and it is worth closing before 8 September rather than
after.

## The trap this creates for anyone verifying us

Pyth's public Solana push-feeds page currently documents the SOL/USD shard-0 account as
`7UVimf…`. **Our program requires `7AviUf9n…`.** Different account, same feed.

That is not a contradiction, it is the two generations sitting side by side: deriving
`[shard_0, feed_id]` under the v1 push oracle `pythWSnsw…` yields the documented `7UVimffx…`,
while deriving under the upgraded program yields `7AviUf9n…`, and only the second is owned by
the receiver our program accepts. We know this by having got it wrong: the 2026-08-27 mainnet
exercise derived the documented account, and simulation refused it with `BadPriceAccount` at
`lib.rs:352` before a single lamport was spent.

**So an auditor who follows Pyth's own documentation will derive the wrong account and
conclude our settlement path is broken.** Anyone checking this program before the freeze needs
to know that, which is why it is written down here rather than left as folklore.

*Caveat, stated because it belongs stated:* Pyth's docs truncate addresses, so the match above
is on the `7UVimf` prefix rather than the full string. The definitive evidence is ours — the
simulation refusal, and the live green clock on the account we do use.

## What this changes

**Nothing about 8 September.** The pin is on the upgraded receiver, the upgrade has run, and
the clock verifies. Freezing does not become riskier because of this; it becomes better
understood.

**Everything about `REFEREE_BINDING.md`.** That spec argued from first principles that a
frozen program is bounded by the lifetime of the oracles in its table. It no longer has to
argue. Inside three weeks the referee deprecated its own data source, changed its attestation
from an external guardian set to a five-key multisig, put an API key in front of its HTTP
path, and left its public documentation pointing at the previous generation's accounts. A v3
that pins one referee forever is making a bet with a known and now measurable half-life, and
the spec's conclusion — print the limit on the box, do not hide it behind an admin key — is
the right one for reasons that are now empirical.

**One thing to fix in the game's own words.** The dependency panel calls Pyth *"THE REFEREE"*
and says what happens *"IF IT STOPS"*. Stopping is not the failure mode we just watched. The
failure mode is that it *changes* — and keeps working — while the documentation describing it
goes stale. That deserves a line.

## Open

- **Which two of the seven sponsored accounts are not current**, and whether they are the same
  two an hour from now. Checkable from the proof page; not resolved here.
- **The full untruncated account list from Pyth's side**, confirmed against ours, feed by feed.
  Requires an RPC read; neither the cloud container nor the local VM can reach a Solana RPC,
  so this needs the browser.
- **When the guardian-set migration actually executes**, since the proposal deliberately
  excludes it. Worth watching, because it is the moment the referee's trust model changes for
  real rather than in principle.

## Sources

- Pyth DAO forum, `OP-PIP-131: Pyth Core Deprecation (SVM)`
- Pyth Developer Hub, Solana push feeds and Solana contract addresses
- `/api/proof` and `/api/feeds` on ratchetx.xyz, read 2026-08-28
- `onchain/ratchet-seal-v2/programs/ratchet-seal/src/lib.rs:352`, `Cargo.toml:21`
