/**
 * Agent-facing SMS strings for handoff notifications (Phase 2).
 *
 * Shown to AGENTS/ADMINS (not customers). Language = tenant.language.
 * Kept short and plain-text (SMS). Do NOT translate brand names or the URL.
 */

type Lang = 'es' | 'en' | 'pt' | 'fr';
const SUPPORTED = new Set<Lang>(['es', 'en', 'pt', 'fr']);

function normalise(raw: string | null | undefined): Lang {
    const code = (raw || 'es').slice(0, 2).toLowerCase() as Lang;
    return SUPPORTED.has(code) ? code : 'es';
}

const CONTACT_FALLBACK: Record<Lang, string> = {
    es: 'Un cliente',
    en: 'A customer',
    pt: 'Um cliente',
    fr: 'Un client',
};

const INBOX_URL = 'admin.parallly-chat.cloud/admin/inbox';

/** Short agent-facing SMS body announcing an escalated conversation. */
export function smsHandoffText(rawLang: string | null | undefined, contactName: string | undefined, reason: string): string {
    const lang = normalise(rawLang);
    const who = contactName || CONTACT_FALLBACK[lang];
    const map: Record<Lang, string> = {
        es: `Parallly: ${who} necesita atención humana (${reason}). Entra al inbox: ${INBOX_URL}`,
        en: `Parallly: ${who} needs human attention (${reason}). Open the inbox: ${INBOX_URL}`,
        pt: `Parallly: ${who} precisa de atendimento humano (${reason}). Abra o inbox: ${INBOX_URL}`,
        fr: `Parallly: ${who} demande un agent humain (${reason}). Ouvrez la boîte: ${INBOX_URL}`,
    };
    return map[lang];
}
