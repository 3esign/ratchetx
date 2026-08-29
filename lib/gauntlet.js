'use strict';

// The Gauntlet is an acquisition contract, not a second game.
// Its completion rule is derived only from canonical player state: one
// non-void settlement that carried a stated probability. Changing that rule
// means publishing a new Gauntlet id, never silently editing this one.
const GAUNTLET = Object.freeze({
  schemaVersion: '1.0',
  id: 'first-contact-001',
  number: 1,
  status: 'open',
  title: 'FIRST CONTACT',
  headline: 'One forecast. One oracle outcome. One proof.',
  openedAt: '2026-08-29T00:00:00Z',
  mode: 'free-demo',
  objective: 'Complete one non-void Pyth-settled forecast with an explicit probability p.',
  completionRule: {
    source: 'canonical player state',
    predicate: 'player.stated >= 1',
    meaning: 'at least one HIT or MISS was scored as (p - outcome)^2; VOID does not count',
  },
  steps: [
    { n: 1, tool: 'ratchet_new_demo', result: 'retain the returned handle' },
    { n: 2, tool: 'ratchet_board', result: 'choose one live target and read its horizon' },
    { n: 3, tool: 'ratchet_demo_shot', result: 'seal YES or NO with an honest p from 0.01 to 0.99' },
    { n: 4, tool: 'ratchet_demo_state', result: 'poll after expiry until HIT, MISS, or VOID' },
    { n: 5, tool: 'ratchet_demo_state', result: 'if VOID, make another call; HIT or MISS completes the Gauntlet' },
  ],
  entry: {
    mcp: 'https://ratchetx.xyz/api/mcp',
    authentication: 'none',
    walletRequired: false,
    tokenRequired: false,
    paymentRequired: false,
  },
  reward: {
    kind: 'status-and-proof-only',
    money: false,
    token: false,
    rankedEntry: false,
    note: 'Completion proves the full free loop. It creates no prize, payout, token claim, rank, or promise of one.',
  },
  evidence: {
    board: 'https://ratchetx.xyz/api/game?action=board',
    progress: 'https://ratchetx.xyz/api/gauntlet?handle={handle}',
    page: 'https://ratchetx.xyz/gauntlet?handle={handle}',
    proof: 'https://ratchetx.xyz/api/proof',
    pricePath: 'https://ratchetx.xyz/api/game?action=path&feed={feed}&from={sealedAt}&to={settledAt}',
  },
  verification: {
    canonicalSettlement: 'ratchet-server',
    oracleInput: 'Pyth PriceUpdateV2 sponsored accounts read from Solana',
    publicReplay: 'reproduces the exact Pyth transition Ratchet captured and selected',
    independentPythReplay: false,
    limitation: 'the public server-capture path cannot prove Ratchet did not omit an earlier qualifying Pyth update outside that capture',
    optionalOnchainSeal: 'SOL-only beta; it does not replace canonical server settlement during the soak period',
  },
  publicRuns: [{
    agent: 'Bankr',
    source: 'https://x.com/bankrbot/status/2093511804660199561',
    verifiedDate: '2026-08-29',
    claim: 'protocol-completion-only',
    note: 'Two distinct demo identities and shot ids completed the canonical loop. This is not an endorsement or evidence of forecasting skill.',
    proofs: [
      {
        handle: '009d2bf7f3be',
        shotId: '308c9b77fcd3',
        outcome: 'HIT',
        url: 'https://ratchetx.xyz/api/gauntlet?handle=009d2bf7f3be',
      },
      {
        handle: '301e30592c97',
        shotId: '68aef803bf7a',
        outcome: 'HIT',
        url: 'https://ratchetx.xyz/api/gauntlet?handle=301e30592c97',
      },
    ],
  }],
  measurement: {
    globalCompletionCount: null,
    reason: 'free demo handles are pseudonymous and Sybil-free counting is not claimed',
  },
});

function publicSpec() {
  return JSON.parse(JSON.stringify(GAUNTLET));
}

function cleanHandle(value) {
  const handle = String(value || '').trim().toLowerCase().replace(/^demo-/, '');
  if (!/^[a-z0-9]{3,18}$/.test(handle)) {
    const error = new Error('handle must be 3-18 lowercase letters or digits; use the value returned by ratchet_new_demo');
    error.code = 'BAD_HANDLE';
    throw error;
  }
  return handle;
}

const hasNumber = value => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value));

function progressFromState(state, value) {
  const handle = cleanHandle(value);
  const player = state && (state.player || state.p) || {};
  const open = Array.isArray(player.open) ? player.open : [];
  const history = Array.isArray(player.history)
    ? player.history
    : (Array.isArray(player.closed) ? player.closed : []);
  const latestSummary = history.find(row => row
    && (row.res === 'hit' || row.res === 'miss')
    && hasNumber(row.sp)
    && Number(row.sp) >= 0.01 && Number(row.sp) <= 0.99);
  // Public player history is deliberately compact and its `t` is the settlement
  // time. Join it to the retained canonical shot so the proof never presents
  // settlement time as seal time and can expose the actual oracle evidence.
  const closed = Array.isArray(player.closed) ? player.closed : [];
  const latestShot = latestSummary
    ? closed.find(row => row && row.id === latestSummary.id)
    : null;
  const latest = latestSummary
    ? { ...(latestShot || {}), ...latestSummary }
    : null;
  const stated = Math.max(0, Math.floor(Number(player.stated) || 0));
  const completed = stated >= 1;
  const stage = completed
    ? 'complete'
    : (open.length ? 'awaiting_settlement' : 'ready_to_forecast');
  const next = completed
    ? 'share the proof URL or continue building a larger calibration record'
    : (open.length
      ? 'poll ratchet_demo_state after expiry; a VOID does not complete the Gauntlet'
      : 'read ratchet_board, then call ratchet_demo_shot with an honest p');

  return {
    handle,
    wallet: 'demo-' + handle,
    stage,
    completed,
    scoredSettlements: stated,
    openShots: open.length,
    brier: hasNumber(player.brier) ? Number(player.brier) : null,
    brierIndex: hasNumber(player.brierIndex) ? Number(player.brierIndex) : null,
    latestEvidence: latest ? {
      id: latest.id || null,
      label: latest.label || null,
      result: latest.res,
      probability: Number(latest.sp),
      feed: latest.feed || null,
      entry: hasNumber(latest.entry) ? Number(latest.entry) : null,
      exit: hasNumber(latest.exit) ? Number(latest.exit) : null,
      sealedAt: (latestShot && (latestShot.sealedAt || latestShot.t)) || null,
      sealLogIndex: (latestShot && latestShot.sealLogIndex) || null,
      expiry: latest.exp || null,
      exitAt: latest.exitAt || null,
      settledAt: latest.settledAt || latestSummary.t || null,
      settlementAuthority: 'ratchet-server',
      oracleSource: latest.oracleSrc || 'pyth-price-update-v2-accounts-read-from-solana',
    } : null,
    next,
    apiProof: 'https://ratchetx.xyz/api/gauntlet?handle=' + encodeURIComponent(handle),
    pageProof: 'https://ratchetx.xyz/gauntlet?handle=' + encodeURIComponent(handle),
  };
}

module.exports = { GAUNTLET, publicSpec, cleanHandle, progressFromState };
