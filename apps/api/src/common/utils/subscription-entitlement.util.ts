import type { PrismaService } from '../../modules/prisma/prisma.service';
import {
    DUNNING_EXPIRY_DAY,
    DUNNING_SOFT_LOCK_DAY,
} from '../../modules/billing/recurring/dunning.service';

export type SubscriptionAccessMode = 'read' | 'write';
export type SubscriptionRestrictionLevel = 'none' | 'soft_lock' | 'hard_lock' | 'unavailable';

export interface SubscriptionEntitlementSnapshot {
    isInternal: boolean;
    status: string | null;
    trialEndsAt: Date | null;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: Date | null;
    cancellationReason: string | null;
    dunningStartedAt: Date | null;
}

export interface SubscriptionAccessDecision {
    allowed: boolean;
    restrictionLevel: SubscriptionRestrictionLevel;
    error?:
        | 'payment_method_required'
        | 'subscription_expired'
        | 'subscription_paused'
        | 'subscription_restricted'
        | 'subscription_grace_unavailable'
        | 'subscription_status_unavailable';
    daysRemaining?: number;
}

const DAY_MS = 86_400_000;

/**
 * One policy shared by HTTP and WebSocket entry points.  Keep this function
 * pure so every transport interprets deferred cancellation and dunning clocks
 * identically.
 */
export function evaluateSubscriptionAccess(
    snapshot: SubscriptionEntitlementSnapshot,
    mode: SubscriptionAccessMode,
    now = new Date(),
): SubscriptionAccessDecision {
    const status = snapshot.status;
    // Internal/demo tenants are deliberately non-billable but remain
    // operational. The flag is super-admin controlled and the fiscal engine
    // independently snapshots it to suppress invoices and SaaS revenue.
    if (snapshot.isInternal) {
        return { allowed: true, restrictionLevel: 'none' };
    }
    if (!status) {
        // A commercial tenant without a durable BillingSubscription is not a
        // free-plan state. Onboarding and billing recovery routes are exempt at
        // the transport boundary; every product surface must fail closed until
        // the subscription has been provisioned. Internal/demo tenants already
        // returned through the explicit, super-admin-controlled flag above.
        return {
            allowed: false,
            restrictionLevel: 'unavailable',
            error: 'subscription_status_unavailable',
        };
    }

    if (status === 'trialing') {
        if (!snapshot.trialEndsAt) {
            return {
                allowed: false,
                restrictionLevel: 'unavailable',
                error: 'subscription_status_unavailable',
            };
        }
        if (snapshot.cancelAtPeriodEnd) {
            const paidUntil = snapshot.currentPeriodEnd ?? snapshot.trialEndsAt;
            return paidUntil.getTime() > now.getTime()
                ? { allowed: true, restrictionLevel: 'none' }
                : {
                    allowed: false,
                    restrictionLevel: 'hard_lock',
                    error: 'subscription_expired',
                };
        }
        if (snapshot.trialEndsAt.getTime() > now.getTime()) {
            return { allowed: true, restrictionLevel: 'none' };
        }
        // Project the same D0/D3/D10 recovery policy immediately at the
        // contractual boundary. The detector cron materializes PAST_DUE for
        // reporting/email but is no longer an access-control dependency.
        return evaluateSubscriptionAccess({
            ...snapshot,
            status: 'past_due',
            dunningStartedAt: snapshot.trialEndsAt,
        }, mode, now);
    }

    if (status === 'active') {
        if (String(snapshot.cancellationReason ?? '').startsWith('comp:')) {
            return snapshot.currentPeriodEnd
                && snapshot.currentPeriodEnd.getTime() > now.getTime()
                ? { allowed: true, restrictionLevel: 'none' }
                : {
                    allowed: false,
                    restrictionLevel: 'hard_lock',
                    error: 'subscription_expired',
                };
        }
        if (!snapshot.cancelAtPeriodEnd) {
            return { allowed: true, restrictionLevel: 'none' };
        }
        // The daily boundary cron is cleanup, not the security boundary. A
        // cancelled-at-period-end row stops exactly at currentPeriodEnd even if
        // the cron has not materialized CANCELLED yet.
        if (snapshot.currentPeriodEnd
            && snapshot.currentPeriodEnd.getTime() > now.getTime()) {
            return { allowed: true, restrictionLevel: 'none' };
        }
        return {
            allowed: false,
            restrictionLevel: 'hard_lock',
            error: 'subscription_expired',
        };
    }

    if (status === 'pending_auth') {
        return {
            allowed: false,
            restrictionLevel: 'hard_lock',
            error: 'payment_method_required',
        };
    }

    if (status === 'expired') {
        return {
            allowed: false,
            restrictionLevel: 'hard_lock',
            error: 'subscription_expired',
        };
    }

    if (status === 'cancelled') {
        // Some provider/legacy rows materialize CANCELLED immediately even
        // though the already-paid period remains usable.  Access is preserved
        // only when both durable facts prove that window; missing data fails
        // closed. New internal-engine cancellations normally remain ACTIVE and
        // merely set cancelAtPeriodEnd until the boundary cron runs.
        if (snapshot.cancelAtPeriodEnd
            && snapshot.currentPeriodEnd
            && snapshot.currentPeriodEnd.getTime() > now.getTime()) {
            return { allowed: true, restrictionLevel: 'none' };
        }
        return {
            allowed: false,
            restrictionLevel: 'hard_lock',
            error: 'subscription_expired',
        };
    }

    if (status !== 'past_due') {
        // Unknown paid-state vocabulary is a configuration/data error, not a
        // reason to grant product access.
        return {
            allowed: false,
            restrictionLevel: 'unavailable',
            error: 'subscription_status_unavailable',
        };
    }

    if (String(snapshot.cancellationReason ?? '').startsWith('paused')) {
        return mode === 'read'
            ? { allowed: true, restrictionLevel: 'none' }
            : {
                allowed: false,
                restrictionLevel: 'soft_lock',
                error: 'subscription_paused',
            };
    }

    const startedAt = snapshot.dunningStartedAt?.getTime() ?? Number.NaN;
    if (!Number.isFinite(startedAt) || startedAt > now.getTime()) {
        return {
            allowed: false,
            restrictionLevel: 'unavailable',
            error: 'subscription_grace_unavailable',
        };
    }

    const graceDays = Math.floor((now.getTime() - startedAt) / DAY_MS);
    if (graceDays >= DUNNING_EXPIRY_DAY) {
        return {
            allowed: false,
            restrictionLevel: 'hard_lock',
            error: 'subscription_expired',
        };
    }
    if (graceDays >= DUNNING_SOFT_LOCK_DAY && mode === 'write') {
        return {
            allowed: false,
            restrictionLevel: 'soft_lock',
            error: 'subscription_restricted',
            daysRemaining: DUNNING_EXPIRY_DAY - graceDays,
        };
    }
    return { allowed: true, restrictionLevel: 'none' };
}

/**
 * Reads the canonical subscription row for transport boundaries that do not
 * pass through Nest HTTP guards (Socket.IO, public widget). No cache is used:
 * a socket opened before a billing transition must be stopped on its next
 * packet rather than retaining access for a TTL.
 */
export async function readSubscriptionEntitlement(
    prisma: PrismaService,
    tenantId: string,
): Promise<SubscriptionEntitlementSnapshot> {
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
            subscriptionStatus: true,
            isInternal: true,
            subscription: {
                select: {
                    status: true,
                    trialEndsAt: true,
                    cancelAtPeriodEnd: true,
                    currentPeriodEnd: true,
                    cancellationReason: true,
                    dunningStartedAt: true,
                },
            },
        },
    });
    if (!tenant) {
        return {
            status: '__tenant_missing__',
            isInternal: false,
            trialEndsAt: null,
            cancelAtPeriodEnd: false,
            currentPeriodEnd: null,
            cancellationReason: null,
            dunningStartedAt: null,
        };
    }

    return {
        isInternal: tenant.isInternal === true,
        // BillingSubscription is the money-state authority. The tenant column
        // is only a denormalized UI/index mirror and can temporarily be stale
        // after a crash or a best-effort cache invalidation. A non-internal
        // tenant with no subscription fails closed instead of inheriting a
        // possibly stale ACTIVE mirror.
        status: tenant.subscription?.status
            ?? (tenant.isInternal === true ? tenant.subscriptionStatus : null),
        trialEndsAt: tenant.subscription?.trialEndsAt ?? null,
        cancelAtPeriodEnd: tenant.subscription?.cancelAtPeriodEnd === true,
        currentPeriodEnd: tenant.subscription?.currentPeriodEnd ?? null,
        cancellationReason: tenant.subscription?.cancellationReason ?? null,
        dunningStartedAt: tenant.subscription?.dunningStartedAt ?? null,
    };
}

export async function resolveTenantSubscriptionAccess(
    prisma: PrismaService,
    tenantId: string,
    mode: SubscriptionAccessMode,
): Promise<SubscriptionAccessDecision> {
    try {
        return evaluateSubscriptionAccess(
            await readSubscriptionEntitlement(prisma, tenantId),
            mode,
        );
    } catch {
        return {
            allowed: false,
            restrictionLevel: 'unavailable',
            error: 'subscription_status_unavailable',
        };
    }
}
