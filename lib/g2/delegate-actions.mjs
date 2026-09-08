// A player chooses exact on-chain limits; the agent can act only within them.
// Browser-only account validation and unsigned grant/revoke preparation. No key,
// signing, submission, storage, Bankr API or additional dependency lives here.
import { createBrowserGame, DEVNET_GENESIS } from './browser-game.mjs';

export const DELEGATE_GRANT_ACCOUNT_SIZE = 204;
export const MAX_DELEGATE_LIFETIME_SECONDS = 30n * 86400n;
const U64_MAX = (1n << 64n) - 1n, I64_MAX = (1n << 63n) - 1n;
const ZERO_KEY = '11111111111111111111111111111111';
const encoder = new TextEncoder();
const fail = (ok, message) => { if (!ok) throw new Error(message); };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const hex = data => Array.from(data, b => b.toString(16).padStart(2, '0')).join('');
function bytes(value, size, label) {
  if (typeof value === 'string' && new RegExp('^[a-f0-9]{' + size * 2 + '}$', 'i').test(value)) return Uint8Array.from(value.match(/../g), p => parseInt(p, 16));
  fail(value instanceof Uint8Array && value.length === size, label + ' must contain exactly ' + size + ' bytes');
  return new Uint8Array(value);
}
function integer(value, min, max, label) {
  fail(typeof value === 'bigint' || typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) || typeof value === 'number' && Number.isSafeInteger(value), label + ' must be an exact integer; no bound is defaulted');
  const n = BigInt(value); fail(n >= min && n <= max, label + ' is out of range'); return n;
}
function base64(data) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let out = '';
  for (let i = 0; i < data.length; i += 3) {
    const n = (data[i] << 16) | ((data[i + 1] || 0) << 8) | (data[i + 2] || 0);
    out += alphabet[(n >>> 18) & 63] + alphabet[(n >>> 12) & 63] + (i + 1 < data.length ? alphabet[(n >>> 6) & 63] : '=') + (i + 2 < data.length ? alphabet[n & 63] : '=');
  }
  return out;
}

export function createDelegateActions({ web3, connection, config, cryptoImpl = globalThis.crypto }) {
  fail(web3?.PublicKey && web3?.TransactionMessage && cryptoImpl?.subtle, 'Canonical web3 and SHA-256 are required');
  const key = value => new web3.PublicKey(value);
  const contextFor = player => createBrowserGame({ web3, connection, config, cryptoImpl, storage: null,
    wallet: { publicKey: key(player), signTransaction: () => { throw new Error('Delegation preparation does not sign transactions'); } } });
  // createBrowserGame pins actual devnet programs/config before any work.
  const client = createBrowserGame({ web3, connection, config, cryptoImpl, storage: null }).client;
  const economyHash = bytes(config.economyHash, 32, 'economyHash'), rulesetHash = bytes(config.rulesetHash, 32, 'rulesetHash');
  const hash = async data => new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', data));
  const discriminator = hash(encoder.encode('account:DelegateGrant')).then(data => data.subarray(0, 8));
  const identity = { scope: 'DEVNET_G2_DELEGATION_ONLY', clusterGenesis: DEVNET_GENESIS, coreProgram: client.coreProgram.toBase58(),
    timepinProgram: client.timepinProgram.toBase58(), economyHash: hex(economyHash), rulesetHash: hex(rulesetHash) };

  function deriveGrant({ player, delegate, grantId }) {
    const owner = key(player), agent = key(delegate), id = bytes(grantId, 16, 'grantId');
    fail(owner.toBase58() !== ZERO_KEY && agent.toBase58() !== ZERO_KEY && !owner.equals(agent), 'Player and delegate must be distinct nonzero public keys');
    fail(id.some(Boolean), 'grantId must be nonzero');
    const [address, bump] = web3.PublicKey.findProgramAddressSync([encoder.encode('delegate_grant'), Uint8Array.of(2, 0), economyHash, rulesetHash, owner.toBytes(), agent.toBytes(), id], client.coreProgram);
    return { address, bump, grantId: id, player: owner, delegate: agent };
  }
  function validateShape(grant, economy, ruleset) {
    fail(grant.schema === 2 && grant.grantId.some(Boolean) && same(grant.economyHash, economy.economyHash) &&
      same(grant.rulesetHash, ruleset.rulesetHash) && same(ruleset.args.economyHash, economy.economyHash), 'DelegateGrant schema/Economy/Ruleset mismatch');
    fail(grant.player.toBase58() !== ZERO_KEY && grant.delegate.toBase58() !== ZERO_KEY && !grant.player.equals(grant.delegate), 'Invalid DelegateGrant authority');
    fail(grant.maxStake >= economy.args.minStake && grant.maxStake <= economy.args.maxStake && grant.maxGrossStake >= grant.maxStake &&
      grant.maxShots > 0 && grant.minIntervalSeconds > 0 && grant.expiresAtTs > 0n && grant.shotsUsed <= grant.maxShots &&
      grant.grossStakeUsed <= grant.maxGrossStake && grant.revoked <= 1, 'DelegateGrant bounds or counters are invalid');
    fail(grant.maxGrossStake <= grant.maxStake * BigInt(grant.maxShots), 'Total grant cap exceeds per-shot cap times shot count');
    fail(grant.shotsUsed === 0 ? grant.grossStakeUsed === 0n && grant.lastSealTs === 0n : grant.grossStakeUsed > 0n && grant.lastSealTs > 0n, 'DelegateGrant usage counters disagree');
    return grant;
  }
  async function validateGrant({ info, expected, economy, ruleset }) {
    fail(info && info.executable === false && key(info.owner).equals(client.coreProgram), 'DelegateGrant owner/executable mismatch');
    fail(info.data instanceof Uint8Array && info.data.length === DELEGATE_GRANT_ACCOUNT_SIZE, 'DelegateGrant must be exactly 204 bytes');
    const data = new Uint8Array(info.data), view = new DataView(data.buffer); let offset = 8;
    fail(same(data.subarray(0, 8), await discriminator), 'DelegateGrant discriminator mismatch');
    const take = n => { const result = data.slice(offset, offset + n); offset += n; return result; };
    const read = (method, n) => { const result = view[method](offset, true); offset += n; return result; };
    const grant = { schema: read('getUint16', 2), bump: read('getUint8', 1), grantId: take(16), economyHash: take(32), rulesetHash: take(32),
      player: key(take(32)), delegate: key(take(32)), maxStake: read('getBigUint64', 8), maxGrossStake: read('getBigUint64', 8),
      maxShots: read('getUint16', 2), minIntervalSeconds: read('getUint32', 4), expiresAtTs: read('getBigInt64', 8),
      grossStakeUsed: read('getBigUint64', 8), shotsUsed: read('getUint16', 2), lastSealTs: read('getBigInt64', 8), revoked: read('getUint8', 1) };
    fail(offset === data.length, 'DelegateGrant trailing data');
    validateShape(grant, economy, ruleset);
    const actual = deriveGrant(grant);
    fail(actual.address.equals(expected.address) && grant.bump === expected.bump && same(grant.grantId, expected.grantId) &&
      grant.player.equals(expected.player) && grant.delegate.equals(expected.delegate), 'DelegateGrant PDA/player/delegate/grantId mismatch');
    return { grant, grantHash: hex(await hash(data)), rawAccount: data };
  }
  function clockTs(info) {
    fail(info && info.executable === false && info.data instanceof Uint8Array && info.data.length === 40 &&
      key(info.owner).toBase58() === 'Sysvar1111111111111111111111111111111111111', 'Invalid chain clock');
    const view = new DataView(info.data.buffer, info.data.byteOffset, info.data.length), now = view.getBigInt64(32, true);
    fail(now > 0n && view.getBigUint64(0, true) > 0n, 'Invalid chain clock values'); return now;
  }
  function grantAllows({ grant, economy, nowTs, stake }) {
    if (!grant) return { ok: false, problems: ['No authenticated DelegateGrant account is available'] };
    const now = integer(nowTs, 0n, I64_MAX, 'nowTs'), amount = integer(stake, 0n, U64_MAX, 'stake');
    const problems = [];
    if (grant.revoked !== 0) problems.push('The grant is revoked');
    if (now >= grant.expiresAtTs) problems.push('The grant has expired');
    if (amount < economy.args.minStake || amount > grant.maxStake) problems.push('Stake is outside the Economy minimum or grant per-shot cap');
    if (grant.shotsUsed >= grant.maxShots) problems.push('The grant has no shots left');
    if (grant.grossStakeUsed + amount > U64_MAX || grant.grossStakeUsed + amount > grant.maxGrossStake) problems.push('This shot exceeds the remaining total gross stake cap');
    if (grant.shotsUsed > 0) {
      const next = grant.lastSealTs + BigInt(grant.minIntervalSeconds);
      if (next > I64_MAX || now < next) problems.push('The minimum interval between shots has not elapsed');
    }
    return { ok: problems.length === 0, problems };
  }
  async function readGrant(input) {
    const expected = deriveGrant(input), context = await contextFor(expected.player).load();
    const read = await connection.getMultipleAccountsInfoAndContext([expected.address, web3.SYSVAR_CLOCK_PUBKEY], { commitment: 'confirmed', minContextSlot: context.slot });
    fail(Number.isSafeInteger(read?.context?.slot) && read.context.slot >= context.slot && read.value?.length === 2, 'Incomplete DelegateGrant/clock snapshot');
    const chainNowTs = clockTs(read.value[1]);
    const base = { ...identity, ...context, ...expected, slot: read.context.slot, chainNowTs, timing: client.admissionTiming({ ...context, chainNowTs }),
      checks: { configurationIdentity: true, accountIdentity: false, signatureVerification: false, rpcFinality: false } };
    if (!read.value[0]) return { ...base, kind: 'unavailable', reason: 'delegate-grant-absent', grant: null, grantHash: null, usage: null };
    const checked = await validateGrant({ info: read.value[0], expected, economy: context.economy, ruleset: context.ruleset });
    const grant = checked.grant;
    return { ...base, ...checked, kind: 'account', checks: { ...base.checks, accountIdentity: true }, usage: {
      grossStakeRemaining: grant.maxGrossStake - grant.grossStakeUsed, shotsRemaining: grant.maxShots - grant.shotsUsed,
      revoked: grant.revoked === 1, expired: chainNowTs >= grant.expiresAtTs,
      nextAllowedSealTs: grant.shotsUsed > 0 ? grant.lastSealTs + BigInt(grant.minIntervalSeconds) : chainNowTs,
      minimumStakePermission: grantAllows({ grant, economy: context.economy, nowTs: chainNowTs, stake: context.economy.args.minStake }),
    } };
  }
  function terms(input) {
    return { maxStake: integer(input.maxStake, 1n, U64_MAX, 'maxStake'), maxGrossStake: integer(input.maxGrossStake, 1n, U64_MAX, 'maxGrossStake'),
      maxShots: Number(integer(input.maxShots, 1n, 65535n, 'maxShots')), minIntervalSeconds: Number(integer(input.minIntervalSeconds, 1n, 4294967295n, 'minIntervalSeconds')),
      expiresAtTs: integer(input.expiresAtTs, 1n, I64_MAX, 'expiresAtTs') };
  }
  const expectedHash = (expected, actual, label) => {
    fail(typeof expected === 'string' && /^[a-f0-9]{64}$/i.test(expected) && expected.toLowerCase() === actual, label + ' changed; read it and review its exact current limits again');
  };
  async function prepare(instruction, context, intent) {
    fail(await connection.getGenesisHash() === DEVNET_GENESIS, 'RPC is not Solana devnet');
    const player = context.player;
    fail(instruction.programId.equals(client.coreProgram) && instruction.keys.every(a => !a.isSigner || a.pubkey.equals(player)), 'Unexpected delegation program or signer');
    const block = await connection.getLatestBlockhash({ commitment: 'confirmed', minContextSlot: context.slot });
    fail(typeof block?.blockhash === 'string' && Number.isSafeInteger(block.lastValidBlockHeight) && block.lastValidBlockHeight > 0, 'Incomplete recent blockhash');
    const transaction = new web3.VersionedTransaction(new web3.TransactionMessage({ payerKey: player, recentBlockhash: block.blockhash, instructions: [instruction] }).compileToV0Message());
    const transactionBytes = new Uint8Array(transaction.serialize()), messageBytes = new Uint8Array(transaction.message.serialize());
    fail(transactionBytes.length <= 1232 && transaction.signatures.length === 1 && transaction.signatures[0].every(b => b === 0), 'Unexpected unsigned transaction shape');
    const simulation = await connection.simulateTransaction(transaction, { commitment: 'confirmed', sigVerify: false, minContextSlot: context.slot });
    fail(Number.isSafeInteger(simulation?.context?.slot) && simulation.context.slot >= context.slot && simulation.value?.err === null,
      'Delegation simulation failed: ' + JSON.stringify(simulation?.value?.err ?? 'response unavailable'));
    fail(same(transactionBytes, transaction.serialize()) && same(messageBytes, transaction.message.serialize()), 'Transaction changed during simulation');
    let networkFeeLamports = null;
    try { const fee = await connection.getFeeForMessage(transaction.message, 'confirmed'); if (Number.isSafeInteger(fee?.value) && fee.value >= 0) networkFeeLamports = String(fee.value); } catch { /* optional quote */ }
    return { ...identity, action: intent.action, intent, context, address: context.address, grantHash: context.grantHash, player, delegate: context.delegate,
      unsigned: true, transaction, instructions: [instruction], transactionBytes, messageBytes, transactionBase64: base64(transactionBytes), messageBase64: base64(messageBytes),
      requiredSigners: [player.toBase58()], signatureCount: 0, ...block, readSlot: context.slot,
      instructionDetails: [{ programId: instruction.programId.toBase58(), accounts: instruction.keys.map(a => ({ address: a.pubkey.toBase58(), isSigner: a.isSigner, isWritable: a.isWritable })), dataHex: hex(instruction.data) }],
      simulation: { passed: true, signatureVerification: false, slot: simulation.context.slot, unitsConsumed: simulation.value.unitsConsumed ?? null, logs: simulation.value.logs ?? [] },
      networkFee: { lamports: networkFeeLamports, excludes: 'Account rent; this is not a transfer or token allowance' },
      checks: { accountIdentity: context.checks.accountIdentity, exactSimulatedMessage: true, signatureVerification: false, rpcFinality: false },
      next: 'Review exact limits, identity, instructions and expiry; sign this unchanged message with the player wallet and submit through the selected devnet RPC. Retain the signed signature before sending and reconcile any uncertain result before retrying.' };
  }
  async function prepareGrant(input) {
    const bounds = terms(input), context = await readGrant(input);
    fail(bounds.expiresAtTs > context.chainNowTs && bounds.expiresAtTs <= context.chainNowTs + MAX_DELEGATE_LIFETIME_SECONDS && context.chainNowTs + MAX_DELEGATE_LIFETIME_SECONDS <= I64_MAX,
      'Grant expiry must be in the future and no more than 30 days from the chain clock');
    const proposal = { schema: 2, bump: context.bump, grantId: context.grantId, economyHash, rulesetHash, player: context.player, delegate: context.delegate,
      ...bounds, grossStakeUsed: 0n, shotsUsed: 0, lastSealTs: 0n, revoked: 0 };
    validateShape(proposal, context.economy, context.ruleset);
    if (context.grant) {
      fail(context.grant.revoked === 0, 'A revoked grant cannot be revived; choose a new nonzero grantId');
      expectedHash(input.expectedGrantHash, context.grantHash, 'Existing grant');
      Object.assign(proposal, { grossStakeUsed: context.grant.grossStakeUsed, shotsUsed: context.grant.shotsUsed, lastSealTs: context.grant.lastSealTs });
      validateShape(proposal, context.economy, context.ruleset);
    } else fail(input.expectedGrantHash === undefined || input.expectedGrantHash === null, 'Expected grant is absent; review before creating a new grant');
    const payload = new Uint8Array(46), view = new DataView(payload.buffer);
    payload.set(context.grantId, 0); view.setBigUint64(16, bounds.maxStake, true); view.setBigUint64(24, bounds.maxGrossStake, true);
    view.setUint16(32, bounds.maxShots, true); view.setUint32(34, bounds.minIntervalSeconds, true); view.setBigInt64(38, bounds.expiresAtTs, true);
    const instruction = client.buildIx('ratchet-core-g2', 'grant_delegate', { player: context.player,
      economy: client.economyPda(economyHash)[0], ruleset: client.rulesetPda(rulesetHash)[0], delegate: context.delegate,
      delegate_grant: context.address, system_program: web3.SystemProgram.programId }, payload);
    return prepare(instruction, context, { action: 'grant_delegate', operation: context.grant ? 'update-existing-grant' : 'create-new-grant',
      grantId: hex(context.grantId), player: context.player.toBase58(), delegate: context.delegate.toBase58(),
      limits: bounds, preservedUsage: { grossStakeUsed: proposal.grossStakeUsed, shotsUsed: proposal.shotsUsed, lastSealTs: proposal.lastSealTs },
      permissions: 'Only delegated seals in this exact Economy and Ruleset, within these cumulative stake/count/time limits. No token-transfer or wallet-spending authority is granted.' });
  }
  async function prepareRevoke(input) {
    const context = await readGrant(input); fail(context.grant, 'No DelegateGrant account exists to revoke');
    if (input.expectedGrantHash !== undefined) expectedHash(input.expectedGrantHash, context.grantHash, 'Grant');
    const instruction = client.buildIx('ratchet-core-g2', 'revoke_delegate', { economy: client.economyPda(economyHash)[0], ruleset: client.rulesetPda(rulesetHash)[0],
      delegate_grant: context.address, player: context.player });
    return prepare(instruction, context, { action: 'revoke_delegate', grantId: hex(context.grantId), alreadyRevoked: context.grant.revoked === 1,
      effect: 'Permanently blocks new seals under this grant. Existing Shots remain completable by their frozen delegate; revocation does not refund or cancel them.' });
  }
  return Object.freeze({ client, deriveGrant, readGrant, prepareGrant, prepareRevoke, grantAllows });
}

