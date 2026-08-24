import { captureSignupAttribution, readSignupAttribution, saveSignupAttribution } from './signup-attribution';

function storage(): Storage {
    const values = new Map<string, string>();
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, value); },
        removeItem: key => { values.delete(key); },
        clear: () => values.clear(),
        key: index => [...values.keys()][index] ?? null,
        get length() { return values.size; },
    };
}

describe('signup attribution', () => {
    it('prefers campaign source and retains commercial intent', () => {
        const result = captureSignupAttribution(
            '?source=marketing_site&utm_source=google&utm_medium=cpc&utm_campaign=hoteles&plan=pro&country=co&cycle=annual',
            'https://parallly-chat.cloud/precios',
            new Date('2026-08-23T00:00:00.000Z'),
        );
        expect(result).toMatchObject({
            source: 'google', utmMedium: 'cpc', utmCampaign: 'hoteles',
            planIntent: 'pro', countryIntent: 'CO', cycleIntent: 'annual',
            referrerHost: 'parallly-chat.cloud',
        });
    });

    it('records direct traffic deterministically and survives verification redirects', () => {
        const bag = storage();
        const captured = captureSignupAttribution('', '', new Date('2026-08-23T00:00:00.000Z'));
        saveSignupAttribution(captured, bag);
        expect(readSignupAttribution(bag)).toEqual(expect.objectContaining({ source: 'direct' }));
    });

    it('bounds campaign input before it reaches telemetry', () => {
        const result = captureSignupAttribution(`?utm_campaign=${'x'.repeat(500)}`, '');
        expect(result.utmCampaign).toHaveLength(160);
    });
});
