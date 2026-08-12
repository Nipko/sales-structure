import {
  buildHelpChatHistory,
  canUseHelpAssistantChat,
  HELP_CHAT_HISTORY_MAX_TOTAL_LENGTH,
  HELP_CHAT_HISTORY_LIMIT,
  HELP_CHAT_MESSAGE_MAX_LENGTH,
} from "./help-assistant-contract";

describe("help assistant chat eligibility", () => {
  it.each(["tenant_admin", "tenant_supervisor", "tenant_agent"])(
    "allows tenant role %s when a tenant context exists",
    (role) => {
      expect(canUseHelpAssistantChat({ role, tenantId: "tenant-id" })).toBe(true);
    },
  );

  it.each([
    null,
    { role: "super_admin", tenantId: null },
    { role: "super_admin", tenantId: "tenant-id" },
    { role: "tenant_admin", tenantId: null },
    { role: "tenant_viewer", tenantId: "tenant-id" },
  ])("hides the entire assistant without an authorized tenant endpoint (%p)", (user) => {
    expect(canUseHelpAssistantChat(user)).toBe(false);
  });
});

describe("help assistant request bounds", () => {
  it("sends only the most recent ten messages", () => {
    const messages = Array.from({ length: HELP_CHAT_HISTORY_LIMIT + 4 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `message-${index}`,
    }));

    expect(buildHelpChatHistory(messages).map(({ content }) => content)).toEqual(
      messages.slice(-HELP_CHAT_HISTORY_LIMIT).map(({ content }) => content),
    );
  });

  it("trims, bounds and drops empty history entries", () => {
    expect(buildHelpChatHistory([
      { role: "assistant", content: "   " },
      { role: "user", content: `  ${"x".repeat(HELP_CHAT_MESSAGE_MAX_LENGTH + 50)}  ` },
    ])).toEqual([
      { role: "user", content: "x".repeat(HELP_CHAT_MESSAGE_MAX_LENGTH) },
    ]);
  });

  it("never exceeds the server aggregate history limit", () => {
    const history = buildHelpChatHistory(Array.from(
      { length: HELP_CHAT_HISTORY_LIMIT },
      (_, index) => ({
        role: index % 2 === 0 ? "user" as const : "assistant" as const,
        content: "x".repeat(HELP_CHAT_MESSAGE_MAX_LENGTH),
      }),
    ));

    expect(history.reduce((total, message) => total + message.content.length, 0))
      .toBe(HELP_CHAT_HISTORY_MAX_TOTAL_LENGTH);
    expect(history).toHaveLength(
      HELP_CHAT_HISTORY_MAX_TOTAL_LENGTH / HELP_CHAT_MESSAGE_MAX_LENGTH,
    );
  });
});
