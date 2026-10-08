import { readFileSync } from "fs";
import { resolve } from "path";
import {
  CONTACT_CARD_KEYS,
  canReturnToBot,
  contactMetaFromDetail,
  contactMetaPayload,
} from "./inbox-actions";
import { staffDirectoryAvailable } from "../../../lib/staff-directory";

const SRC = resolve(__dirname, "..", "..", "..");
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), "utf8");

describe("Inbox: return to bot (defect: API supported it, the web had no control)", () => {
  const me = { id: "agent-1", isSupervisor: false };

  it("is offered while a person holds the conversation", () => {
    for (const status of ["with_human", "waiting_human", "handoff", "assigned", "open"]) {
      expect(canReturnToBot({ status, assignedAgentId: "agent-1" }, me)).toBe(true);
    }
  });

  it("is not offered when the AI already has it or it is closed", () => {
    expect(canReturnToBot({ status: "active", assignedAgentId: null }, me)).toBe(false);
    expect(canReturnToBot({ status: "resolved", assignedAgentId: null }, { id: "x", isSupervisor: true })).toBe(false);
    expect(canReturnToBot(null, me)).toBe(false);
  });

  it("follows the API rule: an agent only on their own conversations, supervisors on any", () => {
    expect(canReturnToBot({ status: "with_human", assignedAgentId: "agent-2" }, me)).toBe(false);
    expect(canReturnToBot({ status: "waiting_human", assignedAgentId: null }, me)).toBe(false);
    expect(canReturnToBot({ status: "with_human", assignedAgentId: "agent-2" }, { id: "boss", isSupervisor: true })).toBe(true);
    expect(canReturnToBot({ status: "waiting_human", assignedAgentId: null }, { id: "boss", isSupervisor: true })).toBe(true);
  });

  it("the header wires the control to the return-to-ai endpoint and reports a refusal", () => {
    const page = read("app", "admin", "inbox", "page.tsx");
    expect(page).toMatch(/canReturnToBot\(selectedConv,/);
    expect(page).toMatch(/onClick=\{handleReturnToBot\}/);
    expect(page).toMatch(/api\.returnConversationToAI\(activeTenantId, conversationId\)/);
    // apiPut never throws, so the refusal has to be read from the envelope.
    expect(page).toMatch(/if \(!res\?\.success\) throw/);
    expect(page).toMatch(/showInboxError\(t\("errorReturnToBot"\)\)/);
    expect(read("lib", "api.ts")).toMatch(
      /returnConversationToAI:[\s\S]{0,160}\/agent-console\/conversation\/\$\{tenantId\}\/\$\{id\}\/return-to-ai`/,
    );
  });
});

describe("Inbox: contact card persistence (defect: PATCH /crm/contacts/... does not exist)", () => {
  it("sends only the fields the panel owns, never other keys of the stored contact JSON", () => {
    const payload = contactMetaPayload(
      { empresa: "Acme", ciudad: "", handoff: "x", source: "whatsapp", abc: "custom" },
      ["abc"],
    );
    expect(payload).toEqual({ empresa: "Acme", ciudad: "", abc: "custom" });
  });

  it("starts from the stored contact values (conversation detail), blank where absent", () => {
    const meta = contactMetaFromDetail({ empresa: "Acme", source: "whatsapp", abc: "v" }, ["abc"]);
    expect(meta.empresa).toBe("Acme");
    expect(meta.abc).toBe("v");
    expect(meta).not.toHaveProperty("source");
    for (const key of CONTACT_CARD_KEYS) expect(typeof meta[key]).toBe("string");
    expect(contactMetaFromDetail(undefined).empresa).toBe("");
  });

  it("Save goes to the agent-console route and surfaces failures to the agent", () => {
    const page = read("app", "admin", "inbox", "page.tsx");
    expect(page).not.toContain("/crm/contacts/");
    expect(page).toMatch(/api\.updateInboxContactMetadata\(/);
    expect(page).toMatch(/showInboxError\(t\("errorSaveContact"\)\)/);
    expect(read("lib", "api.ts")).toMatch(
      /updateInboxContactMetadata:[\s\S]{0,260}\/agent-console\/conversation\/\$\{tenantId\}\/\$\{conversationId\}\/contact-metadata`/,
    );
  });
});

describe("Staff directory is only requested on plans that include it (GET /staff is 403 on Starter)", () => {
  it("is available only once the plan loaded and includes staffScheduling", () => {
    expect(staffDirectoryAvailable({ staffScheduling: true }, false)).toBe(true);
    expect(staffDirectoryAvailable({ staffScheduling: false }, false)).toBe(false);
    expect(staffDirectoryAvailable({ staffScheduling: true }, true)).toBe(false);
    expect(staffDirectoryAvailable(undefined, false)).toBe(false);
  });

  it.each([
    ["app/admin/service-requests/page.tsx", ["app", "admin", "service-requests", "page.tsx"]],
    ["app/admin/repair-orders/page.tsx", ["app", "admin", "repair-orders", "page.tsx"]],
  ])("%s skips api.listStaff when the plan has no staff directory", (_label, parts) => {
    const source = read(...parts);
    expect(source).toMatch(/staffDirectoryAvailable\(features, planLoading\)/);
    // The early exit precedes the request inside the same effect.
    expect(source).toMatch(/!staffAvailable[\s\S]{0,120}return;[\s\S]{0,400}api\.listStaff\(/);
  });
});

describe("new strings exist in every dashboard language", () => {
  const langs = ["es", "en", "pt", "fr"];
  const messages = (lang: string) => JSON.parse(readFileSync(resolve(SRC, "..", "messages", `${lang}.json`), "utf8"));

  it.each(langs)("%s has the Inbox and repair-order keys", (lang) => {
    const m = messages(lang);
    for (const key of ["returnToBot", "returnToBotConfirm", "errorReturnToBot", "errorSaveContact"]) {
      expect(typeof m.inbox[key]).toBe("string");
      expect(m.inbox[key].length).toBeGreaterThan(3);
    }
    expect(typeof m.repairOrders.technicianUnavailableOnPlan).toBe("string");
  });
});
