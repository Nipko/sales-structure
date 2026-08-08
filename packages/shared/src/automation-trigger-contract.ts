/**
 * Persisted trigger names understood by the automation runtime.
 *
 * Product-facing names intentionally remain stable even when the underlying
 * domain event is namespaced differently (`stage_changed` is fed by
 * `pipeline.stage_changed`, for example).
 */
export const AUTOMATION_TRIGGER_TYPES = [
    'lead.captured',
    'new_message',
    'conversation_assigned',
    'sla_timeout',
    'inactivity',
    'stage_changed',
    'appointment.completed',
    'vaccination.due',
    'policy.expiring',
    'membership.expiring',
    'member.inactive',
    'cohort.starting',
    'stay.arriving',
    'stay.ended',
    'rebooking.due',
] as const;

export type AutomationTriggerType = typeof AUTOMATION_TRIGGER_TYPES[number];

const AUTOMATION_TRIGGER_TYPE_SET = new Set<string>(AUTOMATION_TRIGGER_TYPES);

export function isAutomationTriggerType(value: unknown): value is AutomationTriggerType {
    return typeof value === 'string' && AUTOMATION_TRIGGER_TYPE_SET.has(value);
}

export const AUTOMATION_DOMAIN_EVENT_TO_TRIGGER = {
    'message.inbound': 'new_message',
    'conversation.assigned': 'conversation_assigned',
    'pipeline.stage_changed': 'stage_changed',
    'pipeline.sla_violated': 'sla_timeout',
    'appointment.completed': 'appointment.completed',
} as const satisfies Readonly<Record<string, AutomationTriggerType>>;
