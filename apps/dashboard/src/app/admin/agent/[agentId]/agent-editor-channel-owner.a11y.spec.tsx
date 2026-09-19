import type { AgentConfigurationWorkspace, AgentDraftBody } from "@parallext/shared";
import { interact, renderScreen, type RenderedScreen } from "@/test/a11y";
import AgentEditorPage from "./page";

/**
 * One agent per channel, in immediate mode.
 *
 * The runtime refuses a turn when two active agents claim the same channel, so
 * a save or a switch that leaves agent A and agent B both on Telegram silences
 * Telegram. The API now refuses that (`agent_connection_owned_by_other_agent`)
 * unless the save carries the move the owner was shown. This file pins the
 * editor's half:
 *
 * - the switch turns an agent back on, and when another agent took one of its
 *   channels meanwhile, it says who;
 * - Save sends exactly the moves the "Se reasignará de …" line promised, and an
 *   agent that is off promises none;
 * - "Aplicar esos cambios" (one click over changes she has not seen) promises
 *   none: a refusal names the owner and keeps her on those changes, and
 *   "Guardar y aplicar" is the Save that moves the channel.
 *
 * The real page runs with the real copy; only the network, the tenant and the
 * session are faked.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const BRUNO = "55555555-5555-4555-8555-555555555555";
const DRAFT_ID = "33333333-3333-4333-8333-333333333333";
const SAVED_ID = "44444444-4444-4444-8444-444444444444";
const LIVE_HASH = "a".repeat(64);

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

function body(extra: Partial<AgentDraftBody> = {}): AgentDraftBody {
  return {
    name: "Sofía",
    configJson: {
      persona: { name: "Sofía", role: "Asesora de la tienda", greeting: "¡Hola!", fallbackMessage: "Déjame consultarlo y te aviso." },
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

function workspace(live: AgentDraftBody, draft: AgentDraftBody | null = null, version = 4): AgentConfigurationWorkspace {
  return {
    agentId: AGENT,
    operational: { version, hash: LIVE_HASH, body: live },
    draft: draft && {
      id: DRAFT_ID, baseOperationalVersion: version, baseOperationalHash: LIVE_HASH, bodyHash: "c".repeat(64),
      body: draft, createdAt: "2026-09-10T10:00:00.000Z", currentBase: true,
    },
    evaluationRevisionId: draft ? DRAFT_ID : null,
    directCommit: true,
  };
}

function committed(saved: AgentDraftBody) {
  return {
    success: true,
    data: {
      savedRevision: { id: SAVED_ID, baseOperationalVersion: 4, baseOperationalHash: LIVE_HASH, bodyHash: "d".repeat(64),
        body: saved, createdAt: "2026-09-18T10:00:00.000Z", currentBase: true },
      idempotentReplay: false,
      workspace: workspace(saved, null, 5),
    },
  };
}

const OWNED = { success: false, errorCode: "agent_connection_owned_by_other_agent", error: "Another active agent serves this connection." };

function agents(self: AgentDraftBody, bruno: { active?: boolean; channels?: string[] } = {}) {
  return [
    { id: AGENT, name: "Sofía", is_active: self.isActive, is_default: true, channels: self.channels, channel_bindings: self.channelBindings, config_json: {} },
    { id: BRUNO, name: "Bruno", is_active: bruno.active ?? true, is_default: false, channels: bruno.channels ?? ["telegram"], channel_bindings: [], config_json: {} },
  ];
}

async function openEditor(state: AgentConfigurationWorkspace, list: unknown[]): Promise<RenderedScreen> {
  api.getAgentConfiguration.mockImplementation(async () => ({ success: true, data: state }));
  api.listAgents.mockImplementation(async () => ({ success: true, data: list }));
  return renderScreen(<AgentEditorPage />);
}

const text = (screen: RenderedScreen) => screen.container.textContent ?? "";
const button = (root: HTMLElement, name: string) =>
  Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(element => element.textContent?.trim() === name);
const saveButton = (screen: RenderedScreen) =>
  Array.from(screen.container.querySelectorAll<HTMLButtonElement>("button")).filter(element => element.textContent?.trim() === "Guardar")[1];
const notice = (screen: RenderedScreen) => screen.container.querySelector<HTMLElement>("[data-pending-agent-changes]");
const theSwitch = (screen: RenderedScreen) => screen.container.querySelector<HTMLButtonElement>('button[role="switch"]')!;

describe("the agent editor keeps one agent per channel", () => {
  beforeEach(() => {
    for (const mock of Object.values(api)) mock.mockReset().mockImplementation(async () => ({ success: false }));
    api.fetch.mockImplementation(async (endpoint: string) => endpoint === "/channels/overview"
      ? { success: true, data: [{ channelType: "telegram", accountId: "bot1", displayName: "Bot de la tienda" }] }
      : { success: false });
  });

  it("switches an agent that is off back on", async () => {
    const off = body({ isActive: false, channels: ["telegram"] });
    api.updateAgent.mockImplementation(async () => ({ success: true, data: { id: AGENT, is_active: true, version: 5 } }));
    const screen = await openEditor(workspace(off), agents(off, { channels: [] }));
    try {
      expect(theSwitch(screen).getAttribute("aria-checked")).toBe("false");
      api.getAgentConfiguration.mockImplementation(async () => ({ success: true, data: workspace({ ...off, isActive: true }, null, 5) }));
      await interact(() => theSwitch(screen).click());
      await interact(() => {});
      expect(api.updateAgent).toHaveBeenCalledWith(TENANT, AGENT, { isActive: true, expectedVersion: 4 });
      expect(theSwitch(screen).getAttribute("aria-checked")).toBe("true");
      expect(text(screen)).toContain("Agente activado: ya está respondiendo.");
    } finally { screen.unmount(); }
  });

  it("says which agent took its channel when switching it on is refused", async () => {
    const off = body({ isActive: false, channels: ["telegram"] });
    api.updateAgent.mockImplementation(async () => OWNED);
    // The page loaded before Bruno took Telegram; the refusal re-reads the list.
    const screen = await openEditor(workspace(off), agents(off, { channels: [] }));
    try {
      api.listAgents.mockImplementation(async () => ({ success: true, data: agents(off) }));
      await interact(() => theSwitch(screen).click());
      await interact(() => {});
      expect(text(screen)).toContain("No se activó: Bruno ya atiende uno de sus canales, y cada canal lo atiende un solo agente.");
      expect(theSwitch(screen).getAttribute("aria-checked")).toBe("false");
    } finally { screen.unmount(); }
  });

  it("sends with Save exactly the move the line under the channels promised", async () => {
    const live = body({ channels: ["telegram"] });
    api.saveAgentDraft.mockImplementation(async () => committed(live));
    const screen = await openEditor(workspace(live), agents(live));
    try {
      expect(text(screen)).toContain("Se reasignará de Bruno");
      // After the commit Bruno no longer holds it.
      api.listAgents.mockImplementation(async () => ({ success: true, data: agents(live, { channels: [] }) }));
      await interact(() => saveButton(screen).click());
      await interact(() => {});
      expect(api.saveAgentDraft).toHaveBeenCalledTimes(1);
      expect(api.saveAgentDraft.mock.calls[0][2]).toMatchObject({ body: { channels: ["telegram"] }, reassignConnections: ["telegram"] });
      // The list is read again, so the line stops promising a move that happened.
      expect(text(screen)).not.toContain("Se reasignará de");
    } finally { screen.unmount(); }
  });

  it("promises no move for an agent that is off, because nobody would answer that channel", async () => {
    const off = body({ isActive: false, channels: ["telegram"] });
    api.saveAgentDraft.mockImplementation(async () => committed(off));
    const screen = await openEditor(workspace(off), agents(off));
    try {
      expect(text(screen)).not.toContain("Se reasignará de");
      await interact(() => saveButton(screen).click());
      await interact(() => {});
      expect(api.saveAgentDraft).toHaveBeenCalledTimes(1);
      expect(api.saveAgentDraft.mock.calls[0][2]).not.toHaveProperty("reassignConnections");
    } finally { screen.unmount(); }
  });

  it("applies old changes without promising a move, then moves the channel once she saves them as shown", async () => {
    const live = body();
    const old = body({ name: "Sofía Nueva", channels: ["telegram"],
      configJson: { ...body().configJson, persona: { ...body().configJson.persona, name: "Sofía Nueva" } } });
    api.saveAgentDraft.mockImplementationOnce(async () => OWNED).mockImplementationOnce(async () => committed(old));
    const screen = await openEditor(workspace(live, old), agents(live));
    try {
      await interact(() => button(notice(screen)!, "Aplicar esos cambios")!.click());
      await interact(() => {});
      expect(api.saveAgentDraft).toHaveBeenCalledTimes(1);
      const first = api.saveAgentDraft.mock.calls[0][2];
      expect(first).toMatchObject({ expectedDraftRevision: DRAFT_ID, body: { channels: ["telegram"] } });
      expect(first).not.toHaveProperty("reassignConnections");
      // Refused and named; she stays on the old changes, and the line says what Save will do.
      expect(text(screen)).toContain("Bruno ya atiende un canal que le diste a este agente");
      expect(notice(screen)!.textContent).toContain("Estás viendo tus cambios de antes, todavía sin aplicar");
      expect(text(screen)).toContain("Se reasignará de Bruno");

      await interact(() => button(notice(screen)!, "Guardar y aplicar")!.click());
      await interact(() => {});
      expect(api.saveAgentDraft).toHaveBeenCalledTimes(2);
      const second = api.saveAgentDraft.mock.calls[1][2];
      expect(second).toMatchObject({ body: { channels: ["telegram"] }, reassignConnections: ["telegram"] });
      // The same command, now carrying the move she saw: nothing was saved the first time.
      expect(second.requestKey).toBe(first.requestKey);
      expect(notice(screen)).toBeNull();
    } finally { screen.unmount(); }
  });
});
