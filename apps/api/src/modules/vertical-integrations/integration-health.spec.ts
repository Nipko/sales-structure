import {
    INTEGRATION_FRESHNESS_MAX_AGE_SECONDS,
    initialIntegrationHealth,
    materializeIntegrationHealth,
    reduceIntegrationHealth,
} from './integration-health';

const NOW = new Date('2026-08-08T12:00:00.000Z');

describe('IntegrationHealth contract', () => {
    it('fails closed for a configured legacy integration with no health record', () => {
        const health = materializeIntegrationHealth('toast', true, undefined, NOW);

        expect(health).toMatchObject({
            provider: 'toast',
            configured: true,
            status: 'unavailable',
            connected: false,
            credentialValidated: false,
            requiredScopes: ['menus:read'],
            scopeStatus: 'unknown',
            lastSuccessfulSyncAt: null,
            freshness: { stale: true, ageSeconds: null },
            consecutiveFailures: 0,
            circuitState: 'closed',
            lastError: null,
        });
    });

    it('becomes healthy only after a successful sync proves credentials, scopes and freshness', () => {
        const stored = reduceIntegrationHealth(initialIntegrationHealth('mindbody'), 'mindbody', {
            outcome: 'success',
            syncSucceeded: true,
            credentialValidated: true,
            grantedScopes: ['classes:read'],
            checkedAt: NOW.toISOString(),
        }, NOW);

        expect(materializeIntegrationHealth('mindbody', true, stored, NOW)).toMatchObject({
            status: 'healthy',
            connected: true,
            credentialValidated: true,
            scopeStatus: 'satisfied',
            grantedScopes: ['classes:read'],
            lastSuccessfulSyncAt: NOW.toISOString(),
            freshness: { stale: false, ageSeconds: 0 },
            consecutiveFailures: 0,
            circuitState: 'closed',
        });
    });

    it('materializes a previously healthy provider as stale after the freshness window', () => {
        const stored = reduceIntegrationHealth(undefined, 'toast', {
            outcome: 'success',
            syncSucceeded: true,
            checkedAt: NOW.toISOString(),
        }, NOW);
        const afterWindow = new Date(
            NOW.getTime() + (INTEGRATION_FRESHNESS_MAX_AGE_SECONDS + 1) * 1000,
        );

        expect(materializeIntegrationHealth('toast', true, stored, afterWindow)).toMatchObject({
            status: 'stale',
            connected: true,
            freshness: {
                stale: true,
                ageSeconds: INTEGRATION_FRESHNESS_MAX_AGE_SECONDS + 1,
            },
        });
    });

    it('marks missing required scopes unhealthy even with previously valid credentials', () => {
        const healthy = reduceIntegrationHealth(undefined, 'cliniko', {
            outcome: 'success',
            syncSucceeded: true,
            checkedAt: NOW.toISOString(),
        }, NOW);
        const missingScope = reduceIntegrationHealth(healthy, 'cliniko', {
            outcome: 'failure',
            credentialValidated: true,
            missingScopes: ['appointment_types:read'],
            error: { response: { status: 403 }, data: 'secret-provider-payload' },
            checkedAt: NOW.toISOString(),
        }, NOW);
        const health = materializeIntegrationHealth('cliniko', true, missingScope, NOW);

        expect(health).toMatchObject({
            status: 'unhealthy',
            configured: true,
            connected: false,
            credentialValidated: true,
            scopeStatus: 'missing',
            lastError: {
                code: 'http_403',
                message: 'Permisos insuficientes en el proveedor.',
            },
        });
        expect(JSON.stringify(health)).not.toContain('secret-provider-payload');
    });

    it('degrades after one failure, opens the circuit after three, and recovers on success', () => {
        let stored = reduceIntegrationHealth(undefined, 'toast', {
            outcome: 'success',
            syncSucceeded: true,
            checkedAt: NOW.toISOString(),
        }, NOW);
        stored = reduceIntegrationHealth(stored, 'toast', {
            outcome: 'failure',
            error: new Error('https://provider.example?token=super-secret'),
            checkedAt: NOW.toISOString(),
        }, NOW);
        expect(materializeIntegrationHealth('toast', true, stored, NOW)).toMatchObject({
            status: 'degraded',
            consecutiveFailures: 1,
            circuitState: 'closed',
        });
        expect(JSON.stringify(stored.lastError)).not.toContain('super-secret');

        stored = reduceIntegrationHealth(stored, 'toast', {
            outcome: 'failure', error: new Error('down'), checkedAt: NOW.toISOString(),
        }, NOW);
        stored = reduceIntegrationHealth(stored, 'toast', {
            outcome: 'failure', error: new Error('down'), checkedAt: NOW.toISOString(),
        }, NOW);
        expect(materializeIntegrationHealth('toast', true, stored, NOW)).toMatchObject({
            status: 'unhealthy',
            consecutiveFailures: 3,
            circuitState: 'open',
        });

        stored = reduceIntegrationHealth(stored, 'toast', {
            outcome: 'success',
            syncSucceeded: true,
            checkedAt: NOW.toISOString(),
        }, NOW);
        expect(materializeIntegrationHealth('toast', true, stored, NOW)).toMatchObject({
            status: 'healthy',
            consecutiveFailures: 0,
            circuitState: 'closed',
            lastError: null,
        });
    });

    it('does not apply the same updateId twice', () => {
        const first = reduceIntegrationHealth(undefined, 'toast', {
            outcome: 'failure',
            updateId: 'check-123',
            error: new Error('down'),
            checkedAt: NOW.toISOString(),
        }, NOW);
        const retried = reduceIntegrationHealth(first, 'toast', {
            outcome: 'failure',
            updateId: 'check-123',
            error: new Error('down'),
            checkedAt: NOW.toISOString(),
        }, NOW);

        expect(retried).toBe(first);
        expect(retried.consecutiveFailures).toBe(1);
    });
});
