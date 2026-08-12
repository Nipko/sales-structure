export const HELP_CHAT_HISTORY_LIMIT = 10;
export const HELP_CHAT_MESSAGE_MAX_LENGTH = 2_000;
export const HELP_CHAT_HISTORY_MAX_TOTAL_LENGTH = 12_000;

export type HelpChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type HelpChatUser = {
  role?: string | null;
  tenantId?: string | null;
} | null | undefined;

const TENANT_CHAT_ROLES = new Set([
  "tenant_admin",
  "tenant_supervisor",
  "tenant_agent",
]);

/** Matches the roles accepted by POST /copilot/chat and requires tenant context. */
export function canUseHelpAssistantChat(user: HelpChatUser): boolean {
  return Boolean(
    user?.tenantId
    && user?.role
    && TENANT_CHAT_ROLES.has(user.role),
  );
}

/** Keeps client requests inside the stricter server-side history contract. */
export function buildHelpChatHistory(messages: HelpChatMessage[]): HelpChatMessage[] {
  const recentMessages = messages
    .slice(-HELP_CHAT_HISTORY_LIMIT)
    .map(({ role, content }) => ({
      role,
      content: content.trim().slice(0, HELP_CHAT_MESSAGE_MAX_LENGTH),
    }))
    .filter(({ content }) => content.length > 0);

  let remainingLength = HELP_CHAT_HISTORY_MAX_TOTAL_LENGTH;
  return recentMessages.reduceRight<HelpChatMessage[]>((history, message) => {
    if (remainingLength === 0) return history;
    const content = message.content.slice(0, remainingLength);
    remainingLength -= content.length;
    history.unshift({ ...message, content });
    return history;
  }, []);
}
