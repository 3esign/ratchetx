// Local delegated G2 execution. A source post ID is deduplication, not X auth:
// the caller must authenticate the requester before invoking this capability.
// No legacy bearer, remote signing service, scheduler or automatic new shots.
import { createHash, webcrypto, createPublicKey, verify } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { classifyCommand, resolveIntent } from '../../skills/ratchetx/scripts/session-play.mjs';
import { createDelegateActions } from './delegate-actions.mjs';
import { createBrowserGame } from './browser-game.mjs';
import { createPlayerActions } from './player-actions.mjs';
import { createGameReader } from './read-game.mjs';
import { reconstructArchiveSnapshot } from './archive-result.mjs';
import { sealForwardDelegatedIx, revealDelegatedIx } from '../../onchain/ratchet-core-g2/client/delegate.mjs';
import { formatG2Reply, DEVNET_GENESIS, FOOTER, TOKEN } from './x-reply.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const hex = value => Buffer.from(value).toString('hex');
const equal = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const need = (condition, code) => { if (!condition) throw new Error(code); };
const bytes = (value, size) => {
  if (typeof value === 'string' && new RegExp('^[a-f0-9]{' + size * 2 + '}$', 'i').test(value)) return Buffer.from(value, 'hex');
  if (value instanceof Uint8Array && value.length === size) return Buffer.from(value);
  throw new Error('INVALID_IDENTITY');
};
const commandId = value => {
  need(typeof value === 'string' && /^(?:[0-9]{1,32}|[a-f0-9]{32})$/.test(value), 'EXACT_SOURCE_POST_ID_REQUIRED');
  return value;
};
const decimal = value => {
  const n = BigInt(value); need(n >= 0n && n <= BigInt(Number.MAX_SAFE_INTEGER), 'PARSER_INTEGER_RANGE'); return Number(n);
};
const publicReply = (code, text, extra = {}, ok = true) => ({ ok, code,
  reply: text + '\nDevnet test credits; no RCX payout.\n\n' + FOOTER, token: TOKEN, ...extra });
const metadata = record => ({ commandId: record.commandId, stage: record.stage,
  ...(record.nonce === undefined ? {} : { nonce: record.nonce }),
  ...(record.transactions?.seal ? { sealSignature: record.transactions.seal.signature } : {}),
  ...(record.terminalSignature ? { terminalSignature: record.terminalSignature } : {}) });

/** Stable, fsynced, private local journal; one wallet lock across all grants.
 * An abandoned lock fails closed. Do not remove it until its process is known
 * to have exited; never switch to an empty directory to recover a pending shot.
 * Injected storage must provide the same exclusive/durable contract.
 */
export function createAgentFileStorage({ rootDir = join(homedir(), '.ratchetx-g2', 'journal') } = {}) {
  const paths = scope => { const directory = join(rootDir, sha(scope)); return { directory, journal: join(directory, 'session.json'), lock: join(directory, 'session.lock') }; };
  return Object.freeze({
    async withLock(scope, work) {
      const p = paths(scope); await mkdir(p.directory, { recursive: true, mode: 0o700 });
      let handle;
      try { handle = await open(p.lock, 'wx', 0o600); }
      catch (error) { if (error.code === 'EEXIST') throw new Error('SESSION_BUSY_OR_RECOVERY_LOCK'); throw error; }
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })); await handle.sync(); return await work(); }
      finally { await handle.close(); await unlink(p.lock); }
    },
    async read(scope) { try { return JSON.parse(await readFile(paths(scope).journal, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } },
    async write(scope, state) {
      const p = paths(scope), data = JSON.stringify(state), temporary = join(p.directory, 'session.' + process.pid + '.tmp');
      const handle = await open(temporary, 'w', 0o600);
      try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, p.journal);
      need(await readFile(p.journal, 'utf8') === data, 'JOURNAL_WRITE_FAILED');
    },
  });
}

/** signer is agent-local {publicKey, signTransaction}; it must be the delegate.
 * storage: withLock(scope,fn), read(scope), write(scope,state), all async.
 * Every returned object is safe JSON; private reveal and signed bytes stay in
 * storage. Public source post text must never include a reveal salt or key.
 */
export function createAgentSession({ web3, connection, config, session, signer,
  storage = createAgentFileStorage(), cryptoImpl = webcrypto, onStatus = () => {} } = {}) {
  need(config?.clusterGenesis === DEVNET_GENESIS, 'DEVNET_REQUIRED');
  // Retry rate-limited reads only. A send is never retried by this wrapper.
  const readMethods = new Set(['getGenesisHash', 'getMultipleAccountsInfoAndContext', 'getTransaction',
    'getSignaturesForAddress', 'getSignatureStatuses', 'getBlockHeight', 'getLatestBlockhash']);
  const transport = connection;
  connection = new Proxy(transport, { get(target, name) {
    const value = Reflect.get(target, name);
    if (typeof value !== 'function') return value;
    if (!readMethods.has(name)) return value.bind(target);
    return async (...args) => {
      for (let attempt = 0; ; attempt++) {
        try { return await value.apply(target, args); }
        catch (error) {
          if (attempt >= 2 || !(error.status === 429 || error.code === 429 || /429|too many requests|rate.?limit/i.test(error.message || ''))) throw error;
          try { onStatus({ phase: 'waiting-for-rpc' }); } catch {}
          await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
        }
      }
    };
  } });
  const player = new web3.PublicKey(session?.player), delegate = new web3.PublicKey(session?.delegate);
  // Self-play: the local key IS the player. No grant, no owner, nothing to sign elsewhere -
  // the agent claims its own devnet credits and seals as owner. Delegated mode (distinct
  // player) keeps every grant check below.
  const selfPlay = player.equals(delegate);
  const identity = { player, delegate, grantId: bytes(session?.grantId, 16) };
  const economyHash = bytes(config.economyHash, 32), rulesetHash = bytes(config.rulesetHash, 32);
  const grants = createDelegateActions({ web3, connection, config, cryptoImpl }), client = grants.client;
  const actions = createPlayerActions({ client, web3 });
  const reader = createGameReader({ connection, client, web3, expectedGenesisHash: DEVNET_GENESIS });
  const ownerView = createBrowserGame({ web3, connection, config, cryptoImpl, storage: null,
    wallet: { publicKey: player, signTransaction: () => { throw new Error('context reads do not sign'); } } });
  // One shape for both modes: economy/ruleset/evidenceSpec/ledger/chainNowTs/timing, plus grant when delegated.
  const readContext = async () => selfPlay
    ? { ...(await ownerView.load()), kind: 'account', grant: null, address: null }
    : grants.readGrant(identity);
  const isOurSigner = key => { const k = new web3.PublicKey(key); return k.equals(delegate) || (selfPlay && k.toBase58() === '11111111111111111111111111111111'); };
  const scope = JSON.stringify({ schema: 1, clusterGenesis: DEVNET_GENESIS,
    economyHash: hex(economyHash), rulesetHash: hex(rulesetHash), player: player.toBase58() });
  const sessionIdentity = JSON.stringify({ delegate: delegate.toBase58(), grantId: hex(identity.grantId) });
  need(['withLock', 'read', 'write'].every(name => typeof storage?.[name] === 'function'), 'DURABLE_STORAGE_REQUIRED');
  const notify = phase => { try { onStatus({ phase }); } catch {} };
  const signerBoundary = () => need(signer?.publicKey && new web3.PublicKey(signer.publicKey).equals(delegate)
    && typeof signer.signTransaction === 'function', 'LOCAL_DELEGATE_SIGNER_REQUIRED');
  const boundary = async () => need(await connection.getGenesisHash() === DEVNET_GENESIS, 'DEVNET_REQUIRED');
  const locked = work => storage.withLock(scope, async () => {
    const state = await storage.read(scope) || { schema: 1, scope, commands: {} };
    need(state.schema === 1 && state.scope === scope && state.commands && typeof state.commands === 'object', 'JOURNAL_IDENTITY_MISMATCH');
    const save = async () => { await storage.write(scope, state);
      need(JSON.stringify(await storage.read(scope)) === JSON.stringify(state), 'JOURNAL_WRITE_FAILED'); };
    return work(state, save);
  });
  const owned = (state, id) => {
    const record = state.commands[commandId(id)]; need(record, 'COMMAND_NOT_FOUND');
    need(record.sessionIdentity === sessionIdentity, 'SOURCE_POST_BOUND_TO_DIFFERENT_GRANT'); return record;
  };
  const read = async record => {
    const query = { economyHash, rulesetHash, player, nonce: BigInt(record.nonce) };
    let snapshot;
    try { snapshot = await reader.readGame({ ...query, terminalSignature: record.terminalSignature || record.transactions?.reveal?.signature }); }
    catch (error) {
      if (error.message !== 'Receipt extraction requires meta.err === null') throw error;
      snapshot = await reader.readGame(query); // A failed reveal is never a terminal receipt.
    }
    if (snapshot.kind === 'unavailable' && snapshot.reason !== 'configuration-account-absent') {
      const address = client.shotPda(economyHash, player, BigInt(record.nonce))[0];
      const rows = await connection.getSignaturesForAddress(address, { limit: 8 }, 'confirmed');
      for (const row of rows.filter(r => r.err === null && r.signature !== record.transactions?.seal?.signature).slice(0, 3)) {
        try {
          const found = await reader.readGame({ economyHash, rulesetHash, player, nonce: BigInt(record.nonce), terminalSignature: row.signature });
          if (found.kind === 'archive') { snapshot = found; record.terminalSignature = row.signature; break; }
        } catch (error) { if (error.message !== 'Transaction must contain exactly one archive for this game') throw error; }
      }
    }
    if (snapshot.kind === 'account') {
      need(equal(snapshot.shot.commit, bytes(record.commitment, 32)) && snapshot.shot.stake === BigInt(record.stake)
        && isOurSigner(snapshot.shot.delegate) && isOurSigner(snapshot.shot.rentRefund)
        && snapshot.shot.entryTargetTs === BigInt(record.entryTargetTs) && snapshot.shot.exitTargetTs === BigInt(record.exitTargetTs), 'SAVED_SHOT_MISMATCH');
    }
    if (snapshot.kind === 'archive') {
      const result = snapshot.receipt.event.result;
      const archivedCommit = result.state === 4 ? await client.commitmentHash({ economyHash, rulesetHash, player,
        nonce: BigInt(record.nonce), side: result.side, probability: result.pBps, salt: result.proofMaterial }) : result.proofMaterial;
      need(equal(archivedCommit, bytes(record.commitment, 32)) && result.stake === BigInt(record.stake)
        && isOurSigner(result.delegate) && result.entryTargetTs === BigInt(record.entryTargetTs)
        && result.exitTargetTs === BigInt(record.exitTargetTs), 'SAVED_ARCHIVE_MISMATCH');
      record.terminalSignature = snapshot.receipt.transaction.signature;
      try { snapshot = await reconstructArchiveSnapshot({ snapshot, connection, client, web3, cryptoImpl }); }
      catch { /* Authenticated archive stays honestly unverified in x-reply. */ }
    }
    return snapshot;
  };
  const display = (record, snapshot) => ({ ...formatG2Reply(snapshot), ...metadata(record) });
  const pending = record => publicReply('TRANSACTION_UNCERTAIN',
    'The transaction is being checked. No second prediction was sent.', metadata(record), false);

  async function reconcileRecord(record, save) {
    if (record.response) return record.response;
    if (record.nonce === undefined) return record.response || publicReply('COMMAND_NOT_EXECUTED', 'No prediction was sent.', metadata(record), false);
    if (!record.transactions?.seal) {
      record.stage = 'seal-not-landed'; record.response = publicReply('SEAL_NOT_LANDED', 'No prediction was sent. A new play needs a new source post.', metadata(record), false);
      await save(); return record.response;
    }
    const snapshot = await read(record);
    if (snapshot.kind === 'archive') { record.stage = 'archived'; await save(); return display(record, snapshot); }
    const tx = record.transactions?.reveal || record.transactions?.seal;
    if (snapshot.kind === 'account') {
      if (record.transactions?.reveal) {
        const statuses = await connection.getSignatureStatuses([tx.signature], { searchTransactionHistory: true });
        need(Array.isArray(statuses?.value) && statuses.value.length === 1, 'SIGNATURE_STATUS_UNAVAILABLE');
        const status = statuses.value[0];
        const failed = status?.err && status.confirmationStatus === 'finalized';
        const expiredAbsent = !status && await connection.getBlockHeight('finalized') > tx.lastValidBlockHeight;
        if (failed || expiredAbsent) {
          (record.failedTransactions ||= []).push({ purpose: 'reveal', ...tx });
          delete record.transactions.reveal;
          if (record.terminalSignature === tx.signature) delete record.terminalSignature;
        }
      }
      record.stage = record.transactions?.reveal ? 'reveal-pending' : 'sealed'; await save();
      return record.transactions?.reveal ? pending(record) : display(record, snapshot);
    }
    if (tx) {
      const statuses = await connection.getSignatureStatuses([tx.signature], { searchTransactionHistory: true });
      need(Array.isArray(statuses?.value) && statuses.value.length === 1, 'SIGNATURE_STATUS_UNAVAILABLE');
      const status = statuses.value[0];
      const expired = await connection.getBlockHeight('finalized') > tx.lastValidBlockHeight;
      if ((status?.err && status.confirmationStatus === 'finalized') || (!status && expired)) {
        const context = await readContext();
        if (!record.transactions.reveal && context.ledger?.nextShotNonce === BigInt(record.nonce)) {
          record.stage = 'seal-not-landed';
          record.response = publicReply('SEAL_NOT_LANDED', 'The prediction did not land. A new play needs a new source post.', metadata(record), false);
          await save(); return record.response;
        }
      }
    }
    await save(); return pending(record);
  }

  async function send(record, purpose, instructions, save) {
    signerBoundary(); await boundary();
    const block = await connection.getLatestBlockhash('confirmed');
    need(Number.isSafeInteger(block.lastValidBlockHeight) && block.lastValidBlockHeight > 0, 'INVALID_BLOCK_EXPIRY');
    const transaction = new web3.VersionedTransaction(new web3.TransactionMessage({
      payerKey: delegate, recentBlockhash: block.blockhash, instructions }).compileToV0Message());
    need(transaction.message.header.numRequiredSignatures === 1 && transaction.serialize().length <= 1232, 'UNEXPECTED_TRANSACTION_SIGNERS_OR_SIZE');
    const original = Buffer.from(transaction.message.serialize());
    notify('simulating');
    const simulation = await connection.simulateTransaction(transaction, { commitment: 'confirmed', sigVerify: false });
    need(equal(original, transaction.message.serialize()), 'SIMULATION_CHANGED_TRANSACTION');
    need(simulation?.value?.err === null, 'TRANSACTION_SIMULATION_REFUSED');
    signerBoundary(); await boundary(); notify('signing');
    const signed = await signer.signTransaction(transaction);
    signerBoundary();
    need(signed?.message && equal(original, signed.message.serialize()) && signed.signatures?.length === 1, 'SIGNER_CHANGED_TRANSACTION');
    const verifyingKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), delegate.toBuffer()]), format: 'der', type: 'spki' });
    need(verify(null, original, verifyingKey, signed.signatures[0]), 'INVALID_DELEGATE_SIGNATURE');
    // PublicKey base58 works only for 32 bytes; use the existing web3 base58
    // transaction signature convention without adding a package dependency.
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let n = BigInt('0x' + hex(signed.signatures[0])), signature = '';
    while (n) { signature = alphabet[Number(n % 58n)] + signature; n /= 58n; }
    for (const b of signed.signatures[0]) { if (b) break; signature = '1' + signature; }
    record.transactions[purpose] = { signature, blockhash: block.blockhash, lastValidBlockHeight: block.lastValidBlockHeight,
      rawBase64: Buffer.from(signed.serialize()).toString('base64'), messageHash: sha(original) };
    record.stage = purpose + '-signed'; await save(); // BEFORE any network send
    await boundary(); notify('sending');
    try {
      const returned = await connection.sendRawTransaction(Buffer.from(record.transactions[purpose].rawBase64, 'base64'), { skipPreflight: false, maxRetries: 2 });
      need(returned === signature, 'RPC_SIGNATURE_MISMATCH');
      const confirmed = await connection.confirmTransaction({ ...block, signature }, 'confirmed');
      need(confirmed?.value?.err === null, 'TRANSACTION_CONFIRMATION_UNCERTAIN');
      if (purpose === 'reveal') record.terminalSignature = signature;
      record.stage = purpose + '-confirmed'; await save();
      return await reconcileRecord(record, save);
    } catch {
      record.stage = purpose + '-uncertain'; await save(); return pending(record);
    }
  }

  async function execute(record, state, save) {
    need(config.admission?.enabled === true, 'ADMISSION_CLOSED'); signerBoundary();
    need(/\b(play|shoot|fire|bet|put|spend|wager|predict|higher|lower|up|down|long|short)\b/i.test(record.text), 'PLAY_INTENT_REQUIRED');
    const context = await readContext();
    need(selfPlay || (context.kind === 'account' && context.grant), 'OWNER_GRANT_REQUIRED');
    need(context.ledger && context.ledger.credits > 0n, 'NO_TEST_CREDIT_ALLOCATION');
    const horizon = context.ruleset.args.horizonSeconds / 60;
    need(Number.isInteger(horizon) && horizon >= 1 && config.market?.symbol === 'SOL', 'TARGET_UNAVAILABLE');
    const intent = resolveIntent(record.text, {
      board: { targets: [{ id: config.rulesetHash, kind: 'dir', feed: 'SOL', mins: horizon }], stakeRule: { max: decimal(context.economy.args.maxStake) } },
      context: { feeds: [] }, limits: selfPlay ? { maxStakeCredits: decimal(context.economy.args.maxStake), maxGrossCredits: decimal(context.ledger.credits) }
        : { maxStakeCredits: decimal(context.grant.maxStake), maxGrossCredits: decimal(context.grant.maxGrossStake) },
      session: { grossCredits: selfPlay ? '0' : decimal(context.grant.grossStakeUsed) }, player: { credits: decimal(context.ledger.credits) },
    });
    need(!intent.resolution.notes.some(note => note.startsWith('requested ') && note.includes('horizon unavailable')), 'TARGET_UNAVAILABLE');
    const stake = BigInt(intent.stake);
    if (!selfPlay) { const permit = grants.grantAllows({ grant: context.grant, economy: context.economy, nowTs: context.chainNowTs, stake }); need(permit.ok, 'GRANT_LIMIT_REFUSED'); }
    need(stake <= context.ledger.credits, 'INSUFFICIENT_CREDITS');
    const nonce = context.ledger.nextShotNonce;
    need(!Object.values(state.commands).some(other => other !== record && other.nonce === String(nonce)
      && !['seal-not-landed', 'refused'].includes(other.stage)), 'PRIOR_NONCE_UNRESOLVED');
    const salt = cryptoImpl.getRandomValues(new Uint8Array(32)), side = intent.side === 'YES' ? 1 : 0, pBps = Math.round(intent.p * 10000);
    const commitment = await client.commitmentHash({ economyHash, rulesetHash, player, nonce, side, probability: pBps, salt });
    const plan = await client.buildForwardAdmission({ ...context, player, stake, commit: commitment, nonce });
    Object.assign(record, { nonce: String(nonce), side, pBps, stake: String(stake), salt: hex(salt), commitment: hex(commitment),
      entryTargetTs: String(plan.timing.entryTargetTs), exitTargetTs: String(plan.timing.exitTargetTs), stage: 'prepared', transactions: {} });
    await save(); // Reserve nonce and private reveal material before signing.
    const instructions = selfPlay ? plan.instructions : [client.openHistoryPageIx({ actor: delegate, player, economyHash, pageIndex: plan.pageIndex }),
      client.openNeedIx({ actor: delegate, specHash: context.evidenceSpec.specHash, targetTs: plan.timing.entryTargetTs }),
      client.openNeedIx({ actor: delegate, specHash: context.evidenceSpec.specHash, targetTs: plan.timing.exitTargetTs }),
      sealForwardDelegatedIx(web3, { programId: client.coreProgram, delegate, ...plan.addresses, grantAddress: context.address,
        playerDay: client.playerDayPda(economyHash, plan.timing.scoreDay, player)[0],
        rankShard: (await client.rankShardPda(economyHash, plan.timing.scoreDay, player))[0], nonce, commit: commitment, stake,
        entryTargetTs: plan.timing.entryTargetTs, scoreDay: plan.timing.scoreDay })];
    return send(record, 'seal', instructions, save);
  }

  const runCommand = ({ commandId: id, text } = {}) => locked(async (state, save) => {
    commandId(id); need(typeof text === 'string' && text.length > 0 && text.length <= 4000, 'INVALID_COMMAND_TEXT');
    if (state.commands[id]) { const existing = owned(state, id); need(existing.textHash === sha(text), 'REQUEST_CONFLICT'); return reconcileRecord(existing, save); }
    const record = { commandId: id, text, textHash: sha(text), sessionIdentity, stage: 'received', createdAt: new Date().toISOString() };
    state.commands[id] = record; await save();
    const kind = classifyCommand(text);
    try {
      if (kind === 'execute') return await execute(record, state, save);
      let response;
      if (kind === 'meta') response = publicReply('META', 'That is a skill command; no prediction was sent.\nInstall or update the G2 skill: https://github.com/3esign/ratchetx/tree/main/skills/ratchetx-g2');
      else if (kind === 'status') {
        const latest = Object.values(state.commands).filter(r => r.sessionIdentity === sessionIdentity && r.nonce !== undefined).at(-1);
        if (latest) response = await reconcileRecord(latest, save);
        else { const context = await readContext(); response = publicReply('STATUS', 'Test credits: ' + (context.ledger?.credits ?? 0n) + '. No saved prediction yet.'); }
      } else if (kind === 'board') { const context = await readContext(); response = publicReply('BOARD', 'SOL higher or lower over ' + context.ruleset.args.horizonSeconds / 60 + ' min. Pyth prices.\nPlay: "@bankrbot play"'); }
      else if (kind === 'leaderboard') response = publicReply('LEADERBOARD', 'See the on-chain ranks and receipts at https://ratchetx.xyz/play.');
      else response = publicReply(kind.toUpperCase(), 'Sealed SOL predictions on Solana, with Pyth prices and public proof.\n@bankrbot play\n@bankrbot ratchetx put 100 on sol higher 70%\n@bankrbot ratchetx result\nCA ' + TOKEN.mint + '.');
      record.stage = 'read-only'; record.response = response; await save(); return response;
    } catch (error) {
      // Do not echo provider/signer errors: they can contain private request data.
      if (globalThis.process?.env?.RATCHET_G2_DEBUG) console.error('[agent-session]', error?.code || error?.message, error?.stack);
      if (record.transactions?.seal) { record.stage = 'seal-uncertain'; await save(); return pending(record); }
      const allowed = ['OWNER_GRANT_REQUIRED', 'NO_TEST_CREDIT_ALLOCATION', 'ASSET_NOT_ON_BOARD', 'ASSET_AMBIGUOUS',
        'TARGET_UNAVAILABLE', 'PLAY_INTENT_REQUIRED', 'GRANT_LIMIT_REFUSED', 'PRIOR_NONCE_UNRESOLVED', 'ADMISSION_CLOSED', 'LOCAL_DELEGATE_SIGNER_REQUIRED', 'INSUFFICIENT_CREDITS'];
      const code = allowed.includes(error.code || error.message) ? error.code || error.message : 'PLAY_REFUSED';
      record.stage = 'refused'; record.response = publicReply(code,
        code === 'NO_TEST_CREDIT_ALLOCATION' ? 'This wallet has no devnet test credits. No prediction was sent.' : 'No prediction was sent. ' + code.replaceAll('_', ' ').toLowerCase() + '.', metadata(record), false);
      await save(); return record.response;
    }
  });
  const reconcile = ({ commandId: id } = {}) => locked(async (state, save) => reconcileRecord(owned(state, id), save));
  const reveal = ({ commandId: id } = {}) => locked(async (state, save) => {
    const record = owned(state, id); need(record.nonce !== undefined, 'NO_SAVED_REVEAL');
    if (record.transactions?.reveal || record.stage === 'archived') return reconcileRecord(record, save);
    const snapshot = await read(record);
    if (snapshot.kind !== 'account' || snapshot.shot.state !== 3) return reconcileRecord(record, save);
    need(isOurSigner(snapshot.shot.delegate) && isOurSigner(snapshot.shot.rentRefund), 'FROZEN_DELEGATE_MISMATCH');
    // Owner builder validates every identity, PDA, probability and commitment;
    // delegated opcode replaces only its signer account with the frozen agent.
    const clockContext = await readContext();
    need(clockContext.chainNowTs < snapshot.shot.revealDeadlineTs, 'REVEAL_DEADLINE_PASSED');
    const ownerIx = await actions.revealIx({ economy: snapshot.economy, ruleset: snapshot.ruleset,
      shotAddress: snapshot.addresses.shot, shot: snapshot.shot, side: record.side, pBps: record.pBps, salt: bytes(record.salt, 32) });
    if (selfPlay) return send(record, 'reveal', [ownerIx], save);
    const keys = ownerIx.keys.map(k => k.pubkey);
    const ix = revealDelegatedIx(web3, { programId: client.coreProgram, economy: keys[0], ruleset: keys[1], ledger: keys[2], shot: keys[3],
      playerDay: keys[4], rankShard: keys[5], historyPage: keys[6], workPage: keys[7], delegate, rentRefund: keys[9], side: record.side, pBps: record.pBps, salt: bytes(record.salt, 32) });
    return send(record, 'reveal', [ix], save);
  });
  const status = () => locked(async (state, save) => {
    const latest = Object.values(state.commands).filter(r => r.sessionIdentity === sessionIdentity && r.nonce !== undefined).at(-1);
    if (latest) return reconcileRecord(latest, save);
    const context = await readContext();
    return publicReply('STATUS', 'Test credits: ' + (context.ledger?.credits ?? 0n) + '. No saved prediction yet.');
  });
  const savedCommands = () => locked(async state => Object.values(state.commands).filter(r => r.sessionIdentity === sessionIdentity).map(metadata));
  return Object.freeze({ runCommand, reconcile, reveal, status, savedCommands });
}
