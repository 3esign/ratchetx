# h113 - keyless board truth and reconnect recovery

Date: 2026-09-03

Status: release candidate until the cache-busted production readback below is
complete. The candidate commit is the commit containing this manifest.

## Product result

- The canonical price runtime has no `PYTH_API_KEY`, authenticated Hermes
  route, or secret switch that can add an economic feed.
- Stocks are held, not disguised as an hourly outage. The server publishes no
  stock slots; the Bankr runner still recognizes stock names only to refuse
  them without substitution, journal creation, dispatch, debit, or allowance
  use.
- State and machine boards expose only targets that already satisfy the final
  Pyth-on-Solana source, age, confidence, and crossing-metadata predicate.
  Coinbase remains a labeled display-only fallback.
- A board-to-seal oracle race returns terminal `409 FEED_UNAVAILABLE` before
  debit instead of stranding a Bankr reservation behind a 5xx.
- The client waits 20 seconds before aborting a state read, reports reconnecting
  only after two real transport/server failures, and does not count
  `PLAYER_BUSY` or `429` as an outage. Server-directed rate-limit cooldowns
  fence every poller.
- Expired-card settlement refresh pressure is capped at one request per three
  seconds.
- Skill `1.6.1` pins the exact SHA-256 of both installed runner scripts and
  uses the Bankr skill-folder update URL.

The 20-second value is a browser patience budget, not a claimed server ceiling.
A browser abort does not prove that the server invocation stopped.

## Compatibility

h112 consumed four RNG draws while shuffling dormant stock slots before
constructing THE BOX. h113 consumes the same four draws without publishing
stocks, so every existing `H{hour}B` identifier retains the same feed and
threshold across deployment and the previous-hour grace window.

## Release gates

- Focused oracle, Bankr, authenticated session, harness, and evidence batches.
- `npm test` on the exact candidate in a clean detached worktree.
- GitHub Actions on the exact non-main candidate SHA.
- Fast-forward that same SHA to `main`; Git integration deploys production.

## Required production readback

- `/api/game?action=board`: `v=h113-2026-09-03`,
  `generator=v3-keyless-hourly`, `prices.src=pyth-onchain`, seven crypto
  directionals, PUMP present, no stock targets, keyless equity hold stated.
- `/skills/ratchetx/SKILL.md`: version `1.6.1`, CORS enabled, API-keyless
  stock hold, correct folder update URL, declared runner hashes equal served
  bytes.
- Live HTML contains the 20-second budget, second-failure banner threshold,
  three-second settlement throttle, and refresh cooldown fence.
- Raw GitHub and production bytes match for the skill and runner.
- Scratch/canary paths remain unavailable.

Bankr installation is a separate state boundary. Publication does not prove a
per-wallet Bankr copy updated; do not claim the bot is current until its
installed version and script hashes are read back from an authenticated Bankr
account.
