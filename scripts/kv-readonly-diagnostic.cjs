'use strict';

// Production storage compatibility probe. It deliberately uses the read-only
// Upstash token and never prints credentials or stored values.
const base = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
// Some integrations omit the optional read-only token from env run. Every
// command below is statically read-only, so the normal token is a safe fallback.
const token = process.env.KV_REST_API_READ_ONLY_TOKEN || process.env.KV_REST_API_TOKEN;

if (!base || !token) {
  console.error('Missing production read-only KV environment.');
  process.exit(2);
}

async function call(cmd, showResult = false) {
  const response = await fetch(base, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const body = await response.text();
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = null; }
  const error = !response.ok || (parsed && parsed.error);
  const safe = error ? (parsed && parsed.error || body).slice(0, 300)
    : showResult ? parsed.result : 'ok';
  console.log(`${cmd[0]} ${cmd[1] || ''}: HTTP ${response.status} · ${JSON.stringify(safe)}`);
  return { ok: response.ok && !error, result: parsed && parsed.result };
}

(async () => {
  for (const key of ['h:stats', 'g:stats', 'g:alltime:seeded', 'lba:all',
    'g:podium', 'g:chal', 'g:day', 'g:season']) {
    await call(['TYPE', key], true);
  }
  await call(['HGETALL', 'h:stats']);
  await call(['GET', 'g:stats']);
  await call(['ZREVRANGE', 'lba:all', '0', '2', 'WITHSCORES']);
  await call(['SCAN', '0', 'MATCH', 'u:*', 'COUNT', '1']);
})().catch(error => {
  console.error(`Diagnostic failed: ${error.message}`);
  process.exitCode = 1;
});
