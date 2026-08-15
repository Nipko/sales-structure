/**
 * Por qué un tenant está parado, y qué se puede hacer al respecto.
 *
 * La ficha ya mostraba un `healthScore` y un feed de auditoría, pero ninguno de
 * los dos contesta la pregunta que uno se hace mirando la lista: *este está
 * quieto hace meses, ¿qué le pasó?*. Un 45/100 no se puede accionar, y el feed
 * muestra errores técnicos de hace 95 días sin decir si todavía importan.
 *
 * Esto convierte las señales que ya se recolectan en causas concretas. Es una
 * función pura a propósito: las reglas son criterio de negocio y cambian, así
 * que tienen que poder discutirse y probarse sin una base de datos al lado.
 */

export type StallSeverity = 'blocker' | 'warning' | 'info';

export interface StallFinding {
    /** Estable, para i18n y para agrupar en métricas. */
    code: string;
    severity: StallSeverity;
    /** Datos para interpolar en el texto (días, conteos). */
    context?: Record<string, number | string>;
}

export interface TenantStallSignals {
    onboardingCompletedAt: Date | null;
    firstChannelConnectedAt: Date | null;
    firstMessageAt: Date | null;
    /** Último login de CUALQUIER usuario del tenant. */
    lastLoginAt: Date | null;
    /** Último mensaje en cualquier conversación. */
    lastMessageAt: Date | null;
    channelsConnected: number;
    agentsCount: number;
    /** Canales conectados sin ningún agente enlazado. */
    channelsWithoutAgent: number;
    faqsCount: number;
    messages7d: number;
    messages30d: number;
    handoffsPending: number;
    createdAt: Date;
}

const DAY_MS = 86_400_000;
const daysSince = (date: Date | null, now: Date): number | null =>
    date ? Math.floor((now.getTime() - date.getTime()) / DAY_MS) : null;

/**
 * Devuelve los hallazgos ORDENADOS por severidad. Vacío = el tenant está sano
 * o al menos no tiene nada accionable de nuestro lado.
 */
export function diagnoseTenantStall(s: TenantStallSignals, now: Date = new Date()): StallFinding[] {
    const findings: StallFinding[] = [];
    const daysSinceMessage = daysSince(s.lastMessageAt, now);
    const daysSinceLogin = daysSince(s.lastLoginAt, now);
    const ageDays = daysSince(s.createdAt, now) ?? 0;

    // ── Bloqueantes: sin esto el producto no puede funcionar ──

    if (s.channelsConnected === 0) {
        // Distinguir "nunca lo logró" de "lo tenía y lo perdió" cambia por
        // completo la conversación con el cliente.
        if (s.firstChannelConnectedAt) {
            findings.push({
                code: 'channel_lost',
                severity: 'blocker',
                context: { days: daysSince(s.firstChannelConnectedAt, now) ?? 0 },
            });
        } else {
            findings.push({ code: 'channel_never_connected', severity: 'blocker', context: { days: ageDays } });
        }
    } else if (s.channelsWithoutAgent > 0) {
        // Peor que no tener canal: el cliente cree que está funcionando y los
        // mensajes entran a un canal que nadie responde.
        findings.push({
            code: 'channel_without_agent',
            severity: 'blocker',
            context: { count: s.channelsWithoutAgent },
        });
    }

    if (s.agentsCount === 0) {
        findings.push({ code: 'no_agent', severity: 'blocker' });
    }

    if (!s.onboardingCompletedAt) {
        findings.push({ code: 'onboarding_incomplete', severity: 'blocker', context: { days: ageDays } });
    }

    // ── Advertencias: funciona, pero se está apagando ──

    if (s.handoffsPending > 0) {
        // Clientes finales esperando respuesta humana AHORA.
        findings.push({ code: 'handoffs_waiting', severity: 'warning', context: { count: s.handoffsPending } });
    }

    if (s.channelsConnected > 0 && !s.firstMessageAt) {
        findings.push({ code: 'never_received_a_message', severity: 'warning', context: { days: ageDays } });
    } else if (daysSinceMessage !== null && daysSinceMessage >= 30) {
        findings.push({ code: 'dormant', severity: 'warning', context: { days: daysSinceMessage } });
    } else if (s.messages30d > 0 && s.messages7d === 0) {
        findings.push({ code: 'cooling_down', severity: 'warning', context: { messages30d: s.messages30d } });
    }

    if (daysSinceLogin !== null && daysSinceLogin >= 30) {
        findings.push({ code: 'team_absent', severity: 'warning', context: { days: daysSinceLogin } });
    } else if (daysSinceLogin === null && ageDays >= 7) {
        // Nunca entró nadie desde que se creó la cuenta.
        findings.push({ code: 'never_logged_in', severity: 'warning', context: { days: ageDays } });
    }

    // ── Informativos: oportunidades de acompañamiento ──

    if (s.channelsConnected > 0 && s.faqsCount === 0) {
        findings.push({ code: 'no_knowledge_base', severity: 'info' });
    }

    const order: Record<StallSeverity, number> = { blocker: 0, warning: 1, info: 2 };
    return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}
