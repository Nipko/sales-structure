/**
 * Customer-facing notices for a handoff that already happened.
 *
 * Deterministic layer: the wording is chosen by the server from a closed set of
 * kinds, never produced or edited by the model. A durable handoff receipt names
 * the kind and the language; the text is derived here at admission time and is
 * never stored inside the receipt. That is what makes the notice reproducible
 * from the receipt alone and impossible to widen into arbitrary model prose.
 */
export const HANDOFF_NOTICE_LANGUAGES = ['es', 'en', 'pt', 'fr'] as const;
export type HandoffNoticeLanguage = (typeof HANDOFF_NOTICE_LANGUAGES)[number];

/**
 * `none` authorizes the receipt without adding any deterministic sentence: the
 * turn's own answer already told the customer about the transfer. It is not a
 * licence to admit unrelated text — the receipt still binds one exact inbound.
 */
export const HANDOFF_NOTICE_KINDS = ['queue_head', 'transferring', 'inbox_notice', 'none'] as const;
export type HandoffNoticeKind = (typeof HANDOFF_NOTICE_KINDS)[number];

type NoticeCatalog = Record<HandoffNoticeLanguage, string>;

/** Kept identical to the conversation runtime copy, which imports these. */
export const HANDOFF_QUEUE_HEAD: NoticeCatalog = Object.freeze({
    es: 'Entiendo tu solicitud. Te estoy transfiriendo con nuestro equipo de atención. Un agente te responderá en breve. 🙋',
    en: `Got it. I'm transferring you to our support team. An agent will reply shortly. 🙋`,
    pt: 'Entendi. Estou te transferindo para nossa equipe de atendimento. Um atendente responderá em breve. 🙋',
    fr: 'Compris. Je vous transfère à notre équipe support. Un agent vous répondra sous peu. 🙋',
});

export const HANDOFF_TRANSFERRING: NoticeCatalog = Object.freeze({
    es: 'Te voy a transferir con un agente de nuestro equipo.',
    en: `I'll transfer you to an agent from our team.`,
    pt: 'Vou te transferir para um atendente da nossa equipe.',
    fr: 'Je vais vous transférer à un agent de notre équipe.',
});

/** Already used by the approved-effect handoff; shared so both paths agree. */
export const HANDOFF_INBOX_NOTICE: NoticeCatalog = Object.freeze({
    es: 'Tu conversación quedó en la bandeja de atención. Una persona podrá continuar por este chat.',
    en: 'Your conversation is in the support inbox. A person can continue with you in this chat.',
    pt: 'Sua conversa está na caixa de atendimento. Uma pessoa poderá continuar por este chat.',
    fr: 'Votre conversation est dans la boîte de réception du service client. Une personne pourra continuer dans ce chat.',
});

const CATALOGS: Record<Exclude<HandoffNoticeKind, 'none'>, NoticeCatalog> = Object.freeze({
    queue_head: HANDOFF_QUEUE_HEAD,
    transferring: HANDOFF_TRANSFERRING,
    inbox_notice: HANDOFF_INBOX_NOTICE,
});

export function isHandoffNoticeKind(value: unknown): value is HandoffNoticeKind {
    return typeof value === 'string' && (HANDOFF_NOTICE_KINDS as readonly string[]).includes(value);
}

/** Narrow any detected language to the four the deterministic layer ships. */
export function handoffNoticeLanguage(value?: string | null): HandoffNoticeLanguage {
    const code = String(value || 'es').slice(0, 2).toLowerCase();
    return (HANDOFF_NOTICE_LANGUAGES as readonly string[]).includes(code) ? (code as HandoffNoticeLanguage) : 'es';
}

/**
 * The one place a receipt turns into words. Returns null only for `none`, which
 * means "no deterministic sentence", never "unknown kind" — an unknown kind
 * throws, so a corrupted receipt cannot silently degrade into a silent turn.
 */
export function handoffNoticeText(kind: HandoffNoticeKind, language: HandoffNoticeLanguage): string | null {
    if (kind === 'none') return null;
    const catalog = CATALOGS[kind];
    if (!catalog) throw new Error('handoff_notice_kind_unknown');
    return catalog[language] || catalog.es;
}
