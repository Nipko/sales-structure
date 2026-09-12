import { DASHBOARD_PAGE_RULES } from '@parallext/shared';
/**
 * Centralized role gating for the dashboard.
 *
 * The 4 roles are:
 *   - super_admin       — platform operator. Manages tenants, billing,
 *                         observability, global config. Has its own UI surface
 *                         distinct from any tenant view. Tenant-operational
 *                         pages are hidden unless impersonation is active.
 *   - tenant_admin      — tenant owner. Full control of their workspace
 *                         including billing, users, channels, agent config.
 *   - tenant_supervisor — manager / team lead. CRM, broadcasts, automation,
 *                         analytics. Cannot edit billing, channels or users.
 *   - tenant_agent      — operational only. Inbox, contacts (their leads),
 *                         appointments, knowledge base read access.
 *
 * Use the helpers below in components instead of inline string equality
 * checks so role logic stays consistent across the app.
 */

export type Role = "super_admin" | "tenant_admin" | "tenant_supervisor" | "tenant_agent" | string;

export const ROLE_KEYS = {
    SUPER_ADMIN: "super_admin",
    TENANT_ADMIN: "tenant_admin",
    TENANT_SUPERVISOR: "tenant_supervisor",
    TENANT_AGENT: "tenant_agent",
    TENANT_VIEWER: "tenant_viewer",
} as const;

// ── Hierarchy helpers ──────────────────────────────────────────

export const isSuperAdmin = (role?: Role | null): boolean =>
    role === ROLE_KEYS.SUPER_ADMIN;

export const isTenantAdmin = (role?: Role | null): boolean =>
    role === ROLE_KEYS.TENANT_ADMIN;

/** super_admin OR tenant_admin */
export const isAdmin = (role?: Role | null): boolean =>
    isSuperAdmin(role) || isTenantAdmin(role);

/** isAdmin OR tenant_supervisor — anyone with elevated capabilities */
export const isSupervisor = (role?: Role | null): boolean =>
    isAdmin(role) || role === ROLE_KEYS.TENANT_SUPERVISOR;

export const isAgentOnly = (role?: Role | null): boolean =>
    role === ROLE_KEYS.TENANT_AGENT;

// ── Impersonation ──────────────────────────────────────────────

/**
 * super_admin can impersonate any tenant and operate inside their workspace.
 * When impersonating, the user object reflects the impersonated user, but
 * we keep a token-rollback record in localStorage. Tenant-operational pages
 * become accessible *during impersonation* even though the underlying
 * super_admin role wouldn't normally allow them.
 *
 * Server-side this returns false (no localStorage) — that's intentional
 * because all gating that matters runs in the client-side useRole hook.
 */
export function isImpersonating(): boolean {
    if (typeof window === "undefined") return false;
    try {
        return Boolean(localStorage.getItem("impersonation"));
    } catch {
        return false;
    }
}

// ── Page access matrix ─────────────────────────────────────────
//
// Truth table for which roles can SEE a given page. URL-level guards in
// the admin layout consult this. Feature-level gating (button visibility)
// uses the more granular CAPABILITIES below.

export type PageScope = "platform" | "tenant_admin" | "tenant_supervisor" | "tenant_operational" | "shared";

interface PageRule {
    /** Path prefix this rule applies to (e.g. "/admin/tenants") */
    prefix: string;
    /** Roles that can access without impersonation */
    roles: Role[];
    /** If true, super_admin can access ONLY through impersonation */
    requiresImpersonationForSuperAdmin?: boolean;
    /**
     * Match the path exactly instead of as a prefix. Lets a hub page stay open
     * while everything nested under it is gated by a separate prefix rule
     * (used by "/admin" and "/admin/settings").
     */
    exact?: boolean;
}

/**
 * The table moved to `@parallext/shared` so the API can read it too: Assist
 * was telling readers to open screens their role is denied, because the server
 * had no way to ask this question. Re-exported under the old name, so every
 * existing importer and `roles.spec.ts` keep working against one source.
 */
export const PAGE_RULES: PageRule[] = DASHBOARD_PAGE_RULES as unknown as PageRule[];


/**
 * Resolve whether a role can see a path. Checks longest prefix first.
 * Returns true when allowed; false when the URL guard should redirect.
 */
export function canAccessPath(
    pathname: string,
    role: Role | null | undefined,
    impersonating: boolean,
): boolean {
    if (!role) return false;

    // Exact rules win, so a hub page ("/admin", "/admin/settings") stays open
    // without opening everything nested under it.
    const exactRule = PAGE_RULES.find(r => r.exact && pathname === r.prefix);

    // Sort by prefix length descending so /admin/settings/billing wins over /admin/settings
    const sorted = [...PAGE_RULES].filter(r => !r.exact).sort((a, b) => b.prefix.length - a.prefix.length);
    const rule = exactRule
        ?? sorted.find(r => pathname === r.prefix || pathname.startsWith(r.prefix + "/") || pathname.startsWith(r.prefix + "?"));

    // Fail closed for every role. A new page must declare its audience here and
    // in the navigation registry instead of becoming reachable by guessing a URL.
    if (!rule) return false;

    if (!rule.roles.includes(role)) return false;

    // super_admin restricted by impersonation flag
    if (rule.requiresImpersonationForSuperAdmin && isSuperAdmin(role) && !impersonating) {
        return false;
    }

    return true;
}

/** Default landing page based on role + impersonation. */
export function defaultLandingForRole(role?: Role | null, impersonating?: boolean): string {
    if (isSuperAdmin(role) && !impersonating) return "/admin/tenants";
    if (role === ROLE_KEYS.TENANT_AGENT) return "/admin/inbox";
    if (role === ROLE_KEYS.TENANT_VIEWER) return "/admin/settings/profile";
    return "/admin";
}

// ── Capability flags (for component-level gating) ──────────────
//
// Use these for buttons, menu items, action visibility — anything that
// isn't a full page redirect. Keep names verb-shaped so reads naturally
// in JSX (e.g. {canEditAgent && <button…>}).

export interface Capabilities {
    canManagePlatform: boolean;       // tenants list, financials, audit, health
    canImpersonate: boolean;          // super_admin only
    canManageBilling: boolean;        // tenant_admin (their own) or super_admin (any)
    canManageUsers: boolean;          // tenant_admin or super_admin (impersonating)
    canManageChannels: boolean;       // OAuth connect/disconnect, tokens
    canEditAgent: boolean;            // edit AI persona, prompts, tools
    canEditPipeline: boolean;         // change stages structure, scoring weights
    canEditKnowledge: boolean;        // upload docs, edit FAQs/policies
    canViewKnowledge: boolean;        // read-only KB access
    canSendBroadcast: boolean;        // mass campaigns
    canEditAutomation: boolean;       // rules + sequences
    canSeeGlobalAnalytics: boolean;   // tenant-wide analytics
    canSeeOwnPerformance: boolean;    // agent's own KPIs
    canManageContacts: boolean;       // create/edit/delete leads
    canViewContacts: boolean;         // read-only CRM
    canHandleConversations: boolean;  // inbox, send messages, take handoffs
    canManageSettings: boolean;       // edit any non-personal settings
}

export function getCapabilities(role: Role | null | undefined, impersonating: boolean): Capabilities {
    const sa = isSuperAdmin(role);
    const ta = isTenantAdmin(role);
    const sup = role === ROLE_KEYS.TENANT_SUPERVISOR;
    const ag = role === ROLE_KEYS.TENANT_AGENT;
    const saImp = sa && impersonating;

    return {
        canManagePlatform: sa,
        canImpersonate: sa,
        canManageBilling: ta || saImp,
        canManageUsers: ta || saImp,
        canManageChannels: ta || saImp,
        canEditAgent: ta || saImp,
        canEditPipeline: ta || sup || saImp,
        canEditKnowledge: ta || sup || saImp,
        canViewKnowledge: ta || sup || ag || saImp,
        canSendBroadcast: ta || sup || saImp,
        canEditAutomation: ta || sup || saImp,
        canSeeGlobalAnalytics: ta || sup || saImp,
        canSeeOwnPerformance: ta || sup || ag || saImp,
        canManageContacts: ta || sup || ag || saImp,
        canViewContacts: ta || sup || ag || saImp,
        canHandleConversations: ta || sup || ag || saImp,
        canManageSettings: ta || sup || saImp,
    };
}
