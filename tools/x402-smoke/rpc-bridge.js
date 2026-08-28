(function () {
  'use strict';
  const directRpcOrigins = new Set([
    'https://solana-rpc.publicnode.com',
    'https://api.mainnet-beta.solana.com',
  ]);
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = function (input, init) {
    let url;
    try { url = new URL(typeof input === 'string' ? input : input.url, location.href); }
    catch { return nativeFetch(input, init); }
    if (!directRpcOrigins.has(url.origin)) return nativeFetch(input, init);
    return nativeFetch('/rpc', init);
  };
})();
