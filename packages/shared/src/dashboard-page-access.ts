/**
 * ═══ WHICH ROLE MAY OPEN WHICH SCREEN, IN ONE PLACE ═══
 *
 * This table used to live only in the dashboard, and the API could not read
 * it. That mattered the moment Parallly Assist started telling people where to
 * go: `copilot.service.ts` injected every route an article declares into the
 * model's context without knowing who was reading, so a supervisor asking why
 * WhatsApp stopped answering was sent to `/admin/channels/whatsapp`, and an
 * agent asking about a campaign to `/admin/broadcast` — both of which the
 * dashboard denies them. Nineteen such pairs existed across the knowledge base.
 *
 * The alternative was a second copy of the table inside the API, which is the
 * failure this repository keeps finding: two lists that agree until one of them
 * is edited. So the DATA moved here and both sides read it. The dashboard keeps
 * its own logic — impersonation, redirects — because that is a dashboard
 * concern; what is shared is the fact.
 *
 * Deny by default: a path no rule matches belongs to nobody. Every new
 * super_admin page therefore needs a line here or it is closed, which is the
 * governance rule `docs/superadmin-governance.md` states and the one place it
 * can be enforced.
 */

export const DASHBOARD_ROLE_KEYS = {
    SUPER_ADMIN: 'super_admin',
    TENANT_ADMIN: 'tenant_admin',
    TENANT_SUPERVISOR: 'tenant_supervisor',
    TENANT_AGENT: 'tenant_agent',
    TENANT_VIEWER: 'tenant_viewer',
} as const;

export type DashboardRole = (typeof DASHBOARD_ROLE_KEYS)[keyof typeof DASHBOARD_ROLE_KEYS];

export interface DashboardPageRule {
    /** Route prefix, or the exact path when `exact` is set. */
    readonly prefix: string;
    /** Roles that can open it without impersonation. */
    readonly roles: readonly DashboardRole[];
    /** super_admin reaches it ONLY through impersonation. */
    readonly requiresImpersonationForSuperAdmin?: boolean;
    /**
     * Match the path exactly instead of as a prefix. Lets a hub page stay open
     * while everything nested under it is gated by a separate prefix rule.
     */
    readonly exact?: boolean;
}

const ROLE_KEYS = DASHBOARD_ROLE_KEYS;
export const DASHBOARD_PAGE_RULES: readonly DashboardPageRule[] = [
    // ── Hub pages: exact match so the page itself stays open while the
    //    tenant-scoped routes nested under it are gated separately ──
    { prefix: "/admin", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], exact: true },
    { prefix: "/admin/settings", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT, ROLE_KEYS.TENANT_VIEWER], exact: true },

    // ── Platform-only (super_admin always; no one else) ──────
    { prefix: "/admin/tenants", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/ops", roles: [ROLE_KEYS.SUPER_ADMIN] },
    // Rollout, kill switch and the reconciliation queue. Deliberately NOT
    // behind impersonation: it decides how replies leave the system for every
    // tenant at once, and turning it off must never require entering one.
    { prefix: "/admin/dispatch", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/incidents", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/fiscal", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/managed", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/storage", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/plans", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/billing-ops", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/sms-packages", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/financials", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/health", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/usage", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/audit", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/llm-stats", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/webhooks", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/compliance-admin", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/funnel", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/vertical-analytics", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/vertical-audit", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/coupons", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/settings/platform", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/settings/ai-providers", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/settings/ai-config", roles: [ROLE_KEYS.SUPER_ADMIN] },
    { prefix: "/admin/settings/channels", roles: [ROLE_KEYS.SUPER_ADMIN] },

    // Read-only quality evidence is visible to supervisors. Agent editing below
    // remains tenant_admin-only.
    { prefix: "/admin/agent/quality", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },

    // ── Tenant_admin only (also super_admin when impersonating) ─
    { prefix: "/admin/users", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN], requiresImpersonationForSuperAdmin: true },
    // Covers the editor and every workspace hanging off an agent, publication
    // included. A rule cannot name a dynamic segment — the matcher is
    // prefix-based — so `/admin/agent/:agentId/publications` is governed here,
    // and `roles.spec.ts` pins that audience so widening this line is a
    // deliberate act rather than a side effect.
    { prefix: "/admin/agent", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/channels", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/compliance", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/settings/billing", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/settings/recall", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/settings/company", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/settings/business-info", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/settings/policies", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/settings/localization", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/settings/business-hours", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/settings/fiscal", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/settings/nurturing", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/settings/integrations", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/settings/api-keys", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/setup-wizard", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN], requiresImpersonationForSuperAdmin: true },

    // ── Supervisor+ (admin and supervisor; super_admin via impersonation) ─
    { prefix: "/admin/broadcast", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/automation", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/knowledge", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/conversations", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/identity", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/crm-analytics", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/analytics-v2", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/report-builder", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    // Ventas es dinero del negocio: sólo el dueño, igual que Facturación.
    { prefix: "/admin/sales", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/attribution", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/procedures", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/agent-analytics", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/contacts/organizations", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    // Los casos del estudio. Los ve quien los trabaja, incluido el agente
    // humano: es su cola de trabajo, no una pantalla de configuración.
    { prefix: "/admin/cases", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/settings/pipeline", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/settings/scoring-config", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/settings/alerts", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/settings/email-templates", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/settings/macros", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/settings/prechat", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/settings/public-booking", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/settings/custom-attributes", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/settings/media", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },

    // ── Operational (everyone in the tenant; super_admin via impersonation) ─
    { prefix: "/admin/operational-notices", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/inbox", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/contacts", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/pipeline", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/appointments", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT], requiresImpersonationForSuperAdmin: true },
    // Catalog management — admin + supervisor only (agents don't manage inventory/catalogs)
    { prefix: "/admin/properties", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/tours", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    // Los registros operativos SÍ incluyen al agente, a diferencia de los
    // catálogos de arriba: quien cierra una reserva en una conversación tiene
    // que poder encontrarla después. Administrar el alojamiento sigue siendo
    // trabajo de supervisor.
    { prefix: "/admin/stays", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/tour-bookings", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/listings", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/menu", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/vehicles", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    // Operational items — agents need access (taking orders, dispatching, treating customers)
    { prefix: "/admin/food-orders", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/resource-rentals", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/repair-orders", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT], requiresImpersonationForSuperAdmin: true },
    // Mixta: el padrón de socios con congelar y renovar es trabajo de todos
    // los días. Los planes se gatean DENTRO de la pantalla, no cerrándola.
    { prefix: "/admin/memberships", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/classes", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/courses", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    // Mixta: cotizaciones, pólizas y siniestros son operación pura; sólo la
    // pestaña de planes es catálogo.
    { prefix: "/admin/insurance", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/service-requests", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/treatment-plans", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/pets", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT], requiresImpersonationForSuperAdmin: true },
    // Registro: las sesiones de un estudio. Su catálogo real son los paquetes,
    // que viven en /admin/service-catalog y siguen siendo de supervisión.
    { prefix: "/admin/photo-sessions", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT], requiresImpersonationForSuperAdmin: true },
    // Catálogo: mismo permiso que el resto de los catálogos, no el del que opera.
    { prefix: "/admin/service-catalog", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/inventory", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/orders", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/catalog", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/landings", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR], requiresImpersonationForSuperAdmin: true },
    { prefix: "/admin/feature-requests", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT] },

    // ── Always allowed (settings root + personal settings) ───
    { prefix: "/admin/settings/profile", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT, ROLE_KEYS.TENANT_VIEWER] },
    { prefix: "/admin/settings/security", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT, ROLE_KEYS.TENANT_VIEWER] },
    { prefix: "/admin/settings/notifications", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT, ROLE_KEYS.TENANT_VIEWER] },
    { prefix: "/admin/settings/appearance", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT, ROLE_KEYS.TENANT_VIEWER] },
    { prefix: "/admin/settings/change-password", roles: [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT, ROLE_KEYS.TENANT_VIEWER] },
];
/**
 * The rule that governs a path, longest prefix first, or `null`.
 *
 * Exact rules win, so a hub page stays open without opening what is nested
 * under it — the same ordering `canAccessPath` applies, kept here so a second
 * reader cannot resolve a path differently from the guard.
 */
export function dashboardPageRuleFor(pathname: string): DashboardPageRule | null {
    const exact = DASHBOARD_PAGE_RULES.find(rule => rule.exact && rule.prefix === pathname);
    if (exact) return exact;
    return [...DASHBOARD_PAGE_RULES]
        .filter(rule => !rule.exact)
        .sort((left, right) => right.prefix.length - left.prefix.length)
        .find(rule => pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`))
        ?? null;
}

/**
 * Can this role open this path at all?
 *
 * Deliberately ignores impersonation: this answers the question a SERVER has
 * — “may I tell this person to go here” — and a super_admin who has to
 * impersonate to reach a screen is not somebody to send there unprompted.
 */
export function dashboardRoleCanOpen(pathname: string, role: string): boolean {
    const rule = dashboardPageRuleFor(pathname);
    if (!rule) return false;
    if (!(rule.roles as readonly string[]).includes(role)) return false;
    return !(role === DASHBOARD_ROLE_KEYS.SUPER_ADMIN && rule.requiresImpersonationForSuperAdmin);
}
