export const EMAIL_TEMPLATE_LANGUAGES = ['es', 'en', 'pt', 'fr'] as const;

export type EmailTemplateLanguage = (typeof EMAIL_TEMPLATE_LANGUAGES)[number];

const SUPPORTED = new Set<string>(EMAIL_TEMPLATE_LANGUAGES);

/** Normalize a detected locale such as `pt-BR` to a seeded template language. */
export function normalizeEmailTemplateLanguage(
    language: unknown,
): EmailTemplateLanguage {
    const base = String(language ?? 'es').trim().slice(0, 2).toLowerCase();
    return SUPPORTED.has(base) ? base as EmailTemplateLanguage : 'es';
}
