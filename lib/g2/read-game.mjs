import { GENESIS } from './cluster.mjs';
import { extractShotArchivedReceipts } from './shot-receipt.mjs';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const U64_MAX = (1n << 64n) - 1n;
const knownGenesis = value => typeof value === 'string' && Object.hasOwn(GENESIS, value);
const bytesEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function hash32(value, name) {
  if (typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value))
    return Uint8Array.from(value.match(/../g), pair => parseInt(pair, 16));
  if (value instanceof Uint8Array && value.length === 32) return value.slice();
  throw new TypeError(name + ' must be 32 bytes or 64 hex characters');
}

function shotNonce(value) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0))
    throw new TypeError('nonce must be an exact nonnegative integer');
  if (!['bigint', 'number', 'string'].includes(typeof value) ||
      (typeof value === 'string' && !/^\d+$/.test(value)))
    throw new TypeError('nonce must be an exact nonnegative integer');
  const nonce = BigInt(value);
  if (nonce < 0n || nonce > U64_MAX) throw new RangeError('nonce exceeds u64');
  return nonce;
}

// Hashes are not Solana addresses: callers link account keys and signatures,
// while commitment/result hashes remain copyable data for a verifier.
export function explorerLink({ genesisHash, kind, value }) {
  if (!knownGenesis(genesisHash)) throw new TypeError('Unknown cluster genesis hash');
  const cluster = GENESIS[genesisHash];
  if (kind !== 'address' && kind !== 'tx') throw new TypeError('Unknown explorer link kind');
  const text = String(value);
  const [min, max] = kind === 'address' ? [32, 44] : [64, 88];
  if (!BASE58.test(text) || text.length < min || text.length > max)
    throw new TypeError('Invalid explorer ' + kind);
  const url = new URL('https://explorer.solana.com/' + kind + '/' + text);
  if (cluster !== 'mainnet-beta') url.searchParams.set('cluster', cluster);
  return url.href;
}

// Read-only: no wallet, timer, signature discovery or transaction submission.
// The caller supplies its endpoint, the expected cluster and the canonical
// browser client. Each call rechecks genesis before interpreting account data.
export function createGameReader({ connection, client, web3, expectedGenesisHash }) {
  if (!knownGenesis(expectedGenesisHash)) throw new TypeError('An expected known cluster is required');
  if (!web3?.PublicKey || !client?.validateShotAccount || !connection?.getGenesisHash ||
      !connection?.getMultipleAccountsInfoAndContext || !connection?.getTransaction)
    throw new TypeError('Connection, canonical G2 client and PublicKey are required');
  const key = value => new web3.PublicKey(value);

  return Object.freeze({
    async readGame({ economyHash, rulesetHash, player, nonce, terminalSignature }) {
      const eHash = hash32(economyHash, 'economyHash');
      const rHash = hash32(rulesetHash, 'rulesetHash');
      const playerKey = key(player);
      const chosenNonce = shotNonce(nonce);
      const genesisHash = await connection.getGenesisHash();
      if (genesisHash !== expectedGenesisHash)
        throw new TypeError('RPC cluster does not match the selected game');
      const cluster = Object.freeze({ name: GENESIS[genesisHash], genesisHash });
      const [economyAddress] = client.economyPda(eHash);
      const [rulesetAddress] = client.rulesetPda(rHash);
      const [shotAddress] = client.shotPda(eHash, playerKey, chosenNonce);
      const addresses = {
        core: client.coreProgram.toBase58(), timepin: client.timepinProgram.toBase58(),
        economy: economyAddress.toBase58(), ruleset: rulesetAddress.toBase58(),
        shot: shotAddress.toBase58(), player: playerKey.toBase58(),
      };
      const links = Object.fromEntries(Object.entries(addresses).map(([name, value]) =>
        [name, explorerLink({ genesisHash, kind: 'address', value })]));
      if (terminalSignature !== undefined) links.terminal = explorerLink({
        genesisHash, kind: 'tx', value: terminalSignature,
      });
      const snapshot = await connection.getMultipleAccountsInfoAndContext(
        [economyAddress, rulesetAddress, shotAddress], { commitment: 'confirmed' });
      if (!Number.isSafeInteger(snapshot?.context?.slot) || snapshot.context.slot < 0 ||
          !Array.isArray(snapshot.value) || snapshot.value.length !== 3)
        throw new TypeError('RPC returned an incomplete account snapshot');
      const [economyInfo, rulesetInfo, shotInfo] = snapshot.value;
      const base = { cluster, slot: snapshot.context.slot, addresses, links };
      if (!economyInfo || !rulesetInfo) return {
        ...base, kind: 'unavailable', reason: 'configuration-account-absent',
        missing: [!economyInfo && 'economy', !rulesetInfo && 'ruleset'].filter(Boolean),
      };
      const economy = await client.validateEconomyAccount({
        address: economyAddress, info: economyInfo, expectedHash: eHash,
      });
      // Economy binds cluster bytes, not its display name or configured RPC URL.
      if (!bytesEqual(economy.args.clusterGenesisHash, key(genesisHash).toBytes()))
        throw new TypeError('Economy belongs to a different cluster');
      const ruleset = await client.validateRulesetAccount({
        address: rulesetAddress, info: rulesetInfo, economy, expectedHash: rHash,
      });
      const context = { ...base, economy, ruleset };
      if (shotInfo) {
        const shot = client.validateShotAccount({
          address: shotAddress, info: shotInfo, economy, ruleset,
          player: playerKey, nonce: chosenNonce,
        });
        return {
          ...context, kind: 'account', shot, rawAccount: new Uint8Array(shotInfo.data),
          checks: { accountIdentity: true, resultEconomics: false },
        };
      }
      // Reveal, void and forfeit close Shot. Absence is not evidence of any one
      // outcome: an explicit successful terminal transaction supplies the row.
      if (terminalSignature === undefined) return {
        ...context, kind: 'unavailable', reason: 'shot-account-absent',
      };
      const transaction = await connection.getTransaction(terminalSignature, {
        commitment: 'confirmed', maxSupportedTransactionVersion: 0,
      });
      if (!transaction) return {
        ...context, kind: 'unavailable', reason: 'transaction-unavailable',
      };
      if (transaction.transaction?.signatures?.[0] !== terminalSignature)
        throw new TypeError('RPC returned a different transaction signature');
      const receipts = extractShotArchivedReceipts(transaction, {
        coreProgramId: client.coreProgram.toBase58(),
      }).filter(({ event }) => bytesEqual(event.economyHash, eHash) &&
        bytesEqual(event.player, playerKey.toBytes()) && event.nonce === chosenNonce &&
        bytesEqual(event.result.rulesetHash, rHash));
      if (receipts.length !== 1)
        throw new TypeError('Transaction must contain exactly one archive for this game');
      return {
        ...context, kind: 'archive', shot: null, receipt: receipts[0],
        // A decoded Core event is not a reconstructed result or a complete
        // HistoryPage fold. Keep these limits available to every renderer.
        checks: { accountIdentity: true, logProvenance: true,
          resultEconomics: false, historyCommitment: false },
      };
    },
  });
}
