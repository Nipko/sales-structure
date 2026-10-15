import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import * as fs from "fs";
import * as path from "path";
import IdentityPage from "./page";

jest.mock("@/lib/api", () => ({ api: { fetch: jest.fn() } }));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "11111111-1111-4111-8111-111111111111" }) }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", role: "tenant_admin" }, verticalConfig: null }) }));
const { api } = jest.requireMock("@/lib/api") as { api: { fetch: jest.Mock } };
const counts = { pending: 1, approved: 2, rejected: 3 };
const rows = Object.entries(counts).flatMap(([status, count]) => Array.from({ length: count }, (_, index) => ({
    id: `${status}-${index}`, status, confidence: 0.8, match_type: "email_match",
    contact_a_name: `QA ${status} ${index} A`, contact_b_name: `QA ${status} ${index} B`,
})));

// The existing list contract defaults to pending and filters by status before LIMIT100.
// A separate read summary may return aggregate counts without exposing historical contacts.
beforeEach(() => {
    api.fetch.mockReset().mockImplementation(async (endpoint: string, options?: RequestInit) => {
        if (options?.method && options.method !== "GET") throw new Error("Unexpected write");
        const url = new URL(endpoint, "https://synthetic.invalid");
        if (url.pathname.endsWith("/suggestions/summary")) return { success: true, data: counts };
        if (!url.pathname.endsWith("/suggestions")) throw new Error("Unexpected endpoint");
        const status = url.searchParams.get("status") || "pending";
        return { success: true, data: rows.filter(row => row.status === status).slice(0, 100) };
    });
});

describe.each(["es", "en", "pt", "fr"])("identity status counters in %s", locale => {
    async function renderPage(check: (container: HTMLDivElement, messages: any) => void) {
        const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../messages", locale + ".json"), "utf8"));
        expect(typeof messages.identity.loadError).toBe("string");
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        try {
            await act(async () => {
                root.render(<NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Bogota"><IdentityPage /></NextIntlClientProvider>);
            });
            await act(async () => { await Promise.resolve(); });
            check(container, messages);
            expect(api.fetch.mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
        } finally {
            act(() => root.unmount());
            container.remove();
        }
    }

    it("shows all status counts while rendering only pending suggestions, without merging", async () => {
        await renderPage((container, messages) => {
            const visibleCounts = Object.fromEntries(Object.keys(counts).map(status => {
                const label = Array.from(container.querySelectorAll("p")).find(node => node.textContent === messages.identity.stats[status]);
                return [status, label?.previousElementSibling?.textContent];
            }));
            expect(visibleCounts).toEqual({ pending: "1", approved: "2", rejected: "3" });
            expect(container.textContent).toContain("QA pending 0 A");
            expect(container.textContent).not.toMatch(/QA (approved|rejected)/);
        });
    });

    it("reports a failed read without claiming zero suggestions or an empty inbox", async () => {
        api.fetch.mockRejectedValue(new Error("synthetic read unavailable"));
        const log = jest.spyOn(console, "error").mockImplementation(() => {});
        try {
            await renderPage((container, messages) => {
                expect(container.querySelector('[role="alert"]')?.textContent).toBe(messages.identity.loadError);
                expect(container.textContent).not.toContain(messages.identity.empty.title);
                for (const status of Object.keys(counts)) {
                    const label = Array.from(container.querySelectorAll("p")).find(node => node.textContent === messages.identity.stats[status]);
                    expect(label?.previousElementSibling?.textContent).toBe("—");
                }
            });
        } finally { log.mockRestore(); }
    });
});
