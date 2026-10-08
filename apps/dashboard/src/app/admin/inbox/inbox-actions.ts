/**
 * Pure decisions behind two Inbox controls, kept out of the (very large) page
 * so they can be specified without rendering it.
 */

/** Statuses in which a person, not the AI, is holding the conversation. */
export const HUMAN_HELD_STATUSES: readonly string[] = [
    "with_human", "waiting_human", "handoff", "assigned", "open",
];

interface ReturnToBotConversation {
    status?: string | null;
    assignedAgentId?: string | null;
}

/**
 * Whether the header shows "return to bot".
 *
 * The API (`PUT agent-console/conversation/:t/:c/return-to-ai`) lets a tenant
 * admin/supervisor act on any conversation and an agent only on the ones
 * assigned to them, so the control is offered under exactly that rule instead
 * of showing a button that is certain to answer 403.
 */
export function canReturnToBot(
    conversation: ReturnToBotConversation | null | undefined,
    actor: { id?: string | null; isSupervisor: boolean },
): boolean {
    if (!conversation) return false;
    const heldByHuman = HUMAN_HELD_STATUSES.includes(String(conversation.status || ""))
        || !!conversation.assignedAgentId;
    if (!heldByHuman) return false;
    if (actor.isSupervisor) return true;
    return !!actor.id && conversation.assignedAgentId === actor.id;
}

/** Contact-card fields as the inbox side panel edits them. */
export const CONTACT_CARD_KEYS = [
    "empresa", "ciudad", "sitio_web", "instagram", "facebook", "linkedin", "notas_rapidas",
] as const;

/**
 * Values the panel starts from. The conversation DETAIL carries them under
 * `contact.customFields` (the contact's stored metadata); the list row never
 * had `empresa`/`ciudad`/… so the card used to open blank every time and a
 * saved value could never be seen again.
 */
export function contactMetaFromDetail(
    customFields: unknown,
    customAttributeKeys: readonly string[] = [],
): Record<string, string> {
    const source = customFields && typeof customFields === "object" && !Array.isArray(customFields)
        ? customFields as Record<string, unknown>
        : {};
    const meta: Record<string, string> = {};
    // Only the fields the panel owns: the same JSON also holds keys written by
    // other parts of the product, and none of them may travel back on save.
    for (const key of [...CONTACT_CARD_KEYS, ...customAttributeKeys]) {
        const value = source[key];
        meta[key] = typeof value === "string" ? value : "";
    }
    return meta;
}

/** What the Save button sends: the panel's own keys, nothing else. */
export function contactMetaPayload(
    meta: Record<string, unknown>,
    customAttributeKeys: readonly string[] = [],
): Record<string, string> {
    const payload: Record<string, string> = {};
    for (const key of [...CONTACT_CARD_KEYS, ...customAttributeKeys]) {
        const value = meta[key];
        if (typeof value === "string") payload[key] = value;
    }
    return payload;
}
