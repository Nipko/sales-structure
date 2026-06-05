/**
 * Test the single-flight behaviour of refreshAccessToken: two concurrent callers
 * (e.g. the inbox + agent sockets both hitting an expired token at once) must
 * trigger exactly ONE /auth/refresh request and share its result.
 */
jest.mock('expo-secure-store', () => ({
    getItemAsync: jest.fn(async (k: string) => (k.includes('refresh') ? 'refresh-tok' : 'access-tok')),
    setItemAsync: jest.fn(),
    deleteItemAsync: jest.fn(),
}));
jest.mock('../config', () => ({ API_URL: 'https://api.test/api/v1' }));

import { refreshAccessToken } from '../api';

afterEach(() => jest.clearAllMocks());

describe('refreshAccessToken', () => {
    it('coalesces concurrent calls into a single network request', async () => {
        const response = { ok: true, json: async () => ({ success: true, data: { accessToken: 'NEW_TOKEN' } }) };
        (global as any).fetch = jest.fn(async () => response);

        // Two concurrent callers (started synchronously, before the first awaits).
        const [t1, t2] = await Promise.all([refreshAccessToken(), refreshAccessToken()]);

        expect((global as any).fetch).toHaveBeenCalledTimes(1);
        expect(t1).toBe('NEW_TOKEN');
        expect(t2).toBe('NEW_TOKEN');
    });

    it('returns null when the refresh response is not ok', async () => {
        (global as any).fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) }));
        const result = await refreshAccessToken();
        expect(result).toBeNull();
    });

    it('returns null (no throw) on network error', async () => {
        (global as any).fetch = jest.fn(async () => { throw new Error('network down'); });
        await expect(refreshAccessToken()).resolves.toBeNull();
    });
});
