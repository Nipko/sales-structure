import { authFailureReason, isSessionConflict, withSessionTakeover } from '../authResponse';

describe('isSessionConflict', () => {
    it('recognizes the stable backend code preserved by the response parser', () => {
        expect(isSessionConflict({
            success: false,
            error: 'Ya hay una sesión activa para esta cuenta',
            errorCode: 'session_conflict',
            message: 'Ya hay una sesión activa para esta cuenta',
        })).toBe(true);
    });

    it('recognizes message-only legacy envelopes in Spanish and English', () => {
        expect(isSessionConflict({ error: 'Ya hay una sesión activa para esta cuenta' })).toBe(true);
        expect(isSessionConflict({ message: 'An active session already exists' })).toBe(true);
    });

    it('does not force a retry for unrelated authentication failures', () => {
        expect(isSessionConflict({ errorCode: 'tenant_session_limit', error: 'Límite alcanzado' })).toBe(false);
        expect(isSessionConflict({ error: 'Invalid credentials' })).toBe(false);
        expect(isSessionConflict({ error: 'No active session exists' })).toBe(false);
    });
});

describe('authFailureReason', () => {
    it('prefers stable backend codes used by localized auth flows', () => {
        expect(authFailureReason({
            errorCode: 'no_account',
            error: 'No account exists for this Google identity',
        }, 'fallback')).toBe('no_account');
    });

    it('retains legacy errors and falls back when the response has no detail', () => {
        expect(authFailureReason({ error: 'Invalid credentials' }, 'fallback')).toBe('Invalid credentials');
        expect(authFailureReason({}, 'fallback')).toBe('fallback');
    });
});

describe('withSessionTakeover', () => {
    it('retries exactly once with force=true after a session conflict', async () => {
        const request = jest.fn()
            .mockResolvedValueOnce({ errorCode: 'session_conflict' })
            .mockResolvedValueOnce({ success: true, data: { accessToken: 'token' } });

        await expect(withSessionTakeover(request)).resolves.toEqual({
            success: true,
            data: { accessToken: 'token' },
        });
        expect(request.mock.calls).toEqual([[false], [true]]);
    });

    it('does not retry credentials or transport failures', async () => {
        const request = jest.fn().mockResolvedValue({ success: false, error: 'Invalid credentials' });

        await expect(withSessionTakeover(request)).resolves.toEqual({
            success: false,
            error: 'Invalid credentials',
        });
        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith(false);
    });
});
