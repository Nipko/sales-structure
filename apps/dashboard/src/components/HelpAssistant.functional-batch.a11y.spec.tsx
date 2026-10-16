import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import * as fs from "fs";
import * as path from "path";
import { HelpAssistant } from "./HelpAssistant";

const TENANT = "11111111-1111-4111-8111-111111111111";
const mockUser = {
    id: "qa-local-assist", role: "tenant_admin", tenantId: TENANT,
    onboardingStage: "agent_reviewed", firstReplyAt: null,
    tenantCreatedAt: "2026-10-16T00:00:00.000Z",
};
jest.mock("@/lib/api", () => ({ api: { copilotChat: jest.fn(), getAgentReviewMode: jest.fn() } }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "11111111-1111-4111-8111-111111111111" }) }));
jest.mock("@/hooks/useRole", () => ({ useRole: () => ({
    role: "tenant_admin", canEditAgent: true, canEditKnowledge: true, canEditPipeline: true,
    canManageChannels: true, canManageSettings: true,
}) }));
jest.mock("next/navigation", () => ({
    usePathname: () => "/admin/agent", useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }), useParams: () => ({}),
}));
const { api } = jest.requireMock("@/lib/api") as { api: { copilotChat: jest.Mock } };
const FAILURE_TEXT = "Error de conexión";
const QUESTION = "QA local: explica una opción sin proponer cambios";
const RETRY = "QA local: vuelve a explicar esa opción";
const REPLY = "QA local: explicación recibida, sin cambios.";

// Real HelpAssistant, Sheet, translations and async state. The API method is
// the only chat boundary: no CopilotService, assessment, provider or real LLM.
// A normal transport failure resolves success:false because apiPost catches it.
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
function dialog(): HTMLElement {
    const element = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(element).not.toBeNull();
    return element!;
}
function composer(): HTMLInputElement {
    const element = dialog().querySelector<HTMLInputElement>('input[type="text"]');
    expect(element).not.toBeNull();
    return element!;
}
function submitButton(): HTMLButtonElement {
    const element = dialog().querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(element).not.toBeNull();
    return element!;
}
async function settle() { await act(async () => { await Promise.resolve(); }); }
async function submit(text: string) {
    const input = composer();
    expect(input.disabled).toBe(false);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
        setter.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(composer().value).toBe(text);
    expect(submitButton().disabled).toBe(false);
    await act(async () => { submitButton().click(); });
    await settle();
}

describe.each(["es", "en", "pt", "fr"])("Assist real component async functional batch in %s", locale => {
    beforeEach(() => {
        api.copilotChat.mockReset();
        sessionStorage.clear();
        localStorage.clear();
    });
    async function mounted(check: (messages: any) => Promise<void>) {
        const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../messages", locale + ".json"), "utf8"));
        for (const value of [messages.helpAssistant.drawerTitle, messages.helpAssistant.announce.body,
            messages.helpAssistant.chat.typing, messages.helpAssistant.chat.invalidResponse,
            messages.helpAssistant.chat.inputPlaceholder]) {
            expect(typeof value).toBe("string");
            expect(value.trim().length).toBeGreaterThan(0);
        }
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        try {
            await act(async () => { root.render(<NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Bogota"><HelpAssistant /></NextIntlClientProvider>); });
            // The actual component's normal sidebar event only opens/reset the
            // local drawer. It never invokes the server. No production event.
            await act(async () => { window.dispatchEvent(new CustomEvent("parallly:open-copilot")); });
            await settle();
            expect(dialog().textContent).toContain(messages.helpAssistant.drawerTitle);
            expect(api.copilotChat).not.toHaveBeenCalled();
            await check(messages);
        } finally {
            act(() => root.unmount());
            container.remove();
        }
    }

    it("H1 makes chat failure detectable, releases pending controls and permits only a deliberate retry", async () => {
        const first = deferred<any>();
        api.copilotChat.mockReturnValueOnce(first.promise)
            .mockResolvedValueOnce({ success: true, data: { reply: REPLY } });
        await mounted(async messages => {
            await submit(QUESTION);
            expect(api.copilotChat).toHaveBeenCalledTimes(1);
            expect(api.copilotChat.mock.calls[0]).toEqual([{
                message: QUESTION, page: "/admin/agent", locale,
                history: [{ role: "assistant", content: messages.helpAssistant.announce.body }],
                target: undefined,
            }]);
            expect(composer().disabled).toBe(true);
            expect(composer().value).toBe("");
            expect(submitButton().disabled).toBe(true);
            expect(dialog().textContent).toContain(messages.helpAssistant.chat.typing);
            // Native disabled click is what a waiting person can attempt; no
            // forced submit of a form that the product has disabled.
            await act(async () => { submitButton().click(); });
            expect(api.copilotChat).toHaveBeenCalledTimes(1);
            await act(async () => { first.resolve({ success: false, error: FAILURE_TEXT }); });
            await settle();
            expect(dialog().textContent).toContain(FAILURE_TEXT);
            expect(dialog().textContent).not.toContain(messages.helpAssistant.chat.typing);
            expect(composer().disabled).toBe(false);
            expect(submitButton().disabled).toBe(true);
            expect(api.copilotChat).toHaveBeenCalledTimes(1);
            const errorHasAnnouncementRegion = Array.from(dialog().querySelectorAll(
                '[role="alert"], [role="status"], [role="log"], [aria-live="polite"], [aria-live="assertive"]',
            )).some(node => node.textContent?.includes(FAILURE_TEXT));
            await submit(RETRY);
            expect(api.copilotChat).toHaveBeenCalledTimes(2);
            expect(api.copilotChat.mock.calls[1][0]).toMatchObject({ message: RETRY, page: "/admin/agent", locale });
            expect(dialog().textContent).toContain(REPLY);
            expect(composer().disabled).toBe(false);
            expect(dialog().textContent).not.toContain(messages.helpAssistant.chat.typing);
            await settle();
            expect(api.copilotChat).toHaveBeenCalledTimes(2);
            // Snapshot taken before retry: testing the error does not skip the
            // recovery control. DOM semantics are not a real AT demonstration.
            expect(errorHasAnnouncementRegion).toBe(true);
        });
    });

    it("H2 discards an old reply after reset without unlocking or polluting the current pending request", async () => {
        const oldRequest = deferred<any>();
        const currentRequest = deferred<any>();
        api.copilotChat.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(currentRequest.promise);
        await mounted(async messages => {
            await submit(QUESTION);
            expect(api.copilotChat).toHaveBeenCalledTimes(1);
            expect(composer().disabled).toBe(true);
            await act(async () => { window.dispatchEvent(new CustomEvent("parallly:open-copilot")); });
            await settle();
            expect(composer().disabled).toBe(false);
            expect(composer().value).toBe("");
            expect(dialog().textContent).not.toContain(QUESTION);
            expect(dialog().textContent).not.toContain(messages.helpAssistant.chat.typing);
            expect(api.copilotChat).toHaveBeenCalledTimes(1);
            await submit(RETRY);
            expect(api.copilotChat).toHaveBeenCalledTimes(2);
            expect(api.copilotChat.mock.calls[1][0].history).toEqual([
                { role: "assistant", content: messages.helpAssistant.announce.body },
            ]);
            await act(async () => { oldRequest.resolve({ success: true, data: { reply: "QA LOCAL OLD REPLY MUST NOT ENTER NEW CONTEXT" } }); });
            await settle();
            expect(dialog().textContent).not.toContain("QA LOCAL OLD REPLY MUST NOT ENTER NEW CONTEXT");
            expect(dialog().textContent).toContain(RETRY);
            expect(dialog().textContent).toContain(messages.helpAssistant.chat.typing);
            expect(composer().disabled).toBe(true);
            expect(submitButton().disabled).toBe(true);
            await act(async () => { currentRequest.resolve({ success: true, data: { reply: REPLY } }); });
            await settle();
            expect(dialog().textContent).toContain(REPLY);
            expect(dialog().textContent).not.toContain("QA LOCAL OLD REPLY MUST NOT ENTER NEW CONTEXT");
            expect(dialog().textContent).not.toContain(messages.helpAssistant.chat.typing);
            expect(composer().disabled).toBe(false);
            expect(api.copilotChat).toHaveBeenCalledTimes(2);
        });
    });
});
