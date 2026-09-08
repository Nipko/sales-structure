import { MessengerAdapter } from './messenger/messenger.adapter';
import { buildDispatchItems, DispatchItemError } from './dispatch-items';

describe('building the effects a turn actually means', () => {
    const kinds = (output: any) => buildDispatchItems(output).map(item => item.kind);

    it('keeps reply bubbles in the order the customer should read them', () => {
        const items = buildDispatchItems({ textChunks: ['Primero', 'Después'] });
        expect(items.map(item => item.payload.text)).toEqual(['Primero', 'Después']);
        expect(kinds({ textChunks: ['a', 'b'] })).toEqual(['text', 'text']);
    });

    it('makes a caption its own effect, right after its attachment', () => {
        const items = buildDispatchItems({
            media: [{ url: 'https://example.test/a.jpg', caption: 'La foto del producto' }],
        });
        // Two receipts, so a caption that fails never resends the picture.
        expect(items.map(item => item.kind)).toEqual(['media', 'text']);
        expect(items[0].payload).toEqual({ mediaUrl: 'https://example.test/a.jpg' });
        expect(items[1].payload).toEqual({ text: 'La foto del producto' });
    });

    it('emits only the attachment when there is no caption', () => {
        expect(kinds({ media: [{ url: 'https://example.test/a.jpg' }] })).toEqual(['media']);
        expect(kinds({ media: [{ url: 'https://example.test/a.jpg', caption: '   ' }] })).toEqual(['media']);
    });

    it('keeps a canonical payment link out of the words the model wrote', () => {
        const items = buildDispatchItems({ textChunks: ['Te paso el enlace'],
            paymentLinks: ['https://checkout.test/abc'] });
        expect(items.map(item => item.kind)).toEqual(['text', 'payment_link']);
        expect(items[1].payload.text).toBe('https://checkout.test/abc');
    });

    it('lets a Flow replace the turn text and never pairs it with a fallback', () => {
        const items = buildDispatchItems({
            textChunks: ['Este texto no debe salir además del Flow'],
            flow: { flowId: 'f-1', flowToken: 't-1', text: 'Agenda tu cita', flowCta: 'Agendar' },
        });
        expect(items.map(item => item.kind)).toEqual(['flow']);
        expect(items[0].payload).toMatchObject({ flowId: 'f-1', flowToken: 't-1', flowCta: 'Agendar' });
    });

    it('still sends media and a payment link alongside a Flow', () => {
        // El enlace va antes que la foto: es lo que el cliente está esperando, y
        // es el orden en que el productor actual ya los manda, así que encender
        // el interruptor no reordena la respuesta de nadie.
        expect(kinds({ flow: { flowId: 'f-1', flowToken: 't-1', text: 'Agenda' },
            media: [{ url: 'https://example.test/a.jpg', caption: 'Mira' }],
            paymentLinks: ['https://checkout.test/abc'] }))
            .toEqual(['flow', 'payment_link', 'media', 'text']);
    });

    it('refuses to build anything malformed rather than let one effect through', () => {
        const cases: [any, string][] = [
            [{}, 'dispatch_item_nothing_to_send'],
            [{ textChunks: ['  '] }, 'dispatch_item_empty_text'],
            [{ media: [{ url: '' }] }, 'dispatch_item_empty_media'],
            [{ flow: { flowId: 'f-1', flowToken: '', text: 'x' } }, 'dispatch_item_incomplete_flow'],
            [{ textChunks: ['x'.repeat(32001)] }, 'dispatch_item_text_too_long'],
            [{ textChunks: Array.from({ length: 33 }, (_, i) => `c${i}`) }, 'dispatch_item_too_many'],
        ];
        for (const [output, code] of cases) {
            expect(() => buildDispatchItems(output)).toThrow(DispatchItemError);
            expect(() => buildDispatchItems(output)).toThrow(code);
        }
    });
});

describe('Messenger strict dispatch', () => {
    const adapter = new MessengerAdapter({ get: () => undefined } as any);
    let sent: any[];
    const answer = (status: number, body: any) => {
        (global as any).fetch = jest.fn(async (_url: string, init: any) => {
            sent.push(JSON.parse(init.body));
            return { status, json: async () => body } as any;
        });
    };
    beforeEach(() => { sent = []; });
    afterEach(() => { delete (global as any).fetch; });

    it('performs exactly one POST for an attachment, with no caption riding along', async () => {
        answer(200, { message_id: 'mid.IMG' });
        await expect(adapter.sendStrict({ itemKind: 'media', to: 'psid-1', channelAccountId: 'page-1',
            payload: { mediaUrl: 'https://example.test/a.jpg', caption: 'ignored here' } }, 'token'))
            .resolves.toEqual({ kind: 'accepted', receipt: 'mid.IMG' });
        // sendMediaMessage does two POSTs behind one call and returns the last
        // id; that is what made a failed caption resend the picture.
        expect(sent).toHaveLength(1);
        expect(sent[0].message).toEqual({ attachment: { type: 'image',
            payload: { url: 'https://example.test/a.jpg', is_reusable: true } } });
        expect(JSON.stringify(sent[0])).not.toContain('ignored here');
    });

    it('sends a caption as an ordinary text effect with its own receipt', async () => {
        answer(200, { message_id: 'mid.CAP' });
        await expect(adapter.sendStrict({ itemKind: 'text', to: 'psid-1', channelAccountId: 'page-1',
            payload: { text: 'La foto del producto' } }, 'token'))
            .resolves.toEqual({ kind: 'accepted', receipt: 'mid.CAP' });
        expect(sent[0].message).toEqual({ text: 'La foto del producto' });
    });

    it('refuses a Flow instead of pretending it sent one', async () => {
        answer(200, { message_id: 'never' });
        await expect(adapter.sendStrict({ itemKind: 'flow', to: 'psid-1', channelAccountId: 'page-1',
            payload: { flowId: 'f-1', flowToken: 't-1' } }, 'token'))
            .resolves.toEqual({ kind: 'rejected', errorCode: 'unsupported_item_kind:flow', retryable: false });
        expect(sent).toHaveLength(0);
    });

    it('classifies a documented rate limit and a lost connection differently', async () => {
        answer(400, { error: { code: 613, message: 'Calls to this api have exceeded the rate limit' } });
        await expect(adapter.sendStrict({ itemKind: 'text', to: 'psid-1', channelAccountId: 'page-1',
            payload: { text: 'Hola' } }, 'token'))
            .resolves.toEqual({ kind: 'rejected', errorCode: 'meta_613', retryable: true });

        (global as any).fetch = jest.fn(async () => {
            throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
        });
        await expect(adapter.sendStrict({ itemKind: 'text', to: 'psid-1', channelAccountId: 'page-1',
            payload: { text: 'Hola' } }, 'token'))
            .resolves.toEqual({ kind: 'unknown', errorCode: 'provider_timeout' });
    });
});
