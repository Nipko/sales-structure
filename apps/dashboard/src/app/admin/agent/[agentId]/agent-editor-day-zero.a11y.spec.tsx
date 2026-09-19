import * as fs from "fs";
import * as path from "path";
import type { AgentConfigurationWorkspace, AgentDraftBody } from "@parallext/shared";
import { findAccessibilityViolations, interact, renderScreen, type RenderedScreen } from "@/test/a11y";
import AgentEditorPage from "./page";

/**
 * The agent editor during day 0 (audit #55) and the words it uses for a save.
 *
 * On the 14-sep recording the owner opened her agent and read, stacked, a
 * quality banner — "Configuración incompleta · 1 bloqueo crítico" — and an
 * amber box saying she had not connected a channel and her agent could not
 * receive messages "…o el chat de tu web", while her agent was answering on
 * the link the setup had just given her. Two guides for one fact, and the
 * second one false. Until the agent's first real reply the channel box stays
 * (it explains why there are no channels to tick) and says the true thing;
 * the quality banner comes back once the account is live.
 *
 * The real page with the real copy; the network, tenant and session are faked.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const ES = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "..", "messages", "es.json"), "utf8"));

let mockUser: Record<string, unknown> = {};

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
  useAuth: () => ({ user: mockUser, verticalConfig: null, isVerticalConfigLoading: false }),
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

const LIVE: AgentDraftBody = {
  name: "Valentina",
  configJson: {
    persona: { name: "Valentina", role: "Asesora del spa", greeting: "¡Hola!", fallbackMessage: "Déjame consultarlo." },
    behavior: { rules: ["Responde con amabilidad"], forbiddenTopics: [], handoffTriggers: ["Pide hablar con una persona"] },
  },
  channels: [], channelBindings: [], scheduleMode: "24_7", isActive: true, isDefault: true,
};

function workspace(directCommit = true): AgentConfigurationWorkspace {
  return {
    agentId: AGENT,
    operational: { version: 2, hash: "a".repeat(64), body: LIVE },
    draft: null,
    evaluationRevisionId: null,
    directCommit,
  };
}

const HOUR = 60 * 60 * 1000;
const dayZeroOwner = () => ({
  id: "u1", role: "tenant_admin", tenantId: TENANT, onboardingStage: "agent_reviewed",
  firstReplyAt: null, tenantCreatedAt: new Date(Date.now() - HOUR).toISOString(),
});
const liveOwner = () => ({ ...dayZeroOwner(), onboardingStage: "live", firstReplyAt: new Date(Date.now() - HOUR / 2).toISOString() });

async function openEditor(state = workspace()): Promise<RenderedScreen> {
  api.getAgentConfiguration.mockImplementation(async () => ({ success: true, data: state }));
  const screen = await renderScreen(<AgentEditorPage />);
  await interact(() => {});
  return screen;
}

describe("the agent editor during day 0", () => {
  beforeEach(() => {
    for (const mock of Object.values(api)) mock.mockReset().mockImplementation(async () => ({ success: false }));
    api.listAgents.mockImplementation(async () => ({ success: true, data: [] }));
    // No channel connected: the state the owner was in on the recording.
    api.fetch.mockImplementation(async (endpoint: string) =>
      endpoint === "/channels/overview" ? { success: true, data: [] } : { success: false });
  });

  it("shows one guide about channels, and it tells the truth about the agent's link", async () => {
    mockUser = dayZeroOwner();
    const screen = await openEditor();
    try {
      // The quality passport is not even asked for.
      expect(api.getAgentQualityOverview).not.toHaveBeenCalled();
      const text = screen.container.textContent ?? "";
      expect(text).toContain(ES.agent.noConnectedChannels);
      expect(text).toContain(ES.agent.noConnectedChannelsHint);
      expect(ES.agent.noConnectedChannelsHint).toMatch(/enlace/);
      expect(text).not.toMatch(/bloqueo cr[ií]tico|no puede recibir mensajes hasta que conectes/i);
      expect(text).not.toContain(ES.agentQuality.statuses.configuration_incomplete.title);
    } finally { screen.unmount(); }
  });

  it.each([
    ["switched_off", "switchedOff"],
    ["allowance_used", "allowanceUsed"],
  ] as const)("does not send her to a link that stopped answering (%s)", async (unavailableReason, key) => {
    // F11: "Mientras tanto, cualquiera puede escribirle a tu agente desde su
    // enlace" is false once the trial link is paused.
    mockUser = dayZeroOwner();
    api.getSetupStatus.mockImplementation(async () => ({
      success: true,
      data: { demoLink: { widgetId: "w1", path: "/w/w1", agentName: "Valentina", answers: false, unavailableReason } },
    }));
    const screen = await openEditor();
    try {
      await interact(() => {});
      expect(api.getSetupStatus).toHaveBeenCalledWith(TENANT);
      const text = screen.container.textContent ?? "";
      expect(text).toContain(ES.agent.noConnectedChannels);
      expect(text).toContain(ES.agent.noConnectedChannelsHintPaused[key]);
      expect(text).not.toContain(ES.agent.noConnectedChannelsHint);
      expect(ES.agent.noConnectedChannelsHintPaused[key]).toMatch(/conecta un canal/);
      // The box it sits in, not the whole editor: the rest has its own specs.
      const box = screen.container.querySelector<HTMLElement>("#tour-target-agent-channels");
      expect(box?.textContent).toContain(ES.agent.noConnectedChannelsHintPaused[key]);
      expect(await findAccessibilityViolations(box!)).toEqual([]);
    } finally { screen.unmount(); }
  });

  it("keeps its help strip out during day 0, like the wizard, and brings it back once live", async () => {
    // The folded "Editor del agente" strip was one more voice over the
    // guided setup; during day 0 the way to ask is "Dime qué cambiar".
    for (const [owner, shown] of [[dayZeroOwner(), false], [liveOwner(), true]] as const) {
      mockUser = owner;
      const screen = await openEditor();
      try {
        expect(Boolean(screen.container.querySelector("#tour-target-help-panel"))).toBe(shown);
        expect((screen.container.textContent ?? "").includes(ES.help.agentEditor.title)).toBe(shown);
      } finally { screen.unmount(); }
    }
  });

  it("brings the quality banner back once the agent has answered a real customer", async () => {
    mockUser = liveOwner();
    const screen = await openEditor();
    try {
      expect(api.getAgentQualityOverview).toHaveBeenCalledWith(TENANT, AGENT);
    } finally { screen.unmount(); }
  });

  it("offers \"Dime qué cambiar\" as a quiet field, in day 0 and after", async () => {
    for (const owner of [dayZeroOwner(), liveOwner()]) {
      mockUser = owner;
      const screen = await openEditor();
      try {
        const form = screen.container.querySelector<HTMLFormElement>("form[data-ask-assist-change]");
        expect(form).toBeTruthy();
        expect(form!.textContent).toContain(ES.agent.askAssist.label);
        expect(await findAccessibilityViolations(form!)).toEqual([]);
      } finally { screen.unmount(); }
    }
  });

  it("does not offer it to a role that cannot edit the agent", async () => {
    mockUser = { ...liveOwner(), role: "tenant_supervisor" };
    const screen = await openEditor();
    try {
      expect(screen.container.querySelector("form[data-ask-assist-change]")).toBeNull();
    } finally { screen.unmount(); }
  });

  it("says a tool change applies on Save in immediate mode, and on publication only in reviewed mode", async () => {
    mockUser = dayZeroOwner();
    for (const [directCommit, expected, refused] of [
      [true, ES.agentToolNavigation.editorScope, /publica/i],
      [false, ES.agentToolNavigation.editorScopeReviewed, /en cuanto guardas/i],
    ] as const) {
      const screen = await openEditor(workspace(directCommit));
      try {
        const tab = screen.container.querySelector<HTMLElement>('[data-tab-id="tools"]');
        expect(tab).toBeTruthy();
        await interact(() => tab!.click());
        const text = screen.container.textContent ?? "";
        expect(text).toContain(expected);
        expect(expected).not.toMatch(refused);
      } finally { screen.unmount(); }
    }
  });
});
