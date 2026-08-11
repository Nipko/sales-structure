/**
 * Detect the backend's single-session conflict across both its structured
 * error code and older/message-only response envelopes.
 */
export function isSessionConflict(result: any): boolean {
    if (result?.errorCode === 'session_conflict' || result?.error === 'session_conflict') {
        return true;
    }

    const detail = [result?.message, result?.error]
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase();

    return detail.includes('ya hay una sesión activa') || detail.includes('an active session already exists');
}

/** Prefer a stable backend identifier, while retaining legacy message envelopes. */
export function authFailureReason(result: any, fallback: string): string {
    if (typeof result?.errorCode === 'string') return result.errorCode;
    if (typeof result?.error === 'string') return result.error;
    if (typeof result?.error?.message === 'string') return result.error.message;
    if (typeof result?.message === 'string') return result.message;
    return fallback;
}

/** Retry once with takeover enabled when the same client already owns a session. */
export async function withSessionTakeover<T>(request: (force: boolean) => Promise<T>): Promise<T> {
    let result = await request(false);
    if (isSessionConflict(result)) result = await request(true);
    return result;
}
