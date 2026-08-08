/**
 * Describes the side-effect contract of a request that reuses production
 * services. `persistence: 'disabled'` is deliberately stronger than a UI or
 * evaluation flag: every participating service must bypass business writes,
 * lazy migrations, caches and event-backed persistence.
 *
 * Provider usage is a separate concern. A read-only preview still consumes a
 * real LLM quota and real provider spend, so callers must opt in explicitly to
 * operational usage accounting without re-enabling business persistence.
 */
export interface ServiceExecutionContext {
    readonly mode: 'live' | 'agent_test' | 'evaluation';
    readonly persistence: 'enabled' | 'disabled';
    readonly operationalUsageAccounting?: 'enabled' | 'disabled';
}

export const AGENT_TEST_EXECUTION_CONTEXT: Readonly<ServiceExecutionContext> = Object.freeze({
    mode: 'agent_test',
    persistence: 'disabled',
    operationalUsageAccounting: 'enabled',
});

export function persistenceDisabled(context?: ServiceExecutionContext): boolean {
    return context?.persistence === 'disabled';
}

export function operationalUsageAccountingEnabled(context?: ServiceExecutionContext): boolean {
    return context?.operationalUsageAccounting === 'enabled';
}
