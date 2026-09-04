/**
 * Guided tours ("Mostrarme dónde") — the contract shared by the API and the
 * dashboard.
 *
 * The API decides WHICH tour is relevant (from a quality signal, or from a
 * bounded marker the assistant model may emit) and validates it against this
 * registry; the dashboard owns HOW each tour is rendered (routes, anchors and
 * step copy live in `apps/dashboard/src/lib/guided-tours.ts`).
 *
 * Rules:
 * - Only ids in this registry can ever reach the UI. A model-emitted marker
 *   with an unknown id is dropped, never rendered.
 * - Tours never change data: they open a screen and highlight where a person
 *   does something. The person still performs the change.
 * - `minRole` is the least-privileged role that can run the tour. A tour that
 *   ends in an editor an admin owns is admin-only; supervisors get review tours.
 */

export const GUIDED_TOUR_IDS = [
    'connect_channel',
    'assign_agent_channel',
    'agent_handoff_rules',
    'human_handoff_route',
    'business_identity',
    'knowledge_base',
    'appointments_setup',
    'business_hours',
    'run_agent_tests',
    'agent_quality_center',
    // Onboarding and on-screen help ("configurable por cualquiera", Part II).
    'home_first_steps',
    'first_channel_whatsapp',
    'resume_setup_wizard',
    'help_system',
    'inbox_first_conversation',
] as const;

export type GuidedTourId = typeof GUIDED_TOUR_IDS[number];

export type GuidedTourMinRole = 'tenant_admin' | 'tenant_supervisor' | 'tenant_agent';

export interface GuidedTourDefinition {
    id: GuidedTourId;
    /** Entry route: the runner navigates here before starting the first step. */
    route: `/admin${string}`;
    /** Least-privileged role that can run the tour. */
    minRole: GuidedTourMinRole;
    /**
     * Quality check / recommendation codes this tour helps to resolve. Both the
     * bare check code (`channel_connection`) and its recommendation form
     * (`fix_channel_connection`) resolve to the same tour.
     */
    qualityCodes: readonly string[];
    /** Assistant KB article ids whose topic this tour walks through. */
    kbArticleIds: readonly string[];
    /**
     * True for tours that explain the shell itself (help panel, palette,
     * assistant). The runner keeps the user where they are instead of
     * navigating to `route`, which is only the fallback link for mobile.
     */
    stayOnCurrentRoute?: boolean;
}

export const GUIDED_TOURS: readonly GuidedTourDefinition[] = [
    {
        id: 'connect_channel',
        route: '/admin/channels',
        minRole: 'tenant_admin',
        qualityCodes: ['channel_connection', 'channel_coverage'],
        kbArticleIds: ['canales-whatsapp', 'canales-redes', 'canales-email-widget', 'multi-cuenta', 'primeros-pasos'],
    },
    {
        id: 'assign_agent_channel',
        route: '/admin/agent',
        minRole: 'tenant_admin',
        qualityCodes: ['channel_assignment', 'operational_channel_scope', 'channel_coverage'],
        kbArticleIds: ['agentes-ia', 'multi-cuenta'],
    },
    {
        id: 'agent_handoff_rules',
        route: '/admin/agent',
        minRole: 'tenant_admin',
        qualityCodes: ['handoff_triggers', 'forbidden_topics', 'fallback_message', 'behavior_rules', 'persona_identity', 'custom_prompt', 'greeting', 'brand_voice'],
        kbArticleIds: ['agentes-ia'],
    },
    {
        id: 'human_handoff_route',
        route: '/admin/users',
        minRole: 'tenant_admin',
        qualityCodes: ['human_handoff_route'],
        kbArticleIds: ['configuracion-gobierno', 'inbox'],
    },
    {
        id: 'business_identity',
        route: '/admin/settings/business-info',
        minRole: 'tenant_admin',
        qualityCodes: ['business_identity', 'business_contact', 'business_context'],
        kbArticleIds: ['navegacion-configuracion', 'primeros-pasos'],
    },
    {
        id: 'knowledge_base',
        route: '/admin/knowledge',
        minRole: 'tenant_admin',
        qualityCodes: ['knowledge_coverage', 'rag_knowledge', 'tool_faqs', 'resolve_knowledge_gaps'],
        kbArticleIds: ['base-conocimiento'],
    },
    {
        id: 'appointments_setup',
        route: '/admin/appointments',
        minRole: 'tenant_admin',
        qualityCodes: ['tool_appointments'],
        kbArticleIds: ['citas-calendarios'],
    },
    {
        id: 'business_hours',
        route: '/admin/settings/business-hours',
        minRole: 'tenant_admin',
        qualityCodes: ['business_hours', 'after_hours_behavior'],
        kbArticleIds: ['navegacion-configuracion'],
    },
    {
        id: 'run_agent_tests',
        route: '/admin/agent/simulation',
        minRole: 'tenant_admin',
        qualityCodes: ['run_eval', 'refresh_eval', 'fix_failed_eval', 'run_simulation'],
        kbArticleIds: ['probar-agente', 'centro-calidad-agente'],
    },
    {
        id: 'agent_quality_center',
        route: '/admin/agent/quality',
        minRole: 'tenant_supervisor',
        qualityCodes: [
            'collect_production_evidence', 'improve_verified_resolution', 'review_low_quality_conversations',
            'review_tool_failures',
        ],
        kbArticleIds: ['centro-calidad-agente'],
    },
    {
        id: 'home_first_steps',
        route: '/admin',
        minRole: 'tenant_supervisor',
        qualityCodes: [],
        kbArticleIds: ['primeros-pasos'],
    },
    {
        id: 'first_channel_whatsapp',
        route: '/admin/channels/whatsapp',
        minRole: 'tenant_admin',
        qualityCodes: ['channel_connection'],
        kbArticleIds: ['canales-whatsapp', 'primeros-pasos'],
    },
    {
        id: 'resume_setup_wizard',
        route: '/admin/setup-wizard',
        minRole: 'tenant_admin',
        qualityCodes: [],
        kbArticleIds: ['primeros-pasos'],
    },
    {
        id: 'help_system',
        route: '/admin',
        minRole: 'tenant_agent',
        qualityCodes: [],
        kbArticleIds: ['navegacion-configuracion', 'primeros-pasos'],
        stayOnCurrentRoute: true,
    },
    {
        id: 'inbox_first_conversation',
        route: '/admin/inbox',
        minRole: 'tenant_agent',
        qualityCodes: [],
        kbArticleIds: ['inbox'],
    },
];

/** Event the dashboard runner listens to. `detail` is a GuidedTourStartDetail. */
export const GUIDED_TOUR_START_EVENT = 'parallly:start-guided-tour' as const;

export interface GuidedTourStartDetail {
    tourId: GuidedTourId;
    /** Optional quality context so the runner can keep the focus banner in sync. */
    signalId?: string;
    agentId?: string;
}

/**
 * Bounded marker the assistant model may append to a reply when it is
 * pointing the user to a place in the panel. The server strips every marker
 * from the reply and only keeps the FIRST one whose id is registered and
 * allowed for the authenticated role.
 */
export const GUIDED_TOUR_MARKER_PATTERN = /\[\[\s*tour\s*:\s*([a-z_]{1,64})\s*\]\]/gi;

const ROLE_RANK: Record<string, number> = {
    tenant_agent: 0,
    tenant_supervisor: 1,
    tenant_admin: 2,
    super_admin: 2,
};

const TOURS_BY_ID: ReadonlyMap<GuidedTourId, GuidedTourDefinition> = new Map(
    GUIDED_TOURS.map((tour) => [tour.id, tour]),
);

export function isGuidedTourId(value: unknown): value is GuidedTourId {
    return typeof value === 'string' && TOURS_BY_ID.has(value as GuidedTourId);
}

export function getGuidedTour(id: unknown): GuidedTourDefinition | null {
    return isGuidedTourId(id) ? TOURS_BY_ID.get(id) ?? null : null;
}

/** True when `role` may run the tour (impersonating super_admin counts as admin). */
export function canRoleRunGuidedTour(tour: GuidedTourDefinition, role: string | null | undefined): boolean {
    if (!role) return false;
    const rank = ROLE_RANK[role];
    if (rank === undefined) return false;
    return rank >= ROLE_RANK[tour.minRole];
}

/**
 * Resolve the tour that helps with a quality check or recommendation code.
 * Accepts `fix_<check>` recommendation codes as well as bare check codes.
 */
export function findGuidedTourForQualityCode(code: unknown): GuidedTourDefinition | null {
    if (typeof code !== 'string' || !code) return null;
    const normalized = code.trim().toLowerCase();
    const candidates = normalized.startsWith('fix_')
        ? [normalized, normalized.slice(4)]
        : [normalized];
    for (const tour of GUIDED_TOURS) {
        if (candidates.some((candidate) => tour.qualityCodes.includes(candidate))) return tour;
    }
    return null;
}

/** Tours whose topic overlaps the retrieved KB articles and that `role` may run. */
export function guidedToursForArticles(
    articleIds: readonly string[],
    role: string | null | undefined,
): GuidedTourDefinition[] {
    const wanted = new Set(articleIds);
    return GUIDED_TOURS.filter((tour) =>
        canRoleRunGuidedTour(tour, role)
        && tour.kbArticleIds.some((articleId) => wanted.has(articleId)));
}

/**
 * Extract the first allowed tour marker from model text and return the text
 * with EVERY marker removed (allowed or not). `allowed` bounds what the model
 * may trigger in this turn; anything else is dropped silently.
 */
export function extractGuidedTourMarker(
    text: string,
    allowed: readonly GuidedTourDefinition[],
): { text: string; tourId: GuidedTourId | null } {
    if (!text) return { text: '', tourId: null };
    const allowedIds = new Set(allowed.map((tour) => tour.id));
    let tourId: GuidedTourId | null = null;
    const pattern = new RegExp(GUIDED_TOUR_MARKER_PATTERN.source, GUIDED_TOUR_MARKER_PATTERN.flags);
    for (const match of text.matchAll(pattern)) {
        const candidate = match[1].toLowerCase();
        if (!tourId && isGuidedTourId(candidate) && allowedIds.has(candidate)) tourId = candidate;
    }
    const stripped = text
        .replace(new RegExp(GUIDED_TOUR_MARKER_PATTERN.source, GUIDED_TOUR_MARKER_PATTERN.flags), '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return { text: stripped, tourId };
}
