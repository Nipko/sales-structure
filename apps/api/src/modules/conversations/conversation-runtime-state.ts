import type { PrismaService } from '../prisma/prisma.service';

/** State checkpoints serialize with erasure, just like business commands. */
export async function persistConversationRuntimeState(prisma: PrismaService, schemaName: string, conversationId: string,
    patch: Record<string, unknown>, remove: string[] = []): Promise<void> {
    await prisma.transactionInTenantSchema(schemaName, async query => {
        await query(`SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text`, [`agent-privacy:${schemaName}`]);
        const [conversation] = await query<any[]>('SELECT contact_id FROM conversations WHERE id=$1::uuid', [conversationId]);
        if (!conversation?.contact_id) throw new Error('runtime_state_conversation_missing');
        const [table] = await query<any[]>("SELECT to_regclass('customer_memory_erasure')::text AS name");
        if (table?.name && (await query<any[]>('SELECT contact_id FROM customer_memory_erasure WHERE contact_id=$1::uuid', [conversation.contact_id])).length) throw new Error('contact_erased');
        const rows = await query<any[]>(
            `UPDATE conversations SET metadata=(COALESCE(metadata,'{}'::jsonb)-$3::text[])||$2::jsonb
             WHERE id=$1::uuid AND contact_id=$4::uuid RETURNING id`,
            [conversationId, JSON.stringify(patch), remove, conversation.contact_id]);
        if (!rows.length) throw new Error('runtime_state_conversation_missing');
    });
}
