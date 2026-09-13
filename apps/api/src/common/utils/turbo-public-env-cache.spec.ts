import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '..', '..', '..', '..', '..');

describe('public browser inputs and build caching', () => {
    it('hashes every dashboard build argument and makes E2E rebuild its declared environment', () => {
        const dockerfile = readFileSync(resolve(root, 'infra', 'docker', 'Dockerfile.dashboard'), 'utf8');
        const required = [...dockerfile.matchAll(/^ARG (NEXT_PUBLIC_[A-Z0-9_]+)/gm)]
            .map(match => match[1]);
        const turbo = JSON.parse(readFileSync(resolve(root, 'turbo.json'), 'utf8'));
        const hashed = new Set<string>(turbo.tasks?.build?.env || []);

        expect(required.length).toBeGreaterThan(0);
        expect(required.filter(name => !hashed.has(name))).toEqual([]);

        const e2eServer = readFileSync(resolve(root, 'apps', 'e2e', 'start-servers.cjs'), 'utf8');
        expect(e2eServer).toMatch(/"build",[\s\S]{0,500}"--force",[\s\S]{0,500}"--filter=landing"/);
    });
});
