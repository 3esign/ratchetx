# LAUNCH DAY - PUMP.FUN (operator's venue choice, 2026-08-19)

Do this after the game is live and the API banner is gone. ~15 minutes, no code.

## Before you start
- [ ] Game live at ratchetx.vercel.app with the API working (no orange banner)
- [ ] You are on the machine with YOUR wallet (Phantom) holding a little SOL
- [ ] logo.png from this folder saved somewhere easy to find

## The steps
1. Go to **pump.fun** -> "Create coin". Connect wallet
   **HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM** - this wallet becomes the creator
   and receives the creator fee share on trading volume. Launch from no other wallet.
2. Fill the form:
   - Name: **Ratchet**   Ticker: **RATCHET**
   - Image: **logo.png**
   - Description: from metadata.json
   - Website: **https://ratchetx.vercel.app**  (the token is born pointing at a working game)
3. Optional dev buy: your call. Zero is a clean screenshot; small is fine. Never large.
4. Launch and sign. **Copy the mint address (the CA).**
5. Turn on real burns - NO script needed with the GitHub flow:
   Vercel dashboard -> ratchetx project -> Settings -> Environment Variables ->
   Add: name **RATCHET_MINT**, value = the CA, environment Production -> Save ->
   Deployments tab -> ... menu on the latest -> Redeploy.
6. Do the ceremonial FIRST BURN: send a small amount of RATCHET from your wallet to the
   incinerator (address shown in the game's RELOAD panel), paste the signature, watch it
   appear in the kill feed with a tx link. Screenshot that.
7. Anchor the log once (PROOF page, ANCHOR button). Now announce:
   "The floor only goes up. Everything else is sealed until it's over.
    Utility live at TGE - burn to play right now. [site] [CA]"

## Fees - how you get paid
Creator fee share accrues automatically on pump.fun (and PumpSwap after graduation,
~0.05% of volume in SOL). Claim it on pump.fun from the creator wallet whenever you
like. The game never touches that money. Exact percentages are pump.fun's to change -
the site UI at launch time is the source of truth.

## Never
- Never share the wallet's seed phrase or private key with anyone or any tool.
- Never quietly change the game's split (70/30/0) after publishing. The split is the product.
