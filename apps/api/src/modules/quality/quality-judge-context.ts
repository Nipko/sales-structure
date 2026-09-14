import { AGENT_CONFIG_TOOL_FAMILIES, isAgentMissionV1 } from '@parallext/shared';
import type { QualityCoverage } from './quality-evidence';
import { qualityHash } from './quality-evidence';

export interface QualityJudgeContext {
    source: 'production' | 'simulation';
    configuration: 'captured' | 'unavailable';
    mission: { objective: string; intentKeys: string[]; successCriteria: string[]; handoffConditions: string[] } | null;
    role: string | null;
    behavior: { rules: string[]; handoffTriggers: string[] } | null;
    skillset: 'sales' | 'support' | 'both' | null;
    enabledToolFamilies: string[];
    coverage: Pick<QualityCoverage, 'complete' | 'omittedMessages' | 'truncatedMessages'> | null;
    scenarioCriterion: string | null;
}

const record = (value: unknown): Record<string, any> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
const bounded = (value: unknown, limit: number): string | null =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : null;
const boundedList = (value: unknown): string[] => Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && item.trim()).slice(0, 20).map(item => item.trim().slice(0, 500)) : [];

/** Only the configuration that produced the evaluated replies may be used.
 * Allowlist business context; never send the whole config, custom prompt,
 * credentials, channel bindings or customer identifiers to the judge. Values
 * are untrusted evaluation data, not instructions overriding the QA rubric. */
export function qualityJudgeContext(config: unknown, options: {
    source: QualityJudgeContext['source']; coverage?: QualityCoverage; scenarioCriterion?: unknown;
}): QualityJudgeContext {
    const value = record(config);
    const mission = isAgentMissionV1(value?.mission) ? value.mission : null;
    const promptMode = (value?.editorMode ?? value?._mode) === 'prompt';
    return {
        source: options.source, configuration: value ? 'captured' : 'unavailable',
        mission: mission ? { objective: mission.objective, intentKeys: [...mission.intentKeys],
            successCriteria: [...mission.successCriteria], handoffConditions: [...mission.handoffConditions] } : null,
        role: promptMode ? null : bounded(value?.persona?.role, 500),
        // Existing guided templates may predate an explicitly reviewed mission.
        // Their intake/escalation rules still describe the work being judged;
        // never replace an absent historical mission with today's tenant setup.
        behavior: !promptMode && record(value?.behavior) ? {
            rules: boundedList(value!.behavior.rules), handoffTriggers: boundedList(value!.behavior.handoffTriggers),
        } : null,
        skillset: ['sales', 'support', 'both'].includes(value?.skillset) ? value!.skillset : null,
        enabledToolFamilies: AGENT_CONFIG_TOOL_FAMILIES.filter(family => record(value?.tools?.[family])?.enabled === true),
        coverage: options.coverage ? { complete: options.coverage.complete, omittedMessages: options.coverage.omittedMessages,
            truncatedMessages: options.coverage.truncatedMessages } : null,
        scenarioCriterion: bounded(options.scenarioCriterion, 2000),
    };
}

/** A different mission is a different yardstick, not a performance regression.
 * Tool toggles and response style may change between comparable experiments. */
export function qualityJudgeScopeHash(context: QualityJudgeContext): string {
    return qualityHash({ mission: context.mission, role: context.role, skillset: context.skillset,
        behavior: context.behavior,
        scenarioCriterion: context.scenarioCriterion });
}
