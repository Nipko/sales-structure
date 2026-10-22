import { CORE_TOOL_PREREQUISITES, type ToolDefinition } from '@parallext/shared';
import { isBusinessWriteTool } from './tool-policy-registry';

/**
 * Core lifecycles also apply when they are not a vertical's primary mission.
 *
 * The table lives in `packages/shared/src/operation-catalogue.ts` so the
 * operation catalogue derives committing operations' required reads from the
 * same source this retention keeps alive.
 */
export const CORE_PREREQUISITES: Readonly<Record<string, readonly string[]>> = CORE_TOOL_PREREQUISITES;

/** Expand selection within the already-authorized snapshot, never outside it. */
export function retainTaskDependencies(
    selected: readonly ToolDefinition[],
    candidates: readonly ToolDefinition[],
    authoredPlans: readonly (readonly string[])[] = [],
): ToolDefinition[] {
    const available = new Map(candidates.map(tool => [tool.name, tool]));
    const retained = new Map(selected.map(tool => [tool.name, tool]));
    for (const tool of retained.values()) {
        const prerequisites = new Set(CORE_PREREQUISITES[tool.name] || []);
        if (isBusinessWriteTool(tool.name)) {
            for (const plan of authoredPlans) {
                if (plan.includes(tool.name)) {
                    // A task's readers survive together with its selected writer.
                    // Other writers in a plan remain subject to ordinary selection.
                    for (const name of plan) if (!isBusinessWriteTool(name)) prerequisites.add(name);
                }
            }
        }
        for (const name of prerequisites) {
            const dependency = available.get(name);
            if (dependency && !retained.has(name)) retained.set(name, dependency);
        }
    }
    return [...retained.values()];
}
