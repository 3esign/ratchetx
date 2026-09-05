import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('DEPLOY preserves a failed CLI exit through successful report printing', t => {
  assert.equal(process.platform, 'win32', 'this suite requires the Windows CI job');
  const deployPath = new URL('../../DEPLOY.cmd', import.meta.url);
  assert.ok(fs.existsSync(deployPath), 'DEPLOY.cmd is required deployment evidence');
  const source = fs.readFileSync(deployPath, 'utf8');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchetx-deploy-cmd-'));
  t.after(() => {
    const checked = fs.realpathSync(root);
    assert.ok(checked.startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
    assert.match(path.basename(checked), /^ratchetx-deploy-cmd-/);
    fs.rmSync(checked, { recursive: true });
  });
  const put = (name, content) => fs.writeFileSync(path.join(root, name), content);
  const begin = source.indexOf('call npx --yes vercel deploy --prod --yes');
  const end = source.indexOf('goto :vercelfail', begin) + 'goto :vercelfail'.length;
  assert.ok(begin >= 0 && end > begin);
  const fragment = source.slice(begin, end)
    .replace(/^call npx[^\r\n]+/, 'call mock-deploy.cmd > rx_vercel.txt 2>&1')
    .replaceAll('"%TEMP%\\rx_vercel.txt"', 'rx_vercel.txt');
  assert.ok(!/npx|vercel deploy/.test(fragment));
  put('runner.cmd', '@echo off\r\n' + fragment + '\r\nexit /b 0\r\n:vercelfail\r\nexit /b 17\r\n');
  put('mock-deploy.cmd', '@echo off\r\necho simulated failure\r\nexit /b 17\r\n');
  assert.throws(() => execFileSync('cmd.exe', ['/d', '/c', 'runner.cmd'],
    { cwd: root, stdio: 'pipe', windowsHide: true }), error => error.status === 17);
  put('mock-deploy.cmd', '@echo off\r\necho simulated success\r\nexit /b 0\r\n');
  execFileSync('cmd.exe', ['/d', '/c', 'runner.cmd'],
    { cwd: root, stdio: 'pipe', windowsHide: true });
});
