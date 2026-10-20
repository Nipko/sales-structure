import { BadRequestException } from '@nestjs/common';

/** Select server-owned, already applicable scenarios; never accept scenario bodies. */
export function validateEvalScenarioKeys(value: unknown): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length === 0 || value.length > 50 ||
        value.some(key => typeof key !== 'string' || key.trim() !== key || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/.test(key)) ||
        new Set(value).size !== value.length) {
        throw new BadRequestException({ error: 'eval_scenario_selection_invalid' });
    }
    return [...value];
}

export function selectEvalScenarios<T extends { key: string }>(available: T[], keys?: string[]): T[] {
    const selection = validateEvalScenarioKeys(keys);
    if (selection === undefined) return available;
    return selection.map(key => {
        const matches = available.filter(row => row.key === key);
        if (matches.length !== 1) throw new BadRequestException({ error: 'eval_scenario_selection_unavailable' });
        return matches[0];
    });
}
