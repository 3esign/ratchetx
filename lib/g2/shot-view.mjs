import { explorerLink } from './read-game.mjs';

const STATES = Object.freeze({ 1: 'Waiting for entry', 2: 'In play', 3: 'Ready to reveal',
  4: 'Revealed', 5: 'Voided', 6: 'Forfeited', 7: 'Awaiting void' });
const REASONS = Object.freeze({ 0: 'None', 1: 'Entry expired', 2: 'Entry ambiguous',
  3: 'Exit expired', 4: 'Exit ambiguous', 5: 'Equal prices', 6: 'Within the confidence band' });
const ADDRESS_FIELDS = new Set(['player', 'rentRefund', 'delegate', 'entryNeed', 'exitNeed',
  'activationWorker', 'resolver', 'forfeitWorker']);
const TIME_FIELDS = new Set(['sealedTs', 'entryTargetTs', 'exitTargetTs', 'activationTs',
  'entryPublishTime', 'exitPublishTime', 'settledTs', 'revealDeadlineTs', 'terminalTs']);
const ZERO_KEY = '11111111111111111111111111111111';
const own = (map, value, label) => Object.hasOwn(map, value) ? map[value] : 'Unknown ' + label + ' ' + value;
const nonzero = value => value instanceof Uint8Array && value.some(byte => byte !== 0);
const hex = value => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
const label = value => value.replace(/([A-Z])/g, ' $1').replace(/^./, first => first.toUpperCase());
const groups = [
  ['Game', ['player', 'delegate', 'nonce', 'state', 'voidReason', 'entryMode', 'stake', 'side', 'pBps', 'hit', 'xpAwarded']],
  ['Timing', ['sealedTs', 'entryTargetTs', 'exitTargetTs', 'revealDeadlineTs', 'scoreDay']],
  ['Prices and evidence', ['entryNeed', 'entryPrice', 'entryConf', 'entryExponent', 'entryPublishTime',
    'entryMessageHash', 'entryTimepinResultHash', 'exitNeed', 'exitPrice', 'exitConf', 'exitExponent',
    'exitPublishTime', 'exitMessageHash', 'exitTimepinResultHash', 'outcomeYes']],
  ['Execution', ['activationWorker', 'activationSlot', 'activationTs', 'resolver', 'settledTs',
    'resolutionSlot', 'forfeitWorker', 'terminalSlot', 'terminalTs']],
  ['Raw evidence', ['schema', 'bump', 'economyHash', 'rulesetHash', 'rentRefund', 'cleanupBondLamports',
    'xpBase', 'rankShard', 'commit', 'revealedSalt', 'resolutionHash', 'terminalHash', 'proofMaterial',
    'gameResultHash', 'pageIndex', 'slot', 'sequence', 'rowHash', 'resultsRoot']],
];

export function formatOracleNumber(integer, exponent) {
  if (typeof integer !== 'bigint' || !Number.isInteger(exponent)) return 'Unavailable';
  if (exponent < -18 || exponent > 18) return integer + ' × 10^' + exponent;
  const sign = integer < 0n ? '−' : '';
  const digits = (integer < 0n ? -integer : integer).toString();
  if (exponent >= 0) return integer === 0n ? '0' : sign + digits + '0'.repeat(exponent);
  const padded = digits.padStart(1 - exponent, '0');
  return sign + padded.slice(0, exponent) + '.' + padded.slice(exponent);
}

export function formatChainTime(seconds) {
  if (typeof seconds !== 'bigint' || seconds === 0n) return 'Not recorded yet';
  if (seconds < -8_640_000_000_000n || seconds > 8_640_000_000_000n) return seconds + ' (Unix seconds)';
  return new Date(Number(seconds) * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

// The renderer accepts only the reader's explicit account/archive/unavailable
// shapes. Gemini's explanation and save action are supplied as callbacks/text;
// this component neither reconstructs missing results nor invents a save format.
export function renderShotView(container, snapshot, { web3, summaryText, onSave, onRefresh } = {}) {
  if (!container?.ownerDocument || !snapshot?.cluster) throw new TypeError('A container and game snapshot are required');
  const doc = container.ownerDocument;
  const node = (tag, className, text) => {
    const out = doc.createElement(tag);
    if (className) out.className = className;
    if (text !== undefined) out.textContent = String(text);
    return out;
  };
  const root = node('article', 'g2-shot-view');
  const status = node('p', 'g2-status'); status.setAttribute('role', 'status');
  const cluster = snapshot.cluster;
  const makeLink = (kind, value, caption) => {
    const anchor = node('a', 'g2-link', caption + ' · ' + cluster.name);
    anchor.href = explorerLink({ genesisHash: cluster.genesisHash, kind, value });
    anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; return anchor;
  };
  const copy = value => {
    const button = node('button', 'g2-copy', 'Copy'); button.type = 'button';
    button.setAttribute('aria-label', 'Copy full value');
    button.addEventListener('click', async () => {
      try { await doc.defaultView.navigator.clipboard.writeText(value); button.textContent = 'Copied'; }
      catch { status.textContent = 'Copy is unavailable here. The full value is shown for selection.'; }
    });
    return button;
  };
  const header = node('header', 'g2-heading');
  header.append(node('span', 'g2-eyebrow', cluster.name === 'devnet' ? 'DEVNET · TEST NETWORK' : cluster.name));
  const toolbar = node('div', 'g2-toolbar');
  const action = (text, callback) => {
    if (typeof callback !== 'function') return;
    const button = node('button', 'g2-action', text); button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true; status.textContent = '';
      try { await callback(snapshot); } catch (error) { status.textContent = error?.message || 'The action could not complete.'; }
      finally { button.disabled = false; }
    });
    toolbar.append(button);
  };
  action('Refresh', onRefresh); action('Save game', onSave);
  header.append(toolbar); root.append(header);
  const archived = snapshot.kind === 'archive';
  if (archived && !web3?.PublicKey) throw new TypeError('PublicKey is required for receipt address rendering');
  const reconstructed = archived && snapshot.checks?.resultOutcomeAndXp === true && snapshot.checks?.gameResultHash === true && snapshot.reconstruction;
  const shot = snapshot.kind === 'account' ? snapshot.shot : archived ? reconstructed ? snapshot.reconstruction.result : snapshot.receipt.event.result : null;
  if (!shot) {
    const text = {
      'configuration-account-absent': 'This game configuration is not available on this network yet.',
      'shot-account-absent': 'The shot account is not available. A completed game needs its terminal transaction to show the result.',
      'transaction-unavailable': 'This RPC has not returned the transaction. Refresh, or try another RPC.',
    };
    root.append(node('h2', 'g2-title', 'Game unavailable'),
      node('p', 'g2-summary', text[snapshot.reason] || 'Unknown availability status: ' + snapshot.reason));
  } else {
    const title = reconstructed ? snapshot.reconstruction.outcome : own(STATES, shot.state, 'state');
    root.dataset.state = String(shot.state);
    const nonce = archived ? snapshot.receipt.event.nonce : shot.nonce;
    root.append(node('p', 'g2-eyebrow', 'SHOT ' + nonce + (archived ? ' · TERMINAL RECEIPT' : ' · ACCOUNT SNAPSHOT')),
      node('h2', 'g2-title', title));
    if (typeof summaryText === 'string' && summaryText.trim()) root.append(node('p', 'g2-summary', summaryText));
    const call = shot.state === 4
      ? (shot.side === 1 ? 'UP' : shot.side === 0 ? 'DOWN' : 'Unknown direction ' + shot.side)
        + ' · ' + (shot.pBps / 100).toFixed(2) + '% confidence'
      : 'Sealed call';
    const keyFacts = node('div', 'g2-facts');
    keyFacts.append(node('p', '', call), node('p', '', String(shot.stake) + ' credits staked'));
    if (reconstructed) keyFacts.append(node('p', '', '+' + shot.xpAwarded + ' XP'));
    root.append(keyFacts);
    if (shot.voidReason !== 0) root.append(node('p', 'g2-reason', own(REASONS, shot.voidReason, 'void reason')));
    const prices = node('div', 'g2-prices');
    for (const which of ['entry', 'exit']) {
      const allowedState = which === 'entry' ? [2, 3, 4, 5, 6, 7] : [3, 4, 5, 6, 7];
      const available = (!archived || reconstructed) && allowedState.includes(shot.state) && nonzero(shot[which + 'TimepinResultHash']);
      const panel = node('div', 'g2-price');
      panel.append(node('p', 'g2-eyebrow', which === 'entry' ? 'ENTRY PRICE' : 'EXIT PRICE'),
        node('p', 'g2-price-value', available ? formatOracleNumber(shot[which + 'Price'], shot[which + 'Exponent']) : '—'),
        node('p', 'g2-price-note', available
          ? '± ' + formatOracleNumber(shot[which + 'Conf'], shot[which + 'Exponent']) + ' oracle confidence'
          : archived ? 'Not included in this receipt' : 'Waiting for recorded evidence'),
        node('p', 'g2-time', 'Target ' + formatChainTime(shot[which + 'TargetTs'])));
      prices.append(panel);
    }
    root.append(prices);
    if (archived) root.append(node('p', 'g2-provenance', reconstructed ? 'Both prices and XP were reconstructed from permanent chain evidence and match the archived game hash.' : 'Prices, hit or miss and XP are not included in this compact receipt.'));
    if (snapshot.verificationError) root.append(node('p', 'g2-status', 'Result details could not be verified: ' + snapshot.verificationError));
    if (!archived && [1, 2, 3, 7].includes(shot.state)) root.append(node('p', 'g2-deadline',
      ([1, 2].includes(shot.state) ? 'Projected reveal deadline · ' : 'Reveal deadline · ')
      + formatChainTime(shot.revealDeadlineTs)));
    const values = archived ? { ...snapshot.receipt.event, ...shot } : shot;
    const formatted = (name, value) => {
      if (name === 'state') return own(STATES, value, 'state') + ' (' + value + ')';
      if (name === 'entryMode') return own({1: 'Observed', 2: 'Forward'}, value, 'entry mode') + ' (' + value + ')';
      if (name === 'voidReason') return own(REASONS, value, 'void reason') + ' (' + value + ')';
      if (['side', 'pBps', 'hit', 'revealedSalt'].includes(name) && shot.state !== 4) return 'Not revealed · raw ' + (value instanceof Uint8Array ? hex(value) : value);
      if (name === 'outcomeYes' && ![3, 4].includes(shot.state)) return 'No directional result · raw ' + value;
      const priceField = /^(entry|exit)(Price|Conf|Exponent|PublishTime)$/.exec(name);
      if (priceField && !nonzero(shot[priceField[1] + 'TimepinResultHash'])) return 'Not recorded yet · raw ' + value;
      if (TIME_FIELDS.has(name)) return formatChainTime(value) + ' · ' + value;
      if (name === 'stake') return value + ' credits';
      if (name === 'cleanupBondLamports') return value + ' lamports';
      if (value instanceof Uint8Array) return hex(value);
      return String(value);
    };
    for (const [title, names] of groups) {
      const present = names.filter(name => values[name] !== undefined);
      if (!present.length) continue;
      const details = node('details', 'g2-details'); details.append(node('summary', '', title));
      const list = node('dl', 'g2-data');
      for (const name of present) {
        const value = values[name], row = node('div', 'g2-row');
        row.append(node('dt', '', label(name)));
        const dd = node('dd');
        if (ADDRESS_FIELDS.has(name)) {
          const address = value?.toBase58 ? value.toBase58() : new web3.PublicKey(value).toBase58();
          if (address === ZERO_KEY) dd.textContent = name === 'delegate' ? 'Player wallet' : 'Not recorded yet';
          else dd.append(makeLink('address', address, address));
        } else {
          dd.append(node('span', 'g2-value', formatted(name, value)));
          if (value instanceof Uint8Array) dd.append(copy(hex(value)));
        }
        row.append(dd); list.append(row);
      }
      details.append(list); root.append(details);
    }
    if (snapshot.rawAccount) {
      const details = node('details', 'g2-details'); details.append(node('summary', '', 'Raw account bytes · ' + snapshot.rawAccount.length));
      const bytes = hex(snapshot.rawAccount); details.append(node('pre', 'g2-raw', bytes), copy(bytes)); root.append(details);
    }
    root.append(node('p', 'g2-provenance', archived
      ? (snapshot.checks?.logProvenance === true ? 'Read from successful transaction logs reported by this RPC. ' : 'Transaction log provenance has not been checked. ') + (reconstructed ? 'Price-message hashes, the outcome, XP and the archive row hash were checked. Ledger balances and the complete history were not replayed.' : 'Result economics and the history commitment have not been independently checked.')
      : (snapshot.checks?.accountIdentity === true ? 'Account owner, schema, hashes and address checked. ' : 'Account identity has not been checked. ') + 'Result economics have not been independently checked.'));
  }
  const links = node('nav', 'g2-links'); links.setAttribute('aria-label', 'Game evidence');
  for (const [name, address] of Object.entries(snapshot.addresses || {}))
    if (address !== ZERO_KEY) links.append(makeLink('address', address, label(name)));
  if (archived) links.append(makeLink('tx', snapshot.receipt.transaction.signature, 'Terminal transaction'));
  root.append(links, node('p', 'g2-time', 'Account read at slot ' + snapshot.slot), status);
  container.replaceChildren(root);
  return root;
}
