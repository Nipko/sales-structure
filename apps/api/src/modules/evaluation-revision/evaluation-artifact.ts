import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join, relative } from 'path';

let artifact: string | undefined;
/** Includes runtime, tool definitions, prompt/rubric literals and shared template contracts, in source and compiled deployments. */
export function evaluationArtifactHash(): string {
    if (artifact) return artifact;
    const digest = createHash('sha256');
    digest.update(JSON.stringify(process.versions));
    const visit = (root: string, directory = root): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
            if (entry.name.startsWith('.') || ['node_modules','__fixtures__','__tests__'].includes(entry.name)) continue;
            const path = join(directory, entry.name);
            if (entry.isDirectory()) visit(root,path);
            else if (/\.(?:js|ts|json)$/.test(entry.name) && !/\.(?:spec|test|d)\.(?:js|ts)$/.test(entry.name))
                digest.update(relative(root,path)).update(readFileSync(path));
        }
    };
    visit(join(__dirname, '..', '..'));
    visit(dirname(require.resolve('@parallext/shared')));
    // Source monorepo and compiled Docker layouts both carry at least the API/runtime package metadata.
    let directory = join(__dirname, '..', '..');
    for (let level = 0; level < 4; level++, directory = dirname(directory)) {
        for (const name of ['package.json','package-lock.json','pnpm-lock.yaml','yarn.lock']) {
            const path = join(directory,name);
            if (existsSync(path)) digest.update(`${level}:${name}`).update(readFileSync(path));
        }
    }
    artifact = digest.digest('hex');
    return artifact;
}
