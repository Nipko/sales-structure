/**
 * Describes the side-effect contract of a request that reuses production
 * services.  `persistence: 'disabled'` is deliberately stronger than a UI or
 * evaluation flag: every participating service must bypass lazy migrations,
 * caches, telemetry and event-backed persistence.
 */
export interface ServiceExecutionContext {
    readonly mode: 'live' | 'agent_test' | 'evaluation';
    readonly persistence: 'enabled' | 'disabled';
}

export const AGENT_TEST_EXECUTION_CONTEXT: Readonly<ServiceExecutionContext> = Object.freeze({
    mode: 'agent_test',
    persistence: 'disabled',
});

export function persistenceDisabled(context?: ServiceExecutionContext): boolean {
    return context?.persistence === 'disabled';
}
