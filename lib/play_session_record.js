'use strict';

const PREFIX = 'play-session:v1:';
const REVISION = /^[a-f0-9]{32}$/;

function validateCAS(key, expectedRevision, value) {
  if (typeof key !== 'string' || !/^play-session:v1:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(key)
    || (expectedRevision !== null && (typeof expectedRevision !== 'string' || !REVISION.test(expectedRevision)))
    || !value || typeof value !== 'object' || typeof value.revision !== 'string' || !REVISION.test(value.revision)
    || value.revision === expectedRevision || Buffer.byteLength(JSON.stringify(value)) > 65536) {
    throw new Error('invalid play-session CAS');
  }
}

module.exports = {PREFIX, validateCAS};
