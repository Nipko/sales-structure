import { InboundQueueService } from './inbound-queue.service';

/**
 * La frontera de la cola es el único punto por el que pasan los 7 productores
 * de mensajes entrantes. Estos tests fijan las dos mitades del contrato que el
 * incidente del 2-sep dejó a la vista:
 *
 *  - lo estructuralmente inválido se DESCARTA acá (antes reventaba dentro del
 *    worker, en el INSERT de `contacts`, con el proveedor ya ACKeado);
 *  - los salientes de SOLO-GUARDADO de coexistencia SIGUEN PASANDO (una guarda
 *    de "mensaje inválido" escrita mirando solo el turno de IA es exactamente
 *    lo que dejó muda a la coexistencia en la otra frontera).
 */
describe('InboundQueueService.enqueue', () => {
    const makeService = () => {
        const queue = { add: jest.fn().mockResolvedValue(undefined) };
        const throttle = { getPriority: jest.fn().mockResolvedValue(5) };
        return {
            service: new InboundQueueService(queue as any, throttle as any),
            queue,
        };
    };

    const validMessage = (over: Record<string, any> = {}) => ({
        id: 'msg-1',
        tenantId: 'tenant-1',
        contactId: '573001112233',
        channelType: 'whatsapp',
        channelAccountId: 'phone-number-id-1',
        conversationId: '',
        direction: 'inbound',
        content: { type: 'text', text: 'hola' },
        metadata: { waMessageId: 'wamid.ABC' },
        ...over,
    });

    it('encola un mensaje entrante válido', async () => {
        const { service, queue } = makeService();

        await service.enqueue(validMessage() as any);

        expect(queue.add).toHaveBeenCalledTimes(1);
    });

    // El caso del incidente: Meta entregó el mensaje sin `from`, con el perfil
    // ("John Cardona") sí poblado.
    it('descarta un mensaje sin remitente en vez de encolarlo', async () => {
        const { service, queue } = makeService();

        await expect(
            service.enqueue(validMessage({ contactId: undefined }) as any),
        ).resolves.toBeUndefined();

        expect(queue.add).not.toHaveBeenCalled();
    });

    // Coercionar a '' "salvaría" el mensaje y sería PEOR: el índice único
    // (channel_type, external_id) fusionaría a todos los remitentes
    // desconocidos en un solo contacto.
    it.each([
        ['cadena vacía', ''],
        ['solo espacios', '   '],
        ['no-string', 12345],
        ['nulo', null],
    ])('descarta un contactId %s', async (_label, contactId) => {
        const { service, queue } = makeService();

        await service.enqueue(validMessage({ contactId }) as any);

        expect(queue.add).not.toHaveBeenCalled();
    });

    it.each(['tenantId', 'channelType', 'channelAccountId'])(
        'descarta un mensaje sin %s',
        async (field) => {
            const { service, queue } = makeService();

            await service.enqueue(validMessage({ [field]: '' }) as any);

            expect(queue.add).not.toHaveBeenCalled();
        },
    );

    it('no lanza ante un mensaje inválido: un throw haría que el proveedor redelivere el mismo cuerpo roto en bucle', async () => {
        const { service } = makeService();

        await expect(service.enqueue({} as any)).resolves.toBeUndefined();
    });

    // Guarda de regresión de la coexistencia: estos NO son turnos de IA, son
    // salientes que solo se guardan en el timeline. Deben seguir entrando.
    it.each(['waba_echo', 'historical'])(
        'sigue encolando el saliente de solo-guardado %s',
        async (source) => {
            const { service, queue } = makeService();

            await service.enqueue(validMessage({
                direction: 'outbound',
                metadata: { waMessageId: 'wamid.ECHO', source },
            }) as any);

            expect(queue.add).toHaveBeenCalledTimes(1);
        },
    );

    it('un conversationId vacío es legítimo — todos los productores lo mandan así', async () => {
        const { service, queue } = makeService();

        await service.enqueue(validMessage({ conversationId: '' }) as any);

        expect(queue.add).toHaveBeenCalledTimes(1);
    });
});

/**
 * The handoff return replay re-processes a stored message the queue already
 * completed. Its job needs its own id (BullMQ would otherwise drop it as the
 * first one), and still a deterministic one (so a repeat of the replay is
 * dropped).
 */
describe('InboundQueueService.enqueue jobIdSuffix', () => {
    const msg: any = {
        id: 'm', tenantId: 'tenant-1', contactId: '1', channelType: 'telegram', channelAccountId: 'bot',
        conversationId: '', direction: 'inbound', content: { type: 'text', text: 'hola' }, metadata: { updateId: 7 },
    };
    const make = () => {
        const queue = { add: jest.fn().mockResolvedValue(undefined) };
        return { queue, service: new InboundQueueService(queue as any, { getPriority: jest.fn().mockResolvedValue(5) } as any) };
    };

    it('the normal job id is unchanged', async () => {
        const { queue, service } = make();
        await service.enqueue(msg);
        expect(queue.add.mock.calls[0][2].jobId).toBe('in-tenant-1-telegram-bot-tgu7');
    });

    it('a replay gets a distinct, deterministic, BullMQ-safe id', async () => {
        const { queue, service } = make();
        await service.enqueue(msg, { jobIdSuffix: 'handoff-return-1759696380000' });
        await service.enqueue(msg, { jobIdSuffix: 'handoff-return-1759696380000' });
        const [a, b] = queue.add.mock.calls.map(c => c[2].jobId);
        expect(a).toBe('in-tenant-1-telegram-bot-tgu7-handoff-return-1759696380000');
        expect(b).toBe(a);
        expect(a).not.toContain(':');
    });
});
