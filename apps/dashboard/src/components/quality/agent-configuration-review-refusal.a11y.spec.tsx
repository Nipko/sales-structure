import * as fs from "fs";
import * as path from "path";
import { act } from "react";
import type { AgentConfigurationProposal } from "@parallext/shared";
import { renderScreen, interact, findAccessibilityViolations } from "@/test/a11y";
import { AgentConfigurationReview, applyErrorMessageKey } from "./AgentConfigurationReview";

/**
 * Applying an Assist change goes through the same immediate save as the
 * editor, and that save refuses to leave two active agents on one channel
 * (`agent_connection_owned_by_other_agent`): the runtime would refuse every
 * turn on it. The review showed its generic "no se pudo confirmar este cambio…
 * prepara una nueva revisión", which sends the owner to redo a change that was
 * fine. The fix is a channel on another agent, and the review has to say so.
 */

const mockApply = jest.fn();
jest.mock("@/lib/api", () => ({ api: { applyAgentConfiguration: (...args: unknown[]) => mockApply(...args) } }));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "tenant-1" }) }));
jest.mock("@/hooks/useRole", () => ({ useRole: () => ({ role: "tenant_admin" }) }));

const LOCALES = ["es", "en", "pt", "fr"] as const;
const MESSAGES = Object.fromEntries(LOCALES.map((locale) => [locale, JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "..", "messages", `${locale}.json`), "utf8"),
).agentConfiguration]));
const ES = MESSAGES.es;

const AGENT_ID = "22222222-2222-4222-8222-222222222222";
const proposal = (): AgentConfigurationProposal => ({
    id: "review", agentId: AGENT_ID, agentName: "Luna", expectedVersion: 7, digest: "a".repeat(64),
    targetScope: "agent_draft", expectedDraftRevision: null, status: "proposed",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    changes: [{ path: "persona.greeting", before: "Hola", value: "Hola, ¿en qué te ayudo?" }],
} as AgentConfigurationProposal);

async function pressApply(container: HTMLElement): Promise<void> {
    const button = container.querySelector("button") as HTMLButtonElement;
    expect(button).toBeTruthy();
    await interact(() => button.click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("Assist apply refused because another agent owns a channel", () => {
    beforeEach(() => mockApply.mockReset());

    it("says the fix is a channel on another agent, and links to this agent's channels", async () => {
        mockApply.mockResolvedValue({
            success: false, httpStatus: 409, errorCode: "agent_connection_owned_by_other_agent",
            error: "Another active agent serves this connection.",
        });
        const screen = await renderScreen(<AgentConfigurationReview proposal={proposal()} />);
        try {
            await pressApply(screen.container);

            const alert = screen.container.querySelector('[role="alert"]') as HTMLElement;
            expect(alert).toBeTruthy();
            expect(alert.textContent).toContain(ES.applyErrors.connectionOwned.replace("{agent}", "Luna"));
            // Not the generic sentence, which tells the owner to redo a change that was fine.
            expect(alert.textContent).not.toContain(ES.applyError);
            // Never the server's English fallback.
            expect(alert.textContent).not.toContain("Another active agent");
            const link = alert.querySelector("a") as HTMLAnchorElement;
            expect(link.getAttribute("href")).toBe(`/admin/agent/${AGENT_ID}?tab=persona&focus=channels`);
            expect(link.textContent).toBe(ES.applyErrors.connectionOwnedAction.replace("{agent}", "Luna"));
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });

    it("keeps the generic sentence, and no link, for any other refusal", async () => {
        mockApply.mockResolvedValue({ success: false, httpStatus: 409, errorCode: "configuration_proposal_source_changed" });
        const screen = await renderScreen(<AgentConfigurationReview proposal={proposal()} />);
        try {
            await pressApply(screen.container);

            const alert = screen.container.querySelector('[role="alert"]') as HTMLElement;
            expect(alert.textContent).toContain(ES.applyError);
            expect(alert.querySelector("a")).toBeNull();
        } finally {
            screen.unmount();
        }
    });

    it("maps only that code, and every language carries both sentences with the agent's name", () => {
        expect(applyErrorMessageKey("agent_connection_owned_by_other_agent")).toBe("applyErrors.connectionOwned");
        for (const code of [undefined, null, "", "configuration_proposal_source_changed", "agent_invalid"]) {
            expect(applyErrorMessageKey(code)).toBe("applyError");
        }
        for (const locale of LOCALES) {
            expect(MESSAGES[locale].applyErrors.connectionOwned).toContain("{agent}");
            expect(MESSAGES[locale].applyErrors.connectionOwnedAction).toContain("{agent}");
        }
    });
});
