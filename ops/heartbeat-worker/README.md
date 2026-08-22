# Ratchet sampler heartbeat

This Cloudflare Worker wakes the production settlement sampler once per minute.
It replaces the laptop heartbeat.mjs process as the availability mechanism.

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