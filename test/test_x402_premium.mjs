
import http from 'node:http';
import assert from 'node:assert';

process.env.PUBLIC_ORIGIN = 'http://127.0.0.1:8247';
process.env.X402_ENABLED = '1';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const agentProofBundle = require('../api/agent-proof-bundle.js');

const srv = http.createServer(async (req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    req.body = body;
    res.status = (c) => { res.statusCode = c; return res; }; res.json = (o) => res.end(JSON.stringify(o)); await agentProofBundle(req, res);
  });
});

srv.listen(8247, '127.0.0.1', async () => {
  try {
    const res = await new Promise((resolve) => {
      const req = http.request('http://127.0.0.1:8247/api/agent-proof-bundle', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, headers: res.headers, raw: data }); }
        });
      });
      req.write(JSON.stringify({ shotId: 'test1234' }));
      req.end();
    });
    
    if (res.status !== 402) { console.log(res); }
    assert.strictEqual(res.status, 402);
    assert.ok(res.headers['payment-required']);
    assert.strictEqual(res.body.x402Version, 2);
    assert.strictEqual(res.body.accepts[0].amount, '10000');
    assert.strictEqual(res.body.accepts[0].payTo, 'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM');
    
    console.log('PASS proof-bundle endpoint returns 402 with required exact headers');
    process.exit(0);
  } catch (e) {
    console.error('FAIL', e);
    process.exit(1);
  }
});
