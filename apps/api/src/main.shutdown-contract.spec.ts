import { readFileSync } from 'fs';
import { resolve } from 'path';

function secondsForService(compose: string, service: string): number {
    const block = compose.match(new RegExp(`\\n  ${service}:\\r?\\n([\\s\\S]*?)(?=\\n  [a-z][a-z0-9_-]*:|\\nvolumes:)`, 'i'))?.[1] || '';
    const seconds = Number(block.match(/stop_grace_period:\s*(\d+)s/)?.[1]);
    if (!Number.isFinite(seconds)) throw new Error(`Missing stop_grace_period for ${service}`);
    return seconds;
}

describe('production shutdown contract', () => {
    const main = readFileSync(resolve(__dirname, 'main.ts'), 'utf8');
    const compose = readFileSync(resolve(__dirname, '../../../infra/docker/docker-compose.prod.yml'), 'utf8');

    it('gives the API container more time than its forced shutdown ceiling', () => {
        const literal = main.match(/const shutdownGraceMs\s*=\s*([\d_]+)/)?.[1];
        expect(literal).toBeDefined();
        const shutdownSeconds = Number(String(literal).replace(/_/g, '')) / 1000;

        expect(shutdownSeconds).toBeGreaterThanOrEqual(120);
        expect(secondsForService(compose, 'api')).toBeGreaterThan(shutdownSeconds);
    });

    it('keeps the worker drain budget at least as long as the BullMQ lock', () => {
        expect(secondsForService(compose, 'worker')).toBeGreaterThanOrEqual(120);
    });
});
