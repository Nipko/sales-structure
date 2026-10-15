import fs from "node:fs";
import path from "node:path";
import { NextIntlClientProvider } from "next-intl";
import { interact, renderScreen } from "@/test/a11y";
import InboxPage from "./page";

jest.mock("@/lib/api", () => ({ api: {
    getInbox: jest.fn(), getConversation: jest.fn(),
    getMacros: jest.fn(async () => ({ success: true, data: [] })),
    getCustomAttributes: jest.fn(async () => ({ success: true, data: [] })),
    getCannedResponses: jest.fn(async () => ({ success: true, data: [] })),
    sendMessage: jest.fn(), addNote: jest.fn(), claimConversation: jest.fn(),
    assignConversation: jest.fn(), resolveConversation: jest.fn(),
} }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({
    user: { id: "owner-1", role: "tenant_admin" }, verticalConfig: null,
}) }));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "tenant-1" }) }));
jest.mock("@/components/inbox/ActiveObjectsCard", () => ({ ActiveObjectsCard: () => null }));
jest.mock("@/components/inbox/ToolApprovalsPanel", () => ({ ToolApprovalsPanel: () => null }));
jest.mock("./_components/ViewersIndicator", () => ({ ViewersIndicator: () => null }));

const { api } = jest.requireMock("@/lib/api") as { api: Record<string, jest.Mock> };
const writes = ["sendMessage", "addNote", "claimConversation", "assignConversation", "resolveConversation"];

beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    api.getInbox.mockResolvedValue({ success: true, data: ["One", "Two"].map((name, i) => ({
        id: `conv-${i + 1}`, contactName: `QA ${name}`, status: "active", channel: "telegram",
        contactId: `contact-${i + 1}`, lastMessage: "Synthetic message", unreadCount: 1,
    })) });
    api.getConversation.mockImplementation(async (_tenant, id) => ({ success: true, data: {
        id, contact: { id: `contact-${id}`, customFields: {} }, messages: [], notes: [], status: "active",
    } }));
});

it.each([
    ["es", "Abrir conversación con QA One"],
    ["en", "Open conversation with QA One"],
    ["pt", "Abrir conversa com QA One"],
    ["fr", "Ouvrir la conversation avec QA One"],
])("exposes a named native conversation action in %s", async (locale, label) => {
    const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../messages", `${locale}.json`), "utf8"));
    const screen = await renderScreen(
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Bogota">
            <InboxPage />
        </NextIntlClientProvider>,
    );
    try {
        const action = screen.container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
        expect(action).not.toBeNull();
        expect(action.type).toBe("button");
        expect(action.tabIndex).toBe(0);
        action.focus();
        expect(document.activeElement).toBe(action);
        for (const write of writes) expect(api[write]).not.toHaveBeenCalled();
    } finally { screen.unmount(); }
});

it("opens the chosen mobile thread without sending, assigning, resolving or adding a note", async () => {
    const screen = await renderScreen(<InboxPage />);
    try {
        const row = [...screen.container.querySelectorAll(".inbox-conv-item")]
            .find(element => element.textContent?.includes("QA Two"))!;
        const action = row.querySelector("button") as HTMLButtonElement;
        expect(action).not.toBeNull();
        const composer = screen.container.querySelector('input[placeholder^="Escribe un mensaje"]')!;
        const thread = composer.closest(".flex-1.flex-col.bg-background")!;
        expect(thread.classList.contains("hidden")).toBe(true);
        await interact(() => action.click());
        expect(thread.classList.contains("hidden")).toBe(false);
        expect(api.getConversation).toHaveBeenLastCalledWith("tenant-1", "conv-2");
        expect((composer as HTMLInputElement).value).toBe("");
        for (const write of writes) expect(api[write]).not.toHaveBeenCalled();
    } finally { screen.unmount(); }
});
