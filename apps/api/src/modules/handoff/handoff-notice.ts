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
    es: 'Entiendo su solicitud. Le estoy transfiriendo con nuestro equipo de atención. Un agente le responderá en breve. 🙋',
    en: `Got it. I'm transferring you to our support team. An agent will reply shortly. 🙋`,
    pt: 'Entendi a sua solicitação. Estou transferindo você para a nossa equipe de atendimento. Um atendente responderá em breve. 🙋',
    fr: 'Compris. Je vous transfère à notre équipe support. Un agent vous répondra sous peu. 🙋',
});

export const HANDOFF_TRANSFERRING: NoticeCatalog = Object.freeze({
    es: 'Le voy a transferir con un agente de nuestro equipo.',
    en: `I'll transfer you to an agent from our team.`,
    pt: 'Vou transferir você para um atendente da nossa equipe.',
    fr: 'Je vais vous transférer à un agent de notre équipe.',
});

/** Already used by the approved-effect handoff; shared so both paths agree. */
export const HANDOFF_INBOX_NOTICE: NoticeCatalog = Object.freeze({
    es: 'Su conversación quedó en la bandeja de atención. Una persona podrá continuar por este chat.',
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

/**
 * What the agent cannot do, said BEFORE the transfer notice when the reason is a request only a person may grant. A customer
 * who asked for a discount and only read «Le estoy transfiriendo…» did not learn that the discount was not confirmed
 * (F4300-07): the transfer must not read as a yes. Deterministic like the notices above; null for every other reason.
 */
const HANDOFF_REASON_PREFACE: Readonly<Record<string, NoticeCatalog>> = Object.freeze({
    discount_request: Object.freeze({
        es: 'No puedo confirmar descuentos ni precios especiales; eso lo aprueba nuestro equipo.',
        en: `I can't confirm discounts or special prices; our team has to approve them.`,
        pt: 'Não posso confirmar descontos nem preços especiais; isso precisa ser aprovado pela nossa equipe.',
        fr: `Je ne peux pas confirmer de remise ni de prix spécial ; c'est notre équipe qui les approuve.`,
    }),
});

export function handoffReasonPreface(reason: string | null | undefined, language: HandoffNoticeLanguage): string | null {
    const catalog = reason && Object.prototype.hasOwnProperty.call(HANDOFF_REASON_PREFACE, reason) ? HANDOFF_REASON_PREFACE[reason] : undefined;
    return catalog ? (catalog[language] || catalog.es) : null;
}
