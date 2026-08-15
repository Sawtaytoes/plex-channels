// How an e2e harness starts the real server as a child process.
//
// Two things changed under the harnesses at once and both are fatal to `spawn('node',
// ['server/src/server.js'])`:
//   1. The Express entry point server.js is gone — the Hono server is server/src/index.ts.
//   2. server/src is TypeScript, so plain `node` can neither load the entry nor resolve the
//      `./foo.js` specifiers inside it. Everything runs through tsx.
//
// tsx is a devDependency of server/, not a global, so the binary is addressed by absolute
// path: a harness may be launched from anywhere, and `--import tsx` would be resolved against
// the cwd, which has no node_modules of its own (there is no root manifest in this repo).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The repo root — e2e/stubs/ is two levels down. */
export const REPO_ROOT = path.resolve(HERE, '..', '..');
export const TSX_BIN = path.join(REPO_ROOT, 'server', 'node_modules', '.bin', 'tsx');
export const SERVER_ENTRY = path.join(REPO_ROOT, 'server', 'src', 'index.ts');

/**
 * Start the server exactly the way e2e/run.sh does. Options are passed straight to `spawn`,
 * so a caller keeps its own env / stdio; `cwd` defaults to the repo root because several
 * harnesses used to rely on being launched from there.
 */
export function spawnServer(options = {}) {
  return spawn(TSX_BIN, [SERVER_ENTRY], { cwd: REPO_ROOT, ...options });
}
