import type { PrismaService } from '../prisma/prisma.service';
import type { EvalNamespaceLease } from './isolated-eval-namespace';
import { tenantActorDirectoryWithQuery } from '../appointments/tenant-user-scope.util';

export const EVAL_IDENTITY_READERS = new Set(['get_appointment_details', 'list_customer_appointments']);

/** Synthetic A2 precondition for private fixture readers. This cannot verify a
 * real contact or send an OTP; it is never accepted as operational identity. */
export async function hasEvalIdentityFixture(prisma: Pick<PrismaService, 'transactionInTenantSchema'>,
    input: { schemaName: string; tenantId: string; contactId: string; conversationId: string; toolName: string; sandboxNamespace: EvalNamespaceLease },
): Promise<boolean> {
    if (!EVAL_IDENTITY_READERS.has(input.toolName) || input.tenantId !== input.sandboxNamespace.tenantId
        || input.contactId !== '00000000-0000-4000-8000-00000000eba1') return false;
    return prisma.transactionInTenantSchema(input.schemaName, async query => {
        await tenantActorDirectoryWithQuery(query, input.schemaName, input.sandboxNamespace);
        const rows = await query<any[]>(`SELECT assurance.conversation_id FROM __eval_identity_assurance assurance
            JOIN conversations conversation ON conversation.id=assurance.conversation_id AND conversation.contact_id=assurance.contact_id
            WHERE assurance.contact_id=$1::uuid AND assurance.conversation_id=$2::uuid
                AND assurance.assurance='synthetic_A2' AND assurance.expires_at>clock_timestamp()`,
        [input.contactId, input.conversationId]);
        return rows.length === 1;
    });
}
