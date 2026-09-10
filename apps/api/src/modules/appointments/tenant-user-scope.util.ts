import type { EvalNamespaceLease } from '../simulation/isolated-eval-namespace';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const TENANT_USER_UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolve a staff/user reference against the authoritative public tenant owner.
 * Tenant-local scheduling tables intentionally cannot carry a PostgreSQL FK to
 * public.users, so every boundary that accepts a user UUID must use this guard.
 */
export async function assertActiveTenantUser(
    prisma: Pick<PrismaService, 'executeInTenantSchema'>,
    schemaName: string,
    userId: string,
    namespace?: EvalNamespaceLease,
): Promise<string> {
    if (!TENANT_USER_UUID_PATTERN.test(String(userId || ''))) {
        throw new BadRequestException({
            error: 'invalid_tenant_staff',
            message: 'El usuario asignado no es un miembro activo de este negocio.',
        });
    }

    const directory = await tenantActorDirectory(prisma,schemaName,namespace);
    const rows = await prisma.executeInTenantSchema<Array<{ id: string }>>(
        schemaName,
        `SELECT u.id
         FROM ${directory.users} u
         JOIN ${directory.tenants} t ON t.id = u.tenant_id
         WHERE u.id = $1::uuid
           AND u.is_active = true
           AND t.schema_name = $2
           AND t.is_active = true
         LIMIT 1`,
        [userId, schemaName],
    );
    if (!rows?.length) {
        throw new BadRequestException({
            error: 'invalid_tenant_staff',
            message: 'El usuario asignado no es un miembro activo de este negocio.',
        });
    }
    return rows[0].id;
}

/** Server-only fixture directory; the ownership proof is checked before SQL interpolation. */
export async function tenantActorDirectory(prisma: Pick<PrismaService,'executeInTenantSchema'>,schemaName: string,namespace?: EvalNamespaceLease): Promise<{users:string;tenants:string}> {
    return tenantActorDirectoryWithQuery((sql, params) => prisma.executeInTenantSchema<any[]>(schemaName, sql, params), schemaName, namespace);
}

/** Writers use their own transaction so the lease and directory remain fenced
 * until the effect commits. The model cannot select these reference tables. */
export async function tenantActorDirectoryWithQuery(
    query: (sql: string, params?: unknown[]) => Promise<any[]>, schemaName: string, namespace?: EvalNamespaceLease,
): Promise<{users:string;tenants:string}> {
    if (!namespace) {
        if (schemaName.startsWith('tenant_eval_')) throw new Error('eval_namespace_lease_required');
        return {users:'public.users',tenants:'public.tenants'};
    }
    if (!/^tenant_eval_[a-f0-9]{8}_[a-f0-9]{24}$/.test(schemaName) || namespace.schemaName !== schemaName) throw new Error('eval_namespace_scope_mismatch');
    const rows = await query(
        'SELECT 1 FROM __eval_namespace WHERE owner_token=$1::uuid AND tenant_id=$2::uuid AND source_schema=$3 AND expires_at>clock_timestamp() FOR SHARE', [namespace.token,namespace.tenantId,namespace.sourceSchema]);
    if (rows.length !== 1) throw new Error('eval_namespace_lease_lost');
    return {users:`"${schemaName}".__eval_ref_users`,tenants:`"${schemaName}".__eval_ref_tenants`};
}
