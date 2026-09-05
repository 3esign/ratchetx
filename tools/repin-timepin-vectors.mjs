#!/usr/bin/env node
// Compatibility entry point. All bytes are regenerated; there is no identity-only re-pin.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runVectorCommand } from '../onchain/rcx-timepin-v2/scripts/generate-vectors.mjs';
export { runVectorCommand };
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { runVectorCommand(process.argv.slice(2)); }
  catch (error) { console.error('Timepin vector generation FAILED: ' + error.message); process.exitCode = 1; }
}