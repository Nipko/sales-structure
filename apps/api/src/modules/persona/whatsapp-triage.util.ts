/**
 * "¿Dónde vive hoy tu número de WhatsApp?" — the one answer the WhatsApp
 * screen asks for before it opens Meta's window (D12, sep-2026).
 *
 * Two of the five answers do not connect anything today ("no lo tengo a
 * mano", "ya lo usa otro proveedor"), and the screen promises "lo dejamos
 * anotado y lo retomas cuando lo tengas" and "te lo vamos a recordar en
 * Inicio". Until now the answer lived only in the browser's localStorage, so
 * that promise held on one device and was broken on any other one, in a
 * private window, or after clearing the browser. It lives here now, in
 * `tenants.settings.whatsappTriage`, written only through
 * `PUT /persona/:tenantId/whatsapp-triage` and read by `setup-status`.
 *
 * The ids mirror `WHATSAPP_TRIAGE_ANSWER_IDS` in the dashboard's
 * `whatsapp-triage.ts`; a value outside this list is refused on write and
 * reads back as `null`, never as a guess.
 */
export const WHATSAPP_TRIAGE_SETTING_KEY = 'whatsappTriage';

export const WHATSAPP_TRIAGE_ANSWER_IDS = [
    'business_app',
    'personal_app',
    'new_number',
    'other_provider',
    'not_at_hand',
] as const;

export type WhatsAppTriageAnswerId = typeof WHATSAPP_TRIAGE_ANSWER_IDS[number];

/** The exact shape `setup-status` exposes as `whatsappTriage` (or `null`). */
export interface WhatsAppTriageRecord {
    answerId: WhatsAppTriageAnswerId;
    /** ISO-8601, when this answer was first recorded. */
    recordedAt: string;
}

export function isWhatsAppTriageAnswerId(value: unknown): value is WhatsAppTriageAnswerId {
    return typeof value === 'string' && (WHATSAPP_TRIAGE_ANSWER_IDS as readonly string[]).includes(value);
}

/**
 * The stored value, validated. Anything malformed — an id nobody offers any
 * more, a date that does not parse, a hand-edited row — is "no answer", so a
 * surface never renders a reminder for something the owner never said.
 */
export function readWhatsAppTriage(value: unknown): WhatsAppTriageRecord | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const { answerId, recordedAt } = value as Record<string, unknown>;
    if (!isWhatsAppTriageAnswerId(answerId)) return null;
    if (typeof recordedAt !== 'string' || !recordedAt.trim()) return null;
    const parsed = new Date(recordedAt);
    if (Number.isNaN(parsed.getTime())) return null;
    return { answerId, recordedAt: parsed.toISOString() };
}

/**
 * The two answers that leave WhatsApp pending. The owner looked at WhatsApp,
 * told us why it cannot be connected today, and left it for later: WhatsApp is
 * the channel she chose, whatever order the wizard offered.
 */
const DEFERRING_ANSWERS: readonly WhatsAppTriageAnswerId[] = ['not_at_hand', 'other_provider'];

/**
 * `settings.setupWizardChannels` with WhatsApp first, when it is in the list
 * and not first already. That list is what the server's channel task names
 * while nothing is connected (agent-assessment `preferredSetupChannel`), and
 * therefore what Inicio, Salud de agentes and Assist say. Without this, an
 * answer given on the WhatsApp screen after the wizard saved an Instagram-led
 * order left Inicio naming Instagram next to her reason about WhatsApp.
 */
function whatsAppFirst(order: unknown): string[] | null {
    if (!Array.isArray(order) || order[0] === 'whatsapp' || !order.includes('whatsapp')) return null;
    return ['whatsapp', ...order.filter((channel) => channel !== 'whatsapp')];
}

/**
 * The settings transformer for `mutateTenantSettingsAtomic`.
 *
 * Repeating the answer already on file is a no-op (same object back): the
 * date says when the owner first told us, and a second click on the same card
 * must not rewrite the tenant row. `null` removes the answer — that is "Cambiar
 * mi respuesta", and leaving the old one would keep reminding her of a
 * situation she just said is not hers.
 */
export function applyWhatsAppTriage(
    current: Readonly<Record<string, unknown>>,
    answerId: WhatsAppTriageAnswerId | null,
    now: Date,
): Record<string, unknown> {
    const existing = readWhatsAppTriage(current[WHATSAPP_TRIAGE_SETTING_KEY]);
    if (answerId === null) {
        if (!(WHATSAPP_TRIAGE_SETTING_KEY in current)) return current as Record<string, unknown>;
        const { [WHATSAPP_TRIAGE_SETTING_KEY]: _removed, ...rest } = current;
        return rest;
    }
    const reordered = DEFERRING_ANSWERS.includes(answerId) ? whatsAppFirst(current.setupWizardChannels) : null;
    if (existing?.answerId === answerId && !reordered) return current as Record<string, unknown>;
    return {
        ...current,
        ...(reordered ? { setupWizardChannels: reordered } : {}),
        [WHATSAPP_TRIAGE_SETTING_KEY]: existing?.answerId === answerId
            ? current[WHATSAPP_TRIAGE_SETTING_KEY]
            : { answerId, recordedAt: now.toISOString() } satisfies WhatsAppTriageRecord,
    };
}
