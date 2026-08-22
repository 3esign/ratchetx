import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = new Map([
  ['u:A',{ type:'string', raw:JSON.stringify({ w:'A', cr:5000, xp:7 }) }],
  ['h:stats',{ type:'hash', raw:['shots','3','burned','14'] }],
  ['z:lbd:day',{ type:'zset', raw:['A','7','B','2'] }],
  ['lock:temporary',{ type:'string', raw:JSON.stringify('lease') }],
]);
const target = new Map();
const body = req => new Promise(resolve => { let s=''; req.on('data',d=>s+=d); req.on('end',()=>resolve(JSON.parse(s||'{}'))); });
const server = http.createServer(async (req,res) => {
  let out = null;
  if (req.url === '/') {
    const cmd = await body(req), op = String(cmd[0]).toUpperCase(), key = cmd[1], row = source.get(key);
    if (op === 'SCAN') out = ['0',[...source.keys()]];
    else if (op === 'TYPE') out = row?.type || 'none';
    else if (op === 'PTTL') out = row ? -1 : -2;
    else if (op === 'GET' || op === 'HGETALL' || op === 'ZRANGE') out = row?.raw ?? null;
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({ result:out })); return;
  }
  const name = req.url.split('/').pop(), args = await body(req);
  if (name === 'ratchet_kv_count') out = target.size;
  else if (name === 'ratchet_kv_import_rows') {
    let n=0; for (const row of args.p_rows) if (args.p_overwrite || !target.has(row.key)) { target.set(row.key,row.value); n++; } out=n;
  } else if (name === 'ratchet_kv_mget') out = args.p_keys.map(key=>target.get(key) ?? null);
  else if (name === 'ratchet_kv_scan') out = [...target.keys()];
  else if (name === 'ratchet_kv_del') out = target.delete(args.p_key);
  else { res.writeHead(404).end(); return; }
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(out));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port, tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ratchet-supa-mig-'));
const script=fileURLToPath(new URL('../scripts/migrate-upstash-to-supabase.mjs',import.meta.url));
const run=(args=[])=>new Promise(resolve=>{
  const p=spawn(process.execPath,[script,...args],{cwd:tmp,env:{...process.env,
    KV_REST_API_URL:`http://127.0.0.1:${port}`,KV_REST_API_TOKEN:'r',
    SUPABASE_URL:`http://127.0.0.1:${port}`,SUPABASE_SERVICE_KEY:'s'},stdio:['ignore','pipe','pipe']});
  let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);p.on('close',code=>resolve({code,out}));
});
try {
  const result=await run();
  assert.equal(result.code,0,result.out);
  assert.match(result.out,/MIGRATION VERIFIED: 3 keys copied/);
  assert.equal(target.size,3);
  assert.ok(!target.has('lock:temporary'),'short-lived leases must not cross the cutover');
  assert.deepEqual(target.get('u:A'),{w:'A',cr:5000,xp:7});
  assert.deepEqual(target.get('h:stats'),{shots:3,burned:14});
  assert.deepEqual(target.get('z:lbd:day'),{A:7,B:2});
  target.set('preview:only',{ stale:true });
  source.set('u:A',{ type:'string', raw:JSON.stringify({ w:'A', cr:7000, xp:9 }) });
  const forced=await run(['--force']);
  assert.equal(forced.code,0,forced.out);
  assert.ok(!target.has('preview:only'),'force sync must remove target-only persistent keys');
  assert.deepEqual(target.get('u:A'),{w:'A',cr:7000,xp:9},'force sync must overwrite changed source rows');
  assert.equal(fs.readdirSync(path.join(tmp,'backups')).length,2,'every source read must create a local backup');
  console.log('Upstash copy is non-destructive, lock-safe, backed up, and hash-verified');
} finally {
  await new Promise(resolve=>server.close(resolve));
  fs.rmSync(tmp,{recursive:true,force:true});
}
