import { providerFitsProfile, providerFreshnessFor } from '@parallext/shared';

export type VerticalProvider = 'toast' | 'mindbody' | 'cliniko';

export const INTEGRATION_HEALTH_VERSION = 1 as const;
/**
 * El presupuesto por defecto, cuando el proveedor no tiene uno declarado.
 *
 * El número ya no vive acá: sale de `PROVIDER_FRESHNESS`, que es el mismo
 * registro que mira el contrato efectivo para decidir si publica la tool. Había
 * dos números —36h en esta pantalla, 900s en el contrato— midiendo el mismo
 * `asOf`: la integración quedaba despublicada 23 horas y 45 minutos de cada
 * día y el panel del dueño mostraba verde todo ese tiempo.
 */
export const INTEGRATION_FRESHNESS_MAX_AGE_SECONDS = 36 * 60 * 60;

function freshnessBudgetFor(provider: VerticalProvider): number {
    return providerFreshnessFor(provider)?.mirrorMaxAgeSeconds
        ?? INTEGRATION_FRESHNESS_MAX_AGE_SECONDS;
}
export const INTEGRATION_CIRCUIT_FAILURE_THRESHOLD = 3;

export type IntegrationHealthStatus =
    | 'healthy'
    | 'stale'
    | 'degraded'
    | 'unhealthy'
    | 'unavailable'
    /**
     * Conectada, sana y fresca — y aun así el agente no la usa, porque este
     * proveedor no significa nada en la industria del negocio.
     *
     * Sin este estado el panel mostraba **verde** mientras el contrato no
     * publicaba ni una de sus tools. El dueño veía una integración funcionando
     * y una conversación que no la usa, sin nada que explicara la diferencia.
     */
    | 'not_applicable';
export type IntegrationScopeStatus = 'unknown' | 'satisfied' | 'missing' | 'not_applicable';
export type IntegrationCircuitState = 'closed' | 'open' | 'half_open';

export interface SanitizedIntegrationError {
    code: string;
    message: string;
    at: string;
}

export interface StoredIntegrationHealth {
    version: typeof INTEGRATION_HEALTH_VERSION;
    provider: VerticalProvider;
    credentialValidated: boolean;
    requiredScopes: string[];
    grantedScopes: string[];
    scopeStatus: IntegrationScopeStatus;
    lastCheckedAt: string | null;
    lastSuccessfulSyncAt: string | null;
    consecutiveFailures: number;
    circuitState: IntegrationCircuitState;
    lastError: SanitizedIntegrationError | null;
    /** Configuration revision this observation was produced against. */
    configRevision?: number;
    /** Internal dedupe token. Never returned by the public health contract. */
    lastUpdateId?: string;
}

export interface IntegrationHealth {
    version: typeof INTEGRATION_HEALTH_VERSION;
    provider: VerticalProvider;
    /**
     * A provider configuration exists and therefore owns the covered domain
     * boundary. This is deliberately independent from `connected`: an outage,
     * missing scope or open circuit must not hand ownership back to local
     * writers and create two systems of record.
     */
    configured: boolean;
    status: IntegrationHealthStatus;
    connected: boolean;
    credentialValidated: boolean;
    requiredScopes: string[];
    grantedScopes: string[];
    scopeStatus: IntegrationScopeStatus;
    lastCheckedAt: string | null;
    lastSuccessfulSyncAt: string | null;
    freshness: {
        maxAgeSeconds: number;
        ageSeconds: number | null;
        stale: boolean;
    };
    /**
     * Si este proveedor aplica a la industria del negocio.
     *
     * `false` significa que la conexión puede estar impecable y sus lecturas no
     * se publican igual: es la única forma de que la pantalla y la conversación
     * digan lo mismo.
     */
    industryEligible: boolean;
    consecutiveFailures: number;
    circuitState: IntegrationCircuitState;
    lastError: SanitizedIntegrationError | null;
    configRevision: number;
}

export interface IntegrationHealthObservation {
    outcome: 'success' | 'failure';
    /** Stable operation id makes retries of the same observation idempotent. */
    updateId?: string;
    checkedAt?: string;
    syncSucceeded?: boolean;
    credentialValidated?: boolean;
    grantedScopes?: readonly string[];
    missingScopes?: readonly string[];
    error?: unknown;
    /** Reject the observation if credentials changed while the request ran. */
    configRevision?: number;
}

const REQUIRED_SCOPES: Record<VerticalProvider, readonly string[]> = {
    toast: ['menus:read'],
    mindbody: ['classes:read'],
    cliniko: ['appointment_types:read'],
};

export function requiredScopesForProvider(provider: VerticalProvider): string[] {
    return [...REQUIRED_SCOPES[provider]];
}

export function initialIntegrationHealth(
    provider: VerticalProvider,
    configRevision = 0,
): StoredIntegrationHealth {
    return {
        version: INTEGRATION_HEALTH_VERSION,
        provider,
        credentialValidated: false,
        requiredScopes: requiredScopesForProvider(provider),
        grantedScopes: [],
        scopeStatus: 'unknown',
        lastCheckedAt: null,
        lastSuccessfulSyncAt: null,
        consecutiveFailures: 0,
        circuitState: 'closed',
        lastError: null,
        configRevision,
    };
}

function uniqueStrings(values: readonly string[] | undefined): string[] {
    return [...new Set((values || []).filter((value): value is string => (
        typeof value === 'string' && value.length > 0 && value.length <= 128
    )))];
}

function httpStatus(error: any): number | null {
    const raw = error?.response?.status ?? error?.status ?? error?.statusCode;
    const status = Number(raw);
    return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

/** Never persists provider payloads, URLs, credentials or raw exception text. */
export function sanitizeIntegrationError(error: unknown, at: string): SanitizedIntegrationError {
    const status = httpStatus(error);
    if (status === 401) {
        return { code: 'http_401', message: 'Credenciales rechazadas por el proveedor.', at };
    }
    if (status === 403) {
        return { code: 'http_403', message: 'Permisos insuficientes en el proveedor.', at };
    }
    if (status === 429) {
        return { code: 'http_429', message: 'Límite de solicitudes del proveedor alcanzado.', at };
    }
    if (status && status >= 500) {
        return { code: `http_${status}`, message: 'Proveedor temporalmente no disponible.', at };
    }
    const rawCode = typeof (error as any)?.code === 'string' ? (error as any).code : '';
    const safeCode = /^[A-Za-z0-9_-]{1,64}$/.test(rawCode) ? rawCode.toLowerCase() : 'integration_check_failed';
    return { code: safeCode, message: 'No se pudo comprobar la integración.', at };
}

export function reduceIntegrationHealth(
    current: StoredIntegrationHealth | null | undefined,
    provider: VerticalProvider,
    observation: IntegrationHealthObservation,
    now = new Date(),
): StoredIntegrationHealth {
    const previous = current?.provider === provider ? current : initialIntegrationHealth(provider);
    if (observation.updateId && previous.lastUpdateId === observation.updateId) {
        return previous;
    }

    const checkedAt = observation.checkedAt || now.toISOString();
    const requiredScopes = requiredScopesForProvider(provider);
    const explicitGranted = observation.grantedScopes === undefined
        ? null
        : uniqueStrings(observation.grantedScopes);
    const missingScopes = uniqueStrings(observation.missingScopes);

    if (observation.outcome === 'success') {
        const grantedScopes = observation.syncSucceeded
            ? requiredScopes
            : (explicitGranted ?? previous.grantedScopes);
        const allScopesGranted = requiredScopes.every(scope => grantedScopes.includes(scope));
        const scopeStatus: IntegrationScopeStatus = missingScopes.length > 0
            ? 'missing'
            : allScopesGranted
                ? 'satisfied'
                : (previous.scopeStatus === 'satisfied' && explicitGranted === null
                    ? 'satisfied'
                    : 'unknown');
        return {
            ...previous,
            version: INTEGRATION_HEALTH_VERSION,
            provider,
            credentialValidated: observation.credentialValidated ?? true,
            requiredScopes,
            grantedScopes,
            scopeStatus,
            lastCheckedAt: checkedAt,
            lastSuccessfulSyncAt: observation.syncSucceeded
                ? checkedAt
                : previous.lastSuccessfulSyncAt,
            consecutiveFailures: 0,
            circuitState: 'closed',
            lastError: null,
            lastUpdateId: observation.updateId,
            configRevision: observation.configRevision ?? previous.configRevision ?? 0,
        };
    }

    const consecutiveFailures = previous.consecutiveFailures + 1;
    return {
        ...previous,
        version: INTEGRATION_HEALTH_VERSION,
        provider,
        credentialValidated: observation.credentialValidated ?? previous.credentialValidated,
        requiredScopes,
        grantedScopes: explicitGranted ?? previous.grantedScopes,
        scopeStatus: missingScopes.length > 0 ? 'missing' : previous.scopeStatus,
        lastCheckedAt: checkedAt,
        consecutiveFailures,
        circuitState: consecutiveFailures >= INTEGRATION_CIRCUIT_FAILURE_THRESHOLD
            ? 'open'
            : previous.circuitState,
        lastError: sanitizeIntegrationError(observation.error, checkedAt),
        lastUpdateId: observation.updateId,
        configRevision: observation.configRevision ?? previous.configRevision ?? 0,
    };
}

export function materializeIntegrationHealth(
    provider: VerticalProvider,
    configured: boolean,
    stored?: StoredIntegrationHealth | null,
    now = new Date(),
    /** La industria del negocio. Ausente = no se juzga elegibilidad. */
    industry?: string | null,
    /** El subtipo permite distinguir, por ejemplo, clínica de farmacia. */
    subtype?: string | null,
): IntegrationHealth {
    const state = stored?.provider === provider ? stored : initialIntegrationHealth(provider);
    const syncMs = state.lastSuccessfulSyncAt ? Date.parse(state.lastSuccessfulSyncAt) : NaN;
    const ageSeconds = Number.isFinite(syncMs)
        ? Math.max(0, Math.floor((now.getTime() - syncMs) / 1000))
        : null;
    const maxAgeSeconds = freshnessBudgetFor(provider);
    const stale = ageSeconds === null || ageSeconds > maxAgeSeconds;
    const connected = configured
        && state.credentialValidated
        && state.scopeStatus !== 'missing';

    const industryEligible = providerFitsProfile(provider, industry, subtype);

    let status: IntegrationHealthStatus;
    if (!configured || !stored || !state.lastCheckedAt) {
        status = 'unavailable';
    } else if (!industryEligible) {
        // Va ANTES de los estados de salud a propósito: decir "sano" de una
        // integración que el agente nunca va a usar es la contradicción que
        // este estado existe para eliminar. Y va DESPUÉS de `unavailable`
        // porque una integración que nadie configuró no necesita explicación.
        status = 'not_applicable';
    } else if (!connected || state.circuitState === 'open' || state.scopeStatus === 'missing') {
        status = 'unhealthy';
    } else if (stale) {
        status = 'stale';
    } else if (
        state.consecutiveFailures > 0
        || state.circuitState === 'half_open'
        || state.scopeStatus === 'unknown'
    ) {
        status = 'degraded';
    } else {
        status = 'healthy';
    }

    return {
        version: INTEGRATION_HEALTH_VERSION,
        provider,
        configured,
        status,
        connected,
        credentialValidated: state.credentialValidated,
        requiredScopes: [...state.requiredScopes],
        grantedScopes: [...state.grantedScopes],
        scopeStatus: state.scopeStatus,
        lastCheckedAt: state.lastCheckedAt,
        lastSuccessfulSyncAt: state.lastSuccessfulSyncAt,
        freshness: {
            maxAgeSeconds,
            ageSeconds,
            stale,
        },
        industryEligible,
        consecutiveFailures: state.consecutiveFailures,
        circuitState: state.circuitState,
        lastError: state.lastError ? { ...state.lastError } : null,
        configRevision: state.configRevision ?? 0,
    };
}
