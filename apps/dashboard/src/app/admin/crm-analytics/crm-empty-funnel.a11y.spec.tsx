import * as React from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import * as fs from "node:fs";
import * as path from "node:path";
import { interact } from "@/test/a11y";
import CrmAnalyticsPage from "./page";

jest.mock("@/lib/api", () => ({ api: { fetch: jest.fn() } }));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "tenant-qa" }) }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ verticalConfig: null }) }));
jest.mock("recharts", () => ({ ...jest.requireActual("recharts"), ResponsiveContainer: ({ children, height }: any) => React.cloneElement(children, { width: 600, height }) }));
const { api } = jest.requireMock("@/lib/api") as { api: { fetch: jest.Mock } };

async function checkFunnel(locale: string, rows: any[], failed = false) {
    api.fetch.mockImplementation(async (url: string) => {
        if (failed && url.endsWith("/funnel")) throw new Error("Synthetic read failure");
        return { success: true, data: url.endsWith("/funnel") ? rows : url.endsWith("/overview") ?
            { totalLeads: rows.length, activeOpportunities: rows.length, pipelineValue: 0, avgScore: 0, conversionRate: 0 } :
            url.endsWith("/win-loss") ? { won: 0, lost: 0, winRate: 0, totalValue: 0 } : [] };
    });
    const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../messages", `${locale}.json`), "utf8"));
    const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
    try {
        await React.act(async () => root.render(<NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Bogota"><CrmAnalyticsPage /></NextIntlClientProvider>));
        await React.act(async () => { await Promise.resolve(); });
        await interact(() => host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click());
        const status = host.querySelector('[role="status"]');
        if (!failed && rows.length === 0) {
            expect(status?.textContent).toBe(messages.crmAnalytics.emptyFunnel);
            expect(host.querySelector('.truncate[title]')).toBeNull();
        } else {
            expect(status).toBeNull();
            if (!failed) expect(host.textContent).toContain("1 (100%)");
        }
        expect(api.fetch).toHaveBeenCalledTimes(6);
        expect(api.fetch.mock.calls.every(([url]) => url.startsWith("/crm/analytics/tenant-qa/"))).toBe(true);
    } finally { React.act(() => root.unmount()); host.remove(); }
}
beforeEach(() => api.fetch.mockReset());
it.each(["es", "en", "pt", "fr"])("explains a successfully loaded empty funnel (%s)", locale => checkFunnel(locale, []));
it("keeps a populated funnel without an empty message", () => checkFunnel("es", [{ stage: "pedido", name: "Pedido", count: 1, percentage: 100 }]));
it("does not present a failed read as confirmed empty data", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try { await checkFunnel("es", [], true); } finally { spy.mockRestore(); }
});
