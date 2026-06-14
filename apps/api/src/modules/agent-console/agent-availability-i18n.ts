/**
 * Agent/staff-facing i18n strings for agent-availability.service.ts
 *
 * These strings appear in emails sent to SUPERVISORS during SLA escalations.
 * The tenant's configured language drives the locale.
 *
 * Do NOT translate: log strings, technical keys, URLs, brand names.
 * Preserve: emojis (⚠️), {placeholders}, HTML structure.
 *
 * Usage:
 *   import { agentAvailI18n } from './agent-availability-i18n';
 *   const t = agentAvailI18n(tenant.language);
 *   emailService.send({ subject: t.escalationSubject(contactName, waitMinutes), html: t.escalationHtml(...) });
 */

type SupportedLang = 'es' | 'en' | 'pt' | 'fr';
const SUPPORTED = new Set<SupportedLang>(['es', 'en', 'pt', 'fr']);

/** Normalise any locale string ("es-CO", "EN", null) → 2-char code. */
function normaliseAvailLang(raw: string | null | undefined): SupportedLang {
    const code = (raw || 'es').slice(0, 2).toLowerCase() as SupportedLang;
    return SUPPORTED.has(code) ? code : 'es';
}

// ─── SLA escalation email strings ────────────────────────────────────────────
interface EscalationEmailStrings {
    h2: string;
    clientLabel: string;
    phoneLabel: string;
    reasonLabel: string;
    waitLabel: string;
    waitUnit: (minutes: number) => string;
    assignedLabel: string;
    assignedYes: string;
    assignedNone: string;
    btnLabel: string;
}

const EMAIL_STRINGS: Record<SupportedLang, EscalationEmailStrings> = {
    es: {
        h2:           '⚠️ Conversación sin atender',
        clientLabel:  'Cliente',
        phoneLabel:   'Teléfono',
        reasonLabel:  'Razón',
        waitLabel:    'Tiempo de espera',
        waitUnit:     (m) => `${m} minuto${m !== 1 ? 's' : ''}`,
        assignedLabel:'Agente asignado',
        assignedYes:  'Sí (sin respuesta)',
        assignedNone: 'Ninguno',
        btnLabel:     'Abrir Inbox',
    },
    en: {
        h2:           '⚠️ Unattended conversation',
        clientLabel:  'Customer',
        phoneLabel:   'Phone',
        reasonLabel:  'Reason',
        waitLabel:    'Wait time',
        waitUnit:     (m) => `${m} minute${m !== 1 ? 's' : ''}`,
        assignedLabel:'Assigned agent',
        assignedYes:  'Yes (no response)',
        assignedNone: 'None',
        btnLabel:     'Open Inbox',
    },
    pt: {
        h2:           '⚠️ Conversa sem atendimento',
        clientLabel:  'Cliente',
        phoneLabel:   'Telefone',
        reasonLabel:  'Motivo',
        waitLabel:    'Tempo de espera',
        waitUnit:     (m) => `${m} minuto${m !== 1 ? 's' : ''}`,
        assignedLabel:'Agente atribuído',
        assignedYes:  'Sim (sem resposta)',
        assignedNone: 'Nenhum',
        btnLabel:     'Abrir Inbox',
    },
    fr: {
        h2:           '⚠️ Conversation sans réponse',
        clientLabel:  'Client',
        phoneLabel:   'Téléphone',
        reasonLabel:  'Raison',
        waitLabel:    'Temps d\'attente',
        waitUnit:     (m) => `${m} minute${m !== 1 ? 's' : ''}`,
        assignedLabel:'Agent assigné',
        assignedYes:  'Oui (sans réponse)',
        assignedNone: 'Aucun',
        btnLabel:     'Ouvrir la boîte de réception',
    },
};

// ─── Subject line ─────────────────────────────────────────────────────────────
export function escalationEmailSubject(rawLang: string | null | undefined, contactName: string, waitMinutes: number): string {
    const lang = normaliseAvailLang(rawLang);
    const t = EMAIL_STRINGS[lang];
    const map: Record<SupportedLang, string> = {
        es: `⚠️ Escalación: ${contactName} esperando ${waitMinutes} min sin respuesta`,
        en: `⚠️ Escalation: ${contactName} waiting ${waitMinutes} min without response`,
        pt: `⚠️ Escalação: ${contactName} aguardando ${waitMinutes} min sem resposta`,
        fr: `⚠️ Escalade : ${contactName} en attente ${waitMinutes} min sans réponse`,
    };
    return map[lang] ?? map.es;
}

// ─── HTML body ────────────────────────────────────────────────────────────────
export function escalationEmailHtml(
    rawLang: string | null | undefined,
    opts: {
        contactName: string;
        contactPhone: string | null;
        reason: string;
        waitMinutes: number;
        assignedTo: string | null;
    },
): string {
    const lang = normaliseAvailLang(rawLang);
    const t = EMAIL_STRINGS[lang];

    const phone = opts.contactPhone || 'N/A';
    const assignedText = opts.assignedTo ? t.assignedYes : t.assignedNone;

    return `
        <div style="font-family: sans-serif; max-width: 500px;">
            <h2 style="color: #e67e22;">${t.h2}</h2>
            <p><strong>${t.clientLabel}:</strong> ${opts.contactName}</p>
            <p><strong>${t.phoneLabel}:</strong> ${phone}</p>
            <p><strong>${t.reasonLabel}:</strong> ${opts.reason}</p>
            <p><strong>${t.waitLabel}:</strong> ${t.waitUnit(opts.waitMinutes)}</p>
            <p><strong>${t.assignedLabel}:</strong> ${assignedText}</p>
            <p style="margin-top: 20px;">
                <a href="https://admin.parallly-chat.cloud/admin/inbox" style="background: #e67e22; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px;">
                    ${t.btnLabel}
                </a>
            </p>
        </div>
    `;
}

// ─── Convenience getter ───────────────────────────────────────────────────────
export function agentAvailI18n(rawLang: string | null | undefined) {
    const lang = normaliseAvailLang(rawLang);
    return {
        lang,
        escalationSubject: (contactName: string, waitMinutes: number) =>
            escalationEmailSubject(lang, contactName, waitMinutes),
        escalationHtml: (opts: Parameters<typeof escalationEmailHtml>[1]) =>
            escalationEmailHtml(lang, opts),
    };
}
