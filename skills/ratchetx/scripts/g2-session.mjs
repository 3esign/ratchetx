#!/usr/bin/env node
// Local-only agent identity and CLI. No key leaves this process or its private state.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { runInThisContext } from 'node:vm';
import { createDelegateActions } from '../../../lib/g2/delegate-actions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const WEB3_SHA256 = '09cdbea951b2ed0e11bcbe3aeb1ee9f035f9fb51ed212aca645475ae82688cc3';
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/g2/devnet-config.json'), 'utf8'));
const PUBLIC_IDENTITY = 'identity.json', PRIVATE_IDENTITY = 'delegate-secret.json';
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (ok, code) => { if (!ok) { const e = new Error(code); e.code = code; throw e; } };
const publicJson = value => JSON.parse(JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? v.toString() : v));
let web3Cache;
export function loadWeb3() {
  if (web3Cache) return web3Cache;
  const source = fs.readFileSync(path.join(ROOT, 'vendor/solana-web3-1.98.4.min.js'));
  fail(sha(source) === WEB3_SHA256, 'RUNTIME_INTEGRITY_FAILED');
  // This is the existing version-pinned public vendor artifact, never downloaded input.
  // Keep native typed-array constructors, so the canonical client validation is unchanged.
  web3Cache = runInThisContext('(function(crypto) {\n' + source.toString('utf8') + '\nreturn solanaWeb3;\n})',
    { filename: 'ratchetx-pinned-solana-web3-1.98.4.js' })(webcrypto);
  return web3Cache;
}
export function stateRoot() {
  const configured = process.env.RATCHET_G2_HOME;
  fail(!configured || path.isAbsolute(configured), 'STATE_HOME_MUST_BE_ABSOLUTE');
  return configured || path.join(os.homedir(), '.ratchetx-g2');
}
function privateRoot(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const info = fs.lstatSync(dir);
  fail(info.isDirectory() && !info.isSymbolicLink(), 'UNSAFE_STATE_HOME');
  if (process.platform !== 'win32') fail((info.mode & 0o077) === 0, 'STATE_HOME_PERMISSIONS');
}
function readStateFile(dir, name) {
  const file = path.join(dir, name), info = fs.lstatSync(file);
  fail(info.isFile() && !info.isSymbolicLink() && info.size <= 8192, 'UNSAFE_STATE_FILE');
  if (process.platform !== 'win32') fail((info.mode & 0o077) === 0, 'STATE_FILE_PERMISSIONS');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function createStateFile(dir, name, value) {
  const file = path.join(dir, name), fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}
function validateIdentity(identity, web3) {
  fail(identity && identity.schema === 1 && identity.scope === 'DEVNET_AGENT_LOCAL' && identity.clusterGenesis === GENESIS &&
    identity.economyHash === CONFIG.economyHash && identity.rulesetHash === CONFIG.rulesetHash &&
    typeof identity.player === 'string' && typeof identity.delegate === 'string' && /^[a-f0-9]{32}$/.test(identity.grantId), 'STATE_IDENTITY_MISMATCH');
  const player = new web3.PublicKey(identity.player), delegate = new web3.PublicKey(identity.delegate);
  // player === delegate is self-play (the agent's own devnet wallet); distinct keys are delegation.
  fail(player.toBase58() === identity.player && delegate.toBase58() === identity.delegate, 'STATE_IDENTITY_MISMATCH');
  return identity;
}
export function readPublicIdentity(dir = stateRoot()) {
  fail(fs.existsSync(path.join(dir, PUBLIC_IDENTITY)), 'SETUP_REQUIRED');
  privateRoot(dir);
  return validateIdentity(readStateFile(dir, PUBLIC_IDENTITY), loadWeb3());
}
// Recovery removes only a dead process's machine lock in the identity's exact
// wallet scope. It never edits a prediction, key, nonce, signed bytes or grant.
export function recoverLock(identity, dir, { checkPid = pid => process.kill(pid, 0) } = {}) {
  const scope = JSON.stringify({ schema: 1, clusterGenesis: GENESIS, economyHash: identity.economyHash,
    rulesetHash: identity.rulesetHash, player: identity.player });
  const journalRoot = path.join(dir, 'journal'), scopeDir = path.join(journalRoot, sha(scope)), lock = path.join(scopeDir, 'session.lock');
  fail(path.resolve(lock).startsWith(path.resolve(journalRoot) + path.sep), 'UNSAFE_STATE_FILE');
  if (!fs.existsSync(lock)) return { ok: true, code: 'NO_RECOVERY_LOCK', noTransactionSent: true, reply: 'No abandoned lock is present. Existing commands and keys are unchanged.' };
  for (const item of [journalRoot, scopeDir]) {
    const stat = fs.lstatSync(item); fail(stat.isDirectory() && !stat.isSymbolicLink(), 'UNSAFE_STATE_FILE');
  }
  const stat = fs.lstatSync(lock); fail(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024, 'UNSAFE_STATE_FILE');
  const original = fs.readFileSync(lock), record = JSON.parse(original.toString('utf8'));
  fail(Number.isSafeInteger(record.pid) && record.pid > 0 && Number.isFinite(Date.parse(record.createdAt)), 'INVALID_RECOVERY_LOCK');
  let dead = false;
  try { checkPid(record.pid); } catch (error) { if (error.code === 'ESRCH') dead = true; }
  fail(dead, 'SESSION_PROCESS_STILL_RUNNING_OR_UNKNOWN');
  const current = fs.lstatSync(lock);
  fail(current.isFile() && !current.isSymbolicLink() && current.ino === stat.ino && current.dev === stat.dev &&
    fs.readFileSync(lock).equals(original), 'RECOVERY_LOCK_CHANGED');
  fs.unlinkSync(lock);
  return { ok: true, code: 'DEAD_PROCESS_LOCK_RECOVERED', previousPid: record.pid, noTransactionSent: true,
    reply: 'The exited process’s lock was removed. Your saved prediction and signer were preserved. Reconcile the same source command ID before any further action.' };
}
export const isSelfPlay = identity => identity.player === identity.delegate;
function setupResult(identity) {
  if (isSelfPlay(identity)) return { ok: true, code: 'SELF_PLAY_READY', scope: 'DEVNET_TEST_CREDITS_ONLY', ...identity, noTransactionSent: true,
    reply: 'Your agent plays with its own devnet wallet ' + identity.player + '. Nothing to sign anywhere else: the first play claims 10,000 devnet test credits and seals the prediction. Devnet test credits; no RCX payout.' };
  const url = new URL('https://ratchetx.xyz/agent-setup');
  url.searchParams.set('delegate', identity.delegate); url.searchParams.set('grant', identity.grantId); url.searchParams.set('player', identity.player);
  return { ok: true, code: 'OWNER_GRANT_REQUIRED', scope: 'DEVNET_TEST_CREDITS_ONLY', ...identity,
    setupUrl: url.toString(), noTransactionSent: true,
    reply: 'Your devnet agent is ready for setup. Open this link in your player wallet to choose its limits: ' + url + '\nNo grant or transaction has been sent.' };
}
function initialize(playerText, dir) {
  const web3 = loadWeb3();
  // No --player (or --player self): the agent's own key is the player. Anyone on X can play
  // without a wallet of their own; a human who wants the record on THEIR wallet passes it.
  const self = playerText === undefined || playerText === 'self';
  let player = null;
  if (!self) { fail(typeof playerText === 'string', 'PLAYER_REQUIRED'); player = new web3.PublicKey(playerText).toBase58();
    fail(player === playerText && player !== '11111111111111111111111111111111', 'INVALID_PLAYER'); }
  privateRoot(dir);
  if (fs.existsSync(path.join(dir, PUBLIC_IDENTITY))) {
    const identity = readPublicIdentity(dir); fail(self ? isSelfPlay(identity) : identity.player === player, 'STATE_PLAYER_CONFLICT');
    fail(fs.existsSync(path.join(dir, PRIVATE_IDENTITY)), 'LOCAL_SIGNER_MISSING');
    return setupResult(identity);
  }
  let privateRecord;
  if (fs.existsSync(path.join(dir, PRIVATE_IDENTITY))) {
    privateRecord = readStateFile(dir, PRIVATE_IDENTITY);
    validateIdentity(privateRecord.identity, web3);
    fail(self ? isSelfPlay(privateRecord.identity) : privateRecord.identity.player === player, 'STATE_PLAYER_CONFLICT');
  } else {
    const signer = web3.Keypair.generate();
    const identity = { schema: 1, scope: 'DEVNET_AGENT_LOCAL', clusterGenesis: GENESIS,
      economyHash: CONFIG.economyHash, rulesetHash: CONFIG.rulesetHash, player: self ? signer.publicKey.toBase58() : player,
      delegate: signer.publicKey.toBase58(), grantId: randomBytes(16).toString('hex') };
    privateRecord = { identity, secret: Buffer.from(signer.secretKey).toString('base64') };
    createStateFile(dir, PRIVATE_IDENTITY, privateRecord);
  }
  const signer = privateSigner(privateRecord, privateRecord.identity, web3);
  fail(signer.publicKey.toBase58() === privateRecord.identity.delegate, 'LOCAL_SIGNER_MISMATCH');
  createStateFile(dir, PUBLIC_IDENTITY, privateRecord.identity);
  return setupResult(privateRecord.identity);
}
function privateSigner(record, identity, web3) {
  fail(record?.identity && JSON.stringify(record.identity) === JSON.stringify(identity) &&
    typeof record.secret === 'string', 'LOCAL_SIGNER_MISMATCH');
  const secret = Buffer.from(record.secret, 'base64');
  fail(secret.length === 64 && secret.toString('base64') === record.secret, 'LOCAL_SIGNER_MISMATCH');
  const signer = web3.Keypair.fromSecretKey(Uint8Array.from(secret)); secret.fill(0);
  fail(signer.publicKey.toBase58() === identity.delegate, 'LOCAL_SIGNER_MISMATCH');
  return signer;
}
// The bundled SDK is browser-compatible; do not require a host WebSocket shim.
// This confirms only the already signed exact signature, using public HTTP reads.
export async function confirmWithHttp(connection, strategy, commitment = 'confirmed', {
  timeoutMs = 60000, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  fail(strategy && typeof strategy.signature === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(strategy.signature) &&
    Number.isSafeInteger(strategy.lastValidBlockHeight) && strategy.lastValidBlockHeight > 0 &&
    ['confirmed', 'finalized'].includes(commitment), 'INVALID_CONFIRMATION_REQUEST');
  const deadline = now() + timeoutMs;
  for (;;) {
    const read = await connection.getSignatureStatuses([strategy.signature], { searchTransactionHistory: true });
    fail(Array.isArray(read?.value) && read.value.length === 1, 'SIGNATURE_STATUS_UNAVAILABLE');
    const status = read.value[0];
    if (status && (status.confirmationStatus === 'finalized' || commitment === 'confirmed' && status.confirmationStatus === 'confirmed'))
      return { context: read.context, value: { err: status.err } };
    if (!status && await connection.getBlockHeight('finalized') > strategy.lastValidBlockHeight) fail(false, 'TRANSACTION_EXPIRED');
    if (now() >= deadline) fail(false, 'TRANSACTION_CONFIRMATION_UNCERTAIN');
    await sleep(Math.min(1500, Math.max(0, deadline - now())));
  }
}
function connectionFor(web3) {
  const endpoint = process.env.RATCHET_G2_RPC || 'https://api.devnet.solana.com';
  const url = new URL(endpoint);
  fail(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'UNSAFE_RPC_URL');
  fail(!url.username && !url.password, 'UNSAFE_RPC_URL');
  // Every chain action additionally validates the devnet genesis and pinned generation.
  // The public devnet RPC rate-limits by IP; a first play (claim + reads + seal) is a burst. Retry
  // 429 with backoff instead of failing the whole prediction on a free endpoint's mood.
  const patientFetch = async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(input, { ...init, signal: AbortSignal.timeout(20000) });
      if (response.status !== 429 || attempt >= 5) return response;
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
    }
  };
  const connection = new web3.Connection(endpoint, { commitment: 'confirmed', disableRetryOnRateLimit: true, fetch: patientFetch });
  connection.confirmTransaction = (strategy, commitment) => confirmWithHttp(connection, strategy, commitment);
  return connection;
}
// Devnet fee self-funding. The delegate is a throwaway devnet key that only pays network
// fees and rent; the devnet faucet is free and needs no credential, so an agent host never has
// to hand-fund it. Guarded to the pinned devnet genesis: on any other cluster this is a no-op.
// Failure (rate limit, faucet down) is reported, never thrown - the caller still sees the true balance.
export const FEE_FLOOR_LAMPORTS = 5_000_000n;      // 0.005 SOL: below this a shot may not cover rent + fees
export const FEE_AIRDROP_LAMPORTS = 50_000_000;    // 0.05 SOL per top-up, well under the faucet cap
export async function ensureDevnetFeeBalance(identity, web3, connection, { airdrop = (k, l) => connection.requestAirdrop(k, l) } = {}) {
  const key = new web3.PublicKey(identity.delegate);
  const before = BigInt(await connection.getBalance(key, 'confirmed'));
  if (before >= FEE_FLOOR_LAMPORTS) return { before, after: before, airdrop: null };
  if (identity.clusterGenesis !== GENESIS || await connection.getGenesisHash() !== GENESIS) return { before, after: before, airdrop: 'skipped: not devnet' };
  try {
    const signature = await airdrop(key, FEE_AIRDROP_LAMPORTS);
    const { blockhash: _b, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    await connection.confirmTransaction({ signature, lastValidBlockHeight }, 'confirmed');
    const after = BigInt(await connection.getBalance(key, 'confirmed'));
    return { before, after, airdrop: signature };
  } catch (error) { return { before, after: before, airdrop: 'failed: ' + (error?.message || String(error)).slice(0, 120) }; }
}
async function selfView(identity, web3, connection, signer = null) {
  const { createBrowserGame } = await import('../../../lib/g2/browser-game.mjs');
  const wallet = signer ? { publicKey: signer.publicKey, signTransaction: async tx => { tx.sign([signer]); return tx; } }
    : { publicKey: new web3.PublicKey(identity.player), signTransaction: () => { throw new Error('read-only'); } };
  const mem = new Map();
  const storage = { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k), key: i => [...mem.keys()][i], get length() { return mem.size; } };
  return createBrowserGame({ web3, connection, config: CONFIG, wallet, storage, cryptoImpl: webcrypto });
}
// Self-play: make sure the agent wallet holds fee SOL and test credits before a seal. Claims once.
async function ensureSelfCredits(identity, web3, connection, signer) {
  const funding = await ensureDevnetFeeBalance(identity, web3, connection);
  if (funding.after === 0n) return { blocked: publicJson({ ok: false, code: 'DELEGATE_FEE_BALANCE_REQUIRED', scope: 'DEVNET_TEST_CREDITS_ONLY', mode: 'self-play', player: identity.player, feeFunding: funding.airdrop, noTransactionSent: true,
    reply: 'No prediction was sent. The agent wallet ' + identity.player + ' has no devnet SOL for fees and rent, and the devnet faucet refused an airdrop just now. Send it a little devnet SOL (faucet.solana.com) and repeat the same command.' }) };
  const game = await selfView(identity, web3, connection, signer);
  const before = await game.load();
  if (before.ledger && before.ledger.credits >= before.economy.args.minStake) return { claimed: null, credits: before.ledger.credits };
  fail(!before.ledger || (before.ledger.legacyCredits === 0n && before.ledger.legacyXp === 0n), 'INSUFFICIENT_CREDITS');
  const out = await game.claim();
  return { claimed: out.signature, credits: out.ledger.credits };
}
async function preflight(identity, web3, connection) {
  if (isSelfPlay(identity)) {
    const funding = await ensureDevnetFeeBalance(identity, web3, connection);
    const view = await (await selfView(identity, web3, connection)).load();
    const credits = view.ledger?.credits ?? 0n, claimable = !view.ledger || (view.ledger.legacyCredits === 0n && view.ledger.legacyXp === 0n);
    const ready = Number(funding.after) > 0 && (credits >= view.economy.args.minStake || claimable);
    return publicJson({ ok: ready, code: ready ? 'PREFLIGHT_READY' : Number(funding.after) === 0 ? 'DELEGATE_FEE_BALANCE_REQUIRED' : 'NO_TEST_CREDIT_ALLOCATION',
      scope: 'DEVNET_TEST_CREDITS_ONLY', mode: 'self-play', player: identity.player, delegate: identity.delegate, playerCredits: String(credits), claimPending: claimable && credits < view.economy.args.minStake,
      delegateLamports: String(funding.after), feeFunding: funding.airdrop, readOnly: true, noTransactionSent: true,
      reply: ready ? (credits >= view.economy.args.minStake ? 'Devnet agent ready: ' + credits + ' test credits.' : 'Devnet agent ready. The first play claims 10,000 test credits, then seals.')
        : Number(funding.after) === 0 ? 'Your agent needs devnet SOL for transaction fees and account rent. Its public address: ' + identity.delegate
        : 'This agent wallet has no test credits left and its one-time claim is used. No prediction can be sent.' });
  }
  const actions = createDelegateActions({ web3, connection, config: CONFIG, cryptoImpl: webcrypto });
  const context = await actions.readGrant(identity);
  const funding = await ensureDevnetFeeBalance(identity, web3, connection);
  const balance = Number(funding.after);
  const permission = context.usage?.minimumStakePermission;
  const allocated = !!context.ledger && context.ledger.credits >= context.economy.args.minStake;
  const ready = context.kind === 'account' && permission?.ok === true && balance > 0 && allocated;
  return publicJson({ ok: ready, code: ready ? 'PREFLIGHT_READY' : !context.grant ? 'OWNER_GRANT_REQUIRED' : !allocated ? 'NO_TEST_CREDIT_ALLOCATION' : balance === 0 ? 'DELEGATE_FEE_BALANCE_REQUIRED' : 'GRANT_NOT_READY',
    scope: 'DEVNET_TEST_CREDITS_ONLY', player: identity.player, delegate: identity.delegate, grantId: identity.grantId,
    grantAddress: context.address.toBase58(), grantPresent: !!context.grant, grantHash: context.grantHash,
    grant: context.grant ? { maxStake: context.grant.maxStake, maxGrossStake: context.grant.maxGrossStake, maxShots: context.grant.maxShots,
      expiresAtTs: context.grant.expiresAtTs, minIntervalSeconds: context.grant.minIntervalSeconds } : null,
    usage: context.usage, playerCredits: String(context.ledger?.credits ?? 0n), delegateLamports: String(balance), feeFunding: funding.airdrop, readOnly: true, noTransactionSent: true,
    reply: ready ? 'Devnet agent grant checked. Ready within your on-chain limits; fees and account rent are checked before each shot.' :
      !context.grant ? 'One setup step remains: approve this agent’s limits in your player wallet. ' + setupResult(identity).setupUrl :
      !allocated ? 'This player has no devnet test credits yet. Any wallet can claim 10,000 once at https://ratchetx.xyz/play (a devnet transaction the player signs); then play. No prediction was sent.' :
      balance === 0 ? 'Your agent needs devnet SOL for transaction fees and account rent. Its public address: ' + identity.delegate :
      'The current grant cannot accept a new shot yet. Check its remaining limits and expiry on the setup page.' });
}
function argumentsFor(argv) {
  const command = argv[0] || 'help', flags = {};
  for (let i = 1; i < argv.length; i += 2) {
    fail(['--player', '--say', '--command-id'].includes(argv[i]) && argv[i + 1] !== undefined && !Object.hasOwn(flags, argv[i]), 'INVALID_ARGUMENTS');
    flags[argv[i]] = argv[i + 1];
  }
  const allowed = { help: [], init: ['--player'], setup: ['--player'], preflight: [], play: ['--say', '--command-id'], status: [],
    reconcile: ['--command-id'], reveal: ['--command-id'], finish: ['--command-id'], 'recover-lock': [] }[command];
  fail(allowed && Object.keys(flags).every(key => allowed.includes(key)), 'INVALID_ARGUMENTS');
  if (['play', 'reconcile', 'reveal', 'finish'].includes(command)) fail(/^(?:[0-9]{1,32}|[a-f0-9]{32})$/.test(flags['--command-id'] || ''), 'COMMAND_ID_REQUIRED');
  if (command === 'play') fail(typeof flags['--say'] === 'string' && flags['--say'].length > 0 && flags['--say'].length <= 4000, 'USER_TEXT_REQUIRED');
  return { command, flags };
}
// Resume one existing command. Never chooses an intent or creates another shot.
export async function finishCommand(runner, commandId, { timeoutMs = 45 * 60 * 1000, pollMs = 30000,
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  fail(Number.isFinite(timeoutMs) && timeoutMs >= 0 && timeoutMs <= 60 * 60 * 1000, 'INVALID_ARGUMENTS');
  const deadline = now() + timeoutMs;
  let result = await runner.reconcile({ commandId });
  for (;;) {
    if (result.stage === 'archived' || result.stage === 'refused' || result.stage === 'seal-not-landed' || result.nonce === undefined) return result;
    result = await runner.reveal({ commandId });
    if (result.stage === 'archived' || result.stage === 'refused' || result.stage === 'seal-not-landed') return result;
    if (now() >= deadline) return { ...result, ok: false, code: 'FINISH_WAIT_EXPIRED',
      reply: 'This prediction is still pending. Its saved command and reveal key are preserved; resume finish with the same source ID. No second prediction was sent.\nPyth prices · https://ratchetx.xyz/proof' };
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
  }
}
export async function runCli(argv, { rootDir = stateRoot() } = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  fail(major > 20 || major === 20 && minor >= 11, 'NODE_20_11_REQUIRED');
  const { command, flags } = argumentsFor(argv);
  if (command === 'help') return { ok: true, code: 'HELP', reply: 'RatchetX G2 devnet: init --player PUBLIC_KEY; preflight; play --say USER_WORDS --command-id SOURCE_POST_ID; status; reconcile --command-id SOURCE_POST_ID; reveal --command-id SOURCE_POST_ID; finish --command-id SOURCE_POST_ID; recover-lock. Keep one persistent private state directory. Test credits only. Pyth prices · https://ratchetx.xyz/play' };
  if (command === 'init' || command === 'setup') return initialize(flags['--player'], rootDir);
  // A public X command on a fresh host must not die on SETUP_REQUIRED: set up self-play and go on.
  if (!fs.existsSync(path.join(rootDir, PUBLIC_IDENTITY))) initialize(undefined, rootDir);
  const identity = readPublicIdentity(rootDir);
  if (command === 'recover-lock') return recoverLock(identity, rootDir);
  const web3 = loadWeb3(), connection = connectionFor(web3);
  if (command === 'preflight') return preflight(identity, web3, connection);
  const { createAgentSession, createAgentFileStorage } = await import('../../../lib/g2/agent-session.mjs');
  const keypair = command === 'status' ? null : privateSigner(readStateFile(rootDir, PRIVATE_IDENTITY), identity, web3);
  const signer = { publicKey: new web3.PublicKey(identity.delegate), signTransaction: async transaction => {
    fail(keypair, 'READ_ONLY_COMMAND'); transaction.sign([keypair]); return transaction;
  } };
  const runner = createAgentSession({ web3, connection, config: CONFIG, session: identity, signer,
    storage: createAgentFileStorage({ rootDir: path.join(rootDir, 'journal') }), cryptoImpl: webcrypto });
  try {
    if (command === 'status') return await runner.status();
    if (command === 'finish') return await finishCommand(runner, flags['--command-id']);
    if (command === 'play') {
      if (isSelfPlay(identity)) { const ready = await ensureSelfCredits(identity, web3, connection, keypair); if (ready.blocked) return ready.blocked; } else await ensureDevnetFeeBalance(identity, web3, connection);
      return await runner.runCommand({ commandId: flags['--command-id'], text: flags['--say'] });
    }
    return await runner[command]({ commandId: flags['--command-id'] });
  } finally { if (keypair) keypair.secretKey.fill(0); }
}
const SAFE_ERRORS = new Set(['NODE_20_11_REQUIRED', 'RUNTIME_INTEGRITY_FAILED', 'STATE_HOME_MUST_BE_ABSOLUTE', 'UNSAFE_STATE_HOME', 'STATE_HOME_PERMISSIONS',
  'UNSAFE_STATE_FILE', 'STATE_FILE_PERMISSIONS', 'STATE_IDENTITY_MISMATCH', 'SETUP_REQUIRED', 'PLAYER_REQUIRED', 'INVALID_PLAYER',
  'STATE_PLAYER_CONFLICT', 'LOCAL_SIGNER_MISSING', 'LOCAL_SIGNER_MISMATCH', 'UNSAFE_RPC_URL', 'INVALID_ARGUMENTS', 'COMMAND_ID_REQUIRED', 'USER_TEXT_REQUIRED', 'READ_ONLY_COMMAND', 'SESSION_BUSY_OR_RECOVERY_LOCK',
  'INVALID_RECOVERY_LOCK', 'SESSION_PROCESS_STILL_RUNNING_OR_UNKNOWN', 'RECOVERY_LOCK_CHANGED', 'INSUFFICIENT_CREDITS']);
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.stdout.write(JSON.stringify(await runCli(process.argv.slice(2)), (_key, v) => typeof v === 'bigint' ? v.toString() : v) + '\n'); }
  catch (error) {
    const requested = error?.code || error?.message;
    const code = SAFE_ERRORS.has(requested) ? requested : 'AGENT_CHECK_FAILED';
    process.stdout.write(JSON.stringify({ ok: false, code, reply: 'RatchetX could not finish this check. Keep your current agent state and the same source command ID; do not create a replacement shot. ' + code + '\nhttps://ratchetx.xyz/agent-setup' }) + '\n');
    process.exitCode = 1;
  }
}
