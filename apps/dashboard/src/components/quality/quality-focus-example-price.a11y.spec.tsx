import { act } from "react";
import { findAccessibilityViolations, renderScreen } from "@/test/a11y";
import { api } from "@/lib/api";
import QualityFocusBanner, { examplePriceSummary } from "./QualityFocusBanner";

/**
 * The focus bar for unconfirmed example prices counts plans too.
 *
 * `services_example_price` used to count only services. A gym whose recipe
 * seeded membership plans with example prices got "Hay 0 servicios con un
 * precio de ejemplo" on the screen it was sent to, for a warning that existed
 * because of its plans. The API now sends `examplePricePlans` beside
 * `examplePriceServices` and points the check at /admin/memberships when only
 * plans are pending; the bar has to say the same thing.
 *
 * The check then grew a second kind: a service or plan with NO amount, which
 * the agent answers as "por confirmar" (`noPriceServices`, `noPricePlans`).
 * Reading only the example halves, an owner whose only pending prices were
 * empty ones read "Hay 0 servicios con un precio de ejemplo". Each kind now
 * gets its own sentence, naming services, plans or both.
 */

const AGENT_ID = "8a9b0c1d-2e3f-4a5b-8c7d-9e0f1a2b3c4d";
let mockSignalId = "";

jest.mock("next/navigation", () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    usePathname: () => "/admin/memberships",
    useSearchParams: () => new URLSearchParams({ qa: mockSignalId, qagent: AGENT_ID }),
}));
jest.mock("@/lib/api", () => ({
    __esModule: true,
    api: { getAgentQualitySignal: jest.fn(), getAgentQualityOverview: jest.fn() },
}));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "tenant-1" }) }));
jest.mock("@/contexts/QualityHealthContext", () => ({ useQualityHealth: () => ({ snoozeSignal: jest.fn() }) }));
jest.mock("@/hooks/useRole", () => ({
    useRole: () => ({ role: "tenant_admin", isSuperAdmin: false, impersonating: false, canAccess: () => true }),
}));

function arrange(signalId: string, evidence: Record<string, number>, href: string) {
    mockSignalId = signalId;
    const agent = { id: AGENT_ID, name: "Sofía", version: 1 };
    jest.mocked(api.getAgentQualitySignal).mockResolvedValue({
        success: true,
        data: {
            id: signalId, agent, code: "fix_services_example_price", severity: "low", pillar: "preparation",
            dimension: "actions_outcomes", state: "open", href, evidenceCount: 1,
            firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), occurrenceCount: 1,
        },
    } as any);
    jest.mocked(api.getAgentQualityOverview).mockResolvedValue({
        success: true,
        data: {
            agent: { ...agent, isActive: true, updatedAt: new Date().toISOString() },
            preparation: {
                criticalBlockers: [],
                dimensions: [{ checks: [{ code: "services_example_price", status: "warning", critical: false, weight: 2, href, evidence }] }],
            },
        },
    } as any);
}

async function render() {
    const screen = await renderScreen(<QualityFocusBanner />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    return screen;
}

describe("examplePriceSummary", () => {
    it("adds services and plans and names which of the two are pending", () => {
        expect(examplePriceSummary({ examplePriceServices: 0, examplePricePlans: 3 }))
            .toEqual({ example: { count: 3, scope: "plans" }, missing: null });
        expect(examplePriceSummary({ examplePriceServices: 2, examplePricePlans: 1 }))
            .toEqual({ example: { count: 3, scope: "both" }, missing: null });
        expect(examplePriceSummary({ examplePriceServices: 4, examplePricePlans: 0 }))
            .toEqual({ example: { count: 4, scope: "services" }, missing: null });
        // An API older than the plans half still reads as services.
        expect(examplePriceSummary({ examplePriceServices: 2 }))
            .toEqual({ example: { count: 2, scope: "services" }, missing: null });
        expect(examplePriceSummary({ count: 5 })).toBeNull();
    });

    it("counts rows with no price apart, and drops the example half when it is empty", () => {
        const noPriceOnly = { examplePriceServices: 0, examplePricePlans: 0, noPriceServices: 0, noPricePlans: 2 };
        expect(examplePriceSummary(noPriceOnly)).toEqual({ example: null, missing: { count: 2, scope: "plans" } });
        expect(examplePriceSummary({ ...noPriceOnly, noPriceServices: 1, noPricePlans: 0 }))
            .toEqual({ example: null, missing: { count: 1, scope: "services" } });
        expect(examplePriceSummary({ examplePriceServices: 2, examplePricePlans: 0, noPriceServices: 1, noPricePlans: 1 }))
            .toEqual({ example: { count: 2, scope: "services" }, missing: { count: 2, scope: "both" } });
        // Only the no-price half sent is still read.
        expect(examplePriceSummary({ noPriceServices: 3 })).toEqual({ example: null, missing: { count: 3, scope: "services" } });
    });
});

describe("the focus bar for example prices", () => {
    it("tells a gym owner it is the membership plans, with both counts in the evidence", async () => {
        arrange("5f0c1f7e-2b1a-4c8e-9f3d-1a2b3c4d5e61", { examplePriceServices: 0, examplePricePlans: 3 }, "/admin/memberships");
        const screen = await render();
        try {
            const text = screen.container.textContent ?? "";
            expect(text).toContain("Hay 3 planes de membresía con un precio de ejemplo de tu rubro.");
            expect(text).toContain("Sofía no dice un precio de ejemplo hasta que lo confirmes.");
            expect(text).not.toContain("0 servicios");
            expect(text).toContain("Planes con precio de ejemplo");
            expect(text).not.toContain("Evidencia:");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("counts both when services and plans are pending", async () => {
        arrange("5f0c1f7e-2b1a-4c8e-9f3d-1a2b3c4d5e62", { examplePriceServices: 2, examplePricePlans: 1 }, "/admin/appointments");
        const screen = await render();
        try {
            expect(screen.container.textContent).toContain("Hay 3 precios de ejemplo de tu rubro entre servicios y planes.");
        } finally { screen.unmount(); }
    });

    it("keeps the services sentence when only services are pending", async () => {
        arrange("5f0c1f7e-2b1a-4c8e-9f3d-1a2b3c4d5e63", { examplePriceServices: 1, examplePricePlans: 0 }, "/admin/appointments");
        const screen = await render();
        try {
            expect(screen.container.textContent).toContain("Hay 1 servicio con un precio de ejemplo de tu rubro.");
        } finally { screen.unmount(); }
    });

    it("says the plans have no price when that is all that is pending, never \"0 servicios\"", async () => {
        arrange(
            "5f0c1f7e-2b1a-4c8e-9f3d-1a2b3c4d5e64",
            { examplePriceServices: 0, examplePricePlans: 0, noPriceServices: 0, noPricePlans: 2 },
            "/admin/memberships",
        );
        const screen = await render();
        try {
            const text = screen.container.textContent ?? "";
            expect(text).toContain("Hay 2 planes de membresía sin precio.");
            expect(text).toContain("Mientras falte el precio, Sofía le dice al cliente que está por confirmar.");
            expect(text).not.toContain("0 servicios");
            expect(text).not.toContain("precio de ejemplo de tu rubro");
            expect(text).toContain("Planes sin precio");
            // Every one of the four counts has its own label.
            expect(text).not.toContain("Evidencia:");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("says it for services with no price too", async () => {
        arrange(
            "5f0c1f7e-2b1a-4c8e-9f3d-1a2b3c4d5e65",
            { examplePriceServices: 0, examplePricePlans: 0, noPriceServices: 1, noPricePlans: 0 },
            "/admin/appointments",
        );
        const screen = await render();
        try {
            const text = screen.container.textContent ?? "";
            expect(text).toContain("Hay 1 servicio sin precio.");
            expect(text).not.toContain("precio de ejemplo de tu rubro");
        } finally { screen.unmount(); }
    });

    it("gives each kind its own sentence when example prices and missing ones are both pending", async () => {
        arrange(
            "5f0c1f7e-2b1a-4c8e-9f3d-1a2b3c4d5e66",
            { examplePriceServices: 2, examplePricePlans: 0, noPriceServices: 1, noPricePlans: 1 },
            "/admin/appointments",
        );
        const screen = await render();
        try {
            const text = screen.container.textContent ?? "";
            expect(text).toContain(
                "Hay 2 servicios con un precio de ejemplo de tu rubro. Sofía no dice un precio de ejemplo hasta que lo confirmes. "
                + "Hay 2 servicios y planes de membresía sin precio. Mientras falte el precio, Sofía le dice al cliente que está por confirmar.",
            );
            expect(text).not.toContain("Hay 4");
            expect(text).not.toContain("Evidencia:");
        } finally { screen.unmount(); }
    });
});
