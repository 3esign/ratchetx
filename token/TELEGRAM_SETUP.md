# RATCHET Telegram - announcements-only launch setup

## Recommended structure

Use a Telegram CHANNEL named `RATCHET | Official Announcements`. Channels are
made for one-way broadcasting: subscribers read, only the owner/admins post.
Do not link a discussion group and do not enable comments at launch.

If the existing destination is a GROUP and you want to keep it:

1. Open Group -> Edit -> Permissions.
2. Disable send messages, media, stickers/GIFs, polls, links, invite users,
   pin messages, topics and change group info for members.
3. Keep only the owner and one backup admin.
4. Give the backup only post/edit/delete rights; never `Add New Admins`.
5. Make it public only after the pinned safety post is ready.

## Security settings

- Enable Telegram two-step verification on the owner account.
- Use a unique recovery email protected by its own 2FA.
- Keep admin signatures off unless attribution is intentionally public.
- Never accept support requests by unsolicited DM.
- Never paste a bot token, wallet seed, private key or Vercel secret into chat.
- Review Recent Actions after every admin or bot change.

## Bots - minimal launch policy

Start with NO third-party bot. Telegram already supports scheduled messages,
formatting, pinned posts and channel view counts. A no-chat channel needs no
anti-spam or moderation bot.

Optional later:

- `@ControllerBot` only if native scheduling/formatting becomes limiting.
  Grant only post/edit/delete-message rights. Do not grant add-admin, invite,
  change-info or ownership rights.
- A private RATCHET bot created with official `@BotFather` can later publish
  verified large burns, daily podium changes and build status. Store its token
  only as a hosting secret and give it post-message permission only.

Do not add Rose, Combot, Shieldy or captcha bots while chat is disabled; they
add permissions and attack surface without solving a launch problem.

## Channel identity

- Name: `RATCHET | Official Announcements`
- Username: choose a short available RATCHET name; do not use lookalike letters.
- Photo: use `token/logo.png`.
- Bio: `Official RATCHET updates. Keyless prediction arcade on Solana. 70% burn / 30% players / 0% team. No DMs. Verify the CA and links in the pinned post.`

## Pinned safety post - ready to paste

> RATCHET OFFICIAL LINKS
>
> Play: https://ratchetx.xyz
> Proof: https://ratchetx.xyz/api/proof
> Source: https://github.com/3esign/ratchetx
> DEX: https://dexscreener.com/solana/3gbsebmbbfqrc7wt7crajnkuhxntbfynjhrmedchjusv
> CA: FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump
>
> RATCHET admins will never DM first, ask for a seed phrase, offer a presale,
> or ask you to send tokens to claim rewards. The modeled floor is not a
> redeemable vault. Always verify the CA character by character.

## First five announcements

1. Welcome + pinned official links and anti-scam warning.
2. How the game works: sealed shot -> Pyth first crossing -> public receipt.
3. The frozen economy: 70% burned, 30% players, 0% team.
4. Proof post: revoked authorities, PumpSwap pool, reward transaction examples.
5. Honest roadmap: v2 referee and vault research are future work, not live claims.

## Before sharing the link

- [ ] Destination is public and opens in a logged-out browser
- [ ] Members cannot send messages or comments
- [ ] Exactly the intended admins can post
- [ ] Pinned post contains the exact CA
- [ ] Website, proof, GitHub and DEX links open
- [ ] No bot has more rights than it needs
- [ ] Exact `https://t.me/...` URL copied into DEXSCREENER_SUBMISSION.md
