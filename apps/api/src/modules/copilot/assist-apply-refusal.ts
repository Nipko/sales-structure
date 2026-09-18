import { ConflictException } from '@nestjs/common';

/**
 * The refusal an immediate save raises when it would leave two active agents
 * on one connection (`AgentDraftService.claimConnectionsWithQuery`). The
 * runtime refuses a turn on a connection two agents claim at the same priority,
 * so the save is refused instead of silencing that channel.
 */
export const CONNECTION_OWNED_BY_OTHER_AGENT = 'agent_connection_owned_by_other_agent';

const CHANNEL_LABELS: Readonly<Record<string, string>> = Object.freeze({
    whatsapp: 'WhatsApp',
    instagram: 'Instagram',
    messenger: 'Messenger',
    telegram: 'Telegram',
    web_widget: 'el chat web',
});

/** `whatsapp` or `whatsapp:<accountId>` → "WhatsApp". Never an account id. */
function channelLabel(connection: unknown): string {
    const type = String(connection ?? '').split(':', 1)[0];
    return CHANNEL_LABELS[type] ?? 'un canal';
}

/**
 * What Assist relays when applying a reviewed change hits that refusal.
 *
 * Assist applies a change to ONE agent's settings (greeting, rules, mission…),
 * and the save carries the agent's channels as they are. When another active
 * agent already serves one of those channels — an overlap from before the
 * invariant, or another agent switched on meanwhile — the refusal arrived with
 * an English sentence ("Another active agent serves this connection…") and the
 * panel showed its generic "no se pudo confirmar este cambio": the owner had no
 * way to know the fix is a channel, not the change she asked for.
 *
 * Same code and the same `connections` (so any surface can still map it), a
 * message that names who holds which channel and what to do. Every other error
 * passes through untouched: this maps one refusal, it never hides another.
 */
export function assistApplyRefusal(error: unknown): unknown {
    if (!(error instanceof ConflictException)) return error;
    const body = error.getResponse();
    if (!body || typeof body !== 'object' || (body as { error?: unknown }).error !== CONNECTION_OWNED_BY_OTHER_AGENT) return error;
    const connections = Array.isArray((body as { connections?: unknown }).connections)
        ? ((body as { connections: unknown[] }).connections)
            .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
        : [];
    const byOwner = new Map<string, Set<string>>();
    for (const entry of connections) {
        const name = typeof entry.agentName === 'string' && entry.agentName.trim() ? entry.agentName.trim() : 'otro agente';
        const labels = byOwner.get(name) ?? new Set<string>();
        labels.add(channelLabel(entry.connection));
        byOwner.set(name, labels);
    }
    const clauses = [...byOwner.entries()].map(([name, labels]) => `${name} ya atiende ${joinSpanish([...labels])}`);
    const channelCount = new Set([...byOwner.values()].flatMap((labels) => [...labels])).size;
    const who = clauses.length === 0 ? 'otro agente activo ya atiende uno de sus canales' : clauses.join('; ');
    const same = channelCount > 1 ? 'esos canales asignados' : 'ese canal asignado';
    return new ConflictException({
        ...(body as Record<string, unknown>),
        error: CONNECTION_OWNED_BY_OTHER_AGENT,
        connections,
        message: `No se aplicó el cambio: ${who}, y este agente también tiene ${same}. Con dos agentes activos `
            + 'en el mismo canal, ese canal se queda sin respuesta. Quita el canal de uno de los dos en el editor '
            + 'del agente y vuelve a pedir el cambio.',
    });
}

/** "a", "a y b", "a, b y c". */
function joinSpanish(items: readonly string[]): string {
    if (items.length <= 1) return items[0] ?? '';
    return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}
