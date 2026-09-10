import {
    assertPilotScope, assertStagingTarget, dispatchPilotValue, PILOT_CHANNEL, PILOT_TENANT,
    redactForArtifact, StagingTargetRefused, SYNTHETIC_TENANTS,
} from './staging-operations';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

const refusal = (input: Parameters<typeof assertStagingTarget>[0]): string | null => {
    try { assertStagingTarget(input); return null; }
    catch (error) { return error instanceof StagingTargetRefused ? error.reason : `unexpected:${error}`; }
};

const staging = { environment: 'staging', databaseUrl: 'postgresql://parallext:pw@postgres:5432/parallext_staging' };

/**
 * ═══ THE SCRIPTS THAT CAN DELETE THINGS ═══
 *
 * `--reset` seeds staging by removing what was there. The distance between that
 * and removing a customer's data is one connection string, so the gate in front
 * of it gets tested harder than the thing it guards.
 */
describe('the staging target gate', () => {
    it('accepts a database that says staging, in an environment that says staging', () => {
        expect(assertStagingTarget(staging)).toEqual({
            databaseUrl: staging.databaseUrl, databaseName: 'parallext_staging',
        });
    });

    it('refuses when the environment does not say staging — including when it says nothing', () => {
        // Production never sets PARALLLY_ENVIRONMENT. An unset value must be a
        // refusal, because "unset" is what a production host looks like.
        expect(refusal({ ...staging, environment: undefined })).toBe('environment_not_staging');
        expect(refusal({ ...staging, environment: '' })).toBe('environment_not_staging');
        expect(refusal({ ...staging, environment: 'production' })).toBe('environment_not_staging');
        expect(refusal({ ...staging, environment: 'stagingish' })).toBe('environment_not_staging');
        // Case and padding are not a way to fail the check by accident.
        expect(refusal({ ...staging, environment: '  STAGING ' })).toBeNull();
    });

    it('refuses the production database name even when the environment claims staging', () => {
        // A `.env` copied from production onto the staging host satisfies the
        // environment check and nothing else. This is the second statement.
        expect(refusal({ environment: 'staging', databaseUrl: 'postgresql://u:pw@postgres:5432/parallext_engine' }))
            .toBe('production_database_name');
    });

    it('refuses a database whose name does not say staging at all', () => {
        // Not "not production" — say it. A name nobody can read as staging is a
        // name somebody will one day read as something else.
        expect(refusal({ environment: 'staging', databaseUrl: 'postgresql://u:pw@postgres:5432/parallext' }))
            .toBe('database_name_not_staging');
        for (const name of ['parallext_staging', 'staging_db', 'app-staging', 'parallext_stg']) {
            expect(refusal({ environment: 'staging', databaseUrl: `postgresql://u:pw@postgres:5432/${name}` }))
                .toBeNull();
        }
    });

    it('refuses a production host whatever the database is called', () => {
        expect(refusal({ environment: 'staging', databaseUrl: 'postgresql://u:pw@db.parallly-chat.cloud:5432/parallext_staging' }))
            .toBe('production_host');
    });

    it('refuses a missing or unparseable connection string instead of guessing', () => {
        expect(refusal({ environment: 'staging', databaseUrl: undefined })).toBe('connection_string_missing');
        expect(refusal({ environment: 'staging', databaseUrl: 'not-a-url' })).toBe('database_name_missing');
        expect(refusal({ environment: 'staging', databaseUrl: 'postgresql://u:pw@postgres:5432/' })).toBe('database_name_missing');
    });

    it('names the reason in the error, so a refusal is actionable at 3am', () => {
        try { assertStagingTarget({ environment: 'staging', databaseUrl: 'postgresql://u:p@h:5432/parallext_engine' }); }
        catch (error: any) { expect(error.message).toBe('staging_target_refused:production_database_name:parallext_engine'); }
        expect.assertions(1);
    });
});

describe('the synthetic tenants', () => {
    it('are stable across runs, so a second deploy replaces them instead of adding more', () => {
        expect(SYNTHETIC_TENANTS.map(tenant => tenant.id)).toEqual(SYNTHETIC_TENANTS.map(tenant => tenant.id));
        for (const tenant of SYNTHETIC_TENANTS) expect(tenant.id).toMatch(UUID);
        expect(new Set(SYNTHETIC_TENANTS.map(tenant => tenant.id)).size).toBe(SYNTHETIC_TENANTS.length);
        expect(new Set(SYNTHETIC_TENANTS.map(tenant => tenant.schemaName)).size).toBe(SYNTHETIC_TENANTS.length);
    });

    it('cannot reach a person even if a channel were connected by mistake', () => {
        for (const tenant of SYNTHETIC_TENANTS) {
            // `.invalid` can never resolve (RFC 2606); +99 is unassigned by ITU-T.
            expect(tenant.adminEmail.endsWith('.invalid')).toBe(true);
            expect(tenant.contactPhone.startsWith('+99')).toBe(true);
            expect(tenant.schemaName).toMatch(/^tenant_stg_[a-z_]+$/);
        }
    });
});

describe('the outbox pilot scope', () => {
    it('names one synthetic tenant and one channel with no recipient', () => {
        expect(dispatchPilotValue(true)).toEqual({
            enabled: true, tenantIds: [PILOT_TENANT.id], channels: [PILOT_CHANNEL],
        });
        expect(PILOT_CHANNEL).toBe('web_widget');
        expect(SYNTHETIC_TENANTS.some(tenant => tenant.id === PILOT_TENANT.id)).toBe(true);
    });

    it('turns off by naming nothing, not by leaving the list behind', () => {
        // `{enabled:false}` with the tenant list still present is one flipped
        // boolean away from being on again for that tenant.
        expect(dispatchPilotValue(false)).toEqual({ enabled: false, tenantIds: [], channels: [] });
    });

    it('refuses a configuration that would reach past the synthetic tenant', () => {
        // The empty tenant list is the dangerous one: in the service it means
        // EVERY tenant, so a rehearsal with it proves the wrong thing.
        expect(() => assertPilotScope({ enabled: true, tenantIds: [], channels: [PILOT_CHANNEL] }))
            .toThrow('staging_pilot_scope_refused:tenants:0');
        expect(() => assertPilotScope({ enabled: true, tenantIds: [PILOT_TENANT.id, 'other'], channels: [PILOT_CHANNEL] }))
            .toThrow('staging_pilot_scope_refused:tenants:2');
        expect(() => assertPilotScope({ enabled: true, tenantIds: [PILOT_TENANT.id], channels: ['whatsapp'] }))
            .toThrow('staging_pilot_scope_refused:channels:whatsapp');
        // Off is always allowed; there is nothing to scope.
        expect(() => assertPilotScope(dispatchPilotValue(false))).not.toThrow();
    });
});

describe('what may leave the host', () => {
    it('takes the customer out of a log line and leaves the diagnosis in', () => {
        const line = 'WARN [Outbound] retry for ana.perez@example.com / +57 300 111 2233 '
            + 'auth Bearer abcdefghijklmnopqrstuvwx failed after 3 attempts';
        const redacted = redactForArtifact(line);
        expect(redacted).not.toContain('ana.perez@example.com');
        expect(redacted).not.toContain('300 111 2233');
        expect(redacted).not.toContain('abcdefghijklmnopqrstuvwx');
        expect(redacted).toContain('<email>');
        expect(redacted).toContain('<phone>');
        expect(redacted).toContain('<token>');
        // The part an operator actually needs survives.
        expect(redacted).toContain('WARN [Outbound] retry');
        expect(redacted).toContain('failed after 3 attempts');
    });

    it('removes a JWT, which carries the tenant and the user inside it', () => {
        const jwt = `${'a'.repeat(30)}.${'b'.repeat(20)}.${'c'.repeat(20)}`;
        expect(redactForArtifact(`session ${jwt} expired`)).toBe('session <jwt> expired');
    });

    it('leaves an ordinary short number alone, so counters stay readable', () => {
        expect(redactForArtifact('processed 42 jobs in 1200 ms')).toBe('processed 42 jobs in 1200 ms');
    });
});
