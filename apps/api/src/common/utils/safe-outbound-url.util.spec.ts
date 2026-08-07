import { BadRequestException } from '@nestjs/common';
import { promises as dns } from 'node:dns';
import {
    OUTBOUND_MAX_REQUEST_BYTES,
    OUTBOUND_MAX_RESPONSE_BYTES,
    isPrivateOrReservedAddress,
    parseSafeHttpsUrl,
    prepareSafeHttpsTarget,
    safeAxiosOptions,
} from './safe-outbound-url.util';

describe('safe outbound URL utility', () => {
    let lookupSpy: jest.SpyInstance;

    beforeEach(() => {
        lookupSpy = jest.spyOn(dns, 'lookup').mockResolvedValue([
            { address: '203.0.114.50', family: 4 },
        ] as any);
    });

    afterEach(() => {
        lookupSpy.mockRestore();
    });

    it.each([
        'http://public.example.com',
        'https://user:secret@public.example.com',
        'https://public.example.com:8443',
        'https://127.0.0.1',
        'https://service.internal',
        'not a url',
    ])('rejects unsafe URL syntax before DNS: %s', (url) => {
        expect(() => parseSafeHttpsUrl(url, 'test')).toThrow(BadRequestException);
        expect(lookupSpy).not.toHaveBeenCalled();
    });

    it.each([
        '0.0.0.0',
        '10.0.0.1',
        '100.64.0.1',
        '127.0.0.1',
        '169.254.169.254',
        '172.31.255.255',
        '192.168.1.1',
        '198.18.0.1',
        '::1',
        'fe80::1',
        'fc00::1',
        '::ffff:127.0.0.1',
        '::ffff:7f00:1',
        '2001:db8::1',
        '2002:7f00:1::',
    ])('recognizes private or special-use address %s', (address) => {
        expect(isPrivateOrReservedAddress(address)).toBe(true);
    });

    it.each([
        '8.8.8.8',
        '203.0.114.50',
        '2606:4700:4700::1111',
    ])('accepts globally routable address %s', (address) => {
        expect(isPrivateOrReservedAddress(address)).toBe(false);
    });

    it('rejects any DNS set containing a private answer', async () => {
        lookupSpy.mockResolvedValue([
            { address: '203.0.114.50', family: 4 },
            { address: '10.10.0.3', family: 4 },
        ] as any);

        await expect(prepareSafeHttpsTarget('https://api.example.com/path', 'test'))
            .rejects.toBeInstanceOf(BadRequestException);
    });

    it('pins the validated address and refuses lookup for a changed hostname', async () => {
        const target = await prepareSafeHttpsTarget('https://api.example.com/path?x=1', 'test');
        const lookup = (target.httpsAgent as any).options.lookup;

        lookupSpy.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as any);
        const pinnedCallback = jest.fn();
        lookup('api.example.com', { all: true }, pinnedCallback);
        expect(pinnedCallback).toHaveBeenCalledWith(null, [{ address: '203.0.114.50', family: 4 }]);
        expect(lookupSpy).toHaveBeenCalledTimes(1);

        const changedCallback = jest.fn();
        lookup('metadata.google.internal', { all: false }, changedCallback);
        expect(changedCallback.mock.calls[0][0]).toEqual(expect.objectContaining({ code: 'EAI_FAIL' }));
        target.httpsAgent.destroy();
    });

    it('provides bounded, direct, no-redirect Axios options', async () => {
        const target = await prepareSafeHttpsTarget('https://api.example.com', 'test');

        expect(safeAxiosOptions(target, 1234)).toEqual(expect.objectContaining({
            timeout: 1234,
            maxRedirects: 0,
            maxContentLength: OUTBOUND_MAX_RESPONSE_BYTES,
            maxBodyLength: OUTBOUND_MAX_REQUEST_BYTES,
            proxy: false,
            httpsAgent: target.httpsAgent,
        }));
        target.httpsAgent.destroy();
    });
});
