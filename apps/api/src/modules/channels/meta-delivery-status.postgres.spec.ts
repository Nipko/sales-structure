import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
    DISPATCH_OUTBOX_DDL, DISPATCH_WATERMARK_MAX_ROWS,
    admitDispatch, prepareDispatchBatch, redactDispatchOutbox, settleDispatch,
    type DispatchBinding,
} from './agent-dispatch-outbox';
import { recordChannelDeliveryStatuses } from './channel-delivery-status';
import { classifyMetaMessagingEvent } from './meta-messaging-status';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

const PAGE_ID = '109876543210987';
const IG_ID = '17841499999999999';
const PSID = '2345678901234567';
const OTHER_PSID = '2345678909999999';

/**
 * Estados de Messenger e Instagram contra las tablas reales.
 *
 * Los dos canales mandan su saliente por el mismo outbox durable, así que
 * tienen recibo en `agent_dispatch_outbox.receipt` desde hace rato: lo que
 * faltaba era alguien leyendo los eventos que lo citan de vuelta. Acá se fija
 * el recorrido entero —webhook de Meta → clasificación → escritor compartido→
 * fila de `messages`— y sobre todo lo que un corte NO puede tocar.
 *
 * Cargas sintéticas con la forma de las publicadas por Meta. Ningún proveedor
 * fue llamado.
 */
(databaseUrl ? describe : describe.skip)('estados de Messenger e Instagram con PostgreSQL real', () => {
    const tenantId = randomUUID();
    const schema = `tenant_meta_status_${randomUUID().replace(/-/g, '')}`;
    let client: PrismaClient, prisma: any;

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);
    const tx = <T>(work: (query: any) => Promise<T>): Promise<T> =>
        prisma.transactionInTenantSchema(schema, work);
    const logger = { error: jest.fn(), warn: jest.fn(), debug: jest.fn() };

    /** El recorrido real: lo que llega por webhook, decidido por el escritor. */
    const ingest = (
        item: any, channelType: 'messenger' | 'instagram', channelAccountId: string,
    ) => {
        const status = classifyMetaMessagingEvent(item, channelType);
        return recordChannelDeliveryStatuses(
            status.events, { channelType, channelAccountId },
            { store: prisma, logger, resolveSchema: async () => schema },
            status.watermark ? [status.watermark] : [],
        );
    };

    const statusOf = async (receipt: string) => (await sql(
        `SELECT m.status FROM agent_dispatch_outbox d JOIN messages m ON m.id = d.message_id
          WHERE d.receipt = $1`, [receipt]))[0]?.status;

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(statement => client.$executeRawUnsafe(statement));
        await client.$executeRawUnsafe(
            'INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)', tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        await sql('CREATE TABLE contacts(id UUID PRIMARY KEY, name TEXT)');
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY, contact_id UUID REFERENCES contacts(id),
            channel_type TEXT, status TEXT DEFAULT 'active')`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id)
            WHERE external_id IS NOT NULL`);
        for (const statement of DISPATCH_OUTBOX_DDL) await sql(statement);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_meta_status_[a-f\d]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',
                tenantId, schema);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        jest.clearAllMocks();
        await sql('TRUNCATE agent_dispatch_outbox_sources, agent_dispatch_outbox, messages, conversations, contacts CASCADE');
    });

    const scope = { kind: 'agent', tenantId, schemaName: schema, agentId: randomUUID(), version: 1,
        operationalHash: 'b'.repeat(64) };

    async function binding(over: Partial<DispatchBinding> = {}): Promise<DispatchBinding> {
        const contactId = randomUUID(), conversationId = randomUUID(), inboundMessageId = randomUUID();
        await sql("INSERT INTO contacts VALUES($1::uuid,'Cliente sintético')", [contactId]);
        await sql("INSERT INTO conversations VALUES($1::uuid,$2::uuid,'messenger','active')",
            [conversationId, contactId]);
        await sql(`INSERT INTO messages(id,conversation_id,direction,content_type,content_text,status)
            VALUES($1::uuid,$2::uuid,'inbound','text','Hola','delivered')`, [inboundMessageId, conversationId]);
        return { conversationId, contactId, inboundMessageId,
            channelType: 'messenger', channelAccountId: PAGE_ID, recipient: PSID, ...over };
    }

    /** Otro turno en la MISMA conversación: un batch se ata a un inbound. */
    async function turn(bind: DispatchBinding): Promise<DispatchBinding> {
        const inboundMessageId = randomUUID();
        await sql(`INSERT INTO messages(id,conversation_id,direction,content_type,content_text,status)
            VALUES($1::uuid,$2::uuid,'inbound','text','Otro turno','delivered')`,
            [inboundMessageId, bind.conversationId]);
        return { ...bind, inboundMessageId };
    }

    /**
     * Salientes aceptados por el proveedor, con recibo, colocados en el tiempo.
     *
     * `updated_at` ES el instante de aceptación: `settleDispatch` lo estampa en
     * la misma sentencia que escribe `state='sent'`. Moverlo acá es mover
     * exactamente la variable que un corte compara.
     */
    async function accepted(
        receipts: string[], options: { bind?: DispatchBinding; acceptedAt?: Date } = {},
    ): Promise<DispatchBinding> {
        const base = options.bind ?? await binding();
        for (let offset = 0; offset < receipts.length; offset += 32) {
            // 32 ítems por lote es el techo del outbox; un hilo largo son varios
            // turnos, que es también como se acumula en la vida real.
            const chunk = receipts.slice(offset, offset + 32);
            const batchBinding = await turn(base);
            const { rows } = await tx(query => prepareDispatchBatch(query, schema, {
                binding: batchBinding,
                items: chunk.map((_, index) => ({ kind: 'text' as const, payload: { text: `linea ${index}` } })),
                operationalScope: scope,
            }));
            for (const [index, row] of rows.entries()) {
                const lease = randomUUID();
                await tx(query => admitDispatch(query, schema,
                    { dispatchId: row.id, leaseToken: lease, leaseSeconds: 60 }));
                await tx(query => settleDispatch(query, schema,
                    { dispatchId: row.id, leaseToken: lease, outcome: { kind: 'sent', receipt: chunk[index] } }));
            }
        }
        if (options.acceptedAt) {
            await sql('UPDATE agent_dispatch_outbox SET updated_at=$2 WHERE receipt = ANY($1::text[])',
                [receipts, options.acceptedAt]);
        }
        return base;
    }

    const fbDelivery = (mids: string[]) => ({
        sender: { id: PSID }, recipient: { id: PAGE_ID },
        delivery: { mids, watermark: Date.now() },
    });
    const fbRead = (watermarkMs: number, sender = PSID) => ({
        sender: { id: sender }, recipient: { id: PAGE_ID },
        timestamp: watermarkMs + 10, read: { watermark: watermarkMs },
    });

    describe('confirmación de entrega de Messenger', () => {
        it('aplica un solo evento a cada uno de sus mids', async () => {
            await accepted(['m_syn_1', 'm_syn_2', 'm_syn_3']);
            const report = await ingest(fbDelivery(['m_syn_1', 'm_syn_2', 'm_syn_3']), 'messenger', PAGE_ID);
            // A diferencia de `statuses[]` de WhatsApp, un evento abarca N.
            expect(report.results.map(r => r.reason)).toEqual(['applied', 'applied', 'applied']);
            expect(report.unavailable).toBe(false);
            for (const receipt of ['m_syn_1', 'm_syn_2', 'm_syn_3'])
                expect(await statusOf(receipt)).toBe('delivered');
        });

        it('es idempotente: el mismo evento repetido no vuelve a decidir nada', async () => {
            await accepted(['m_syn_dup']);
            await ingest(fbDelivery(['m_syn_dup']), 'messenger', PAGE_ID);
            const again = await ingest(fbDelivery(['m_syn_dup']), 'messenger', PAGE_ID);
            expect(again.results[0]).toMatchObject({ applied: false, reason: 'not_newer' });
            expect(await statusOf('m_syn_dup')).toBe('delivered');
        });

        it('no retrocede cuando la entrega llega después de la lectura', async () => {
            const bind = await binding();
            await accepted(['m_syn_ooo'], { bind });
            await ingest({ sender: { id: PSID }, recipient: { id: IG_ID }, read: { mid: 'm_syn_ooo' } },
                'instagram', IG_ID);
            expect(await statusOf('m_syn_ooo')).toBe('read');
            const late = await ingest(fbDelivery(['m_syn_ooo']), 'messenger', PAGE_ID);
            // Los webhooks llegan desordenados. El orden lo pone el ranking.
            expect(late.results[0].reason).toBe('not_newer');
            expect(await statusOf('m_syn_ooo')).toBe('read');
        });

        it('reporta un recibo que no es de nadie sin tocar nada', async () => {
            await accepted(['m_syn_mine']);
            const report = await ingest(fbDelivery(['m_syn_de_otro_sistema']), 'messenger', PAGE_ID);
            expect(report.results[0]).toMatchObject({ applied: false, reason: 'unknown_receipt' });
            expect(report.unavailable).toBe(false);
            expect(await statusOf('m_syn_mine')).toBe('sent');
        });

        it('deja quieta una fila borrada por derecho de supresión', async () => {
            const bind = await binding();
            await accepted(['m_syn_borrado'], { bind });
            await tx(query => redactDispatchOutbox(query, schema, { contactIds: [bind.contactId] }));
            const report = await ingest(fbDelivery(['m_syn_borrado']), 'messenger', PAGE_ID);
            // El borrado ya ocurrió; un webhook tardío no lo deshace.
            expect(report.results[0]).toMatchObject({ applied: false, reason: 'redacted' });
        });
    });

    describe('acuse de lectura de Instagram, que sí nombra el mensaje', () => {
        it('marca leído exactamente el mid que Meta nombró', async () => {
            const bind = await binding({ channelType: 'instagram', channelAccountId: IG_ID, recipient: PSID });
            await accepted(['ig_syn_leido', 'ig_syn_otro'], { bind });
            const report = await ingest(
                { sender: { id: PSID }, recipient: { id: IG_ID }, read: { mid: 'ig_syn_leido' } },
                'instagram', IG_ID);
            expect(report.results).toEqual([expect.objectContaining({ reason: 'applied', status: 'read' })]);
            expect(await statusOf('ig_syn_leido')).toBe('read');
            // Sin corte: el otro mensaje del hilo no se ve afectado.
            expect(await statusOf('ig_syn_otro')).toBe('sent');
        });
    });

    describe('corte de lectura de Messenger, que no nombra ninguno', () => {
        const hour = 3_600_000;

        it('resuelve el corte a los recibos que sí puede probar que abarca', async () => {
            const now = Date.now();
            const bind = await accepted(['m_syn_viejo'], { acceptedAt: new Date(now - 2 * hour) });
            await accepted(['m_syn_nuevo'], { bind, acceptedAt: new Date(now + hour) });
            const report = await ingest(fbRead(now), 'messenger', PAGE_ID);
            // Inventar un mid para el corte sería mentir sobre a qué mensaje se
            // refiere Meta; resolverlo contra lo que aceptamos, no.
            expect(report.results).toEqual([expect.objectContaining({
                providerMessageId: 'm_syn_viejo', status: 'read', reason: 'applied',
            })]);
            expect(await statusOf('m_syn_viejo')).toBe('read');
            expect(await statusOf('m_syn_nuevo')).toBe('sent');
        });

        it('repetido y fuera de orden no vuelve a decidir: no hay nada que mejorar', async () => {
            const bind = await binding();
            const now = Date.now();
            await accepted(['m_syn_wm_dup'], { bind, acceptedAt: new Date(now - hour) });
            await ingest(fbRead(now), 'messenger', PAGE_ID);
            const repeated = await ingest(fbRead(now), 'messenger', PAGE_ID);
            const older = await ingest(fbRead(now - hour / 2), 'messenger', PAGE_ID);
            // La fila ya leída sale del conjunto candidato, así que el corte
            // repetido no resuelve a nada y el viejo tampoco. Idempotente por
            // construcción, no por un flag que alguien tenga que acordarse.
            expect(repeated.results).toEqual([]);
            expect(older.results).toEqual([]);
            expect(await statusOf('m_syn_wm_dup')).toBe('read');
        });

        it('nunca alcanza el hilo de otro contacto', async () => {
            await accepted(['m_syn_ajeno'], { acceptedAt: new Date(Date.now() - hour) });
            const report = await ingest(fbRead(Date.now(), OTHER_PSID), 'messenger', PAGE_ID);
            // Un corte del hilo de otro marcando este mensaje sería contarle a un
            // agente que el cliente equivocado leyó.
            expect(report.results).toEqual([]);
            expect(await statusOf('m_syn_ajeno')).toBe('sent');
        });

        it('nunca alcanza otra cuenta ni otro canal, aun con el mismo recipient', async () => {
            await accepted(['m_syn_otra_cuenta'], { acceptedAt: new Date(Date.now() - hour) });
            expect((await ingest(fbRead(Date.now()), 'messenger', '109000000000000')).results).toEqual([]);
            expect((await ingest(fbRead(Date.now()), 'instagram', PAGE_ID)).results).toEqual([]);
            expect(await statusOf('m_syn_otra_cuenta')).toBe('sent');
        });

        it('nunca alcanza una fila que el proveedor jamás aceptó', async () => {
            const bind = await binding();
            await tx(query => prepareDispatchBatch(query, schema,
                { binding: bind, items: [{ kind: 'text', payload: { text: 'sin enviar' } }],
                    operationalScope: scope }));
            await sql("UPDATE agent_dispatch_outbox SET updated_at=NOW() - interval '1 hour'");
            const report = await ingest(fbRead(Date.now()), 'messenger', PAGE_ID);
            // `prepared` sin recibo: no salió. Un corte no puede decir que se
            // leyó algo que nunca se mandó.
            expect(report.results).toEqual([]);
            expect((await sql("SELECT status FROM messages WHERE direction='outbound'"))[0].status).toBe('pending');
        });

        it('nunca alcanza una fila borrada', async () => {
            const bind = await binding();
            await accepted(['m_syn_wm_borrado'], { bind, acceptedAt: new Date(Date.now() - hour) });
            await tx(query => redactDispatchOutbox(query, schema, { contactIds: [bind.contactId] }));
            expect((await ingest(fbRead(Date.now()), 'messenger', PAGE_ID)).results).toEqual([]);
        });

        it('nunca revive un mensaje que el proveedor rechazó', async () => {
            const bind = await binding();
            await accepted(['m_syn_rechazado'], { bind, acceptedAt: new Date(Date.now() - hour) });
            await sql("UPDATE messages SET status='failed' WHERE id=(SELECT message_id FROM agent_dispatch_outbox WHERE receipt=$1)",
                ['m_syn_rechazado']);
            const report = await ingest(fbRead(Date.now()), 'messenger', PAGE_ID);
            // El ranking del escritor por-recibo pondría `read` encima de
            // `failed` (no tiene rango). Un corte masivo no puede ser lo que
            // tape un rechazo: sería exactamente la mentira del incidente WebP.
            expect(report.results).toEqual([]);
            expect(await statusOf('m_syn_rechazado')).toBe('failed');
        });

        it('acota el alcance de un solo corte y drena con el siguiente', async () => {
            const bind = await binding();
            const many = Array.from({ length: DISPATCH_WATERMARK_MAX_ROWS + 3 },
                (_, index) => `m_syn_masivo_${index}`);
            await accepted(many, { bind, acceptedAt: new Date(Date.now() - hour) });
            const first = await ingest(fbRead(Date.now()), 'messenger', PAGE_ID);
            expect(first.results).toHaveLength(DISPATCH_WATERMARK_MAX_ROWS);
            // El tope es un límite de radio, no un mecanismo de corrección: las
            // que quedaron siguen en el conjunto candidato y las toma el próximo.
            const second = await ingest(fbRead(Date.now()), 'messenger', PAGE_ID);
            expect(second.results).toHaveLength(3);
            expect((await ingest(fbRead(Date.now()), 'messenger', PAGE_ID)).results).toEqual([]);
            const leidos = await sql("SELECT count(*)::int AS n FROM messages WHERE status='read'");
            expect(leidos[0].n).toBe(many.length);
        });
    });

    describe('lo que ya no se pierde en silencio', () => {
        it('cada forma que el controller descartaba llega ahora a una decisión', async () => {
            await accepted(['m_syn_antes_perdido']);
            const shapes: Array<[string, any, 'messenger' | 'instagram', string]> = [
                ['delivery', fbDelivery(['m_syn_antes_perdido']), 'messenger', PAGE_ID],
                ['read de Messenger', fbRead(Date.now()), 'messenger', PAGE_ID],
                ['read de Instagram', { sender: { id: PSID }, recipient: { id: IG_ID },
                    read: { mid: 'm_syn_antes_perdido' } }, 'instagram', IG_ID],
            ];
            for (const [label, item, channelType] of shapes) {
                // Antes: `handleWebhook` devolvía null y el controller hacía
                // `continue`. Ninguna de estas tres formas producía un solo
                // efecto ni una sola línea de log.
                const status = classifyMetaMessagingEvent(item, channelType);
                expect([status.events.length > 0, status.watermark !== null])
                    .toEqual(expect.arrayContaining([true]));
                expect(status.kind).toMatch(label.startsWith('delivery') ? /delivery/ : /read/);
            }
            expect(await statusOf('m_syn_antes_perdido')).toBe('sent');
        });

        it('un evento no modelado se nombra en vez de desaparecer', async () => {
            const reaction = classifyMetaMessagingEvent(
                { sender: { id: PSID }, reaction: { mid: 'm_syn_x', action: 'react' } }, 'messenger');
            expect(reaction.kind).toBe('reaction');
            // Sin estado que aplicar, pero con nombre: el controller loguea el
            // `kind` y nadie tiene que volver a descubrir el silencio a mano.
            expect(await ingest({ sender: { id: PSID }, reaction: { mid: 'm_syn_x' } }, 'messenger', PAGE_ID))
                .toEqual({ results: [], unavailable: false });
        });
    });
});
