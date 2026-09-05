# The site, version 2

Owner's brief, 2026-09-05: the site is part of the mainnet goal. It must be
rebuilt around what the game now actually is, at least twice as detailed as what
we have, with careful transaction views and links. It should read as an elegant
little game — serious unserious fun. **Order: mainnet ready first, then the site,
then live.**

This document is the specification. It is not a mockup and not a wish list. Every
field named here exists in source at the path given, and a builder who cannot
find a field here does not invent one — a field that does not exist is not
displayed and not filled with a placeholder that looks like data.

---

## 1. What the site is actually rendering now

The old site rendered a server's opinion. `index.html:921` still reads
`const API='/api/game'`, and `lib/record.js` schema 4 states its own
`settlementAuthority` as `ratchet-server`. That is a record of what our server
decided. It is honest as that and it is not chain evidence.

The new site renders **one account**: `Shot`, in
`onchain/ratchet-core-g2/programs/ratchet-core-g2/src/state.rs:225`, `LEN = 772`.
That account already carries the entire story of a game, and this is the whole
reason the site can be twice as detailed without inventing anything:

| what the player sees | field |
|---|---|
| who played | `player`, `delegate` |
| which economy and rules | `economy_hash`, `ruleset_hash` |
| the sealed guess | `commit`, `nonce`, `sealed_ts`, `revealed_salt` |
| the two moments in time | `entry_target_ts`, `exit_target_ts` |
| the two prices | `entry_price` / `entry_conf` / `entry_exponent` / `entry_publish_time`, and the same four for `exit_` |
| where each price came from | `entry_need`, `exit_need`, `entry_message_hash`, `exit_message_hash` |
| what Timepin certified | `entry_timepin_result_hash`, `exit_timepin_result_hash` |
| the call and the confidence | `side`, `p_bps` |
| the outcome | `outcome_yes`, `hit`, `xp_awarded` |
| who settled it and when | `resolver`, `settled_ts`, `resolution_slot`, `activation_worker`, `activation_slot` |
| why, if it did not resolve | `state`, `void_reason` |
| the seals | `resolution_hash`, `terminal_hash` |

Nothing in that table is a server field. A page built on it can be checked by a
stranger with an RPC endpoint and no access to us, which is the bar set in
ROOM.md on 2026-09-05 and the bar every screen below is measured against.

## 2. The two enums, spelled out in words

`ShotState` (state.rs:531) and `VoidReason` (state.rs:542) are the only sources
for "what happened". The site must map every value. **There is no default arm**:
an unknown value renders as `unknown state <n>`, never as a friendly guess.

ShotState: `1 PendingEntry`, `2 Active`, `3 AwaitReveal`, `4 Revealed`,
`5 Voided`, `6 Forfeited`, `7 AwaitVoid`.

VoidReason: `0 None`, `1 EntryExpired`, `2 EntryAmbiguous`, `3 ExitExpired`,
`4 ExitAmbiguous`, `5 Equality`, `6 ConfidenceBand`.

### The one plain sentence (the owner's second UX item)

Every result carries one sentence a person can read without knowing anything.
It is built from the fields above and from nothing else:

- `Revealed`, `hit = 1` — "You said {UP|DOWN} on {feed} between {entry time} and
  {exit time}. It went from {entry price} to {exit price}. You were right."
- `Revealed`, `hit = 0` — the same sentence ending "You were wrong."
- `Voided`, `Equality` — "The price at the end was exactly the price at the
  start, to the last decimal. Nobody was right, so the shot was returned."
- `Voided`, `ConfidenceBand` — "The oracle's own error bar was wider than the
  move, so the chain refused to call it. Your shot was returned."
- `Voided`, `EntryExpired` / `ExitExpired` — "No oracle print arrived in time for
  the {start|end} of your window, so there is no price to settle against. Your
  shot was returned."
- `Voided`, `EntryAmbiguous` / `ExitAmbiguous` — these are **not reachable** in
  the current program: MIN-CAPTURE orders candidates by
  `(publish_time, posted_slot, message_hash)`, which is total, so there is always
  exactly one minimum. If one of these ever appears on chain, the site says so
  loudly rather than explaining it away: "This shot reports a state the current
  rules cannot produce. Please report it." That sentence is a bug report, and it
  is better than a sentence that soothes.
- `Forfeited` — "The guess was never revealed before {reveal_deadline_ts}, so it
  was forfeited."
- `PendingEntry` / `Active` / `AwaitReveal` / `AwaitVoid` — say what is being
  waited for and until when, from `entry_target_ts`, `exit_target_ts`,
  `reveal_deadline_ts`. Never a spinner with no deadline.

Prices are rendered from `price` and `exponent` together (`price × 10^exponent`),
never from `price` alone. `conf` is shown next to each price, in the same units,
because `ConfidenceBand` is a real outcome and a player who has never seen the
error bar cannot understand the one day it decides their game.

## 3. Save the game (the owner's first UX item)

Beside "Share proof", a download. The file is not a screenshot and not a copy of
our server's record. It is the tuple a stranger re-verifies with:

    core program id, timepin program id, cluster genesis hash,
    economy_hash, ruleset_hash,
    shot PDA, player, nonce, commit, revealed_salt,
    entry_target_ts, exit_target_ts,
    entry_need, exit_need, entry_message_hash, exit_message_hash,
    entry_timepin_result_hash, exit_timepin_result_hash,
    entry_price/conf/exponent/publish_time, exit_price/conf/exponent/publish_time,
    side, p_bps, state, void_reason, outcome_yes, hit, xp_awarded,
    resolver, settled_ts, resolution_slot,
    resolution_hash, terminal_hash

The file carries, in plain text at the top, **the command that checks it** and
the name of the cluster it was read from. A saved game that does not say which
chain it came from is worth nothing, and a saved game with a field we filled in
ourselves is worse than nothing.

`api/record.js` schema 4 must not be labelled chain-verified anywhere on the
page, in the file, or in a tooltip. If both exist on a screen they are two
separate blocks with two separate headings: what the chain says, and what our
server recorded.

## 4. Links

Every hash and address on the page is a link, and every link states the cluster.

- program ids → explorer, both Core and Timepin
- the shot PDA → explorer account view
- `entry_need` / `exit_need` → explorer, and this is the pair that makes the
  price checkable by hand
- transaction signatures → explorer, labelled by what they did: sealed,
  activated, settled, revealed
- `$RCX` mint → explorer

Explorer URLs carry an explicit cluster query on devnet; on mainnet they carry
none. A link with the wrong cluster is a false claim, so the cluster comes from
the same genesis-hash check `ops/g2-crank/cluster.mjs` performs, never from a
build-time constant somebody can forget to change.

## 5. Screens

1. **The board** — the seven feeds, the live target grid at 300 seconds, what is
   openable right now and for how long. The grid is a fact of the economy
   (`releases/g2-mainnet-economy.json`), not a decoration.
2. **The shot** — the full Shot account, laid out as section 1's table, in
   sections: the seal, the two windows, the two prices, the call, the outcome,
   the seals. Collapsed by default to the plain sentence, expandable to every
   field, with the raw account bytes available at the bottom for the people who
   will check them.
3. **Your chambers** — open shots with their deadlines, from
   `entry_target_ts` / `exit_target_ts` / `reveal_deadline_ts`.
4. **The feed** — settled shots as they land, each one a link to screen 2.
5. **How it works** — the rules as the program enforces them, including
   MIN-CAPTURE in one paragraph and `lag < grid` in one sentence, both with the
   source path. This is the page that makes the game feel serious; it is not
   marketing copy.

## 6. What the site must never do

- Never show a number the chain did not produce, styled the way chain numbers
  are styled.
- Never poll. The outage of 2026-09-05 was five API calls per minute per tab —
  roughly twenty-three tab-days against a 500,000-call allowance — and the retry
  doubled the burn. Reads are on demand, on visibility, and backed off.
- Never claim a shot is verified because our server says it settled.
- Never render a state it does not have a written arm for.

## 7. Sequencing

The owner set the order and it is not negotiable: **mainnet ready, then the site,
then live.** Site work does not consume anyone on the mainnet critical path
(B1, B2, L1, L2). It is specified now so that it is buildable the moment those
close, and so that it is built against the chain rather than against the server
it is replacing.
