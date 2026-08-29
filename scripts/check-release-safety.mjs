import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

let failed = false;
const fail = message => { failed = true; console.error(`[FAIL] ${message}`); };
const ok = message => console.log(`[OK] ${message}`);

const frozenPath = 'onchain/ratchet-seal-v2/programs/ratchet-seal/src/lib.rs';
const expectedFrozenSha256 = '7cb5503728a5a93dd3747161c14d0254272f67dce583dae292a6ec6db3e78a5a';
const frozen = fs.readFileSync(frozenPath, 'utf8').replace(/\r\n/g, '\n');
const frozenSha256 = crypto.createHash('sha256').update(frozen).digest('hex');
if (frozenSha256 !== expectedFrozenSha256)
  fail(`frozen Ratchet Seal v2 source changed (${frozenSha256})`);
else ok('frozen Ratchet Seal v2 source identity');

const listed = spawnSync('git', ['ls-files', '-z'], { encoding:'buffer' });
if (listed.status !== 0) fail('could not enumerate tracked release files');
const files = listed.status === 0
  ? listed.stdout.toString('utf8').split('\0').filter(Boolean) : [];
const forbiddenNames = /(^|\/)(phases_extracted\d*\.txt|plan_dump\.txt|rotate\d*\.js|run_sql\.js|test-pyth\.mjs|patch\.py|[^/]+\.bak)$/i;
const secretPatterns = [
  ['database URL with embedded password', /postgres(?:ql)?:\/\/[^\s:'"]+:[^\s@'"]+@/i],
  ['private key PEM', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['literal Solana secret-key array', /(?:secretKey|privateKey)\s*[:=]\s*\[\s*\d+(?:\s*,\s*\d+){31,}/i],
  ['literal service-role JWT', /(?:SUPABASE_SERVICE_ROLE_KEY|serviceRoleKey)\s*[:=]\s*['"]eyJ[A-Za-z0-9_-]{20,}/i],
];
for (const file of files) {
  const posix = file.replace(/\\/g, '/');
  if (forbiddenNames.test(posix)) fail(`forbidden local artifact is tracked: ${posix}`);
  let bytes;
  try { bytes = fs.readFileSync(file); } catch { continue; }
  if (bytes.length > 2_000_000 || bytes.includes(0)) continue;
  const text = bytes.toString('utf8');
  for (const [label, pattern] of secretPatterns)
    if (pattern.test(text)) fail(`${label} found in tracked file ${posix}`);
}
if (!failed) ok(`${files.length} tracked files contain no blocked credential/artifact patterns`);

// Ratchet's oracle architecture is intentionally keyless: settlement and the
// paid proof bundle consume Pyth PriceUpdateV2 accounts already published on
// Solana. A future refactor must not smuggle a metered Pyth HTTP dependency
// back into either economic path. Hermes may remain an optional display-only
// fallback in lib/prices.js, outside this protected set.
const protectedOracleFiles = [
  'api/game.js', 'lib/pxlog.js', 'lib/proof_bundle.js', 'lib/record.js',
  'lib/verifier.js', 'scripts/verifier.mjs',
];
const alternateOracleDependency = /PYTH_API_KEY|PYTH_BENCHMARKS_URL|benchmarks\.pyth\.network|fetchBenchmarkUpdates/;
for (const file of protectedOracleFiles) {
  const text = fs.readFileSync(file, 'utf8');
  if (alternateOracleDependency.test(text))
    fail(`alternate oracle dependency entered protected settlement path: ${file}`);
}
const verifier = fs.readFileSync('lib/verifier.js', 'utf8');
if (!/independentPythReplay\s*:\s*false/.test(verifier))
  fail('verifier must publish independentPythReplay:false');
else if (!alternateOracleDependency.test(verifier))
  ok('core settlement and premium verifier remain bound to validated Pyth-on-Solana evidence');
process.exit(failed ? 1 : 0);
