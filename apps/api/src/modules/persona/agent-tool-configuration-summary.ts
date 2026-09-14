import { AGENT_CONFIG_TOOL_FAMILIES, type AgentToolConfigurationSummary } from '@parallext/shared';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

export function summarizeAgentToolConfiguration(rows: Array<{ is_active: boolean; config_valid: boolean; tools: unknown }>): AgentToolConfigurationSummary {
    const families = Object.fromEntries(AGENT_CONFIG_TOOL_FAMILIES.map(family => {
        const counts = { activeEnabledAgents: 0, pausedEnabledAgents: 0, unknownAgents: 0 };
        for (const row of rows) {
            if (!row.config_valid || (row.tools != null && !isRecord(row.tools))) { counts.unknownAgents++; continue; }
            const config = isRecord(row.tools) ? row.tools[family] : undefined;
            if (config == null) continue;
            if (!isRecord(config) || (config.enabled != null && typeof config.enabled !== 'boolean')) { counts.unknownAgents++; continue; }
            if (config.enabled === true) {
                if (row.is_active === true) counts.activeEnabledAgents++;
                else if (row.is_active === false) counts.pausedEnabledAgents++;
                else counts.unknownAgents++;
            }
        }
        return [family, counts];
    })) as AgentToolConfigurationSummary['families'];
    return { source: 'operational', totalAgents: rows.length, families };
}
