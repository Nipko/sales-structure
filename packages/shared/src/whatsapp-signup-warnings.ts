/**
 * ═══ WHAT AN EMBEDDED SIGNUP LEFT OPEN, AS CODES ═══
 *
 * A WhatsApp number can finish Embedded Signup "connected" and still unable to
 * answer: Meta did not confirm the webhook subscription, or did not register
 * the number for the Cloud API. The WhatsApp service records what it left open
 * as these codes on the onboarding row (`whatsapp_onboardings.exchange_payload`
 * → `warnings`); the API hands the latest of them back per connected number on
 * `GET /channels/whatsapp/status`; the dashboard translates each one.
 *
 * One list for the two services, so a code the WhatsApp service starts writing
 * is not silently dropped by the API's filter (that is how a new warning would
 * vanish between the signup and the screen). The copy is not here: it lives in
 * the dashboard's i18n, next to what the owner can do about it.
 */

export const WHATSAPP_SIGNUP_WARNING_CODES = [
    /** `POST /{waba}/subscribed_apps` did not answer success: customers' messages may never reach us. */
    'webhook_subscription_failed',
    /** The business portfolio is not verified: replies go out, under Meta's daily cap. */
    'business_not_verified',
    /**
     * Meta did not register the number for the Cloud API and does not read it
     * as connected: nothing can be sent from it.
     */
    'phone_registration_deferred',
    /** Templates could not be fetched: a reply inside the 24-hour window still goes out. */
    'template_sync_failed',
] as const;

export type WhatsAppSignupWarningCode = typeof WHATSAPP_SIGNUP_WARNING_CODES[number];

const KNOWN: ReadonlySet<string> = new Set(WHATSAPP_SIGNUP_WARNING_CODES);

export function isWhatsAppSignupWarningCode(value: unknown): value is WhatsAppSignupWarningCode {
    return typeof value === 'string' && KNOWN.has(value);
}

/**
 * The known codes in `value`, once each, in the order they were written.
 *
 * Anything else — free text, a code from a newer writer, a non-array — is
 * dropped: what reaches a screen is always something it knows how to say.
 */
export function whatsAppSignupWarningCodes(value: unknown): WhatsAppSignupWarningCode[] {
    if (!Array.isArray(value)) return [];
    const codes: WhatsAppSignupWarningCode[] = [];
    for (const candidate of value) {
        if (isWhatsAppSignupWarningCode(candidate) && !codes.includes(candidate)) codes.push(candidate);
    }
    return codes;
}
