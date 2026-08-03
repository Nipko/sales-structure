import { MercadoPagoConfigService } from './mercadopago-config.service';

describe('MercadoPagoConfigService credential inference', () => {
    const originalAccessToken = process.env.MP_ACCESS_TOKEN;

    afterEach(() => {
        if (originalAccessToken === undefined) {
            delete process.env.MP_ACCESS_TOKEN;
        } else {
            process.env.MP_ACCESS_TOKEN = originalAccessToken;
        }
    });

    it.each([
        [undefined, 'unconfigured', 'unconfigured'],
        ['TEST-redacted', 'test', 'sandbox'],
        ['APP_USR-redacted', 'app_usr', 'production'],
        ['opaque-redacted', 'unknown', 'production'],
    ] as const)('maps a redacted token to %s / %s', (token, credentialMode, environment) => {
        if (token === undefined) {
            delete process.env.MP_ACCESS_TOKEN;
        } else {
            process.env.MP_ACCESS_TOKEN = token;
        }

        const service = new MercadoPagoConfigService();

        expect(service.credentialModeInferred()).toBe(credentialMode);
        expect(service.environment()).toBe(environment);
    });
});
