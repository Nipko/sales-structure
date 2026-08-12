const MAX_EMAIL_MESSAGE_ID_LENGTH = 2_048;

/**
 * Return the one stable provider identity used by the controller, adapter and
 * BullMQ producer. Header precedence mirrors provider semantics; the explicit
 * JSON field is the managed-adapter fallback.
 */
export function canonicalEmailMessageId(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const body = payload as Record<string, unknown>;
    const headers = typeof body.headers === 'string' ? body.headers : '';
    const headerValue = extractEmailHeader(headers, 'Message-ID');
    const fieldValue = typeof body['message-id'] === 'string' ? body['message-id'] : '';
    return normalizeEmailMessageId(headerValue || fieldValue);
}

function extractEmailHeader(headers: string, name: string): string {
    if (!headers) return '';
    const match = headers.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'));
    return match?.[1] || '';
}

function normalizeEmailMessageId(raw: string): string | null {
    const value = raw.trim();
    if (!value || value.length > MAX_EMAIL_MESSAGE_ID_LENGTH || /[\r\n\0]/.test(value)) {
        return null;
    }
    return value;
}
