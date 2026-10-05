import { widgetPublicMessage } from './widget-message-protocol';

const stored = (over: Record<string, any> = {}): any => ({
    id: 'm1', conversation_id: 'c1', direction: 'outbound', content_type: 'text',
    content_text: 'Envío gratis [Article: Envíos] hoy', media_url: null, caption: null,
    status: 'pending', metadata: { source: 'ai' }, created_at: '2026-10-05T00:00:00Z', ...over,
});

describe('widget history and replay never expose the internal citation marker', () => {
    it('cleans an assistant message stored before the strip existed', () => {
        const message = widgetPublicMessage(stored());
        expect(message.content_text).toBe('Envío gratis hoy');
        expect(message.content).toBe('Envío gratis hoy');
    });

    it('cleans a caption', () => {
        const message = widgetPublicMessage(stored({ content_text: null, caption: 'Foto [Article: Catálogo]' }));
        expect(message.caption).toBe('Foto');
        expect(message.content).toBe('Foto');
    });

    it('leaves a human agent message and the visitor message as written', () => {
        expect(widgetPublicMessage(stored({ metadata: { source: 'agent' } })).content_text).toContain('[Article: Envíos]');
        expect(widgetPublicMessage(stored({ direction: 'inbound' })).content_text).toContain('[Article: Envíos]');
    });
});
