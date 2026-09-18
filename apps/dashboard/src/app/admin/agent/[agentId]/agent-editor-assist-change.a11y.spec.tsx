import * as fs from "fs";
import * as path from "path";
import type { AgentConfigurationWorkspace, AgentDraftBody } from "@parallext/shared";
import { findAccessibilityViolations, interact, renderScreen, type RenderedScreen } from "@/test/a11y";
import { QUALITY_ASSIST_EVENT } from "@/lib/quality-assistant-contract";
import { notifyAgentConfigurationApplied } from "@/lib/quality-health-events";
import AgentEditorPage from "./page";

/**
 * "Dime qué cambiar" and the editor it lives in.
 *
 * The owner wrote in the editor, then asked Assist for a change from the same
 * screen without saving. Assist changed the STORED agent; the editor raised
 * "La configuración cambió", switched Save off, and the only way out was
 * "Descartar lo que escribiste y recargar" — her edits or Assist's change,
 * pick one. Two halves close it:
 *  · while the editor has unsaved edits the field does not send, and says to
 *    save first;
 *  · when Assist applies a change and nothing is unsaved, the editor re-reads
 *    the agent where it stands and says the change is in. The amber alert is
 *    kept for the one case it is true: edits nobody saved.
 *
 * The real page with the real copy; the network, tenant and session are faked.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const SAVED_ID = "44444444-4444-4444-8444-444444444444";
const ES = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "..", "messages", "es.json"), "utf8"));

jest.mock("@/lib/api", () => {
  const methods: Record<string, jest.Mock> = {};
  const api = new Proxy(methods, {
    get: (target, key) => {
      if (typeof key !== "string") return undefined;
      target[key] ??= jest.fn(async () => ({ success: false }));
      return target[key];
    },
  });
  return { __esModule: true, api };
});
jest.mock("@/contexts/TenantContext", () => ({
  __esModule: true,
  useTenant: () => ({ activeTenantId: "11111111-1111-4111-8111-111111111111" }),
}));
jest.mock("@/contexts/AuthContext", () => ({
  __esModule: true,
  useAuth: () => ({
    user: { id: "u1", role: "tenant_admin", tenantId: "11111111-1111-4111-8111-111111111111" },
    verticalConfig: null,
    isVerticalConfigLoading: false,
  }),
}));
jest.mock("next/navigation", () => ({
  __esModule: true,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), forward: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => "/admin/agent/22222222-2222-4222-8222-222222222222",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ agentId: "22222222-2222-4222-8222-222222222222" }),
}));

const { api } = jest.requireMock("@/lib/api") as { api: Record<string, jest.Mock> };

if (typeof globalThis.structuredClone !== "function") {
  const v8 = require("v8") as typeof import("v8");
  (globalThis as any).structuredClone = (value: unknown) => v8.deserialize(v8.serialize(value));
}
if (typeof globalThis.crypto?.randomUUID !== "function") {
  const { randomUUID } = require("crypto") as typeof import("crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: { ...globalThis.crypto, randomUUID } });
}

function body(name: string, greeting = "¡Hola!"): AgentDraftBody {
  return {
    name,
    configJson: {
      persona: { name, role: "Asesora del spa", greeting, fallbackMessage: "Déjame consultarlo." },
      behavior: { rules: ["Responde con amabilidad"], forbiddenTopics: [], handoffTriggers: ["Pide hablar con una persona"] },
    },
    channels: [], channelBindings: [], scheduleMode: "24_7", isActive: true, isDefault: true,
  };
}

function workspace(live: AgentDraftBody, version = 2): AgentConfigurationWorkspace {
  return {
    agentId: AGENT,
    operational: { version, hash: String(version).repeat(64).slice(0, 64), body: live },
    draft: null,
    evaluationRevisionId: null,
    directCommit: true,
  };
}

const BEFORE = workspace(body("Valentina"));
/** What Assist left stored: the change she accepted, one version later. */
const AFTER = workspace(body("Valentina", "¡Hola! ¿Agendamos?"), 3);

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const nameInput = (screen: RenderedScreen) => screen.container.querySelector<HTMLInputElement>("#tour-target-agent-name input")!;
const askForm = (screen: RenderedScreen) => screen.container.querySelector<HTMLFormElement>("form[data-ask-assist-change]")!;
const saveButtons = (screen: RenderedScreen) =>
  Array.from(screen.container.querySelectorAll<HTMLButtonElement>("button"))
    .filter((element) => element.textContent?.trim() === ES.common.save);
const alertText = (screen: RenderedScreen) =>
  Array.from(screen.container.querySelectorAll("[role='alert']")).map((element) => element.textContent ?? "").join(" ");
const statusText = (screen: RenderedScreen) =>
  Array.from(screen.container.querySelectorAll("[role='status']")).map((element) => element.textContent ?? "").join(" ");

async function openEditor(): Promise<RenderedScreen> {
  const screen = await renderScreen(<AgentEditorPage />);
  await interact(() => {});
  return screen;
}

describe("asking Assist for a change from the agent editor", () => {
  let sent: unknown[] = [];
  const listen = (event: Event) => { sent.push((event as CustomEvent).detail); };

  beforeEach(() => {
    for (const mock of Object.values(api)) mock.mockReset().mockImplementation(async () => ({ success: false }));
    api.listAgents.mockImplementation(async () => ({ success: true, data: [] }));
    api.fetch.mockImplementation(async (endpoint: string) =>
      endpoint === "/channels/overview" ? { success: true, data: [] } : { success: false });
    api.getAgentConfiguration.mockImplementation(async () => ({ success: true, data: BEFORE }));
    sent = [];
    window.addEventListener(QUALITY_ASSIST_EVENT, listen);
  });
  afterEach(() => window.removeEventListener(QUALITY_ASSIST_EVENT, listen));

  it("does not send while she has unsaved edits, says to save first, and sends once saved", async () => {
    api.saveAgentDraft.mockImplementation(async () => ({
      success: true,
      data: {
        savedRevision: { id: SAVED_ID, baseOperationalVersion: 2, baseOperationalHash: BEFORE.operational.hash,
          bodyHash: "d".repeat(64), body: body("Valentina Ruiz"), createdAt: "2026-09-18T10:00:00.000Z", currentBase: true },
        idempotentReplay: false,
        workspace: workspace(body("Valentina Ruiz"), 3),
      },
    }));
    const screen = await openEditor();
    try {
      await interact(() => typeInto(nameInput(screen), "Valentina Ruiz"));
      const form = askForm(screen);
      const input = form.querySelector("input") as HTMLInputElement;
      const send = form.querySelector("button") as HTMLButtonElement;
      await interact(() => typeInto(input, "que salude más corto"));
      expect(send.disabled).toBe(true);
      expect(form.textContent).toContain(ES.agent.askAssist.saveFirst);
      await interact(() => form.requestSubmit());
      expect(sent).toEqual([]);

      // Save, and the same words go out.
      await interact(() => saveButtons(screen)[1].click());
      await interact(() => {});
      expect(api.saveAgentDraft).toHaveBeenCalledTimes(1);
      expect(send.disabled).toBe(false);
      expect(form.textContent).not.toContain(ES.agent.askAssist.saveFirst);
      await interact(() => send.click());
      expect(sent).toHaveLength(1);
      expect(await findAccessibilityViolations(form)).toEqual([]);
    } finally { screen.unmount(); }
  });

  it("shows Assist's change in place when nothing was unsaved, with Save still on", async () => {
    const screen = await openEditor();
    try {
      expect(api.getAgentConfiguration).toHaveBeenCalledTimes(1);
      api.getAgentConfiguration.mockImplementation(async () => ({ success: true, data: AFTER }));

      await interact(() => notifyAgentConfigurationApplied(TENANT, AGENT));
      await interact(() => {});

      // The same read the page does on load, and the form shows its result.
      expect(api.getAgentConfiguration).toHaveBeenCalledTimes(2);
      expect(api.getAgentConfiguration).toHaveBeenLastCalledWith(TENANT, AGENT);
      expect(screen.container.textContent).toContain("¡Hola! ¿Agendamos?");
      // Said, not alarmed.
      expect(statusText(screen)).toContain(ES.agent.askAssist.appliedInPlace);
      expect(alertText(screen)).not.toContain(ES.agentConfiguration.editorChanged);
      expect(screen.container.textContent).not.toContain(ES.agentConfiguration.reloadEditor);
      expect(saveButtons(screen).map((element) => element.disabled)).toEqual([false, false]);

      // The next save builds on the version Assist left, not the one opened.
      api.saveAgentDraft.mockImplementation(async () => ({ success: false }));
      await interact(() => typeInto(nameInput(screen), "Valentina R."));
      // Her next edit is newer than Assist's change: the line has said its piece.
      expect(statusText(screen)).not.toContain(ES.agent.askAssist.appliedInPlace);
      await interact(() => saveButtons(screen)[1].click());
      await interact(() => {});
      expect(api.saveAgentDraft.mock.calls[0][2]).toMatchObject({ expectedOperationalVersion: 3 });
    } finally { screen.unmount(); }
  });

  it("keeps the alert, and her edits, when Assist changed the agent under unsaved edits", async () => {
    const screen = await openEditor();
    try {
      await interact(() => typeInto(nameInput(screen), "Valentina Ruiz"));
      api.getAgentConfiguration.mockImplementation(async () => ({ success: true, data: AFTER }));

      await interact(() => notifyAgentConfigurationApplied(TENANT, AGENT));
      await interact(() => {});

      // Nothing re-read over what she wrote.
      expect(api.getAgentConfiguration).toHaveBeenCalledTimes(1);
      expect(nameInput(screen).value).toBe("Valentina Ruiz");
      expect(alertText(screen)).toContain(ES.agentConfiguration.editorChanged);
      expect(statusText(screen)).not.toContain(ES.agent.askAssist.appliedInPlace);
    } finally { screen.unmount(); }
  });

  it("does not treat a change to another agent, or another account, as this one's", async () => {
    const screen = await openEditor();
    try {
      await interact(() => notifyAgentConfigurationApplied(TENANT, "33333333-3333-4333-8333-333333333333"));
      await interact(() => notifyAgentConfigurationApplied("99999999-9999-4999-8999-999999999999", AGENT));
      await interact(() => {});
      expect(api.getAgentConfiguration).toHaveBeenCalledTimes(1);
      expect(alertText(screen)).not.toContain(ES.agentConfiguration.editorChanged);
      expect(statusText(screen)).not.toContain(ES.agent.askAssist.appliedInPlace);
    } finally { screen.unmount(); }
  });

  it("falls back to the alert when the re-read fails", async () => {
    const screen = await openEditor();
    try {
      api.getAgentConfiguration.mockImplementation(async () => ({ success: false }));
      await interact(() => notifyAgentConfigurationApplied(TENANT, AGENT));
      await interact(() => {});
      // It could not show the new state, so it says the page is behind —
      // without claiming she wrote something a reload would throw away.
      expect(alertText(screen)).toContain(ES.agent.editorBehind.text);
      expect(alertText(screen)).not.toContain(ES.agentConfiguration.editorChanged);
      const alert = screen.container.querySelector("[role='alert']") as HTMLElement;
      expect(alert.querySelector("button")?.textContent).toBe(ES.agent.editorBehind.reload);
      expect(statusText(screen)).not.toContain(ES.agent.askAssist.appliedInPlace);
    } finally { screen.unmount(); }
  });
});
