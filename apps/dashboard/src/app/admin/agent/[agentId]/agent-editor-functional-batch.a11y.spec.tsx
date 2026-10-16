import * as fs from "fs";
import * as path from "path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import type { AgentConfigurationWorkspace, AgentDraftBody, SaveAgentDraftRequest, SavedAgentDraft } from "@parallext/shared";
import { interact, type RenderedScreen } from "@/test/a11y";
import AgentEditorPage from "./page";

/**
 * Local functional batch: the real editor, real locale messages and synthetic
 * API contracts. No network, database, model or protected agent is involved.
 * These cases cover edits made during a save, leaving through this agent's
 * child route, and the supervisor's read-only boundary. Navigation assertions
 * concern the editor's click guard, not a real browser/router transition.
 */
const TENANT = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const REVISION = "33333333-3333-4333-8333-333333333333";
const LOCALES = ["es", "en", "pt", "fr"] as const;
type Locale = typeof LOCALES[number];
const MESSAGES = Object.fromEntries(LOCALES.map(locale => [locale,
  JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../../messages", `${locale}.json`), "utf8")),
])) as Record<Locale, any>;

let mockRole = "tenant_admin";
const mockUnexpectedCalls: string[] = [];

jest.mock("@/lib/api", () => {
  const methods: Record<string, jest.Mock> = {};
  return { __esModule: true, api: new Proxy(methods, {
    get: (target, key) => {
      if (typeof key !== "string") return undefined;
      target[key] ??= jest.fn(async () => {
        mockUnexpectedCalls.push(key);
        throw new Error(`Unexpected API mock call: ${key}`);
      });
      return target[key];
    },
  }) };
});
jest.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ activeTenantId: "11111111-1111-4111-8111-111111111111" }),
}));
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "44444444-4444-4444-8444-444444444444", role: mockRole, tenantId: "11111111-1111-4111-8111-111111111111" },
    verticalConfig: null,
    isVerticalConfigLoading: false,
  }),
}));
jest.mock("next/navigation", () => ({
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

function liveBody(): AgentDraftBody {
  return {
    name: "Agent QA Initial",
    configJson: {
      persona: { name: "Agent QA Initial", role: "Synthetic support assistant", greeting: "Hello QA", fallbackMessage: "No confirmed information." },
      behavior: { rules: ["Use confirmed facts."], forbiddenTopics: [], handoffTriggers: ["A person is requested."] },
      llm: { temperature: 0.6, maxTokens: 700, routing: { synthetic: "preserve" }, memory: { shortTerm: 9, longTerm: false, summaryAfter: 12 } },
    },
    channels: ["telegram"], channelBindings: [], scheduleMode: "24_7", isActive: true, isDefault: true,
  };
}

function workspace(body = liveBody(), version = 7): AgentConfigurationWorkspace {
  return {
    agentId: AGENT, operational: { version, hash: "a".repeat(64), body },
    draft: null, evaluationRevisionId: null, directCommit: true,
  };
}

function committed(request: SaveAgentDraftRequest): { success: true; data: SavedAgentDraft } {
  const body = structuredClone(request.body);
  return { success: true, data: {
    savedRevision: {
      id: REVISION, baseOperationalVersion: request.expectedOperationalVersion,
      baseOperationalHash: "a".repeat(64), bodyHash: "b".repeat(64), body,
      createdAt: "2026-10-16T00:00:00.000Z", currentBase: true,
    },
    idempotentReplay: false,
    workspace: workspace(body, request.expectedOperationalVersion + 1),
  } };
}

function unexpected(method: string): never {
  mockUnexpectedCalls.push(method);
  throw new Error(`Unexpected API mock call: ${method}`);
}

/** Failing unknown calls is also asserted after each case, even if a component catches them. */
function configureApi() {
  for (const [method, mock] of Object.entries(api)) mock.mockReset().mockImplementation(() => unexpected(method));
  api.getAgentConfiguration.mockImplementation(async (tenantId, agentId) => {
    expect([tenantId, agentId]).toEqual([TENANT, AGENT]);
    return { success: true, data: workspace() };
  });
  api.listAgents.mockImplementation(async tenantId => {
    expect(tenantId).toBe(TENANT);
    const body = liveBody();
    return { success: true, data: [{ id: AGENT, name: body.name, is_active: true, is_default: true,
      config_json: body.configJson, channels: body.channels, channel_bindings: [] }] };
  });
  api.fetch.mockImplementation(async endpoint => endpoint === "/channels/overview"
    ? { success: true, data: [{ channelType: "telegram", accountId: "qa-bot", displayName: "Synthetic QA connection" }] }
    : unexpected(`fetch:${endpoint}`));
  for (const method of ["getServices", "getAvailability"]) {
    api[method].mockImplementation(async tenantId => {
      expect(tenantId).toBe(TENANT);
      return { success: true, data: [] };
    });
  }
  // An unavailable quality read is a legitimate envelope, not a healthy result.
  api.getAgentQualityOverview.mockImplementation(async (tenantId, agentId) => {
    expect([tenantId, agentId]).toEqual([TENANT, AGENT]);
    return { success: false, error: "Synthetic quality data unavailable" };
  });
  api.saveAgentDraft.mockImplementation(async (tenantId, agentId, request: SaveAgentDraftRequest) => {
    expect([tenantId, agentId]).toEqual([TENANT, AGENT]);
    // apiPut returns a normalized failure envelope for the real 403 contract.
    return mockRole === "tenant_admin" ? committed(request)
      : { success: false, errorCode: "agent_configuration_admin_required", error: "Forbidden" };
  });
}

async function openEditor(locale: Locale): Promise<RenderedScreen> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="America/Bogota">
    <AgentEditorPage />
  </NextIntlClientProvider>));
  await interact(() => {});
  return { container, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

function nameInput(screen: RenderedScreen): HTMLInputElement {
  const input = screen.container.querySelector<HTMLInputElement>("#tour-target-agent-name input");
  if (!input) throw new Error("Synthetic editor did not load the name field");
  return input;
}
function typeName(screen: RenderedScreen, value: string) {
  const input = nameInput(screen);
  if (input.disabled || input.readOnly) throw new Error("Cannot type into a disabled or read-only field");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function saves(screen: RenderedScreen, locale: Locale): HTMLButtonElement[] {
  return Array.from(screen.container.querySelectorAll<HTMLButtonElement>("button"))
    .filter(button => button.textContent?.trim() === MESSAGES[locale].common.save);
}
function unloadIsPrevented(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function testLink(screen: RenderedScreen): HTMLAnchorElement {
  const link = screen.container.querySelector<HTMLAnchorElement>(`a[href="/admin/agent/${AGENT}/test"]`);
  if (!link) throw new Error("Synthetic editor did not expose its test link");
  return link;
}
function clickLinkWithoutNavigation(link: HTMLAnchorElement) {
  let reachedTarget = false, preventedBeforeSuppression = false;
  const suppressBrowserNavigation = (event: MouseEvent) => {
    reachedTarget = true;
    preventedBeforeSuppression = event.defaultPrevented;
    event.preventDefault(); // jsdom must not attempt navigation after the guard was observed.
  };
  link.addEventListener("click", suppressBrowserNavigation, { once: true });
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  link.dispatchEvent(event);
  link.removeEventListener("click", suppressBrowserNavigation);
  return { reachedTarget, preventedBeforeSuppression, prevented: event.defaultPrevented };
}

describe.each(LOCALES)("local agent editor functional batch (%s)", locale => {
  beforeEach(() => {
    mockRole = "tenant_admin";
    mockUnexpectedCalls.length = 0;
    // Missing translations fail preparation explicitly, rather than a product assertion.
    for (const value of [MESSAGES[locale].common.save, MESSAGES[locale].agent.unsavedLeaveConfirm,
      MESSAGES[locale].agent.askAssist.saveFirst]) expect(typeof value).toBe("string");
    configureApi();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    expect(mockUnexpectedCalls).toEqual([]);
  });

  it("product: a successful save of A cannot mark a later editable B as saved", async () => {
    let resolveSave!: (value: ReturnType<typeof committed>) => void;
    api.saveAgentDraft.mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));
    const screen = await openEditor(locale);
    try {
      await interact(() => typeName(screen, "Agent QA A"));
      expect(saves(screen, locale)).toHaveLength(2);
      await interact(() => saves(screen, locale)[0].click());
      expect(api.saveAgentDraft).toHaveBeenCalledTimes(1);
      expect(api.saveAgentDraft.mock.calls[0].slice(0, 2)).toEqual([TENANT, AGENT]);
      const request = api.saveAgentDraft.mock.calls[0][2] as SaveAgentDraftRequest;
      expect(request.body.name).toBe("Agent QA A");
      const acceptsLaterEdit = !nameInput(screen).disabled && !nameInput(screen).readOnly;
      // Freezing fields while saving is also a valid way to prevent this race.
      if (acceptsLaterEdit) await interact(() => typeName(screen, "Agent QA B"));
      await interact(() => resolveSave(committed(request)));
      expect(nameInput(screen).value).toBe(acceptsLaterEdit ? "Agent QA B" : "Agent QA A");
      expect(request.body.name).toBe("Agent QA A");
      expect(unloadIsPrevented()).toBe(acceptsLaterEdit);
      if (acceptsLaterEdit) {
        const ask = screen.container.querySelector("form[data-ask-assist-change]");
        expect(ask?.textContent).toContain(MESSAGES[locale].agent.askAssist.saveFirst);
      }
    } finally { screen.unmount(); }
  });

  it("product: cancelling departure through this agent's test subroute keeps unsaved edits", async () => {
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    const screen = await openEditor(locale);
    try {
      await interact(() => typeName(screen, "Agent QA Unsaved"));
      let click!: ReturnType<typeof clickLinkWithoutNavigation>;
      await interact(() => { click = clickLinkWithoutNavigation(testLink(screen)); });
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm).toHaveBeenCalledWith(MESSAGES[locale].agent.unsavedLeaveConfirm);
      expect(click).toMatchObject({ reachedTarget: false, prevented: true });
      expect(nameInput(screen).value).toBe("Agent QA Unsaved");
      expect(unloadIsPrevented()).toBe(true);
      expect(api.saveAgentDraft).not.toHaveBeenCalled();
    } finally { screen.unmount(); }
  });

  it("product: the supervisor has no actionable Save and cannot send a write command", async () => {
    mockRole = "tenant_supervisor";
    const screen = await openEditor(locale);
    try {
      const saveControls = saves(screen, locale);
      const actionableSaves = saveControls.filter(button => !button.disabled).length;
      await interact(() => saveControls.forEach(button => button.click()));
      expect({ actionableSaves, writeCommands: api.saveAgentDraft.mock.calls.length })
        .toEqual({ actionableSaves: 0, writeCommands: 0 });
      expect(screen.container.querySelector("form[data-ask-assist-change]")).toBeNull();
    } finally { screen.unmount(); }
  });

  it("control: an ordinary completed save cleans the guard and sends the exact edited name once", async () => {
    const screen = await openEditor(locale);
    try {
      await interact(() => typeName(screen, "Agent QA Saved"));
      expect(unloadIsPrevented()).toBe(true);
      await interact(() => saves(screen, locale)[0].click());
      expect(api.saveAgentDraft).toHaveBeenCalledTimes(1);
      const [tenantId, agentId, request] = api.saveAgentDraft.mock.calls[0];
      expect([tenantId, agentId]).toEqual([TENANT, AGENT]);
      expect(request).toMatchObject({ expectedOperationalVersion: 7, expectedDraftRevision: null,
        requestKey: expect.any(String), body: { name: "Agent QA Saved", configJson: { persona: { name: "Agent QA Saved" } }, isActive: true } });
      expect(request.body.configJson.llm).toMatchObject(liveBody().configJson.llm);
      expect(nameInput(screen).value).toBe("Agent QA Saved");
      expect(unloadIsPrevented()).toBe(false);
    } finally { screen.unmount(); }
  });

  it("control: a clean editor's test link reaches the target without asking to discard", async () => {
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    const screen = await openEditor(locale);
    try {
      let click!: ReturnType<typeof clickLinkWithoutNavigation>;
      await interact(() => { click = clickLinkWithoutNavigation(testLink(screen)); });
      expect(confirm).not.toHaveBeenCalled();
      expect(click).toMatchObject({ reachedTarget: true, preventedBeforeSuppression: false });
      expect(unloadIsPrevented()).toBe(false);
      expect(api.saveAgentDraft).not.toHaveBeenCalled();
    } finally { screen.unmount(); }
  });

  it("control: a supervisor can read the operational identity without any write or dirty state", async () => {
    mockRole = "tenant_supervisor";
    const screen = await openEditor(locale);
    try {
      expect(nameInput(screen).value).toBe("Agent QA Initial");
      expect(screen.container.querySelector("h1")?.textContent).toBe("Agent QA Initial");
      expect(api.getAgentConfiguration).toHaveBeenCalledTimes(1);
      expect(api.saveAgentDraft).not.toHaveBeenCalled();
      expect(unloadIsPrevented()).toBe(false);
    } finally { screen.unmount(); }
  });
});
