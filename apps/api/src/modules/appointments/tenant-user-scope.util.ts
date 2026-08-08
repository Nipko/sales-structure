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
): Promise<string> {
    if (!TENANT_USER_UUID_PATTERN.test(String(userId || ''))) {
        throw new BadRequestException({
            error: 'invalid_tenant_staff',
            message: 'El usuario asignado no es un miembro activo de este negocio.',
        });
    }

    const rows = await prisma.executeInTenantSchema<Array<{ id: string }>>(
        schemaName,
        `SELECT u.id
         FROM public.users u
         JOIN public.tenants t ON t.id = u.tenant_id
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
