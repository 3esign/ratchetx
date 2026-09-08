import { createBrowserGame, DEVNET_GENESIS } from './browser-game.mjs';
import { renderShotView, formatChainTime } from './shot-view.mjs';
import { explorerLink } from './read-game.mjs';
import { reconstructArchiveSnapshot } from './archive-result.mjs';
import { sentenceForResult, saveReaderResult } from '../g2-text/say.mjs';
const $ = id => document.getElementById(id), web3 = globalThis.solanaWeb3;
let config, connection, game, provider = null, context = null, selectedSide = null, busy = false, currentShot = null, lastRefresh = 0;
const time = value => formatChainTime(value).replace(/^\d{4}-\d\d-\d\d /, '');
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function download(name, content) { const url = URL.createObjectURL(new Blob([content], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
const phases = { simulating: 'Checking the transaction on devnet…', signing: 'Review and approve the transaction in your wallet.', sending: 'Sending the signed transaction to devnet…', confirming: 'Waiting for devnet confirmation…', reading: 'Reading the confirmed result from the chain…', sealed: 'Prediction sealed. Your reveal key is saved on this device.', revealed: 'Prediction revealed. Reading the terminal receipt.' };
function makeGame(wallet = null) { return createBrowserGame({ web3, connection, config, wallet, onStatus: event => status(phases[event.phase] || event.phase) }); }
function updateControls() {
  $('seal').disabled = config?.admission?.enabled !== true || busy || !provider?.publicKey || !context?.ledger || selectedSide === null || context.ledger.credits < context.economy.args.minStake;
  $('seal').firstChild.textContent = config?.admission?.enabled !== true ? 'New shots open when keeper is ready ' : !provider?.publicKey ? 'Connect to seal your prediction ' : !context?.ledger || context.ledger.credits < context.economy.args.minStake ? 'Test credits required ' : selectedSide === null ? 'Pick UP or DOWN ' : 'Seal ' + (selectedSide ? 'UP' : 'DOWN') + ' on ' + config.market.symbol + ' ';
  for (const id of ['connect', 'claim', 'refresh', 'watch']) $(id).disabled = busy;
  for (const button of document.querySelectorAll('.direction')) button.disabled = busy;
  $('stake').disabled = busy; $('confidence').disabled = busy;
}
async function run(work) { if (busy) return; busy = true; document.body.classList.add('busy'); updateControls(); try { await work(); } catch (error) { status(error.message || String(error), true); } finally { busy = false; document.body.classList.remove('busy'); updateControls(); } }
function renderSaved() {
  const root = $('saved-games'); root.replaceChildren();
  if (!provider?.publicKey) { root.textContent = 'Connect to open your saved shots.'; $('chamber-count').textContent = '0'; return; }
  const records = game.savedGames(); $('chamber-count').textContent = String(records.length);
  if (!records.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'No shots saved on this device yet.'; root.append(p); }
  for (const record of records) {
    const button = document.createElement('button'); button.className = 'saved-shot';
    const name = document.createElement('strong'); name.textContent = 'Shot #' + record.nonce;
    const stage = document.createElement('small'); stage.textContent = record.stage.replaceAll('-', ' '); button.append(name, stage);
    button.onclick = () => run(async () => { const out = await game.reconcile({ nonce: record.nonce }); await presentShot(out.result, { player: provider.publicKey.toBase58(), nonce: record.nonce, terminalSignature: game.savedGames().find(r => r.nonce === record.nonce)?.terminalSignature }); renderSaved(); status(out.pending ? 'The transaction is still unresolved. Your saved key and signature are retained.' : 'Shot read from devnet.'); }); root.append(button);
  }
}
async function presentShot(result, selection) {
  if (result.kind === 'archive' && result.receipt.event.result.state === 4) {
    try { result = await reconstructArchiveSnapshot({ snapshot: result, connection, client: game.client, web3 }); }
    catch (error) { result = { ...result, verificationError: error.message || String(error) }; }
  }
  showShot(result, selection);
}
function showShot(result, selection) {
  currentShot = selection; $('shot').hidden = false;
  $('proof-note').textContent = result.checks?.resultOutcomeAndXp === true ? 'Outcome and XP match the archived game hash. Account balances and the complete history are separate checks.' : 'Account identity and transaction provenance are checked. Replaying the result is a separate verification.';
  // The separately owned presentation adapter supplies public proof and text;
  // a private reveal-key backup never substitutes for a public saved game.
  renderShotView($('shot-view'), result, { web3, summaryText: sentenceForResult(result, { feed: config.market.symbol, evidenceSpec: context?.evidenceSpec }),
    onSave: result.kind === 'unavailable' ? undefined : () => run(async () => download('ratchetx-devnet-shot-' + selection.nonce + '.json', JSON.stringify(saveReaderResult(result, { feed: config.market.symbol }), null, 2))),
    onRefresh: () => run(refreshCurrentShot) });
  const actions = $('shot-actions'); actions.replaceChildren();
  const own = provider?.publicKey?.toBase58() === selection.player, saved = own && game.savedGames().find(row => row.nonce === selection.nonce);
  if (saved) { const b = document.createElement('button'); b.className = 'button small'; b.textContent = 'Back up reveal key'; b.onclick = () => run(async () => download('ratchetx-private-reveal-' + selection.nonce + '.json', game.exportRevealKey(selection.nonce))); actions.append(b); }
  if (own && saved && result.kind === 'account' && result.shot.state === 3) {
    const b = document.createElement('button'); b.className = 'button small'; b.textContent = 'Reveal prediction'; b.onclick = () => run(async () => { const out = await game.reveal({ nonce: selection.nonce }); await presentShot(out.result, { ...selection, terminalSignature: out.signature }); await refresh(); status('Your prediction is revealed. The receipt comes from the confirmed transaction.'); }); actions.append(b);
  }
  $('shot').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
}
async function readSelection(selection) {
  let result = await game.readShot(selection);
  if (result.kind !== 'unavailable' || selection.terminalSignature || selection.player !== config.watchPlayer || selection.nonce !== config.watchNonce) return result;
  const response = await fetch('/releases/g2-devnet-run.json', { cache: 'no-store' });
  if (response.status === 404) return result;
  if (!response.ok) throw new Error('The shared-run receipt is unavailable; no terminal outcome was inferred');
  const run = await response.json();
  if (run.clusterGenesis !== config.clusterGenesis || run.programs?.core !== config.programs.core ||
      run.programs?.timepin !== config.programs.timepin || run.economyHash !== config.economyHash ||
      run.rulesetHash !== config.rulesetHash || run.payer !== selection.player || selection.nonce !== '0')
    throw new Error('The published run receipt belongs to a different game');
  const terminalNames = ['reveal', 'void_pending_entry', 'void_active_shot', 'finalize_resolved_void', 'forfeit'];
  const terminal = run.steps?.findLast(step => step.ok === true && terminalNames.includes(step.step));
  if (!terminal) return result;
  // The run only locates a signature. The reader authenticates the actual Core event.
  selection.terminalSignature = terminal.signature;
  return game.readShot(selection);
}
async function refreshCurrentShot() {
  if (!currentShot) return;
  let result;
  if (provider?.publicKey?.toBase58() === currentShot.player && game.savedGames().some(r => r.nonce === currentShot.nonce)) { result = (await game.reconcile({ nonce: currentShot.nonce })).result; currentShot.terminalSignature = game.savedGames().find(r => r.nonce === currentShot.nonce)?.terminalSignature; }
  else result = await readSelection(currentShot);
  await presentShot(result, currentShot); renderSaved();
}
async function refresh() {
  context = null; updateControls(); const value = await game.load(); context = value; lastRefresh = Date.now();
  $('horizon').textContent = value.ruleset.args.horizonSeconds % 60 === 0 ? value.ruleset.args.horizonSeconds / 60 + ' min' : value.ruleset.args.horizonSeconds + ' sec';
  $('board-title').firstChild.textContent = config.market.symbol + ' '; $('chain-state').textContent = 'Rules registered';
  $('entry-time').textContent = time(value.timing.entryTargetTs); $('exit-time').textContent = time(value.timing.exitTargetTs);
  $('evidence-window').textContent = 'The price window is ' + $('horizon').textContent + '. Oracle evidence closes at ' + time(value.timing.captureDeadlineTs) + '; settlement can follow after that.';
  $('updated').textContent = 'Read at ' + new Date(lastRefresh).toLocaleTimeString() + ' · slot ' + value.slot.toLocaleString();
  $('credits').textContent = value.ledger ? value.ledger.credits.toLocaleString('en-US') : '—'; $('xp').textContent = value.ledger ? value.ledger.xp.toLocaleString('en-US') : '—';
  $('wallet-name').textContent = value.player ? value.player.toBase58() : 'Not connected'; $('stake').title = 'Allowed stake: ' + value.economy.args.minStake + ' to ' + value.economy.args.maxStake + ' credits';
  const claimed = value.ledger && (value.ledger.legacyCredits > 0n || value.ledger.legacyXp > 0n); $('claim').hidden = !value.player || claimed; $('claim').textContent = value.allocation ? 'Claim your test credits' : 'Claim 10,000 test credits';
  $('allocation-note').textContent = !value.player ? 'Connect to read your on-chain ledger.' : claimed ? 'Your test credits are already claimed. Credits shown above come from your devnet ledger.' : value.allocation ? 'This wallet can claim ' + BigInt(value.allocation.credits).toLocaleString('en-US') + ' test credits from the migration snapshot.' : 'Any wallet may claim 10,000 devnet test credits once. The program opens this door only on the devnet economy; the claim is a devnet transaction you sign.';
  $('rule-timing').textContent = 'Registered rules: grid ' + value.ruleset.args.targetGridSeconds + ' seconds; admissible lag ' + value.evidenceSpec.args.maxPostTargetLagSeconds + ' seconds; capture grace ' + value.evidenceSpec.args.captureGraceSeconds + ' seconds. Reveal within ' + value.economy.args.revealWindowSeconds + ' seconds of settlement, according to the stored deadline.';
  renderSaved(); updateControls();
}
async function connect() {
  if (provider?.publicKey) { await provider.disconnect?.(); provider = null; game = makeGame(); $('connect').textContent = 'Connect wallet'; await refresh(); return; }
  const candidate = globalThis.phantom?.solana || globalThis.solflare || globalThis.solana;
  if (!candidate?.connect || !candidate?.signTransaction) throw new Error('Open this page in your Solana wallet browser or enable your wallet extension, then connect. The shared run can be watched without a wallet.');
  await candidate.connect(); if (!candidate.publicKey) throw new Error('No wallet was connected'); provider = candidate; game = makeGame(provider);
  const address = provider.publicKey.toBase58(); $('connect').textContent = address.slice(0, 6) + '…' + address.slice(-5);
  candidate.on?.('accountChanged', () => { context = null; currentShot = null; $('shot').hidden = true; status('Wallet changed. Refresh to load the selected wallet.'); updateControls(); });
  await refresh(); status('Wallet connected. Every game action asks for your approval.');
}
for (const button of document.querySelectorAll('.direction')) button.onclick = () => { selectedSide = Number(button.dataset.side); for (const item of document.querySelectorAll('.direction')) item.setAttribute('aria-pressed', String(item === button)); updateControls(); };
$('confidence').oninput = () => { $('confidence-value').textContent = $('confidence').value + '%'; };
$('connect').onclick = () => run(connect);
$('refresh').onclick = () => run(async () => { await refresh(); status('Registered game and ledger refreshed from devnet.'); });
$('claim').onclick = () => run(async () => { await game.claim(); await refresh(); status('Test credits claimed and read back from your ledger.'); });
$('seal').onclick = () => run(async () => { if(config.admission?.enabled !== true) throw new Error(config.admission?.reason || 'New shots are not open yet'); const out = await game.seal({ side: selectedSide, pBps: Number($('confidence').value) * 100, stake: $('stake').value.trim(), expectedTargets: context?.timing }); const nonce = String(out.result.shot.nonce); await refresh(); await presentShot(out.result, { player: provider.publicKey.toBase58(), nonce }); status('Shot #' + nonce + ' sealed. Keep the reveal key and return when the chain is ready for reveal.'); });
$('watch').onclick = () => run(async () => { const selection = { player: config.watchPlayer, nonce: config.watchNonce }; const terminal = new URLSearchParams(location.search).get('terminal'); if (terminal) selection.terminalSignature = terminal; const result = await readSelection(selection); await presentShot(result, selection); status(result.kind === 'unavailable' ? 'The shared shot has no available live account or terminal receipt yet.' : 'Showing the funded devnet wallet; it is separate from your connected wallet.'); });
$('restore-key').onchange = () => run(async () => { const file = $('restore-key').files[0]; if (!file) return; if (file.size > 12000) throw new Error('This reveal-key file is too large'); const out = await game.importRevealKey(await file.text()); renderSaved(); await presentShot(out.result, { player: provider.publicKey.toBase58(), nonce: out.nonce }); status('Reveal key restored and matched to the live Shot.'); $('restore-key').value = ''; });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !busy && game && Date.now() - lastRefresh > 60000) run(async () => { await refresh(); }); });
try {
  if (!web3) throw new Error('The local Solana client did not load'); const response = await fetch('/lib/g2/devnet-config.json', { cache: 'no-store' }); if (!response.ok) throw new Error('The registered devnet configuration is not published yet'); config = await response.json();
  connection = new web3.Connection('https://api.devnet.solana.com', { commitment: 'confirmed', disableRetryOnRateLimit: true }); game = makeGame();
  const links = $('program-links');
  for (const [label, value] of Object.entries(config.programs)) { const a = document.createElement('a'); a.href = explorerLink({ genesisHash: DEVNET_GENESIS, kind: 'address', value }); a.textContent = (label === 'core' ? 'Core program' : 'Timepin program') + ' · devnet ↗'; a.target = '_blank'; a.rel = 'noopener noreferrer'; links.append(a); }
  for (const row of config.registration) { const a = document.createElement('a'); a.href = explorerLink({ genesisHash: DEVNET_GENESIS, kind: 'tx', value: row.signature }); a.textContent = row.step.replaceAll('_', ' ') + ' · devnet ↗'; a.target = '_blank'; a.rel = 'noopener noreferrer'; links.append(a); }
  await refresh(); status(config.admission?.enabled === true ? 'Registered devnet rules loaded. Connect to play, or inspect the shared devnet run.' : 'The first devnet run is complete. Inspect its result below; new shots open when the keeper is ready.');
  // /proof is the receipt room: the same page, opened on the shared devnet shot so a proof link lands on a receipt, not on a form.
  if (/^\/proof\/?$/.test(location.pathname)) { $('watch').click(); $('watch').scrollIntoView?.({ block: 'start' }); }
} catch (error) { context = null; status(error.message, true); $('chain-state').textContent = 'Read unavailable'; updateControls(); }
