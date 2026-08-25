import {
    integrationWriteCapabilityAllowed,
    parseIntegrationWriteCapabilities,
    resolveRuntimeConfigCompatibility,
} from '@parallext/shared';

describe('CFG-01 runtime configuration compatibility', () => {
    const legacyKey = 'ab'.repeat(32);

    it('boots compatibly with the existing production key and safe defaults', () => {
        const snapshot = resolveRuntimeConfigCompatibility({ ENCRYPTION_KEY: legacyKey });
        expect(snapshot.deploymentCompatible).toBe(true);
        expect(snapshot.entries.find(entry => entry.name === 'TENANT_SECRET_KEY')).toMatchObject({
            source: 'legacy', present: true, valid: true,
        });
        expect(snapshot.entries.find(entry => entry.name === 'TENANT_SECRET_KEY_ID')).toMatchObject({
            source: 'default', valid: true,
        });
        expect(JSON.stringify(snapshot)).not.toContain(legacyKey);
    });

    it('does not make a missing new variable a deployment failure', () => {
        const snapshot = resolveRuntimeConfigCompatibility({});
        expect(snapshot.deploymentCompatible).toBe(true);
        expect(snapshot.entries.find(entry => entry.name === 'INTEGRATION_WRITE_CAPABILITIES'))
            .toMatchObject({ source: 'default', present: false, valid: true, diagnostic: 'external_writes_disabled' });
    });

    it('uses explicit provider/version/operation grants before the legacy provider fallback', () => {
        const parsed = parseIntegrationWriteCapabilities(
            'hostaway@v1:create_reservation',
            'toast',
        );
        expect(parsed.source).toBe('explicit');
        expect(integrationWriteCapabilityAllowed({
            provider: 'hostaway', apiVersion: 'v1', operation: 'create_reservation',
            explicit: 'hostaway@v1:create_reservation', legacy: 'toast',
        })).toBe(true);
        expect(integrationWriteCapabilityAllowed({
            provider: 'toast', apiVersion: 'v1', operation: 'place_order',
            explicit: 'hostaway@v1:create_reservation', legacy: 'toast',
        })).toBe(false);
    });

    it('keeps the old provider allowlist operational until explicit cutover', () => {
        expect(integrationWriteCapabilityAllowed({
            provider: 'hostaway', legacy: 'hostaway',
        })).toBe(true);
    });

    it('fails closed on malformed explicit configuration and never falls back silently', () => {
        const snapshot = resolveRuntimeConfigCompatibility({
            ENCRYPTION_KEY: legacyKey,
            INTEGRATION_WRITE_CAPABILITIES: 'hostaway:create_reservation',
            INTEGRATION_WRITE_PROVIDERS: 'hostaway',
        });
        expect(snapshot.deploymentCompatible).toBe(false);
        expect(integrationWriteCapabilityAllowed({
            provider: 'hostaway', apiVersion: 'v1', operation: 'create_reservation',
            explicit: 'hostaway:create_reservation', legacy: 'hostaway',
        })).toBe(false);
    });

    it('reports unsafe custom provider hosts as invalid without returning the value', () => {
        const unsafeHost = 'https://*.attacker.example';
        const snapshot = resolveRuntimeConfigCompatibility({
            VERTICAL_INTEGRATIONS_TOAST_ALLOWED_HOSTS: unsafeHost,
        });
        expect(snapshot.deploymentCompatible).toBe(false);
        expect(snapshot.entries.find(entry => entry.name === 'VERTICAL_INTEGRATIONS_TOAST_ALLOWED_HOSTS'))
            .toMatchObject({
                source: 'explicit',
                present: true,
                valid: false,
                diagnostic: 'host_allowlist_invalid',
            });
        expect(JSON.stringify(snapshot)).not.toContain(unsafeHost);

        const internal = resolveRuntimeConfigCompatibility({
            VERTICAL_INTEGRATIONS_CLINIKO_ALLOWED_HOSTS: 'cliniko.service.internal',
        });
        expect(internal.deploymentCompatible).toBe(false);
    });
});
