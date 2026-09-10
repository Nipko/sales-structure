import type { PrismaService } from '../prisma/prisma.service';

/** Existing proposals cannot silently acquire draft semantics after deployment. */
export async function ensureDraftProposalSchema(prisma: PrismaService, schema: string): Promise<void> {
    await prisma.ensureCanonicalTables(schema, ['agent_config_proposals']);
    await prisma.executeInTenantSchema(schema, `ALTER TABLE agent_config_proposals
        ADD COLUMN IF NOT EXISTS target_scope TEXT NOT NULL DEFAULT 'legacy_operational',
        ADD COLUMN IF NOT EXISTS expected_draft_revision UUID,
        ADD COLUMN IF NOT EXISTS base_operational_hash TEXT,
        ADD COLUMN IF NOT EXISTS applied_draft_revision UUID`);
}

/**
 * The content-creation ledger, repaired from the canonical DDL for a tenant
 * whose schema predates it.
 *
 * Its own table rather than a wider `agent_config_proposals`: that one's
 * `agent_id` is `NOT NULL REFERENCES agent_personas(id)`, and a FAQ, a legal
 * text or a bookable service has no agent to point at. Relaxing the column
 * would have weakened the configuration ledger's integrity check to make room
 * for rows it never reads.
 */
export async function ensureContentProposalSchema(prisma: PrismaService, schema: string): Promise<void> {
    await prisma.ensureCanonicalTables(schema, ['agent_content_proposals']);
}
