import { renderScreen, findAccessibilityViolations } from "@/test/a11y";
import { api } from "@/lib/api";
import AgentListPage from "./page";

/**
 * The agents list during day 0 carries at most the setup nudge.
 *
 * The audit counted five things on this screen for an owner whose agent had
 * not answered anybody: the help strip, "Cómo se aplican los cambios del
 * agente", the setup banner, the trial notice and the mascot. The last two are
 * the layout's and already stay quiet in day 0 (`day-zero-gates.a11y.spec`).
 * What is pinned here is the page's own half: during day 0 the help strip and
 * the review-mode card are not drawn — the card is not even mounted, so it
 * does not read its mode — and the nudge that stays reads as a guide, not as a
 * warning. Both come back with the first real reply.
 */

let mockUser: Record<string, unknown> | null = null;
const mockVertical = { industry: "otro" };

jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser, verticalConfig: mockVertical }) }));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "tenant-1" }) }));
jest.mock("@/hooks/useRole", () => ({ useRole: () => ({ role: "tenant_admin", isSuperAdmin: false, impersonating: false }) }));
jest.mock("@/lib/api", () => ({
    api: {
        listAgents: jest.fn(),
        getPlanFeatures: jest.fn(),
        fetch: jest.fn(),
        getAgentReviewMode: jest.fn(),
        setAgentReviewMode: jest.fn(),
    },
}));

const CREATED = "2026-09-17T14:00:00.000Z";

function owner(firstReplyAt: string | null): Record<string, unknown> {
    return {
        id: "user-1",
        role: "tenant_admin",
        tenantId: "tenant-1",
        onboardingStage: "completed",
        firstReplyAt,
        tenantCreatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    // The template agent nobody has opened yet: created and updated together.
    jest.mocked(api.listAgents).mockResolvedValue({
        success: true,
        data: [{
            id: "agent-1", name: "Sofía", is_active: true, is_default: true, version: 1, channels: [],
            config_json: {}, created_at: CREATED, updated_at: CREATED,
        }],
    } as any);
    jest.mocked(api.getPlanFeatures).mockResolvedValue({ success: true, data: { maxAgents: 1, templates: false, customPrompt: false } } as any);
    jest.mocked(api.fetch).mockResolvedValue({ data: [] } as any);
    jest.mocked(api.getAgentReviewMode).mockResolvedValue({ success: true, data: { mode: "immediate" } } as any);
});

describe("the agents list during day 0", () => {
    it("keeps only the setup nudge, and it reads as a guide", async () => {
        // `completed` without a reply: the wizard's last button, not a live agent.
        mockUser = owner(null);
        const screen = await renderScreen(<AgentListPage />);
        try {
            const text = screen.container.textContent ?? "";
            expect(text).not.toContain("¿Cómo gestionar tus Agentes IA?");
            expect(text).not.toContain("Cómo se aplican los cambios del agente");
            expect(api.getAgentReviewMode).not.toHaveBeenCalled();

            const nudge = screen.container.querySelector("section[aria-labelledby]");
            expect(nudge?.querySelector("h2")?.textContent).toBe("Personaliza tu agente de IA");
            // Unfinished setup is not an alarm: no amber, no warning role.
            expect(nudge?.className).not.toMatch(/amber/);
            expect(nudge?.querySelector('[role="alert"]')).toBeNull();
            expect(nudge?.querySelector("button")?.textContent).toContain("Personalizar ahora");
            // The card's menu used to be an icon with no name at all.
            expect(screen.container.querySelector('button[aria-label="Más opciones de Sofía"]')).not.toBeNull();
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });
});

describe("the agents list after the first real reply", () => {
    it("brings back the help strip and the review-mode card", async () => {
        mockUser = owner(new Date().toISOString());
        const screen = await renderScreen(<AgentListPage />);
        try {
            const text = screen.container.textContent ?? "";
            expect(text).toContain("¿Cómo gestionar tus Agentes IA?");
            expect(text).toContain("Cómo se aplican los cambios del agente");
            expect(api.getAgentReviewMode).toHaveBeenCalledWith("tenant-1");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });
});
