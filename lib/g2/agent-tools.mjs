import { createBrowserGame, DEVNET_GENESIS, DEVNET_PROGRAMS } from './browser-game.mjs';
import { createPlayerActions } from './player-actions.mjs';
import { reconstructArchiveSnapshot } from './archive-result.mjs';

export const MCP_PROTOCOL = '2025-11-25';
export const MCP_SERVER = Object.freeze({ name: 'ratchetx-g2', version: '0.1.0' });
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const U64_MAX = (1n << 64n) - 1n;
const fail = (condition, message) => { if (!condition) throw new Error(message); };
const hash = (text, label) => {
  fail(typeof text === 'string' && /^[a-f0-9]{64}$/i.test(text), label + ' must be 64 hex characters');
  return Uint8Array.from(text.match(/../g), x => parseInt(x, 16));
};
const exact = (text, label) => {
  fail(typeof text === 'string' && /^(0|[1-9][0-9]*)$/.test(text), label + ' must be an unsigned decimal string');
  const n = BigInt(text); fail(n <= U64_MAX, label + ' exceeds u64'); return n;
};
const hex = data => Array.from(data, x => x.toString(16).padStart(2, '0')).join('');
const str = description => ({ type: 'string', description });
const decimal = description => ({ ...str(description), pattern: '^(0|[1-9][0-9]*)$' });
const player = str('Solana player public key. Never send a private key.');
const nonce = decimal('Exact Shot nonce, not an automatically selected next nonce.');
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const tool = (name, description, inputSchema) => ({ name, description, inputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } });
const TOOLS = Object.freeze([
  tool('g2_get_game', 'Read validated on-chain rules, admission targets, program upgrade authorities and trust limits. DEVNET test credits only.', object({})),
  tool('g2_get_player', 'Read the validated on-chain credit ledger and exact next nonce. No general credit faucet or real token allocation is available.', object({ player })),
  tool('g2_get_shot', 'Read a validated live Shot; for a closed Shot supply its successful terminal signature to reconstruct the revealed result from permanent on-chain evidence.', object({ player, nonce, terminalSignature: str('Optional successful terminal transaction signature, not a seal or settle signature.') }, ['player', 'nonce'])),
  tool('g2_prepare_seal', 'Build and simulate an unsigned atomic seal transaction from an agent-generated commitment. Keep side, confidence and 32-byte random salt local. Requires current nonce, sufficient existing on-chain credits, and exact targets from g2_get_player. Does not sign or submit.', object({ player, nonce, stake: decimal('Existing test credits to stake.'), commitment: { ...str('Canonical client commitmentHash hex, generated and saved locally with the reveal secret.'), pattern: '^[a-fA-F0-9]{64}$' }, expectedEntryTargetTs: decimal('Exact displayed entry target Unix seconds.'), expectedExitTargetTs: decimal('Exact displayed exit target Unix seconds.') })),
  tool('g2_get_reveal_context', 'Read the public Shot commitment, state and reveal deadline. Reveal secrets are never accepted by this remote interface.', object({ player, nonce })),
]);
const LOCAL_REVEAL = tool('g2_prepare_reveal_local', 'LOCAL STDIO ONLY. Verify your saved reveal secret against the live AwaitReveal Shot, then prepare an unsigned reveal. The selected RPC receives the public reveal bytes during simulation; call only when ready to reveal. Never give this secret to the remote MCP endpoint.', object({ player, nonce, side: { type: 'integer', enum: [0, 1], description: '0 DOWN, 1 UP.' }, pBps: { type: 'integer', minimum: 1, maximum: 9999 }, salt: { ...str('Locally saved 32-byte reveal salt, hex.'), pattern: '^[a-fA-F0-9]{64}$' } }));

// Avoid PublicKey/Buffer custom toJSON behavior: all u64/i64 values are decimal
// strings, raw public bytes are hex, and public keys remain base58.
export function publicJson(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value?.toBase58) return value.toBase58();
  if (value instanceof Uint8Array) return hex(value);
  if (Array.isArray(value)) return value.map(publicJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, publicJson(v)]));
  return value;
}
function validateArguments(definition, args) {
  fail(args && typeof args === 'object' && !Array.isArray(args), 'Tool arguments must be an object');
  const schema = definition.inputSchema;
  for (const key of Object.keys(args)) fail(Object.hasOwn(schema.properties, key), 'Unexpected argument: ' + key);
  for (const key of schema.required) fail(Object.hasOwn(args, key), 'Missing argument: ' + key);
  for (const [key, value] of Object.entries(args)) {
    const p = schema.properties[key];
    fail(p.type === 'integer' ? Number.isInteger(value) : typeof value === p.type, 'Invalid type: ' + key);
    if (typeof value === 'string') fail(value.length <= 160, 'Argument too long: ' + key);
    if (p.pattern) fail(new RegExp(p.pattern).test(value), 'Invalid format: ' + key);
    if (p.enum) fail(p.enum.includes(value), 'Invalid value: ' + key);
    if (p.minimum !== undefined) fail(value >= p.minimum && value <= p.maximum, 'Out of range: ' + key);
  }
}

/** Stateless, keyless adapter. No DB, wallet, local storage, signing or sending.
 * The dependency injection is for local RPC selection and deterministic tests;
 * HTTP never accepts an RPC URL from a caller.
 */
export function createG2AgentTools({ web3, connection, config, cryptoImpl = globalThis.crypto, local = false }) {
  const key = value => new web3.PublicKey(value);
  const contextFor = (who = null) => createBrowserGame({ web3, connection, config, cryptoImpl, storage: null,
    wallet: who ? { publicKey: key(who), signTransaction: () => { throw new Error('Signing is not part of MCP'); } } : null });
  const game = contextFor(), client = game.client;
  const actions = createPlayerActions({ client, web3 });
  const definitions = local ? [...TOOLS, LOCAL_REVEAL] : [...TOOLS];
  const identity = { cluster: 'devnet', genesisHash: DEVNET_GENESIS, programs: DEVNET_PROGRAMS,
    economyHash: config.economyHash, rulesetHash: config.rulesetHash, evidenceSpecHash: config.evidenceSpecHash };
  const limits = { rpcDataCryptographicallyVerified: false, validatorConsensusIndependentlyVerified: false,
    rpcCommitment: 'confirmed', ledgerHistoryReplayed: false,
    assumptions: ['Solana consensus and RPC availability/data integrity', 'Pyth oracle data and pinned oracle generation', 'Retained program upgrade authorities'],
    localVerification: 'Use your own RPC and the published canonical client. Compare identity, every account and instruction byte before signing.' };

  async function authorities(minContextSlot) {
    const ids = [key(config.programs.core), key(config.programs.timepin)];
    const dataKeys = ids.map(id => client.programDataPda(id)[0]);
    const read = await connection.getMultipleAccountsInfoAndContext([...ids, ...dataKeys], { commitment: 'confirmed', minContextSlot, dataSlice: { offset: 0, length: 45 } });
    fail(Number.isSafeInteger(read?.context?.slot) && read.context.slot >= minContextSlot && read.value?.length === 4, 'Incomplete program authority snapshot');
    return ids.map((id, index) => {
      const p = read.value[index], d = read.value[index + 2];
      fail(p && d && p.executable === true && d.executable === false && key(p.owner).toBase58() === LOADER && key(d.owner).toBase58() === LOADER, 'Invalid upgradeable program owner/state');
      const pd = new DataView(p.data.buffer, p.data.byteOffset, p.data.length);
      const dd = new DataView(d.data.buffer, d.data.byteOffset, d.data.length);
      fail(p.data.length === 36 && pd.getUint32(0, true) === 2 && key(p.data.subarray(4, 36)).equals(dataKeys[index]), 'ProgramData identity mismatch');
      fail(d.data.length >= 45 && dd.getUint32(0, true) === 3 && (d.data[12] === 0 || d.data[12] === 1), 'Invalid ProgramData metadata');
      return { program: id, programData: dataKeys[index], deploymentSlot: dd.getBigUint64(4, true),
        upgradeAuthority: d.data[12] === 1 ? key(d.data.subarray(13, 45)) : null, immutable: d.data[12] === 0, readSlot: read.context.slot };
    });
  }

  async function unsigned(instructions, payer, readSlot, intent) {
    fail(await connection.getGenesisHash() === DEVNET_GENESIS, 'RPC is not Solana devnet');
    const allowed = new Set([config.programs.core, config.programs.timepin]);
    for (const ix of instructions) {
      fail(allowed.has(ix.programId.toBase58()), 'Unexpected transaction program');
      for (const account of ix.keys) fail(!account.isSigner || account.pubkey.equals(payer), 'Unexpected signer');
    }
    const block = await connection.getLatestBlockhash({ commitment: 'confirmed', minContextSlot: readSlot });
    fail(typeof block?.blockhash === 'string' && Number.isSafeInteger(block.lastValidBlockHeight) && block.lastValidBlockHeight > 0, 'Incomplete blockhash response');
    const message = new web3.TransactionMessage({ payerKey: payer, recentBlockhash: block.blockhash, instructions }).compileToV0Message();
    const tx = new web3.VersionedTransaction(message), raw = tx.serialize();
    fail(raw.length <= 1232 && tx.signatures.length === 1 && tx.signatures.every(s => s.every(b => b === 0)), 'Unexpected transaction size or signature shape');
    const simulation = await connection.simulateTransaction(tx, { commitment: 'confirmed', sigVerify: false, minContextSlot: readSlot });
    fail(Number.isSafeInteger(simulation?.context?.slot) && simulation.context.slot >= readSlot && simulation?.value && simulation.value.err === null, 'Simulation refused the action: ' + JSON.stringify(simulation?.value?.err ?? 'no response'));
    // The exact simulated message is what the caller receives, not a separately
    // rebuilt or later blockhash-replaced transaction.
    fail(hex(raw) === hex(tx.serialize()), 'Transaction changed during simulation');
    let fee = { lamports: null, scope: 'Network fee only; excludes account rent, cleanup bond and staked test credits.' };
    try {
      const result = await connection.getFeeForMessage(message, 'confirmed');
      if (Number.isSafeInteger(result?.value) && result.value >= 0) fee = { ...fee, lamports: String(result.value) };
    } catch { /* Fee availability does not change the exact simulated message. */ }
    return { ...identity, intent, unsigned: true, signatureCount: 0, requiredSigners: [payer.toBase58()],
      transactionFormat: 'Solana v0, no address lookup tables', transactionBase64: Buffer.from(raw).toString('base64'),
      messageBase64: Buffer.from(message.serialize()).toString('base64'), payer, ...block, readSlot,
      instructions: instructions.map(ix => ({ programId: ix.programId, accounts: ix.keys.map(a => ({ address: a.pubkey, isSigner: a.isSigner, isWritable: a.isWritable })), dataHex: hex(ix.data) })),
      simulation: { passed: true, signatureVerification: false, slot: simulation.context?.slot ?? null, unitsConsumed: simulation.value.unitsConsumed ?? null, logs: simulation.value.logs ?? [] },
      networkFee: fee, verificationLimits: limits,
      next: 'Rebuild with the canonical local client and compare messageBase64. Sign locally only after reviewing every instruction. Submit through your own RPC before lastValidBlockHeight; retain the signed signature before submission and reconcile uncertain outcomes before any retry.' };
  }
  async function revealContext(args) {
    const selected = contextFor(args.player), context = await selected.load();
    const result = await selected.readShot({ player: args.player, nonce: exact(args.nonce, 'nonce') });
    const deadline = result.shot?.revealDeadlineTs;
    return { context, result, ready: result.kind === 'account' && result.shot.state === 3 && typeof deadline === 'bigint' && context.chainNowTs < deadline };
  }
  async function call(name, args = {}) {
    const definition = definitions.find(t => t.name === name);
    fail(definition, 'Unknown or unavailable G2 tool');
    validateArguments(definition, args);
    if (args.player) key(args.player);
    if (name === 'g2_get_game') {
      const context = await game.load(), programs = await authorities(context.slot);
      return publicJson({ ...identity, scope: 'DEVNET_TEST_CREDITS_ONLY', ...context, programUpgrades: programs,
        access: { protocolPermissionlessForEligibleLedger: true, websiteAdmission: config.admission,
          generalCreditFaucet: false, realFundedClaimEnabled: false,
          explanation: 'Anyone can read and submit canonical protocol instructions. Playing requires existing credits; the current devnet snapshot allocates test credits to one wallet only. A website switch is not a protocol authorization gate.' },
        decentralization: { fullyDecentralized: programs.every(p => p.immutable) ? null : false,
          explanation: 'Economic transitions are executed on chain. Retained upgrade authority can change program code; Solana, RPC and the Pyth oracle remain trust and availability assumptions.' },
        verificationLimits: limits });
    }
    if (name === 'g2_get_player') {
      const context = await contextFor(args.player).load();
      return publicJson({ ...identity, ...context, ledgerAddress: client.ledgerPda(hash(config.economyHash, 'economyHash'), key(args.player))[0],
        hasCredits: Boolean(context.ledger && context.ledger.credits >= context.economy.args.minStake),
        testAllocation: context.allocation ? { credits: context.allocation.credits, xp: context.allocation.xp } : null,
        verificationLimits: limits });
    }
    if (name === 'g2_get_shot') {
      const snapshot = await game.readShot({ ...args, nonce: exact(args.nonce, 'nonce') });
      const result = await reconstructArchiveSnapshot({ snapshot, connection, client, web3, cryptoImpl });
      return publicJson({ ...result, verificationLimits: limits });
    }
    if (name === 'g2_prepare_seal') {
      const context = await contextFor(args.player).load(), payer = key(args.player);
      fail(context.ledger, 'This player has no on-chain credit ledger; there is no general test-credit faucet');
      const chosenNonce = exact(args.nonce, 'nonce');
      fail(context.ledger.nextShotNonce === chosenNonce, 'Stale nonce: refresh the on-chain player ledger; never reuse a commitment for a different nonce');
      fail(context.timing.entryTargetTs === exact(args.expectedEntryTargetTs, 'expectedEntryTargetTs') && context.timing.exitTargetTs === exact(args.expectedExitTargetTs, 'expectedExitTargetTs'), 'Target grid moved: refresh and explicitly accept the new targets');
      const commit = hash(args.commitment, 'commitment'); fail(commit.some(Boolean), 'Commitment must be nonzero');
      const plan = await client.buildForwardAdmission({ ...context, player: payer, nonce: chosenNonce, stake: exact(args.stake, 'stake'), commit });
      return publicJson(await unsigned(plan.instructions, payer, context.slot, { action: 'seal_forward', player: payer, nonce: chosenNonce,
        stake: args.stake, commitment: args.commitment.toLowerCase(), timing: plan.timing, addresses: plan.addresses,
        commitmentPreimageVerified: false, secret: 'Only you can verify the commitment preimage. Retain the random salt, side, probability, identity and nonce locally before signing.' }));
    }
    const { context, result, ready } = await revealContext(args);
    if (name === 'g2_get_reveal_context') return publicJson({ ...identity, ...result, chainNowTs: context.chainNowTs, readyToReveal: ready,
      revealSecretTransport: 'Local process only. Use g2_prepare_reveal_local with the stdio adapter when ready to publish, or canonical createPlayerActions.revealIx.', verificationLimits: limits });
    fail(local && name === 'g2_prepare_reveal_local', 'Reveal secrets are local-only');
    fail(ready, 'Shot is not within its AwaitReveal window');
    const ix = await actions.revealIx({ economy: result.economy, ruleset: result.ruleset, shotAddress: result.addresses.shot,
      shot: result.shot, side: args.side, pBps: args.pBps, salt: hash(args.salt, 'salt') });
    return publicJson(await unsigned([ix], key(args.player), result.slot, { action: 'reveal', player: args.player, nonce: args.nonce,
      commitmentPreimageVerified: true, disclosure: 'The reveal transaction contains the prediction and salt. Its bytes were sent to the selected RPC for simulation.' }));
  }
  return Object.freeze({ definitions, call });
}

export async function handleG2JsonRpc(message, adapter) {
  const id = message?.id ?? null;
  const error = (code, text) => ({ jsonrpc: '2.0', id, error: { code, message: text } });
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' ||
      (Object.hasOwn(message, 'id') && !(typeof message.id === 'string' || Number.isSafeInteger(message.id)))) return error(-32600, 'Invalid JSON-RPC request');
  if (!Object.hasOwn(message, 'id')) return null;
  if (message.method === 'initialize') return { jsonrpc: '2.0', id, result: { protocolVersion: MCP_PROTOCOL,
    capabilities: { tools: { listChanged: false } }, serverInfo: MCP_SERVER,
    instructions: 'DEVNET only. Read identity/rules and ledger first. Generate and retain commitment secrets locally. All preparation returns unsigned transactions. Inspect and sign locally; no signing or sending service exists here. Retained upgrade authorities and RPC/oracle trust are disclosed by g2_get_game.' } };
  if (message.method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (message.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: adapter.definitions } };
  if (message.method !== 'tools/call') return error(-32601, 'Method not found');
  if (!message.params || typeof message.params.name !== 'string') return error(-32602, 'Tool name is required');
  try {
    const output = await adapter.call(message.params.name, message.params.arguments ?? {});
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output, isError: false } };
  } catch (err) {
    // The adapter errors refer to field names, invariants or RPC errors. Never
    // echo submitted tool arguments (the local-only reveal may contain a salt).
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(err?.message || 'G2 read/preparation failed') }], isError: true } };
  }
}


