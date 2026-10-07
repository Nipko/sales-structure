import { HandoffReturnReplayService } from './handoff-return-replay.service';

/**
 * After the sweep returns an unattended handoff to the agent, the customer's
 * waiting message(s) are answered by the NORMAL turn, exactly once. The SQL of
 * the claim is exercised against PostgreSQL in
 * handoff-return-replay.postgres.spec.ts; this suite pins what the service does
 * with the outcome, using a stateful stub of that claim.
 */
describe('handoff return replay (service behavior)', () => {
    const TENANT = 't1';
    const SCHEMA = 'tenant_t1';
    const CONV = 'c1';
    const STARTED = '2026-10-05T20:33:00Z';

    function harness(opts: {
        claimable?: boolean;
        channel?: string;
        waiting?: any[];
        contact?: any;
        enqueueFails?: number;
        widgetFails?: boolean;
    } = {}) {
        const state = { claimed: false };
        const calls: Array<{ sql: string; params: any[] }> = [];
        const waiting = opts.waiting ?? [{
            id: 'm1', content_type: 'text', content_text: '¿Hasta qué hora atienden?',
            external_id: 'tgu77', metadata: { updateId: 77 }, created_at: new Date('2026-10-05T20:46:00Z'),
        }];
        const prisma: any = {
            tenant: { findUnique: jest.fn().mockResolvedValue({ schemaName: SCHEMA }) },
            executeInTenantSchema: jest.fn(async (_s: string, sql: string, params: any[]) => {
                calls.push({ sql, params });
                if (sql.includes('to_regclass')) return [{ t: 'agent_dispatch_outbox' }];
                if (sql.startsWith('UPDATE conversations c')) {
                    // The real claim is atomic: only the first caller wins.
                    if (opts.claimable === false || state.claimed) return [];
                    state.claimed = true;
                    return [{ contact_id: 'ct1', channel_type: opts.channel ?? 'telegram', channel_account_id: 'bot-1', started_at: STARTED }];
                }
                if (sql.includes('#- \'{handoff,returnReplayFor}\'')) { state.claimed = false; return []; }
                if (sql.includes('FROM messages')) return waiting;
                if (sql.includes('FROM contacts')) return [opts.contact ?? { external_id: '12345' }];
                return [];
            }),
        };
        const redis = { del: jest.fn().mockResolvedValue(1) };
        let failures = opts.enqueueFails ?? 0;
        const queue = {
            enqueue: jest.fn(async () => { if (failures-- > 0) throw new Error('redis down'); }),
        };
        const widget = {
            processWidgetMessage: jest.fn(async () => { if (opts.widgetFails) throw new Error('model down'); return { status: 'stored', messages: [] }; }),
        };
        const service = new HandoffReturnReplayService(prisma, redis as any, queue as any, {} as any);
        (service as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
        (service as any).conversationsService = async () => widget;
        const claimSql = () => calls.find(c => c.sql.startsWith('UPDATE conversations c'))!.sql;
        const released = () => calls.some(c => c.sql.includes("#- '{handoff,returnReplayFor}'"));
        return { service, calls, redis, queue, prisma, widget, claimSql, released };
    }
    const event = { tenantId: TENANT, schemaName: SCHEMA, conversationId: CONV };

    it('re-processes the waiting message through the normal queue, as the channel delivered it', async () => {
        const h = harness();
        const result = await h.service.replayWaitingMessages(event);
        expect(result.kind).toBe('enqueued');
        expect(h.queue.enqueue).toHaveBeenCalledTimes(1);
        const [msg, options] = h.queue.enqueue.mock.calls[0] as any[];
        expect(msg).toMatchObject({
            tenantId: TENANT, channelType: 'telegram', channelAccountId: 'bot-1', contactId: '12345',
            conversationId: CONV, direction: 'inbound',
            content: { type: 'text', text: '¿Hasta qué hora atienden?' },
        });
        // Same provider identity as the stored row: the pipeline finds that row, so no duplicate inbound.
        expect(msg.metadata.updateId).toBe(77);
        expect(msg.metadata.handoffReturnReplay).toBe(true);
        expect(options.jobIdSuffix).toContain('handoff-return');
    });

    it('clears the turn:done marker the skipped turn left, or the replay would be taken for a redelivery', async () => {
        const h = harness();
        await h.service.replayWaitingMessages(event);
        expect(h.redis.del).toHaveBeenCalledWith(`turn:done:${TENANT}:tgu77`);
    });

    it('combines everything the customer wrote while waiting, oldest first, into the one turn', async () => {
        const h = harness({
            waiting: [
                { id: 'm3', content_type: 'text', content_text: '¿hay alguien?', external_id: 'tgu79', metadata: { updateId: 79 }, created_at: new Date('2026-10-05T20:47:00Z') },
                { id: 'm2', content_type: 'text', content_text: 'Quiero ver precios', external_id: 'tgu78', metadata: { updateId: 78 }, created_at: new Date('2026-10-05T20:46:00Z') },
            ],
        });
        await h.service.replayWaitingMessages(event);
        const [msg] = h.queue.enqueue.mock.calls[0] as any[];
        expect(msg.content.text).toBe('Quiero ver precios\n¿hay alguien?');
        expect(msg.metadata.updateId).toBe(79);
    });

    it('keeps the texts the customer typed before a final photo: they travel as its caption', async () => {
        const h = harness({
            waiting: [
                { id: 'm2', content_type: 'image', content_text: null, media_url: 'https://cdn/x.jpg', media_mime_type: 'image/jpeg',
                    caption: null, external_id: 'tgu81', metadata: { updateId: 81 }, created_at: new Date('2026-10-05T20:47:00Z') },
                { id: 'm1', content_type: 'text', content_text: 'me llegó roto', external_id: 'tgu80', metadata: { updateId: 80 }, created_at: new Date('2026-10-05T20:46:00Z') },
            ],
        });
        await h.service.replayWaitingMessages(event);
        const [msg] = h.queue.enqueue.mock.calls[0] as any[];
        expect(msg.content).toMatchObject({ type: 'image', mediaUrl: 'https://cdn/x.jpg', mimeType: 'image/jpeg', caption: 'me llegó roto' });
        expect(msg.metadata.updateId).toBe(81);
    });

    it('a photo the stored row no longer names is replayed as the words around it, not dropped', async () => {
        const h = harness({
            waiting: [
                { id: 'm2', content_type: 'image', content_text: null, caption: null, external_id: 'tgu83', metadata: { updateId: 83 }, created_at: new Date('2026-10-05T20:47:00Z') },
                { id: 'm1', content_type: 'text', content_text: 'me llegó roto', external_id: 'tgu82', metadata: { updateId: 82 }, created_at: new Date('2026-10-05T20:46:00Z') },
            ],
        });
        await h.service.replayWaitingMessages(event);
        const [msg] = h.queue.enqueue.mock.calls[0] as any[];
        expect(msg.content).toEqual({ type: 'text', text: 'me llegó roto' });
    });

    it('is claimed once per episode: a second event, or a second sweep process, enqueues nothing more', async () => {
        const h = harness();
        await h.service.replayWaitingMessages(event);
        const second = await h.service.replayWaitingMessages(event);
        expect(second).toEqual({ kind: 'skipped', reason: 'not_claimable' });
        expect(h.queue.enqueue).toHaveBeenCalledTimes(1);
        expect(h.redis.del).toHaveBeenCalledTimes(1);
    });

    it('the claim needs status active, a pending notice, no human reply since the handoff and no earlier claim, and is capped', async () => {
        const h = harness();
        await h.service.replayWaitingMessages(event);
        const sql = h.claimSql();
        expect(sql).toContain("c.status = 'active'");
        expect(sql).toContain("c.metadata->'handoff'->>'returnedToAi' = 'true'");
        expect(sql).toContain("c.metadata->'handoff'->>'returnNoticePending' = 'true'");
        expect(sql).toContain("'returnReplayFor'");
        expect(sql).toContain("'{handoff,returnReplayClaimedAt}'");
        expect(sql).toContain("'returnReplayClaims'");
        expect(sql).toContain("m.metadata->>'source' = 'agent'");
        expect(sql).toContain("o.operational_scope->>'kind' = 'human_operator'");
    });

    it('sends nothing when the claim is not available (a person answered, the notice was consumed, not active)', async () => {
        const h = harness({ claimable: false });
        expect(await h.service.replayWaitingMessages(event)).toEqual({ kind: 'skipped', reason: 'not_claimable' });
        expect(h.queue.enqueue).not.toHaveBeenCalled();
        expect(h.redis.del).not.toHaveBeenCalled();
    });

    it('the opt-out of a waiting text is NOT decided here: the turn records it with the normal compliance path', async () => {
        const h = harness({
            waiting: [{ id: 'm1', content_type: 'text', content_text: 'STOP', external_id: 'tgu80', metadata: { updateId: 80 }, created_at: new Date() }],
        });
        expect((await h.service.replayWaitingMessages(event)).kind).toBe('enqueued');
    });

    it('a permanent skip keeps the claim, so the catch-up pass does not ask again every minute', async () => {
        for (const waiting of [
            [{ id: 'm1', content_type: 'text', content_text: 'hola', external_id: null, metadata: {}, created_at: new Date() }],
            [{ id: 'm1', content_type: 'text', content_text: 'hola', external_id: 'tgu1', metadata: {}, created_at: new Date() }],
        ]) {
            const h = harness({ waiting });
            expect((await h.service.replayWaitingMessages(event)).kind).toBe('skipped');
            expect(h.queue.enqueue).not.toHaveBeenCalled();
            expect(h.released()).toBe(false);
        }
    });

    it('an enqueue that keeps failing returns the claim so the catch-up can retry, and reports it', async () => {
        const h = harness({ enqueueFails: 3 });
        await expect(h.service.replayWaitingMessages(event)).rejects.toThrow('redis down');
        expect(h.queue.enqueue).toHaveBeenCalledTimes(3);
        expect(h.released()).toBe(true);
        await expect(h.service.replayWaitingMessages(event)).resolves.toMatchObject({ kind: 'enqueued' });
    });

    it('a transient enqueue failure is retried inside the same pass', async () => {
        const h = harness({ enqueueFails: 1 });
        await expect(h.service.replayWaitingMessages(event)).resolves.toMatchObject({ kind: 'enqueued' });
        expect(h.queue.enqueue).toHaveBeenCalledTimes(2);
        expect(h.released()).toBe(false);
    });

    it('the web chat has no queue: its own turn answers, keyed by the stored inbound, with human handoff off', async () => {
        const h = harness({
            channel: 'web_widget',
            waiting: [{ id: 'm9', content_type: 'text', content_text: 'quiero un asesor', external_id: null, metadata: {}, created_at: new Date() }],
        });
        expect(await h.service.replayWaitingMessages(event)).toEqual({ kind: 'answered_in_widget' });
        expect(h.queue.enqueue).not.toHaveBeenCalled();
        expect(h.widget.processWidgetMessage).toHaveBeenCalledWith(
            TENANT, SCHEMA, CONV, 'ct1', 'quiero un asesor',
            { channelAccountId: 'bot-1', inboundMessageId: 'm9', allowHumanHandoff: false, handoffReturnReplay: true });
    });

    it('a web chat turn that fails gives the claim back (its reply receipt keeps a retry from answering twice)', async () => {
        const h = harness({
            channel: 'web_widget', widgetFails: true,
            waiting: [{ id: 'm9', content_type: 'text', content_text: 'hola', external_id: null, metadata: {}, created_at: new Date() }],
        });
        await expect(h.service.replayWaitingMessages(event)).rejects.toThrow('model down');
        expect(h.released()).toBe(true);
    });

    it('the event listener never throws into the emitter', async () => {
        const h = harness({ enqueueFails: 3 });
        await expect(h.service.onReturned(event)).resolves.toBeUndefined();
    });

    it('looks the tenant schema up when the event does not carry it', async () => {
        const h = harness();
        await h.service.replayWaitingMessages({ tenantId: TENANT, conversationId: CONV });
        expect(h.prisma.tenant.findUnique).toHaveBeenCalled();
        expect(h.queue.enqueue).toHaveBeenCalledTimes(1);
    });
});
