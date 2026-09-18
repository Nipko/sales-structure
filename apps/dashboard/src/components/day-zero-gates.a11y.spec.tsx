import { act } from "react";
import { DAY_ZERO_MAX_DAYS } from "@parallext/shared";
import { renderScreen, findAccessibilityViolations } from "@/test/a11y";
import { api } from "@/lib/api";
import TrialCountdownBanner from "./TrialCountdownBanner";
import { InstallPrompt } from "./pwa/InstallPrompt";
import type { RestrictionInfo } from "@/app/admin/layout";

/**
 * The trial notice and the install box, during day 0 and after it.
 *
 * The 14-sep recording opened with "Tu prueba gratuita termina en 14 dias" on
 * the very first screen: the layout always hands the banner a restriction
 * object that starts at `{ level: "none" }`, so the "unless restricted"
 * exception was true for everyone and the day-0 silence never applied. And
 * with the stage alone, the wizard's `completed` counted as live. What is
 * pinned here is the rule as it was meant: quiet until the agent answers
 * somebody, except for a restriction the account is really under.
 */

let mockUser: Record<string, unknown> | null = null;

jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "tenant-1" }) }));
jest.mock("@/hooks/useRole", () => ({ useRole: () => ({ isSuperAdmin: false, impersonating: false }) }));
jest.mock("@/lib/api", () => ({ api: { getBillingSubscription: jest.fn() } }));

const JUST_CREATED = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();
const PAST_THE_CAP = () => new Date(Date.now() - (DAY_ZERO_MAX_DAYS + 2) * 86_400_000).toISOString();

function owner(facts: { stage: string; firstReplyAt?: string | null; createdAt?: string }): Record<string, unknown> {
    return {
        id: "user-1",
        role: "tenant_admin",
        tenantId: "tenant-1",
        onboardingStage: facts.stage,
        firstReplyAt: facts.firstReplyAt ?? null,
        tenantCreatedAt: facts.createdAt ?? JUST_CREATED(),
    };
}

/** What the layout passes before (and after) it reads the restriction status. */
const NO_RESTRICTION: RestrictionInfo = { level: "none", daysElapsed: 0, daysRemaining: 7, status: "active" };

describe("the trial notice during day 0", () => {
    beforeEach(() => {
        localStorage.clear();
        jest.mocked(api.getBillingSubscription).mockResolvedValue({
            success: true,
            // 13.5 days → "14 días", exactly what the recording showed.
            data: { status: "trialing", trialEndsAt: new Date(Date.now() + 13.5 * 86_400_000).toISOString() },
        } as any);
    });

    it("stays quiet on a new account, although the layout always passes a restriction object", async () => {
        mockUser = owner({ stage: "agent_reviewed" });
        const screen = await renderScreen(<TrialCountdownBanner restriction={NO_RESTRICTION} />);
        try {
            expect(screen.container.textContent).toBe("");
        } finally { screen.unmount(); }
    });

    it("stays quiet after the wizard's last button, until the agent answers somebody", async () => {
        // `completed` used to count as live: "Ir al panel" lifted the silence.
        mockUser = owner({ stage: "completed", firstReplyAt: null });
        const screen = await renderScreen(<TrialCountdownBanner restriction={NO_RESTRICTION} />);
        try {
            expect(screen.container.textContent).toBe("");
        } finally { screen.unmount(); }
    });

    it("comes back with the first real reply, spelled correctly", async () => {
        mockUser = owner({ stage: "completed", firstReplyAt: new Date().toISOString() });
        const screen = await renderScreen(<TrialCountdownBanner restriction={NO_RESTRICTION} />);
        try {
            const status = screen.container.querySelector('[role="status"]');
            expect(status?.textContent).toContain("Tu prueba gratuita termina en 14 días.");
            expect(screen.container.querySelector('button[aria-label="Cerrar"]')).not.toBeNull();
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("comes back on its own when day 0 has run past its cap without a reply", async () => {
        mockUser = owner({ stage: "channel_deferred", firstReplyAt: null, createdAt: PAST_THE_CAP() });
        const screen = await renderScreen(<TrialCountdownBanner restriction={NO_RESTRICTION} />);
        try {
            expect(screen.container.textContent).toContain("termina en 14 días");
        } finally { screen.unmount(); }
    });

    it.each([
        ["warning", 1, "Tu plan venció. Tienes 1 día para elegir un plan antes de perder el acceso."],
        ["soft_lock", 3, "Tu cuenta está en modo solo lectura. Te quedan 3 días para pagar."],
    ] as const)("still shows a real %s during day 0", async (level, days, copy) => {
        mockUser = owner({ stage: "agent_reviewed" });
        const restriction: RestrictionInfo = { level, daysElapsed: 5, daysRemaining: days, status: "past_due" };
        const screen = await renderScreen(<TrialCountdownBanner restriction={restriction} />);
        try {
            const alert = screen.container.querySelector('[role="alert"]');
            expect(alert?.textContent).toContain(copy);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });
});

describe("the install box during day 0", () => {
    beforeEach(() => localStorage.clear());

    async function offerInstall(): Promise<void> {
        await act(async () => {
            const event = new Event("beforeinstallprompt");
            window.dispatchEvent(event);
        });
    }

    it("does not sit over the wizard while the agent has not answered anybody", async () => {
        mockUser = owner({ stage: "completed", firstReplyAt: null });
        const screen = await renderScreen(<InstallPrompt />);
        try {
            await offerInstall();
            expect(screen.container.textContent).toBe("");
        } finally { screen.unmount(); }
    });

    it("is offered once the agent is live, with a named close button", async () => {
        mockUser = owner({ stage: "completed", firstReplyAt: new Date().toISOString() });
        const screen = await renderScreen(<InstallPrompt />);
        try {
            await offerInstall();
            expect(screen.container.textContent).toContain("Instalar Parallly");
            expect(screen.container.querySelector('button[aria-label="Cerrar"]')).not.toBeNull();
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });
});
