/**
 * en/pt/fr translations of DEFAULT_TEMPLATES (the canonical Spanish set lives in
 * email-templates.service.ts). Keyed by language → slug → {name?, subject, bodyHtml}.
 *
 * Filled in batches. Any slug/language absent here is simply NOT seeded, and
 * EmailTemplatesService.getBySlug(slug, lang) falls back to the canonical 'es'
 * row — so an email is NEVER missing while a translation is still pending.
 *
 * RULES when adding entries: preserve the HTML structure/inline styles/emoji and
 * keep every {{placeholder}} verbatim — translate visible text only.
 */
export type TemplateTranslation = { name?: string; subject: string; bodyHtml: string };

export const TEMPLATE_TRANSLATIONS: Record<string, Record<string, TemplateTranslation>> = {
    en: {},
    pt: {},
    fr: {},
};
