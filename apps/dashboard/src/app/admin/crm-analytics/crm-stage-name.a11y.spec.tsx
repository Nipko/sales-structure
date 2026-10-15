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
// jsdom has no layout; the actual Recharts children receive fixed dimensions.
jest.mock("recharts", () => ({ ...jest.requireActual("recharts"),
    ResponsiveContainer: ({ children, height }: any) => React.cloneElement(children, { width: 600, height }),
}));
const { api } = jest.requireMock("@/lib/api") as { api: { fetch: jest.Mock } };

async function checkStage(locale: string, row: any, expected: string) {
    api.fetch.mockImplementation(async (url: string) => ({ success: true, data:
        url.endsWith("/win-loss") ? { won: 0, lost: 0, winRate: 0, totalValue: 0 } :
        url.endsWith("/funnel") ? [row] : url.endsWith("/overview") ?
        { totalLeads: 1, activeOpportunities: 1, pipelineValue: 0, avgScore: 7, conversionRate: 0 } : []
    }));
    const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../messages", `${locale}.json`), "utf8"));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
        await React.act(async () => root.render(<NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Bogota"><CrmAnalyticsPage /></NextIntlClientProvider>));
        await React.act(async () => { await Promise.resolve(); });
        const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        await interact(() => tabs[1].click());
        expect(container.querySelector('.truncate')?.textContent).toBe(expected);
        expect(container.textContent).toContain("1 (100%)");
        expect(api.fetch).toHaveBeenCalledTimes(6);
        expect(api.fetch.mock.calls.every(([url]) => url.startsWith('/crm/analytics/tenant-qa/'))).toBe(true);
    } finally { React.act(() => root.unmount()); container.remove(); }
}
beforeEach(() => api.fetch.mockReset());
it.each(["es", "en", "pt", "fr"])("keeps the configured tenant name in the funnel (%s)", async locale => {
    await checkStage(locale, { stage: "cotizacion", name: "Cotización QA · Étude", count: 1, percentage: 100 }, "Cotización QA · Étude");
});
it("makes an unnamed custom stage readable without changing counts", async () => {
    await checkStage("es", { stage: "revision_qa", name: "  ", count: 1, percentage: 100 }, "Revision qa");
});
it("localizes the legacy key when the API falls back to the stage slug", async () => {
    await checkStage("es", { stage: "listo_para_cierre", name: "listo_para_cierre", count: 1, percentage: 100 }, "Listo para cierre");
});
it("labels a missing stage without leaking null or undefined", async () => {
    await checkStage("es", { stage: null, count: 1, percentage: 100 }, "Etapa no disponible");
});
