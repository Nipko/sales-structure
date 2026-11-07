/**
 * Tablero de tenants: cómo se decide el estado de cada negocio.
 *
 * Funciones puras sobre los hechos ya leídos (`TenantBoardFacts`). El servicio
 * junta los hechos; aquí sólo se decide. Cada razón lleva un código estable que
 * el panel traduce, su severidad y los números que la justifican, para que
 * "crítico" nunca aparezca sin decir por qué.
 */
import { isCredentialFailure, type ChannelCredentialHealth } from '@parallext/shared';

export type TenantBoardStatus = 'ok' | 'atencion' | 'critico' | 'error';
export type TenantBoardSeverity = 'atencion' | 'critico';

/** Ventana de todas las cuentas del tablero (entregas, mensajes, uso de tools). */
export const BOARD_WINDOW_DAYS = 7;

/**
 * Una respuesta del agente en `pending` más de este tiempo está atascada: el
 * envío normal se confirma en segundos, así que dos minutos ya no es lentitud
 * sino un cliente esperando una respuesta que quizá no salió.
 */
export const STUCK_DELIVERY_AFTER_SECONDS = 120;

/** Con una sola respuesta atascada ya hay un cliente sin contestar: es crítico. */
export const STUCK_DELIVERY_CRITICAL_MIN = 1;

/**
 * Efectos de salida en `reconciliation_required`: nadie sabe si llegaron y el
 * sistema no los reintenta a propósito. Uno solo exige a una persona.
 */
export const RECONCILIATION_CRITICAL_MIN = 1;

/** Filas del outbox disponibles hace más de 10 min sin que un worker las tome. */
export const DISPATCH_STALLED_CRITICAL_MIN = 1;

/** Respuestas que el proveedor rechazó en la ventana: a partir de una, hay que mirar. */
export const FAILED_DELIVERY_ATTENTION_MIN = 1;

/**
 * Tasa de error de las tools en modo `live` (sin pruebas ni evaluaciones).
 * Con menos de `TOOL_ERROR_MIN_CALLS` llamadas la tasa es ruido y no decide nada.
 */
export const TOOL_ERROR_MIN_CALLS = 20;
export const TOOL_ERROR_RATE_CRITICAL = 0.2;
export const TOOL_ERROR_RATE_ATTENTION = 0.1;

/** Estados de suscripción que significan que el negocio no está pagando con normalidad. */
export const SUBSCRIPTION_ATTENTION_STATES: ReadonlySet<string> = new Set([
    'past_due', 'cancelled', 'expired', 'suspended', 'pending_auth',
]);

export const BOARD_THRESHOLDS = Object.freeze({
    windowDays: BOARD_WINDOW_DAYS,
    stuckDeliveryAfterSeconds: STUCK_DELIVERY_AFTER_SECONDS,
    stuckDeliveryCriticalMin: STUCK_DELIVERY_CRITICAL_MIN,
    reconciliationCriticalMin: RECONCILIATION_CRITICAL_MIN,
    dispatchStalledCriticalMin: DISPATCH_STALLED_CRITICAL_MIN,
    failedDeliveryAttentionMin: FAILED_DELIVERY_ATTENTION_MIN,
    toolErrorMinCalls: TOOL_ERROR_MIN_CALLS,
    toolErrorRateCritical: TOOL_ERROR_RATE_CRITICAL,
    toolErrorRateAttention: TOOL_ERROR_RATE_ATTENTION,
});

export type TenantBoardReasonCode =
    | 'tenant_unreadable'
    | 'channel_error'
    | 'stuck_deliveries'
    | 'reconciliation_required'
    | 'dispatch_stalled'
    | 'tool_error_rate_high'
    | 'tool_error_rate_elevated'
    | 'failed_deliveries'
    | 'not_ready'
    | 'readiness_missing'
    | 'no_channel'
    | 'channel_warning'
    | 'no_inbound_while_live'
    | 'no_active_agent'
    | 'onboarding_incomplete'
    | 'subscription_issue'
    | 'partial_data';

export interface TenantBoardReason {
    code: TenantBoardReasonCode;
    severity: TenantBoardSeverity;
    params: Record<string, string | number>;
}

export interface BoardChannel {
    type: string;
    displayName: string | null;
    health: ChannelCredentialHealth;
    connectedAt: string | null;
    lastError: string | null;
    refreshState: string | null;
}

export interface BoardReadiness {
    verdict: string | null;
    blockingFailing: number;
    necessaryFailing: number;
    coveragePct: number | null;
    blockingGaps: string[];
    evaluatedAt: string | null;
}

export interface BoardDelivery {
    pending: number;
    unknown: number;
    failed: number;
    stuck: number;
    /** Del barrido acotado por tiempo; null si no se pudo leer a tiempo. */
    delivered: number | null;
    total: number | null;
    lastDeliveredAt: string | null;
}

export interface BoardDispatch {
    reconciliationRequired: number;
    reconciliationOverdue: number;
    stalled: number;
}

export interface BoardVolume {
    inbound: number;
    outbound: number;
    conversations: number;
    lastInboundAt: string | null;
}

export interface BoardTools {
    calls: number;
    errors: number;
    blocked: number;
    errorRate: number;
    lastErrorCode: string | null;
}

export interface BoardAgents {
    active: number;
    total: number;
    published: number | null;
}

/**
 * Lo que el tablero sabe de un tenant. `null` en una sección = no se pudo leer
 * (tabla ausente, timeout, error); el nombre de la sección queda en
 * `sectionErrors` y nunca se interpreta como "cero".
 */
export interface TenantBoardFacts {
    isLive: boolean;
    onboardingCompleted: boolean;
    subscriptionStatus: string | null;
    channels: BoardChannel[];
    widgets: number;
    readiness: BoardReadiness | null;
    delivery: BoardDelivery | null;
    dispatch: BoardDispatch | null;
    volume: BoardVolume | null;
    tools: BoardTools | null;
    agents: BoardAgents | null;
    sectionErrors: string[];
    error: string | null;
}

const SEVERITY_RANK: Record<TenantBoardStatus, number> = { ok: 0, atencion: 1, critico: 2, error: 3 };

export function toolErrorRate(calls: number, errors: number): number {
    return calls > 0 ? errors / calls : 0;
}

/**
 * Decide el estado y sus razones. Las razones críticas van primero; el estado
 * es la peor severidad presente (o `error` si el tenant no se pudo leer).
 */
export function computeTenantBoardStatus(facts: TenantBoardFacts): { status: TenantBoardStatus; reasons: TenantBoardReason[] } {
    if (facts.error) {
        return {
            status: 'error',
            reasons: [{ code: 'tenant_unreadable', severity: 'critico', params: { error: facts.error } }],
        };
    }
    const reasons: TenantBoardReason[] = [];
    const add = (code: TenantBoardReasonCode, severity: TenantBoardSeverity, params: Record<string, string | number> = {}) =>
        reasons.push({ code, severity, params });

    // ---- Crítico ----
    const failingChannels = facts.channels.filter(channel => isCredentialFailure(channel.health));
    for (const channel of failingChannels) {
        add('channel_error', 'critico', { channel: channel.type, health: channel.health, name: channel.displayName ?? '' });
    }
    if (facts.delivery && facts.delivery.stuck >= STUCK_DELIVERY_CRITICAL_MIN) {
        add('stuck_deliveries', 'critico', { count: facts.delivery.stuck, minutes: Math.round(STUCK_DELIVERY_AFTER_SECONDS / 60) });
    }
    if (facts.dispatch && facts.dispatch.reconciliationRequired >= RECONCILIATION_CRITICAL_MIN) {
        add('reconciliation_required', 'critico', {
            count: facts.dispatch.reconciliationRequired,
            overdue: facts.dispatch.reconciliationOverdue,
        });
    }
    if (facts.dispatch && facts.dispatch.stalled >= DISPATCH_STALLED_CRITICAL_MIN) {
        add('dispatch_stalled', 'critico', { count: facts.dispatch.stalled });
    }
    if (facts.tools && facts.tools.calls >= TOOL_ERROR_MIN_CALLS) {
        const rate = toolErrorRate(facts.tools.calls, facts.tools.errors);
        const params = { rate: Math.round(rate * 1000) / 10, calls: facts.tools.calls, errors: facts.tools.errors };
        if (rate > TOOL_ERROR_RATE_CRITICAL) add('tool_error_rate_high', 'critico', params);
        else if (rate > TOOL_ERROR_RATE_ATTENTION) add('tool_error_rate_elevated', 'atencion', params);
    }

    // ---- Atención ----
    if (facts.delivery && facts.delivery.failed >= FAILED_DELIVERY_ATTENTION_MIN) {
        add('failed_deliveries', 'atencion', { count: facts.delivery.failed, days: BOARD_WINDOW_DAYS });
    }
    if (!facts.sectionErrors.includes('readiness')) {
        if (!facts.readiness) add('readiness_missing', 'atencion');
        else if (facts.readiness.verdict === 'no_listo') {
            add('not_ready', 'atencion', { blocking: facts.readiness.blockingFailing });
        }
    }
    const channelsKnown = !facts.sectionErrors.includes('channels');
    if (channelsKnown && facts.channels.length === 0 && facts.widgets === 0) add('no_channel', 'atencion');
    // `unknown` no se marca: no haber podido leer la credencial no es observar
    // un problema (misma regla que la página de Canales).
    for (const channel of facts.channels.filter(item => item.health === 'expiring')) {
        add('channel_warning', 'atencion', { channel: channel.type, health: channel.health, name: channel.displayName ?? '' });
    }
    if (facts.isLive && facts.volume && facts.volume.inbound === 0) {
        add('no_inbound_while_live', 'atencion', { days: BOARD_WINDOW_DAYS });
    }
    if (facts.agents && facts.agents.active === 0) add('no_active_agent', 'atencion');
    if (!facts.onboardingCompleted) add('onboarding_incomplete', 'atencion');
    if (facts.subscriptionStatus && SUBSCRIPTION_ATTENTION_STATES.has(facts.subscriptionStatus)) {
        add('subscription_issue', 'atencion', { status: facts.subscriptionStatus });
    }
    if (facts.sectionErrors.length > 0) {
        add('partial_data', 'atencion', { sections: facts.sectionErrors.join(', ') });
    }

    reasons.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critico' ? -1 : 1));
    const status = reasons.reduce<TenantBoardStatus>(
        (worst, reason) => (SEVERITY_RANK[reason.severity] > SEVERITY_RANK[worst] ? reason.severity : worst),
        'ok',
    );
    return { status, reasons };
}
