# Post-launch identity and DEX readiness — RatchetX / RCX

The token is already live. This replaces the obsolete pre-launch form checklist so nobody
accidentally publishes the old `Ratchet` / `RATCHET` identity.

## Frozen identity

- Name: **RatchetX**
- Symbol: **RCX**
- Mint: `FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump`
- PumpSwap pair: `3gbSEBMBbfqrC7wT7craJNkUhxNTBFyNjhrmedcHJusV`
- Website: `https://ratchetx.xyz`
- Creator-fee wallet: `HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM`
- Image: `logo.png` (512 × 512)

## Before paying for a DEX profile

- [ ] `ratchetx.xyz` and `www.ratchetx.xyz` are attached in Vercel, HTTPS is issued, and
      one hostname redirects permanently to the canonical one.
- [ ] Production `PUBLIC_ORIGIN=https://ratchetx.xyz` is set.
- [ ] `/api/game?action=state`, `/api/feeds`, `/api/supply`, `/api/record`, social preview,
      and a wallet connect/fire flow are checked on the custom domain.
- [ ] The real X/Twitter URL is chosen. Do not publish a placeholder or invent a handle.
- [ ] DEX Screener still shows the mint and pair above; paste values from this file, not
      from memory.
- [ ] The profile uses **RatchetX / RCX** and the exact description in `metadata.json`.
- [ ] Save screenshots and the payment receipt; recheck the listing after processing.

DEX Screener automatically indexes a token after it has a pool and at least one transaction.
Its paid Enhanced Token Info product changes presentation/metadata, not the contract or
liquidity. Verify the current price and requirements in the DEX Screener marketplace at the
time of purchase; those terms are not frozen in this repository.

## Never

- Never share the creator wallet seed phrase or private key with a site, tool, or contractor.
- Never pay until the custom domain and actual social link are live.
- Never describe credits as cash, income, or redeemable token rewards.
- Never quietly change the published 70% burn / 30% player-pots / 0% team split.
