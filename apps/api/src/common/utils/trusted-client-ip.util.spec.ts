import { resolveTrustedClientIp } from './trusted-client-ip.util';

describe('resolveTrustedClientIp', () => {
    it('uses CF-Connecting-IP behind the production Docker/Tunnel peer', () => {
        expect(resolveTrustedClientIp({
            socket: { remoteAddress: '::ffff:172.19.0.4' },
            headers: {
                'cf-connecting-ip': '203.0.113.24',
                'x-forwarded-for': '198.51.100.9, 203.0.113.24',
            },
        }, { trustPrivateProductionProxy: true })).toBe('203.0.113.24');
    });

    it('ignores spoofed forwarding headers from an untrusted direct peer', () => {
        expect(resolveTrustedClientIp({
            socket: { remoteAddress: '198.51.100.42' },
            headers: {
                'cf-connecting-ip': '203.0.113.55',
                'x-forwarded-for': '203.0.113.56',
            },
        }, { trustPrivateProductionProxy: true })).toBe('198.51.100.42');
    });

    it('requires explicit proxy configuration outside the production default', () => {
        const request = {
            socket: { remoteAddress: '127.0.0.1' },
            headers: { 'cf-connecting-ip': '203.0.113.77' },
        };
        expect(resolveTrustedClientIp(request)).toBe('127.0.0.1');
        expect(resolveTrustedClientIp(request, {
            trustedProxyCidrs: '127.0.0.1',
        })).toBe('203.0.113.77');
    });

    it('rejects malformed forwarded values even from a trusted peer', () => {
        expect(resolveTrustedClientIp({
            socket: { remoteAddress: '10.0.0.8' },
            headers: { 'cf-connecting-ip': 'not-an-ip' },
        }, { trustPrivateProductionProxy: true })).toBe('10.0.0.8');
    });
});
