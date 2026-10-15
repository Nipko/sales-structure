import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import axe from "axe-core";
import * as fs from "fs";
import * as path from "path";
import ScoringConfigPage from "./page";

jest.mock("@/lib/api", () => ({ __esModule: true, api: { getScoringConfig: jest.fn(), saveScoringConfig: jest.fn() } }));
jest.mock("@/contexts/TenantContext", () => ({ __esModule: true, useTenant: () => ({ activeTenantId: "11111111-1111-4111-8111-111111111111" }) }));
jest.mock("@/contexts/AuthContext", () => ({ __esModule: true, useAuth: () => ({ user: { id: "u1", role: "tenant_admin" }, verticalConfig: null }) }));

const { api } = jest.requireMock("@/lib/api") as { api: { getScoringConfig: jest.Mock; saveScoringConfig: jest.Mock } };
const factors = ["engagement", "intent", "recency", "stageProgress", "profileCompleteness"];

beforeEach(() => {
    api.getScoringConfig.mockReset().mockResolvedValue({ success: true, data: null });
    api.saveScoringConfig.mockReset();
});

describe.each(["es", "en", "pt", "fr"])("scoring weight names in %s", locale => {
    it("associates every factor's translated label with its slider without saving", async () => {
        const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../../messages", locale + ".json"), "utf8"));
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        try {
            await act(async () => {
                root.render(<NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Bogota"><ScoringConfigPage /></NextIntlClientProvider>);
            });
            await act(async () => { await Promise.resolve(); });
            const sliders = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="range"]'));
            expect(sliders.map(control => control.value)).toEqual(["25", "30", "20", "15", "10"]);
            // Scope axe to the tested controls: unrelated keyword remove buttons are outside this regression.
            const result = await axe.run(sliders, { runOnly: { type: "rule", values: ["label"] } });
            expect(result.violations).toEqual([]);
            expect(sliders.map(control => Array.from(control.labels || []).map(label => label.textContent?.trim()).join(" ")))
                .toEqual(factors.map(key => messages.scoringConfig[key]));
            expect(new Set(sliders.map(control => control.id)).size).toBe(5);
            expect(api.getScoringConfig).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
            expect(api.saveScoringConfig).not.toHaveBeenCalled();
        } finally {
            act(() => root.unmount());
            container.remove();
        }
    });
});
