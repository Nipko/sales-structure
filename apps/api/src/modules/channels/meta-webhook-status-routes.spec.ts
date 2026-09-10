import * as crypto from 'crypto';
import { ChannelsController } from './channels.controller';

/**
 * ═══ LAS DOS RUTAS QUE TIRABAN LOS EVENTOS ═══
 *
 * `receiveInstagram` y `receiveMessenger` hacían `if (!normalized) continue;`.
 * Como `handleWebhook` sólo contesta "¿es un mensaje entrante?", ese `continue`
 * se comía por igual las confirmaciones de entrega, los acuses de lectura, los
 * ecos y las reacciones — sin una línea de log, que es lo que obligó a
 * descubrir el problema del WebP a mano meses después.
 *
 * Acá se fija el contrato de la ruta, no el del escritor (eso lo prueba
 * `meta-delivery-status.postgres.spec.ts`): qué llega al escritor compartido,
 * qué llega a la cola de entrantes, qué queda nombrado en el log, y que Meta
 * siga recibiendo su 200 en todos los casos.
 *
 * Cuerpos sintéticos con la forma publicada por Meta y firmados con un secreto
 * de prueba. Ningún proveedor fue llamado.
 */

const APP_SECRET = 'synthetic-app-secret-for-tests';
const PAGE_ID = '109876543210987';
const IG_ID = '17841499999999999';
const PSID = '2345678901234567';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const SCHEMA = 'tenant_meta_routes';

describe('las rutas de webhook de Messenger e Instagram', () => {
    function harness(options: { schema?: string | null } = {}) {
        const applied: Array<{ sql: string; params: any[] }> = [];
        const enqueued: any[] = [];
        const logs = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
        const prisma: any = {
            channelAccount: { findFirst: jest.fn(async () => ({ tenantId: TENANT_ID })) },
            getTenantSchemaName: jest.fn(async () =>
                (options.schema === undefined ? SCHEMA : options.schema)),
            transactionInTenantSchema: jest.fn(async (_schema: string, work: any) => work(
                jest.fn(async (sql: string, params: any[] = []) => {
                    if (sql.includes('current_schema() AS schema')) {
                        return [{ schema: SCHEMA, outbox: 'agent_dispatch_outbox' }];
                    }
                    if (sql.includes('FROM agent_dispatch_outbox d')
                        && sql.includes('FOR UPDATE OF d')) {
                        return [{ id: 'row-1', message_id: 'msg-1', redacted_at: null }];
                    }
                    // Read after the lock, not in the statement that takes it:
                    // joining it in answered from the snapshot taken before the
                    // lock was granted, so a late event decided from a stale status.
                    if (sql.includes('SELECT status FROM messages WHERE id')) {
                        return [{ status: 'sent' }];
                    }
                    if (sql.includes('SELECT d.receipt FROM agent_dispatch_outbox d')) {
                        return [{ receipt: 'm_syn_resuelto' }];
                    }
                    applied.push({ sql, params });
                    return [];
                }))),
            executeInTenantSchema: jest.fn(async () => []),
        };
        const gateway = {
            processIncomingWebhook: jest.fn(async () => ({
                id: 'normalized-1', tenantId: '', channelType: 'messenger',
                channelAccountId: PAGE_ID, contactId: PSID, conversationId: '',
                direction: 'inbound', content: { type: 'text', text: 'hola' },
                timestamp: new Date(), status: 'pending', metadata: {},
            })),
        };
        const inboundQueue = { enqueue: jest.fn(async (message: any) => { enqueued.push(message); }) };
        const redis = { getJson: jest.fn(async () => ({ contactName: 'Cliente sintético' })), setJson: jest.fn() };
        const config = { get: jest.fn(() => APP_SECRET) };
        const controller = new ChannelsController(
            gateway as any, {} as any, {} as any, {} as any, {} as any, prisma,
            {} as any, config as any, redis as any, {} as any, inboundQueue as any);
        (controller as any).logger = logs;
        return { controller, prisma, applied, enqueued, logs, gateway, inboundQueue };
    }

    const res = () => {
        const sent: any[] = [];
        const self: any = {
            status: jest.fn(() => self),
            send: jest.fn((body: any) => { sent.push(body); return self; }),
        };
        self.sent = sent;
        return self;
    };

    const signed = (body: any) => {
        const raw = Buffer.from(JSON.stringify(body));
        return {
            body,
            raw,
            signature: 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex'),
        };
    };

    const envelope = (object: 'page' | 'instagram', id: string, messaging: any[]) => ({
        object, entry: [{ id, time: 1758668856000, messaging }],
    });

    const post = async (
        controller: ChannelsController, route: 'instagram' | 'messenger', body: any,
    ) => {
        const { raw, signature } = signed(body);
        const response = res();
        const handler = route === 'instagram' ? controller.receiveInstagram : controller.receiveMessenger;
        await handler.call(controller, body, signature, { rawBody: raw } as any, response);
        return response;
    };

    /** Sólo lo que el escritor compartido escribió sobre `messages`. */
    const statusWrites = (applied: Array<{ sql: string; params: any[] }>) =>
        applied.filter(entry => entry.sql.includes('UPDATE messages SET status'))
            .map(entry => entry.params[1]);

    describe('lo que antes se caía por el `continue`', () => {
        it('aplica una confirmación de entrega de Messenger, mid por mid', async () => {
            const { controller, applied, enqueued } = harness();
            const response = await post(controller, 'messenger', envelope('page', PAGE_ID, [{
                sender: { id: PSID }, recipient: { id: PAGE_ID },
                delivery: { mids: ['m_syn_a', 'm_syn_b'], watermark: 1758668856253 },
            }]));
            expect(statusWrites(applied)).toEqual(['delivered', 'delivered']);
            // Un estado NO es un mensaje entrante: no puede terminar en la cola.
            expect(enqueued).toHaveLength(0);
            expect(response.status).toHaveBeenCalledWith(200);
        });

        it('aplica un acuse de lectura de Instagram al mid que nombra', async () => {
            const { controller, applied, enqueued } = harness();
            await post(controller, 'instagram', envelope('instagram', IG_ID, [{
                sender: { id: PSID }, recipient: { id: IG_ID },
                timestamp: 1758668856349, read: { mid: 'ig_syn_leido' },
            }]));
            expect(statusWrites(applied)).toEqual(['read']);
            expect(enqueued).toHaveLength(0);
        });

        it('resuelve el corte de lectura de Messenger antes de escribir', async () => {
            const { controller, applied } = harness();
            await post(controller, 'messenger', envelope('page', PAGE_ID, [{
                sender: { id: PSID }, recipient: { id: PAGE_ID },
                timestamp: 1758668856463, read: { watermark: 1758668856253 },
            }]));
            // Sin mid en el evento: el recibo salió de la resolución del corte,
            // y de ahí en adelante es el mismo camino por recibo de siempre.
            expect(statusWrites(applied)).toEqual(['read']);
        });

        it('atiende varios eventos del mismo webhook, mezclados con un mensaje', async () => {
            const { controller, applied, enqueued } = harness();
            await post(controller, 'messenger', envelope('page', PAGE_ID, [
                { sender: { id: PSID }, recipient: { id: PAGE_ID },
                    delivery: { mids: ['m_syn_c'], watermark: 1758668856253 } },
                { sender: { id: PSID }, recipient: { id: PAGE_ID },
                    message: { mid: 'm_syn_in', text: 'seguís ahí?' } },
            ]));
            // Meta batchea. Un lote que mezcla estado y mensaje tiene que
            // producir las dos cosas, no elegir una.
            expect(statusWrites(applied)).toEqual(['delivered']);
            expect(enqueued).toHaveLength(1);
            expect(enqueued[0].tenantId).toBe(TENANT_ID);
        });
    });

    describe('lo que no modelamos, ahora con nombre', () => {
        it.each([
            ['echo', { sender: { id: PAGE_ID }, recipient: { id: PSID },
                message: { mid: 'm_syn_echo', is_echo: true, text: 'lo nuestro' } }],
            ['reaction', { sender: { id: PSID }, reaction: { mid: 'm_syn_r', action: 'react', emoji: '❤' } }],
            ['postback', { sender: { id: PSID }, postback: { title: 'Empezar', payload: 'START' } }],
        ])('loguea %s en vez de descartarlo callado', async (kind, item) => {
            const { controller, applied, enqueued, logs, gateway } = harness();
            const response = await post(controller, 'messenger', envelope('page', PAGE_ID, [item]));
            expect(applied).toHaveLength(0);
            expect(enqueued).toHaveLength(0);
            // Ni siquiera llega al adaptador: se clasifica antes.
            expect(gateway.processIncomingWebhook).not.toHaveBeenCalled();
            expect(logs.debug.mock.calls.flat().join(' ')).toContain(kind);
            expect(response.status).toHaveBeenCalledWith(200);
        });
    });

    describe('lo que la ruta le debe a Meta', () => {
        it('rechaza una firma inválida antes de mirar el cuerpo', async () => {
            const { controller, prisma } = harness();
            const response = res();
            await controller.receiveMessenger(
                envelope('page', PAGE_ID, [{ sender: { id: PSID }, delivery: { mids: ['m_syn_x'] } }]),
                'sha256=00', { rawBody: Buffer.from('{}') } as any, response);
            expect(response.status).toHaveBeenCalledWith(401);
            expect(prisma.channelAccount.findFirst).not.toHaveBeenCalled();
        });

        it('contesta 200 aunque la conexión no resuelva a ningún esquema', async () => {
            const { controller, logs } = harness({ schema: null });
            const response = await post(controller, 'messenger', envelope('page', PAGE_ID, [{
                sender: { id: PSID }, recipient: { id: PAGE_ID },
                delivery: { mids: ['m_syn_sin_tenant'], watermark: 1758668856253 },
            }]));
            // Un estado que no se pudo escribir no justifica que Meta reenvíe el
            // cuerpo entero: los mensajes del mismo lote ya están en la cola.
            expect(response.status).toHaveBeenCalledWith(200);
            expect(logs.warn).not.toHaveBeenCalledWith(expect.stringContaining('no pudo leerse'));
        });
    });
});
