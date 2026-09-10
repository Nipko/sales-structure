import { createHash } from 'crypto';
import {
    assessStagingIsolation, databaseNameIn, fingerprint, hostsIn, isolationFindings, isolationSummaryLine,
    secretDigest, STAGING_CONTRACT,
} from './staging-isolation';

const SALT = 'salt-for-this-run';

/** A staging environment that satisfies the contract, so each test breaks ONE thing. */
const clean = (overrides: Record<string, string | undefined> = {}) => ({
    STAGING_SERVER_HOST: 'staging.internal.example',
    STAGING_SERVER_USER: 'deploy',
    STAGING_SERVER_SSH_KEY: `-----BEGIN OPENSSH PRIVATE KEY-----\n${'k'.repeat(120)}\n-----END OPENSSH PRIVATE KEY-----`,
    STAGING_DATABASE_URL: 'postgresql://parallext:stg-pass@pgbouncer-staging:5432/parallext_staging?pgbouncer=true',
    STAGING_DIRECT_DATABASE_URL: 'postgresql://parallext:stg-pass@postgres-staging:5432/parallext_staging',
    STAGING_DATABASE_PASSWORD: 'staging-database-password-01',
    STAGING_REDIS_HOST: 'valkey-staging.internal.example',
    STAGING_REDIS_PASSWORD: 'staging-redis-password-0001',
    STAGING_JWT_SECRET: 's'.repeat(48),
    STAGING_JWT_REFRESH_SECRET: 'r'.repeat(48),
    STAGING_INTERNAL_JWT_SECRET: 'i'.repeat(48),
    STAGING_INTERNAL_API_KEY: 'k'.repeat(32),
    STAGING_ENCRYPTION_KEY: 'a'.repeat(64),
    STAGING_CLOUDFLARE_TUNNEL_TOKEN: 't'.repeat(64),
    STAGING_PUBLIC_API_URL: 'https://api.staging.internal.example/api/v1',
    STAGING_PUBLIC_DASHBOARD_URL: 'https://admin.staging.internal.example',
    STAGING_SEED_SOURCE: 'synthetic',
    ...overrides,
});

const assess = (env: Record<string, string | undefined>, extra: Partial<Parameters<typeof assessStagingIsolation>[0]> = {}) =>
    assessStagingIsolation({ env, productionDigests: [], digestSalt: SALT, ...extra });

const codesFor = (report: ReturnType<typeof assessStagingIsolation>, variable: string) =>
    report.findings.filter(finding => finding.variable === variable).map(finding => finding.code);

/**
 * The digest has to be computed the SAME WAY on both sides, and the other side
 * is a different file run by a person on their own machine
 * (`print-production-secret-digests.cjs`). Every other test here calls
 * `secretDigest` for both the staging value and the production one, so they
 * agree with each other however the function is written — including when it is
 * written wrongly.
 *
 * That blindness is not hypothetical: a stray NUL byte where the separating
 * space should have been survived the whole unit suite and was caught only by
 * comparing against a digest computed elsewhere. Every production secret would
 * have read as "not shared", forever, which is precisely the false clean this
 * guard exists to prevent. So the recipe is pinned to an independent
 * computation and to a literal.
 */
describe('the digest recipe, pinned from outside', () => {
    it('is exactly sha256("<salt> <value>")', () => {
        expect(secretDigest('the-value', 'the-salt'))
            .toBe(createHash('sha256').update('the-salt the-value').digest('hex'));
        // And to a literal, so a change to BOTH sides at once is still visible.
        expect(secretDigest('a', 'b')).toBe(
            createHash('sha256').update('b a').digest('hex'));
        expect(secretDigest('a', 'b')).toBe(
            'beedb4a7ba34c4ea09727022655dd743d5dda2940f1c8e4ec56ff2904324026c');
    });

    it('separates salt from value with one ordinary space, and nothing else', () => {
        // A different separator makes two different secrets hash the same.
        expect(secretDigest('x y', 's')).not.toBe(secretDigest('x', 's y'));
        expect(secretDigest('', 's')).toBe(createHash('sha256').update('s ').digest('hex'));
    });

    it('fingerprints short, stable and not back to the value', () => {
        expect(fingerprint('secret')).toHaveLength(12);
        expect(fingerprint('secret')).toBe(fingerprint('secret'));
        expect(fingerprint('secret')).not.toBe(fingerprint('secret '));
        expect(fingerprint('secret')).not.toContain('secret');
    });
});

/**
 * ═══ THE ONE THING A STAGING GUARD HAS TO GET RIGHT ═══
 *
 * A staging environment that shares anything with production is not a staging
 * environment; it is production with a different label, and every green step
 * afterwards is evidence about production. The check has to happen on the
 * VALUES, before anything is deployed, and it has to fail closed — which means
 * these tests care as much about what it refuses as about what it allows.
 */
describe('the staging isolation contract', () => {
    it('accepts an environment that shares nothing with production', () => {
        const report = assess(clean());
        expect(report).toMatchObject({ ok: true, findings: [], checked: STAGING_CONTRACT.length });
        expect(isolationSummaryLine(report)).toBe(
            'STAGING_ISOLATION checked=16 missing=0 shared_with_production=0 production_host=0 '
            + 'production_database_name=0 production_copy_requested=0 weak_value=0 blocks=0');
    });

    it('refuses a missing variable instead of falling back to a production one', () => {
        // The fallback is exactly how the two environments come to share a value,
        // so absence is a refusal and never a default.
        for (const variable of STAGING_CONTRACT) {
            const report = assess(clean({ [variable.name]: undefined }));
            expect({ variable: variable.name, ok: report.ok, codes: codesFor(report, variable.name) })
                .toEqual({ variable: variable.name, ok: false, codes: ['missing'] });
        }
    });

    it('refuses an empty or whitespace value as loudly as an absent one', () => {
        expect(codesFor(assess(clean({ STAGING_JWT_SECRET: '   ' })), 'STAGING_JWT_SECRET')).toEqual(['missing']);
    });

    it('refuses a secret that has the same value as its production counterpart', () => {
        // The comparison is over salted digests, so neither value is ever here.
        const productionKey = 'p'.repeat(64);
        const report = assess(clean({ STAGING_ENCRYPTION_KEY: productionKey }), {
            productionDigests: [secretDigest(productionKey, SALT)],
        });
        expect(report.ok).toBe(false);
        expect(codesFor(report, 'STAGING_ENCRYPTION_KEY')).toEqual(['shared_with_production']);
        // And it says which variable, never what the value was.
        const line = isolationFindings(report).join('\n');
        expect(line).toContain('STAGING_ENCRYPTION_KEY shared_with_production');
        expect(line).not.toContain(productionKey);
    });

    it('catches a shared session key, which would make a staging login valid in production', () => {
        const jwt = 'j'.repeat(48);
        const report = assess(clean({ STAGING_JWT_SECRET: jwt, STAGING_JWT_REFRESH_SECRET: jwt }),
            { productionDigests: [secretDigest(jwt, SALT)] });
        expect(codesFor(report, 'STAGING_JWT_SECRET')).toEqual(['shared_with_production']);
        expect(codesFor(report, 'STAGING_JWT_REFRESH_SECRET')).toEqual(['shared_with_production']);
    });

    it('does not silently pass every secret when the salt is missing', () => {
        // Digests without the salt that produced them compare to nothing. Reading
        // that as "nothing is shared" is the failure mode this guard exists for.
        const report = assessStagingIsolation({
            env: clean(), productionDigests: [secretDigest('anything', SALT)], digestSalt: undefined,
        });
        expect(report.ok).toBe(false);
        expect(codesFor(report, 'STAGING_ISOLATION_DIGEST_SALT')).toEqual(['missing']);
    });

    it('has nothing to compare, and says so, only when no production digest was supplied', () => {
        const report = assessStagingIsolation({ env: clean(), productionDigests: [], digestSalt: '' });
        expect(report.ok).toBe(true);
    });

    it('refuses a production hostname wherever it appears', () => {
        expect(codesFor(assess(clean({ STAGING_SERVER_HOST: 'api.parallly-chat.cloud' })), 'STAGING_SERVER_HOST'))
            .toEqual(['production_host']);
        expect(codesFor(assess(clean({ STAGING_PUBLIC_DASHBOARD_URL: 'https://admin.parallly-chat.cloud' })),
            'STAGING_PUBLIC_DASHBOARD_URL')).toEqual(['production_host']);
        expect(codesFor(assess(clean({ STAGING_DATABASE_URL: 'postgresql://u:p@db.parallly-chat.cloud:5432/parallext_staging' })),
            'STAGING_DATABASE_URL')).toEqual(['production_host']);
        // The apex domain itself, not only its subdomains.
        expect(codesFor(assess(clean({ STAGING_SERVER_HOST: 'parallly-chat.cloud' })), 'STAGING_SERVER_HOST'))
            .toEqual(['production_host']);
    });

    it('refuses a host the operator declared as production, such as the VPS address', () => {
        const report = assess(clean({ STAGING_SERVER_HOST: '203.0.113.10' }),
            { productionHosts: ['203.0.113.10'] });
        expect(codesFor(report, 'STAGING_SERVER_HOST')).toEqual(['production_host']);
    });

    it('is not fooled by a lookalike that merely ends with the same letters', () => {
        // `notparallly-chat.cloud` is a different domain. Matching on a bare
        // substring would refuse valid staging hosts and teach people to bypass
        // the guard, which is worse than not having it.
        expect(assess(clean({ STAGING_SERVER_HOST: 'notparallly-chat.cloud' })).ok).toBe(true);
    });

    it('refuses the production database name even on a staging host', () => {
        const report = assess(clean({
            STAGING_DIRECT_DATABASE_URL: 'postgresql://parallext:pw@postgres-staging:5432/parallext_engine',
        }));
        expect(codesFor(report, 'STAGING_DIRECT_DATABASE_URL')).toEqual(['production_database_name']);
    });

    it('refuses a placeholder standing in for a key', () => {
        const report = assess(clean({ STAGING_ENCRYPTION_KEY: 'changeme' }));
        expect(codesFor(report, 'STAGING_ENCRYPTION_KEY')).toEqual(['weak_value']);
    });

    it('refuses to seed staging from anything but synthetic data', () => {
        // A production copy is a decision with a legal shape. It is not a
        // workflow input, and the default is not "whatever was set last time".
        for (const source of ['production', 'prod-dump', 'restore', '']) {
            const report = assess(clean({ STAGING_SEED_SOURCE: source || undefined }));
            if (source) {
                expect(codesFor(report, 'STAGING_SEED_SOURCE')).toEqual(['production_copy_requested']);
            } else {
                // Absent means synthetic: the safe reading is the default one.
                expect(report.ok).toBe(true);
            }
        }
    });

    it('reports every problem in one pass rather than the first one', () => {
        // An operator who has to run this eight times to learn eight things
        // starts guessing instead of reading.
        const report = assess(clean({
            STAGING_SERVER_HOST: 'wa.parallly-chat.cloud',
            STAGING_INTERNAL_API_KEY: undefined,
            STAGING_ENCRYPTION_KEY: 'short',
            STAGING_SEED_SOURCE: 'production',
        }));
        expect(report.ok).toBe(false);
        expect(new Set(report.findings.map(finding => finding.variable))).toEqual(new Set([
            'STAGING_SERVER_HOST', 'STAGING_INTERNAL_API_KEY', 'STAGING_ENCRYPTION_KEY', 'STAGING_SEED_SOURCE',
        ]));
        expect(isolationSummaryLine(report)).toContain('blocks=1');
        expect(isolationSummaryLine(report)).toContain('missing=1');
        expect(isolationSummaryLine(report)).toContain('production_host=1');
    });

    describe('the parsers the contract rests on', () => {
        it('finds the host in a bare name and in every URL shape used here', () => {
            expect(hostsIn('staging.internal.example')).toEqual(['staging.internal.example']);
            expect(hostsIn('postgresql://user:pw@db-staging:5432/x')).toEqual(['db-staging']);
            expect(hostsIn('redis://valkey-staging:6379')).toEqual(['valkey-staging']);
            expect(hostsIn('https://a.example/x and https://b.example/y').sort()).toEqual(['a.example', 'b.example']);
            // A bare word with no dot is a container name, not a host to judge.
            expect(hostsIn('pgbouncer')).toEqual([]);
        });

        it('reads the database name out of a connection string, query string and all', () => {
            expect(databaseNameIn('postgresql://u:p@h:5432/parallext_engine?pgbouncer=true')).toBe('parallext_engine');
            expect(databaseNameIn('postgresql://u:p@h:5432/Parallext_Staging')).toBe('parallext_staging');
            expect(databaseNameIn('not a url')).toBeNull();
            expect(databaseNameIn('postgresql://u:p@h:5432/')).toBeNull();
        });
    });
});
