const { getJSON, setJSON } = require('./kv.js');

// Seed legacy Bankr runs and Grok audit if they don't exist
async function seedLegacyEvidence() {
  const seeded = await getJSON('evidence:seeded');
  if (seeded) return;

  const publicRuns = [{
    agent: 'Bankr',
    source: 'https://x.com/bankrbot/status/2093511804660199561',
    verifiedDate: '2026-08-29',
    claim: 'operator-verified-x',
    note: 'Two distinct demo identities and shot ids completed the canonical loop. This is not an endorsement or evidence of forecasting skill.',
    proofs: [
      { handle: '009d2bf7f3be', shotId: '308c9b77fcd3', outcome: 'HIT', url: 'https://ratchetx.xyz/api/gauntlet?handle=009d2bf7f3be' },
      { handle: '301e30592c97', shotId: '68aef803bf7a', outcome: 'HIT', url: 'https://ratchetx.xyz/api/gauntlet?handle=301e30592c97' }
    ]
  }];
  
  const externalAudits = [{
    agent: 'Grok',
    date: '2026-08',
    note: 'Grok obavio spolja?nji audit javnih povr?ina. Nije Gauntlet completion.'
  }];

  await setJSON('g:evidence:publicRuns', publicRuns);
  await setJSON('g:evidence:externalAudits', externalAudits);
  await setJSON('evidence:seeded', true);
}

async function getPublicRuns() {
  await seedLegacyEvidence();
  const runs = await getJSON('g:evidence:publicRuns') || [];
  return runs;
}

async function getExternalAudits() {
  await seedLegacyEvidence();
  const audits = await getJSON('g:evidence:externalAudits') || [];
  return audits;
}

module.exports = {
  getPublicRuns,
  getExternalAudits
};
