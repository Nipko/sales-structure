import { sanitizeSignupAttribution } from './signup-attribution.util';

describe('sanitizeSignupAttribution', () => {
    it('keeps only bounded acquisition fields', () => {
        expect(sanitizeSignupAttribution({
            source: 'marketing_site', utmSource: 'google', utmCampaign: 'x'.repeat(300),
            arbitraryUrl: 'https://example.test/?token=secret', countryIntent: 'co', cycleIntent: 'annual',
        })).toEqual(expect.objectContaining({
            source: 'google', utmSource: 'google', countryIntent: 'CO', cycleIntent: 'annual',
            utmCampaign: 'x'.repeat(160),
        }));
        expect(sanitizeSignupAttribution({ arbitraryUrl: 'secret' })).not.toHaveProperty('arbitraryUrl');
    });

    it('defaults an attributed signup without a source to direct', () => {
        expect(sanitizeSignupAttribution({})).toEqual(expect.objectContaining({ source: 'direct' }));
        expect(sanitizeSignupAttribution(null)).toBeUndefined();
    });
});
