import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Every controller either carries the three guards, or says what protects it
 * instead.
 *
 * The rule this repository works to is `@UseGuards(AuthGuard('jwt'),
 * RolesGuard, TenantGuard)` on anything a tenant can reach, and it is written
 * down in CLAUDE.md. What was never written down is the exception list — and
 * the exceptions are the interesting half: sixteen controllers have no JWT
 * guard at all, and every one of them is defensible by NAME. A webhook. A
 * public booking page. An iCal feed. That is exactly the shape of a list
 * nobody re-reads, and the seventeenth one to arrive would look just as
 * plausible.
 *
 * So the list is here, each entry saying what actually authenticates it, and
 * the sweep fails on a controller that appears in neither category. The point
 * is not that the sweep knows which answer is right — it cannot — it is that a
 * new unguarded controller cannot land without somebody writing a sentence
 * about why.
 *
 * ── Three categories, not two ───────────────────────────────────────────────
 *
 * The rule as written has an exception the code has always relied on and nobody
 * had stated: a super_admin in platform mode has NO tenant, so `TenantGuard` is
 * not a missing guard there, it is the wrong one. Nineteen controllers sit in
 * that shape. Collapsing them into "unguarded" would make the list unreadable
 * and the real finding invisible — which is exactly what happened the first
 * time this sweep ran.
 *
 * So: tenant-scoped carries all three, platform-scoped carries authentication
 * and roles and says why it has no tenant, unauthenticated says what stands in
 * for a session. Anything else fails.
 *
 * What this cannot catch, said out loud: a controller that carries all three
 * guards and then exposes a route with `@Public()` on it, or one whose guard is
 * present but whose handler reads a tenant id from the body instead of the
 * token. Those are read by `roles.ts`'s own deny-by-default rules and by the
 * tenant-scope specs; this is the coarser net that stops a whole surface
 * arriving unprotected.
 */

const MODULES = resolve(__dirname, '..', '..', 'modules');

/**
 * Controllers reached without a tenant session, and what stands in for one.
 * Some carry their own key or signature; the ones that say "public by design"
 * are pages anybody may open, and those entries have to justify themselves
 * hardest — that phrase is a decision, not a description.
 */
const UNAUTHENTICATED: Readonly<Record<string, string>> = Object.freeze({
    'bi-api.controller.ts':
        'X-API-Key through `BiApiGuard`: a per-tenant key the tenant issues and can revoke, for their own BI tools',
    'public-api.controller.ts':
        '`PublicApiGuard` plus a rate limit and a scope guard — the tenant\'s own API key, scoped per endpoint',
    'mcp-rpc.controller.ts':
        '`PublicApiGuard` with X-API-Key: the MCP surface a tenant exposes to their own agent tooling',
    'internal.controller.ts':
        '`InternalAuthGuard` on INTERNAL_API_KEY. Service-to-service only; never routed to the public ingress',
    'customer-portal.controller.ts':
        'X-Portal-Token, a magic-link JWT typed `customer`. Not a dashboard session and deliberately cannot become one',
    'webhook.controller.ts':
        'provider HMAC signature. The caller is a payment provider, which has no session and never will',
    'channels.controller.ts':
        'provider HMAC signature, same reason: Meta and Telegram deliver messages, they do not log in',
    'ical-feed.controller.ts':
        'an unguessable per-feed URL, which is what the iCal standard gives us. The OTA cannot present a token',
    'ical-export-public.controller.ts':
        'the same unguessable feed URL, for the export half',
    'widget-public.controller.ts':
        'public by design: the chat widget runs on the tenant\'s own site for their visitors, with CORS scoped to it',
    'public-booking.controller.ts':
        'public by design: a customer books without an account, which is the whole point of the page',
    'form.controller.ts':
        'public by design: a landing form is filled in by someone who has never heard of us',
    'intake.controller.ts':
        'public by design, same as the form: an intake link is given to a prospect',
    'landing.controller.ts':
        'public by design: the marketing site reads it for prices and copy',
    'billing-public.controller.ts':
        'public by design: the plan catalogue the pricing page renders, with no tenant in it',
    'calendar-callback.controller.ts':
        'the OAuth callback. It carries the provider\'s `state`, which is what proves who started the flow',
});

/**
 * Controllers with a session and roles but no tenant, and why that is right.
 *
 * Almost all of these are platform mode: a super_admin acting on the platform
 * itself, where there is no tenant to scope to and acting inside one requires
 * an impersonation with a reason. The two that are not say so.
 */
const PLATFORM_SCOPED: Readonly<Record<string, string>> = Object.freeze({
    'auth.controller.ts': 'sessions, refresh and 2FA. It authenticates; it cannot require the session it issues',
    'billing-admin.controller.ts': 'platform mode: billing operations across every tenant, super_admin only',
    'dispatch-rollout.controller.ts': 'platform mode: the dispatch rollout switch, super_admin only',
    'financials.controller.ts': 'platform mode: SaaS metrics over all tenants, super_admin only',
    'fiscal-admin.controller.ts': 'platform mode: DIAN invoices across tenants, super_admin only',
    'health.controller.ts': 'platform mode: the Ops Center. Liveness is public; everything else is super_admin',
    'managed.controller.ts': 'platform mode: the done-for-you tier\'s guarantee tracking, super_admin only',
    'meta-compliance.controller.ts': 'platform mode: Meta\'s compliance surface for the platform app, super_admin only',
    'platform-status.controller.ts': 'platform mode: incident banner state, read by every signed-in dashboard',
    'system-updates.controller.ts': 'platform mode: the changelog the dashboard shows, same shape',
    'tenants.controller.ts': 'platform mode: the tenant catalogue itself, so it cannot be scoped to one',
    'vertical-analytics.controller.ts': 'platform mode: analytics by industry across tenants, super_admin only',
    'vertical-audit.controller.ts': 'platform mode: the vertical audit, super_admin only',
    'webhook-tap.controller.ts': 'platform mode: the inbound-webhook debug tap, super_admin only',
    'feature-requests.controller.ts':
        'deliberately cross-tenant: one roadmap board every customer votes on. The routes that decide anything '
        + '(status, merge, admin reply) check `super_admin` in the handler, and the rest are scoped to the caller\'s '
        + 'own user id rather than to a tenant',
    'saml.controller.ts':
        'the SSO entry points run BEFORE a session exists. Its two `:tenantId` routes are the SP metadata XML and '
        + '"is SSO forced", both of which the login screen needs and neither of which carries tenant data',
    'white-label.controller.ts':
        'tenant_admin branding, resolved from the session\'s own tenant rather than from a path parameter, so there '
        + 'is no tenant id for `TenantGuard` to check',
    'whatsapp.controller.ts':
        'the same shape: every route resolves the tenant from the session, and the public half is the Meta webhook '
        + 'with its HMAC signature',
});

const controllers = (): Array<{ name: string; path: string; source: string }> => {
    const found: Array<{ name: string; path: string; source: string }> = [];
    for (const entry of readdirSync(MODULES, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = join(MODULES, entry.name);
        for (const file of readdirSync(dir)) {
            if (!file.endsWith('.controller.ts') || file.endsWith('.spec.ts')) continue;
            found.push({ name: file, path: join(dir, file), source: readFileSync(join(dir, file), 'utf8') });
        }
    }
    return found.sort((a, b) => a.name.localeCompare(b.name));
};

const guarded = (source: string): boolean =>
    source.includes("AuthGuard('jwt')") && source.includes('RolesGuard') && source.includes('TenantGuard');

describe('every controller says what protects it', () => {
    const all = controllers();

    it('sweeps a real controller tree', () => {
        // A broken sweep would make every claim below pass over an empty set,
        // which is the one way this contract could stop protecting anything.
        expect(all.length).toBeGreaterThan(100);
        expect(all.some(row => guarded(row.source))).toBe(true);
    });

    it('leaves no controller both unguarded and unexplained', () => {
        const unexplained = all
            .filter(row => !guarded(row.source)
                && !(row.name in UNAUTHENTICATED) && !(row.name in PLATFORM_SCOPED))
            .map(row => row.name);
        // The failure to expect here is not "somebody forgot a guard" — it is
        // "somebody added a surface and nobody wrote down what protects it".
        expect({ unexplained }).toEqual({ unexplained: [] });
    });

    it('makes a platform controller prove it is authenticated and role-gated', () => {
        // Having no tenant is a reason to drop `TenantGuard` and never a reason
        // to drop the other two. A platform surface without a role check is the
        // whole platform open to any signed-in customer.
        for (const name of Object.keys(PLATFORM_SCOPED)) {
            const row = all.find(entry => entry.name === name);
            expect({ name, found: !!row }).toEqual({ name, found: true });
            const source = row!.source;
            const roleGated = source.includes('RolesGuard')
                // The two that check the role inside the handler instead, which
                // the entry has to say out loud.
                || /req\.user\.role\s*[!=]==\s*'super_admin'/.test(source);
            expect({ name, authenticated: source.includes("AuthGuard('jwt')"), roleGated })
                .toEqual({ name, authenticated: true, roleGated: true });
            expect({ name, stated: PLATFORM_SCOPED[name].length > 45 }).toEqual({ name, stated: true });
        }
    });

    it('keeps the exception list honest in both directions', () => {
        // An entry for a controller that now carries the three guards would be a
        // stale excuse standing in front of a protected surface, which is how
        // the list starts being read as decoration.
        const overtaken = [...Object.keys(UNAUTHENTICATED), ...Object.keys(PLATFORM_SCOPED)]
            .filter(name => all.find(row => row.name === name)?.source
                ? guarded(all.find(row => row.name === name)!.source) : false);
        expect({ overtaken }).toEqual({ overtaken: [] });
        // And an entry for a controller nobody has any more.
        const orphans = [...Object.keys(UNAUTHENTICATED), ...Object.keys(PLATFORM_SCOPED)]
            .filter(name => !all.some(row => row.name === name));
        // And nothing in both lists: a controller is authenticated or it is not.
        expect(Object.keys(UNAUTHENTICATED).filter(name => name in PLATFORM_SCOPED)).toEqual([]);
        expect({ orphans }).toEqual({ orphans: [] });
    });

    it('makes every exception state its own mechanism', () => {
        for (const [name, because] of Object.entries(UNAUTHENTICATED)) {
            // A one-word reason is not a reason. This is the sentence a reviewer
            // reads when they ask why a surface has no session behind it.
            expect({ name, stated: because.length > 45 }).toEqual({ name, stated: true });
        }
    });

    it('does not let a tenant-scoped controller keep only two of the three', () => {
        // The partial case is the dangerous one: `AuthGuard` without
        // `TenantGuard` authenticates a person and then trusts whatever tenant
        // id the request names, which is the shape of a cross-tenant read.
        const partial = all
            .filter(row => !(row.name in UNAUTHENTICATED) && !(row.name in PLATFORM_SCOPED))
            .filter(row => row.source.includes("AuthGuard('jwt')") && !guarded(row.source))
            .map(row => ({
                name: row.name,
                missing: [
                    row.source.includes('RolesGuard') ? null : 'RolesGuard',
                    row.source.includes('TenantGuard') ? null : 'TenantGuard',
                ].filter(Boolean),
            }));
        expect({ partial }).toEqual({ partial: [] });
    });
});
