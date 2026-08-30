'use strict';
// Supabase opaque server keys are API keys, not user/service JWTs. Keep the
// legacy JWT header only for old credentials. Never substitute a public key.
function serverHeaders(key) {
  if (typeof key !== 'string' || !key || /[\x00-\x20\x7f]/.test(key)
    || key.startsWith('sb_publishable_')) throw new Error('Invalid Supabase server credential');
  return key.startsWith('sb_secret_') ? { apikey: key }
    : { apikey: key, Authorization: 'Bearer ' + key };
}
module.exports = { serverHeaders };
