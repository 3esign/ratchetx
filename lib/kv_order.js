'use strict';

// Integer clocks only. Missing legacy fields sort before known clocks, never
// as NaN. The same tuple is used in memory, Redis and Postgres CAS decisions.
function clock(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}
function compareOrder(a, b, fields) {
  for (const field of fields) {
    const delta = clock(a && a[field]) - clock(b && b[field]);
    if (delta) return delta;
  }
  return 0;
}
function validateOrderedWrite(key, value, fields, ttl) {
  if (typeof key !== 'string' || !key || !value || typeof value !== 'object'
      || Array.isArray(value) || !Array.isArray(fields) || !fields.length || fields.length > 8
      || fields.some(f => typeof f !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(f))
      || new Set(fields).size !== fields.length
      || !Number.isSafeInteger(ttl) || ttl < 1)
    throw new Error('invalid ordered write');
  for (const field of fields) {
    const v = value[field];
    if (v != null && (!Number.isSafeInteger(v) || v < 0))
      throw new Error('invalid ordered clock: ' + field);
  }
}
module.exports = {compareOrder, validateOrderedWrite};
