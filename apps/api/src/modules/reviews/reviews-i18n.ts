/**
 * Parallly — Reviews module i18n
 *
 * Lang-keyed message map for the Google Business Profile reviews module.
 * Mirrors the MESSAGES + msg() pattern used by booking-engine.service.ts
 * and the emsg() pattern used by email-i18n.ts.
 *
 * Conventions:
 *  - rmsg(lang, key) normalises the lang to 2 chars (e.g. "es-CO" → "es")
 *    and falls back to "es".
 *  - langSource: tenant.language (the tenant's configured UI / market language).
 *  - Logs, console strings, technical keys, and brand names are NOT translated.
 */

type ReviewsLang = 'es' | 'en' | 'pt' | 'fr';

const REVIEWS_MSG: Record<ReviewsLang, Record<string, string>> = {
    es: {
        // ── OAuth errors ──
        'oauth.invalidState': 'OAuth state inválido o expirado',
        'oauth.noRefreshToken': 'Google no devolvió refresh_token (revoca el acceso y reintenta)',
        'oauth.notConnected': 'Google Business no está conectado',
        'oauth.accessTokenFailed': 'No se pudo obtener access token de Google',

        // ── Sync / config errors ──
        'sync.missingAccountLocation': 'Falta accountId / locationId de Google Business',

        // ── Data display ──
        'review.anonymousReviewer': 'Anónimo',
        'review.noText': '(sin texto)',
        'review.notFound': 'Reseña no encontrada',

        // ── Reply validation ──
        'reply.empty': 'La respuesta no puede estar vacía',

        // ── AI reply prompt (passed to LLM — tenant sees the output, not this) ──
        // langInstruction is inserted into the system prompt so the LLM replies
        // in the tenant's language.
        'prompt.langInstruction': 'en español neutro de Latinoamérica',
        'prompt.fallbackBusiness': 'nuestro negocio',

        // ── User-prompt labels (shown inside the LLM context, not directly to users,
        //    but they help the model match language so we translate them) ──
        'prompt.labelClient': 'Cliente',
        'prompt.labelStars': 'Estrellas',
        'prompt.labelReview': 'Reseña',
    },

    en: {
        'oauth.invalidState': 'Invalid or expired OAuth state',
        'oauth.noRefreshToken': 'Google did not return a refresh_token (revoke access and try again)',
        'oauth.notConnected': 'Google Business is not connected',
        'oauth.accessTokenFailed': 'Could not obtain access token from Google',

        'sync.missingAccountLocation': 'Missing accountId / locationId for Google Business',

        'review.anonymousReviewer': 'Anonymous',
        'review.noText': '(no text)',
        'review.notFound': 'Review not found',

        'reply.empty': 'Reply cannot be empty',

        'prompt.langInstruction': 'in English',
        'prompt.fallbackBusiness': 'our business',

        'prompt.labelClient': 'Customer',
        'prompt.labelStars': 'Stars',
        'prompt.labelReview': 'Review',
    },

    pt: {
        'oauth.invalidState': 'Estado OAuth inválido ou expirado',
        'oauth.noRefreshToken': 'O Google não retornou um refresh_token (revogue o acesso e tente novamente)',
        'oauth.notConnected': 'Google Business não está conectado',
        'oauth.accessTokenFailed': 'Não foi possível obter o access token do Google',

        'sync.missingAccountLocation': 'Falta accountId / locationId do Google Business',

        'review.anonymousReviewer': 'Anônimo',
        'review.noText': '(sem texto)',
        'review.notFound': 'Avaliação não encontrada',

        'reply.empty': 'A resposta não pode estar vazia',

        'prompt.langInstruction': 'em português do Brasil',
        'prompt.fallbackBusiness': 'nosso negócio',

        'prompt.labelClient': 'Cliente',
        'prompt.labelStars': 'Estrelas',
        'prompt.labelReview': 'Avaliação',
    },

    fr: {
        'oauth.invalidState': 'État OAuth invalide ou expiré',
        'oauth.noRefreshToken': 'Google n\'a pas retourné de refresh_token (révoquez l\'accès et réessayez)',
        'oauth.notConnected': 'Google Business n\'est pas connecté',
        'oauth.accessTokenFailed': 'Impossible d\'obtenir un access token depuis Google',

        'sync.missingAccountLocation': 'accountId / locationId Google Business manquant',

        'review.anonymousReviewer': 'Anonyme',
        'review.noText': '(sans texte)',
        'review.notFound': 'Avis introuvable',

        'reply.empty': 'La réponse ne peut pas être vide',

        'prompt.langInstruction': 'en français',
        'prompt.fallbackBusiness': 'notre entreprise',

        'prompt.labelClient': 'Client',
        'prompt.labelStars': 'Étoiles',
        'prompt.labelReview': 'Avis',
    },
};

/**
 * Returns the translated string for the given key and language.
 * Normalises lang to 2 chars (e.g. "es-CO" → "es") and falls back to "es".
 */
export function rmsg(lang: string | undefined | null, key: string): string {
    const code = (lang || 'es').slice(0, 2).toLowerCase() as ReviewsLang;
    const map = REVIEWS_MSG[code] ?? REVIEWS_MSG.es;
    return map[key] ?? REVIEWS_MSG.es[key] ?? key;
}
