#!/usr/bin/env node
/* global process, URL */
// `bin` shim: run the TypeScript entry with the repository's tsx so `npm link` yields a `hof` binary.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const tsx = require.resolve('tsx/cli');
const entry = fileURLToPath(new URL('./hof.ts', import.meta.url));
const child = spawn(process.execPath, [tsx, entry, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
