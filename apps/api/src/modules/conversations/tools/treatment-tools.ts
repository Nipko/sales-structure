/**
 * Treatment Plans tools — let the patient ask the AI about their multi-session
 * treatment progress without having to escalate to staff.
 * Registered when config.tools.treatments.enabled === true.
 */
import { ToolDefinition } from '@parallext/shared';

export const TREATMENT_TOOLS: ToolDefinition[] = [
    {
        name: 'get_treatment_plan',
        description: 'Get the active treatment plan for the current contact (the patient writing). Returns total sessions, completed sessions, sessions left, plan type and started date. Use when the patient asks about their treatment progress.',
        parameters: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'list_upcoming_sessions',
        description: 'List the upcoming scheduled sessions in the patient\'s active treatment plan. Use when the patient asks "when is my next appointment?" or "how many sessions do I have left?".',
        parameters: {
            type: 'object',
            properties: {
                limit: {
                    type: 'number',
                    description: 'Max number of upcoming sessions to return (default 5)',
                },
            },
        },
    },
];
