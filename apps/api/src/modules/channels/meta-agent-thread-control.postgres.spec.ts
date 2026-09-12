import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MetaAgentThreadControlStore } from './meta-agent-thread-control.store';
import { STANDBY_TIMEOUT_MS } from './meta-agent-thread-control';

/**
 * ═══ THREAD CONTROL THAT SURVIVES A RESTART ═══
 *
 * Control moves on a WEBHOOK and is read on a SEND: different processes,
 * different deploys. Held in memory, a release between the two makes every
 * thread `unknown` — and under coexistence that is a platform that has gone
 * quiet for every conversation at once.
 *
 * These cases drive the real store against real PostgreSQL, because the two
 * properties that matter are both about the database: that the state is there
 * after the process that wrote it is gone, and that two webhooks about the same
 * thread cannot overwrite each other.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('thread control, durably', () => {
    const tenantId = randomUUID();
    const schema = `tenant_threadctl_${randomUUID().replace(/-/g, '')}`;
    const NOW = new Date('2026-10-05T12:00:00.000Z');
    let client: PrismaClient;
    let prisma: any;
    let store: MetaAgentThreadControlStore;
    let setting: any = null;
    jest.setTimeout(180_000);

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname)
            || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await client.$executeRawUnsafe(`CREATE TABLE "${schema}".meta_agent_thread_control(
            conversation_id UUID PRIMARY KEY,
            state TEXT NOT NULL DEFAULT 'unknown',
            since TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            reason TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            CONSTRAINT meta_agent_thread_control_state
                CHECK (state IN ('ours','meta_agent','human_operator','standby','unknown')))`);

        prisma = Object.create(PrismaService.prototype);
        prisma.executeInTenantSchema = async (_s: string, text: string, params: any[] = []) =>
            client.$queryRawUnsafe(text.replace(/\bmeta_agent_thread_control\b/g,
                `"${schema}".meta_agent_thread_control`), ...params);
        prisma.transactionInTenantSchema = async (_s: string, work: any) =>
            client.$transaction(async (tx: any) => work(
                async (text: string, params: any[] = []) => tx.$queryRawUnsafe(
                    text.replace(/\bmeta_agent_thread_control\b/g,
                        `"${schema}".meta_agent_thread_control`), ...params)));
        // The flag, answered from the test rather than from a settings table.
        prisma.$queryRawUnsafe = async () => (setting ? [{ value: setting }] : []);

        store = new MetaAgentThreadControlStore(prisma);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_threadctl_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        setting = null;
        await sql('DELETE FROM meta_agent_thread_control');
    });

    it('reads an unwritten thread as unknown, not as ours', async () => {
        const control = await store.control(schema, randomUUID());
        expect(control.state).toBe('unknown');
        expect(control.since).toBeNull();
    });

    it('keeps the state after the process that wrote it is gone', async () => {
        // The whole reason this is a table. A store rebuilt from scratch — the
        // deploy — must read what the previous one committed.
        const conversationId = randomUUID();
        await store.apply(schema, conversationId, { kind: 'meta_took_control' }, NOW);

        const afterRestart = new MetaAgentThreadControlStore(prisma);
        const control = await afterRestart.control(schema, conversationId);
        expect(control.state).toBe('meta_agent');
        expect(control.since).toEqual(NOW);
    });

    it('lets two concurrent webhooks about one thread settle on one row', async () => {
        // Both arrive, both are applied, and the row is written once — a
        // read-then-write would have let the loser overwrite the winner with a
        // state computed from a row that no longer existed.
        const conversationId = randomUUID();
        await Promise.all([
            store.apply(schema, conversationId, { kind: 'meta_took_control' }, NOW),
            store.apply(schema, conversationId, { kind: 'meta_gave_control' }, NOW),
        ]);
        const rows = await sql('SELECT state FROM meta_agent_thread_control');
        expect(rows).toHaveLength(1);
        expect(['meta_agent', 'ours']).toContain(String(rows[0].state));
    });

    it('speaks for every thread while the flag is off', async () => {
        // Every account today. The store must not even read the table for this,
        // because a query per send to learn "yes" is a query per send.
        const conversationId = randomUUID();
        await store.apply(schema, conversationId, { kind: 'meta_took_control' }, NOW);
        const verdict = await store.maySpeak({ tenantId, schemaName: schema, conversationId });
        expect(verdict.maySpeak).toBe(true);
        expect(verdict.reason).toContain('coexistence_off');
    });

    it('stands down on a thread the other agent holds, once the flag is on', async () => {
        setting = { enabled: true, tenantIds: [] };
        const conversationId = randomUUID();
        await store.apply(schema, conversationId, { kind: 'meta_took_control' }, NOW);
        const verdict = await store.maySpeak({ tenantId, schemaName: schema, conversationId });
        expect({ maySpeak: verdict.maySpeak, retryable: verdict.retryable })
            .toEqual({ maySpeak: false, retryable: false });
    });

    it('reads an unreadable setting as OFF', async () => {
        // Failing open here would silence a platform over a database blip,
        // which is the opposite direction from every other guard in this module.
        setting = 'not json at all';
        const verdict = await store.maySpeak({
            tenantId, schemaName: schema, conversationId: randomUUID(),
        });
        expect(verdict.maySpeak).toBe(true);
    });

    it('honours a pilot list', async () => {
        setting = { enabled: true, tenantIds: [randomUUID()] };
        const conversationId = randomUUID();
        await store.apply(schema, conversationId, { kind: 'meta_took_control' }, NOW);
        // Not in the list: coexistence is off for this tenant, so it speaks.
        expect((await store.maySpeak({ tenantId, schemaName: schema, conversationId })).maySpeak)
            .toBe(true);

        setting = { enabled: true, tenantIds: [tenantId] };
        expect((await store.maySpeak({ tenantId, schemaName: schema, conversationId })).maySpeak)
            .toBe(false);
    });

    it('takes back a handover nobody acknowledged, and leaves a fresh one alone', async () => {
        const stale = randomUUID();
        const fresh = randomUUID();
        await store.apply(schema, stale, { kind: 'we_handed_over' }, NOW);
        await store.apply(schema, fresh, { kind: 'we_handed_over' },
            new Date(NOW.getTime() + STANDBY_TIMEOUT_MS));

        const recovered = await store.recoverStandby(
            schema, new Date(NOW.getTime() + STANDBY_TIMEOUT_MS + 1));

        expect(recovered).toEqual([stale]);
        expect((await store.control(schema, stale)).state).toBe('ours');
        expect((await store.control(schema, fresh)).state).toBe('standby');
    });
});
