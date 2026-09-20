import { BillingPublicController } from './billing-public.controller';

describe('billing market country suggestion', () => {
    const controller = (trusted: boolean) => new BillingPublicController(
        {} as any, {} as any, {} as any, {} as any,
        { get: () => trusted ? 'true' : 'false' } as any,
    );
    it.each([['CO', 'wompi'], ['MX', 'stripe'], ['ES', 'stripe']])('suggests the correct provider for trusted %s', (country, provider) => {
        expect(controller(true).market({ headers: { 'cf-ipcountry': country } }).data)
            .toMatchObject({ country, provider, source: 'edge' });
    });
    it.each([undefined, 'XX', 'T1', 'ZZ', ['US', 'CO']])('does not turn an unknown location into Colombia (%s)', value => {
        expect(controller(true).market({ headers: { 'cf-ipcountry': value } }).data)
            .toMatchObject({ country: null, provider: null, source: 'unknown' });
    });
    it('ignores headers when direct-origin trust is disabled', () => {
        const data = controller(false).market({ headers: { 'cf-ipcountry': 'CO' } }).data;
        expect(data.country).toBeNull();
        expect(data.supportedCountries).toContain('CO');
        expect(data.supportedCountries).toContain('US');
    });
});
