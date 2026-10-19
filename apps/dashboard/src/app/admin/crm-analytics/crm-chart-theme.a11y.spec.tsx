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

async function checkChart(locale: string, velocity: boolean) {
    api.fetch.mockImplementation(async (url: string) => ({ success: true, data:
        url.endsWith('/overview') ? { totalLeads: 1, activeOpportunities: 1, pipelineValue: 0, avgScore: 7, conversionRate: 0 } :
        url.endsWith('/funnel') ? [{ stage: 'consulta', name: 'Consulta QA', count: 1, percentage: 100 }] :
        url.endsWith('/velocity') ? [{ stage: 'consulta', avgDays: 2, transitions: 1 }] :
        url.endsWith('/win-loss') ? { won: 0, lost: 0, winRate: 0, totalValue: 0 } : []
    }));
    const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../messages', `${locale}.json`), 'utf8'));
    const host = document.createElement('div');document.body.appendChild(host);const root = createRoot(host);
    try {
        await React.act(async () => root.render(<NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Bogota"><CrmAnalyticsPage /></NextIntlClientProvider>));
        await React.act(async () => { await Promise.resolve(); });
        if (velocity) await interact(() => host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[2].click());
        const ticks = [...host.querySelectorAll('.recharts-cartesian-axis-tick-value')];
        expect(ticks.length).toBeGreaterThan(1);
        for (const tick of ticks) expect(tick.getAttribute('fill')).toBe('hsl(var(--muted-foreground))');
        for (const grid of host.querySelectorAll('.recharts-cartesian-grid line')) expect(grid.getAttribute('stroke')).toBe('hsl(var(--border))');
        const label = messages.crmAnalytics.charts[velocity ? 'velocityRegion' : 'stageRegion'];
        expect(host.querySelector(`[role="region"][aria-label="${label}"]`)).not.toBeNull();
    } finally { React.act(() => root.unmount());host.remove(); }
}
beforeEach(() => api.fetch.mockReset());
it.each(['es','en','pt','fr'])('uses valid theme colors on stage chart axes (%s)', locale => checkChart(locale, false));
it.each(['es','en','pt','fr'])('uses valid theme colors on velocity chart axes (%s)', locale => checkChart(locale, true));
