import type { AgentConfigurationWorkspace, AgentDraftBody } from "@parallext/shared";
import { findAccessibilityViolations, interact, renderScreen, type RenderedScreen } from "@/test/a11y";
import AgentEditorPage from "./page";

/**
 * D3 — drafts left from before the deploy that made every save immediate.
 *
 * The owner who saved changes under the old reviewed flow opens her agent
 * after the switch. The editor must show her what is LIVE, tell her in one line
 * that old changes exist, and let her apply or discard them; when those
 * changes can no longer be applied, Save must not be off without a reason.
 *
 * The real page runs here with the real copy. Only the network, the tenant and
 * the session are faked, and every API method the page does not care about
 * answers "unavailable" so nothing here depends on it succeeding.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const DRAFT_ID = "33333333-3333-4333-8333-333333333333";
const SAVED_ID = "44444444-4444-4444-8444-444444444444";
const LIVE_HASH = "a".repeat(64);
const OLD_HASH = "b".repeat(64);

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

// Browser APIs the editor uses and jsdom does not implement; both are real
// implementations from Node, never stand-ins for application behaviour.
if (typeof globalThis.structuredClone !== "function") {
  const v8 = require("v8") as typeof import("v8");
  (globalThis as any).structuredClone = (value: unknown) => v8.deserialize(v8.serialize(value));
}
if (typeof globalThis.crypto?.randomUUID !== "function") {
  const { randomUUID } = require("crypto") as typeof import("crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: { ...globalThis.crypto, randomUUID } });
}

function body(name: string, extra: Partial<AgentDraftBody> = {}): AgentDraftBody {
  return {
    name,
    configJson: {
      persona: { name, role: "Asesora de la tienda", greeting: "¡Hola!", fallbackMessage: "Déjame consultarlo y te aviso." },
      behavior: { rules: ["Responde con amabilidad"], forbiddenTopics: [], handoffTriggers: ["Pide hablar con una persona"] },
    },
    channels: [],
    channelBindings: [],
    scheduleMode: "24_7",
    isActive: true,
    isDefault: true,
    ...extra,
  };
}

const LIVE = body("Sofía");
const OLD_CHANGES = body("Sofía Nueva");

function workspace({ draft = OLD_CHANGES as AgentDraftBody | null, currentBase = true, directCommit = true,
  live = LIVE, version = 4 } = {}): AgentConfigurationWorkspace {
  return {
    agentId: AGENT,
    operational: { version, hash: LIVE_HASH, body: live },
    draft: draft && {
      id: DRAFT_ID,
      baseOperationalVersion: currentBase ? version : version - 1,
      baseOperationalHash: currentBase ? LIVE_HASH : OLD_HASH,
      bodyHash: "c".repeat(64),
      body: draft,
      createdAt: "2026-09-10T10:00:00.000Z",
      currentBase,
    },
    evaluationRevisionId: draft && currentBase ? DRAFT_ID : null,
    directCommit,
  };
}

/** What the API answers after an immediate save: the commit cleared the draft pointer. */
function committed(saved: AgentDraftBody) {
  return {
    success: true,
    data: {
      savedRevision: { id: SAVED_ID, baseOperationalVersion: 4, baseOperationalHash: LIVE_HASH, bodyHash: "d".repeat(64),
        body: saved, createdAt: "2026-09-17T10:00:00.000Z", currentBase: true },
      idempotentReplay: false,
      workspace: workspace({ draft: null, live: saved, version: 5 }),
    },
  };
}

async function openEditor(state: AgentConfigurationWorkspace): Promise<RenderedScreen> {
  api.getAgentConfiguration.mockImplementation(async () => ({ success: true, data: state }));
  return renderScreen(<AgentEditorPage />);
}

const notice = (screen: RenderedScreen) => screen.container.querySelector<HTMLElement>("[data-pending-agent-changes]");
const button = (root: HTMLElement, name: string) =>
  Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(element => element.textContent?.trim() === name);
const saveButtons = (screen: RenderedScreen) =>
  Array.from(screen.container.querySelectorAll<HTMLButtonElement>("button"))
    .filter(element => ["Guardar", "Guardar borrador"].includes(element.textContent?.trim() ?? ""));
const nameShown = (screen: RenderedScreen) =>
  screen.container.querySelector<HTMLInputElement>("#tour-target-agent-name input")!.value;
const testLink = (screen: RenderedScreen) =>
  Array.from(screen.container.querySelectorAll<HTMLAnchorElement>("a")).find(link => link.textContent?.includes("Probar agente"))!;

describe("the agent editor with changes saved before immediate save", () => {
  beforeEach(() => {
    for (const mock of Object.values(api)) mock.mockReset().mockImplementation(async () => ({ success: false }));
    api.listAgents.mockImplementation(async () => ({ success: true, data: [] }));
    api.fetch.mockImplementation(async (endpoint: string) =>
      endpoint === "/channels/overview" ? { success: true, data: [] } : { success: false });
  });

  it("shows what is live, with one line offering to apply or discard the old changes", async () => {
    const screen = await openEditor(workspace());
    try {
      const line = notice(screen)!;
      expect(line).toBeTruthy();
      expect(line.dataset.pendingAgentChanges).toBe("pending");
      expect(line.textContent).toContain("Tienes cambios de antes que todavía no se aplicaron");
      expect(button(line, "Aplicar esos cambios")).toBeTruthy();
      expect(button(line, "Descartar esos cambios")).toBeTruthy();
      // The form is the live agent, not the old changes she cannot see.
      expect(nameShown(screen)).toBe("Sofía");
      // Nothing from the reviewed flow's vocabulary on this surface.
      expect(screen.container.textContent).not.toContain("Versión operativa y borrador");
      // Saving what she sees stays possible, and testing tests what answers.
      expect(saveButtons(screen).map(element => element.disabled)).toEqual([false, false]);
      expect(testLink(screen).getAttribute("href")).toBe(`/admin/agent/${AGENT}/test`);
      expect(await findAccessibilityViolations(line)).toEqual([]);
    } finally { screen.unmount(); }
  });

  it("applies the old changes through the normal save, without switching the agent on or off", async () => {
    api.saveAgentDraft.mockImplementation(async () => committed(OLD_CHANGES));
    // The old changes remember the agent as on; it is off now. Applying them
    // must not switch it on: that is the hero switch's job.
    const screen = await openEditor(workspace({ live: { ...LIVE, isActive: false }, draft: { ...OLD_CHANGES, isActive: true } }));
    try {
      await interact(() => button(notice(screen)!, "Aplicar esos cambios")!.click());
      await interact(() => {});
      expect(api.saveAgentDraft).toHaveBeenCalledTimes(1);
      const [tenantId, agentId, request] = api.saveAgentDraft.mock.calls[0];
      expect([tenantId, agentId]).toEqual([TENANT, AGENT]);
      expect(request).toMatchObject({
        expectedOperationalVersion: 4,
        expectedDraftRevision: DRAFT_ID,
        body: { name: "Sofía Nueva", isActive: false, configJson: { persona: { name: "Sofía Nueva" } } },
      });
      // Applied: the line is gone and the form shows what is now live.
      expect(notice(screen)).toBeNull();
      expect(nameShown(screen)).toBe("Sofía Nueva");
      // A successful immediate save is not "someone else changed it".
      expect(screen.container.textContent).not.toContain("La configuración cambió desde que abriste esta página");
      expect(saveButtons(screen).map(element => element.disabled)).toEqual([false, false]);
    } finally { screen.unmount(); }
  });

  it("keeps the old changes in the form when applying stops on a missing field", async () => {
    const incomplete = body("Sofía Nueva");
    incomplete.configJson = { ...incomplete.configJson, behavior: { rules: [], forbiddenTopics: [], handoffTriggers: ["Pide hablar con una persona"] } };
    const screen = await openEditor(workspace({ draft: incomplete }));
    try {
      await interact(() => button(notice(screen)!, "Aplicar esos cambios")!.click());
      expect(api.saveAgentDraft).not.toHaveBeenCalled();
      // The editor jumps to the field that is missing, on top of the old changes.
      expect(screen.container.querySelector("h1")!.textContent).toBe("Sofía Nueva");
      expect(screen.container.textContent).toContain("Agrega al menos una regla.");
      const line = notice(screen)!;
      expect(line.textContent).toContain("Estás viendo tus cambios de antes, todavía sin aplicar");
      expect(button(line, "Guardar y aplicar")).toBeTruthy();
    } finally { screen.unmount(); }
  });

  it("discards the old changes and leaves the live agent in the form", async () => {
    api.discardAgentDraft.mockImplementation(async () => ({ success: true, data: workspace({ draft: null }) }));
    const screen = await openEditor(workspace());
    try {
      await interact(() => button(notice(screen)!, "Descartar esos cambios")!.click());
      await interact(() => {});
      expect(api.discardAgentDraft).toHaveBeenCalledTimes(1);
      const [tenantId, agentId, request] = api.discardAgentDraft.mock.calls[0];
      expect([tenantId, agentId]).toEqual([TENANT, AGENT]);
      expect(request).toEqual({
        requestKey: expect.any(String),
        expectedDraftRevision: DRAFT_ID,
        expectedOperationalVersion: 4,
        expectedOperationalHash: LIVE_HASH,
      });
      expect(notice(screen)).toBeNull();
      expect(nameShown(screen)).toBe("Sofía");
      expect(api.saveAgentDraft).not.toHaveBeenCalled();
    } finally { screen.unmount(); }
  });

  it("offers discard for old changes that can no longer be applied, and says why Save is off", async () => {
    api.discardAgentDraft.mockImplementation(async () => ({ success: true, data: workspace({ draft: null }) }));
    const screen = await openEditor(workspace({ currentBase: false }));
    try {
      const line = notice(screen)!;
      expect(line.dataset.pendingAgentChanges).toBe("stale");
      expect(line.textContent).toContain("Tienes cambios de antes que ya no se pueden aplicar");
      expect(button(line, "Aplicar esos cambios")).toBeUndefined();
      expect(button(line, "Descartar esos cambios")).toBeTruthy();
      expect(nameShown(screen)).toBe("Sofía");

      const saves = saveButtons(screen);
      expect(saves.map(element => element.disabled)).toEqual([true, true]);
      for (const save of saves) {
        const reason = document.getElementById(save.getAttribute("aria-describedby") ?? "");
        expect(reason?.textContent?.trim()).toBe("Para guardar, primero descarta los cambios de antes.");
      }

      await interact(() => button(line, "Descartar esos cambios")!.click());
      await interact(() => {});
      expect(notice(screen)).toBeNull();
      expect(saveButtons(screen).map(element => element.disabled)).toEqual([false, false]);
      expect(saveButtons(screen).every(element => !element.hasAttribute("aria-describedby"))).toBe(true);
    } finally { screen.unmount(); }
  });

  it("does not report someone else's change after an ordinary immediate save", async () => {
    api.saveAgentDraft.mockImplementation(async () => committed(LIVE));
    const screen = await openEditor(workspace({ draft: null }));
    try {
      expect(notice(screen)).toBeNull();
      await interact(() => saveButtons(screen)[1].click());
      await interact(() => {});
      expect(api.saveAgentDraft).toHaveBeenCalledTimes(1);
      expect(api.saveAgentDraft.mock.calls[0][2]).toMatchObject({ expectedDraftRevision: null, body: { name: "Sofía" } });
      expect(screen.container.textContent).not.toContain("La configuración cambió desde que abriste esta página");
      expect(saveButtons(screen).map(element => element.disabled)).toEqual([false, false]);
    } finally { screen.unmount(); }
  });

  describe("in reviewed mode, nothing changes", () => {
    it("edits the draft, with the reviewed panel and no pending-changes line", async () => {
      const screen = await openEditor(workspace({ directCommit: false }));
      try {
        expect(notice(screen)).toBeNull();
        expect(screen.container.textContent).toContain("Versión operativa y borrador");
        expect(nameShown(screen)).toBe("Sofía Nueva");
        expect(saveButtons(screen).map(element => element.textContent?.trim())).toEqual(["Guardar borrador", "Guardar borrador"]);
        expect(testLink(screen).getAttribute("href")).toBe(`/admin/agent/${AGENT}/test?configurationRevisionId=${DRAFT_ID}`);
      } finally { screen.unmount(); }
    });

    it("keeps its own explanation for a draft on an old base", async () => {
      const screen = await openEditor(workspace({ directCommit: false, currentBase: false }));
      try {
        expect(notice(screen)).toBeNull();
        expect(screen.container.textContent).toContain("La versión operativa cambió desde que se preparó este borrador.");
        expect(saveButtons(screen).map(element => element.disabled)).toEqual([true, true]);
        expect(document.getElementById("agent-save-blocked-reason")).toBeNull();
      } finally { screen.unmount(); }
    });
  });
});
