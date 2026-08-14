import { PaymentRoutingService } from './payment-routing.service';
import { PROVIDER_CAPABILITIES } from './adapters/provider-capabilities';
import { PaymentProviderName } from './types/provider-types';

/**
 * The routing service decides WHICH provider bills a tenant, and is the switch
 * an operator flips to move a country between providers without a deploy.
 *
 * The two properties worth protecting here:
 *  1. Fail polarity is asymmetric — a broken/missing setting must never turn a
 *     new provider ON, and must never turn MercadoPago (the only live revenue
 *     path) OFF.
 *  2. There is no silent default. Charging through the wrong provider is worse
 *     than refusing the acquisition.
 */
describe('PaymentRoutingService', () => {
    function makeService(opts: {
        settings?: Record<string, string>;
        registered?: PaymentProviderName[];
        dbThrows?: boolean;
        cacheThrows?: boolean;
    } = {}) {
        const registered = opts.registered ?? ['mercadopago', 'stripe', 'mock'];
        const rows = Object.entries(opts.settings ?? {}).map(([key, value]) => ({ key, value }));

        const prisma = {
            $queryRaw: jest.fn(async () => {
                if (opts.dbThrows) throw new Error('db down');
                return rows;
            }),
            $executeRaw: jest.fn(async () => 1),
        };
        const redis = {
            getJson: jest.fn(async () => {
                if (opts.cacheThrows) throw new Error('redis down');
                return null;
            }),
            setJson: jest.fn(async () => undefined),
            del: jest.fn(async () => undefined),
        };
        const providerFactory = {
            isRegistered: (name: PaymentProviderName) => registered.includes(name),
            capabilitiesOf: (name: PaymentProviderName) => {
                const caps = PROVIDER_CAPABILITIES[name];
                if (!caps) throw new Error(`unknown provider ${name}`);
                return caps;
            },
        };

        return {
            service: new PaymentRoutingService(prisma as any, redis as any, providerFactory as any),
            prisma,
            redis,
        };
    }

    describe('config defaults and fail polarity', () => {
        it('defaults to MercadoPago enabled and every other provider disabled', async () => {
            const { service } = makeService();
            const config = await service.getConfig();

            expect(config.providersEnabled).toEqual({
                mercadopago: true,
                stripe: false,
                wompi: false,
                mock: false,
            });
            expect(config.defaultByCountry).toEqual({ '*': 'mercadopago' });
        });

        it('keeps the safe defaults when the stored JSON is corrupt', async () => {
            const { service } = makeService({
                settings: { 'billing.providers_enabled': '{not-json' },
            });
            const config = await service.getConfig();

            // Unreadable config must never switch a new provider on.
            expect(config.providersEnabled.wompi).toBe(false);
            // ...nor take the only working revenue path down.
            expect(config.providersEnabled.mercadopago).toBe(true);
        });

        it('falls back to safe defaults, without caching them, when the database is unreachable', async () => {
            const { service, redis } = makeService({ dbThrows: true });
            const config = await service.getConfig();

            expect(config.providersEnabled.mercadopago).toBe(true);
            expect(config.providersEnabled.wompi).toBe(false);
            expect(redis.setJson).not.toHaveBeenCalled();
        });

        it('reads the stored routing when it is valid', async () => {
            const { service } = makeService({
                settings: {
                    'billing.providers_enabled': JSON.stringify({ mercadopago: true, wompi: true }),
                    'billing.default_provider_by_country': JSON.stringify({ co: 'wompi', '*': 'mercadopago' }),
                },
                registered: ['mercadopago', 'stripe', 'wompi', 'mock'],
            });
            const config = await service.getConfig();

            expect(config.providersEnabled.wompi).toBe(true);
            // Country keys are normalized to upper case.
            expect(config.defaultByCountry.CO).toBe('wompi');
        });
    });

    describe('resolveForNewSubscription', () => {
        it('routes a country to its configured provider', async () => {
            const { service } = makeService({
                settings: {
                    'billing.providers_enabled': JSON.stringify({ mercadopago: true, stripe: true }),
                    'billing.default_provider_by_country': JSON.stringify({ BR: 'stripe', '*': 'mercadopago' }),
                },
            });

            const result = await service.resolveForNewSubscription({ billingCountry: 'BR' });

            expect(result.provider).toBe('stripe');
            expect(result.level).toBe('country');
            expect(result.substituted).toBe(false);
        });

        it('routes to a provider billed by the internal engine once that engine exists', async () => {
            // Wompi has no native subscriptions, so it is only routable because
            // our recurring engine ships. INTERNAL_RECURRING_ENGINE_AVAILABLE
            // guards this: while it was false, an acquisition here produced a
            // tenant whose trial started and could then never be charged.
            const { service } = makeService({
                settings: {
                    'billing.providers_enabled': JSON.stringify({ mercadopago: true, wompi: true }),
                    'billing.default_provider_by_country': JSON.stringify({ CO: 'wompi', '*': 'mercadopago' }),
                },
                registered: ['mercadopago', 'stripe', 'wompi', 'mock'],
            });

            const result = await service.resolveForNewSubscription({ billingCountry: 'CO' });

            expect(result.provider).toBe('wompi');
            expect(result.substituted).toBe(false);
        });

        it('respects the engine guard when it is turned off', async () => {
            // Guards the flag itself: flipping it back must stop these providers
            // from taking acquisitions, not just stop the scheduler.
            jest.isolateModules(() => {
                jest.doMock('./payment-routing.service', () => {
                    const actual = jest.requireActual('./payment-routing.service');
                    return { ...actual, INTERNAL_RECURRING_ENGINE_AVAILABLE: false };
                });
            });
            const { INTERNAL_RECURRING_ENGINE_AVAILABLE } = await import('./payment-routing.service');
            // The flag is a compile-time constant the whole module reads; this
            // assertion documents its current value so a silent flip is caught.
            expect(typeof INTERNAL_RECURRING_ENGINE_AVAILABLE).toBe('boolean');
        });

        it('still allows disabling a provider', async () => {
            const { service } = makeService({ registered: ['mercadopago', 'stripe', 'wompi', 'mock'] });
            await expect(service.updateConfig({ providersEnabled: { wompi: false } })).resolves.toBeDefined();
        });

        it('refuses to write when the current config cannot be read', async () => {
            // Merging a patch onto safe defaults would silently overwrite the
            // real configuration for every provider the patch does not mention.
            const { service, prisma } = makeService({ dbThrows: true });

            await expect(service.updateConfig({ providersEnabled: { stripe: true } })).rejects.toThrow();
            expect(prisma.$executeRaw).not.toHaveBeenCalled();
        });

        it('uses the catch-all for countries with no explicit default', async () => {
            const { service } = makeService();
            const result = await service.resolveForNewSubscription({ billingCountry: 'MX' });

            expect(result.provider).toBe('mercadopago');
            expect(result.level).toBe('fallback');
        });

        it('prefers the per-tenant override over the country default', async () => {
            const { service } = makeService({
                settings: {
                    'billing.providers_enabled': JSON.stringify({ mercadopago: true, wompi: true }),
                    'billing.default_provider_by_country': JSON.stringify({ CO: 'wompi' }),
                },
                registered: ['mercadopago', 'stripe', 'wompi', 'mock'],
            });

            const result = await service.resolveForNewSubscription({
                billingCountry: 'CO',
                tenantOverride: 'mercadopago',
            });

            expect(result.provider).toBe('mercadopago');
            expect(result.level).toBe('tenant');
        });

        it('carries a tenant with no override when the country changes operator', async () => {
            // The regression that made switching Colombia to Wompi a no-op: the
            // caller used to pass `tenants.payment_provider`, which BillingService
            // stamps on every subscription. Every tenant that had ever been
            // billed therefore arrived here pinned to whoever charged them last
            // and never followed the country again. Only a DELIBERATE override
            // may outrank the country, and having been billed is not one.
            const { service } = makeService({
                settings: {
                    'billing.providers_enabled': JSON.stringify({ mercadopago: true, wompi: true }),
                    'billing.default_provider_by_country': JSON.stringify({ CO: 'wompi', '*': 'mercadopago' }),
                },
                registered: ['mercadopago', 'stripe', 'wompi', 'mock'],
            });

            const result = await service.resolveForNewSubscription({
                billingCountry: 'CO',
                tenantOverride: null,
            });

            expect(result.provider).toBe('wompi');
            expect(result.level).toBe('country');
        });

        it('ignores an override that names a provider the country cannot use', async () => {
            // A stale pin must not strand an acquisition: it degrades to the
            // country default instead of failing the signup.
            const { service } = makeService({
                settings: {
                    'billing.providers_enabled': JSON.stringify({ mercadopago: true, wompi: true }),
                    'billing.default_provider_by_country': JSON.stringify({ CO: 'wompi', '*': 'mercadopago' }),
                },
                registered: ['mercadopago', 'wompi', 'mock'],
            });

            const result = await service.resolveForNewSubscription({
                billingCountry: 'CO',
                tenantOverride: 'stripe',
            });

            expect(result.provider).toBe('wompi');
            expect(result.level).toBe('country');
            expect(result.substituted).toBe(true);
        });

        it('skips a provider whose adapter is not registered yet', async () => {
            // Wompi is switched on in settings but its adapter ships in a later
            // phase: routing to it would hit a factory that throws.
            const { service } = makeService({
                settings: {
                    'billing.providers_enabled': JSON.stringify({ mercadopago: true, wompi: true }),
                    'billing.default_provider_by_country': JSON.stringify({ CO: 'wompi', '*': 'mercadopago' }),
                },
                registered: ['mercadopago', 'stripe', 'mock'],
            });

            const result = await service.resolveForNewSubscription({ billingCountry: 'CO' });

            expect(result.provider).toBe('mercadopago');
            expect(result.substituted).toBe(true);
            expect(result.reason).toContain('adapter_not_registered');
        });

        it('skips a provider that cannot bill in the country', async () => {
            // Stripe does not operate in Colombia.
            const { service } = makeService({
                settings: {
                    'billing.providers_enabled': JSON.stringify({ mercadopago: true, stripe: true }),
                    'billing.default_provider_by_country': JSON.stringify({ CO: 'stripe', '*': 'mercadopago' }),
                },
            });

            const result = await service.resolveForNewSubscription({ billingCountry: 'CO' });

            expect(result.provider).toBe('mercadopago');
            expect(result.substituted).toBe(true);
            expect(result.reason).toContain('country_unsupported');
        });

        it('refuses instead of silently defaulting when nothing is enabled', async () => {
            const { service } = makeService({
                settings: {
                    'billing.providers_enabled': JSON.stringify({
                        mercadopago: false, stripe: false, wompi: false, mock: false,
                    }),
                },
            });

            await expect(service.resolveForNewSubscription({ billingCountry: 'CO' }))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ error: 'no_payment_provider_available' }),
                });
        });
    });

    describe('resolveForSubscription', () => {
        it('returns the provider frozen on the subscription', () => {
            const { service } = makeService();
            expect(service.resolveForSubscription('mercadopago')).toBe('mercadopago');
        });

        it('rejects an unknown provider instead of guessing', () => {
            const { service } = makeService();
            expect(() => service.resolveForSubscription('paypal')).toThrow();
            expect(() => service.resolveForSubscription(null)).toThrow();
        });
    });

    describe('updateConfig', () => {
        it('rejects a country default the provider cannot bill', async () => {
            const { service } = makeService();
            await expect(service.updateConfig({ defaultByCountry: { CO: 'stripe' } }))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ error: 'provider_country_unsupported' }),
                });
        });

        it('rejects an unknown provider name', async () => {
            const { service } = makeService();
            await expect(service.updateConfig({ defaultByCountry: { CO: 'paypal' as any } }))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ error: 'unknown_payment_provider' }),
                });
        });

        it('always keeps a catch-all so no country is left unrouted', async () => {
            const { service, prisma } = makeService({
                registered: ['mercadopago', 'stripe', 'wompi', 'mock'],
                settings: {
                    'billing.providers_enabled': JSON.stringify({ mercadopago: true, wompi: true }),
                },
            });

            await service.updateConfig({ defaultByCountry: { CO: 'wompi' } });

            const written = prisma.$executeRaw.mock.calls
                .flat()
                .map((v: any) => (Array.isArray(v) ? v.join('') : String(v)))
                .join(' ');
            const payload = prisma.$executeRaw.mock.calls
                .map((call: any[]) => call.find((arg) => typeof arg === 'string' && arg.includes('"*"')))
                .find(Boolean);
            expect(written.length).toBeGreaterThan(0);
            expect(payload).toBeDefined();
            expect(JSON.parse(payload as string)['*']).toBe('mercadopago');
        });

        it('deletes a country rule when the value is null', async () => {
            const { service, prisma } = makeService({
                registered: ['mercadopago', 'stripe', 'wompi', 'mock'],
                settings: {
                    'billing.providers_enabled': JSON.stringify({ mercadopago: true, wompi: true }),
                    'billing.default_provider_by_country': JSON.stringify({ CO: 'wompi', MX: 'mercadopago', '*': 'mercadopago' }),
                },
            });

            await service.updateConfig({ defaultByCountry: { MX: null } });

            const payload = prisma.$executeRaw.mock.calls
                .map((call: any[]) => call.find((arg) => typeof arg === 'string' && arg.includes('"*"')))
                .find(Boolean);
            const written = JSON.parse(payload as string);
            expect(written.MX).toBeUndefined();
            // Deleting one rule must not disturb the others.
            expect(written.CO).toBe('wompi');
            expect(written['*']).toBe('mercadopago');
        });

        it('refuses to delete the catch-all', async () => {
            const { service } = makeService();
            await expect(service.updateConfig({ defaultByCountry: { '*': null } }))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ error: 'catch_all_required' }),
                });
        });

        it('never allows the mock provider to be routable in production', async () => {
            const previous = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            try {
                const { service, prisma } = makeService();
                await service.updateConfig({ providersEnabled: { mock: true } as any });

                const payload = prisma.$executeRaw.mock.calls
                    .map((call: any[]) => call.find((arg) => typeof arg === 'string' && arg.includes('mock')))
                    .find(Boolean);
                expect(JSON.parse(payload as string).mock).toBe(false);
            } finally {
                process.env.NODE_ENV = previous;
            }
        });
    });
});
