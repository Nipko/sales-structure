import * as fs from "node:fs";
import * as path from "node:path";
import {
    DISPATCH_MAX_ATTEMPTS,
    DISPATCH_STATES,
    asDispatchState,
    dispatchResolutionBlock,
    dispatchSlaState,
    isDispatchResolvable,
    isDispatchRolloutInert,
    prepareDispatchResolution,
    prepareDispatchRollout,
    readDispatchRefusal,
    settleQueueRow,
    sortDispatchQueue,
    type DispatchReconciliationEntry,
    type DispatchResolutionRecord,
} from "./dispatch-operations";
import { ROLE_KEYS, canAccessPath } from "./roles";
import { NAVIGATION_ROUTES, resolveNavigationRoute } from "./navigation-contract";

const ROOT = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.resolve(ROOT, relative), "utf8");
const PAGE = read("app/admin/dispatch/page.tsx");
const SIDEBAR = read("components/layout/AppSidebar.tsx");
const API = read("lib/api.ts");

function entry(overrides: Partial<DispatchReconciliationEntry> = {}): DispatchReconciliationEntry {
    return {
        id: "11111111-1111-4111-8111-111111111111",
        state: "reconciliation_required",
        conversationId: "22222222-2222-4222-8222-222222222222",
        inboundMessageId: "33333333-3333-4333-8333-333333333333",
        channelType: "whatsapp",
        channelAccountId: "44444444-4444-4444-8444-444444444444",
        recipientHint: "********7788",
        itemKind: "text",
        itemIndex: 0,
        attempts: 1,
        errorCode: "provider_timeout",
        receipt: null,
        settledLeaseToken: null,
        redacted: false,
        createdAt: "2026-09-08T10:00:00.000Z",
        updatedAt: "2026-09-08T10:05:00.000Z",
        ageSeconds: 600,
        ...overrides,
    };
}

const row = (overrides: Partial<DispatchReconciliationEntry> = {}): DispatchReconciliationEntry =>
    ({ ...entry(), ...overrides });

function record(overrides: Partial<DispatchResolutionRecord> = {}): DispatchResolutionRecord {
    return {
        id: "66666666-6666-4666-8666-666666666666",
        dispatchId: "11111111-1111-4111-8111-111111111111",
        resolution: "retry",
        evidence: "No request in the provider log for that window",
        actorId: "77777777-7777-4777-8777-777777777777",
        actorRole: "super_admin",
        previousState: "reconciliation_required",
        previousErrorCode: "provider_timeout",
        newState: "failed",
        receipt: null,
        createdAt: "2026-09-08T10:30:00.000Z",
        ...overrides,
    };
}

describe("an uncertain effect is only decided once", () => {
    const settledStates = DISPATCH_STATES.filter(state => state !== "reconciliation_required");

    it.each(settledStates)("offers no resolution on a row in %s", state => {
        const settled = row({ state });
        expect(isDispatchResolvable(settled)).toBe(false);
        for (const resolution of ["delivered", "not_delivered", "retry"] as const) {
            expect(dispatchResolutionBlock(settled, {
                resolution, evidence: "Checked the provider console", receipt: "wamid.abc",
            })).toBe("settled");
            expect(() => prepareDispatchResolution(settled, {
                resolution, evidence: "Checked the provider console", receipt: "wamid.abc",
            })).toThrow(/dispatch_resolution_blocked:settled/);
        }
    });

    it("reads the state off the entry instead of assuming the listing's one", () => {
        // The listing only returns `reconciliation_required`, but it says so
        // now. An assumption that happens to be right is still the wrong thing
        // to decide an irreversible action on.
        expect(isDispatchResolvable(entry())).toBe(true);
        expect(isDispatchResolvable(entry({ state: "sent" }))).toBe(false);
    });

    it("stops offering a decision the moment the server settles the row", () => {
        const pending = row();
        expect(isDispatchResolvable(pending)).toBe(true);
        const settled = settleQueueRow(pending, {
            id: pending.id, state: "sent", attempts: 1, receipt: "wamid.abc",
            errorCode: "provider_timeout",
            resolution: record({ resolution: "delivered", newState: "sent", receipt: "wamid.abc" }),
        });
        expect(isDispatchResolvable(settled)).toBe(false);
        expect(settled.receipt).toBe("wamid.abc");
        // The decision no longer writes over the provider failure, so the
        // reason this row needed a person stays readable after it is closed.
        expect(settled.errorCode).toBe("provider_timeout");
    });

    it("adopts the state a refusal reports, so a second decision is not offered", () => {
        expect(readDispatchRefusal({ errorCode: "dispatch_not_reconcilable:suppressed" }).state).toBe("suppressed");
        expect(readDispatchRefusal({ error: "dispatch_not_reconcilable:sent" }).state).toBe("sent");
        expect(readDispatchRefusal({ errorCode: "dispatch_not_reconcilable:not_a_state" }).state).toBeNull();
        expect(readDispatchRefusal({ errorCode: "dispatch_redacted" }).state).toBeNull();
    });
});

describe("a row somebody else settled is a race, not a bad form", () => {
    it("reads 409 as a conflict and keeps the state the code names", () => {
        const refusal = readDispatchRefusal({
            httpStatus: 409, errorCode: "dispatch_not_reconcilable:suppressed", error: "Error 409",
        });
        expect(refusal).toEqual({ kind: "notReconcilable", conflict: true, state: "suppressed" });
    });

    it("is a conflict on the status alone, even with nothing to parse", () => {
        // The status is the fact: somebody else got there first. Without this
        // the operator would read "we could not verify this" and try again.
        expect(readDispatchRefusal({ httpStatus: 409, error: "Error 409" }))
            .toEqual({ kind: "notReconcilable", conflict: true, state: null });
    });

    it("never marks a validation refusal as a conflict", () => {
        for (const code of ["dispatch_resolution_evidence_required", "dispatch_receipt_required",
            "dispatch_redacted", "dispatch_attempts_exhausted"]) {
            expect(readDispatchRefusal({ httpStatus: 400, errorCode: code }).conflict).toBe(false);
        }
    });

    it("offers the reload that is the only useful answer to a conflict", () => {
        expect(PAGE).toContain("resolveConflict");
        expect(PAGE).toContain('t("errors.reload")');
        const messages = JSON.parse(fs.readFileSync(path.resolve(ROOT, "../messages/es.json"), "utf8"));
        expect(typeof messages.dispatchOperations.errors.reload).toBe("string");
    });
});

describe("the decision that was recorded is shown, not just that it worked", () => {
    it("names the state transition with labels, never a raw database value", () => {
        const decision = record();
        expect(asDispatchState(decision.previousState)).toBe("reconciliation_required");
        expect(asDispatchState(decision.newState)).toBe("failed");
        // A value with no label is returned as null so the screen prints the
        // raw string instead of asking for a translation key that is not there.
        expect(asDispatchState("something_else")).toBeNull();
        expect(asDispatchState(null)).toBeNull();
    });

    it("keeps the whole evidence the server stored, not a truncated copy", () => {
        const decision = record({ evidence: "x".repeat(500) });
        expect(decision.evidence).toHaveLength(500);
    });

    it("shows the author, the transition and the evidence on the screen", () => {
        expect(PAGE).toContain("result.data!.resolution");
        for (const key of ["recorded.title", "recorded.durable", "recorded.author",
            "recorded.actorWithRole", "recorded.transitionValue", "recorded.evidence", "recorded.reference"]) {
            expect(PAGE).toContain(key);
        }
        expect(PAGE).toContain("decision.actorId");
        expect(PAGE).toContain("decision.evidence");
    });

    it("shows the provider failure without calling it the decision's note", () => {
        // `error_code` used to be overwritten by the evidence. It is not any
        // more, so the queue can show the failure that opened each row.
        expect(PAGE).toContain('t("queue.colFailure")');
        expect(PAGE).toContain('t("detail.errorCodeHelp")');
        const messages = JSON.parse(fs.readFileSync(path.resolve(ROOT, "../messages/es.json"), "utf8"));
        expect(messages.dispatchOperations.detail.errorCodeHelp).toMatch(/decisión/i);
    });

    it("never reaches the payload or the unmasked recipient the answer carries", () => {
        // The resolve endpoint answers the whole dispatch row, which carries
        // both. The receipt type names neither, and neither does the screen.
        expect(PAGE).not.toMatch(/\.binding\b/);
        const lib = read("lib/dispatch-operations.ts");
        expect(lib).not.toMatch(/\bpayload\??\s*:/);
        expect(lib).not.toMatch(/\bbinding\??\s*:/);
    });
});

describe("what a resolution demands before it is offered", () => {
    it("always demands written evidence, and refuses more than the column holds", () => {
        expect(dispatchResolutionBlock(row(), { resolution: "not_delivered", evidence: "   " })).toBe("evidenceRequired");
        expect(dispatchResolutionBlock(row(), { resolution: "not_delivered", evidence: "x".repeat(501) })).toBe("evidenceRequired");
        expect(dispatchResolutionBlock(row(), { resolution: "not_delivered", evidence: "Not in the provider log" })).toBeNull();
    });

    it("demands the provider receipt only when closing it as delivered", () => {
        expect(dispatchResolutionBlock(row(), { resolution: "delivered", evidence: "Seen at the provider" })).toBe("receiptRequired");
        expect(dispatchResolutionBlock(row(), { resolution: "delivered", evidence: "Seen at the provider", receipt: " " })).toBe("receiptRequired");
        expect(dispatchResolutionBlock(row(), { resolution: "delivered", evidence: "Seen at the provider", receipt: "wamid.abc" })).toBeNull();
    });

    it("never offers to resend erased words or a row that spent its attempts", () => {
        expect(dispatchResolutionBlock(row({ redacted: true }), { resolution: "retry", evidence: "Not delivered" })).toBe("redacted");
        expect(dispatchResolutionBlock(row({ attempts: DISPATCH_MAX_ATTEMPTS }), { resolution: "retry", evidence: "Not delivered" })).toBe("attemptsExhausted");
        // An erased row may still be closed; only resending is forbidden.
        expect(dispatchResolutionBlock(row({ redacted: true }), { resolution: "not_delivered", evidence: "Not delivered" })).toBeNull();
    });

    it("builds only the fields the endpoint accepts", () => {
        expect(prepareDispatchResolution(row(), {
            resolution: "delivered", evidence: "  Seen at the provider  ", receipt: "  wamid.abc  ",
        })).toEqual({ resolution: "delivered", evidence: "Seen at the provider", receipt: "wamid.abc" });
        expect(prepareDispatchResolution(row(), {
            resolution: "retry", evidence: "Not in the provider log", receipt: "ignored",
        })).toEqual({ resolution: "retry", evidence: "Not in the provider log" });
    });
});

describe("refusals become explanations, never raw codes", () => {
    // Reconciliation answers `{ error: code }`, so the code arrives in
    // `errorCode`; the rollout PUT still raises the code as an exception
    // message, so it arrives in `error` with `errorCode` saying "Bad Request".
    // Both shapes reach this screen and both have to be read.
    it.each([
        [{ httpStatus: 409, errorCode: "dispatch_not_reconcilable:suppressed" }, "notReconcilable"],
        [{ httpStatus: 400, errorCode: "dispatch_redacted" }, "redacted"],
        [{ httpStatus: 400, errorCode: "dispatch_attempts_exhausted" }, "attemptsExhausted"],
        [{ httpStatus: 400, errorCode: "dispatch_receipt_required" }, "receiptRequired"],
        [{ httpStatus: 400, errorCode: "dispatch_resolution_evidence_required" }, "evidenceRequired"],
        [{ error: "dispatch_rollout_unsupported_channel:email", errorCode: "Bad Request" }, "invalidRollout"],
        [{ error: "Error de conexión" }, "unavailable"],
        [{ error: "Error 500", errorCode: "Internal Server Error" }, "unavailable"],
    ])("maps %j", (envelope, expected) => {
        expect(readDispatchRefusal(envelope).kind).toBe(expected);
    });

    it("carries the status POST refusals arrive with", () => {
        // Without this the 409 is indistinguishable from a 400 on the client.
        expect(API).toMatch(/method: "POST",[\s\S]{0,300}?httpStatus: res\.status/);
    });
});

describe("the SLA is visible before it is breached", () => {
    it("separates within, nearing and breaching", () => {
        expect(dispatchSlaState(0, 3600)).toBe("within");
        expect(dispatchSlaState(1799, 3600)).toBe("within");
        expect(dispatchSlaState(1800, 3600)).toBe("nearing");
        expect(dispatchSlaState(3599, 3600)).toBe("nearing");
        expect(dispatchSlaState(3600, 3600)).toBe("breaching");
    });

    it("never claims a breach when the deadline is unknown", () => {
        expect(dispatchSlaState(99999, 0)).toBe("within");
        expect(dispatchSlaState(99999, Number.NaN)).toBe("within");
    });

    it("lists the longest uncertainty first", () => {
        const rows = [row({ id: "a", ageSeconds: 60 }), row({ id: "b", ageSeconds: 7200 }), row({ id: "c", ageSeconds: 600 })];
        expect(sortDispatchQueue(rows).map(entry => entry.id)).toEqual(["b", "c", "a"]);
    });
});

describe("a rollout says what it will do before it is saved", () => {
    it("normalizes the request and names what the server would refuse", () => {
        const draft = prepareDispatchRollout({
            enabled: true,
            tenantIds: ["  55555555-5555-4555-8555-555555555555 ", "not-a-uuid", "55555555-5555-4555-8555-555555555555"],
            channels: ["telegram", "email", "whatsapp", "whatsapp"],
        });
        expect(draft.body).toEqual({
            enabled: true,
            tenantIds: ["55555555-5555-4555-8555-555555555555", "not-a-uuid"],
            channels: ["email", "telegram", "whatsapp"],
        });
        expect(draft.invalidTenantIds).toEqual(["not-a-uuid"]);
        expect(draft.invalidChannels).toEqual(["email"]);
    });

    it("treats anything but a literal true as off", () => {
        expect(prepareDispatchRollout({ enabled: false, tenantIds: [], channels: [] }).body.enabled).toBe(false);
    });

    it("calls out a rollout that is on and delivers nothing", () => {
        const base = { enabled: true, tenantIds: [], channels: ["whatsapp"], migratedChannels: [], ignoredChannels: ["whatsapp"] };
        expect(isDispatchRolloutInert({ ...base, effectiveChannels: [] })).toBe(true);
        expect(isDispatchRolloutInert({ ...base, effectiveChannels: ["whatsapp"] })).toBe(false);
        expect(isDispatchRolloutInert({ ...base, enabled: false, effectiveChannels: [] })).toBe(false);
    });
});

describe("the dispatch surface is wired and reachable", () => {
    it("is registered once in the canonical navigation contract", () => {
        const route = NAVIGATION_ROUTES.filter(entry => entry.pattern === "/admin/dispatch");
        expect(route).toHaveLength(1);
        expect(route[0].scope).toBe("platform");
        expect(resolveNavigationRoute("/admin/dispatch")?.definition.id).toBe("platformDispatch");
    });

    it("belongs to super_admin in platform mode, without impersonation", () => {
        // A kill switch that needs impersonation to reach is not a kill switch.
        expect(canAccessPath("/admin/dispatch", ROLE_KEYS.SUPER_ADMIN, false)).toBe(true);
        expect(canAccessPath("/admin/dispatch", ROLE_KEYS.TENANT_ADMIN, false)).toBe(false);
        expect(canAccessPath("/admin/dispatch", ROLE_KEYS.TENANT_SUPERVISOR, false)).toBe(false);
        expect(canAccessPath("/admin/dispatch", ROLE_KEYS.TENANT_AGENT, false)).toBe(false);
    });

    it("is listed in the platform sidebar", () => {
        expect(SIDEBAR).toContain('href: "/admin/dispatch"');
        expect(SIDEBAR).toContain('labelKey: "dispatchOperations"');
    });

    it("reaches every endpoint the operation needs", () => {
        for (const method of [
            "getDispatchRollout:",
            "setDispatchRollout:",
            "disableDispatchRollout:",
            "getDispatchReconciliation:",
            "resolveDispatchReconciliation:",
            "exportDispatchResolutions:",
        ]) {
            expect(API).toContain(method);
        }
        expect(PAGE).toContain("api.getDispatchRollout()");
        expect(PAGE).toContain("api.disableDispatchRollout()");
        expect(PAGE).toContain("api.resolveDispatchReconciliation(");
        expect(PAGE).toContain("api.exportDispatchResolutions(");
    });

    it("explains that a pending audit copy loses nothing", () => {
        // The decision, its author and its evidence commit in the tenant's own
        // schema; only the platform-wide copy is being caught up here. An
        // operator who does not know that reads a pending copy as a lost one.
        expect(API).toContain("/export");
        for (const key of ["export.title", "export.help", "export.run", "export.failed"]) {
            expect(PAGE).toContain(key);
        }
        const messages = JSON.parse(fs.readFileSync(path.resolve(ROOT, "../messages/es.json"), "utf8"));
        expect(messages.dispatchOperations.export.help).toMatch(/nada se pierde/i);
        expect(messages.dispatchOperations.export.failed).toMatch(/siguen guardadas/i);
    });

    it("shows no message body and no unmasked recipient", () => {
        // The entry contract carries neither; this guards a future addition.
        expect(PAGE).not.toMatch(/\.payload\b/);
        expect(PAGE).not.toMatch(/\.caption\b/);
        expect(PAGE).not.toMatch(/\brow\.recipient\b/);
        expect(PAGE).toContain("recipientHint");
    });

    it("puts an explicit confirmation in front of every irreversible decision", () => {
        expect(PAGE).toContain("ConfirmStep");
        // The confirmation copy is per resolution, so each one states its own
        // consequence instead of a shared "are you sure".
        expect(PAGE).toContain("`resolutions.${resolution}.confirmBody`");
        expect(PAGE).toContain('t("rollout.confirmDisableBody")');
        const messages = JSON.parse(fs.readFileSync(path.resolve(ROOT, "../messages/es.json"), "utf8"));
        for (const resolution of ["delivered", "not_delivered", "retry"]) {
            expect(typeof messages.dispatchOperations.resolutions[resolution].confirmBody).toBe("string");
        }
    });

    it("announces the consequence and moves focus without faking a modal", () => {
        const step = read("components/ui/confirm-step.tsx");
        expect(step).toContain('role="alert"');
        expect(step).toContain("aria-labelledby");
        expect(step).toContain("confirmRef.current?.focus()");
        expect(step).toContain('event.key === "Escape"');
        // Inline and not focus-trapping: claiming alertdialog would promise a
        // behaviour that is not there.
        expect(step).not.toMatch(/role=\{?["']alertdialog/);
    });
});

describe("dispatch operations copy exists in the four locales", () => {
    const locales = ["es", "en", "pt", "fr"] as const;

    function namespace(locale: string): Record<string, unknown> {
        const messages = JSON.parse(fs.readFileSync(path.resolve(ROOT, `../messages/${locale}.json`), "utf8"));
        return { nav: messages.nav.items.dispatchOperations, body: messages.dispatchOperations };
    }

    function leafPaths(value: unknown, prefix = ""): string[] {
        if (!value || typeof value !== "object") return [prefix];
        return Object.entries(value as Record<string, unknown>)
            .flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key));
    }

    it("keeps every key identical across the four files", () => {
        const [reference, ...rest] = locales.map(locale => leafPaths(namespace(locale)).sort());
        expect(reference.length).toBeGreaterThan(60);
        for (const other of rest) expect(other).toEqual(reference);
    });

    it.each(locales)("has non-empty %s strings", locale => {
        const messages = JSON.parse(fs.readFileSync(path.resolve(ROOT, `../messages/${locale}.json`), "utf8"));
        const walk = (value: unknown, at: string): void => {
            if (typeof value === "string") { expect(value.trim().length).toBeGreaterThan(0); return; }
            expect(typeof value).toBe("object");
            for (const [key, child] of Object.entries(value as Record<string, unknown>)) walk(child, `${at}.${key}`);
        };
        walk(messages.dispatchOperations, "dispatchOperations");
        expect(typeof messages.nav.items.dispatchOperations).toBe("string");
    });
});
