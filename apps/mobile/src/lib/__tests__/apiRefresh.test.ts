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

import {
    api,
    AUTH_LOGOUT_TIMEOUT_MS,
    parseApiResponse,
    refreshAccessToken,
    requireApiSuccess,
} from '../api';

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

describe('api.logout timeout', () => {
    it('returns after a bounded timeout when the endpoint never responds', async () => {
        jest.useFakeTimers();
        try {
            (global as any).fetch = jest.fn(() => new Promise(() => undefined));
            const pending = api.logout('refresh-token');
            await Promise.resolve();
            jest.advanceTimersByTime(AUTH_LOGOUT_TIMEOUT_MS);
            await expect(pending).resolves.toBeUndefined();
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('safe API response parsing', () => {
    it.each([
        ['login', () => api.login('agent@example.com', 'secret')],
        ['google login', () => api.googleLogin('google-token')],
        ['2FA verify', () => api.verify2FA('challenge-token', '123456', 'totp')],
        ['2FA email', () => api.send2FAEmail('challenge-token')],
    ])('normalizes an empty/truncated %s response without leaking SyntaxError', async (_name, request) => {
        (global as any).fetch = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
        }));

        await expect(request()).resolves.toEqual({ success: false, error: 'empty_response' });
    });

    it('normalizes Nest HTTP errors and never treats them as successful payloads', async () => {
        const result = await parseApiResponse({
            ok: false,
            status: 502,
            json: async () => ({ message: 'Bad gateway' }),
        } as Response);

        expect(result).toEqual({ success: false, error: 'Bad gateway', message: 'Bad gateway' });
        expect(() => requireApiSuccess(result)).toThrow('Bad gateway');
    });

    it('preserves structured backend error details needed by auth flows', async () => {
        const result = await parseApiResponse({
            ok: false,
            status: 409,
            json: async () => ({
                error: 'session_conflict',
                message: 'Ya hay una sesión activa para esta cuenta',
            }),
        } as Response);

        expect(result).toEqual({
            success: false,
            error: 'Ya hay una sesión activa para esta cuenta',
            errorCode: 'session_conflict',
            message: 'Ya hay una sesión activa para esta cuenta',
        });
    });

    it('returns successful envelopes unchanged', () => {
        const result = { success: true, data: { id: 'ok' } };
        expect(requireApiSuccess(result)).toBe(result);
    });
});
