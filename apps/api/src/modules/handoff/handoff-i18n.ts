/**
 * Agent/staff-facing i18n strings for handoff.service.ts
 *
 * These strings are shown to AGENTS and ADMINS (not to customers).
 * The language used is the TENANT's configured language (tenant.language).
 *
 * The CUSTOMER-facing HANDOFF_MSG map in conversations.service.ts is NOT
 * touched here — it remains as-is using the conversation's detected language.
 *
 * Do NOT translate: log strings, technical keys, brand names, LLM prompts.
 * Preserve: emojis (🔴/⚠️/🔄), markdown (**bold**), {placeholders}.
 *
 * Pattern: handoffAgentMsg(lang).key  or  handoffAgentMsg(lang).keyFn(args)
 */

type SupportedLang = 'es' | 'en' | 'pt' | 'fr';
const SUPPORTED = new Set<SupportedLang>(['es', 'en', 'pt', 'fr']);

/** Normalise any locale string (e.g. "es-CO", "EN", null) to 2-char code. */
export function normaliseHandoffLang(raw: string | null | undefined): SupportedLang {
    const code = (raw || 'es').slice(0, 2).toLowerCase() as SupportedLang;
    return SUPPORTED.has(code) ? code : 'es';
}

// ─── Transcript role labels used in generateAISummary / buildFallbackSummary ──
export const TRANSCRIPT_LABELS: Record<SupportedLang, { customer: string; assistant: string; ai: string }> = {
    es: { customer: 'Cliente',    assistant: 'Asistente', ai: 'IA' },
    en: { customer: 'Customer',   assistant: 'Assistant',  ai: 'AI' },
    pt: { customer: 'Cliente',    assistant: 'Assistente', ai: 'IA' },
    fr: { customer: 'Client',     assistant: 'Assistant',  ai: 'IA' },
};

// ─── Fallback summary text when no messages exist ─────────────────────────────
export const NO_MESSAGES_TEXT: Record<SupportedLang, string> = {
    es: 'Sin mensajes previos.',
    en: 'No previous messages.',
    pt: 'Sem mensagens anteriores.',
    fr: 'Aucun message précédent.',
};

// ─── Fallback summary header (buildFallbackSummary) ──────────────────────────
export function fallbackSummaryHeader(lang: SupportedLang, count: number): string {
    const map: Record<SupportedLang, string> = {
        es: `**Últimos ${count} mensajes antes del handoff:**`,
        en: `**Last ${count} messages before handoff:**`,
        pt: `**Últimas ${count} mensagens antes do handoff:**`,
        fr: `**${count} derniers messages avant le transfert :**`,
    };
    return map[lang] ?? map.es;
}

// ─── Contact name fallback ("Cliente" when no name is known) ─────────────────
export const CONTACT_FALLBACK: Record<SupportedLang, string> = {
    es: 'Cliente',
    en: 'Customer',
    pt: 'Cliente',
    fr: 'Client',
};

// ─── Agent name fallback ──────────────────────────────────────────────────────
export const AGENT_FALLBACK: Record<SupportedLang, string> = {
    es: 'Agente',
    en: 'Agent',
    pt: 'Agente',
    fr: 'Agent',
};

// ─── Internal note (stored in internal_notes table, visible to agents) ────────
export function handoffNoteText(lang: SupportedLang, reason: string, summary: string): string {
    const map: Record<SupportedLang, string> = {
        es: `🔄 **Handoff automático** — Razón: ${reason}\n\n${summary}`,
        en: `🔄 **Automatic handoff** — Reason: ${reason}\n\n${summary}`,
        pt: `🔄 **Handoff automático** — Motivo: ${reason}\n\n${summary}`,
        fr: `🔄 **Transfert automatique** — Raison : ${reason}\n\n${summary}`,
    };
    return map[lang] ?? map.es;
}

// ─── Email to ASSIGNED agent (template fallback) ──────────────────────────────
export interface HandoffAssignedEmailVars {
    contactName: string;
    contactPhone: string;
    reason: string;
    lastMessage: string;
}

export function handoffAssignedEmailSubject(lang: SupportedLang, contactName: string): string {
    const map: Record<SupportedLang, string> = {
        es: `🔴 Handoff: ${contactName} necesita atención`,
        en: `🔴 Handoff: ${contactName} needs attention`,
        pt: `🔴 Handoff: ${contactName} precisa de atenção`,
        fr: `🔴 Handoff : ${contactName} nécessite une attention`,
    };
    return map[lang] ?? map.es;
}

export function handoffAssignedEmailHtml(lang: SupportedLang, v: HandoffAssignedEmailVars): string {
    const map: Record<SupportedLang, { h2: string; clientLabel: string; phoneLabel: string; reasonLabel: string; lastMsgLabel: string; btnLabel: string }> = {
        es: {
            h2:           'Conversación escalada',
            clientLabel:  'Cliente',
            phoneLabel:   'Teléfono',
            reasonLabel:  'Razón',
            lastMsgLabel: 'Último mensaje',
            btnLabel:     'Abrir Inbox',
        },
        en: {
            h2:           'Escalated conversation',
            clientLabel:  'Customer',
            phoneLabel:   'Phone',
            reasonLabel:  'Reason',
            lastMsgLabel: 'Last message',
            btnLabel:     'Open Inbox',
        },
        pt: {
            h2:           'Conversa escalada',
            clientLabel:  'Cliente',
            phoneLabel:   'Telefone',
            reasonLabel:  'Motivo',
            lastMsgLabel: 'Última mensagem',
            btnLabel:     'Abrir Inbox',
        },
        fr: {
            h2:           'Conversation transférée',
            clientLabel:  'Client',
            phoneLabel:   'Téléphone',
            reasonLabel:  'Raison',
            lastMsgLabel: 'Dernier message',
            btnLabel:     'Ouvrir la boîte de réception',
        },
    };
    const t = map[lang] ?? map.es;
    return `
        <div style="font-family: sans-serif; max-width: 500px;">
            <h2 style="color: #e74c3c;">${t.h2}</h2>
            <p><strong>${t.clientLabel}:</strong> ${v.contactName}</p>
            <p><strong>${t.phoneLabel}:</strong> ${v.contactPhone}</p>
            <p><strong>${t.reasonLabel}:</strong> ${v.reason}</p>
            <p><strong>${t.lastMsgLabel}:</strong></p>
            <blockquote style="border-left: 3px solid #e74c3c; padding-left: 12px; color: #555;">
                ${v.lastMessage}
            </blockquote>
            <p style="margin-top: 20px;">
                <a href="https://admin.parallly-chat.cloud/admin/inbox" style="background: #6366f1; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px;">
                    ${t.btnLabel}
                </a>
            </p>
        </div>
    `;
}

// ─── Email to ADMIN/fallback when no agent is assigned ────────────────────────
export function handoffUnassignedEmailSubject(lang: SupportedLang): string {
    const map: Record<SupportedLang, string> = {
        es: '🔴 URGENTE: Lead esperando atención humana en cola de Parallly',
        en: '🔴 URGENT: Lead waiting for human attention in Parallly queue',
        pt: '🔴 URGENTE: Lead aguardando atendimento humano na fila do Parallly',
        fr: '🔴 URGENT : Lead en attente d\'un agent humain dans la file Parallly',
    };
    return map[lang] ?? map.es;
}

export function handoffUnassignedEmailHtml(lang: SupportedLang, v: HandoffAssignedEmailVars): string {
    const map: Record<SupportedLang, {
        h2: string; subtitle: string;
        clientLabel: string; phoneLabel: string; reasonLabel: string; lastMsgLabel: string;
        btnLabel: string;
    }> = {
        es: {
            h2:           '🔴 Lead Esperando Atención Humana',
            subtitle:     'Hay un nuevo lead esperando en la cola sin asignar y requiere atención humana urgente.',
            clientLabel:  'Cliente',
            phoneLabel:   'Teléfono',
            reasonLabel:  'Razón',
            lastMsgLabel: 'Último mensaje del cliente',
            btnLabel:     'Abrir Agent Console (Inbox)',
        },
        en: {
            h2:           '🔴 Lead Waiting for Human Attention',
            subtitle:     'A new lead is waiting in the unassigned queue and requires urgent human attention.',
            clientLabel:  'Customer',
            phoneLabel:   'Phone',
            reasonLabel:  'Reason',
            lastMsgLabel: 'Last customer message',
            btnLabel:     'Open Agent Console (Inbox)',
        },
        pt: {
            h2:           '🔴 Lead Aguardando Atendimento Humano',
            subtitle:     'Há um novo lead aguardando na fila sem atribuição e requer atendimento humano urgente.',
            clientLabel:  'Cliente',
            phoneLabel:   'Telefone',
            reasonLabel:  'Motivo',
            lastMsgLabel: 'Última mensagem do cliente',
            btnLabel:     'Abrir Agent Console (Inbox)',
        },
        fr: {
            h2:           '🔴 Lead en attente d\'un agent humain',
            subtitle:     'Un nouveau lead attend dans la file sans attribution et nécessite une attention humaine urgente.',
            clientLabel:  'Client',
            phoneLabel:   'Téléphone',
            reasonLabel:  'Raison',
            lastMsgLabel: 'Dernier message du client',
            btnLabel:     'Ouvrir Agent Console (Inbox)',
        },
    };
    const t = map[lang] ?? map.es;
    return `
        <div style="font-family: sans-serif; max-width: 500px; padding: 20px; border: 1px solid #eee; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
            <h2 style="color: #e67e22; margin-top: 0;">${t.h2}</h2>
            <p style="font-size: 14px; color: #555;">${t.subtitle}</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 15px 0;" />
            <p style="font-size: 14px; margin: 5px 0;"><strong>${t.clientLabel}:</strong> ${v.contactName}</p>
            <p style="font-size: 14px; margin: 5px 0;"><strong>${t.phoneLabel}:</strong> ${v.contactPhone}</p>
            <p style="font-size: 14px; margin: 5px 0;"><strong>${t.reasonLabel}:</strong> ${v.reason}</p>
            <p style="font-size: 14px; margin: 15px 0 5px 0;"><strong>${t.lastMsgLabel}:</strong></p>
            <blockquote style="border-left: 3px solid #e67e22; padding: 5px 12px; margin: 5px 0; color: #666; background: #fafafa; font-style: italic;">
                ${v.lastMessage}
            </blockquote>
            <div style="margin-top: 25px; text-align: center;">
                <a href="https://admin.parallly-chat.cloud/admin/inbox" style="background: linear-gradient(135deg, #6366f1, #4f46e5); color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; box-shadow: 0 2px 4px rgba(99,102,241,0.2);">
                    ${t.btnLabel}
                </a>
            </div>
        </div>
    `;
}

// ─── Convenience getter — returns all strings for a given language ─────────────
export function handoffAgentI18n(rawLang: string | null | undefined) {
    const lang = normaliseHandoffLang(rawLang);
    return {
        lang,
        transcriptLabels: TRANSCRIPT_LABELS[lang],
        noMessagesText:   NO_MESSAGES_TEXT[lang],
        contactFallback:  CONTACT_FALLBACK[lang],
        agentFallback:    AGENT_FALLBACK[lang],
        fallbackSummaryHeader: (count: number) => fallbackSummaryHeader(lang, count),
        noteText: (reason: string, summary: string) => handoffNoteText(lang, reason, summary),
        assignedSubject: (contactName: string) => handoffAssignedEmailSubject(lang, contactName),
        assignedHtml: (v: HandoffAssignedEmailVars) => handoffAssignedEmailHtml(lang, v),
        unassignedSubject: () => handoffUnassignedEmailSubject(lang),
        unassignedHtml: (v: HandoffAssignedEmailVars) => handoffUnassignedEmailHtml(lang, v),
    };
}
