# Review lessons

Started 2026-08-28. Every entry earned by something that actually went wrong here, with the
commit, transaction or test that proves it. A lesson with no evidence is an opinion, and a
lesson with no enforcing check is a hope — so each one names both, or says plainly that it
has neither yet.

This is not a security-audit product and does not claim to be one. It is the record of how
this codebase learned to review itself, kept in public because a mistake that stays private
gets made twice.

---

## The pattern worth naming first

On 2026-08-27 this project found and fixed six defects in one day, and it looked like the code
was right and the writing about it was wrong in five of them. A reproducible build the next
morning showed that conclusion was itself drawn too early — see entry 8 — but the pattern
survives for the rest:

- `close_shot` was documented as requiring the player's signature — accurately, for the source
  in the repository. The deployed program is permissionless. Entry 8.
- The build plan named the wrong Pyth receiver. The deployed program pinned the right one.
- Fourteen environment variables were renamed in prose by a rebrand and never in code.
- Five of nine endpoints reported a release they were not part of.
- The root README described a database the site had stopped using.

Code review here is disciplined: tests, CI, audits, a proof page that re-verifies claims on
every load. Prose review did not exist at all. The documents were treated as description and
were in fact **claims** — and unlike code, nothing ran them.

Everything below follows from that.

---

## 1 · Check what the other party actually resolves on

**What happened.** The Coinflip Ledger scored Kalshi and Polymarket against a Pyth print at
expiry. Reading their own APIs showed Kalshi settles on CF Benchmarks' Real Time Index —
*"at the last minute before expiration, 60 RTI prices are collected, the official and final
value is the average"* — and Polymarket's short-horizon series on a Chainlink 60-second TWAP,
stated as *"not according to any other sources or spot markets"*. A live page was publishing
verdicts about other companies' accuracy using a referee none of them use.

**Rule.** Before scoring anyone, read how *they* decide. A shared yardstick is defensible;
an undisclosed one is not.

**Check.** `c7efaa5` — near-strike observations now void as `inside-referee-band`, and
`/api/ledger` publishes a `referee` object naming each venue's settlement source.

## 2 · A rename follows the code or it does not happen

**What happened.** A rebrand rewrote `RATCHET_` to `RatchetX_` in prose. The code kept
reading `RATCHET_`. Ten names in `README.md`, `docs/FREEZE.md` and `docs/ONCHAIN.md`,
including the freeze document's own emergency kill switch and `RATCHET_MINT`; four more in
`mcp/README.md`, the one file whose entire job is onboarding external agents. Anyone
following our instructions configured ranked mode and silently got demo mode.

**Rule.** An environment variable named in a document is an instruction, not decoration.

**Check.** `344466f`, `1134741` — `test_kill_switch.mjs` fails if any markdown file names an
environment variable no code reads, across every documentation directory.

## 3 · A checker narrower than the thing it checks produces confident false findings

**What happened.** Widening that test's document scan without widening its code scan made it
report `RATCHET_DEMO_HANDLE` as unread — while `mcp/ratchet-mcp.mjs` reads it on line 61. The
suite went from missing real defects to inventing one, in a single edit.

**Rule.** When a checker's scope changes on one side, it changes on both. A false finding
from your own tooling costs more than the defect it replaced, because it teaches people to
distrust the tool.

**Check.** `1134741` — both scopes are declared together, adjacent, with the reason.

## 4 · Simulate before you spend

**What happened.** The mainnet exercise derived the SOL/USD Pyth account from
`[u16le(0), feed_id]` under the push oracle. Simulation returned `BadPriceAccount` at
`lib.rs:352`, the owner check. The deployed program pins Pyth's *upgraded* receiver, whose
account is the one `lib/onchain_px.js` had been reading all along. Two live accounts, same
feed, one accepted.

**Rule.** `simulateTransaction` costs nothing and runs against real chain state. Anything
that will spend runs there first, every time, including the parts you are sure about.

**Check.** `8e1c9e3` — `tools/mainnet-exercise.mjs` simulates every instruction before
sending any, and `--dry` simulates the whole run and sends nothing.

## 5 · A dry run must leave no trace

**What happened.** The dry run persisted the two shots it planned, absolute expiry timestamps
included. Minutes later the live run would have tried to seal a shot whose expiry had passed
and been refused with `ExpiryInPast` — after funding, halfway through.

**Rule.** A rehearsal that writes state is not a rehearsal. If it must plan, the plan expires
with it.

**Check.** `ee29ab2` — state writes are a no-op under `--dry`, and any planned-but-unsealed
shot whose expiry is within 30 seconds is replanned. A shot actually sealed is a fact on the
chain and is never rewritten.

## 6 · One release marker, or the deploy check is lying

**What happened.** Every endpoint carried its own hand-written version string. Five of nine
still read `h70-2026-08-25` while the site served `h73`. The check this project runs after
every deploy — `/api/game?action=board` → `v` — could not distinguish a successful deploy
from a silently failed one, which is the exact failure it exists to catch and which has
happened here.

**Rule.** Release identity is one fact. Anything that reports it reads it from one place.

**Check.** `843426a` — `lib/release.js`, and `test_release_identity.mjs` fails if an endpoint
declares a release-shaped string of its own. Instrument versions (`ldg3`, `log2`) are a
different axis and are named as an explicit exception rather than left as a loophole.

## 7 · Derived numbers roll with the rule that produced them

**What happened.** Adding the referee band changed how an observation resolves. Scores, the
recent list and the drop counters had all been computed under the previous rule.

**Rule.** When a rule changes, everything derived from it rolls; everything that is raw
evidence does not. `ldg3:score`, `ldg3:recent` and `ldg4:dropped` rolled. `ldg2:open` did not,
because *"this venue priced this question at p at that time"* is true under either rule and
rolling it would discard the only thing that was never in doubt.

**Check.** None automated. The enforcement is the namespace convention and this entry.
Naming that gap is the honest version.

## 8 · Which source? A build is the only thing that answers that

**What happened.** `docs/FREEZE.md` claimed v2 had no permissionless close. Reading
`ratchet_phase_a_work` showed `cranker: Signer` with `player: UncheckedAccount` — anyone may
close — so on 2026-08-27 the page was corrected and the correction was proven on-chain: a
voided shot was cranked closed and both Shot PDAs read back as gone.

The next morning the reproducible build showed why that had been confusing. The source
**published in this repository** builds to `b1240659…`, not to the deployed `22ba4d21…`, and
the difference is three lines:

```rust
// what the repository published          // what is actually deployed
pub player: Signer<'info>,                pub player: UncheckedAccount<'info>,
```

The document was not careless. It was accurate about the source in the repository. Two
sources disagreed, the public one was never deployed, and **reading either file alone could
never have revealed that** — the earlier entry here confidently blamed the prose because the
prose was the only thing it had checked.

**Rule.** "The source says X" is incomplete until you say *which* source, and only a build
that reproduces the deployed hash settles it. A repository that publishes source it never
deployed is worse than one that publishes none, because the difference is invisible and the
claim is louder.

**Check.** `2026-08-28` — the repository now carries the source that built the deployed
bytes and the `Cargo.lock` that pins them, and `docs/FREEZE.md` records the recipe and the
three matching hashes. The permanent check is the rebuild itself: it is the only test in this
codebase that can fail for this reason, and it did, on its first run.

## 9 · Split a claim until each half is separately provable

**What happened.** "The deployed program matches our source" is two claims. That the deployed
bytes equal the artifact we hold needed no rebuild and no key: strip the 45-byte loader
header from ProgramData, hash the remaining 252,544 bytes, compare. It took minutes. That the
artifact is what the source compiles to needs a reproducible build under Docker and is still
open.

**Rule.** A compound claim is published as its parts, and the unproven part stays visibly
unproven. Half a proof stated exactly beats a whole one stated loosely.

**Check.** `0bdee61` — the hash and the split are both recorded in `docs/FREEZE.md`.

## 10 · A word means one thing per page

**What happened.** `/api/proof` showed a green line reading "Freeze authority revoked" on a
page counting down to a program freeze. It was true — the SPL freeze authority on the token —
and it read as though the ceremony had already happened.

**Rule.** On a page making a specific promise, a word that also means something else is
ambiguous even when every individual sentence is correct.

**Check.** `4f1ed11` — both token lines are named as token lines, and the real claim became a
live check that compares ProgramData bytes and turns green by itself when the authority is
actually revoked.

## 11 · "We accept what the program accepts" is a claim, and it was false

**What happened.** `lib/onchain_px.js` accepts four Pyth program generations as valid owners
of a price account — receiver v1, push oracle v1, receiver v2, price feed v2 — and its comment
justified that by saying the on-chain program accepts both generations too. It does not.
`load_push_price_update` contains exactly one owner comparison in the whole program,
`*ai.owner == PYTH_RECEIVER_ID`, and that constant is receiver v2 alone. Everything else is
`BadPriceAccount`.

Nothing was unsafe — the program is the stricter of the two, which is the correct direction —
but the server can display and reason about a price the chain would refuse to settle on, and
the comment told the next reader the opposite. After 2026-09-08 the program's side of that
gap can never be widened.

The same check also derives the account address from `PYTH_PUSH_ORACLE_ID` while requiring
ownership by the *receiver*. Two different Pyth ids, two different jobs, one function. Swapping
them yields a valid-looking account that the program rejects, which is exactly what the mainnet
exercise hit in simulation (entry 4).

**Rule.** A comment that asserts agreement between two components is a claim about both, and
it decays silently because only one of them is under test. State what *this* side does, and
name the divergence rather than the imagined agreement.

**Check.** The comment now states the divergence and quotes the single owner comparison.
No automated check yet: asserting a Rust constant from a Node test needs a parser or a
generated constants file, and inventing one to enforce a comment would be the tail wagging the
dog. Named here as the gap it is.

**Second-order finding.** Pyth has shipped at least four program identities that own live
price accounts. A frozen program pinning one of them is bounded by that one's lifetime — which
turned `docs/REFEREE_BINDING.md` from an argument into an observation.

## 12 · A check that is amber in normal operation is worse than no check

**What happened.** `/api/proof` had been reporting *"Pyth transition stream is
partially live · 5/7 sponsored accounts current"*. Sampled five times, the laggards
rotated — WIF+PUMP, then PUMP alone, then BONK+JUP — while SOL and BTC were never
behind. The first read was "thin feeds are slow, harmless"; the second sample killed
it, because their `publishTime` had not moved at all while their age climbed by
exactly the elapsed time.

Then sampling `stream-health` and `/api/feeds` together, at the same moment:

```
feed   stream gap   account's own last publish (minute polling)
JUP        323s                 80s
WIF        197s                120s
```

The accounts were being written throughout. **Our capture stream was missing the
notifications**, and the check had spent that whole time saying "sponsored accounts",
pointing at the oracle for a defect of ours.

**Rule.** Grade a check against the bound that would change an outcome, not against
what the fastest case happens to do. Amber must mean *a player could notice*; an
amber that is always on gets ignored, and then it is not a check. And a check names
the component it actually measures.

**Check.** `streamHealth` now reports two tiers — freshness, and usability defined as
`SETTLE_GRACE` itself rather than a second hand-tuned constant — the page names the
feeds it is missing, and when minute polling is current while the stream is not it
says outright that these are notifications this service did not receive.

## 13 · Scan both directions, or the switch nobody wrote down stays invisible

**What happened.** Entry 2 built a scan for documents naming variables the code does
not read. The reverse was never checked. `ops/heartbeat-worker/worker.js` reads
`env.SOLANA_WS` to pick the websocket it subscribes on, and unset it falls back to
three **public** Solana RPCs — which throttle and silently drop `accountSubscribe`
notifications, the mechanism behind entry 12. No document mentioned the variable, so
nobody could know the knob existed. Seven other variables were in the same state,
including the production store credentials.

Two structural reasons it hid so well: Cloudflare Workers take configuration off an
`env` argument rather than `process.env`, so the worker's entire config surface was
invisible to a `process.env` pattern; and `ops/heartbeat-worker/README.md` sits one
directory deeper than any scan reached.

**Rule.** Configuration is a claim in both directions. Every variable a document names
must exist in code, *and* every variable code reads must appear in a document — because
an unset one fails silently and a switch nobody wrote down is a switch nobody can check.

**Check.** `test_kill_switch.mjs` now runs both scans, reads `env.NAME` inside `ops/`,
and reaches `ops/heartbeat-worker/`. 106 checks, 29 code-read variables verified against
the docs. `HOME` is the single exemption and is named rather than pattern-matched, so a
second one has to be deliberate. The reverse scan earned its keep immediately: on its
first run it reported `TARGET` as undocumented while `TARGET` sat in a table in the
worker README — the document scan was shallower than the code scan, which is entry 3 for
the third time.

---

## Already documented elsewhere, not restated here

- **`jsonb` does not preserve object key order**, so hashing `JSON.stringify` output makes a
  chain unverifiable after any database migration. Hash the value, never the serialization.
  `docs/CHAIN_GAP.md`, `lib/canon.js`.
- **Do not measure elapsed time in a test; count operations.** Wall-clock assertions passed in
  CI and failed on a real machine.
- **Assert the invariant, not the mechanism.** A test that treated a `409` as proof of
  double-spend protection broke when the mechanism was fixed, though the invariant held.
  `docs/CRITICAL_PATHS.md`.
- **Platform limits fail silently.** A third Vercel cron on a two-cron plan invalidated the
  build config; the push succeeded and the site simply stayed old.

## How an entry gets added

1. Something goes wrong, in this codebase, demonstrably.
2. The rule is written as an imperative someone could follow without knowing the story.
3. The evidence is a commit, a transaction signature or a failing-then-passing test.
4. A check is added that would have caught it — or the absence of one is stated.
5. No entry is added for something that was merely worried about.
