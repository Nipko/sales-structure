import { BadRequestException } from '@nestjs/common';

export type NativeEvidenceQuery = <R = any[]>(
    sql: string,
    params?: any[],
) => Promise<R>;

export interface NativeEvidenceOpportunityInput {
    contactId: string | null;
    conversationId?: string | null;
    /**
     * Only authenticated, server-controlled callers may populate this field.
     * LLM tool arguments and public booking payloads must never be forwarded.
     */
    trustedOpportunityId?: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the exact active opportunity that owns newly-created native evidence.
 *
 * The resolver is intentionally fail-closed on ambiguity: a valid operation may
 * still be recorded with a NULL owner, but it cannot unlock an opportunity's
 * pipeline transition. Candidate rows are locked until the surrounding INSERT
 * commits, so they cannot be closed or reassigned between resolution and write.
 */
export async function resolveNativeEvidenceOpportunity(
    query: NativeEvidenceQuery,
    input: NativeEvidenceOpportunityInput,
): Promise<string | null> {
    const trustedOpportunityId = input.trustedOpportunityId || null;
    if (!input.contactId) {
        if (trustedOpportunityId) {
            throw new BadRequestException('contactId is required when opportunityId is provided');
        }
        return null;
    }
    if (!UUID_PATTERN.test(input.contactId)) {
        throw new BadRequestException('contactId must be a valid UUID');
    }

    if (trustedOpportunityId) {
        if (!UUID_PATTERN.test(trustedOpportunityId)) {
            throw new BadRequestException('opportunityId must be a valid UUID');
        }
        const exact = await query<Array<{ id: string }>>(
            `SELECT o.id
               FROM opportunities o
               JOIN leads l ON l.id = o.lead_id
              WHERE o.id = $1::uuid
                AND (
                    l.contact_id = $2::uuid
                    OR EXISTS (
                        SELECT 1
                          FROM contact_identities evidence_identity
                          JOIN contact_identities lead_identity
                            ON lead_identity.customer_profile_id = evidence_identity.customer_profile_id
                         WHERE evidence_identity.contact_id = $2::uuid
                           AND lead_identity.contact_id = l.contact_id
                    )
                )
                AND o.won_at IS NULL
                AND o.lost_at IS NULL
              FOR SHARE OF o`,
            [trustedOpportunityId, input.contactId],
        );
        if (exact.length !== 1) {
            throw new BadRequestException({
                error: 'invalid_opportunity_owner',
                message: 'The opportunity is not active or does not belong to this contact.',
            });
        }
        return exact[0].id;
    }

    const conversationId = input.conversationId || null;
    if (conversationId) {
        if (!UUID_PATTERN.test(conversationId)) {
            throw new BadRequestException('conversationId must be a valid UUID');
        }
        const conversationCandidates = await query<Array<{ id: string }>>(
            `SELECT o.id
               FROM opportunities o
               JOIN leads l ON l.id = o.lead_id
              WHERE (
                    l.contact_id = $1::uuid
                    OR EXISTS (
                        SELECT 1
                          FROM contact_identities evidence_identity
                          JOIN contact_identities lead_identity
                            ON lead_identity.customer_profile_id = evidence_identity.customer_profile_id
                         WHERE evidence_identity.contact_id = $1::uuid
                           AND lead_identity.contact_id = l.contact_id
                    )
                )
                AND o.conversation_id = $2::uuid
                AND o.won_at IS NULL
                AND o.lost_at IS NULL
              ORDER BY o.created_at DESC, o.id
              LIMIT 2
              FOR SHARE OF o`,
            [input.contactId, conversationId],
        );
        if (conversationCandidates.length === 1) return conversationCandidates[0].id;
        if (conversationCandidates.length > 1) return null;
    }

    const contactCandidates = await query<Array<{ id: string }>>(
        `SELECT o.id
           FROM opportunities o
           JOIN leads l ON l.id = o.lead_id
          WHERE (
                l.contact_id = $1::uuid
                OR EXISTS (
                    SELECT 1
                      FROM contact_identities evidence_identity
                      JOIN contact_identities lead_identity
                        ON lead_identity.customer_profile_id = evidence_identity.customer_profile_id
                     WHERE evidence_identity.contact_id = $1::uuid
                       AND lead_identity.contact_id = l.contact_id
                )
            )
            AND o.won_at IS NULL
            AND o.lost_at IS NULL
          ORDER BY o.created_at DESC, o.id
          LIMIT 2
          FOR SHARE OF o`,
        [input.contactId],
    );
    return contactCandidates.length === 1 ? contactCandidates[0].id : null;
}
