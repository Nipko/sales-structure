import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AgentDispatchOutboxStore } from '../channels/agent-dispatch-outbox.store';
import { ProactiveDispatchService } from '../channels/proactive-dispatch.service';
import { DISPATCH_OUTBOX_DDL } from '../channels/agent-dispatch-outbox';
import { PROACTIVE_POLICIES } from './proactive-policy-authority';
import { SENDING_ROLES } from './human-operator-authority';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

/**
 * ═══ THE THREE THINGS A DURABLE EFFECT CAN BE SENT ON BEHALF OF ═══
 *
 * The outbox refuses a row whose authority it cannot name, and it revalidates
 * that authority inside the transaction that grants the lease. Two kinds
 * existed: an AGENT at a version, and a POLICY over a domain row.
 *
 * That left the six call sites a PERSON drives — the agent console and the
 * tenant's own send API — with no authority they could honestly carry, which is
 * why they were still on the legacy queue with no lease and no receipt. The
 * third kind is the missing one, and it revalidates the only thing that matters
 * about a person: may they still speak for this business, on this connection,
 * right now.
 *
 * The scheduled producers were in the same position for a different reason: the
 * policy registry is CLOSED, so a drip step, a nurturing nudge, a campaign
 * message, a rule action and a recall each needed an entry saying what makes
 * its message untrue. Without one they could not obtain an authority at all.
 *
 * Every assertion here is against the real store and real PostgreSQL. The
 * oracle is the outbox row — its state and its error code — never the return
 * value of the call that wrote it.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('what a durable effect is sent on behalf of', () => {
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    const schema = `tenant_auth3_${randomUUID().replace(/-/g, '')}`;
    const NUMBER = '15550001111';
    let client: PrismaClient;
    let prisma: any;
    let store: AgentDispatchOutboxStore;
    let lane: ProactiveDispatchService;
    let contactId: string;
    let conversationId: string;
    jest.setTimeout(180_000);

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);
    const global = (text: string, ...params: any[]): Promise<any> =>
        client.$executeRawUnsafe(text, ...params);

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname)
            || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(text => client.$executeRawUnsafe(text));
        await global('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)',
            tenantId, schema);
        await global('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)',
            otherTenantId, `${schema}_other`);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.getTenantSchemaName = async () => schema;

        await sql('CREATE TABLE contacts(id UUID PRIMARY KEY, name TEXT, phone TEXT, '
            + 'next_recall_at TIMESTAMPTZ, last_contact_at TIMESTAMPTZ)');
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id UUID REFERENCES contacts(id), channel_type TEXT, channel_account_id TEXT,
            status TEXT DEFAULT 'active', metadata JSONB DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id)
            WHERE external_id IS NOT NULL`);
        await sql(`CREATE TABLE appointments(id UUID PRIMARY KEY, contact_id UUID,
            conversation_id UUID, service_name TEXT, start_at TIMESTAMP, status TEXT)`);
        await sql(`CREATE TABLE drip_sequences(id UUID PRIMARY KEY DEFAULT gen_random_uuid())`);
        await sql(`CREATE TABLE drip_enrollments(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            sequence_id UUID, contact_id UUID, conversation_id UUID, current_step INTEGER DEFAULT 0,
            status VARCHAR(50) DEFAULT 'active')`);
        await sql(`CREATE TABLE campaigns(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            status VARCHAR(50) DEFAULT 'active', wa_template_name VARCHAR(255))`);
        await sql(`CREATE TABLE campaign_recipients(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            campaign_id UUID, contact_id UUID, phone VARCHAR(50), status VARCHAR(30) DEFAULT 'pending')`);
        await sql(`CREATE TABLE automation_rules(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id VARCHAR(255), name VARCHAR(255), trigger_type VARCHAR(100),
            conditions_json JSONB DEFAULT '{}', actions_json JSONB DEFAULT '[]',
            active BOOLEAN DEFAULT false)`);
        for (const statement of DISPATCH_OUTBOX_DDL) await sql(statement);

        contactId = randomUUID();
        await sql('INSERT INTO contacts(id,name,phone) VALUES($1::uuid,$2,$3)',
            [contactId, 'Ana', '+573001112233']);
        conversationId = (await sql(
            `INSERT INTO conversations(contact_id, channel_type, channel_account_id)
             VALUES($1::uuid,'whatsapp',$2) RETURNING id`, [contactId, NUMBER]))[0].id;

        store = new AgentDispatchOutboxStore(prisma,
            { getClient: () => ({ zadd: async () => 1, zremrangebyscore: async () => 0 }) } as any);
        (store as any).schemaFor = async () => schema;
        lane = new ProactiveDispatchService(prisma, store,
            { enqueueDispatch: async () => undefined } as any);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_auth3_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])',
                [tenantId, otherTenantId]);
        } finally { await client.$disconnect(); }
    });

    afterEach(async () => {
        await sql('TRUNCATE agent_dispatch_outbox CASCADE');
        await sql('DELETE FROM messages');
        if (minted.length) {
            await client.$executeRawUnsafe(
                'DELETE FROM public.users WHERE id = ANY($1::uuid[])', minted.splice(0));
        }
    });

    /**
     * A person, in the synthetic `public.users` this suite shares with every
     * other PostgreSQL suite. Only the columns that fixture defines: a suite
     * that widens the shared scaffolding changes it for everybody.
     */
    const minted: string[] = [];
    const user = async (over: Record<string, any> = {}) => {
        const id = randomUUID();
        const row = { role: 'tenant_agent', is_active: true, tenant_id: tenantId, ...over };
        await global(
            `INSERT INTO public.users(id, first_name, last_name, role, tenant_id, is_active)
             VALUES($1::uuid, 'Agente', 'Uno', $2, $3::uuid, $4)`,
            id, row.role, row.tenant_id === null ? null : row.tenant_id, row.is_active);
        minted.push(id);
        return id;
    };

    const send = (scope: any, over: Record<string, any> = {}) => lane.send(tenantId, {
        originKey: `k-${randomUUID()}`,
        conversationId, contactId,
        channelType: 'whatsapp', channelAccountId: NUMBER,
        recipient: '15559998888',
        items: [{ kind: 'text', payload: { text: 'hola' } }],
        operationalScope: scope,
        ...over,
    } as any);

    const stateOf = async (originId: string) => (await sql(
        `SELECT state, error_code FROM agent_dispatch_outbox WHERE inbound_message_id = $1::uuid`,
        [originId]))[0];

    // ── 1. THE SCHEDULED PRODUCERS NOW HAVE A POLICY ────────────────────────

    describe('the closed registry of scheduled behaviours', () => {
        it('names every producer the census says is still off the durable lane', () => {
            // A producer missing from here cannot obtain an authority, and
            // therefore cannot write a row at all — which is precisely why the
            // drip, the nurturing nudge, the campaign, the rule action and the
            // recall were still on the legacy queue.
            expect(Object.keys(PROACTIVE_POLICIES).sort()).toEqual([
                'appointment_cancellation', 'appointment_notification', 'appointment_reminder',
                'attendance_check', 'automation_rule_action', 'broadcast_message', 'drip_step',
                'nurturing_followup', 'recall_reminder',
            ]);
        });

        it('makes every one of them say, in Spanish, what it sends', () => {
            // An operator reading a suppression sees this sentence, so it is
            // part of the contract rather than decoration.
            for (const [name, policy] of Object.entries(PROACTIVE_POLICIES)) {
                expect(policy.producer).toBe(name);
                expect(policy.describes.length).toBeGreaterThan(8);
                expect(typeof policy.revision).toBe('function');
            }
        });

        const authorityFor = (producer: string, entityId: string) =>
            lane.policyAuthority(schema, {
                tenantId, producer, channelType: 'whatsapp',
                channelAccountId: NUMBER, entityId,
            });

        it('refuses an authority for a producer nobody registered', async () => {
            expect(await authorityFor('whatever_i_invented', randomUUID())).toBeUndefined();
        });

        describe('a cancellation notice', () => {
            const appointment = async (status: string) => {
                const id = randomUUID();
                await sql(`INSERT INTO appointments(id, contact_id, conversation_id, service_name,
                                start_at, status)
                           VALUES($1::uuid,$2::uuid,$3::uuid,'Consulta',
                                  (NOW() AT TIME ZONE 'America/Bogota') + interval '24 hours',$4)`,
                    [id, contactId, conversationId, status]);
                return id;
            };

            it('is authorised precisely BECAUSE the appointment is cancelled', async () => {
                // The reminder policy refuses a cancelled appointment, which is
                // right for a reminder and exactly wrong here: `cancel` commits
                // the status before it emits, so a notice asking that policy is
                // told to suppress — and the customer is never told. That is
                // not de-duplicating a message; it is deleting one.
                expect(await authorityFor('appointment_cancellation', await appointment('cancelled')))
                    .toBeDefined();
            });

            it.each(['pending', 'confirmed', 'completed'])(
                'is not authorised for a %s appointment', async status => {
                    expect(await authorityFor('appointment_cancellation', await appointment(status)))
                        .toBeUndefined();
                });

            it('is suppressed when the appointment is re-confirmed before it goes out', async () => {
                // "Your appointment was cancelled" is false about a booking
                // that is back on.
                const id = await appointment('cancelled');
                const result = await send(await authorityFor('appointment_cancellation', id));
                expect(result.kind).toBe('prepared');
                await sql(`UPDATE appointments SET status = 'confirmed' WHERE id = $1::uuid`, [id]);
                await expect(store.admit(tenantId, (await sql(
                    'SELECT id FROM agent_dispatch_outbox LIMIT 1'))[0].id))
                    .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
                expect((await stateOf((result as any).originId)).state).toBe('suppressed');
            });

            it('is not the same policy as a reminder about the same appointment', async () => {
                // Two policies, two opposite accepted statuses, one entity.
                const id = await appointment('cancelled');
                expect(await authorityFor('appointment_cancellation', id)).toBeDefined();
                expect(await authorityFor('appointment_reminder', id)).toBeUndefined();
            });
        });

        describe('a drip step', () => {
            const enrolment = async (over: Record<string, any> = {}) => {
                const id = randomUUID();
                await sql(`INSERT INTO drip_enrollments(id, contact_id, conversation_id,
                                current_step, status)
                           VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5)`,
                    [id, contactId, conversationId, over.current_step ?? 1, over.status ?? 'active']);
                return id;
            };

            it('is authorised while the enrolment is active', async () => {
                expect(await authorityFor('drip_step', await enrolment())).toBeDefined();
            });

            it.each(['stopped', 'completed', 'paused'])(
                'is not authorised once the enrolment is %s', async status => {
                    expect(await authorityFor('drip_step', await enrolment({ status })))
                        .toBeUndefined();
                });

            it('is suppressed when the enrolment advanced a step before it was sent', async () => {
                // A reply arriving while step 2 sat in the queue moves the
                // person to step 3. Delivering the prepared step 2 afterwards
                // sends the wrong part of a journey — and bills for it.
                const id = await enrolment({ current_step: 2 });
                const scope = await authorityFor('drip_step', id);
                const result = await send(scope);
                expect(result.kind).toBe('prepared');
                await sql('UPDATE drip_enrollments SET current_step = 3 WHERE id = $1::uuid', [id]);
                await expect(store.admit(tenantId, (await sql(
                    'SELECT id FROM agent_dispatch_outbox LIMIT 1'))[0].id))
                    .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
                const row = await stateOf((result as any).originId);
                expect(row.state).toBe('suppressed');
                expect(row.error_code).toContain('proactive_stale');
            });
        });

        describe('a nurturing nudge', () => {
            it('is authorised while the thread is quiet and open', async () => {
                expect(await authorityFor('nurturing_followup', conversationId)).toBeDefined();
            });

            it.each(['resolved', 'archived', 'with_human'])(
                'is not authorised on a %s thread', async status => {
                    await sql('UPDATE conversations SET status = $1 WHERE id = $2::uuid',
                        [status, conversationId]);
                    const scope = await authorityFor('nurturing_followup', conversationId);
                    await sql(`UPDATE conversations SET status = 'active' WHERE id = $1::uuid`,
                        [conversationId]);
                    expect(scope).toBeUndefined();
                });

            it('is suppressed when the customer answers before it goes out', async () => {
                // The whole premise of the nudge is that they went quiet.
                // "¿Seguís ahí?" arriving a minute after somebody wrote is the
                // most irritating thing this lane can do, and it is billed.
                const scope = await authorityFor('nurturing_followup', conversationId);
                const result = await send(scope);
                expect(result.kind).toBe('prepared');
                await sql(`INSERT INTO messages(conversation_id, direction, content_type, content_text)
                           VALUES($1::uuid,'inbound','text','perdón, recién veo')`, [conversationId]);
                await expect(store.admit(tenantId, (await sql(
                    'SELECT id FROM agent_dispatch_outbox LIMIT 1'))[0].id))
                    .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
                expect((await stateOf((result as any).originId)).state).toBe('suppressed');
            });
        });

        describe('a campaign message', () => {
            const recipient = async (over: Record<string, any> = {}) => {
                const campaignId = randomUUID();
                await sql(`INSERT INTO campaigns(id, status, wa_template_name)
                           VALUES($1::uuid,$2,'promo')`, [campaignId, over.campaign ?? 'active']);
                const id = randomUUID();
                await sql(`INSERT INTO campaign_recipients(id, campaign_id, contact_id, phone, status)
                           VALUES($1::uuid,$2::uuid,$3::uuid,'+573001112233',$4)`,
                    [id, campaignId, contactId, over.status ?? 'pending']);
                return { id, campaignId };
            };

            it('is authorised while the recipient is waiting and the campaign is running', async () => {
                expect(await authorityFor('broadcast_message', (await recipient()).id)).toBeDefined();
            });

            it.each(['sent', 'failed', 'opted_out'])(
                'is not authorised for a recipient already %s', async status => {
                    expect(await authorityFor('broadcast_message', (await recipient({ status })).id))
                        .toBeUndefined();
                });

            it.each(['paused', 'finished', 'cancelled'])(
                'is not authorised while the campaign is %s', async campaign => {
                    expect(await authorityFor('broadcast_message', (await recipient({ campaign })).id))
                        .toBeUndefined();
                });

            it('is suppressed when the operator pauses the campaign before it goes out', async () => {
                // THE FAILURE THIS EXISTS FOR. They pressed pause and the queued
                // messages kept going, each one billed — the one outcome an
                // operator most specifically tried to prevent.
                const { id, campaignId } = await recipient();
                const result = await send(await authorityFor('broadcast_message', id));
                expect(result.kind).toBe('prepared');
                await sql(`UPDATE campaigns SET status = 'paused' WHERE id = $1::uuid`, [campaignId]);
                await expect(store.admit(tenantId, (await sql(
                    'SELECT id FROM agent_dispatch_outbox LIMIT 1'))[0].id))
                    .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
                const row = await stateOf((result as any).originId);
                expect(row.state).toBe('suppressed');
                expect(row.error_code).toContain('proactive_gone');
            });
        });

        describe('a rule action', () => {
            const rule = async (active = true) => {
                const id = randomUUID();
                await sql(`INSERT INTO automation_rules(id, tenant_id, name, trigger_type,
                                actions_json, active)
                           VALUES($1::uuid,$2,'Bienvenida','contact_created',$3::jsonb,$4)`,
                    [id, tenantId, JSON.stringify([{ type: 'send_template', name: 'hola' }]), active]);
                return id;
            };

            it('is authorised while the rule is on', async () => {
                expect(await authorityFor('automation_rule_action', await rule())).toBeDefined();
            });

            it('is not authorised once somebody switched the rule off', async () => {
                expect(await authorityFor('automation_rule_action', await rule(false)))
                    .toBeUndefined();
            });

            it('is suppressed when the rule is edited before it goes out', async () => {
                // Editing which template a rule sends must not let the old one
                // leave under the new rule's authority.
                const id = await rule();
                const result = await send(await authorityFor('automation_rule_action', id));
                await sql(`UPDATE automation_rules SET actions_json = $2::jsonb WHERE id = $1::uuid`,
                    [id, JSON.stringify([{ type: 'send_template', name: 'otra' }])]);
                await expect(store.admit(tenantId, (await sql(
                    'SELECT id FROM agent_dispatch_outbox LIMIT 1'))[0].id))
                    .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
                expect((await stateOf((result as any).originId)).state).toBe('suppressed');
            });
        });

        describe('a recall', () => {
            it('is authorised for a contact with a number', async () => {
                expect(await authorityFor('recall_reminder', contactId)).toBeDefined();
            });

            it('is not authorised for a contact with no number to send to', async () => {
                const id = randomUUID();
                await sql('INSERT INTO contacts(id,name,phone) VALUES($1::uuid,$2,$3)',
                    [id, 'Sin número', '  ']);
                expect(await authorityFor('recall_reminder', id)).toBeUndefined();
            });

            it('is suppressed when the cooldown moved, which means one already went', async () => {
                // Otherwise the same person is recalled twice — read as spam by
                // them, paid for twice by the business.
                const result = await send(await authorityFor('recall_reminder', contactId));
                await sql(`UPDATE contacts SET next_recall_at = NOW() + interval '90 days'
                           WHERE id = $1::uuid`, [contactId]);
                await expect(store.admit(tenantId, (await sql(
                    'SELECT id FROM agent_dispatch_outbox LIMIT 1'))[0].id))
                    .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
                expect((await stateOf((result as any).originId)).state).toBe('suppressed');
                await sql('UPDATE contacts SET next_recall_at = NULL WHERE id = $1::uuid',
                    [contactId]);
            });
        });
    });

    // ── 2. A MESSAGE A PERSON SENT ──────────────────────────────────────────

    describe('the authority a person sends under', () => {
        const operatorFor = (userId: string, surface: any = 'agent_console') =>
            lane.operatorAuthority(schema, {
                tenantId, userId, surface, channelType: 'whatsapp', channelAccountId: NUMBER,
            });

        it('lists the roles that may put a message on a customer channel', () => {
            // Deny by default: a role not here gets no authority, so a new role
            // cannot acquire sending rights by accident.
            expect([...SENDING_ROLES].sort()).toEqual([
                'super_admin', 'tenant_admin', 'tenant_agent', 'tenant_supervisor',
            ]);
        });

        it.each(['tenant_admin', 'tenant_supervisor', 'tenant_agent'])(
            'is granted to an active %s of this tenant', async role => {
                expect(await operatorFor(await user({ role }))).toBeDefined();
            });

        it('is granted to a super_admin, who has no tenant of their own', async () => {
            // Platform mode: a super_admin genuinely has no implicit tenant, so
            // requiring a matching `tenant_id` would deny the one role that is
            // allowed to act anywhere.
            expect(await operatorFor(await user({ role: 'super_admin', tenant_id: null })))
                .toBeDefined();
        });

        it('is refused to a deactivated account', async () => {
            expect(await operatorFor(await user({ is_active: false }))).toBeUndefined();
        });

        it('is refused to a role with no sending rights', async () => {
            expect(await operatorFor(await user({ role: 'read_only_auditor' }))).toBeUndefined();
        });

        it('is refused to somebody who belongs to another tenant', async () => {
            // Otherwise a message leaves a business the sender was removed from.
            expect(await operatorFor(await user({ tenant_id: otherTenantId }))).toBeUndefined();
        });

        it('is refused to a user who does not exist', async () => {
            expect(await operatorFor(randomUUID())).toBeUndefined();
        });

        it('lets the outbox accept a row a person is sending', async () => {
            const scope = await operatorFor(await user());
            const result = await send(scope);
            expect(result.kind).toBe('prepared');
            // `queued`, not `prepared`: `send` commits the row and THEN
            // publishes it, and publishing is what moves it on.
            expect((await stateOf((result as any).originId)).state).toBe('queued');
        });

        it('suppresses the message when the account is deactivated before it leaves', async () => {
            // THE CASE THIS EXISTS FOR. Somebody is removed after sending
            // something they should not have; their queued message must not go
            // out afterwards. Authentication happened at the edge and proves who
            // ASKED, not who may still speak.
            const userId = await user();
            const result = await send(await operatorFor(userId));
            expect(result.kind).toBe('prepared');
            await global('UPDATE public.users SET is_active = false WHERE id = $1::uuid', userId);
            await expect(store.admit(tenantId, (await sql(
                'SELECT id FROM agent_dispatch_outbox LIMIT 1'))[0].id))
                .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
            const row = await stateOf((result as any).originId);
            expect(row.state).toBe('suppressed');
            expect(row.error_code).toContain('human_revoked');
        });

        it('suppresses it when the role is reduced before it leaves', async () => {
            const userId = await user({ role: 'tenant_admin' });
            const result = await send(await operatorFor(userId));
            await global(`UPDATE public.users SET role = 'read_only_auditor' WHERE id = $1::uuid`,
                userId);
            await expect(store.admit(tenantId, (await sql(
                'SELECT id FROM agent_dispatch_outbox LIMIT 1'))[0].id))
                .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
            expect((await stateOf((result as any).originId)).state).toBe('suppressed');
        });

        it('suppresses it when the person is moved to another tenant', async () => {
            const userId = await user();
            const result = await send(await operatorFor(userId));
            await global('UPDATE public.users SET tenant_id = $2::uuid WHERE id = $1::uuid',
                userId, otherTenantId);
            await expect(store.admit(tenantId, (await sql(
                'SELECT id FROM agent_dispatch_outbox LIMIT 1'))[0].id))
                .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
            expect((await stateOf((result as any).originId)).state).toBe('suppressed');
        });

        it('does NOT suppress it because the person was promoted', async () => {
            // The revalidation asks whether they may still send, not whether
            // their row is byte-identical. An agent promoted to supervisor
            // while their message sat in the queue still may send it, and
            // dropping a customer's reply over somebody's promotion would be a
            // stricter-looking check that is strictly worse.
            const userId = await user({ role: 'tenant_agent' });
            const result = await send(await operatorFor(userId));
            await global(`UPDATE public.users SET role = 'tenant_supervisor' WHERE id = $1::uuid`,
                userId);
            const admitted = await store.admit(tenantId,
                (await sql('SELECT id FROM agent_dispatch_outbox LIMIT 1'))[0].id);
            expect(admitted.row.state).toBe('admitted');
            expect((result as any).originId).toBeTruthy();
        });

        it('records the standing it was authorised under, as evidence', async () => {
            // Not the gate — the record. An audit of a disputed message reads
            // it to answer what this person was at the moment they were allowed
            // to send it.
            const scope: any = await operatorFor(await user({ role: 'tenant_admin' }));
            expect(scope.actorRevision).toMatch(/^[a-f0-9]{64}$/);
            const other: any = await operatorFor(await user({ role: 'tenant_agent' }));
            expect(other.actorRevision).not.toBe(scope.actorRevision);
        });

        it('admits it when nothing about the person changed', async () => {
            const result = await send(await operatorFor(await user()));
            const admitted = await store.admit(tenantId,
                (await sql('SELECT id FROM agent_dispatch_outbox LIMIT 1'))[0].id);
            expect(admitted.row.state).toBe('admitted');
            expect((result as any).originId).toBeTruthy();
        });

        it('refuses a row whose connection is not the one the person was authorised on', async () => {
            // The account on the row is the account Meta bills, so an authority
            // granted for one number cannot cover a message leaving another.
            //
            // Refused at PREPARE, synchronously. This used to be checked only
            // at admit: the row committed, published, took a lease and only
            // then refused — hours later for a scheduled effect, with a
            // diagnosis that reads like the thread moved when in fact the
            // producer built the two halves inconsistently.
            const scope: any = await operatorFor(await user());
            const result = await send({ ...scope, channelAccountId: '15557770000' });
            expect(result).toEqual({ kind: 'refused', reason: 'dispatch_binding_changed' });
            expect(await sql('SELECT count(*)::int AS n FROM agent_dispatch_outbox'))
                .toEqual([{ n: 0 }]);
        });
    });

    // ── 3. A PERSON ANSWERING IS NOT A CAMPAIGN ─────────────────────────────

    describe('how a human send is billed', () => {
        it('is proactive by default, because nobody wrote to us', async () => {
            const scope = await lane.operatorAuthority(schema, {
                tenantId, userId: await user(), surface: 'tenant_api',
                channelType: 'whatsapp', channelAccountId: NUMBER,
            });
            const result = await send(scope);
            const [row] = await sql('SELECT origin_kind FROM agent_dispatch_outbox LIMIT 1');
            expect(result.kind).toBe('prepared');
            expect(row.origin_kind).toBe('proactive');
        });

        it('is a reply when it answers a message the customer actually sent', async () => {
            // A console agent answering somebody who just wrote is a service
            // reply inside the window. Calling it proactive would misprice it
            // AND subject it to a soft stop meant for campaigns.
            const [inbound] = await sql(
                `INSERT INTO messages(conversation_id, direction, content_type, content_text)
                 VALUES($1::uuid,'inbound','text','hola?') RETURNING id`, [conversationId]);
            const scope = await lane.operatorAuthority(schema, {
                tenantId, userId: await user(), surface: 'agent_console',
                channelType: 'whatsapp', channelAccountId: NUMBER,
            });
            const result = await send(scope,
                { originKind: 'inbound_reply', inboundMessageId: String(inbound.id) });
            expect(result.kind).toBe('prepared');
            const [row] = await sql('SELECT origin_kind FROM agent_dispatch_outbox LIMIT 1');
            expect(row.origin_kind).toBe('inbound_reply');
        });

        it('refuses to call itself a reply without naming the message it answers', async () => {
            // Deriving an id here would let a producer claim a reply to
            // something nobody wrote, which is the whole point of the column.
            const scope = await lane.operatorAuthority(schema, {
                tenantId, userId: await user(), surface: 'agent_console',
                channelType: 'whatsapp', channelAccountId: NUMBER,
            });
            expect(await send(scope, { originKind: 'inbound_reply' }))
                .toEqual({ kind: 'refused', reason: 'inbound_message_required_for_reply' });
            expect(await sql('SELECT count(*)::int AS n FROM agent_dispatch_outbox'))
                .toEqual([{ n: 0 }]);
        });

        it('refuses to claim a reply to a message that is not on this thread', async () => {
            const scope = await lane.operatorAuthority(schema, {
                tenantId, userId: await user(), surface: 'agent_console',
                channelType: 'whatsapp', channelAccountId: NUMBER,
            });
            const result = await send(scope,
                { originKind: 'inbound_reply', inboundMessageId: randomUUID() });
            expect(result.kind).toBe('refused');
            expect((result as any).reason).toContain('dispatch_inbound_unavailable');
        });
    });
});
