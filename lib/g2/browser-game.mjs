import { createCoreG2Client } from './client-v2.mjs';
import { createPlayerActions } from './player-actions.mjs';
import { createGameReader } from './read-game.mjs';

export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const DEVNET_PROGRAMS = Object.freeze({
  core: 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL',
  timepin: 'C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp',
});
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const bytes = (value, label = 'hash') => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) throw new Error('Invalid ' + label);
  return Uint8Array.from(value.match(/../g), x => parseInt(x, 16));
};
const exact = (value, label) => {
  if (typeof value === 'bigint' && value >= 0n && value <= (1n << 64n) - 1n) return value;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error(label + ' must be an exact integer');
  const n = BigInt(value);
  if (n > (1n << 64n) - 1n) throw new Error(label + ' exceeds u64');
  return n;
};
const base58 = data => {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n, out = ''; for (const b of data) n = (n << 8n) | BigInt(b);
  while (n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; }
  for (const b of data) { if (b !== 0) break; out = '1' + out; }
  return out;
};
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const requireFact = (ok, message) => { if (!ok) throw new Error(message); };

/** Wallet-owned devnet game flow. Reads only happen when a method is called.
 * Configuration is public metadata; every account is validated against the chain.
 * Reveal secrets stay in device-local storage. Never publish them before reveal.
 */
export function createBrowserGame({ web3, connection, config, wallet = null,
  storage = globalThis.localStorage, cryptoImpl = globalThis.crypto, onStatus = () => {} }) {
  requireFact(config?.clusterGenesis === DEVNET_GENESIS, 'This game requires the verified devnet configuration');
  requireFact(config.programs?.core === DEVNET_PROGRAMS.core && config.programs?.timepin === DEVNET_PROGRAMS.timepin,
    'Configuration does not name the deployed programs');
  const economyHash = bytes(config.economyHash, 'economy hash');
  const rulesetHash = bytes(config.rulesetHash, 'ruleset hash');
  const evidenceSpecHash = bytes(config.evidenceSpecHash, 'evidence specification hash');
  const client = createCoreG2Client({ web3, coreProgramId: config.programs.core,
    timepinProgramId: config.programs.timepin, cryptoImpl });
  const actions = createPlayerActions({ client, web3 });
  const reader = createGameReader({ connection, client, web3, expectedGenesisHash: DEVNET_GENESIS });
  const { PublicKey } = web3;
  let busy = false;
  const notify = (phase, detail = {}) => onStatus({ phase, ...detail });
  const walletKey = () => {
    requireFact(wallet?.publicKey && typeof wallet.signTransaction === 'function', 'Connect a wallet that supports transaction signing');
    return new PublicKey(wallet.publicKey);
  };
  const sameWallet = player => requireFact(walletKey().equals(player), 'Wallet changed; refresh before continuing');
  const boundary = async () => requireFact(await connection.getGenesisHash() === DEVNET_GENESIS, 'RPC is not Solana devnet');
  const prefix = player => 'ratchetx:g2:' + DEVNET_GENESIS + ':' + hex(economyHash) + ':' + player + ':';
  const savedKey = (player, nonce) => prefix(player) + nonce;
  const put = record => {
    requireFact(storage?.setItem && storage?.getItem, 'Local storage is required to retain your reveal key');
    const key = savedKey(record.player, record.nonce), data = JSON.stringify(record);
    const prior = storage.getItem(key);
    requireFact(!prior || JSON.parse(prior).commitment === record.commitment, 'Another prediction already owns this saved nonce; no reveal key was overwritten');
    storage.setItem(key, data);
    requireFact(storage.getItem(key) === data, 'Your reveal key could not be saved; no transaction will be sent');
  };
  const get = (player, nonce) => {
    const raw = storage?.getItem(savedKey(player, nonce));
    if (raw == null) return null;
    const record = JSON.parse(raw);
    requireFact(record.player === String(player) && record.nonce === String(nonce) &&
      record.clusterGenesis === DEVNET_GENESIS && record.economyHash === hex(economyHash) &&
      record.rulesetHash === hex(rulesetHash), 'Saved game identity mismatch');
    return record;
  };
  const exclusive = async work => {
    requireFact(!busy, 'A wallet action is already in progress'); busy = true;
    try {
      const locks = globalThis.navigator?.locks;
      if (locks && wallet?.publicKey) return await locks.request(prefix(wallet.publicKey), { ifAvailable: true }, async lock => {
        requireFact(lock, 'Another tab is using this game wallet. Finish that action first'); return work();
      });
      return await work();
    } finally { busy = false; }
  };

  async function load() {
    await boundary();
    const player = wallet?.publicKey ? new PublicKey(wallet.publicKey) : null;
    const eAddress = client.economyPda(economyHash)[0];
    const rAddress = client.rulesetPda(rulesetHash)[0];
    const sAddress = client.evidenceSpecPda(evidenceSpecHash)[0];
    const addresses = [eAddress, rAddress, sAddress, web3.SYSVAR_CLOCK_PUBKEY];
    if (player) addresses.push(client.ledgerPda(economyHash, player)[0]);
    const result = await connection.getMultipleAccountsInfoAndContext(addresses, { commitment: 'confirmed' });
    requireFact(Number.isSafeInteger(result?.context?.slot) && result.context.slot > 0 &&
      result.value?.length === addresses.length, 'Incomplete chain response');
    const [eInfo, rInfo, sInfo, clockInfo, ledgerInfo] = result.value;
    requireFact(eInfo && rInfo && sInfo, 'The selected economy and rules are not registered yet');
    const economy = await client.validateEconomyAccount({ address: eAddress, info: eInfo, expectedHash: economyHash });
    requireFact(equal(economy.args.clusterGenesisHash, new PublicKey(DEVNET_GENESIS).toBytes()), 'Economy belongs to another cluster');
    const ruleset = await client.validateRulesetAccount({ address: rAddress, info: rInfo, economy, expectedHash: rulesetHash });
    const evidenceSpec = await client.validateEvidenceSpecAccount({ address: sAddress, info: sInfo, expectedHash: evidenceSpecHash });
    client.validateForwardKernel({ economy, ruleset, evidenceSpec });
    requireFact(clockInfo && !clockInfo.executable && clockInfo.data.length === 40 &&
      new PublicKey(clockInfo.owner).toBase58() === 'Sysvar1111111111111111111111111111111111111', 'Invalid chain clock');
    const clock = new DataView(clockInfo.data.buffer, clockInfo.data.byteOffset, clockInfo.data.byteLength);
    const chainNowTs = clock.getBigInt64(32, true);
    requireFact(chainNowTs > 0n && clock.getBigUint64(0, true) > 0n, 'Invalid chain clock values');
    const ledger = ledgerInfo ? client.validateLedgerAccount({ address: addresses[4], info: ledgerInfo, economy, player }) : null;
    if (player) sameWallet(player);
    const matches = (config.legacySnapshot?.claims || []).filter(row => row.wallet === player?.toBase58());
    requireFact(matches.length <= 1, 'Duplicate wallet allocation in public configuration');
    const allocation = matches[0] || null;
    return { slot: result.context.slot, player, economy, ruleset, evidenceSpec, ledger, allocation, chainNowTs,
      timing: client.admissionTiming({ chainNowTs, economy, ruleset, evidenceSpec }) };
  }

  async function send(instructions, player, onBroadcast = () => {}) {
    await boundary(); sameWallet(player);
    const block = await connection.getLatestBlockhash('confirmed');
    const message = new web3.TransactionMessage({ payerKey: player, recentBlockhash: block.blockhash, instructions }).compileToV0Message();
    const transaction = new web3.VersionedTransaction(message);
    requireFact(transaction.serialize().length <= 1232, 'Transaction exceeds the Solana packet size');
    notify('simulating');
    const simulation = await connection.simulateTransaction(transaction, { commitment: 'confirmed', sigVerify: false });
    requireFact(simulation?.value && simulation.value.err === null,
      'Simulation refused the action: ' + JSON.stringify(simulation?.value?.err ?? 'no simulation response'));
    await boundary(); sameWallet(player);
    notify('signing');
    const originalMessage = transaction.message.serialize();
    const signed = await wallet.signTransaction(transaction);
    sameWallet(player);
    requireFact(signed?.message && equal(originalMessage, signed.message.serialize()), 'Wallet returned a different transaction');
    requireFact(signed.signatures?.[0]?.length === 64 && signed.signatures[0].some(Boolean), 'Wallet did not sign the transaction');
    await boundary();
    // The signature is already known locally. Retain it before sending so a lost
    // RPC response cannot destroy the only path to a closed Shot's receipt.
    const signature = base58(signed.signatures[0]);
    await onBroadcast(signature, block);
    notify('sending');
    const returned = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 2 });
    requireFact(returned === signature, 'RPC returned a different signature; retain the saved signature for recovery');
    notify('confirming', { signature });
    const confirmation = await connection.confirmTransaction({ ...block, signature }, 'confirmed');
    requireFact(confirmation?.value && confirmation.value.err === null,
      'Transaction failed: ' + JSON.stringify(confirmation?.value?.err ?? 'confirmation unavailable'));
    notify('reading', { signature });
    return signature;
  }

  const readShot = ({ player, nonce, terminalSignature } = {}) => reader.readGame({
    economyHash, rulesetHash, player: player || walletKey(), nonce: exact(nonce, 'nonce'), terminalSignature,
  });

  const claim = () => exclusive(async () => {
    const player = walletKey(), before = await load(); sameWallet(player);
    requireFact(before.allocation, 'This wallet has no test-credit allocation in this economy');
    const allocation = before.allocation;
    requireFact(!before.ledger || (before.ledger.legacyCredits === 0n && before.ledger.legacyXp === 0n), 'This wallet has already claimed');
    const credits = exact(allocation.credits, 'credits'), xp = exact(allocation.xp, 'XP');
    const instruction = actions.claimLegacyIx({ economy: before.economy, player, credits, xp,
      proof: allocation.proof.map(p => bytes(p, 'claim proof')) });
    const signature = await send([instruction], player);
    const after = await load(); sameWallet(player);
    requireFact(after.ledger?.legacyCredits === credits && after.ledger?.legacyXp === xp,
      'Claim confirmed, but the expected credits could not be read back');
    return { signature, ...after };
  });

  const seal = ({ side, pBps, stake, expectedTargets }) => exclusive(async () => {
    requireFact((side === 0 || side === 1) && Number.isInteger(pBps) && pBps >= 1 && pBps <= 9999, 'Choose a direction and confidence');
    const amount = exact(stake, 'stake'), player = walletKey(), context = await load(); sameWallet(player);
    requireFact(context.ledger, 'Claim test credits before sealing a shot');
    if (expectedTargets) requireFact(context.timing.entryTargetTs === expectedTargets.entryTargetTs && context.timing.exitTargetTs === expectedTargets.exitTargetTs, 'The target grid moved. Refresh the displayed times before sealing');
    const nonce = context.ledger.nextShotNonce, existing = get(player, nonce);
    requireFact(!existing || existing.stage === 'prepared', 'A saved shot may already have been sent. Refresh its chain state before trying again');
    if (existing) requireFact(existing.side === side && existing.pBps === pBps && existing.stake === String(amount),
      'An unsent prediction is already saved for this nonce; restore those terms before retrying');
    const salt = existing ? bytes(existing.salt, 'saved reveal key') : cryptoImpl.getRandomValues(new Uint8Array(32));
    const commit = await client.commitmentHash({ economyHash, rulesetHash, player, nonce, side, probability: pBps, salt });
    const plan = await client.buildForwardAdmission({ ...context, player, stake: amount, commit, nonce });
    const record = { schema: 1, clusterGenesis: DEVNET_GENESIS, economyHash: hex(economyHash), rulesetHash: hex(rulesetHash),
      player: player.toBase58(), nonce: String(nonce), side, pBps, stake: String(amount), salt: hex(salt), commitment: hex(commit),
      stage: 'prepared', savedAt: new Date().toISOString() };
    put(record);
    const signature = await send(plan.instructions, player, async (signature, block) => {
      record.stage = 'broadcast'; record.sealSignature = signature; record.pendingBlock = block; put(record);
    });
    const result = await readShot({ player, nonce });
    requireFact(result.kind === 'account' && equal(result.shot.commit, commit) && result.shot.stake === amount,
      'Seal sent, but the matching Shot could not be read back. Your reveal key remains saved');
    record.stage = 'sealed'; put(record); notify('sealed', { signature, nonce: String(nonce) });
    return { signature, result };
  });

  const reveal = ({ nonce }) => exclusive(async () => {
    const player = walletKey(), n = exact(nonce, 'nonce'), record = get(player, n);
    requireFact(record?.stage !== 'reveal-broadcast', 'A reveal may already have been sent. Refresh its receipt before retrying');
    requireFact(record, 'This browser has no reveal key for that shot; restore your saved reveal key');
    const result = await readShot({ player, nonce: n }); sameWallet(player);
    requireFact(result.kind === 'account', 'The live Shot account is unavailable');
    const instruction = await actions.revealIx({ economy: result.economy, ruleset: result.ruleset,
      shotAddress: result.addresses.shot, shot: result.shot, side: record.side, pBps: record.pBps, salt: bytes(record.salt, 'saved reveal key') });
    const signature = await send([instruction], player, async (signature, block) => {
      record.stage = 'reveal-broadcast'; record.terminalSignature = signature; record.pendingBlock = block; put(record);
    });
    const archived = await readShot({ player, nonce: n, terminalSignature: signature });
    requireFact(archived.kind === 'archive', 'Reveal confirmed; the terminal receipt is not available yet. Its signature remains saved');
    record.stage = 'revealed'; put(record); notify('revealed', { signature, nonce: String(n) });
    return { signature, result: archived };
  });

  // Reconciliation never resubmits. Expiry plus absent signature/account state is
  // required before an uncertain seal can become a retryable prepared record.
  const reconcile = ({ nonce }) => exclusive(async () => {
    const player = walletKey(), n = exact(nonce, 'nonce'), record = get(player, n);
    requireFact(record, 'No saved shot for this nonce');
    let result;
    try { result = await readShot({ player, nonce: n, terminalSignature: record.terminalSignature }); }
    catch (error) {
      // A failed reveal is not a receipt. A keeper may subsequently have closed
      // the shot, so continue with account read + bounded terminal discovery.
      if (error.message !== 'Receipt extraction requires meta.err === null') throw error;
      result = await readShot({ player, nonce: n });
    }
    sameWallet(player);
    if (result.kind === 'unavailable' && result.reason !== 'configuration-account-absent') {
      // Keepers can close a void/forfeit without a player-signed terminal tx.
      // One explicit refresh searches a bounded recent set; the reader still
      // requires the exact successful Core archive for this player/nonce/ruleset.
      const address = client.shotPda(economyHash, player, n)[0];
      const signatures = await connection.getSignaturesForAddress(address, { limit: 8 }, 'confirmed');
      const candidates = signatures.filter(row => row.err === null && row.signature !== record.sealSignature).slice(0, 3);
      for (const row of candidates) {
        try {
          const found = await readShot({ player, nonce: n, terminalSignature: row.signature });
          if (found.kind === 'archive') { result = found; record.terminalSignature = row.signature; break; }
        } catch (error) {
          if (error.message !== 'Transaction must contain exactly one archive for this game') throw error;
        }
      }
    }
    sameWallet(player);
    if (result.kind === 'archive') {
      record.stage = 'archived'; put(record); return { result, retryable: false };
    }
    const signature = record.terminalSignature || record.sealSignature;
    if (result.kind === 'account') requireFact(equal(result.shot.commit, bytes(record.commitment)), 'Saved commitment differs from live Shot');
    const statuses = signature ? await connection.getSignatureStatuses([signature], { searchTransactionHistory: true }) : null;
    const status = statuses?.value?.[0] ?? null;
    const expired = Number.isSafeInteger(record.pendingBlock?.lastValidBlockHeight) &&
      await connection.getBlockHeight('confirmed') > record.pendingBlock.lastValidBlockHeight;
    const definitelyFailed = !!status?.err && status.confirmationStatus === 'finalized';
    const mayRetry = definitelyFailed || (!status && expired);
    if (result.kind === 'account' && (!record.terminalSignature || mayRetry)) {
      record.stage = 'sealed';
      if (record.terminalSignature && mayRetry) delete record.terminalSignature;
      put(record); return { result, retryable: result.shot.state === 3 };
    }
    if (result.kind === 'unavailable' && !record.terminalSignature && mayRetry) {
      const context = await load(); sameWallet(player);
      requireFact(context.ledger?.nextShotNonce === n, 'Ledger has advanced; cannot reset this prediction');
      record.stage = 'prepared'; delete record.sealSignature; delete record.pendingBlock; put(record);
      return { result, retryable: true };
    }
    return { result, retryable: false, pending: true };
  });

  const savedGames = () => {
    const player = walletKey(), start = prefix(player), records = [];
    for (let i = 0; i < (storage?.length || 0); i++) {
      const key = storage.key(i); if (!key?.startsWith(start)) continue;
      const nonce = key.slice(start.length); if (!/^\d+$/.test(nonce)) continue;
      const record = get(player, nonce);
      records.push({ nonce: record.nonce, stage: record.stage, savedAt: record.savedAt,
        sealSignature: record.sealSignature, terminalSignature: record.terminalSignature });
    }
    return records.sort((a, b) => BigInt(a.nonce) > BigInt(b.nonce) ? -1 : 1);
  };
  const exportRevealKey = nonce => {
    const record = get(walletKey(), exact(nonce, 'nonce'));
    requireFact(record, 'No reveal key is saved for this shot'); return JSON.stringify(record, null, 2);
  };
  const importRevealKey = data => exclusive(async () => {
    requireFact(typeof data === 'string' && data.length < 12000, 'Invalid reveal-key file');
    const record = JSON.parse(data), player = walletKey(), nonce = exact(record.nonce, 'nonce');
    requireFact(record.schema === 1 && record.player === player.toBase58() && record.clusterGenesis === DEVNET_GENESIS &&
      record.economyHash === hex(economyHash) && record.rulesetHash === hex(rulesetHash), 'Reveal key belongs to a different game or wallet');
    const commit = await client.commitmentHash({ economyHash, rulesetHash, player, nonce,
      side: record.side, probability: record.pBps, salt: bytes(record.salt, 'reveal key') });
    requireFact(hex(commit) === record.commitment, 'Reveal key commitment mismatch');
    const shot = await readShot({ player, nonce, terminalSignature: record.terminalSignature }); sameWallet(player);
    requireFact(shot.kind === 'account' && equal(shot.shot.commit, commit), 'Cannot match the reveal key to a live Shot');
    record.stage = 'sealed'; put(record); return { nonce: String(nonce), result: shot };
  });
  return Object.freeze({ client, load, readShot, claim, seal, reveal, reconcile, savedGames, exportRevealKey, importRevealKey });
}
