import { WompiConfigService } from './wompi-config.service';

describe('WompiConfigService', () => {
    const names = [
        'WOMPI_PUBLIC_KEY',
        'WOMPI_PRIVATE_KEY',
        'WOMPI_EVENTS_SECRET',
        'WOMPI_INTEGRITY_SECRET',
    ] as const;
    const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSandboxOverride = process.env.WOMPI_ALLOW_SANDBOX_IN_PRODUCTION;

    afterEach(() => {
        for (const name of names) {
            const value = original[name];
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
        if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = originalNodeEnv;
        if (originalSandboxOverride === undefined) delete process.env.WOMPI_ALLOW_SANDBOX_IN_PRODUCTION;
        else process.env.WOMPI_ALLOW_SANDBOX_IN_PRODUCTION = originalSandboxOverride;
    });

    function serviceWith(values: Partial<Record<typeof names[number], string>>) {
        for (const name of names) {
            const value = values[name];
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
        const service = new WompiConfigService();
        service.onModuleInit();
        return service;
    }

    it('enables a complete sandbox rail with role-correct keys', () => {
        const service = serviceWith({
            WOMPI_PUBLIC_KEY: 'pub_test_public',
            WOMPI_PRIVATE_KEY: 'prv_test_private',
            WOMPI_EVENTS_SECRET: 'test_events_secret',
            WOMPI_INTEGRITY_SECRET: 'test_integrity_secret',
        });
        expect(service.isConfigured()).toBe(true);
        expect(service.canVerifyWebhooks()).toBe(true);
        expect(service.environment()).toBe('sandbox');
        expect(service.baseUrl).toBe('https://sandbox.wompi.co/v1');
    });

    it('does not route a partially configured rail', () => {
        const service = serviceWith({
            WOMPI_PRIVATE_KEY: 'prv_prod_private',
            WOMPI_INTEGRITY_SECRET: 'prod_integrity_secret',
        });
        expect(service.environment()).toBe('production');
        expect(service.isConfigured()).toBe(false);
        expect(() => service.privateKey).toThrow(/not configured/i);
    });

    it('rejects a secret placed in the wrong credential role', () => {
        const service = serviceWith({
            WOMPI_PUBLIC_KEY: 'prv_test_private-in-public-slot',
            WOMPI_PRIVATE_KEY: 'pub_test_public-in-private-slot',
            WOMPI_EVENTS_SECRET: 'test_events_secret',
            WOMPI_INTEGRITY_SECRET: 'test_integrity_secret',
        });
        expect(service.environment()).toBe('unconfigured');
        expect(service.isConfigured()).toBe(false);
        expect(service.canVerifyWebhooks()).toBe(false);
        expect(() => service.baseUrl).toThrow(/environment is not configured/i);
    });

    it('rejects mixed sandbox and production credentials', () => {
        const service = serviceWith({
            WOMPI_PUBLIC_KEY: 'pub_test_public',
            WOMPI_PRIVATE_KEY: 'prv_prod_private',
            WOMPI_EVENTS_SECRET: 'test_events_secret',
            WOMPI_INTEGRITY_SECRET: 'test_integrity_secret',
        });
        expect(service.environment()).toBe('unconfigured');
        expect(service.isConfigured()).toBe(false);
        expect(service.eventsSecret).toBeUndefined();
    });

    it('rejects sandbox credentials in a production runtime by default', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.WOMPI_ALLOW_SANDBOX_IN_PRODUCTION;
        const service = serviceWith({
            WOMPI_PUBLIC_KEY: 'pub_test_public',
            WOMPI_PRIVATE_KEY: 'prv_test_private',
            WOMPI_EVENTS_SECRET: 'test_events_secret',
            WOMPI_INTEGRITY_SECRET: 'test_integrity_secret',
        });
        expect(service.environment()).toBe('unconfigured');
        expect(service.isConfigured()).toBe(false);
        expect(service.canVerifyWebhooks()).toBe(false);
    });

    it('allows an explicit sandbox override for isolated production-mode staging', () => {
        process.env.NODE_ENV = 'production';
        process.env.WOMPI_ALLOW_SANDBOX_IN_PRODUCTION = 'true';
        const service = serviceWith({
            WOMPI_PUBLIC_KEY: 'pub_test_public',
            WOMPI_PRIVATE_KEY: 'prv_test_private',
            WOMPI_EVENTS_SECRET: 'test_events_secret',
            WOMPI_INTEGRITY_SECRET: 'test_integrity_secret',
        });
        expect(service.environment()).toBe('sandbox');
        expect(service.isConfigured()).toBe(true);
    });
});
