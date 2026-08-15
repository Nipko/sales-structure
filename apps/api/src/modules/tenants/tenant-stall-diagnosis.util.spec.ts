import { diagnoseTenantStall, TenantStallSignals } from './tenant-stall-diagnosis.util';

const NOW = new Date('2026-08-15T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

/** Un tenant sano: canal con agente, gente entrando, mensajes esta semana. */
const healthy: TenantStallSignals = {
    onboardingCompletedAt: daysAgo(120),
    firstChannelConnectedAt: daysAgo(119),
    firstMessageAt: daysAgo(118),
    lastLoginAt: daysAgo(1),
    lastMessageAt: daysAgo(0),
    channelsConnected: 1,
    agentsCount: 1,
    channelsWithoutAgent: 0,
    faqsCount: 5,
    messages7d: 40,
    messages30d: 200,
    handoffsPending: 0,
    createdAt: daysAgo(120),
};

const codes = (s: TenantStallSignals) => diagnoseTenantStall(s, NOW).map((f) => f.code);

describe('diagnoseTenantStall', () => {
    it('no inventa problemas donde no los hay', () => {
        expect(diagnoseTenantStall(healthy, NOW)).toEqual([]);
    });

    it('distingue el canal que nunca se conectó del que se perdió', () => {
        expect(codes({ ...healthy, channelsConnected: 0, firstChannelConnectedAt: null }))
            .toContain('channel_never_connected');

        // El mismo síntoma, otra conversación: a este ya le funcionaba.
        expect(codes({ ...healthy, channelsConnected: 0 })).toContain('channel_lost');
    });

    it('marca como bloqueante el canal sin agente: entran mensajes que nadie responde', () => {
        const found = diagnoseTenantStall({ ...healthy, channelsWithoutAgent: 1 }, NOW);
        const finding = found.find((f) => f.code === 'channel_without_agent');
        expect(finding?.severity).toBe('blocker');
        expect(finding?.context).toEqual({ count: 1 });
    });

    it('no reporta "sin agente enlazado" cuando directamente no hay canal', () => {
        // Sería ruido encima del problema real, y desordena la lista.
        const found = codes({ ...healthy, channelsConnected: 0, channelsWithoutAgent: 2 });
        expect(found).toContain('channel_lost');
        expect(found).not.toContain('channel_without_agent');
    });

    it('separa "nunca le escribieron" de "se apagó"', () => {
        expect(codes({ ...healthy, firstMessageAt: null, lastMessageAt: null }))
            .toContain('never_received_a_message');

        expect(codes({ ...healthy, lastMessageAt: daysAgo(60), messages7d: 0, messages30d: 0 }))
            .toContain('dormant');
    });

    it('avisa del enfriamiento antes de que el tenant esté muerto', () => {
        const found = codes({ ...healthy, messages7d: 0, messages30d: 12, lastMessageAt: daysAgo(9) });
        expect(found).toContain('cooling_down');
        expect(found).not.toContain('dormant');
    });

    it('detecta al equipo ausente y al que nunca entró', () => {
        expect(codes({ ...healthy, lastLoginAt: daysAgo(45) })).toContain('team_absent');
        expect(codes({ ...healthy, lastLoginAt: null })).toContain('never_logged_in');
    });

    it('no acusa de "nunca entró" a una cuenta recién creada', () => {
        // Darle tiempo: alguien que se registró ayer no está parado.
        expect(codes({ ...healthy, lastLoginAt: null, createdAt: daysAgo(2) }))
            .not.toContain('never_logged_in');
    });

    it('pone primero lo que bloquea', () => {
        const found = diagnoseTenantStall({
            ...healthy,
            channelsConnected: 0,
            faqsCount: 0,
            lastLoginAt: daysAgo(60),
        }, NOW);

        expect(found[0].severity).toBe('blocker');
        expect(found.map((f) => f.severity)).toEqual([...found.map((f) => f.severity)].sort(
            (a, b) => ({ blocker: 0, warning: 1, info: 2 } as any)[a] - ({ blocker: 0, warning: 1, info: 2 } as any)[b],
        ));
    });

    it('trata los handoffs pendientes como gente esperando ahora', () => {
        const finding = diagnoseTenantStall({ ...healthy, handoffsPending: 3 }, NOW)
            .find((f) => f.code === 'handoffs_waiting');
        expect(finding?.context).toEqual({ count: 3 });
    });
});
