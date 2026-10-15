import { interact, renderScreen } from "@/test/a11y";
import InboxPage from "./page";

jest.mock("@/lib/api", () => ({ api: {
    getInbox: jest.fn(), getConversation: jest.fn(), addNote: jest.fn(),
    getMacros: jest.fn(async () => ({ success: true, data: [] })),
    getCustomAttributes: jest.fn(async () => ({ success: true, data: [] })),
    getCannedResponses: jest.fn(async () => ({ success: true, data: [] })),
} }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({
    user: { id: "owner-1", role: "tenant_admin", firstName: "QA", lastName: "Owner" }, verticalConfig: null,
}) }));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "tenant-1" }) }));
jest.mock("@/components/inbox/ActiveObjectsCard", () => ({ ActiveObjectsCard: () => null }));
jest.mock("@/components/inbox/ToolApprovalsPanel", () => ({ ToolApprovalsPanel: () => null }));
jest.mock("./_components/ViewersIndicator", () => ({ ViewersIndicator: () => null }));
const { api } = jest.requireMock("@/lib/api") as { api: Record<string, jest.Mock> };
const persisted = { id: "note-1", content: "Synthetic persisted note", agentName: "QA Owner", createdAt: "2026-10-14T08:09:00.000Z" };

beforeEach(() => {
    localStorage.clear();
    api.getInbox.mockResolvedValue({ success: true, data: [{ id: "conv-1", contact_name: "QA Note Contact", status: "active", channel_type: "telegram", contact_id: "contact-1" }] });
    api.getConversation.mockResolvedValue({ success: true, data: { contact: { id: "contact-1", customFields: {} }, messages: [], notes: [persisted] } });
    api.addNote.mockReset();
});

async function openNotes() {
    const screen = await renderScreen(<InboxPage />);
    const contact = [...screen.container.querySelectorAll("span")].find(e => e.textContent === "QA Note Contact");
    expect(contact).toBeDefined();
    await interact(() => (contact as HTMLElement).click());
    const more = screen.container.querySelector("button:has(svg.lucide-ellipsis)") as HTMLButtonElement;
    expect(more).not.toBeNull();
    await interact(() => more.click());
    const notes = [...screen.container.querySelectorAll("button")].find(e => e.textContent?.trim() === "Notas internas");
    await interact(() => notes!.click());
    return screen;
}

function noteCard(container: HTMLElement, content: string) {
    return [...container.querySelectorAll("div")].find(e => e.textContent === content)?.parentElement;
}

async function enterNote(container: HTMLElement, value: string) {
    const input = container.querySelector('input[placeholder="Agregar nota interna..."]') as HTMLInputElement;
    await interact(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return input;
}

it("renders author and timestamp from the real camelCase conversation detail after a fresh mount", async () => {
    const screen = await openNotes();
    try {
        const metadata = noteCard(screen.container, persisted.content)?.children[1]?.textContent || "";
        expect(metadata).toContain("QA Owner");
        expect(metadata).toContain(new Date(persisted.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }));
        expect(metadata).not.toContain(persisted.createdAt);
    } finally { screen.unmount(); }
});

it("uses the persisted creation timestamp from the successful note receipt", async () => {
    api.addNote.mockResolvedValue({ success: true, data: { ...persisted, id: "note-2", content: "New synthetic note", createdAt: "2026-10-14T11:47:00.000Z" } });
    const screen = await openNotes();
    try {
        await enterNote(screen.container, "New synthetic note");
        const save = [...screen.container.querySelectorAll("button")].find(e => e.textContent?.trim() === "Guardar");
        await interact(() => save!.click());
        expect(api.addNote).toHaveBeenCalledWith("tenant-1", "conv-1", "New synthetic note");
        const metadata = noteCard(screen.container, "New synthetic note")?.children[1]?.textContent || "";
        expect(metadata).toContain(new Date("2026-10-14T11:47:00.000Z").toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }));
    } finally { screen.unmount(); }
});

it("does not show a saved note when the API envelope refuses it", async () => {
    api.addNote.mockResolvedValue({ success: false, error: "not allowed" });
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    const screen = await openNotes();
    try {
        const input = await enterNote(screen.container, "Refused synthetic note");
        const save = [...screen.container.querySelectorAll("button")].find(e => e.textContent?.trim() === "Guardar");
        await interact(() => save!.click());
        expect(noteCard(screen.container, "Refused synthetic note")).toBeUndefined();
        expect(input.value).toBe("Refused synthetic note");
        expect(screen.container.textContent).toContain("No se pudo guardar la nota. Intenta de nuevo.");
    } finally { screen.unmount(); log.mockRestore(); }
});
