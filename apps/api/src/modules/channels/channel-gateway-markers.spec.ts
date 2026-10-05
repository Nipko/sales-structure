import { ChannelGatewayService } from './channel-gateway.service';

/** Every legacy lane, the widget and email reach their provider through this one method. */
function gatewayWith(channelType: string, extra: Record<string, any> = {}) {
    const sent: any[] = [];
    const adapter = {
        channelType,
        sendTextMessage: jest.fn(async (_to: string, text: string) => { sent.push({ text }); return 'id-text'; }),
        sendMediaMessage: jest.fn(async (_to: string, _url: string, caption: any) => { sent.push({ caption }); return 'id-media'; }),
        handleWebhook: jest.fn(),
        ...extra,
    };
    const gateway = new ChannelGatewayService();
    gateway.registerAdapter(adapter as any);
    return { gateway, sent, adapter };
}
const hooks = { admitFallback: async () => false };
const base = { tenantId: 't', channelAccountId: 'a', to: '123', metadata: { aiGenerated: true } } as any;

describe('the gateway never hands an internal citation marker to a channel', () => {
    it.each(['whatsapp', 'telegram', 'instagram', 'messenger', 'email', 'sms'])('%s text', async channelType => {
        const { gateway, sent } = gatewayWith(channelType);
        await gateway.sendMessage({ ...base, channelType, content: { type: 'text', text: 'Hola [Article: Envíos] mundo' } }, 'tok', hooks);
        expect(sent[0].text).toBe('Hola mundo');
    });

    it('media caption', async () => {
        const { gateway, sent } = gatewayWith('whatsapp');
        await gateway.sendMessage({ ...base, channelType: 'whatsapp',
            content: { type: 'image', mediaUrl: 'https://example.test/a.jpg', caption: 'Foto [Article: Catálogo]' } }, 'tok', hooks);
        expect(sent[0].caption).toBe('Foto');
    });

    it('adapters that take the whole envelope (widget) get the clean text too', async () => {
        const seen: any[] = [];
        const { gateway } = gatewayWith('webchat', { sendOutbound: jest.fn(async (o: any) => { seen.push(o); return 'x'; }) });
        await gateway.sendMessage({ ...base, channelType: 'webchat', content: { type: 'text', text: 'Hola [Article: X]' } }, 'tok', hooks);
        expect(seen[0].content.text).toBe('Hola');
    });

    it('leaves a human agent or broadcast message exactly as written', async () => {
        const { gateway, sent } = gatewayWith('whatsapp');
        await gateway.sendMessage({ ...base, metadata: {}, channelType: 'whatsapp',
            content: { type: 'text', text: 'Ref [Article: 4512] disponible' } }, 'tok', hooks);
        expect(sent[0].text).toBe('Ref [Article: 4512] disponible');
    });

    it('sends nothing, not an empty text, when the AI message was only the marker', async () => {
        const { gateway, sent, adapter } = gatewayWith('whatsapp');
        const result = await gateway.sendMessage({ ...base, channelType: 'whatsapp',
            content: { type: 'text', text: '[Article: Envios]' } }, 'tok', hooks);
        expect(result).toBeNull();
        expect(adapter.sendTextMessage).not.toHaveBeenCalled();
        expect(sent).toHaveLength(0);
    });

    it('does not hand an empty envelope to an adapter that takes the whole message (widget)', async () => {
        const sendOutbound = jest.fn(async () => 'x');
        const { gateway } = gatewayWith('webchat', { sendOutbound });
        const result = await gateway.sendMessage({ ...base, channelType: 'webchat',
            content: { type: 'text', text: '[Article: Envios]' } }, 'tok', hooks);
        expect(result).toBeNull();
        expect(sendOutbound).not.toHaveBeenCalled();
    });

    it('does not mutate the callers envelope', async () => {
        const { gateway } = gatewayWith('whatsapp');
        const outbound = { ...base, channelType: 'whatsapp', content: { type: 'text', text: 'Hola [Article: X]' } };
        await gateway.sendMessage(outbound, 'tok', hooks);
        expect(outbound.content.text).toBe('Hola [Article: X]');
    });
});
