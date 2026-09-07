import type { ConversationMissionFocusV1 } from '@parallext/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { AgentTurnSession } from './agent-turn-session';
import { readMissionFocus } from './mission-focus';

/** PG is authoritative. Evaluation uses only its session metadata, never source SQL/Redis. */
export class MissionFocusStore {
    constructor(private readonly prisma: PrismaService, private readonly schemaName: string,
        private readonly conversationId: string, private readonly contactId: string,
        private readonly session?: AgentTurnSession) {}

    async load(): Promise<ConversationMissionFocusV1> {
        if (this.session) return readMissionFocus(this.session.metadata.missionFocus);
        const rows = await this.prisma.executeInTenantSchema<any[]>(this.schemaName,
            `SELECT metadata FROM conversations WHERE id=$1::uuid AND contact_id=$2::uuid`, [this.conversationId, this.contactId]);
        if (!rows[0]) throw new Error('mission_conversation_missing');
        return readMissionFocus(rows[0].metadata?.missionFocus);
    }

    async save(state: ConversationMissionFocusV1): Promise<void> {
        const previous = state.writeVersion;
        const next = { ...state, writeVersion: previous + 1, updatedAt: new Date().toISOString() };
        if (this.session) {
            if (readMissionFocus(this.session.metadata.missionFocus).writeVersion !== previous) throw new Error('mission_focus_conflict');
            this.session.metadata.missionFocus = structuredClone(next);
        } else {
            await this.prisma.transactionInTenantSchema(this.schemaName, async query => {
                await query(`SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text`, [`agent-privacy:${this.schemaName}`]);
                const [table] = await query<any[]>("SELECT to_regclass('customer_memory_erasure')::text AS name");
                const erased = table?.name ? await query<any[]>(`SELECT contact_id FROM customer_memory_erasure WHERE contact_id=$1::uuid`, [this.contactId]) : [];
                if (erased.length) throw new Error('contact_erased');
                const rows = await query<any[]>(
                    `UPDATE conversations SET metadata=COALESCE(metadata,'{}'::jsonb)||$3::jsonb
                      WHERE id=$1::uuid AND contact_id=$2::uuid
                        AND COALESCE((metadata->'missionFocus'->>'writeVersion')::integer,0)=$4::integer RETURNING id`,
                    [this.conversationId, this.contactId, JSON.stringify({ missionFocus: next, missionFocusManaged: true }), previous]);
                if (!rows.length) throw new Error('mission_focus_conflict');
            });
        }
        Object.assign(state, next);
    }
}
