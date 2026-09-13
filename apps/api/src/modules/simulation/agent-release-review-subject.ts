import { AGENT_ACCOUNT_DAYS, AGENT_CONFIG_TOOL_FAMILIES, type AgentReleaseReviewSubject,
    type AgentReleaseSubjectField } from '@parallext/shared';
import type { AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import { TOOL_SUBPERMISSION_RULES } from '../conversations/agent-tool-registry';

const text = (value: unknown): string | null => typeof value === 'string' ? value : null;
const flag = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;
const numeric = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const list = (value: unknown): string[] | null => Array.isArray(value) && value.every(item => typeof item === 'string') ? value.slice() : null;

/** Explicit allowlist: never copy arbitrary config, tool options, provider data or monetary pricing. */
export function projectReleaseConfiguration(config: any): AgentReleaseSubjectField[] {
    const fields: AgentReleaseSubjectField[] = [];
    const add = (key: string, value: AgentReleaseSubjectField['value']) => fields.push({ key, value });
    const promptMode = (config?.editorMode ?? config?._mode) === 'prompt';
    add('mode', promptMode ? 'prompt' : 'guided');
    for (const key of ['name', 'role', 'greeting', 'fallbackMessage']) add(key, text(config?.persona?.[key]));
    for (const key of ['tone', 'formality', 'emojiUsage', 'humor']) add(key, text(config?.persona?.personality?.[key]));
    add('customPrompt', promptMode ? text(config?.customPrompt ?? config?._customPrompt) : null);
    add('objective', text(config?.mission?.objective));
    for (const key of ['intentKeys', 'successCriteria', 'handoffConditions']) add(key, list(config?.mission?.[key]));
    for (const key of ['rules', 'forbiddenTopics', 'handoffTriggers']) add(key, list(config?.behavior?.[key]));
    const required = config?.behavior?.requiredFields;
    add('requiredInformation', required && typeof required === 'object' && !Array.isArray(required)
        ? Object.entries(required).flatMap(([scope, items]) => Array.isArray(items) ? items.filter(item => item && typeof item === 'object')
            .map(item => [scope, text(item.field), text(item.question), text(item.validation)].filter(Boolean).join(' · ')) : []) : null);
    add('draftMode', flag(config?.behavior?.draftMode));
    const families = [...new Set([...AGENT_CONFIG_TOOL_FAMILIES, 'mcp'])].sort();
    add('toolsEnabled', families.filter(family => config?.tools?.[family]?.enabled === true));
    add('toolPermissions', TOOL_SUBPERMISSION_RULES.filter(rule => config?.tools?.[rule.family]?.enabled === true
        && typeof config?.tools?.[rule.family]?.[rule.flag] === 'boolean')
        .map(rule => `${rule.family}.${rule.flag}: ${config.tools[rule.family][rule.flag]}`));
    add('timezone', text(config?.hours?.timezone));
    for (const day of AGENT_ACCOUNT_DAYS) {
        const value = config?.hours?.schedule?.[day];
        add(day, text(value) ?? (value && typeof value === 'object'
            ? [flag(value.enabled) === null ? '' : `enabled: ${value.enabled}`, text(value.open), text(value.close)].filter(Boolean).join(' · ') : null));
    }
    add('afterHoursMessage', text(config?.hours?.afterHoursMessageOverride ?? config?.hours?.afterHoursMessage));
    add('aiOutsideHours', flag(config?.hours?.aiOutsideHours));
    add('skillset', text(config?.skillset));
    add('upsellEnabled', flag(config?.upsell?.enabled));
    add('upsellIntensity', text(config?.upsell?.intensity));
    add('maxDiscountPercent', numeric(config?.upsell?.maxDiscountPercent));
    add('knowledgeEnabled', flag(config?.rag?.enabled));
    add('knowledgeTopK', numeric(config?.rag?.topK));
    add('knowledgeThreshold', numeric(config?.rag?.similarityThreshold));
    return fields;
}

/** Both sides come from the same private snapshot. A missing old baseline stays unknown. */
export function releaseReviewSubject(snapshot: AgentEvaluationSnapshot): AgentReleaseReviewSubject {
    const captured = snapshot as AgentEvaluationSnapshot & { configurationBaseOperationalHash?: string;
        configurationBaseOperationalBody?: { configJson: Record<string, any> } };
    const routing = (body: AgentEvaluationSnapshot['configurationBody']): AgentReleaseSubjectField[] => [
        {key:'channels',value:list(body?.channels)},{key:'channelBindings',value:list(body?.channelBindings)},
        {key:'scheduleMode',value:text(body?.scheduleMode)},{key:'isActive',value:flag(body?.isActive)},{key:'isDefault',value:flag(body?.isDefault)},
    ];
    const fields = [...projectReleaseConfiguration(snapshot.config),...routing(snapshot.configurationBody)];
    const baseFields = captured.configurationBaseOperationalBody ? [...projectReleaseConfiguration(captured.configurationBaseOperationalBody.configJson),...routing(snapshot.configurationBaseOperationalBody)] : null;
    return { version: 1, configurationRevisionId: snapshot.configurationRevisionId ?? null,
        configurationHash: snapshot.configurationRevisionHash ?? null, baseOperationalVersion: snapshot.version,
        baseOperationalHash: captured.configurationBaseOperationalHash ?? null, fields, baseFields,
        changes: baseFields ? fields.filter(field => revisionHash(field.value) !== revisionHash(baseFields.find(item => item.key === field.key)?.value ?? null))
            .map(field => ({ key: field.key, before: baseFields.find(item => item.key === field.key)?.value ?? null, after: field.value })) : null };
}
