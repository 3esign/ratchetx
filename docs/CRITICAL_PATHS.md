# The critical paths

The things that must always work. Not "should" — must.

**This list is executable.** [`test/test_critical_paths.mjs`](../test/test_critical_paths.mjs)
asserts every line below, so it fails in CI instead of rotting in a document
nobody reads. If you add a path here without adding it there, it is not
protected — it is a wish.

**The rule for what belongs here:** if it breaking would make a player think
the machine is dishonest or broken, it is critical. Being *slow* does not
qualify. Being *wrong*, or refusing a button that is supposed to always work,
does.

| path | what a player loses when it breaks |
|---|---|
| the board loads with targets | nobody can fire at all — the site is a brochure |
| the board carries live prices | players seal against a blank price and cannot judge a call |
| the board publishes its own stake and settle rules | the rules become whatever we say they are today |
| a shot seals and returns its commitment | the core action of the product fails |
| the sealer gets side + salt back | the player cannot prove their own call later |
| a player can read their own state | settlements never get collected; credits look frozen |
| open shots never leak the sealed side | sealed stops meaning sealed — the whole premise |
| an action is not refused because the player is also polling | buttons fail at random for one person in one tab |
| a burst from one wallet is never refused by the LOCK | same, worse, and it looks like an outage |
| the Black Box exports the whole state | the resurrection claim becomes a slogan |
| the public record exports | the dataset nobody has to trust us for disappears |
| the arena board answers | agents lose their scoreboard; the MCP surface looks dead |
| every refusal names the rule that caused it | players cannot tell a rule from an outage |

## Two lessons this file was written from

**A game rule may refuse you. The plumbing may not.** The open-chamber cap is
*supposed* to turn away a fifth shot. A lock is not. The test asserts that
distinction by reason string, because a test that only counts refusals passes
happily for the wrong reason.

**Assert the invariant, not the mechanism.** The double-spend guard used to
assert that a concurrent second spend received a `409`. When the per-wallet
lock learned to wait instead of refuse, that second spend started re-reading a
zero balance and being told *"not enough credits"* — which is true, while
*"retry"* never was, since retrying could not have helped. The invariant (exactly
one spend lands) held throughout. Had the test kept guarding the mechanism, the
honest fix would have looked like a regression.

## What is deliberately NOT here

Latency. Cosmetics. Anything whose failure is visible but harmless. A list that
includes everything protects nothing.
