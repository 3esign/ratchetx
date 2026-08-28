import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { INDEXERS, lookupAgentByWallet } = require('../lib/agent_registry.js');

let pass = 0, fail = 0;
const ok = (condition, label) => {
  if (condition) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label); }
};
const WALLET = '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE';
const ASSET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const OWNER = '11111111111111111111111111111111';
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status,
  json: async () => body });
const row = (wallet = WALLET) => ({ asset:ASSET, agent_wallet:wallet, owner:OWNER,
  nft_name:'Registry Forecaster', agent_uri:'https://example.com/agent.json',
  trust_tier:'verified', quality_score:'91.5', confidence:0.8, risk_score:'3',
  feedback_count:'12' });

let seen;
let result = await lookupAgentByWallet(WALLET, async url => {
  seen = url;
  return reply(200, [row()]);
});
ok(result.status === 'verified'
  && result.identity.globalId === 'sol:' + ASSET
  && result.identity.agentWallet === WALLET
  && result.identity.feedbackCount === 12,
  'an exact wallet match becomes a bounded public identity');
ok(seen.searchParams.get('agent_wallet') === 'eq.' + WALLET
  && seen.searchParams.get('limit') === '2'
  && seen.searchParams.get('select').includes('quality_score'),
  'lookup uses the official exact PostgREST wallet filter and bounded fields');

let calls = 0;
result = await lookupAgentByWallet(WALLET, async url => {
  calls++;
  return url.origin === new URL(INDEXERS[0]).origin
    ? reply(503, { error:'down' }) : reply(200, [row()]);
});
ok(result.status === 'verified' && calls === 2
  && result.identity.source === INDEXERS[1],
  'secondary mainnet indexer is used only when the primary is unavailable');

calls = 0;
result = await lookupAgentByWallet(WALLET, async () => { calls++; return reply(200, []); });
ok(result.status === 'not-found' && calls === 1,
  'a clean empty exact query is a definitive optional-identity miss');

result = await lookupAgentByWallet(WALLET, async () =>
  reply(200, [row('11111111111111111111111111111111')]));
ok(result.status === 'unavailable',
  'mismatched rows are rejected rather than attached to the wrong wallet');

calls = 0;
result = await lookupAgentByWallet('not-a-solana-wallet', async () => { calls++; return reply(200, []); });
ok(result.status === 'invalid-wallet' && calls === 0,
  'malformed wallets never reach a public indexer');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exitCode = fail ? 1 : 0;
