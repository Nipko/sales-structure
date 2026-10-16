import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import * as fs from "fs";
import * as path from "path";
import ContactsPage from "./page";

jest.mock("@/lib/api", () => ({ api: { fetch: jest.fn() } }));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "11111111-1111-4111-8111-111111111111" }) }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "qa", role: "tenant_admin" }, verticalConfig: null }) }));
jest.mock("@/hooks/usePlanLimits", () => ({ usePlanLimits: () => ({ canCreate: () => true, getLimit: () => Infinity }) }));
const { api } = jest.requireMock("@/lib/api") as { api: { fetch: jest.Mock } };

describe.each(["es", "en", "pt", "fr"])("contact list failed read versus empty result in %s", locale => {
    async function renderResult(fails: boolean, check: (container: HTMLDivElement, messages: any) => void) {
        const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../messages", locale + ".json"), "utf8"));
        expect(typeof messages.contacts.loadError).toBe("string");
        expect(messages.contacts.loadError.length).toBeGreaterThan(15);
        const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
        api.fetch.mockReset().mockImplementation(async (endpoint: string, options?: RequestInit) => {
            if (endpoint !== "/crm/leads/11111111-1111-4111-8111-111111111111" || options?.method) throw new Error("Unexpected request");
            if (fails) throw new Error("Synthetic transport failure");
            return { success: true, data: [] };
        });
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        try {
            await act(async () => { root.render(<NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Bogota"><ContactsPage /></NextIntlClientProvider>); });
            expect(api.fetch).toHaveBeenCalledTimes(1);
            expect(api.fetch.mock.calls[0]).toEqual(["/crm/leads/11111111-1111-4111-8111-111111111111"]);
            check(container, messages);
        } finally {
            act(() => root.unmount());
            container.remove();
            errorLog.mockRestore();
        }
    }

    it("exposes the failed read and does not claim the contact list is empty", async () => {
        await renderResult(true, (container, messages) => {
            const observed = {
                alerts: Array.from(container.querySelectorAll('[role="alert"]')).map(node => node.textContent?.trim()),
                emptyParagraphs: Array.from(container.querySelectorAll("p")).filter(node => node.textContent?.trim() === messages.verticalEmptyStates.default.contacts).length,
            };
            expect(observed).toEqual({ alerts: [messages.contacts.loadError], emptyParagraphs: 0 });
        });
    });

    it("preserves the successful empty state without an error or another request", async () => {
        await renderResult(false, (container, messages) => {
            expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
            expect(Array.from(container.querySelectorAll("p")).filter(node => node.textContent?.trim() === messages.verticalEmptyStates.default.contacts)).toHaveLength(1);
        });
    });
});
