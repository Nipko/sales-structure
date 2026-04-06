import * as crypto from 'crypto';

/**
 * Validates Meta webhook HMAC-SHA256 signatures.
 * Shared between WhatsApp, Instagram, and Messenger webhooks.
 */
export function validateMetaSignature(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    appSecret: string | undefined,
): boolean {
    if (!appSecret) return true; // Skip in dev if not configured
    if (!rawBody || !signature) return false;

    try {
        const expectedSig = 'sha256=' + crypto
            .createHmac('sha256', appSecret)
            .update(rawBody)
            .digest('hex');

        return crypto.timingSafeEqual(
            Buffer.from(expectedSig),
            Buffer.from(signature),
        );
    } catch {
        return false;
    }
}
