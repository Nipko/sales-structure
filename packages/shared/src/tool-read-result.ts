/**
 * Read-result contract for agent tools.
 *
 * Every read the agent performs has to answer three questions the model cannot
 * infer on its own: did the query succeed, how old is the data, and which
 * system of record produced it. Before this contract a failed query and a real
 * "there is nothing" were the same value — `{orders: []}` — so the agent told
 * customers "no tienes pedidos" when the database had actually thrown.
 *
 * Failure carries `error`, which the pipeline's outcome guard already reads as
 * "this tool did not succeed", so a broken read can never back a claim.
 */

/** How a read ended. `empty` is a real answer; `error` is not. */
export type ToolReadStatus =
    | 'ok'
    | 'empty'
    | 'stale'
    | 'unauthorized'
    | 'provider_down'
    | 'error';

/** Health of the system that answered. */
export type ToolSourceHealth = 'healthy' | 'degraded' | 'down' | 'unknown';

/**
 * Where a value came from. `tenant_db` is Parallly's own tenant schema; any
 * other value names an external system of record, and the agent must say so
 * when the freshness matters (price, stock, capacity, policy, coverage).
 */
export type ToolSourceKind =
    | 'tenant_db'
    | 'tenant_cache'
    | 'channel_manager'
    | 'hostaway'
    | 'toast'
    | 'mindbody'
    | 'cliniko'
    | 'shopify'
    | 'woocommerce'
    | 'payment_provider'
    | 'calendar_provider'
    | 'mcp'
    | 'derived';

export interface ToolReadMeta {
    status: ToolReadStatus;
    /** System of record that produced the payload. */
    source: ToolSourceKind;
    /** ISO 8601 instant the underlying data was known to be true. */
    asOf: string;
    /** True when `asOf` is older than the source's freshness budget. */
    stale?: boolean;
    health?: ToolSourceHealth;
    /** Stable machine code when `status` is not `ok`/`empty`. */
    errorCode?: string;
    /** Whether the caller may retry the same read. */
    retryable?: boolean;
    /** Human-readable, customer-safe explanation. Never raw driver text. */
    message?: string;
}

/** A successful or empty read: the payload plus its provenance. */
export type ToolReadResult<T extends Record<string, unknown>> = T & ToolReadMeta;

/** A failed read. Always carries `error` so the outcome guard fails the turn. */
export interface ToolReadFailure extends ToolReadMeta {
    error: string;
    status: 'stale' | 'unauthorized' | 'provider_down' | 'error';
}

export const TOOL_READ_ERROR_CODES = {
    READ_FAILED: 'read_failed',
    PROVIDER_DOWN: 'provider_down',
    PROVIDER_TIMEOUT: 'provider_timeout',
    UNAUTHORIZED: 'unauthorized',
    NOT_CONFIGURED: 'not_configured',
    STALE_BEYOND_BUDGET: 'stale_beyond_budget',
} as const;

export type ToolReadErrorCode =
    (typeof TOOL_READ_ERROR_CODES)[keyof typeof TOOL_READ_ERROR_CODES];

/** Default freshness budgets in seconds, by source. */
export const TOOL_SOURCE_FRESHNESS_BUDGET_SECONDS: Record<ToolSourceKind, number> = {
    tenant_db: 0, // read live, never stale
    tenant_cache: 600,
    channel_manager: 3600,
    hostaway: 3600,
    toast: 86_400,
    mindbody: 86_400,
    cliniko: 86_400,
    shopify: 86_400,
    woocommerce: 86_400,
    payment_provider: 300,
    calendar_provider: 900,
    mcp: 3600,
    derived: 0,
};
