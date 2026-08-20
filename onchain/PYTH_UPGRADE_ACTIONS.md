# Pyth answered — and flagged a dated production risk

Their reply to our forum post confirmed the design, corrected two things, and revealed one item
that has a deadline on it. In order of urgency.

---

## ⚠ 1 · THE LIVE GAME LOSES ITS PRICE SOURCE ON 26 AUGUST, 16:00 UTC

**"Every Core user will need an API Key"** after **2026-08-26 16:00 UTC** — the Pyth Core upgrade.

`lib/prices.js` calls `hermes.pyth.network` with no key. After the cutover that call fails, and the
game silently drops to the Coinbase fallback, which covers **only SOL, BTC and ETH**. Consequences,
all of them bad and none of them loud:

- BONK, WIF, JUP and PUMP vanish from the board — those targets are filtered out when their price is
  missing, so THE BOARD quietly shrinks from nine questions to a handful
- "settles on real Pyth oracle prices" stops being true while the page keeps saying it
- worst of all, a shot **sealed** on Pyth could **settle** on Coinbase — breaking the one promise
  that has to hold: same source at seal and at settle

**Fixed in code, needs one action from you:**

- `lib/prices.js` now sends `Authorization: Bearer $PYTH_API_KEY` whenever `PYTH_API_KEY` is set,
  and `PYTH_HERMES_URL` can point at the upgraded endpoint. Nothing changes until you set them.
- A 401/403 from Hermes now produces an explicit error naming the upgrade and the missing key,
  instead of a bare status code.
- If it ever does fall back, `prices.degraded` is returned in the state and the site shows a banner:
  **ORACLE DEGRADED — running on the fallback price source, not Pyth.** Falling back is acceptable;
  falling back invisibly is not.

**Your action: get a Pyth API key before 26 August 16:00 UTC and set `PYTH_API_KEY` in Vercel.**
That is the whole fix. Do it this week — the cutover is the same day as the Belgrade summit.

---

## 2 · The program was pointing at the legacy Pyth addresses

Pyth: *"For a new Solana deployment, please use upgraded Pyth Core with the Pro-compatible receiver
rather than the legacy receiver or push-oracle addresses."*

| | legacy (what we had) | upgraded Pyth Core |
|---|---|---|
| Solana receiver | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` | `rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp` |
| Price feed program | `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` | `pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou` |

The same addresses are used across SVM networks. `ratchet_seal` now accepts **both generations** in
its owner check, so it works either side of the cutover and can still read an account posted before
it.

Because the price-feed program ID changes, every sponsored **feed account address changes too** —
derived offline, shard 0:

| feed | legacy account | upgraded account |
|---|---|---|
| SOL/USD | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` | `7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE` |
| BTC/USD | `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo` | `APgzQGGdv2qCgBkX6aHVkrGePtBVDDg68GiqaM7rmtf5` |
| ETH/USD | `42amVS4KgzR9rA28tkVYqVXjq9Qa8dcZQMbH5EYFX6XC` | `7odryi4WfoMFHtv2eubdMgP1pqQMmdiXSK1N2tqZ2nRH` |

Verify these against Pyth's upgrade documentation before relying on them.

---

## 3 · They endorsed the first-crossing rule — and killed our fallback

*"For a deterministic first-crossing rule, accept only `prev_publish_time < expiry <= publish_time`."*
That is exactly what v1 does. Confirmed by the oracle itself.

But: *"Treat `prev_publish_time == publish_time` or a missing crossing update as
non-strict/unresolvable; do not let a late cranker choose an arbitrary price if fairness is
required."*

Our v1 had a one-hour fallback that let anyone settle on **any** update after expiry — precisely the
thing they warn against. **Removed.** There is now no permissive path: settling requires the crossing
update, and a shot nobody settles strictly is **voided** after an hour with the stake returned. No
outcome is invented, by anyone, ever. An explicit `prev_publish_time < publish_time` guard was added
for the equal case.

---

## 4 · Two open items

- **Ephemeral accounts.** *"Use an ephemeral PriceUpdateV2 account populated from the upgraded Hermes
  endpoint."* This is the intended settlement path and answers our question directly — the cranker
  posts the crossing update rather than reading whatever the sponsored account happens to hold. It
  needs a client helper, which is the next piece of work.
- **SDK vs hand-rolled.** They called our validation *"sound"* but recommend importing
  `PriceUpdateV2` from the latest `pyth-solana-receiver-sdk` with the `pro-compatible` feature rather
  than duplicating the layout. That trades our zero-dependency property for protection against layout
  drift — a real risk right as they upgrade. Worth deciding deliberately rather than by default;
  accepting both owner generations buys us time either way.
- **Staleness.** *"The sponsored-feed heartbeat is an update target, not a hard freshness guarantee."*
  So our 60-second bound stays an application policy. It was already ours; now we know it has to be.
