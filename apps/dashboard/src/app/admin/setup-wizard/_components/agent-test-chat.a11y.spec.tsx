import * as fs from "fs";
import * as path from "path";
import { findAccessibilityViolations, interact, renderScreen } from "@/test/a11y";
import AgentTestChat, { agentTestErrorKey, agentTestStatusKey } from "./AgentTestChat";

/**
 * "Pruébalo" — the owner's first conversation with her own agent.
 *
 * It opened under an amber strip: "Preview seguro con IA real: consume cuota y
 * no crea reservas ni otras operaciones", above "Estás probando la versión
 * operativa". A first try on a new agent is not the moment to be warned about
 * spending messages, and an owner with one agent has no versions to tell apart.
 * What stays is a quiet footnote saying what a try does not do; the quota is
 * named only when the server says it ran out; the status line speaks only when
 * there is something to say.
 */

jest.mock("@/lib/api", () => ({ __esModule: true, api: { testAgent: jest.fn(), createFaq: jest.fn() } }));
const { api } = jest.requireMock("@/lib/api") as { api: { testAgent: jest.Mock; createFaq: jest.Mock } };

const ES = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "..", "messages", "es.json"), "utf8"));
const TENANT = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";

/** Types the way a person would, past React's value tracker. */
function type(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

const status = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-agent-test-status]")!;

describe("the wizard's test chat", () => {
    beforeEach(() => {
        api.testAgent.mockReset();
        api.createFaq.mockReset();
    });

    it("opens without a quota warning or a version, and keeps one neutral footnote", async () => {
        const screen = await renderScreen(<AgentTestChat tenantId={TENANT} agentId={AGENT} />);
        try {
            const text = screen.container.textContent ?? "";
            expect(text).not.toMatch(/cuota|versi[oó]n operativa|preview/i);
            // The status line is mounted (so a later one is announced) but says nothing.
            expect(status(screen.container).textContent).toBe("");
            expect(status(screen.container).className).toBe("sr-only");
            const footnote = screen.container.querySelector<HTMLElement>("[data-agent-test-footnote]")!;
            expect(footnote.textContent).toBe("No crea reservas ni otras operaciones.");
            expect(ES.setupWizard.test.limitations).toBe("No crea reservas ni otras operaciones.");
            // A footnote, not a warning.
            expect(footnote.className).not.toMatch(/amber|red|role/);
            expect(footnote.getAttribute("role")).toBeNull();
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("says why it cannot be tried yet while her change is unsaved, in words true in both modes", async () => {
        const screen = await renderScreen(<AgentTestChat tenantId={TENANT} agentId={AGENT} blocked />);
        try {
            expect(status(screen.container).textContent).toBe(ES.setupWizard.test.saveFirst);
            expect(ES.setupWizard.test.saveFirst).not.toMatch(/borrador|versi[oó]n/i);
        } finally { screen.unmount(); }
    });

    it("keeps the draft line for reviewed mode, where the chat runs the saved draft", async () => {
        const screen = await renderScreen(<AgentTestChat tenantId={TENANT} agentId={AGENT} configurationRevisionId="rev-1" />);
        try {
            expect(status(screen.container).textContent).toBe(ES.agentDraft.testingDraft);
        } finally { screen.unmount(); }
    });

    it("names the quota only when the server says it ran out, instead of printing its code", async () => {
        api.testAgent.mockResolvedValue({ success: false, httpStatus: 429, error: "ai_message_quota_exceeded" });
        const screen = await renderScreen(<AgentTestChat tenantId={TENANT} agentId={AGENT} />);
        try {
            const input = screen.container.querySelector("input") as HTMLInputElement;
            await interact(() => type(input, "¿Qué precios manejan?"));
            const send = Array.from(screen.container.querySelectorAll("button")).find((button) => button.textContent?.includes(ES.setupWizard.test.send))!;
            await interact(() => send.click());
            const text = screen.container.textContent ?? "";
            expect(text).toContain(ES.setupWizard.test.quotaReached);
            expect(text).not.toContain("ai_message_quota_exceeded");
        } finally { screen.unmount(); }
    });

    it("offers the recipe questions as one-tap tests", async () => {
        const suggestions = ["¿Cuánto cuesta?", "¿Dónde atienden?", "¿Cómo reservo?"];
        const screen = await renderScreen(<AgentTestChat tenantId={TENANT} agentId={AGENT} suggestions={suggestions} />);
        try {
            const suggestion = Array.from(screen.container.querySelectorAll("button")).find((button) => button.textContent === suggestions[1])!;
            await interact(() => suggestion.click());
            expect((screen.container.querySelector("input") as HTMLInputElement).value).toBe(suggestions[1]);
        } finally { screen.unmount(); }
    });

    it("turns an owner's correction into a published canonical FAQ", async () => {
        api.testAgent.mockResolvedValue({ success: true, data: { reply: "Abrimos hasta las cinco.", debug: {} } });
        api.createFaq.mockResolvedValue({ success: true });
        const screen = await renderScreen(<AgentTestChat tenantId={TENANT} agentId={AGENT} />);
        try {
            const input = screen.container.querySelector("input") as HTMLInputElement;
            await interact(() => type(input, "¿Hasta qué hora abren?"));
            await interact(() => Array.from(screen.container.querySelectorAll("button")).find((button) => button.textContent?.includes(ES.setupWizard.test.send))!.click());
            const correct = Array.from(screen.container.querySelectorAll("button")).find((button) => button.textContent?.includes(ES.setupWizard.test.correctAnswer))!;
            await interact(() => correct.click());
            const textarea = screen.container.querySelector("textarea") as HTMLTextAreaElement;
            await interact(() => {
                Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Abrimos hasta las seis.");
                textarea.dispatchEvent(new Event("input", { bubbles: true }));
            });
            await interact(() => Array.from(screen.container.querySelectorAll("button")).find((button) => button.textContent?.includes(ES.setupWizard.test.saveCorrection))!.click());
            expect(api.createFaq).toHaveBeenCalledWith(TENANT, {
                question: "¿Hasta qué hora abren?",
                answer: "Abrimos hasta las seis.",
                category: "onboarding_correction",
                tags: ["onboarding"],
                isPublished: true,
            });
            expect(screen.container.textContent).toContain(ES.setupWizard.test.correctionSaved);
        } finally { screen.unmount(); }
    });

    it("maps the status and the error as pure rules", () => {
        expect(agentTestStatusKey({ agentId: AGENT })).toBeNull();
        expect(agentTestStatusKey({ agentId: null, blocked: true })).toBeNull();
        expect(agentTestStatusKey({ agentId: AGENT, blocked: true, configurationRevisionId: "rev" })).toEqual({ namespace: "setupWizard.test", key: "saveFirst" });
        expect(agentTestStatusKey({ agentId: AGENT, configurationRevisionId: "rev" })).toEqual({ namespace: "agentDraft", key: "testingDraft" });
        expect(agentTestErrorKey({ errorCode: "ai_message_quota_exceeded" })).toBe("quotaReached");
        expect(agentTestErrorKey({ error: "ai_message_quota_exceeded" })).toBe("quotaReached");
        // The per-minute limit already comes as a sentence; it keeps it.
        expect(agentTestErrorKey({ errorCode: "agent_test_rate_limit", error: "Demasiadas pruebas del agente." })).toBeNull();
        expect(agentTestErrorKey(null)).toBeNull();
    });
});
