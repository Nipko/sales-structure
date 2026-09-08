import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HandoffService } from './handoff.service';
import { handoffNoticeText } from './handoff-notice';
import {
    HANDOFF_RECEIPT_DDL,
    HandoffReceiptAlreadyRecorded,
    HandoffReceiptBindingChanged,
    handoffReceiptNotice,
    readHandoffReceipt,
    recordHandoffReceipt,
} from './handoff-receipt';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('Canonical handoff receipt with real PostgreSQL', () => {
    const tenantId = randomUUID();
    const schema = `tenant_handoff_rcpt_${randomUUID().replace(/-/g, '')}`;
    let client: PrismaClient, second: PrismaClient;
    let prisma: any, prismaSecond: any;

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);
    const tx = <T>(work: (query: any) => Promise<T>, owner: any = prisma): Promise<T> =>
        owner.transactionInTenantSchema(schema, work);

    function serviceFor(owner: any) {
        const redis = { set: jest.fn().mockResolvedValue(undefined), del: jest.fn(), get: jest.fn(),
            acquireLockToken: jest.fn().mockResolvedValue('resume-lock'),
            releaseLockToken: jest.fn().mockResolvedValue(undefined) };
        const events = { emit: jest.fn().mockReturnValue(true), emitAsync: jest.fn().mockResolvedValue([]) };
        const email = { send: jest.fn().mockResolvedValue(undefined) };
        // The bounded attempt, not a boolean: a durable transfer has to be able
        // to tell "not configured" from "accepted, and then the socket died".
        const templates = { renderAndPrepare: jest.fn().mockResolvedValue(async () => 'smtp-message-id') };
        // No provider call: the deterministic summary fallback is exercised.
        const llm = { execute: jest.fn().mockRejectedValue(new Error('provider unavailable')) };
        const aiResolution = { ensureResolutionColumns: jest.fn().mockResolvedValue(undefined) };
        const service = new HandoffService(owner, redis as any, events as any, email as any,
            templates as any, llm as any, aiResolution as any, { runExclusive: jest.fn() } as any);
        // Routing has its own tables and evidence; this suite is about the receipt.
        jest.spyOn(service as any, 'tryAutoAssign').mockResolvedValue(null);
        /** Which consumers were told, by name. One aggregate count could not say. */
        const announced = () => events.emitAsync.mock.calls
            .map(call => String(call[0])).filter(name => name.startsWith('handoff.escalated.')).sort();
        return { service, redis, events, templates, announced };
    }

    const ALL_DESTINATIONS = ['crm', 'inbox', 'push', 'slack', 'sms', 'webhooks']
        .map(name => `handoff.escalated.${name}`).sort();
    /** How many times each destination was attempted. The number that matters. */
    const attemptsByDestination = async (receiptId: string) => Object.fromEntries(
        (await sql('SELECT destination, state, attempts FROM agent_handoff_effects WHERE receipt_id=$1::uuid',
            [receiptId])).map((row: any) => [row.destination, Number(row.attempts)]));
    /** A crash right after the transition: the receipt exists, nothing else ran. */
    const forgetEveryEffect = (receiptId: string) => sql(
        `UPDATE agent_handoff_effects SET state='prepared', attempts=0, receipt=NULL,
             error_code=NULL, lease_token=NULL, lease_expires_at=NULL WHERE receipt_id=$1::uuid`, [receiptId]);
    const forgetEffect = (receiptId: string, destination: string) => sql(
        `UPDATE agent_handoff_effects SET state='prepared', attempts=0, receipt=NULL,
             error_code=NULL, lease_token=NULL, lease_expires_at=NULL
           WHERE receipt_id=$1::uuid AND destination=$2`, [receiptId, destination]);

    function inboundMessage(conversationId: string, contactExternalId: string): any {
        return {
            id: 'provider-inbound-1', tenantId, conversationId, contactId: contactExternalId,
            channelType: 'web_widget', channelAccountId: 'widget-main', direction: 'inbound',
            status: 'delivered', content: { type: 'text', text: 'Quiero hablar con una persona' },
            timestamp: new Date('2026-09-08T00:00:00.000Z'), metadata: {},
        };
    }

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        second = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(sql => client.$executeRawUnsafe(sql));
        await client.$executeRawUnsafe(
            'INSERT INTO public.tenants(id,schema_name,is_active,language) VALUES($1::uuid,$2,true,$3)',
            tenantId, schema, 'es');
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        const build = (owner: PrismaClient) => {
            const service: any = Object.create(PrismaService.prototype);
            service.$transaction = owner.$transaction.bind(owner);
            service.getTenantSchemaName = jest.fn(async () => schema);
            service.tenant = {
                findUnique: jest.fn(async (args: any) => (
                    args?.select?.language ? { language: 'es' } : { billingEmail: null })),
            };
            service.user = { findFirst: jest.fn(async () => null) };
            service.$queryRaw = owner.$queryRaw.bind(owner);
            return service;
        };
        prisma = build(client);
        prismaSecond = build(second);
        await sql(`CREATE TABLE contacts(id UUID PRIMARY KEY, name TEXT, phone TEXT,
            channel_type TEXT, external_id TEXT)`);
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY, contact_id UUID REFERENCES contacts(id),
            channel_type TEXT NOT NULL, channel_account_id TEXT NOT NULL, status TEXT DEFAULT 'active',
            was_handed_off BOOLEAN DEFAULT false, handoff_at TIMESTAMPTZ,
            metadata JSONB DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY, conversation_id UUID REFERENCES conversations(id),
            direction TEXT, content_text TEXT, metadata JSONB DEFAULT '{}',
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE internal_notes(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID, agent_id UUID, content TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql('CREATE TABLE turn_traces(id UUID PRIMARY KEY, conversation_id UUID, steps JSONB, created_at TIMESTAMPTZ)');
        await sql('CREATE TABLE conversation_traces(id UUID PRIMARY KEY, conversation_id UUID, steps JSONB, created_at TIMESTAMPTZ)');
        for (const statement of HANDOFF_RECEIPT_DDL) await sql(statement);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_handoff_rcpt_[a-f\d]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',
                tenantId, schema);
        } finally {
            await client.$disconnect();
            await second.$disconnect();
        }
    });

    beforeEach(async () => {
        await sql('TRUNCATE agent_handoff_receipts, internal_notes, messages, conversations, contacts CASCADE');
        jest.restoreAllMocks();
    });

    async function fixture(options: { status?: string; accountId?: string } = {}) {
        const contactId = randomUUID(), conversationId = randomUUID();
        const inboundMessageId = randomUUID(), outboundMessageId = randomUUID();
        const externalId = `widget_${randomUUID()}`;
        await sql(`INSERT INTO contacts(id,name,phone,channel_type,external_id)
            VALUES($1::uuid,'Cliente sintético','+573000000000','web_widget',$2)`, [contactId, externalId]);
        await sql(`INSERT INTO conversations(id,contact_id,channel_type,channel_account_id,status)
            VALUES($1::uuid,$2::uuid,'web_widget',$3,$4)`,
        [conversationId, contactId, options.accountId || 'widget-main', options.status || 'active']);
        await sql(`INSERT INTO messages(id,conversation_id,direction,content_text)
            VALUES($1::uuid,$3::uuid,'inbound','Quiero hablar con una persona'),
                  ($2::uuid,$3::uuid,'outbound','Respuesta anterior del agente')`,
        [inboundMessageId, outboundMessageId, conversationId]);
        return { contactId, conversationId, inboundMessageId, outboundMessageId, externalId };
    }

    const request = (f: Awaited<ReturnType<typeof fixture>>, over: any = {}) => ({
        conversationId: f.conversationId, contactId: f.contactId, inboundMessageId: f.inboundMessageId,
        toStatus: 'waiting_human', reason: 'explicit_request',
        noticeKind: 'queue_head' as const, noticeLanguage: 'es' as const, ...over,
    });

    describe('binding to the exact inbound and transition', () => {
        it('records the status and channel identity read from the locked conversation row', async () => {
            const f = await fixture({ accountId: 'widget-secondary' });
            const receipt = await tx(query => recordHandoffReceipt(query, schema,
                request(f, { noticeLanguage: 'pt' })));
            expect(receipt).toMatchObject({
                conversationId: f.conversationId, contactId: f.contactId,
                inboundMessageId: f.inboundMessageId, channelType: 'web_widget',
                channelAccountId: 'widget-secondary', fromStatus: 'active',
                toStatus: 'waiting_human', noticeKind: 'queue_head', noticeLanguage: 'pt',
            });
            expect(handoffReceiptNotice(receipt)).toBe(handoffNoticeText('queue_head', 'pt'));
        });

        it('refuses a conversation a person already owns', async () => {
            for (const status of ['waiting_human', 'with_human']) {
                const f = await fixture({ status });
                await expect(tx(query => recordHandoffReceipt(query, schema, request(f))))
                    .rejects.toBeInstanceOf(HandoffReceiptBindingChanged);
                expect(await sql('SELECT id FROM agent_handoff_receipts')).toHaveLength(0);
            }
        });

        it('refuses a conversation nobody is waiting on', async () => {
            for (const status of ['resolved', 'archived', 'closed']) {
                const f = await fixture({ status });
                await expect(tx(query => recordHandoffReceipt(query, schema, request(f))))
                    .rejects.toBeInstanceOf(HandoffReceiptBindingChanged);
                expect(await sql('SELECT id FROM agent_handoff_receipts')).toHaveLength(0);
            }
        });

        it('refuses an inbound that is absent, outbound, or from another conversation', async () => {
            const f = await fixture(), other = await fixture();
            for (const inboundMessageId of [randomUUID(), f.outboundMessageId, other.inboundMessageId]) {
                await expect(tx(query => recordHandoffReceipt(query, schema, request(f, { inboundMessageId }))))
                    .rejects.toBeInstanceOf(HandoffReceiptBindingChanged);
            }
            expect(await sql('SELECT id FROM agent_handoff_receipts')).toHaveLength(0);
        });

        it('refuses a contact that does not own the conversation, and an invalid scope', async () => {
            const f = await fixture(), other = await fixture();
            await expect(tx(query => recordHandoffReceipt(query, schema, request(f, { contactId: other.contactId }))))
                .rejects.toBeInstanceOf(HandoffReceiptBindingChanged);
            await expect(tx(query => recordHandoffReceipt(query, 'public', request(f))))
                .rejects.toBeInstanceOf(HandoffReceiptBindingChanged);
            await expect(tx(query => recordHandoffReceipt(query, schema, request(f, { noticeKind: 'anything' }))))
                .rejects.toBeInstanceOf(HandoffReceiptBindingChanged);
            await expect(tx(query => recordHandoffReceipt(query, schema, request(f, { toStatus: 'active' }))))
                .rejects.toBeInstanceOf(HandoffReceiptBindingChanged);
            await expect(tx(query => recordHandoffReceipt(query, schema, request(f, { reason: '' }))))
                .rejects.toBeInstanceOf(HandoffReceiptBindingChanged);
            expect(await sql('SELECT id FROM agent_handoff_receipts')).toHaveLength(0);
        });

        it('truncates a long reason instead of aborting a transfer over evidence', async () => {
            const f = await fixture();
            const receipt = await tx(query => recordHandoffReceipt(query, schema,
                request(f, { reason: `Procedimiento: ${'n'.repeat(900)}` })));
            expect(receipt.reason).toHaveLength(500);
            expect(receipt.reason.startsWith('Procedimiento: ')).toBe(true);
        });
    });

    describe('one transfer per inbound', () => {
        it('refuses a second receipt for the same inbound', async () => {
            const f = await fixture();
            await tx(query => recordHandoffReceipt(query, schema, request(f)));
            await sql("UPDATE conversations SET status='active' WHERE id=$1::uuid", [f.conversationId]);
            await expect(tx(query => recordHandoffReceipt(query, schema, request(f))))
                .rejects.toBeInstanceOf(HandoffReceiptAlreadyRecorded);
            expect(await sql('SELECT id FROM agent_handoff_receipts')).toHaveLength(1);
        });

        it('rolls the receipt back with the transition it was recorded beside', async () => {
            const f = await fixture();
            await expect(tx(async query => {
                await recordHandoffReceipt(query, schema, request(f));
                await query("UPDATE conversations SET status='waiting_human' WHERE id=$1::uuid", [f.conversationId]);
                throw new Error('transition failed after the receipt');
            })).rejects.toThrow('transition failed after the receipt');
            expect(await sql('SELECT id FROM agent_handoff_receipts')).toHaveLength(0);
            const [conversation] = await sql('SELECT status FROM conversations WHERE id=$1::uuid', [f.conversationId]);
            expect(conversation.status).toBe('active');
        });
    });

    describe('recovering an existing receipt', () => {
        it('returns it for the exact binding and refuses a different one', async () => {
            const f = await fixture(), other = await fixture();
            const stored = await tx(query => recordHandoffReceipt(query, schema, request(f)));
            const lookup = { conversationId: f.conversationId, contactId: f.contactId, inboundMessageId: f.inboundMessageId };
            await expect(tx(query => readHandoffReceipt(query, schema, lookup))).resolves.toEqual(stored);
            await expect(tx(query => readHandoffReceipt(query, schema,
                { ...lookup, contactId: other.contactId }))).rejects.toBeInstanceOf(HandoffReceiptBindingChanged);
            await expect(tx(query => readHandoffReceipt(query, schema,
                { ...lookup, conversationId: other.conversationId }))).rejects.toBeInstanceOf(HandoffReceiptBindingChanged);
            await expect(tx(query => readHandoffReceipt(query, schema,
                { ...lookup, inboundMessageId: other.inboundMessageId }))).resolves.toBeNull();
        });

        it('survives erasure of the messages it names, so a replay cannot transfer again', async () => {
            const f = await fixture();
            const stored = await tx(query => recordHandoffReceipt(query, schema, request(f)));
            await sql('DELETE FROM messages WHERE conversation_id=$1::uuid', [f.conversationId]);
            const lookup = { conversationId: f.conversationId, contactId: f.contactId, inboundMessageId: f.inboundMessageId };
            await expect(tx(query => readHandoffReceipt(query, schema, lookup))).resolves.toEqual(stored);
        });
    });

    describe('escalating through the service', () => {
        it('transfers once and reproduces the notice without repeating the transfer', async () => {
            const f = await fixture();
            const { service, redis, announced } = serviceFor(prisma);
            const message = inboundMessage(f.conversationId, f.externalId);
            const first = await service.executeHandoffOnce(tenantId, f.conversationId, message, 'explicit_request',
                { contactId: f.contactId, inboundMessageId: f.inboundMessageId, noticeKind: 'queue_head', noticeLanguage: 'es' });
            const second = await service.executeHandoffOnce(tenantId, f.conversationId, message, 'explicit_request',
                { contactId: f.contactId, inboundMessageId: f.inboundMessageId, noticeKind: 'queue_head', noticeLanguage: 'es' });

            expect(second).toEqual(first);
            expect(handoffReceiptNotice(second)).toBe(handoffNoticeText('queue_head', 'es'));
            expect(await sql('SELECT id FROM agent_handoff_receipts')).toHaveLength(1);
            // The transfer itself ran exactly once: one note, one cache write, one event.
            expect(await sql('SELECT id FROM internal_notes')).toHaveLength(1);
            expect(redis.set).toHaveBeenCalledTimes(1);
            // Each consumer heard once, and the list is what proves it: one
            // aggregate count cannot tell six announcements from one repeated.
            expect(announced()).toEqual(ALL_DESTINATIONS);
            const [conversation] = await sql('SELECT status, was_handed_off FROM conversations WHERE id=$1::uuid',
                [f.conversationId]);
            expect(conversation).toMatchObject({ status: 'waiting_human', was_handed_off: true });
        });

        it('lets a concurrent turn recover the winning receipt without a second transfer', async () => {
            const f = await fixture();
            const owners = [serviceFor(prisma), serviceFor(prismaSecond)];
            const message = inboundMessage(f.conversationId, f.externalId);
            const attempt = (owner: (typeof owners)[number]) => owner.service.executeHandoffOnce(
                tenantId, f.conversationId, message, 'explicit_request',
                { contactId: f.contactId, inboundMessageId: f.inboundMessageId, noticeKind: 'queue_head', noticeLanguage: 'es' });
            const [left, right] = await Promise.all(owners.map(attempt));

            // Identity, not the effects snapshot: the loser reads the receipt
            // while the winner is still settling its phases, so the two views
            // legitimately differ in how far along they saw it.
            expect(left.id).toBe(right.id);
            expect(left.inboundMessageId).toBe(right.inboundMessageId);
            expect(await sql('SELECT id FROM agent_handoff_receipts')).toHaveLength(1);
            expect(await sql('SELECT id FROM internal_notes')).toHaveLength(1);
            const announcements = owners.flatMap(owner => owner.announced());
            expect(announcements.sort()).toEqual(ALL_DESTINATIONS);
        });

        it('finishes the effects a crashed transfer never reached, repeating none', async () => {
            const f = await fixture();
            const { service, redis, events, announced } = serviceFor(prisma);
            const message = inboundMessage(f.conversationId, f.externalId);
            const request = { contactId: f.contactId, inboundMessageId: f.inboundMessageId,
                noticeKind: 'queue_head' as const, noticeLanguage: 'es' as const };

            // Crash right after the transition committed: the receipt exists and
            // no side effect ran. This used to be invisible — a receipt made
            // every later attempt return at once, so nobody was ever told.
            const first = await service.executeHandoffOnce(tenantId, f.conversationId, message, 'explicit_request', request);
            await sql("UPDATE agent_handoff_receipts SET effects='{}'::jsonb WHERE id=$1::uuid", [first.id]);
            await forgetEveryEffect(first.id);
            await sql('DELETE FROM internal_notes');
            redis.set.mockClear(); events.emitAsync.mockClear();

            const resumed = await service.executeHandoffOnce(tenantId, f.conversationId, message, 'explicit_request', request);
            expect(resumed.id).toBe(first.id);
            expect(redis.set).toHaveBeenCalledTimes(1);
            expect(announced()).toEqual(ALL_DESTINATIONS);
            // The transition itself is never repeated: no second internal note.
            expect(await sql('SELECT id FROM internal_notes')).toHaveLength(0);
            expect(await sql('SELECT id FROM agent_handoff_receipts')).toHaveLength(1);
            const [row] = await sql('SELECT effects FROM agent_handoff_receipts WHERE id=$1::uuid', [first.id]);
            expect(Object.keys(row.effects).sort()).toEqual(['announced', 'assignment', 'cache', 'notified']);
        });

        it('resumes only the phase that is missing, and never re-announces', async () => {
            const f = await fixture();
            const { service, redis, events, templates, announced } = serviceFor(prisma);
            const message = inboundMessage(f.conversationId, f.externalId);
            const request = { contactId: f.contactId, inboundMessageId: f.inboundMessageId,
                noticeKind: 'queue_head' as const, noticeLanguage: 'es' as const };
            const first = await service.executeHandoffOnce(tenantId, f.conversationId, message, 'explicit_request', request);

            // Crash after the announcement but before the notification settled.
            await sql(`UPDATE agent_handoff_receipts SET effects = effects - 'notified' WHERE id=$1::uuid`, [first.id]);
            await forgetEffect(first.id, 'email');
            redis.set.mockClear(); events.emitAsync.mockClear(); templates.renderAndPrepare.mockClear();
            await service.executeHandoffOnce(tenantId, f.conversationId, message, 'explicit_request', request);
            // Ringing the inbox twice for one transfer is the repeat that matters.
            expect(announced()).toEqual([]);
            expect(redis.set).not.toHaveBeenCalled();
            // Only the destination that never settled ran again, and the
            // attempt counters say so per destination rather than in aggregate.
            expect(await attemptsByDestination(first.id)).toEqual({
                assignment: 1, cache: 1, inbox: 1, crm: 1, webhooks: 1, push: 1, slack: 1, sms: 1, email: 1,
            });
        });

        it('does everything exactly once when nothing crashed', async () => {
            const f = await fixture();
            const { service, redis, announced } = serviceFor(prisma);
            const message = inboundMessage(f.conversationId, f.externalId);
            const request = { contactId: f.contactId, inboundMessageId: f.inboundMessageId,
                noticeKind: 'queue_head' as const, noticeLanguage: 'es' as const };
            await service.executeHandoffOnce(tenantId, f.conversationId, message, 'explicit_request', request);
            await service.executeHandoffOnce(tenantId, f.conversationId, message, 'explicit_request', request);
            await service.executeHandoffOnce(tenantId, f.conversationId, message, 'explicit_request', request);
            expect(redis.set).toHaveBeenCalledTimes(1);
            expect(announced()).toEqual(ALL_DESTINATIONS);
            expect(await sql('SELECT id FROM internal_notes')).toHaveLength(1);
            const [receipt] = await sql('SELECT id FROM agent_handoff_receipts');
            expect(await attemptsByDestination(receipt.id)).toEqual({
                assignment: 1, cache: 1, inbox: 1, crm: 1, webhooks: 1, push: 1, slack: 1, sms: 1, email: 1,
            });
        });

        it('retries only the consumer that failed, and tells the others nothing twice', async () => {
            const f = await fixture();
            const { service, events, announced } = serviceFor(prisma);
            const message = inboundMessage(f.conversationId, f.externalId);
            const request = { contactId: f.contactId, inboundMessageId: f.inboundMessageId,
                noticeKind: 'queue_head' as const, noticeLanguage: 'es' as const };
            // Slack is down for the first transfer only. Under the old aggregate
            // flag this is what re-announced the transfer to all six.
            events.emitAsync.mockImplementation(async (name: string) =>
                name === 'handoff.escalated.slack' ? Promise.reject(new Error('slack_unreachable')) : []);

            const first = await service.executeHandoffOnce(tenantId, f.conversationId, message, 'explicit_request', request);
            expect(await attemptsByDestination(first.id)).toMatchObject({ inbox: 1, slack: 1, sms: 1 });
            const [failed] = await sql(
                "SELECT state, error_code FROM agent_handoff_effects WHERE receipt_id=$1::uuid AND destination='slack'",
                [first.id]);
            expect(failed).toMatchObject({ state: 'rejected', error_code: 'slack_unreachable' });

            events.emitAsync.mockClear();
            events.emitAsync.mockResolvedValue([]);
            await service.executeHandoffOnce(tenantId, f.conversationId, message, 'explicit_request', request);

            expect(announced()).toEqual(['handoff.escalated.slack']);
            expect(await attemptsByDestination(first.id)).toMatchObject({ inbox: 1, slack: 2, sms: 1 });
        });

        it('records a notification nobody can vouch for as uncertain, and never sends a second', async () => {
            const f = await fixture();
            const { service, templates } = serviceFor(prisma);
            const message = inboundMessage(f.conversationId, f.externalId);
            const request = { contactId: f.contactId, inboundMessageId: f.inboundMessageId,
                noticeKind: 'queue_head' as const, noticeLanguage: 'es' as const };
            // Who receives it is not what this test is about; that there IS a
            // recipient is, because the classification only matters once the
            // transport was actually asked to send something.
            jest.spyOn(service as any, 'resolveHandoffFallbackRecipient').mockResolvedValue(
                { email: 'owner@example.test', slug: 'handoff_notification_unassigned' });
            // The server took the message and the socket died before it said so.
            templates.renderAndPrepare.mockResolvedValue(async () => {
                throw new Error('smtp_deadline_outcome_unknown');
            });

            const first = await service.executeHandoffOnce(tenantId, f.conversationId, message, 'explicit_request', request);
            const [email] = await sql(
                "SELECT state, error_code, attempts FROM agent_handoff_effects WHERE receipt_id=$1::uuid AND destination='email'",
                [first.id]);
            expect(email).toMatchObject({ state: 'unknown', error_code: 'smtp_deadline_outcome_unknown', attempts: 1 });

            templates.renderAndPrepare.mockClear();
            await service.executeHandoffOnce(tenantId, f.conversationId, message, 'explicit_request', request);
            expect(templates.renderAndPrepare).not.toHaveBeenCalled();
            const [after] = await sql(
                "SELECT attempts FROM agent_handoff_effects WHERE receipt_id=$1::uuid AND destination='email'",
                [first.id]);
            expect(Number(after.attempts)).toBe(1);
        });

        it('reports no receipt for an inbound that never transferred the conversation', async () => {
            const f = await fixture();
            const { service } = serviceFor(prisma);
            await expect(service.lookupHandoffReceipt(tenantId, {
                conversationId: f.conversationId, contactId: f.contactId, inboundMessageId: f.inboundMessageId,
            })).resolves.toBeNull();
        });
    });
});
