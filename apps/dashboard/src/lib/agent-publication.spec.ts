import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentConfigurationWorkspace } from "@parallext/shared";
import {
    preparePublish,
    prepareRollback,
    publicationErrorKind,
    publicationReference,
    publicationRequiresReload,
    publishBlock,
    rollbackBlock,
    type AgentPublicationHistory,
} from "./agent-publication";
import type { AgentReleaseDetail } from "./agent-release-review";
import { ROLE_KEYS, canAccessPath } from "./roles";
import { NAVIGATION_ROUTES, resolveNavigationRoute } from "./navigation-contract";

const ROOT = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.resolve(ROOT, relative), "utf8");
const WORKSPACE_FILE = read("components/quality/AgentPublicationWorkspace.tsx");
const PAGE = read("app/admin/agent/[agentId]/publications/page.tsx");
const AGENT_DETAIL = read("app/admin/agent/[agentId]/page.tsx");
const API = read("lib/api.ts");

const OPERATIONAL_HASH = "a".repeat(64);
const EVIDENCE_HASH = "b".repeat(64);
const HEAD_ID = "77777777-7777-4777-8777-777777777777";
const AGENT_ID = "88888888-8888-4888-8888-888888888888";
const CANDIDATE_ID = "99999999-9999-4999-8999-999999999999";

function workspace(overrides: Partial<AgentConfigurationWorkspace["operational"]> = {}): AgentConfigurationWorkspace {
    return {
        agentId: AGENT_ID,
        operational: {
            version: 4,
            hash: OPERATIONAL_HASH,
            body: {
                name: "Sofía", configJson: {}, channels: ["whatsapp"], channelBindings: [],
                scheduleMode: "always", isActive: true, isDefault: true,
            },
            ...overrides,
        },
        draft: null,
        evaluationRevisionId: null,
    };
}

function history(overrides: Partial<AgentPublicationHistory> = {}): AgentPublicationHistory {
    return {
        agentId: AGENT_ID,
        operationalVersion: 4,
        head: {
            id: HEAD_ID, kind: "publish", operationalVersion: 4,
            operationalHash: OPERATIONAL_HASH, createdAt: "2026-09-01T12:00:00.000Z",
        },
        events: [],
        ...overrides,
    };
}

function candidate(overrides: Partial<AgentReleaseDetail> = {}): AgentReleaseDetail {
    return {
        id: CANDIDATE_ID,
        agentId: AGENT_ID,
        configurationRevisionId: "66666666-6666-4666-8666-666666666666",
        status: "approved",
        version: 3,
        revisionState: "current",
        channels: ["whatsapp"],
        createdAt: "2026-09-02T12:00:00.000Z",
        error: null,
        evaluations: [],
        review: { evidenceHash: EVIDENCE_HASH } as AgentReleaseDetail["review"],
        activationAllowed: false,
        certified: false,
        ...overrides,
    };
}

describe("a publication only carries expectations it just read", () => {
    it("refuses when the two reads disagree about what is serving", () => {
        // Configuration and history are two round trips. A version from one
        // paired with a hash from the other is exactly the stale expectation
        // the server exists to refuse — catch it before spending an attempt.
        expect(publishBlock(workspace(), history({ operationalVersion: 5 }), candidate(), ROLE_KEYS.TENANT_ADMIN))
            .toBe("reloadRequired");
        expect(publishBlock(workspace({ hash: "not-a-hash" }), history(), candidate(), ROLE_KEYS.TENANT_ADMIN))
            .toBe("reloadRequired");
        expect(publishBlock(null, history(), candidate(), ROLE_KEYS.TENANT_ADMIN)).toBe("reloadRequired");
        expect(publishBlock(workspace(), null, candidate(), ROLE_KEYS.TENANT_ADMIN)).toBe("reloadRequired");
    });

    it("keeps publication to administrators", () => {
        expect(publishBlock(workspace(), history(), candidate(), ROLE_KEYS.TENANT_SUPERVISOR)).toBe("adminRequired");
        expect(publishBlock(workspace(), history(), candidate(), ROLE_KEYS.TENANT_AGENT)).toBe("adminRequired");
        expect(publishBlock(workspace(), history(), candidate(), ROLE_KEYS.SUPER_ADMIN)).toBeNull();
    });

    it("refuses a candidate that is not approved, or whose evidence moved", () => {
        expect(publishBlock(workspace(), history(), null, ROLE_KEYS.TENANT_ADMIN)).toBe("candidateNotApproved");
        expect(publishBlock(workspace(), history(), candidate({ status: "evaluated" }), ROLE_KEYS.TENANT_ADMIN)).toBe("candidateNotApproved");
        expect(publishBlock(workspace(), history(), candidate({ revisionState: "changed" }), ROLE_KEYS.TENANT_ADMIN)).toBe("candidateChanged");
        expect(publishBlock(workspace(), history(), candidate({ review: null }), ROLE_KEYS.TENANT_ADMIN)).toBe("evidenceMissing");
    });

    it("sends exactly the six fields the store accepts, and no more", () => {
        const attempt = preparePublish(workspace(), history(), candidate(), ROLE_KEYS.TENANT_ADMIN, "preserve");
        expect(Object.keys(attempt.body).sort()).toEqual([
            "activation", "evidenceHash", "expectedCandidateVersion",
            "expectedOperationalHash", "expectedOperationalVersion", "requestKey",
        ]);
        expect(attempt.body).toMatchObject({
            expectedOperationalVersion: 4,
            expectedOperationalHash: OPERATIONAL_HASH,
            expectedCandidateVersion: 3,
            evidenceHash: EVIDENCE_HASH,
            activation: "preserve",
        });
        expect(attempt.body.requestKey).toMatch(/^[a-zA-Z0-9_-]{8,100}$/);
    });

    it("keeps one identity for a retry and a new one for a different request", () => {
        const first = preparePublish(workspace(), history(), candidate(), ROLE_KEYS.TENANT_ADMIN, "preserve");
        const retry = preparePublish(workspace(), history(), candidate(), ROLE_KEYS.TENANT_ADMIN, "preserve", first);
        expect(retry.body.requestKey).toBe(first.body.requestKey);
        const activated = preparePublish(workspace(), history(), candidate(), ROLE_KEYS.TENANT_ADMIN, "activate", first);
        expect(activated.body.requestKey).not.toBe(first.body.requestKey);
        const moved = preparePublish(workspace({ version: 5 }), history({ operationalVersion: 5 }), candidate(), ROLE_KEYS.TENANT_ADMIN, "preserve", first);
        expect(moved.body.requestKey).not.toBe(first.body.requestKey);
    });

    it("refuses to build a request that is blocked", () => {
        expect(() => preparePublish(workspace(), history(), candidate({ status: "evaluated" }), ROLE_KEYS.TENANT_ADMIN, "preserve"))
            .toThrow(/agent_publication_blocked:candidateNotApproved/);
    });
});

describe("a rollback that cannot succeed is not offered", () => {
    it("needs a publication to return to", () => {
        expect(rollbackBlock(workspace(), history({ head: null }), ROLE_KEYS.TENANT_ADMIN)).toBe("noPublication");
    });

    it("refuses to roll back a rollback", () => {
        expect(rollbackBlock(workspace(), history({
            head: { id: HEAD_ID, kind: "rollback", operationalVersion: 4, operationalHash: OPERATIONAL_HASH, createdAt: "" },
        }), ROLE_KEYS.TENANT_ADMIN)).toBe("headIsRollback");
    });

    it("refuses when the configuration moved after that publication", () => {
        // The store compares ONE expected hash against both the head's
        // after_hash and the agent's hash right now: if they diverged, no
        // value satisfies both and the request could never succeed.
        expect(rollbackBlock(workspace({ hash: "c".repeat(64) }), history(), ROLE_KEYS.TENANT_ADMIN))
            .toBe("configurationDiverged");
    });

    it("sends exactly the four fields the store accepts", () => {
        const attempt = prepareRollback(workspace(), history(), ROLE_KEYS.TENANT_ADMIN);
        expect(Object.keys(attempt.body).sort()).toEqual([
            "expectedOperationalHash", "expectedOperationalVersion", "expectedPublicationId", "requestKey",
        ]);
        expect(attempt.body.expectedPublicationId).toBe(HEAD_ID);
        const retry = prepareRollback(workspace(), history(), ROLE_KEYS.TENANT_ADMIN, attempt);
        expect(retry.body.requestKey).toBe(attempt.body.requestKey);
    });

    it("keeps rollback to administrators", () => {
        expect(rollbackBlock(workspace(), history(), ROLE_KEYS.TENANT_SUPERVISOR)).toBe("adminRequired");
    });
});

describe("a stale expectation reads as a change, never as a generic failure", () => {
    it.each([
        "agent_operational_configuration_changed",
        "agent_publication_head_changed",
        "agent_publication_history_invalid",
        "agent_publication_request_conflict",
        "agent_release_version_changed",
        "agent_release_evidence_changed",
        "agent_release_draft_mismatch",
        "agent_draft_revision_changed",
    ])("treats %s as somebody else having changed it", code => {
        const kind = publicationErrorKind({ errorCode: code });
        expect(kind).toBe("conflict");
        expect(publicationRequiresReload(kind)).toBe(true);
    });

    it.each([
        ["agent_publication_admin_required", "adminRequired"],
        ["agent_publication_scope_invalid", "scopeInvalid"],
        ["agent_publication_scope_mismatch", "scopeMismatch"],
        ["agent_publication_subscription_restricted", "subscriptionRestricted"],
        ["evaluation_revision_manifest_required", "evidenceStale"],
        ["tenant_not_found", "notFound"],
        ["agent_not_found", "notFound"],
        ["agent_connection_assignment_conflict", "assignmentConflict"],
        ["agent_publication_request_invalid", "requestInvalid"],
        ["something_unmapped", "unavailable"],
    ])("translates %s on its own terms", (code, expected) => {
        expect(publicationErrorKind({ errorCode: code })).toBe(expected);
        expect(publicationRequiresReload(publicationErrorKind({ errorCode: code }))).toBe(false);
    });

    it("shortens an identifier without inventing one", () => {
        expect(publicationReference(OPERATIONAL_HASH)).toBe("aaaaaaaa");
        expect(publicationReference(null)).toBe("—");
        expect(publicationReference("short")).toBe("—");
    });
});

describe("the publication surface is wired and reachable", () => {
    it("is registered once, under the agent it belongs to", () => {
        const route = NAVIGATION_ROUTES.filter(entry => entry.pattern === "/admin/agent/:agentId/publications");
        expect(route).toHaveLength(1);
        expect(route[0]).toMatchObject({ id: "agentPublications", scope: "tenant", parentId: "agentDetail" });
        expect(resolveNavigationRoute(`/admin/agent/${AGENT_ID}/publications`)?.definition.id).toBe("agentPublications");
    });

    it("keeps the same audience as the rest of the agent area", () => {
        // The matcher is prefix-based and cannot name a dynamic segment, so the
        // `/admin/agent` rule governs this page. Pin it here so widening that
        // line is deliberate rather than a side effect.
        const pathname = `/admin/agent/${AGENT_ID}/publications`;
        expect(canAccessPath(pathname, ROLE_KEYS.TENANT_ADMIN, false)).toBe(true);
        expect(canAccessPath(pathname, ROLE_KEYS.SUPER_ADMIN, true)).toBe(true);
        expect(canAccessPath(pathname, ROLE_KEYS.SUPER_ADMIN, false)).toBe(false);
        expect(canAccessPath(pathname, ROLE_KEYS.TENANT_SUPERVISOR, false)).toBe(false);
        expect(canAccessPath(pathname, ROLE_KEYS.TENANT_AGENT, false)).toBe(false);
    });

    it("is linked from the agent it publishes", () => {
        expect(AGENT_DETAIL).toContain("/admin/agent/${agentId}/publications");
        expect(AGENT_DETAIL).toContain("tPublications('openWorkspace')");
    });

    it("reaches every endpoint the operation needs", () => {
        expect(API).toContain("getAgentPublications:");
        expect(API).toContain("publishAgentConfiguration:");
        expect(API).toContain("rollbackAgentConfiguration:");
        expect(WORKSPACE_FILE).toContain("api.getAgentPublications(");
        expect(WORKSPACE_FILE).toContain("api.publishAgentConfiguration(");
        expect(WORKSPACE_FILE).toContain("api.rollbackAgentConfiguration(");
        expect(PAGE).toContain("AgentPublicationWorkspace");
    });

    it("confirms before changing what customers get, and never renders a configuration body", () => {
        expect(WORKSPACE_FILE).toContain("ConfirmStep");
        expect(WORKSPACE_FILE).toContain("publish.confirmTitle");
        expect(WORKSPACE_FILE).toContain("rollback.confirmTitle");
        // Bodies are deliberately never returned by the API; do not start
        // showing one here either.
        expect(WORKSPACE_FILE).not.toMatch(/\.configJson\b/);
        expect(WORKSPACE_FILE).not.toMatch(/event\.body\b/);
    });
});

describe("publication copy exists in the four locales", () => {
    const locales = ["es", "en", "pt", "fr"] as const;

    const namespace = (locale: string) => JSON.parse(
        fs.readFileSync(path.resolve(ROOT, `../messages/${locale}.json`), "utf8")).agentPublications;

    function leafPaths(value: unknown, prefix = ""): string[] {
        if (!value || typeof value !== "object") return [prefix];
        return Object.entries(value as Record<string, unknown>)
            .flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key));
    }

    it("keeps every key identical across the four files", () => {
        const [reference, ...rest] = locales.map(locale => leafPaths(namespace(locale)).sort());
        expect(reference.length).toBeGreaterThan(50);
        for (const other of rest) expect(other).toEqual(reference);
    });

    it.each(locales)("explains every refusal in %s instead of printing a code", locale => {
        const messages = namespace(locale);
        for (const key of ["conflict", "assignmentConflict", "adminRequired", "scopeInvalid", "scopeMismatch",
            "subscriptionRestricted", "evidenceStale", "notFound", "requestInvalid", "unavailable"]) {
            expect(typeof messages.errors[key]).toBe("string");
            expect(messages.errors[key]).not.toMatch(/agent_publication_|evaluation_revision_/);
        }
        for (const key of ["adminRequired", "reloadRequired", "candidateNotApproved", "candidateChanged", "evidenceMissing"]) {
            expect(typeof messages.publishBlocked[key]).toBe("string");
        }
        for (const key of ["adminRequired", "reloadRequired", "noPublication", "headIsRollback", "configurationDiverged"]) {
            expect(typeof messages.rollbackBlocked[key]).toBe("string");
        }
    });
});
