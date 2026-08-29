'use strict';
const crypto = require('node:crypto');
const { getJSONStrict, setJSON } = require('../lib/kv.js');
const { RELEASE } = require('../lib/release.js');
const game = require('./game.js');
const mcp = require('./mcp.js'); // For invoking game endpoints similarly

async function invoke(handler, req, overrides) {
  const mockReq = { ...req, ...overrides, headers: { ...req.headers } };
  let out;
  const mockRes = {
    setHeader: () => {}, status: () => mockRes, json: (o) => { out = o; return o; }, end: () => {}
  };
  await handler(mockReq, mockRes);
  return out;
}

module.exports = async function a2a(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace(/^\/api\/a2a/, '');

  try {
    // POST /tasks - Create a new Gauntlet task
    if (req.method === 'POST' && (path === '/tasks' || path === '/tasks/')) {
      const handle = crypto.randomBytes(6).toString('hex');
      const taskId = `a2atask-${handle}`;
      const task = {
        id: taskId,
        status: 'input-required',
        handle,
        wallet: `demo-${handle}`,
        createdAt: Date.now()
      };
      await setJSON(taskId, task, { ex: 86400 * 7 }); // Keep for 7 days
      
      const boardRes = await invoke(game, req, { method: 'GET', query: { action: 'board' } });
      task.inputs = [{
        name: 'shot',
        description: 'Provide your forecasting shot',
        schema: {
          type: 'object',
          properties: {
            target: { type: 'string' },
            side: { type: 'string', enum: ['YES', 'NO'] },
            p: { type: 'number' }
          },
          required: ['target', 'side', 'p']
        }
      }];
      task.context = { board: boardRes.board };
      return res.json(task);
    }

    // GET /tasks/:id - Poll task status
    if (req.method === 'GET' && path.startsWith('/tasks/')) {
      const id = path.split('/')[2];
      const task = await getJSONStrict(id);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      
      if (task.status === 'working') {
        const stateRes = await invoke(game, req, { method: 'GET', query: { action: 'state', wallet: task.wallet } });
        const gauntlet = stateRes.gauntlet;
        if (gauntlet.terminal || gauntlet.stage !== 'awaiting_settlement') {
          task.status = gauntlet.reasonCode === 'VOID' ? 'failed' : 'completed';
          task.result = gauntlet.latestEvidence;
          task.reason = gauntlet.reasonCode;
          await setJSON(id, task, { ex: 86400 * 7 });
        }
      }
      return res.json(task);
    }

    // POST /tasks/:id/input - Submit input
    if (req.method === 'POST' && path.match(/^\/tasks\/[^\/]+\/input$/)) {
      const id = path.split('/')[2];
      const task = await getJSONStrict(id);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      if (task.status !== 'input-required') return res.status(400).json({ error: 'Task not accepting input' });

      const input = req.body;
      const shotRes = await invoke(game, req, {
        method: 'POST',
        query: { action: 'shot', target: input.target },
        body: { wallet: task.wallet, side: input.side, p: input.p }
      });

      if (!shotRes.ok) {
        return res.status(400).json({ error: shotRes.reason || 'Shot failed' });
      }

      task.status = 'working';
      task.shotId = shotRes.shotId;
      await setJSON(id, task, { ex: 86400 * 7 });
      return res.json(task);
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
};
