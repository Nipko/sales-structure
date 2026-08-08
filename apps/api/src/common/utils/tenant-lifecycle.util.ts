import type { PrismaService } from '../../modules/prisma/prisma.service';
import type { RedisService } from '../../modules/redis/redis.service';

/**
 * Provisioning, reactivation and destructive lifecycle operations all contend
 * on this lease. The ownership token + heartbeat are the write fence; the
 * purging key is the durable runtime fence while a purge is in progress or
 * awaiting an operator retry.
 */
export const TENANT_LIFECYCLE_LOCK_TTL_SECONDS = 300;

export function tenantLifecycleLockKey(tenantId: string): string {
    return `lock:tenant-lifecycle:${tenantId}`;
}

export function tenantPurgingFenceKey(tenantId: string): string {
    return `tenant:purging:${tenantId}`;
}

export interface ReadyTenantContext {
    tenantId: string;
    schemaName: string;
}

/** Fail closed: Redis errors propagate and callers reject the request/socket. */
export async function resolveReadyTenantContext(
    prisma: PrismaService,
    redis: RedisService,
    tenantId: string | null | undefined,
): Promise<ReadyTenantContext | null> {
    if (!tenantId) return null;
    const fenceKey = tenantPurgingFenceKey(tenantId);
    const lifecycleKey = tenantLifecycleLockKey(tenantId);
    if (await redis.get(lifecycleKey)) return null;
    if (await redis.get(fenceKey)) return null;

    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, schemaName: true, isActive: true, onboardingCompletedAt: true },
    });
    if (!tenant?.isActive || !tenant.onboardingCompletedAt) return null;

    // Re-read the fence after PostgreSQL so a purge that began during the
    // lookup cannot yield a fresh tenant context.
    if (await redis.get(lifecycleKey)) return null;
    if (await redis.get(fenceKey)) return null;
    return { tenantId: tenant.id, schemaName: tenant.schemaName };
}

/**
 * Resolve tenant context from authoritative user + tenant state, never from a
 * JWT claim alone. A user still in onboarding receives no tenant context.
 */
export async function resolveReadyUserTenantContext(
    prisma: PrismaService,
    redis: RedisService,
    userId: string,
    claimedTenantId?: string | null,
): Promise<ReadyTenantContext | null> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            isActive: true,
            onboardingCompleted: true,
            tenantId: true,
            tenant: {
                select: { id: true, schemaName: true, isActive: true, onboardingCompletedAt: true },
            },
        },
    });
    if (!user?.isActive || !user.onboardingCompleted || !user.tenantId || !user.tenant) return null;
    if (claimedTenantId && claimedTenantId !== user.tenantId) return null;
    if (!user.tenant.isActive || !user.tenant.onboardingCompletedAt) return null;

    const fenceKey = tenantPurgingFenceKey(user.tenantId);
    if (await redis.get(tenantLifecycleLockKey(user.tenantId))) return null;
    if (await redis.get(fenceKey)) return null;
    return { tenantId: user.tenantId, schemaName: user.tenant.schemaName };
}
