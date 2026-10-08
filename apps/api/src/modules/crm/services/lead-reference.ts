import { Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const logger = new Logger('CrmLeadReference');

/**
 * What the customer-profile page ("Ver cliente") was pointed at.
 *
 * The dashboard links to `/admin/contacts/:id` from the inbox, memberships, pets, photo
 * sessions and treatment plans passing a CONTACT id, while the CRM list passes a LEAD id.
 * Both reach `GET /crm/leads/:tenantId/:id` and `GET /crm/timeline/:tenantId/:id`. The
 * endpoints only understood lead ids, so every contact id ended in a plain `Error('Lead not
 * found')` - a 500 - and the page rendered blank.
 *
 * Resolution order (first match wins):
 *   1. `leads.id = ref`                       -> kind 'lead'
 *   2. the contact's newest lead (active
 *      ones before archived ones)             -> kind 'contact_lead'
 *   3. `contacts.id = ref`, no lead yet       -> kind 'contact_only'
 *   4. nothing                                -> 404 `lead_not_found`
 * A reference that is not a UUID is a 404 as well: it used to reach `$1::uuid` and come back
 * as a PostgreSQL 22P02 (500).
 */
export interface LeadReference {
    kind: 'lead' | 'contact_lead' | 'contact_only';
    /** The lead the profile belongs to; null while the contact has no lead. */
    leadId: string | null;
    contactId: string | null;
}

export function isUuid(value: unknown): value is string {
    return typeof value === 'string' && UUID_PATTERN.test(value);
}

export async function resolveLeadReference(
    prisma: Pick<PrismaService, 'executeInTenantSchema'>,
    schema: string,
    ref: string,
): Promise<LeadReference> {
    if (!isUuid(ref)) throw new NotFoundException({ error: 'lead_not_found', message: 'Cliente no encontrado' });

    const byLead = await prisma.executeInTenantSchema<any[]>(schema,
        `SELECT id, contact_id FROM leads WHERE id = $1::uuid LIMIT 1`, [ref]);
    if (byLead?.[0]) return { kind: 'lead', leadId: byLead[0].id, contactId: byLead[0].contact_id ?? null };

    const byContact = await prisma.executeInTenantSchema<any[]>(schema,
        `SELECT id, contact_id FROM leads WHERE contact_id = $1::uuid
          ORDER BY (archived_at IS NULL) DESC, created_at DESC LIMIT 1`, [ref]);
    if (byContact?.[0]) return { kind: 'contact_lead', leadId: byContact[0].id, contactId: ref };

    const contact = await prisma.executeInTenantSchema<any[]>(schema,
        `SELECT id FROM contacts WHERE id = $1::uuid LIMIT 1`, [ref]);
    if (contact?.[0]) return { kind: 'contact_only', leadId: null, contactId: ref };

    throw new NotFoundException({ error: 'lead_not_found', message: 'Cliente no encontrado' });
}

/**
 * Runs one optional section of the profile. A section that cannot be read (a column a legacy
 * tenant never got, a table that is still being provisioned) is logged and reported empty; it
 * must not take the whole profile - and with it the page - down.
 */
export async function optionalSection<T>(label: string, fallback: T, read: () => Promise<T>): Promise<T> {
    try {
        const value = await read();
        return value ?? fallback;
    } catch (error: any) {
        logger.warn(`profile section "${label}" unavailable: ${error?.message || error}`);
        return fallback;
    }
}
