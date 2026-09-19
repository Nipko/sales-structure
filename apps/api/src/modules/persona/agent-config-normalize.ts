/**
 * Free-text lists the editor lets a person grow row by row: rules, forbidden
 * topics and handoff reasons. "+ Agregar" inserts an empty row; a person who
 * then changes her mind leaves it there. The canonical validator refuses a
 * list with an empty entry (`optionalTextList`) while the editor's own check
 * only asks for "at least one filled entry", so the save failed server-side
 * with no field to point at: the 14-sep recording lost fifteen minutes of
 * work exactly this way. Empty rows are noise, never intent: drop them before
 * hashing, validating or storing.
 */
const LIST_FIELDS = ['rules', 'forbiddenTopics', 'handoffTriggers'] as const;

export function normalizeAgentConfigLists<T extends Record<string, any>>(config: T): T {
    const behavior = config?.behavior;
    if (!behavior || typeof behavior !== 'object' || Array.isArray(behavior)) return config;
    let changed = false;
    const next: Record<string, any> = { ...behavior };
    for (const field of LIST_FIELDS) {
        const value = behavior[field];
        if (!Array.isArray(value)) continue;
        const cleaned = value
            .filter((item: unknown) => typeof item === 'string')
            .map((item: string) => item.trim())
            .filter((item: string) => item.length > 0);
        if (cleaned.length !== value.length || cleaned.some((item: string, index: number) => item !== value[index])) {
            next[field] = cleaned;
            changed = true;
        }
    }
    return changed ? { ...config, behavior: next } : config;
}
