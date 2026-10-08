/**
 * The notes written on an appointment when the AI assistant books it.
 *
 * Those notes are read by the business owner (in the dashboard and in the
 * calendar event), not by the customer, so they are written in the TENANT's
 * language. They used to be hard-coded English ("Customer:", "Phone:",
 * "Conversation context:"), and the "Phone" line printed whatever the model put
 * in `customerPhone` — for a Telegram customer, the Telegram user id, which an
 * owner then tried to call.
 */

export type NotesLanguage = 'es' | 'en' | 'pt' | 'fr';

interface NotesDictionary {
    customer: string;
    email: string;
    phone: string;
    /** {channel} is the channel's name: "ID de Telegram". */
    channelId: string;
    service: string;
    duration: string;
    minutes: string;
    priceQuote: string;
    priceToConfirm: string;
    priceNotAvailable: string;
    context: string;
    roleCustomer: string;
    roleAgent: string;
    notes: string;
}

const DICTIONARY: Record<NotesLanguage, NotesDictionary> = {
    es: {
        customer: 'Cliente', email: 'Correo', phone: 'Teléfono', channelId: 'ID de {channel}',
        service: 'Servicio', duration: 'Duración', minutes: '{n} min',
        priceQuote: 'se cotiza según el caso', priceToConfirm: 'precio por confirmar', priceNotAvailable: 'N/D',
        context: 'Contexto de la conversación', roleCustomer: 'Cliente', roleAgent: 'Asistente', notes: 'Notas',
    },
    en: {
        customer: 'Customer', email: 'Email', phone: 'Phone', channelId: '{channel} ID',
        service: 'Service', duration: 'Duration', minutes: '{n} min',
        priceQuote: 'quoted case by case', priceToConfirm: 'price to be confirmed', priceNotAvailable: 'N/A',
        context: 'Conversation context', roleCustomer: 'Customer', roleAgent: 'Assistant', notes: 'Notes',
    },
    pt: {
        customer: 'Cliente', email: 'E-mail', phone: 'Telefone', channelId: 'ID do {channel}',
        service: 'Serviço', duration: 'Duração', minutes: '{n} min',
        priceQuote: 'sob cotação, caso a caso', priceToConfirm: 'preço a confirmar', priceNotAvailable: 'N/D',
        context: 'Contexto da conversa', roleCustomer: 'Cliente', roleAgent: 'Assistente', notes: 'Observações',
    },
    fr: {
        customer: 'Client', email: 'E-mail', phone: 'Téléphone', channelId: 'ID {channel}',
        service: 'Service', duration: 'Durée', minutes: '{n} min',
        priceQuote: 'sur devis, au cas par cas', priceToConfirm: 'prix à confirmer', priceNotAvailable: 'N/D',
        context: 'Contexte de la conversation', roleCustomer: 'Client', roleAgent: 'Assistant', notes: 'Notes',
    },
};

/** Tenant language as stored ("es-CO", "EN", null) to one we can write in. */
export function normaliseNotesLanguage(raw: unknown): NotesLanguage {
    const code = typeof raw === 'string' ? raw.trim().slice(0, 2).toLowerCase() : '';
    return code === 'en' || code === 'pt' || code === 'fr' ? code : 'es';
}

/**
 * Channels whose user identifier is a platform id, not a phone number. A bare
 * number that arrives on one of them is that id, however much it looks like a
 * phone: a Telegram user id is eight to ten digits.
 */
const PLATFORM_ID_CHANNELS: Readonly<Record<string, string>> = Object.freeze({
    telegram: 'Telegram',
    instagram: 'Instagram',
    messenger: 'Messenger',
    facebook: 'Messenger',
    webchat: 'Web',
    web: 'Web',
});

export interface ClassifiedContactPoint {
    /** A value that can be dialled. */
    phone?: string;
    /** The platform user id, to be labelled as such and never as a phone. */
    channelId?: { channel: string; value: string };
}

/**
 * Decide whether the "phone" the model supplied is a phone.
 *
 * Without a leading "+" on a platform-id channel it is the channel's user id.
 * On any channel, something that is not plausibly a phone number (7-15 digits,
 * ordinary separators) is not stored as one.
 */
export function classifyContactPhone(
    value: string | null | undefined,
    channelType?: string | null,
): ClassifiedContactPoint {
    const raw = (value ?? '').trim();
    if (!raw) return {};
    const channel = PLATFORM_ID_CHANNELS[(channelType ?? '').trim().toLowerCase()];
    const digits = raw.replace(/\D/g, '');
    const plausible = /^\+?[\d\s().-]+$/.test(raw) && digits.length >= 7 && digits.length <= 15;
    if (channel && !(raw.startsWith('+') && plausible)) {
        return { channelId: { channel, value: raw } };
    }
    return plausible ? { phone: raw } : {};
}

/** Cut at a word boundary, so a note never ends in the middle of a word. */
export function truncateAtWord(text: string, max: number): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= max) return clean;
    const cut = clean.slice(0, max);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

export interface AppointmentNotesInput {
    language: unknown;
    customerName: string;
    customerEmail?: string | null;
    customerPhone?: string | null;
    channelType?: string | null;
    serviceName: string;
    /** 'confirmed' prints `priceText`; 'quote' and anything else print a sentence instead of a number. */
    priceStatus: 'confirmed' | 'quote' | string;
    priceText?: string | null;
    durationMinutes: number;
    /** Extra "label: value" lines from the appointment subject (vehicle, property...). */
    subjectLabels?: readonly string[];
    /** Last messages, oldest first. */
    conversation?: readonly { direction: string; text: string | null | undefined }[];
    notes?: string | null;
}

export function buildAppointmentNotes(input: AppointmentNotesInput): string {
    const d = DICTIONARY[normaliseNotesLanguage(input.language)];
    const lines: string[] = [`${d.customer}: ${input.customerName}`];
    if (input.customerEmail) lines.push(`${d.email}: ${input.customerEmail}`);
    const contact = classifyContactPhone(input.customerPhone, input.channelType);
    if (contact.phone) lines.push(`${d.phone}: ${contact.phone}`);
    if (contact.channelId) {
        lines.push(`${d.channelId.replace('{channel}', contact.channelId.channel)}: ${contact.channelId.value}`);
    }
    lines.push('');
    const price = input.priceStatus === 'confirmed'
        ? (input.priceText || d.priceNotAvailable)
        : (input.priceStatus === 'quote' ? d.priceQuote : d.priceToConfirm);
    lines.push(`${d.service}: ${input.serviceName} (${price})`);
    lines.push(`${d.duration}: ${d.minutes.replace('{n}', String(input.durationMinutes))}`);
    for (const label of input.subjectLabels ?? []) lines.push(label);

    const spoken = (input.conversation ?? [])
        .map((m) => ({ inbound: m.direction === 'inbound', text: truncateAtWord(m.text ?? '', 200) }))
        .filter((m) => m.text);
    if (spoken.length > 0) {
        lines.push('', `${d.context}:`);
        for (const m of spoken) lines.push(`- ${m.inbound ? d.roleCustomer : d.roleAgent}: "${m.text}"`);
    }
    if (input.notes) lines.push('', `${d.notes}: ${input.notes}`);
    return lines.join('\n');
}
