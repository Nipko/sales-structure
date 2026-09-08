import { ConversationsService } from './conversations.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const contactId = '33333333-3333-4333-8333-333333333333';
const inboundMessageId = '44444444-4444-4444-8444-444444444444';
const agentId = '55555555-5555-4555-8555-555555555555';
const schemaName = 'tenant_dispatch_producer';

const scope = { kind: 'agent' as const, tenantId, schemaName, agentId, version: 3,
    operationalHash: 'a'.repeat(64) };
const inboundMsg: any = { tenantId, conversationId, channelType: 'whatsapp',
    channelAccountId: 'phone-1', contactId: '+573000000000', direction: 'inbound',
    content: { type: 'text', text: 'Hola' } };

describe('ConversationsService durable reply producer', () => {
    function harness(options: { enabled?: boolean; prepareFails?: boolean; publishFails?: boolean;
        lookupFails?: boolean; existingBatch?: any[]; prepareError?: string } = {}) {
        const service: any = Object.create(ConversationsService.prototype);
        const rows = [
            { id: 'd-0', itemIndex: 0, messageId: 'm-0' },
            { id: 'd-1', itemIndex: 1, messageId: 'm-1' },
        ];
        const dispatchOutbox: any = {
            prepare: jest.fn(async (_tenantId: string, _input: any) => {
                if (options.prepareFails) throw new Error(options.prepareError || 'outbox unavailable');
                return { schemaName, batchId: 'b-1', rows };
            }),
            markQueued: jest.fn(async () => rows.length),
            findBatchForInbound: jest.fn(async () => {
                if (options.lookupFails) throw new Error('outbox unreadable');
                return options.existingBatch ?? null;
            }),
            publishBatch: jest.fn(async (tenantId: string, batch: any[], publish: any, gap: number) => {
                for (const row of batch) await publish(row.id, row.itemIndex * gap);
                return batch.length;
            }),
        };
        const dispatchRollout = { enabledFor: jest.fn(async () => options.enabled === true) };
        const outboundQueue = { enqueueDispatch: jest.fn(async () => {
            if (options.publishFails) throw new Error('redis unavailable');
        }) };
        Object.assign(service, {
            dispatchOutbox, dispatchRollout, outboundQueue,
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        return { service, dispatchOutbox, dispatchRollout, outboundQueue };
    }

    const run = (service: any, over: any = {}) => service.dispatchReplyThroughOutbox({
        tenantId, schemaName, conversation: { id: conversationId, contact_id: contactId },
        inboundMsg, inboundMessageId, chunks: ['Primero', 'Después'],
        operationalScope: scope, gapMs: 1200, ...over,
    });

    describe('a batch that already exists owns the reply', () => {
        const batch = [
            { id: 'd-0', itemIndex: 0, state: 'prepared', redacted: false },
            { id: 'd-1', itemIndex: 1, state: 'prepared', redacted: false },
        ];

        it('keeps the reply even when the switch has since been turned off', async () => {
            // Ownership is decided before the switch is consulted, and the switch
            // never revokes it: otherwise a replay would answer a second time.
            const h = harness({ enabled: false, existingBatch: batch });
            await expect(run(h.service)).resolves.toBe(true);
            expect(h.dispatchOutbox.prepare).not.toHaveBeenCalled();
            expect(h.dispatchRollout.enabledFor).not.toHaveBeenCalled();
            expect(h.dispatchOutbox.publishBatch).toHaveBeenCalledTimes(1);
        });

        it('finishes what the previous attempt started instead of starting again', async () => {
            const h = harness({ enabled: true, existingBatch: batch });
            await expect(run(h.service)).resolves.toBe(true);
            expect(h.outboundQueue.enqueueDispatch.mock.calls).toEqual([
                [tenantId, 'd-0', 0], [tenantId, 'd-1', 1200],
            ]);
        });

        it('recovers a batch whose prepare lost its acknowledgement, never falling back', async () => {
            // The classic lost COMMIT ACK: prepare threw, the rows are there.
            const h = harness({ enabled: true, prepareFails: true });
            h.dispatchOutbox.findBatchForInbound
                .mockResolvedValueOnce(null)      // before prepare: nothing yet
                .mockResolvedValueOnce(batch);    // after the ambiguous failure
            await expect(run(h.service)).resolves.toBe(true);
            expect(h.dispatchOutbox.publishBatch).toHaveBeenCalledTimes(1);
        });

        it('fails closed when ownership cannot be determined', async () => {
            // Reading "no batch" out of an unreadable answer is how a duplicate
            // happens. The turn fails and is retried instead.
            const h = harness({ enabled: true, lookupFails: true });
            await expect(run(h.service)).rejects.toThrow('outbox unreadable');
            expect(h.dispatchOutbox.prepare).not.toHaveBeenCalled();
        });

        it('fails closed when the post-failure lookup cannot answer either', async () => {
            const h = harness({ enabled: true, prepareFails: true });
            h.dispatchOutbox.findBatchForInbound
                .mockResolvedValueOnce(null)
                .mockRejectedValueOnce(new Error('outbox unreadable'));
            await expect(run(h.service)).rejects.toThrow('outbox unreadable');
        });

        it('releases the reply to the old path only on a demonstrated absence', async () => {
            const h = harness({ enabled: true, prepareFails: true });
            h.dispatchOutbox.findBatchForInbound.mockResolvedValue(null);
            await expect(run(h.service)).resolves.toBe(false);
            expect(h.dispatchOutbox.findBatchForInbound).toHaveBeenCalledTimes(2);
        });
    });

    it('takes the durable path only when the switch names this tenant and channel', async () => {
        const off = harness();
        await expect(run(off.service)).resolves.toBe(false);
        expect(off.dispatchOutbox.prepare).not.toHaveBeenCalled();
        expect(off.dispatchRollout.enabledFor).toHaveBeenCalledWith(tenantId, 'whatsapp');

        const on = harness({ enabled: true });
        await expect(run(on.service)).resolves.toBe(true);
        expect(on.dispatchOutbox.prepare).toHaveBeenCalledTimes(1);
    });

    it('records the bubbles as items bound to the persisted inbound', async () => {
        const h = harness({ enabled: true });
        await run(h.service);
        expect(h.dispatchOutbox.prepare).toHaveBeenCalledWith(tenantId, expect.objectContaining({
            binding: { conversationId, contactId, inboundMessageId, channelType: 'whatsapp',
                channelAccountId: 'phone-1', recipient: '+573000000000' },
            operationalScope: scope,
            // Messaging turns collect no learning provenance yet. Claiming an
            // empty footprint is honest; inventing one would make release-scoped
            // erasure look like it had applied to these words.
            learningFootprints: [],
        }));
        const items = (h.dispatchOutbox.prepare.mock.calls[0] as any[])[1].items;
        expect(items.map((item: any) => [item.kind, item.payload.text]))
            .toEqual([['text', 'Primero'], ['text', 'Después']]);
    });

    it('publishes each item on its own, staggered', async () => {
        const h = harness({ enabled: true });
        await run(h.service);
        expect(h.outboundQueue.enqueueDispatch.mock.calls).toEqual([
            [tenantId, 'd-0', 0], [tenantId, 'd-1', 1200],
        ]);
        // Marking after publication is the store's guarantee; see its own suite.
        expect(h.dispatchOutbox.publishBatch).toHaveBeenCalledTimes(1);
    });

    it('keeps the batch when publishing fails, leaving recovery to republish it', async () => {
        const h = harness({ enabled: true, publishFails: true });
        // Committed rows own the reply. Falling back now would send it twice.
        await expect(run(h.service)).resolves.toBe(true);
        expect(h.dispatchOutbox.prepare).toHaveBeenCalledTimes(1);
    });

    it('leaves the reply to the existing path when nothing was committed', async () => {
        const h = harness({ enabled: true, prepareFails: true });
        await expect(run(h.service)).resolves.toBe(false);
        expect(h.outboundQueue.enqueueDispatch).not.toHaveBeenCalled();
    });

    it('declines without a persisted inbound, a contact or an operational scope', async () => {
        const h = harness({ enabled: true });
        for (const over of [
            { inboundMessageId: undefined },
            { inboundMessageId: 'provider-message-1' },
            { conversation: { id: conversationId, contact_id: null } },
            { operationalScope: undefined },
            { chunks: [] },
        ]) {
            await expect(run(h.service, over)).resolves.toBe(false);
        }
        expect(h.dispatchOutbox.prepare).not.toHaveBeenCalled();
    });

    it('declines when the outbox or the switch is not wired at all', async () => {
        const h = harness({ enabled: true });
        (h.service as any).dispatchOutbox = undefined;
        await expect(run(h.service)).resolves.toBe(false);
        (h.service as any).dispatchOutbox = h.dispatchOutbox;
        (h.service as any).dispatchRollout = undefined;
        await expect(run(h.service)).resolves.toBe(false);
    });

    it('declines rather than throwing when the switch itself cannot be read', async () => {
        const h = harness({ enabled: true });
        h.dispatchRollout.enabledFor.mockRejectedValue(new Error('settings unavailable'));
        await expect(run(h.service)).resolves.toBe(false);
    });

    /**
     * El enlace y las fotos son efectos del MISMO turno que las burbujas. Salían
     * desde dentro de `generateResponse` mientras las burbujas las despachaba el
     * llamador, así que un lote durable sólo podía adueñarse de las palabras: el
     * enlace quedaba fuera del lote que es dueño de la respuesta, donde nada
     * puede recuperarlo ni deduplicarlo. Ahora el turno entero viaja junto.
     */
    describe('el turno entero viaja en un solo lote', () => {
        const media = [{ url: 'https://example.test/a.jpg', caption: 'Mira este' }];
        const paymentLinks = ['https://checkout.test/abc'];

        it('lleva enlace y medios al mismo lote, con el enlace antes de la foto', async () => {
            const h = harness({ enabled: true });
            await expect(run(h.service, { paymentLinks, media })).resolves.toBe(true);
            const items = h.dispatchOutbox.prepare.mock.calls[0][1].items;
            expect(items.map((item: any) => item.kind))
                .toEqual(['text', 'text', 'payment_link', 'media', 'text']);
            expect(items[2].payload.text).toBe('https://checkout.test/abc');
            expect(items[3].payload.mediaUrl).toBe('https://example.test/a.jpg');
            // El caption es su propio efecto: si falla, la foto no se reenvía.
            expect(items[4].payload.text).toBe('Mira este');
        });

        it('deduplica el enlace, porque dos herramientas pueden devolver el mismo', async () => {
            const h = harness({ enabled: true });
            await run(h.service, { paymentLinks: [...paymentLinks, ...paymentLinks] });
            const items = h.dispatchOutbox.prepare.mock.calls[0][1].items;
            expect(items.filter((item: any) => item.kind === 'payment_link')).toHaveLength(1);
        });

        it('sigue siendo el mismo lote de texto cuando el turno no produjo efectos', async () => {
            const h = harness({ enabled: true });
            await expect(run(h.service, { paymentLinks: [], media: [] })).resolves.toBe(true);
            expect(h.dispatchOutbox.prepare.mock.calls[0][1].items.map((item: any) => item.kind))
                .toEqual(['text', 'text']);
        });

        it('registra la procedencia de aprendizaje del turno, no una lista vacía', async () => {
            // La admisión valida las fuentes del payload ANTES de autorizar la
            // llamada al proveedor. Validar una lista vacía no prueba nada: con
            // la huella real, un release retirado entre la respuesta y su
            // entrega detiene la entrega, y el borrado por release alcanza estas
            // filas. La lista vacía sigue siendo el valor honesto de un turno
            // que no usó ningún ejemplo; ya no es un marcador de posición.
            const footprints = [{ version: 1, tenantId, agentId,
                entries: [{ releaseId: '66666666-6666-4666-8666-666666666666',
                    releaseHash: 'd'.repeat(64), exampleId: '77777777-7777-4777-8777-777777777777',
                    projectionHash: 'e'.repeat(64) }] }];
            const h = harness({ enabled: true });
            await run(h.service, { learningFootprints: footprints });
            expect(h.dispatchOutbox.prepare.mock.calls[0][1].learningFootprints).toEqual(footprints);

            const empty = harness({ enabled: true });
            await run(empty.service, {});
            expect(empty.dispatchOutbox.prepare.mock.calls[0][1].learningFootprints).toEqual([]);
        });

        it('no se queda con la respuesta si no puede expresar un efecto', async () => {
            // Un medio sin URL no es despachable. Rechazar el lote entero deja la
            // respuesta al camino viejo, que sí puede entregar el texto; aceptar
            // el resto entregaría una respuesta a la que le falta una parte sin
            // que nadie se entere.
            const h = harness({ enabled: true });
            await expect(run(h.service, { media: [{ url: '   ' }] })).resolves.toBe(false);
            expect(h.dispatchOutbox.prepare).not.toHaveBeenCalled();
        });
    });
});
