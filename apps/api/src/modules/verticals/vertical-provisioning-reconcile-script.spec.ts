// El reconciliador es un script CommonJS de `scripts/`, sin build ni tipos: se
// carga con require a propósito. El disable tiene que ir pegado a la línea del
// require —no a la del `const`— porque con destructuring multilínea ESLint
// reporta ahí (mismo caso que `diagnose-mp-collector.spec.ts`).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const reconcileModule = require('../../../scripts/reconcile-vertical-provisioning');
const {
    needsReconciliation,
    normalizedLanguage,
    parseArgs,
    run,
    selectCandidates,
    verticalIdentity,
} = reconcileModule;

describe('vertical provisioning reconciliation CLI', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    it('is dry-run by default and validates bounded targeting arguments', () => {
        expect(parseArgs([])).toEqual({ apply: false, dryRun: true, tenantId: null, limit: 1000 });
        expect(parseArgs([`--tenant=${tenantId}`, '--limit', '25', '--apply'])).toEqual({
            apply: true,
            dryRun: false,
            tenantId,
            limit: 25,
        });
        expect(() => parseArgs(['--apply', '--dry-run'])).toThrow(/either/);
        expect(() => parseArgs(['--tenant=not-a-uuid'])).toThrow(/valid UUID/);
        expect(() => parseArgs(['--limit=0'])).toThrow(/1 to 10000/);
    });

    it('selects only active onboarded tenants whose durable state is not current and complete', () => {
        const base = { isActive: true, onboardingCompletedAt: new Date(), settings: {} };
        expect(needsReconciliation(base, 2)).toBe(true);
        expect(needsReconciliation({
            ...base,
            settings: { verticalProvisioning: { version: 1, status: 'complete' } },
        }, 2)).toBe(true);
        expect(needsReconciliation({
            ...base,
            settings: { verticalProvisioning: { version: 2, status: 'failed' } },
        }, 2)).toBe(true);
        expect(needsReconciliation({
            ...base,
            settings: { verticalProvisioning: { version: 2, status: 'complete' } },
        }, 2)).toBe(false);
        expect(needsReconciliation({ ...base, isActive: false }, 2)).toBe(false);
        expect(needsReconciliation({ ...base, onboardingCompletedAt: null }, 2)).toBe(false);
    });

    it('applies the batch limit after filtering current tenants', () => {
        const base = { isActive: true, onboardingCompletedAt: new Date() };
        const current = {
            ...base,
            id: 'current',
            settings: { verticalProvisioning: { version: 2, status: 'complete' } },
        };
        const staleOne = {
            ...base,
            id: 'stale-1',
            settings: { verticalProvisioning: { version: 1, status: 'complete' } },
        };
        const staleTwo = { ...base, id: 'stale-2', settings: {} };

        const selection = selectCandidates([current, staleOne, staleTwo], 2, 1);

        expect(selection.candidates.map((tenant: any) => tenant.id)).toEqual(['stale-1']);
        expect(selection).toMatchObject({ deferred: 1, skipped: 1 });
    });

    it('resolves identity from durable vertical config without trusting manifest metadata', () => {
        expect(verticalIdentity({
            industry: 'turismo',
            language: 'pt-BR',
            settings: {
                subType: 'tours',
                verticalConfig: {
                    industry: 'automotriz',
                    subType: 'alquiler',
                    manifestVersion: 999,
                },
            },
        })).toEqual({ industry: 'automotriz', subType: 'alquiler', language: 'pt' });
        expect(normalizedLanguage('de-DE')).toBe('es');
    });

    it('applies one candidate through the canonical bootstrap and verifies durable completion', async () => {
        const tenantId = '11111111-1111-4111-8111-111111111111';
        const tenant = {
            id: tenantId,
            industry: 'turismo',
            language: 'es-CO',
            settings: {
                subType: 'hotel',
                verticalProvisioning: { version: 1, status: 'complete' },
            },
            isActive: true,
            onboardingCompletedAt: new Date(),
        };
        const prisma = {
            tenant: {
                findMany: jest.fn().mockResolvedValue([tenant]),
                findUnique: jest.fn().mockResolvedValue({
                    settings: { verticalProvisioning: { version: 2, status: 'complete' } },
                }),
            },
        };
        const verticals = {
            resolveCapabilityManifest: jest.fn(),
            bootstrapVertical: jest.fn().mockResolvedValue(undefined),
        };
        const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const summary = await run(['--tenant', tenantId, '--apply'], {
                app: {},
                prisma,
                verticals,
                VerticalModule: { VERTICAL_PROVISIONING_VERSION: 2, VerticalsService: class {} },
            });

            expect(verticals.resolveCapabilityManifest).toHaveBeenCalledWith('turismo', 'hotel');
            expect(verticals.bootstrapVertical).toHaveBeenCalledWith(tenantId, 'turismo', 'hotel', 'es');
            expect(summary).toMatchObject({ candidates: 1, reconciled: 1, needsReview: 0 });
        } finally {
            log.mockRestore();
            error.mockRestore();
        }
    });

    it('keeps dry-run on plain Prisma without booting or mutating Nest services', async () => {
        const prisma = { tenant: { findMany: jest.fn().mockResolvedValue([]) } };
        const resolveManifest = jest.fn();
        const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        try {
            const summary = await run(['--dry-run'], {
                prisma,
                resolveManifest,
                VerticalModule: { VERTICAL_PROVISIONING_VERSION: 2 },
            });

            expect(summary).toMatchObject({ mode: 'dry-run', scanned: 0, candidates: 0 });
            expect(prisma.tenant.findMany).toHaveBeenCalledTimes(1);
            expect(resolveManifest).not.toHaveBeenCalled();
        } finally {
            log.mockRestore();
        }
    });

    it('does not let a failed tenant consume the bounded success budget', async () => {
        const firstId = '11111111-1111-4111-8111-111111111111';
        const secondId = '22222222-2222-4222-8222-222222222222';
        const tenant = (id: string) => ({
            id,
            industry: 'turismo',
            language: 'es',
            settings: {
                subType: 'hotel',
                verticalProvisioning: { version: 1, status: 'complete' },
            },
            isActive: true,
            onboardingCompletedAt: new Date(),
            createdAt: new Date(),
        });
        const prisma = {
            tenant: {
                findMany: jest.fn().mockResolvedValue([tenant(firstId), tenant(secondId)]),
                findUnique: jest.fn().mockResolvedValue({
                    settings: { verticalProvisioning: { version: 2, status: 'complete' } },
                }),
            },
        };
        const verticals = {
            resolveCapabilityManifest: jest.fn(),
            bootstrapVertical: jest.fn(async (id: string) => {
                if (id === firstId) throw new Error('manual_review_required');
            }),
        };
        const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const previousExitCode = process.exitCode;
        try {
            const summary = await run(['--limit=1', '--apply'], {
                app: {},
                prisma,
                verticals,
                VerticalModule: { VERTICAL_PROVISIONING_VERSION: 2, VerticalsService: class {} },
            });

            expect(verticals.bootstrapVertical.mock.calls.map(([id]: [string]) => id))
                .toEqual([firstId, secondId]);
            expect(summary).toMatchObject({
                candidates: 2,
                reconciled: 1,
                needsReview: 1,
                deferred: 0,
            });
        } finally {
            process.exitCode = previousExitCode;
            log.mockRestore();
            error.mockRestore();
        }
    });

    it('paginates past ten thousand tenants and reports every deferred candidate', async () => {
        const total = 10001;
        const tenants = Array.from({ length: total }, (_unused, index) => ({
            id: `tenant-${String(index).padStart(5, '0')}`,
            industry: 'retail',
            language: 'es',
            settings: { verticalProvisioning: { version: 1, status: 'complete' } },
            isActive: true,
            onboardingCompletedAt: new Date(),
            createdAt: new Date(index),
        }));
        const findMany = jest.fn(async (args: any) => {
            const cursor = args.cursor?.id;
            const start = cursor
                ? tenants.findIndex((tenant) => tenant.id === cursor) + 1
                : 0;
            return tenants.slice(start, start + args.take);
        });
        const prisma = { tenant: { findMany } };
        const resolveManifest = jest.fn();
        const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const summary = await run(['--dry-run', '--limit=1'], {
                prisma,
                resolveManifest,
                VerticalModule: { VERTICAL_PROVISIONING_VERSION: 2 },
            });

            expect(summary).toMatchObject({
                scanned: total,
                candidates: total,
                deferred: total - 1,
            });
            expect(resolveManifest).toHaveBeenCalledTimes(1);
            expect(findMany.mock.calls.length).toBeGreaterThan(20);
            expect(findMany.mock.calls.at(-1)?.[0].cursor.id).toBe('tenant-09999');
        } finally {
            log.mockRestore();
            error.mockRestore();
        }
    });
});
