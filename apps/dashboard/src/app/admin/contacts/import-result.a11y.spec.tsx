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
const importResult = { imported: 1, skipped: 2, errors: ["Fila 3: dato QA inválido", "Fila 4: etapa QA inválida"] };
const csv = "phone,first_name\nQA_SYNTHETIC_ONLY,Zafiro";

beforeEach(() => {
    api.fetch.mockReset().mockImplementation(async (endpoint: string, options?: RequestInit) => {
        if (endpoint.startsWith("/crm/leads/") && !options?.method) return { success: true, data: [] };
        if (endpoint.startsWith("/crm/import/") && options?.method === "POST") return { success: true, data: importResult };
        throw new Error("Unexpected API call: " + endpoint);
    });
});

describe.each(["es", "en", "pt", "fr"])("contact import result in %s", locale => {
    async function withSubmittedImport(check: (container: HTMLDivElement, messages: any) => void) {
        const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../messages", locale + ".json"), "utf8"));
        expect(typeof messages.contacts.importModal.imported).toBe("string");
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        const click = async (name: string, scope: HTMLElement = container) => {
            const matches = Array.from(scope.querySelectorAll("button")).filter(button => button.textContent?.trim() === name);
            expect(matches).toHaveLength(1);
            await act(async () => { matches[0].click(); });
        };
        try {
            await act(async () => { root.render(<NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Bogota"><ContactsPage /></NextIntlClientProvider>); });
            await click(messages.contacts.import);
            const textarea = container.querySelector("textarea");
            expect(textarea).not.toBeNull();
            await act(async () => {
                Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, csv);
                textarea!.dispatchEvent(new Event("input", { bubbles: true }));
            });
            await click(messages.contacts.importModal.import, textarea!.parentElement!);
            const imports = api.fetch.mock.calls.filter(([endpoint]) => endpoint.startsWith("/crm/import/"));
            expect(imports).toHaveLength(1);
            expect(JSON.parse(imports[0][1].body)).toEqual({ csvContent: csv });
            expect(api.fetch.mock.calls.every(([endpoint]) => endpoint.startsWith("/crm/leads/") || endpoint.startsWith("/crm/import/"))).toBe(true);
            check(container, messages);
        } finally {
            act(() => root.unmount());
            container.remove();
        }
    }

    it("shows server counts and per-row errors from the controller success/data envelope", async () => {
        await withSubmittedImport((container, messages) => {
            const text = container.textContent;
            expect(text).toContain(messages.contacts.importModal.imported + ": 1");
            expect(text).toContain(messages.contacts.importModal.skipped + ": 2");
            for (const error of importResult.errors) expect(text).toContain(error);
        });
    });

    it("shows a rejected import as an error without a success summary or retry", async () => {
        const previous = api.fetch.getMockImplementation()!;
        api.fetch.mockImplementation(async (endpoint: string, options?: RequestInit) => {
            if (endpoint.startsWith("/crm/import/")) throw new Error("Synthetic transport failure");
            return previous(endpoint, options);
        });
        await withSubmittedImport((container, messages) => {
            expect(container.textContent).toContain(messages.common.errorSaving);
            expect(container.textContent).not.toContain(messages.contacts.importModal.successTitle);
            expect(container.querySelector("textarea")?.value).toBe(csv);
        });
    });
});
