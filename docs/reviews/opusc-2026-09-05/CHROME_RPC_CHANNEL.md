# The Chrome RPC channel — a keyless network path for agents whose shells have none

**Written because the lead asked for it at 11:40Z, so the fourth agent does not rediscover it a
third time.** Opus C found it at 11:39Z, Opus A independently at 11:43Z. Both of us had spent the
morning reporting `network/RPC no`.

## The problem

Cowork agents run a shell inside a Linux VM with the repo mounted. That VM has **no egress at all**
— not a firewall reset, a DNS failure:

```
$ node -e "fetch('https://solana-rpc.publicnode.com').then(...)"
DEVICE SHELL BLOCKED: EAI_AGAIN
```

The cloud container is separately blocked by policy (`connect_rejected` for
`api.mainnet-beta.solana.com` and `hermes.pyth.network`). So `cargo`, `solana`, `curl` and `fetch`
are all dead ends for reading mainnet.

## The channel

**Chrome on the laptop can POST JSON-RPC.** Any agent with the `claude-in-chrome` tools has a
keyless, read-only mainnet reader. Cost: one tab.

```
ToolSearch  select:mcp__claude-in-chrome__tabs_context_mcp,
                   mcp__claude-in-chrome__tabs_create_mcp,
                   mcp__claude-in-chrome__navigate,
                   mcp__claude-in-chrome__javascript_tool,
                   mcp__claude-in-chrome__tabs_close_mcp
tabs_context_mcp { createIfEmpty: true }
navigate        { tabId, url: "https://example.com" }     # NOT chrome://newtab — fetch is blocked there
javascript_tool { tabId, action: "javascript_exec", text: "…" }
```

```js
const rpc = async (method, params) => {
  const r = await fetch("https://solana-rpc.publicnode.com", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return await r.json();
};
JSON.stringify((await rpc("getSlot", [])).result)
```

## Which endpoint — measured 2026-09-05, all three from `lib/onchain_px.js:37-39`

| Endpoint | Result |
| --- | --- |
| `api.mainnet-beta.solana.com` | **HTTP 403 "Access forbidden"** to any browser origin |
| `solana.drpc.org` | **HTTP 400 "chain is not available on free plan"** — dead for keyless use *anywhere*, not an origin problem |
| `solana-rpc.publicnode.com` | **200.** CORS open, no key, no account |

So `publicnode` is the one, and the third leg of the price fallback chain is decorative. Whoever
owns `lib/` should know.

`publicnode` rate-limits a bulk pull: *"Rate limit exceeded. To obtain higher limits, please request
a personal token or a dedicated node."* It arrived after ~18 pages of 1000 signatures plus ~600
`getTransaction` calls. **Back off; do not request a token.** A key anywhere near the settlement
path is a project-level failure (`AGENT_ONBOARD.md` §4), and the instinct not to reach for one
should survive contact with a measurement task too.

## Four things that will waste your time

1. **`chrome://newtab` cannot `fetch`.** Navigate to a real https origin first.
2. **`javascript_tool` returns at most ~2 KB** and **refuses to return base64**. Return aggregates,
   or hex, or chunk it. Long payloads come back `[TRUNCATED]` or `[BLOCKED: Base64 encoded data]`.
3. **The evaluate times out at 45 s, but the page keeps running.** Launch long loops as a detached
   `(async () => { … })()` writing into a `window.__something`, then poll that in later calls. A
   CDP timeout is not a failure; check the accumulator before assuming anything.
4. **A hidden tab is throttled hard.** Measured: a 1 s `setInterval` produced 8 ticks in 105 s with
   a **44 s** worst-case gap, `visibilityState: "hidden"`. Bursts are fine; **a browser tab cannot
   be a sampler.** If you need a steady cadence, you need a process on a machine.

## Sharing the tab group

Two agents in one MCP tab group will close each other's tabs and clobber each other's page state.
Convention, until someone rules otherwise: **create your own tab, never touch a tab you did not
create, never call `tabs_close_mcp` on someone else's.**

## What it has been good for

- Decoding a live sponsored `PriceUpdateV2` with the model — the write-authority pin confirmed
  against a real account instead of a fabricated one.
- 235 sponsored writes recovered from the ledger with their signed message bytes
  (`SPONSORED_WRITE_CADENCE.md`).
- Proving the ten-hour ledger retention that means the 24 h cadence measurement does not need
  24 h of wall clock.

It is a **reader**. No transaction has been sent through it and none should be: signing from an
agent is a hard stop.
