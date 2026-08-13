export const AGENT_QUALITY_DEPENDENCIES_UPDATED = 'agent-quality.dependencies.updated';

export const AGENT_QUALITY_DEPENDENCY_SOURCES = [
    'business_info',
    'tenant_settings',
    'channel_connection',
    'channel_credential',
    'tenant_users',
    'knowledge',
    'services',
    'catalog',
    'vertical',
] as const;

export type AgentQualityDependencySource = typeof AGENT_QUALITY_DEPENDENCY_SOURCES[number];

export type AgentQualityDependenciesUpdatedEvent = {
    tenantId: string;
    source: AgentQualityDependencySource;
};
