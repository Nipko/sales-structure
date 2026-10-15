import * as React from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import * as fs from "node:fs";
import * as path from "node:path";
import { interact } from "@/test/a11y";
import AnalyticsPage from "./page";

jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { tenantId: "tenant-qa" }, verticalConfig: null }) }));
jest.mock("@/lib/api", () => ({ api: Object.fromEntries([
    "KPIs", "Volume", "ChannelAccounts", "ResponseTimes", "AIMetrics", "Heatmap",
    "Automation", "Broadcast", "Anomalies", "Cohorts", "Realtime",
].map(name => [`getDashboard${name}`, jest.fn()])) }));
jest.mock("recharts", () => ({ ...jest.requireActual("recharts"),
    ResponsiveContainer: ({ children, height }: any) => React.cloneElement(children, { width: 600, height }),
}));
const { api } = jest.requireMock("@/lib/api") as { api: Record<string, jest.Mock> };

async function checkReason(locale: string, reason: unknown, expected: string) {
    const responses: Record<string, unknown> = {
        KPIs: { kpis: [] }, Volume: { series: [] }, ChannelAccounts: { accounts: [], totals: {}, unattributed: 0 },
        ResponseTimes: { series: [] }, Heatmap: { data: [] }, Automation: {}, Broadcast: { campaigns: [] },
        Anomalies: { anomalies: [] }, Cohorts: { cohorts: [] }, Realtime: {},
        AIMetrics: { resolutionRate: 0, containmentRate: 100, totalConversations: 1, aiResolved: 0, handoffs: 0, totalCost: 0,
            modelUsage: [], handoffReasons: [{ reason, count: 1 }] },
    };
    for (const [key, fn] of Object.entries(api)) fn.mockResolvedValue({ success: true, data: responses[key.slice(12)] });
    const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../messages", locale + ".json"), "utf8"));
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    try {
        await React.act(async () => root.render(<NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC"><AnalyticsPage /></NextIntlClientProvider>));
        await React.act(async () => { await Promise.resolve(); });
        const tab = [...container.querySelectorAll("button")].find(el => el.textContent === messages.analyticsV2.aiBotTab)!;
        await interact(() => tab.click());
        const list = container.querySelector(`ul[aria-label="${messages.analyticsV2.handoffReasons}"]`);
        expect(list).not.toBeNull();
        expect(list?.querySelector("li")?.textContent).toBe(expected + "1");
        expect(list?.querySelectorAll("li")).toHaveLength(1);
        if (typeof reason === "string") expect(container.textContent).not.toContain(reason);
        expect(api.getDashboardAIMetrics).toHaveBeenCalledTimes(1);
        expect(Object.values(api).reduce((sum, fn) => sum + fn.mock.calls.length, 0)).toBe(11);
        expect(api.getDashboardAIMetrics.mock.calls[0][0]).toBe("tenant-qa");
    } finally { React.act(() => root.unmount()); container.remove(); }
}
beforeEach(() => Object.values(api).forEach(fn => fn.mockReset()));
it.each([
    ["es", "Solicitó atención humana"], ["en", "Requested a person"],
    ["pt", "Solicitou atendimento humano"], ["fr", "A demandé une assistance humaine"],
])("labels a canonical reason with the actual locale and unchanged count (%s)", async (locale, expected) => {
    await checkReason(locale, "human_request", expected);
});
it("labels custom rules without exposing the internal code or configured suffix", async () => {
    await checkReason("es", "custom_trigger:QA synthetic", "Regla personalizada");
});
it("makes an unfamiliar reason readable without leaking its raw value", async () => {
    await checkReason("es", "future_reason:synthetic-private-marker", "Otro motivo");
});
it("labels a missing reason without claiming a reason was recorded", async () => {
    await checkReason("es", null, "Sin motivo registrado");
});
