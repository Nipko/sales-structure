import * as fs from "fs";
import * as path from "path";
import { act } from "react";
import type { AgentConfigurationProposal } from "@parallext/shared";
import { renderScreen, interact, findAccessibilityViolations, type RenderedScreen } from "@/test/a11y";
import { AgentConfigurationReview, proposalModeReading } from "./AgentConfigurationReview";

/**
 * D25 — the Assist review card says what applying actually does.
 *
 * In the default (immediate) mode, pressing the button on this card changes
 * the agent that is answering customers right now. The card used to say "Al
 * aplicar esta propuesta se guarda un borrador. La configuración que atiende no
 * cambia", offer "Guardar borrador", and confirm "Borrador guardado. La versión
 * operativa no cambió." — three false sentences at the one moment the owner is
 * deciding. The real card, the real copy; only the network is faked.
 */

const mockApply = jest.fn();
const mockMode = jest.fn();
jest.mock("@/lib/api", () => ({
    api: {
        applyAgentConfiguration: (...args: unknown[]) => mockApply(...args),
        getAgentReviewMode: (...args: unknown[]) => mockMode(...args),
    },
}));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "tenant-1" }) }));
let mockRole = "tenant_admin";
jest.mock("@/hooks/useRole", () => ({ useRole: () => ({ role: mockRole }) }));

const ES = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "messages", "es.json"), "utf8"));

const AGENT_ID = "22222222-2222-4222-8222-222222222222";
const proposal = (): AgentConfigurationProposal => ({
    id: "review", agentId: AGENT_ID, agentName: "Luna", expectedVersion: 7, digest: "a".repeat(64),
    targetScope: "agent_draft", expectedDraftRevision: null, status: "proposed",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    changes: [{ path: "persona.greeting", before: "Hola", value: "Hola, ¿en qué te ayudo?" }],
} as AgentConfigurationProposal);

/** What the apply returns: the proposal applied, the workspace re-read in the commit, a check that ran. */
function applied(directCommit: boolean) {
    return {
        success: true,
        data: {
            proposal: { ...proposal(), status: "applied" },
            assessment: null,
            verification: "verified",
            assessmentScope: "operational",
            draftVerification: { scope: "applied_draft", state: "verified", revisionId: null, revisionHash: null, reason: null, checkedAt: "2026-09-18T10:00:00.000Z" },
            draft: {
                idempotentReplay: false,
                savedRevision: { id: "rev" },
                workspace: { agentId: AGENT_ID, directCommit, draft: directCommit ? null : { id: "rev", bodyHash: "h" }, evaluationRevisionId: null },
            },
        },
    };
}

async function settle(): Promise<void> {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function open(mode: "immediate" | "reviewed" | null): Promise<RenderedScreen> {
    mockMode.mockResolvedValue(mode ? { success: true, data: { mode } } : { success: false });
    const screen = await renderScreen(<AgentConfigurationReview proposal={proposal()} />);
    await settle();
    return screen;
}

const applyButton = (screen: RenderedScreen) => screen.container.querySelector("button") as HTMLButtonElement;

describe("what the Assist review card says applying does", () => {
    beforeEach(() => { mockApply.mockReset(); mockMode.mockReset(); mockRole = "tenant_admin"; });

    it("says the change goes live at once in immediate mode, and confirms it the same way", async () => {
        mockApply.mockResolvedValue(applied(true));
        const screen = await open("immediate");
        try {
            expect(mockMode).toHaveBeenCalledWith("tenant-1");
            expect(screen.container.textContent).toContain(ES.agentDraft.proposalLiveReview);
            expect(applyButton(screen).textContent).toBe(ES.agentDraft.saveLive);
            expect(screen.container.textContent).not.toMatch(/borrador|versión operativa/i);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);

            await interact(() => applyButton(screen).click());
            await settle();
            const status = screen.container.querySelector('[role="status"]') as HTMLElement;
            expect(status.textContent).toBe(ES.agentDraft.savedLive);
            // The check ran against the agent that answers now, and says so.
            expect(screen.container.textContent).toContain(ES.agentConfiguration.draftCheck.live.verified);
            expect(screen.container.textContent).toContain(ES.agentConfiguration.draftCheck.live.scope);
            expect(screen.container.textContent).not.toMatch(/borrador|versión operativa/i);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });

    it("keeps the draft sentences for a tenant in reviewed mode, where they are true", async () => {
        mockApply.mockResolvedValue(applied(false));
        const screen = await open("reviewed");
        try {
            expect(screen.container.textContent).toContain(ES.agentDraft.proposalDraftReview);
            expect(applyButton(screen).textContent).toBe(ES.agentDraft.save);
            await interact(() => applyButton(screen).click());
            await settle();
            expect(screen.container.textContent).toContain(ES.agentDraft.saved);
            expect(screen.container.textContent).toContain(ES.agentConfiguration.draftCheck.verified);
        } finally {
            screen.unmount();
        }
    });

    it("promises neither when the mode cannot be read, then says what the apply reported", async () => {
        mockApply.mockResolvedValue(applied(true));
        const screen = await open(null);
        try {
            expect(screen.container.textContent).toContain(ES.agentDraft.proposalUnknownReview);
            expect(applyButton(screen).textContent).toBe(ES.agentDraft.saveUnknown);
            expect(screen.container.textContent).not.toContain(ES.agentDraft.proposalDraftReview);
            await interact(() => applyButton(screen).click());
            await settle();
            // The workspace the apply returned settles it.
            expect(screen.container.textContent).toContain(ES.agentDraft.savedLive);
        } finally {
            screen.unmount();
        }
    });

    it("does not ask for the mode for a role that cannot apply", async () => {
        mockRole = "tenant_supervisor";
        const screen = await open("immediate");
        try {
            expect(mockMode).not.toHaveBeenCalled();
            expect(screen.container.querySelector("button")).toBeNull();
            expect(screen.container.textContent).toContain(ES.agentDraft.proposalUnknownReview);
        } finally {
            screen.unmount();
        }
    });

    it("says what the card was prepared from, never a version number or a review to request", async () => {
        // "Configuración revisada: versión 7." — the version is how the apply
        // refuses a stale proposal, not something an owner can act on.
        const screen = await open("immediate");
        try {
            expect((screen.container.querySelector("[data-prepared-from]") as HTMLElement).textContent)
                .toBe(ES.agentConfiguration.preparedFrom);
            expect(screen.container.textContent).not.toMatch(/versi[oó]n|revisi[oó]n/i);
            expect(ES.agentConfiguration.version).toBeUndefined();
        } finally {
            screen.unmount();
        }
        // Expired, it says what to do in plain words too.
        const expired = await renderScreen(<AgentConfigurationReview proposal={{ ...proposal(), expiresAt: new Date(Date.now() - 1_000).toISOString() }} />);
        try {
            expect(expired.container.textContent).toContain(ES.agentConfiguration.expired);
            expect(expired.container.textContent).not.toMatch(/versi[oó]n|revisi[oó]n/i);
        } finally {
            expired.unmount();
        }
    });

    it("lets the committed workspace outrank a stale reading", () => {
        expect(proposalModeReading("reviewed", applied(true).data as never)).toBe("immediate");
        expect(proposalModeReading("immediate", applied(false).data as never)).toBe("reviewed");
        expect(proposalModeReading("unknown", null)).toBe("unknown");
    });
});
