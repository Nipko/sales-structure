/**
 * Parallly — Customer Portal i18n
 *
 * Lang-keyed message map for client-facing error messages in the Customer Portal
 * magic-link authentication flow. Mirrors the `MESSAGES` + `msg()` pattern from
 * booking-engine.service.ts and the `EMAIL_MSG` + `emsg()` pattern from email-i18n.ts.
 *
 * Lang source: tenant.language (no client language available during pre-session auth).
 * Fallback: "es" (Latin American market default).
 *
 * NOTE: logs/console strings and internal exception keys are intentionally NOT translated.
 */

export const CP_MSG: Record<'es' | 'en' | 'pt' | 'fr', Record<string, string>> = {
    es: {
        'auth.tooManyRequests':    'Demasiadas solicitudes. Por favor, inténtalo de nuevo más tarde.',
        'auth.codeExpired':        'El código de verificación expiró o no existe. Solicita uno nuevo.',
        'auth.tooManyAttempts':    'Demasiados intentos fallidos. Solicita un nuevo código.',
        'auth.invalidCode':        'Código de verificación incorrecto.',
    },
    en: {
        'auth.tooManyRequests':    'Too many requests. Please try again later.',
        'auth.codeExpired':        'Verification code expired or not found. Request a new one.',
        'auth.tooManyAttempts':    'Too many failed attempts. Request a new code.',
        'auth.invalidCode':        'Invalid verification code.',
    },
    pt: {
        'auth.tooManyRequests':    'Muitas solicitações. Por favor, tente novamente mais tarde.',
        'auth.codeExpired':        'Código de verificação expirado ou não encontrado. Solicite um novo.',
        'auth.tooManyAttempts':    'Muitas tentativas falhadas. Solicite um novo código.',
        'auth.invalidCode':        'Código de verificação inválido.',
    },
    fr: {
        'auth.tooManyRequests':    'Trop de requêtes. Veuillez réessayer plus tard.',
        'auth.codeExpired':        'Code de vérification expiré ou introuvable. Demandez-en un nouveau.',
        'auth.tooManyAttempts':    'Trop de tentatives échouées. Demandez un nouveau code.',
        'auth.invalidCode':        'Code de vérification incorrect.',
    },
};

export type CpLang = keyof typeof CP_MSG;

/**
 * Resolve a translated customer-portal string.
 *
 * @param lang  Raw language tag (e.g. "es-CO", "en", "pt-BR"). First 2 chars are used.
 * @param key   Message key (e.g. "auth.tooManyRequests").
 * @returns     Translated string. Falls back to "es", then to the key itself.
 */
export function cpmsg(lang: string, key: string): string {
    const code = (lang || 'es').substring(0, 2).toLowerCase() as CpLang;
    const dict = CP_MSG[code] ?? CP_MSG.es;
    return dict[key] ?? CP_MSG.es[key] ?? key;
}
