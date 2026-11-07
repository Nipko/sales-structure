import {
    TOOL_ERROR_MIN_CALLS,
    computeTenantBoardStatus,
    type BoardChannel,
    type TenantBoardFacts,
} from './tenant-board.status';

const channel = (over: Partial<BoardChannel> = {}): BoardChannel => ({
    type: 'whatsapp', displayName: 'Línea', health: 'ok', connectedAt: null, lastError: null, refreshState: null, ...over,
});

/** Un tenant sano: listo, en vivo, con canal, mensajes, agente y entregas al día. */
const healthy = (over: Partial<TenantBoardFacts> = {}): TenantBoardFacts => ({
    isLive: true,
    onboardingCompleted: true,
    subscriptionStatus: 'active',
    channels: [channel()],
    widgets: 0,
    readiness: { verdict: 'listo', blockingFailing: 0, necessaryFailing: 0, coveragePct: 90, blockingGaps: [], evaluatedAt: null },
    delivery: { pending: 0, unknown: 0, failed: 0, stuck: 0, delivered: 40, total: 40, lastDeliveredAt: null },
    dispatch: { reconciliationRequired: 0, reconciliationOverdue: 0, stalled: 0 },
    volume: { inbound: 50, outbound: 50, conversations: 10, lastInboundAt: null },
    tools: { calls: 100, errors: 2, blocked: 0, errorRate: 0.02, lastErrorCode: null },
    agents: { active: 1, total: 1, published: 1 },
    sectionErrors: [],
    error: null,
    ...over,
});

const codes = (facts: TenantBoardFacts) => computeTenantBoardStatus(facts).reasons.map(reason => reason.code);

describe('computeTenantBoardStatus', () => {
    it('a healthy tenant is ok with no reasons', () => {
        expect(computeTenantBoardStatus(healthy())).toEqual({ status: 'ok', reasons: [] });
    });

    it('an unreadable tenant is error, not critico', () => {
        const result = computeTenantBoardStatus(healthy({ error: 'boom' }));
        expect(result.status).toBe('error');
        expect(result.reasons).toEqual([{ code: 'tenant_unreadable', severity: 'critico', params: { error: 'boom' } }]);
    });

    it.each([
        ['expired', 'channel_error'],
        ['revoked', 'channel_error'],
        ['missing', 'channel_error'],
        ['error', 'channel_error'],
    ] as const)('a %s channel credential is critico', (health, code) => {
        const result = computeTenantBoardStatus(healthy({ channels: [channel({ health })] }));
        expect(result.status).toBe('critico');
        expect(result.reasons[0]).toMatchObject({ code, severity: 'critico', params: { channel: 'whatsapp', health } });
    });

    it('an expiring channel is atencion and an unknown one is not flagged', () => {
        expect(computeTenantBoardStatus(healthy({ channels: [channel({ health: 'expiring' })] })))
            .toMatchObject({ status: 'atencion', reasons: [{ code: 'channel_warning' }] });
        expect(computeTenantBoardStatus(healthy({ channels: [channel({ health: 'unknown' })] })).status).toBe('ok');
    });

    it('stuck deliveries are critico', () => {
        const result = computeTenantBoardStatus(healthy({ delivery: { ...healthy().delivery!, pending: 3, stuck: 2 } }));
        expect(result.status).toBe('critico');
        expect(result.reasons).toEqual([{ code: 'stuck_deliveries', severity: 'critico', params: { count: 2, minutes: 2 } }]);
    });

    it('reconciliation_required is critico, with the overdue count', () => {
        const result = computeTenantBoardStatus(healthy({ dispatch: { reconciliationRequired: 1, reconciliationOverdue: 1, stalled: 0 } }));
        expect(result).toEqual({
            status: 'critico',
            reasons: [{ code: 'reconciliation_required', severity: 'critico', params: { count: 1, overdue: 1 } }],
        });
    });

    it('stalled outbox rows are critico', () => {
        expect(codes(healthy({ dispatch: { reconciliationRequired: 0, reconciliationOverdue: 0, stalled: 4 } })))
            .toEqual(['dispatch_stalled']);
    });

    it('live tool error rate above 20% with enough calls is critico; above 10% is atencion', () => {
        const high = computeTenantBoardStatus(healthy({ tools: { calls: 20, errors: 5, blocked: 0, errorRate: 0.25, lastErrorCode: 'x' } }));
        expect(high.status).toBe('critico');
        expect(high.reasons[0]).toEqual({ code: 'tool_error_rate_high', severity: 'critico', params: { rate: 25, calls: 20, errors: 5 } });

        const elevated = computeTenantBoardStatus(healthy({ tools: { calls: 100, errors: 15, blocked: 0, errorRate: 0.15, lastErrorCode: null } }));
        expect(elevated).toMatchObject({ status: 'atencion', reasons: [{ code: 'tool_error_rate_elevated' }] });
    });

    it('too few tool calls never decide anything', () => {
        expect(codes(healthy({ tools: { calls: TOOL_ERROR_MIN_CALLS - 1, errors: TOOL_ERROR_MIN_CALLS - 1, blocked: 0, errorRate: 1, lastErrorCode: null } })))
            .toEqual([]);
    });

    it('failed deliveries in the window are atencion', () => {
        expect(computeTenantBoardStatus(healthy({ delivery: { ...healthy().delivery!, failed: 2 } })))
            .toMatchObject({ status: 'atencion', reasons: [{ code: 'failed_deliveries', params: { count: 2, days: 7 } }] });
    });

    it('a no_listo verdict and a missing evaluation are atencion', () => {
        const notReady = healthy({ readiness: { ...healthy().readiness!, verdict: 'no_listo', blockingFailing: 3 } });
        expect(computeTenantBoardStatus(notReady)).toMatchObject({ status: 'atencion', reasons: [{ code: 'not_ready', params: { blocking: 3 } }] });
        expect(codes(healthy({ readiness: null }))).toEqual(['readiness_missing']);
        // limitado no es un problema por sí solo.
        expect(codes(healthy({ readiness: { ...healthy().readiness!, verdict: 'limitado' } }))).toEqual([]);
    });

    it('an unreadable readiness section is partial data, not "missing evaluation"', () => {
        expect(codes(healthy({ readiness: null, sectionErrors: ['readiness'] }))).toEqual(['partial_data']);
    });

    it('no channel at all is atencion, but a web widget counts as a channel', () => {
        expect(codes(healthy({ channels: [], widgets: 0 }))).toEqual(['no_channel']);
        expect(codes(healthy({ channels: [], widgets: 1 }))).toEqual([]);
        expect(codes(healthy({ channels: [], widgets: 0, sectionErrors: ['channels'] }))).toEqual(['partial_data']);
    });

    it('no inbound in the window is atencion only while live', () => {
        const silent = { volume: { inbound: 0, outbound: 0, conversations: 0, lastInboundAt: null } };
        expect(codes(healthy({ ...silent, isLive: true }))).toEqual(['no_inbound_while_live']);
        expect(codes(healthy({ ...silent, isLive: false }))).toEqual([]);
        // Sin dato de volumen no se afirma silencio.
        expect(codes(healthy({ volume: null, isLive: true, sectionErrors: ['volume'] }))).toEqual(['partial_data']);
    });

    it('no active agent, incomplete onboarding and a subscription problem are atencion', () => {
        expect(codes(healthy({ agents: { active: 0, total: 2, published: 0 } }))).toEqual(['no_active_agent']);
        expect(codes(healthy({ onboardingCompleted: false }))).toEqual(['onboarding_incomplete']);
        expect(computeTenantBoardStatus(healthy({ subscriptionStatus: 'past_due' })).reasons)
            .toEqual([{ code: 'subscription_issue', severity: 'atencion', params: { status: 'past_due' } }]);
        expect(codes(healthy({ subscriptionStatus: 'trialing' }))).toEqual([]);
    });

    it('critico reasons come first and decide the status', () => {
        const result = computeTenantBoardStatus(healthy({
            onboardingCompleted: false,
            channels: [channel({ health: 'expired' })],
        }));
        expect(result.status).toBe('critico');
        expect(result.reasons.map(reason => reason.code)).toEqual(['channel_error', 'onboarding_incomplete']);
    });
});
