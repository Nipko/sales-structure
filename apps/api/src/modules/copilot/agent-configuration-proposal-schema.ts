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
