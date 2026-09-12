import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
    initialThreadControl, nextThreadControl, mayPlatformSpeak, standbyExpired,
    type SpeakVerdict, type ThreadControl, type ThreadControlEvent, type ThreadControlState,
} from './meta-agent-thread-control';

const SETTINGS_KEY = 'channels.metaAgentCoexistence';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ═══ THE DURABLE HALF OF THREAD CONTROL ═══
 *
 * The state machine beside this file is pure and says what a transition means.
 * This is where the answer survives a restart, because control moves on a
 * WEBHOOK and is read on a SEND — different processes, different deploys. Held
 * in memory, a release between the two makes every thread `unknown`, and under
 * coexistence that is a platform that has gone quiet.
 *
 * ── OFF BY DEFAULT, AND DELIBERATELY SO ─────────────────────────────────────
 *
 * No account has Meta's agent in its threads today, and every one of these
 * transitions is synthetic: nothing here has met a real handover. Switching a
 * live reply path on that is a decision with a pilot attached, so the flag lives
 * in `platform_settings` where it can be turned off for everyone in one write,
 * and an unreadable or malformed setting means OFF — the failure that leaves
 * today's behaviour exactly as it is.
 */
@Injectable()
export class MetaAgentThreadControlStore {
    private readonly logger = new Logger(MetaAgentThreadControlStore.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Is coexistence switched on for this tenant?
     *
     * Never throws. An unreadable setting is read as OFF, because failing open
     * here would silence a platform over a database blip — the opposite of the
     * direction every other guard in this module leans.
     */
    async coexistenceEnabled(tenantId: string): Promise<boolean> {
        try {
            const [row] = await this.prisma.$queryRawUnsafe<any[]>(
                `SELECT value FROM public.platform_settings WHERE key = $1 LIMIT 1`,
                SETTINGS_KEY,
            );
            const value = row?.value;
            const config = typeof value === 'string' ? JSON.parse(value) : value;
            if (!config || config.enabled !== true) return false;
            const tenants: unknown = config.tenantIds;
            // An empty list with the switch on means every tenant, which is how
            // `dispatch.normalOutbox` reads it too — one grammar, not two.
            if (!Array.isArray(tenants) || tenants.length === 0) return true;
            return tenants.some(entry => String(entry).trim() === tenantId);
        } catch (error: any) {
            this.logger.warn(`[MetaAgent] coexistence setting unreadable (${error?.message}); `
                + 'treating it as off, which is what every account is today');
            return false;
        }
    }

    /** What the record says about this thread, or `unknown` if there is none. */
    async control(schemaName: string, conversationId: string): Promise<ThreadControl> {
        if (!UUID.test(conversationId)) return initialThreadControl();
        const [row] = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT state, since, reason FROM meta_agent_thread_control
              WHERE conversation_id = $1::uuid LIMIT 1`,
            [conversationId],
        );
        if (!row) return initialThreadControl();
        return Object.freeze({
            state: String(row.state) as ThreadControlState,
            since: row.since ? new Date(row.since) : null,
            reason: row.reason ?? null,
        });
    }

    /**
     * Apply an event and commit the result.
     *
     * Read and write in ONE statement rather than read-then-write: two webhooks
     * about the same thread arrive concurrently, and the loser of a
     * read-then-write would overwrite the winner with a state computed from a
     * row that no longer existed.
     */
    async apply(
        schemaName: string, conversationId: string, event: ThreadControlEvent, at: Date,
    ): Promise<ThreadControl> {
        if (!UUID.test(conversationId)) return initialThreadControl();
        return this.prisma.transactionInTenantSchema(schemaName, async (query: any) => {
            const [existing] = await query(
                `SELECT state, since, reason FROM meta_agent_thread_control
                  WHERE conversation_id = $1::uuid FOR UPDATE`,
                [conversationId],
            );
            const current: ThreadControl = existing
                ? { state: String(existing.state) as ThreadControlState,
                    since: existing.since ? new Date(existing.since) : null,
                    reason: existing.reason ?? null }
                : initialThreadControl();

            const next = nextThreadControl(current, event, at);
            await query(
                `INSERT INTO meta_agent_thread_control
                     (conversation_id, state, since, reason, updated_at)
                 VALUES ($1::uuid, $2, $3, $4, clock_timestamp())
                 ON CONFLICT (conversation_id) DO UPDATE
                    SET state = EXCLUDED.state, since = EXCLUDED.since,
                        reason = EXCLUDED.reason, updated_at = clock_timestamp()`,
                [conversationId, next.state, next.since ?? at, next.reason],
            );
            return next;
        });
    }

    /** May this platform answer in this thread right now? */
    async maySpeak(input: {
        readonly tenantId: string;
        readonly schemaName: string;
        readonly conversationId: string;
        readonly now?: Date;
    }): Promise<SpeakVerdict> {
        const now = input.now ?? new Date();
        const coexistenceEnabled = await this.coexistenceEnabled(input.tenantId);
        // Read only when it can change the answer. With the flag off every state
        // may speak, and a query per send to learn that is a query per send.
        if (!coexistenceEnabled) {
            return mayPlatformSpeak({ control: initialThreadControl(), coexistenceEnabled, now });
        }
        const control = await this.control(input.schemaName, input.conversationId);
        return mayPlatformSpeak({ control, coexistenceEnabled, now });
    }

    /**
     * Take back every thread whose handover was never acknowledged.
     *
     * Ours to do, not the other side's: waiting for the party that already
     * failed to notice it failed is how a customer waits for ever.
     */
    async recoverStandby(schemaName: string, now: Date, limit = 200): Promise<readonly string[]> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT conversation_id, since FROM meta_agent_thread_control
              WHERE state = 'standby' ORDER BY since LIMIT ${Math.max(1, Math.min(1000, limit))}`,
        );
        const recovered: string[] = [];
        for (const row of rows ?? []) {
            const control: ThreadControl = {
                state: 'standby', since: row.since ? new Date(row.since) : null, reason: null,
            };
            if (!standbyExpired(control, now)) continue;
            await this.apply(schemaName, String(row.conversation_id),
                { kind: 'standby_expired' }, now);
            recovered.push(String(row.conversation_id));
        }
        return Object.freeze(recovered);
    }
}
