import { BadRequestException } from '@nestjs/common';

export type TenantQuery = <R = any[]>(sql: string, params?: any[]) => Promise<R>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Contact references are optional for manual/chat-created records, but an
 * explicitly supplied value must always be a UUID. Keeping this check outside
 * the database also prevents a PostgreSQL cast error from becoming a 500.
 */
export function assertOptionalContactId(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
        throw new BadRequestException('contactId must be a valid UUID');
    }
    return value;
}

/**
 * Resolve a contact only through the tenant-scoped query primitive. A UUID
 * copied from another tenant therefore behaves exactly like a missing contact
 * and is rejected before the business row is inserted.
 */
export async function requireTenantContact(
    query: TenantQuery,
    contactId: string | null,
): Promise<string | null> {
    if (!contactId) return null;

    const rows = await query<Array<{ id: string }>>(
        `SELECT id FROM contacts WHERE id = $1::uuid LIMIT 1`,
        [contactId],
    );
    if (!rows?.length) {
        throw new BadRequestException('contactId does not belong to this tenant');
    }
    return rows[0].id || contactId;
}

