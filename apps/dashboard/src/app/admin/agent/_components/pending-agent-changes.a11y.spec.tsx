import * as fs from "fs";
import * as path from "path";
import type { AgentConfigurationWorkspace, AgentDraftBody } from "@parallext/shared";
import { findAccessibilityViolations, interact, renderScreen } from "@/test/a11y";
import { PendingAgentChangesNotice, pendingAgentChanges, type PendingAgentChangesNoticeProps } from "./PendingAgentChangesNotice";

/**
 * D3 — changes saved before the switch to immediate save.
 *
 * The line has to say, in the owner's words, that old changes exist and what
 * she can do about them. The copy is the real `es.json`, so a missing key or a
 * word of jargon shows up here rather than on her screen.
 */

const auth = { user: { role: "tenant_admin" } as { role: string }, verticalConfig: null, isVerticalConfigLoading: false };
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

const LIVE_HASH = "a".repeat(64);

function body(name: string, extra: Partial<AgentDraftBody> = {}): AgentDraftBody {
  return {
    name,
    configJson: { persona: { name, role: "Asesora" }, behavior: { rules: ["Saluda"] } },
    channels: ["whatsapp"],
    channelBindings: [],
    scheduleMode: "24_7",
    isActive: true,
    isDefault: true,
    ...extra,
  };
}

function workspace(draft: AgentDraftBody | null, { currentBase = true, directCommit = true } = {}): AgentConfigurationWorkspace {
  return {
    agentId: "22222222-2222-4222-8222-222222222222",
    operational: { version: 4, hash: LIVE_HASH, body: body("Sofía") },
    draft: draft && {
      id: "33333333-3333-4333-8333-333333333333",
      baseOperationalVersion: currentBase ? 4 : 3,
      baseOperationalHash: currentBase ? LIVE_HASH : "b".repeat(64),
      bodyHash: "c".repeat(64),
      body: draft,
      createdAt: "2026-09-10T10:00:00.000Z",
      currentBase,
    },
    evaluationRevisionId: null,
    directCommit,
  };
}

describe("which old changes the editor has to talk about", () => {
  it("says nothing in reviewed mode: that mode has its own panel", () => {
    expect(pendingAgentChanges(workspace(body("Sofía Nueva"), { directCommit: false }))).toBe("none");
    expect(pendingAgentChanges(workspace(body("Sofía Nueva"), { directCommit: false, currentBase: false }))).toBe("none");
  });

  it("says nothing without a draft, or before the workspace loaded", () => {
    expect(pendingAgentChanges(workspace(null))).toBe("none");
    expect(pendingAgentChanges(null)).toBe("none");
  });

  it("calls a draft on the current base that differs from what is live pending", () => {
    expect(pendingAgentChanges(workspace(body("Sofía Nueva")))).toBe("pending");
  });

  it("calls a draft whose base moved stale, even when it says what is live: the server refuses every save over it", () => {
    expect(pendingAgentChanges(workspace(body("Sofía Nueva"), { currentBase: false }))).toBe("stale");
    expect(pendingAgentChanges(workspace(body("Sofía"), { currentBase: false }))).toBe("stale");
  });

  it("does not call a draft that would leave the agent the same a change", () => {
    const reordered: AgentDraftBody = {
      // Same content, other key order — what a jsonb round trip does.
      isDefault: false,
      scheduleMode: "24/7",
      channelBindings: [],
      channels: ["whatsapp"],
      isActive: true,
      configJson: { behavior: { rules: ["Saluda"] }, persona: { role: "Asesora", name: "Sofía" } },
      name: "Sofía",
    };
    expect(pendingAgentChanges(workspace(reordered))).toBe("none");
  });
});

function Notice(overrides: Partial<PendingAgentChangesNoticeProps> = {}) {
  return (
    <PendingAgentChangesNotice
      state="pending"
      view="live"
      busy={null}
      discardFailed={false}
      onApply={() => {}}
      onDiscard={() => {}}
      {...overrides}
    />
  );
}

const buttons = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).map(button => button.textContent?.trim());

describe("the pending-changes line", () => {
  beforeEach(() => { auth.user = { role: "tenant_admin" }; });

  it("offers apply and discard for old changes that were never applied", async () => {
    const onApply = jest.fn(), onDiscard = jest.fn();
    const screen = await renderScreen(<Notice onApply={onApply} onDiscard={onDiscard} />);
    try {
      const section = screen.container.querySelector("section")!;
      expect(section.getAttribute("aria-labelledby")).toBeTruthy();
      expect(screen.container.querySelector("h2")!.textContent).toBe("Tienes cambios de antes que todavía no se aplicaron");
      expect(screen.container.textContent).toContain("Abajo ves lo que tu agente usa hoy.");
      expect(buttons(screen.container)).toEqual(["Aplicar esos cambios", "Descartar esos cambios"]);
      const [apply, discard] = Array.from(screen.container.querySelectorAll("button"));
      await interact(() => apply.click());
      await interact(() => discard.click());
      expect(onApply).toHaveBeenCalledTimes(1);
      expect(onDiscard).toHaveBeenCalledTimes(1);
      expect(await findAccessibilityViolations(screen.container)).toEqual([]);
    } finally { screen.unmount(); }
  });

  it("turns apply into save once the owner is looking at the old changes", async () => {
    const screen = await renderScreen(<Notice view="draft" />);
    try {
      expect(screen.container.querySelector("h2")!.textContent).toBe("Estás viendo tus cambios de antes, todavía sin aplicar");
      expect(buttons(screen.container)).toEqual(["Guardar y aplicar", "Descartar esos cambios"]);
    } finally { screen.unmount(); }
  });

  it("offers only discard for old changes that can no longer be applied, and says why", async () => {
    const screen = await renderScreen(<Notice state="stale" />);
    try {
      expect(screen.container.querySelector("h2")!.textContent).toBe("Tienes cambios de antes que ya no se pueden aplicar");
      expect(screen.container.textContent).toContain("Tu agente cambió después de que los guardaste");
      expect(screen.container.textContent).toContain("Descártalos para poder guardar de nuevo");
      expect(buttons(screen.container)).toEqual(["Descartar esos cambios"]);
      expect(await findAccessibilityViolations(screen.container)).toEqual([]);
    } finally { screen.unmount(); }
  });

  it("switches both actions off while one of them runs", async () => {
    const screen = await renderScreen(<Notice busy="apply" />);
    try {
      expect(buttons(screen.container)).toEqual(["Aplicando…", "Descartar esos cambios"]);
      expect(Array.from(screen.container.querySelectorAll("button")).every(button => button.disabled)).toBe(true);
    } finally { screen.unmount(); }
  });

  it("announces a discard that did not go through", async () => {
    const screen = await renderScreen(<Notice discardFailed />);
    try {
      expect(screen.container.querySelector("[role=alert]")!.textContent).toContain("No se pudieron descartar");
    } finally { screen.unmount(); }
  });

  it("tells someone who cannot change the agent who can, instead of showing buttons that fail", async () => {
    auth.user = { role: "tenant_supervisor" };
    const screen = await renderScreen(<Notice />);
    try {
      expect(buttons(screen.container)).toEqual([]);
      expect(screen.container.textContent).toContain("Solo un administrador puede aplicarlos o descartarlos.");
    } finally { screen.unmount(); }
  });
});

describe("the pending-changes copy", () => {
  // The words the owner must never read on a day-0 surface.
  const JARGON: Record<string, RegExp> = {
    es: /borrador|publica(?:r|ción|da)|candidat|versi[oó]n operativa|bloqueo cr[ií]tico|piloto/i,
    en: /draft|publish|publication|candidate|operational version|critical block|pilot/i,
    pt: /rascunho|publica(?:r|ção|da)|candidat|vers[aã]o operacional|bloqueio cr[ií]tico|piloto/i,
    fr: /brouillon|publi(?:er|ée|cation)|candidat|version opérationnelle|blocage critique|pilote/i,
  };

  it.each(Object.keys(JARGON))("speaks without jargon in %s", (locale) => {
    const messages = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "..", "messages", `${locale}.json`), "utf8"));
    const copy = messages.agentPendingChanges as Record<string, string>;
    expect(Object.keys(copy).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(copy)) {
      expect({ key, value, jargon: JARGON[locale].test(value) }).toEqual({ key, value, jargon: false });
    }
  });
});
