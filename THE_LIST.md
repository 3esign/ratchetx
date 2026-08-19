# THE LIST — the only things YOU have to do

Everything else is code that is already written. These are yours, in order.

## HOW THE VERCEL DEPLOY ACTUALLY GOES (so nothing surprises you)
You already have a Vercel account (your other site deploys there). `DEPLOY.cmd` runs
`npx vercel deploy --prod`. The FIRST run:
1. It says "Log in to Vercel" and opens your browser -> pick the login you already use
   (GitHub/Google/email). One click, back to the terminal.
2. It asks "Set up and deploy?" -> **Y**
3. "Which scope?" -> Enter (your account)
4. "Link to existing project?" -> **N**
5. "Project name?" -> Enter (accepts "ratchet")
6. "In which directory is your code located?" -> Enter (./)
7. It uploads and prints your live URL: **https://<project-name>.vercel.app**
Every later run skips all questions and just deploys. The URL stays the same.

## YOUR CUSTOM .vercel.app ADDRESS - two ways, both free
- **At first deploy (easiest):** at question 5 "Project name?", instead of pressing Enter,
  TYPE the name you want - e.g. `ratchet` -> you get **ratchet.vercel.app** if nobody has
  taken it. If taken, Vercel appends a suffix; just pick another name (ratchetgame,
  playratchet, ratchet-app...).
- **Any time after:** Vercel dashboard -> your project -> Settings -> Domains -> Add ->
  type `whatever-you-want.vercel.app` -> Add. Free, instant, and the old URL keeps working
  too. A real domain (~$10/yr from any registrar) is added in the same place later -
  Vercel shows you the two DNS records to set and does the rest, HTTPS included.

## BEFORE LAUNCH DAY (3 minutes, recommended): fast RPC
The free public Solana RPC rate-limits under a launch-day crowd. Fix in advance:
1. Browser: **helius.dev** -> Sign up (free plan) -> copy the API key off the dashboard.
2. Double-click **`SET_RPC.cmd`** -> paste the key -> it sets the env var and redeploys.
The public RPC remains an automatic fallback, so nothing breaks if you skip this -
the proof page just refreshes less reliably under load.

## LAUNCH DAY - one day, in this order (token IS in Wave 1)
1. **Morning - game live.** Move this folder where you want. Double-click `DEPLOY.cmd`
   (flow above). Then one click for durable state: Vercel dashboard -> project ->
   Storage -> Upstash Redis -> Create (free) -> run `DEPLOY.cmd` again.
2. **Midday - token live.** Open `token/LAUNCH_DAY.md`, follow it on jup.ag with wallet
   HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM. Put your Vercel URL in the token's
   website field - the token is born pointing at a WORKING product. Copy the mint address.
3. **Five minutes later - real burns on.** Double-click `SET_MINT.cmd`, paste the mint
   address. It redeploys. Burn-to-play is live: players send RATCHET to the incinerator,
   paste the signature, get credits. Verified on-chain, replay-proof, keyless.
4. **Announce once**: "The floor only goes up. Everything else is sealed until it's over.
   Utility live at TGE - burn to play, right now. [game URL] [mint]"
5. Trading fees stream to your wallet from the first trade. Claim them on the token's
   Jupiter page whenever you like. The game never touches that money.

## AFTER
- Send me the mint address + your URL -> I flip the proof-page lines green with links,
  and we iterate on whatever players complain about first.

## NEVER
- Never give anyone your seed phrase or private keys - including me. Everything here is
  signed by YOU on YOUR machine, or needs no signature at all.

## Standing decisions (recorded)
- Creator revenue = trading fees only. Stakes: 70% burn / 30% season pot / 0% creator.
- Venue: pump.fun (operator's call, 2026-08-19). Fee wallet: HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM.
- 1 RATCHET burned = 1 game credit (env CREDIT_PER_TOKEN, changeable only upward-honestly:
  announce before changing, never retroactively).
- Vault program (real redeemable floor) ships only after audit - the game runs fine without it.
