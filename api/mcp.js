'use strict';
// Share one hosted function while keeping G2 independent of legacy DB modules.
module.exports = function mcpRouter(req, res) {
  const pathname=String(req.url || '').split('?')[0];
  if(req.query?.g2 === '1' || pathname === '/api/g2-mcp')
    return require('../lib/g2/mcp-http.cjs')(req,res);
  return require('../lib/mcp-legacy.js')(req,res);
};
for(const name of ['TOOLS','SUPPORTED_PROTOCOLS','inspectionContract'])
  Object.defineProperty(module.exports,name,{enumerable:true,get:()=>require('../lib/mcp-legacy.js')[name]});
