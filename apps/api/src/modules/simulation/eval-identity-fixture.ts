import type { PrismaService } from '../prisma/prisma.service';
import type { EvalNamespaceLease } from './isolated-eval-namespace';
import { CANONICAL_EVAL_TOOLS } from './isolated-eval-namespace';
import { EVAL_SANDBOX_CONTACT_ID, EVAL_WRITER_SANDBOX_FAMILIES } from '../conversations/agent-test-tool-policy';
import { tenantActorDirectoryWithQuery } from '../appointments/tenant-user-scope.util';

/** The private readers that always needed it. */
export const EVAL_IDENTITY_READERS = new Set(['get_appointment_details', 'list_customer_appointments']);

/**
 * The step-up WRITERS a leased namespace may satisfy synthetically.
 *
 * `create_vehicle_rental` was the last canonical command left outside the
 * namespace, and the reason given was that admitting it "would mean handing a
 * sensitive writer a verified identity from a test, which is exactly what that
 * control exists to prevent". That reads right and is worth taking apart,
 * because the control guards a specific harm: an agent renting a vehicle in the
 * name of a person who never proved they are that person.
 *
 * Inside a leased namespace there is no such person. The contact is the fixed
 * synthetic sandbox id, every table it touches is a clone in a `tenant_eval_*`
 * schema that the lease drops at teardown, the assurance row lives in that same
 * schema and expires with the lease, and the command's one external effect is
 * suppressed by the lease rather than by a flag. What would be dangerous is a
 * synthetic assurance that could ESCAPE — be accepted for a real contact, in a
 * real schema, or for a tool that can run outside a lease. So rather than keep
 * the writer out, the escape is made impossible and the writer comes in:
 *
 *   · the tool must be canonical AND belong to a `canonicalOnly` family, so it
 *     cannot execute against a tenant's real schema at all (asserted below, not
 *     assumed — a family that lost the flag would fail loudly here);
 *   · the contact must be the fixed synthetic sandbox id;
 *   · the tenant must be the lease's tenant, and the lease is re-checked inside
 *     the same transaction that reads the assurance;
 *   · the assurance must be `synthetic_A2` and unexpired by the database clock;
 *   · no code path here can mint or send a verification code.
 *
 * `file_claim` stays out and will keep failing this check. Its family is
 * `identity_challenge`: in an evaluation it exists only to prove the step-up
 * DENIAL, so it never reaches a writer and there is nothing for an assurance to
 * unlock.
 */
export const EVAL_IDENTITY_STEP_UP_WRITERS = new Set(['create_vehicle_rental']);

/** Every tool a synthetic assurance may cover, readers and writers alike. */
export const EVAL_IDENTITY_FIXTURE_TOOLS: ReadonlySet<string> =
    new Set([...EVAL_IDENTITY_READERS, ...EVAL_IDENTITY_STEP_UP_WRITERS]);

/**
 * The confinement the writers above depend on, checked rather than trusted.
 *
 * If a family ever loses `canonicalOnly`, or a tool leaves the canonical set,
 * the synthetic assurance would start covering something that can run against a
 * real tenant. That must fail at the check, not in production.
 */
export function evalStepUpWriterIsConfined(toolName: string): boolean {
    if (!CANONICAL_EVAL_TOOLS.has(toolName)) return false;
    return Object.values(EVAL_WRITER_SANDBOX_FAMILIES)
        .some(family => family.canonicalOnly === true && (family.tools as readonly string[]).includes(toolName));
}

/** Synthetic A2 precondition for private fixture readers and for the step-up
 * writers a lease fully confines. This cannot verify a real contact or send an
 * OTP; it is never accepted as operational identity. */
export async function hasEvalIdentityFixture(prisma: Pick<PrismaService, 'transactionInTenantSchema'>,
    input: { schemaName: string; tenantId: string; contactId: string; conversationId: string; toolName: string; sandboxNamespace: EvalNamespaceLease },
): Promise<boolean> {
    if (!EVAL_IDENTITY_FIXTURE_TOOLS.has(input.toolName) || input.tenantId !== input.sandboxNamespace.tenantId
        || input.contactId !== EVAL_SANDBOX_CONTACT_ID) return false;
    // A writer is admitted only while its family is still namespace-only.
    if (EVAL_IDENTITY_STEP_UP_WRITERS.has(input.toolName) && !evalStepUpWriterIsConfined(input.toolName)) return false;
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
