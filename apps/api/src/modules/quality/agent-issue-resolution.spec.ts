import * as fs from 'fs';
import * as path from 'path';
import {
    AGENT_ISSUE_RESOLUTIONS, AGENT_OPERATION_REGISTRY, AGENT_QUALITY_ISSUE_CODES,
    agentIssueResolutionDefects, getAgentOperation, misleadingAssistOperations, resolutionForIssueCode,
} from '@parallext/shared';
import { AgentQualityService } from './agent-quality.service';

/**
 * The coverage contract F2 asks for: every blocker and every recommendation the
 * assessment can raise has a resolution, and a code that appears without one
 * fails here.
 *
 * The universe is not a list somebody keeps in step. It is produced by running
 * the real builders — `buildPreparation` for the check codes, `buildRecommendations`
 * for the pillar codes — so a new `add({ code: … })` or a new
 * `recommendations.push({ code: … })` lands in this test whether or not anybody
 * remembered it existed. The vertical checks are emitted from a template rather
 * than written out, which is exactly why a regex sweep of the source would not
 * have done: it cannot see the thirteen codes the loop produces.
 *
 * `buildPreparation` needs no database. It is a pure function of an agent row, a
 * tenant context and a facts object, so the three are built here directly and
 * nothing is stubbed.
 */

const service = new AgentQualityService({} as any) as any;

const AGENT = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Luna',
    is_active: true,
    version: 2,
    updated_at: '2026-09-01T00:00:00.000Z',
    channels: ['whatsapp'],
    channel_bindings: [],
    config_json: {
        language: 'es',
        // Every optional tool switched on, so no check can leave through the
        // `not_applicable` door and skip being counted here.
        tools: Object.fromEntries(['appointments', 'catalog', 'ecommerce', 'orders', 'offers', 'crm', 'faqs',
            'policies', 'vehicles', 'properties', 'tours', 'treatments', 'realEstate', 'pets', 'restaurants',
            'gyms', 'education', 'insurance', 'homeServices', 'petServices', 'photography', 'professionalServices',
        ].map(tool => [tool, { enabled: true }])),
        rag: { enabled: true, chunkSize: 500, topK: 5, similarityThreshold: 0.65 },
        hours: { schedule: { mon: [] } },
        llm: { maxTokens: 800, temperature: 0.2 },
    },
};

const TENANT = {
    settings: { businessHours: { schedule: { mon: [] } } },
    industry: 'saas',
    updatedAt: '2026-09-01T00:00:00.000Z',
    channelLookupAvailable: true,
    humanLookupAvailable: true,
    activeChannelTypes: new Set<string>(['whatsapp']),
    activeAccountBindings: new Set<string>(),
    activeHumanCount: 1,
    channelCredentialHealth: new Map<string, string>([['whatsapp', 'ok']]),
    channelTypeSummary: [],
    activeAccountCount: 1,
};

const FACTS = {
    unavailableSources: [],
    company: { name: 'Parallly', about: 'x' },
    companyUpdatedAt: null,
    knowledgeChunks: 1, knowledgeUpdatedAt: null,
    faqs: 1, faqsUpdatedAt: null,
    policies: 1, policiesUpdatedAt: null,
    services: 1, availabilitySlots: 1, testDriveServices: 1, testDriveSlots: 1,
    vehicles: 1, products: 1, orders: 1, offers: 1,
    verticalCatalogs: {},
};

const preparation = service.buildPreparation(AGENT, TENANT, FACTS);
const checkCodes: string[] = preparation.dimensions
    .flatMap((dimension: any) => dimension.checks)
    .map((check: any) => check.code);

/** No evaluation, no simulation, no production sample: the pillar codes all fire. */
const EMPTY_TESTED = { status: 'unknown', score: null, stale: false, staleReasons: [], latestEval: null, latestSimulation: null };
const EMPTY_PRODUCTION = { status: 'insufficient_evidence', sampleSize: 0, minimumSample: 20, topIssues: [] };
const emptyProductionFacts = (over: Record<string, unknown> = {}) => ({
    available: false, attributedSince: null, sampleSize: 0, avgOverall: null,
    verifiedResolutionTotal: 0, verifiedResolutionSuccess: 0, conversationCount: 0, handoffCount: 0,
    flagRows: [], lowQualityConversationIds: [], unverifiedConversationIds: [],
    toolTotal: 0, toolFailures: 0, toolReconciliations: 0, toolFailureConversationIds: [],
    knowledgeGaps: 0, knowledgeGapConversationIds: [], ...over,
});

/**
 * Recommendations are capped at twenty, so a single call with every check would
 * silently drop most of them and this test would pass on a fraction of the
 * universe. The checks go through the real builder in small batches instead.
 */
function recommendationCodes(): string[] {
    const codes = new Set<string>();
    const failing = preparation.dimensions.flatMap((dimension: any) => dimension.checks)
        .map((check: any) => ({ ...check, status: 'fail' as const }));
    for (let index = 0; index < failing.length; index += 12) {
        const batch = failing.slice(index, index + 12);
        for (const item of service.buildRecommendations(
            { dimensions: [{ checks: batch }] }, EMPTY_TESTED, EMPTY_PRODUCTION, emptyProductionFacts(),
        )) codes.add(item.code);
    }
    // The production half, driven from facts rather than from checks.
    for (const item of service.buildRecommendations(
        { dimensions: [] },
        { ...EMPTY_TESTED, latestEval: { passed: false, activable: false, score: 1, threshold: 7 }, stale: true },
        { ...EMPTY_PRODUCTION, status: 'insufficient_evidence' },
        emptyProductionFacts({
            available: true, sampleSize: 30, avgOverall: 3, verifiedResolutionTotal: 30, verifiedResolutionSuccess: 1,
            toolTotal: 10, toolFailures: 5, toolReconciliations: 1, knowledgeGaps: 3,
        }),
    )) codes.add(item.code);
    // And the flag classes, which reach a person as `investigate_<class>`.
    for (const item of service.buildRecommendations(
        { dimensions: [] }, EMPTY_TESTED,
        {
            ...EMPTY_PRODUCTION,
            topIssues: AGENT_QUALITY_ISSUE_CODES.slice(0, 5).map(code => ({ code, label: code, count: 2, conversationIds: [] })),
        },
        emptyProductionFacts(),
    )) codes.add(item.code);
    return [...codes];
}

describe('every blocker and recommendation has a resolution', () => {
    it('builds a real universe, not an empty one', () => {
        // A broken fixture would make every claim below pass against nothing.
        expect(checkCodes.length).toBeGreaterThan(40);
        expect(new Set(checkCodes).size).toBe(checkCodes.length);
        // The thirteen vertical codes come from a loop, so their presence is the
        // proof that this is the running code and not a list of literals.
        expect(checkCodes).toContain('tool_professional_services');
        expect(checkCodes).toContain('tool_real_estate');
    });

    it('the table is internally sound', () => {
        expect(agentIssueResolutionDefects()).toEqual([]);
    });

    it('resolves every check the preparation pillar emits', () => {
        const unresolved = checkCodes.filter(code => !resolutionForIssueCode(code));
        expect({ unresolved }).toEqual({ unresolved: [] });
    });

    it('resolves every code a recommendation can carry', () => {
        const codes = recommendationCodes();
        expect(codes.length).toBeGreaterThan(40);
        const unresolved = codes.filter(code => !resolutionForIssueCode(code));
        expect({ unresolved }).toEqual({ unresolved: [] });
        // The two prefixes are the whole reason the lookup is a function and not
        // a map read, so both are exercised rather than assumed.
        expect(codes.some(code => code.startsWith('fix_tool_'))).toBe(true);
        expect(codes.some(code => code.startsWith('investigate_qa_'))).toBe(true);
    });

    it('resolves every class a production flag can be bucketed into', () => {
        const unresolved = AGENT_QUALITY_ISSUE_CODES.filter(code => !resolutionForIssueCode(code));
        expect({ unresolved }).toEqual({ unresolved: [] });
    });

    it('fails for a code nobody declared', () => {
        // Without this the contract could be satisfied by a lookup that answers
        // for everything, which would protect nothing.
        expect(resolutionForIssueCode('tool_unicorns')).toBeNull();
        expect(resolutionForIssueCode('fix_tool_unicorns')).toBeNull();
        expect(resolutionForIssueCode('')).toBeNull();
        expect(resolutionForIssueCode(undefined)).toBeNull();
    });

    it('carries nothing the table does not need', () => {
        const codes = new Set(checkCodes);
        for (const code of AGENT_QUALITY_ISSUE_CODES) codes.add(code);
        for (const code of ['run_eval', 'refresh_eval', 'fix_failed_eval', 'run_simulation',
            'collect_production_evidence', 'improve_verified_resolution', 'review_low_quality_conversations',
            'review_tool_failures', 'resolve_knowledge_gaps']) codes.add(code);
        // A resolution for a code nothing emits is dead weight that will be read
        // as a promise the product does not keep.
        const orphans = AGENT_ISSUE_RESOLUTIONS.map(row => row.code).filter(code => !codes.has(code));
        expect({ orphans }).toEqual({ orphans: [] });
    });

    it('every Assist resolution names an operation Assist actually has', () => {
        for (const resolution of AGENT_ISSUE_RESOLUTIONS) {
            if (!resolution.operation) continue;
            const definition = getAgentOperation(resolution.operation)!;
            expect(definition).toBeDefined();
            expect(definition.availability).toBe(
                resolution.kind === 'assist_operation' ? 'executable' : 'route_to_screen');
        }
    });
});

/**
 * The two places where the obvious answer is the wrong one, pinned against the
 * code that makes them wrong rather than against a comment. If somebody later
 * points the FAQ operation at the `faqs` table, or lets the legal-text
 * operation write into `policies`, these fail and the table has to be corrected
 * instead of quietly becoming a lie.
 */
describe('the writes that look like they would fix a check, and do not', () => {
    const source = fs.readFileSync(path.join(__dirname, 'agent-quality.service.ts'), 'utf8');

    it('names both cases, with a reason', () => {
        const pairs = misleadingAssistOperations();
        expect(pairs.map(pair => pair.code).sort()).toEqual(['tool_faqs', 'tool_policies']);
        for (const pair of pairs) expect(pair.because.length).toBeGreaterThan(60);
    });

    it('tool_faqs counts a different table from the one the FAQ operation writes', () => {
        expect(getAgentOperation('knowledge.faq.create')!.target.table).toBe('knowledge_resources');
        // The check's number comes from `faqs`, and only published rows count.
        expect(source).toMatch(/'faqs',\s*`SELECT COUNT\(\*\)::int AS count[\s\S]{0,120}FROM faqs/);
        expect(source).toMatch(/FROM faqs\s*\n\s*WHERE is_published = true/);
    });

    it('tool_policies counts a different table from the one the legal-text operation writes', () => {
        expect(getAgentOperation('policies.legal_text.create')!.target.table).toBe('legal_text_versions');
        expect(source).toMatch(/'policies',\s*`SELECT COUNT\(\*\)::int AS count[\s\S]{0,120}FROM policies/);
        expect(source).toMatch(/FROM policies\s*\n\s*WHERE is_active = true/);
    });

    it('no other executable operation is claimed to close a check it cannot reach', () => {
        // Every `assist_operation` resolution that says `closes` is asserting the
        // check reads what the operation writes. The three tables involved are
        // named here so the claim is a fact about the registry, not a hope.
        const closes = AGENT_ISSUE_RESOLUTIONS.filter(row => row.kind === 'assist_operation' && row.clears === 'closes');
        const tables = new Set(closes.map(row => getAgentOperation(row.operation!)!.target.table));
        expect([...tables].sort()).toEqual(['courses', 'knowledge_resources', 'services']);
        // And the operations themselves are still the four the contract declares.
        expect(AGENT_OPERATION_REGISTRY.filter(row => row.availability === 'executable')).toHaveLength(4);
    });
});
