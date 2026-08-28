# Ratchet sampler heartbeat

This Cloudflare Worker does two jobs, and until 2026-08-28 this file described
only the first.

1. **Heartbeat.** Wakes the production settlement sampler once per minute,
   replacing the laptop `heartbeat.mjs` process as the availability mechanism.
2. **Account-transition stream.** Opens a Solana websocket, subscribes to all
   seven sponsored Pyth price accounts, and posts every verified transition to
   `/api/game`. This is the path that produces exact first-crossing evidence;
   minute polling is the independent fallback underneath it.

Sessions last 85 seconds against a once-per-minute cron, so consecutive
sessions overlap by roughly 25 seconds rather than leaving a gap.

The target endpoint is idempotent: the application uses a database lease and
minute throttle, so a retry or duplicate cron does not create duplicate samples.

## Deploy

1. Sign into the intended Cloudflare account.
2. From this directory run npx wrangler deploy.
3. In Workers & Pages, confirm the once-per-minute Cron Trigger is active.
4. Watch /api/proof: the sampler check should reach at least 90% over the
   rolling hour and remain fresh within 120 seconds.
5. Stop the laptop heartbeat. It is only a local fallback.

Cloudflare Workers Free currently permits five Cron Triggers and 100,000
requests/day. This worker makes about 1,440 requests/day.

## Configuration

Set these as Worker secrets/variables. None of them were written down before
2026-08-28, which is how the one that matters stayed invisible.

| variable | required | what it does |
|---|---|---|
| `CAPTURE_SECRET` | yes | bearer token for `POST /api/game` capture. Without it the stream half does not run at all and reports `CAPTURE_SECRET missing`. |
| `SOLANA_WS` | **effectively yes** | the websocket endpoint to subscribe on. Unset, the worker falls back to three **public** RPCs: `api.mainnet-beta.solana.com`, `solana-rpc.publicnode.com`, `solana.drpc.org`. |
| `TARGET` | no | overrides the `https://ratchetx.xyz/api/game` endpoint. Useful for staging. |

### Why `SOLANA_WS` is not optional in practice

Measured on 2026-08-28, sampling `/api/game?action=stream-health` and
`/api/feeds` at the same moment:

```
feed   stream gap   account's own last publish (minute polling)
JUP        323s                 80s
WIF        197s                120s
```

The accounts were being written the whole time; the stream had not received
those notifications. Across five samples the affected feeds rotated — WIF+PUMP,
then PUMP alone, then BONK+JUP — while SOL and BTC were never behind, because
they publish often enough that a missed notification is replaced seconds later.
A thin feed shows the same miss as a five-minute hole.

Public Solana RPC websockets throttle and silently drop `accountSubscribe`
notifications under load, and by default this worker is running on three of
them. Pointing `SOLANA_WS` at the same private endpoint `SOLANA_RPC` already
uses is the first thing to try. `lib/onchain_px.js` says of its HTTP twin that
it "is one env var and it is the difference between *works* and *works under
load*"; the websocket has the same property and nobody had written it down.

This is not proven to be the cause — it is the leading suspect with a cheap
test. Set it, then watch `/api/proof`: the stream check names the feeds it is
missing and says whether minute polling is still current.

### Settlement is not at risk while this is broken

The frozen Seal v2 program has no staleness bound — only
`prev_publish_time < publish_time`, a confidence bound, and
`publish_time <= expiry + SETTLE_GRACE` — and minute polling writes the same
evidence log by an independent path. A dropped notification costs precision in
the first-crossing record, not a player's shot. It is still worth fixing:
losing events on one of two independent paths is fine exactly until the other
one hiccups.