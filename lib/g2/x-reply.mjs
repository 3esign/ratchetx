// Say what a validated G2 snapshot shows, with Pyth prices and a public proof.
// Pure presentation only: no network, signer, files, execution or legacy fallback.
// Feed this the trusted readGame/reconstructArchiveSnapshot output. Boolean
// verification flags in arbitrary JSON are NOT proof; this module replays no hash.
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const RCX_MINT = 'FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump';
export const FOOTER = 'ratchetx.xyz - solana prediction arcade rewarding $RCX';
export const TOKEN = Object.freeze({ symbol: 'RCX', mint: RCX_MINT, chain: 'solana:mainnet',
  url: 'https://pump.fun/coin/' + RCX_MINT });
const CORE = 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL';
const TIMEPIN = 'C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp';
const MODE = 'Devnet test credits; no RCX payout.';
const key = x => typeof x?.toBase58 === 'function' ? x.toBase58() : x;
const integer = x => typeof x === 'bigint' ? x : typeof x === 'string' && /^(0|[1-9][0-9]*)$/.test(x)
  ? BigInt(x) : Number.isSafeInteger(x) && x >= 0 ? BigInt(x) : null;
const u64 = x => { const n = integer(x); return n !== null && n >= 0n && n < 2n ** 64n ? n : null; };
const finish = (code, lines, ok = true) => Object.freeze({ ok, code,
  reply: [...lines, MODE, '', FOOTER].join('\n'), token: TOKEN });
const unavailable = () => finish('RESULT_UNAVAILABLE', [
  'The game could not be checked. No result is being guessed.',
  'Check your saved game at ratchetx.xyz/play.'
], false);

function price(value, exponent) {
  const n = integer(value);
  if (n === null || n <= 0n || n > (2n ** 63n - 1n) || !Number.isInteger(exponent)
      || exponent < -18 || exponent > 18) return null;
  const digits = n.toString();
  if (exponent >= 0) return digits + '0'.repeat(exponent);
  const padded = digits.padStart(1 - exponent, '0'), at = padded.length + exponent;
  return (padded.slice(0, at) + '.' + padded.slice(at)).replace(/\.?0+$/, '');
}

function proofLink(snapshot, record) {
  const player = key(snapshot.addresses?.player), nonce = u64(record?.nonce);
  if (typeof player !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(player) || nonce === null) return null;
  const url = new URL('https://ratchetx.xyz/proof');
  url.searchParams.set('player', player); url.searchParams.set('nonce', nonce.toString());
  if (snapshot.kind === 'archive') {
    const signature = snapshot.receipt?.transaction?.signature;
    if (typeof signature !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{86,88}$/.test(signature)) return null;
    url.searchParams.set('terminal', signature);
  }
  return url.href;
}

/** Format a trusted, identity-checked reader snapshot. Never submits or reveals. */
export function formatG2Reply(snapshot) {
  if (snapshot?.cluster?.genesisHash !== DEVNET_GENESIS)
    throw new TypeError('G2 replies require the devnet reader snapshot');
  if (snapshot.addresses?.core !== CORE || snapshot.addresses?.timepin !== TIMEPIN
      || snapshot.checks?.accountIdentity !== true) return unavailable();
  const archived = snapshot.kind === 'archive';
  const record = archived ? snapshot.receipt?.event : snapshot.shot;
  const result = archived ? record?.result : record;
  const link = proofLink(snapshot, record);
  if (!link || !result || (!archived && snapshot.kind !== 'account')) return unavailable();

  if (archived) {
    if (snapshot.checks.logProvenance !== true) return unavailable();
    const reconstruction = snapshot.reconstruction;
    const checked = ['candidateIdentity', 'candidateMessageHashes', 'resultOutcomeAndXp', 'gameResultHash', 'rowHash']
      .every(name => snapshot.checks[name] === true && reconstruction?.checks?.[name] === true);
    if (result.state === 4 && checked && reconstruction?.kind === 'verified-revealed-archive') {
      const rebuilt = reconstruction.result;
      const hit = rebuilt?.hit === 1 ? 'HIT' : rebuilt?.hit === 0 ? 'MISS' : null;
      const entry = price(rebuilt?.entryPrice, rebuilt?.entryExponent), exit = price(rebuilt?.exitPrice, rebuilt?.exitExponent);
      if (hit && hit === reconstruction.outcome && entry && exit && rebuilt.state === 4 && u64(rebuilt.xpAwarded) !== null) {
        // Outcome/XP reconstruction does not establish a ledger payout. Omit it.
        return finish(hit, ['Result: ' + hit + ' · +' + u64(rebuilt.xpAwarded) + ' XP.', 'Entry → exit: $' + entry + ' → $' + exit,
          'Pyth prices · Proof: ' + link]);
      }
    }
    if (result.state === 5) return finish('VOID', ['Result: VOID.', 'Proof: ' + link]);
    if (result.state === 6) return finish('FORFEITED', ['The reveal deadline passed.', 'Proof: ' + link]);
    return finish('RESULT_DETAILS_UNVERIFIED', ['The game is closed. Its result details could not be checked.', 'Proof: ' + link], false);
  }

  if (result.state === 1 || result.state === 2) return finish('WAITING_FOR_PYTH', [
    'Prediction sealed on-chain.', 'Waiting for Pyth prices.', 'Proof: ' + link
  ]);
  if (result.state === 3) {
    const deadline = u64(result.revealDeadlineTs);
    if (deadline === null || deadline > 8640000000000n) return unavailable();
    const time = new Date(Number(deadline) * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
    return finish('REVEAL_NEEDED', ['Pyth prices recorded. Your prediction needs revealing.',
      'Finish before ' + time + '.', 'Open the game on the device holding your reveal key.', 'Proof: ' + link]);
  }
  if (result.state === 7) return finish('AWAITING_VOID', ['The game is waiting to be closed without a result.', 'Proof: ' + link]);
  return unavailable();
}
