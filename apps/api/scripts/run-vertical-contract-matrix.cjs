const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * The matrix is intentionally runnable before the workspace Turbo build. The
 * compiled applications, however, load @parallext/shared through its runtime
 * `dist` entry. Ensure that entry exists without relying on a shell-specific
 * `npx` invocation or a CI-only ordering constraint.
 */
function ensureSharedRuntimeEntry() {
    const sharedRoot = path.resolve(__dirname, '../../../packages/shared');
    const sharedEntry = path.join(sharedRoot, 'dist', 'index.js');
    if (fs.existsSync(sharedEntry)) return;

    const compiler = require.resolve('typescript/lib/tsc.js');
    const result = spawnSync(process.execPath, [compiler, '--project', path.join(sharedRoot, 'tsconfig.json')], {
        cwd: path.resolve(__dirname, '../../..'),
        stdio: 'inherit',
    });

    if (result.error) {
        throw new Error(`Unable to build @parallext/shared for the vertical contract matrix: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`Building @parallext/shared for the vertical contract matrix exited with status ${result.status ?? 'unknown'}`);
    }
}

ensureSharedRuntimeEntry();

require('ts-node').register({
    project: path.resolve(__dirname, '../tsconfig.json'),
    transpileOnly: true,
});

require('./run-vertical-contract-matrix.ts');
