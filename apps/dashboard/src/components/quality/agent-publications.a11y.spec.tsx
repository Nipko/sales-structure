import type { AgentConfigurationWorkspace } from "@parallext/shared";
import type { AgentPublicationHistory } from "@/lib/agent-publication";
import type { AgentReleaseDetail, AgentReleaseListItem } from "@/lib/agent-release-review";
import { findAccessibilityViolations, renderScreen, scanScreen } from "@/test/a11y";
import { AgentPublicationWorkspace } from "./AgentPublicationWorkspace";

/**
 * Publication: which configuration customers actually get, and the way back.
 *
 * Scanned in the two states that matter — a candidate ready to publish, and a
 * history with something to roll back to — because those are the ones with the
 * controls: a candidate `<select>`, an activation radio group, two confirm
 * steps and the history table. The rest of the screen is prose.
 *
 * Only `@/lib/api` is faked. The copy, the markup and the compare-and-swap
 * gating logic are the real ones, so a heading that stops being a heading or a
 * table that loses its caption fails here.
 */

const HASH = "a".repeat(64);
const CANDIDATE_HASH = "b".repeat(64);
const EVIDENCE_HASH = "c".repeat(64);

const workspace = {
    agentId: "44444444-4444-4444-8444-444444444444",
    operational: { version: 7, hash: HASH, body: {} },
    draft: null,
    evaluationRevisionId: null,
    // The body is never rendered — this screen states what happened, the editor
    // is where a configuration is read — so a minimal one keeps the fixture
    // about publication instead of about the draft schema.
} as unknown as AgentConfigurationWorkspace;

const history: AgentPublicationHistory = {
    agentId: "44444444-4444-4444-8444-444444444444",
    operationalVersion: 7,
    head: {
        id: "55555555-5555-4555-8555-555555555555",
        kind: "publish",
        operationalVersion: 7,
        operationalHash: HASH,
        createdAt: "2026-09-01T10:00:00.000Z",
    },
    events: [
        {
            id: "55555555-5555-4555-8555-555555555555",
            kind: "publish",
            candidateId: "66666666-6666-4666-8666-666666666666",
            rollbackOf: null,
            baseVersion: 6,
            operationalVersion: 7,
            beforeHash: CANDIDATE_HASH,
            afterHash: HASH,
            evidenceHash: EVIDENCE_HASH,
            requestedBy: "77777777-7777-4777-8777-777777777777",
            createdAt: "2026-09-01T10:00:00.000Z",
        },
        {
            id: "88888888-8888-4888-8888-888888888888",
            kind: "rollback",
            candidateId: null,
            rollbackOf: "55555555-5555-4555-8555-555555555555",
            baseVersion: 5,
            operationalVersion: 6,
            beforeHash: HASH,
            afterHash: CANDIDATE_HASH,
            evidenceHash: null,
            requestedBy: "77777777-7777-4777-8777-777777777777",
            createdAt: "2026-08-30T09:00:00.000Z",
        },
    ],
};

const candidateSummary = {
    id: "99999999-9999-4999-8999-999999999999",
    status: "approved",
    version: 8,
} as unknown as AgentReleaseListItem;

const candidateDetail = {
    id: "99999999-9999-4999-8999-999999999999",
    agentId: "44444444-4444-4444-8444-444444444444",
    status: "approved",
    revisionState: "current",
    version: 8,
    review: { evidenceHash: EVIDENCE_HASH },
} as unknown as AgentReleaseDetail;

jest.mock("@/lib/api", () => ({
    __esModule: true,
    api: {
        getAgentConfiguration: jest.fn(async () => ({ success: true, data: workspaceRef.current })),
        getAgentPublications: jest.fn(async () => ({ success: true, data: historyRef.current })),
        getAgentReleases: jest.fn(async () => ({ success: true, data: releasesRef.current })),
        getAgentRelease: jest.fn(async () => ({ success: true, data: candidateDetail })),
        publishAgentConfiguration: jest.fn(async () => ({ success: false, error: "not_called_in_this_test" })),
        rollbackAgentConfiguration: jest.fn(async () => ({ success: false, error: "not_called_in_this_test" })),
    },
}));

const workspaceRef = { current: workspace as AgentConfigurationWorkspace | null };
const historyRef = { current: history as AgentPublicationHistory | null };
const releasesRef = { current: [candidateSummary] as AgentReleaseListItem[] };

const props = {
    tenantId: "11111111-1111-4111-8111-111111111111",
    agentId: "44444444-4444-4444-8444-444444444444",
    role: "tenant_admin",
};

describe("agent publications workspace", () => {
    beforeEach(() => {
        workspaceRef.current = workspace;
        historyRef.current = history;
        releasesRef.current = [candidateSummary];
    });

    it("has no violations with a candidate and a history", async () => {
        const screen = await renderScreen(<AgentPublicationWorkspace {...props} />);
        try {
            // Guards the guard: an unread workspace renders an error card, and
            // scanning that would prove nothing about the controls.
            expect(screen.container.querySelectorAll("table").length).toBeGreaterThan(0);
            expect(screen.container.querySelectorAll("select").length).toBeGreaterThan(0);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });

    it("has no violations with no approved candidate", async () => {
        releasesRef.current = [];
        expect(await scanScreen(<AgentPublicationWorkspace {...props} />)).toEqual([]);
    });

    it("has no violations when the configuration could not be read", async () => {
        // The refusal path renders its own alert; it must be announced, not just
        // coloured red.
        workspaceRef.current = null;
        expect(await scanScreen(<AgentPublicationWorkspace {...props} />)).toEqual([]);
    });

    it("has no violations for a supervisor, who may read but not publish", async () => {
        expect(await scanScreen(
            <AgentPublicationWorkspace {...props} role="tenant_supervisor" />,
        )).toEqual([]);
    });
});
