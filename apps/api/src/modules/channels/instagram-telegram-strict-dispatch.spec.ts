import { InstagramAdapter } from './instagram/instagram.adapter';
import { TelegramAdapter } from './telegram/telegram.adapter';
import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';
import { MessengerAdapter } from './messenger/messenger.adapter';
import { ChannelGatewayService } from './channel-gateway.service';
import { telegramAnswer, telegramClassifier } from './provider-error-classification';
import type { StrictDispatchRequest } from './strict-dispatch-transport';

/**
 * ═══ LOS DOS CANALES QUE FALTABAN ═══
 *
 * Instagram y Telegram se rechazaban explícitamente (`transport_not_migrated`)
 * si una fila del outbox llegaba a ellos. Eso era correcto —mejor un rechazo
 * visible que degradar al gateway suelto, que convierte cualquier excepción en
 * `null`— pero dejaba dos canales sin la única ruta que puede decir qué pasó.
 *
 * Instagram habla el mismo sobre de la Graph API que Messenger, así que
 * comparte clasificador y sólo cambia la ruta. Telegram **no**: contesta con
 * `ok`, así que trae el suyo, y la diferencia importa donde más duele — un 5xx.
 *
 * Las respuestas de proveedor de abajo son sintéticas, con la forma de las
 * reales y los identificadores reemplazados. Ningún proveedor fue llamado.
 */

const igOk = { recipient_id: '17841400000000000', message_id: 'aWdfZG1fMTp...' };
const graphErr = (code: number, extra: Record<string, any> = {}) => ({
    error: { message: 'synthetic', type: 'OAuthException', code, fbtrace_id: 'Axxxxxxxxxxx', ...extra },
});
const tgOk = (id = 4242) => ({ ok: true, result: { message_id: id, chat: { id: 99 } } });
const tgErr = (code: number, description = 'synthetic') => ({ ok: false, error_code: code, description });

function transport() {
    let sent: { url: string; body: any }[] = [];
    const answer = (status: number, body: any) => {
        (global as any).fetch = jest.fn(async (url: string, init: any) => {
            sent.push({ url, body: JSON.parse(init.body) });
            return { status, json: async () => body } as any;
        });
    };
    const throws = (error: unknown) => {
        (global as any).fetch = jest.fn(async () => { throw error; });
    };
    return { get sent() { return sent; }, reset: () => { sent = []; }, answer, throws };
}

describe('lo que prueba una respuesta de Telegram', () => {
    const answer = (status: number, body: any) => telegramAnswer(status, body);

    it('acepta sólo cuando hay un identificador de mensaje, y lo normaliza a texto', () => {
        // Telegram devuelve el id como número; el recibo del outbox es una
        // cadena y se compara como tal en los webhooks y la reconciliación.
        expect(telegramClassifier(answer(200, tgOk(4242))))
            .toEqual({ kind: 'accepted', receipt: '4242' });
    });

    it('deja en desconocido un ok sin identificador, nunca lo llama recibo', () => {
        expect(telegramClassifier(answer(200, { ok: true, result: {} })))
            .toEqual({ kind: 'unknown', errorCode: 'receipt_missing' });
    });

    it('reintenta el límite de tasa, que es el único que documenta que no envió', () => {
        expect(telegramClassifier(answer(429, tgErr(429, 'Too Many Requests: retry after 30'))))
            .toEqual({ kind: 'rejected', errorCode: 'telegram_429', retryable: true });
    });

    it('rechaza definitivamente la familia de error del cliente', () => {
        for (const code of [400, 401, 403, 404, 409]) {
            expect(telegramClassifier(answer(code, tgErr(code))))
                .toEqual({ kind: 'rejected', errorCode: `telegram_${code}`, retryable: false });
        }
    });

    it('no lee un 5xx como prueba de que no envió', () => {
        // Telegram no promete que una respuesta fallida signifique que el update
        // no se procesó. Llamarlo rechazo invitaría al duplicado exacto que el
        // outbox existe para evitar.
        expect(telegramClassifier(answer(500, tgErr(500, 'Internal Server Error'))))
            .toEqual({ kind: 'unknown', errorCode: 'telegram_500' });
        expect(telegramClassifier(answer(502, tgErr(502, 'Bad Gateway'))))
            .toEqual({ kind: 'unknown', errorCode: 'telegram_502' });
    });

    it('trata un cuerpo ilegible como desconocido', () => {
        expect(telegramClassifier(answer(502, null)))
            .toEqual({ kind: 'unknown', errorCode: 'unreadable_body_http_502' });
    });

    it('usa el status cuando el sobre de error viene sin código propio', () => {
        expect(telegramClassifier(answer(403, { ok: false, description: 'Forbidden' })))
            .toEqual({ kind: 'rejected', errorCode: 'telegram_403', retryable: false });
    });
});

describe('Instagram strict dispatch', () => {
    const adapter = new InstagramAdapter({ get: () => undefined } as any);
    const net = transport();
    const request = (over: Partial<StrictDispatchRequest> = {}): StrictDispatchRequest => ({
        itemKind: 'text', to: '17841400000000001', channelAccountId: 'ig-user-1',
        payload: { text: 'Hola' }, ...over,
    });
    beforeEach(() => net.reset());
    afterEach(() => { delete (global as any).fetch; });

    it('envía por la cuenta que dice la fila, no por un remitente fijo', async () => {
        // El remitente de un DM es el id de usuario de Instagram. Va en la
        // ruta, y viene del binding de la fila: dos cuentas del mismo tenant no
        // pueden salir por la misma.
        net.answer(200, igOk);
        await expect(adapter.sendStrict(request(), 'token'))
            .resolves.toEqual({ kind: 'accepted', receipt: 'aWdfZG1fMTp...' });
        expect(net.sent[0].url).toContain('/ig-user-1/messages');
        expect(net.sent[0].body).toMatchObject({ recipient: { id: '17841400000000001' }, message: { text: 'Hola' } });
    });

    it('rechaza sin gastar intento si la fila no trae cuenta', async () => {
        net.answer(200, igOk);
        await expect(adapter.sendStrict(request({ channelAccountId: '' }), 'token'))
            .resolves.toEqual({ kind: 'rejected', errorCode: 'instagram_account_missing', retryable: false });
        expect(net.sent).toHaveLength(0);
    });

    it('nunca monta el caption sobre la imagen: son dos efectos', async () => {
        net.answer(200, igOk);
        await adapter.sendStrict(request({ itemKind: 'media',
            payload: { mediaUrl: 'https://example.test/a.jpg', caption: 'Una foto' } }), 'token');
        expect(net.sent[0].body.message.attachment)
            .toEqual({ type: 'image', payload: { url: 'https://example.test/a.jpg', is_reusable: true } });
        expect(JSON.stringify(net.sent[0].body)).not.toContain('Una foto');
    });

    it('rechaza un documento en vez de degradarlo a foto', async () => {
        // Un DM no tiene forma de documento. Mandarlo como imagen entregaría
        // algo que el cliente no puede abrir y contaría como entregado.
        net.answer(200, igOk);
        await expect(adapter.sendStrict(request({ itemKind: 'media',
            payload: { mediaUrl: 'https://example.test/a.pdf', mediaType: 'document' } }), 'token'))
            .resolves.toEqual({ kind: 'rejected', errorCode: 'unsupported_media_type:document', retryable: false });
        expect(net.sent).toHaveLength(0);
    });

    it('rechaza un Flow explícitamente en vez de mandar texto', async () => {
        net.answer(200, igOk);
        await expect(adapter.sendStrict(request({ itemKind: 'flow',
            payload: { flowId: 'f-1', text: 'Agenda tu cita' } }), 'token'))
            .resolves.toEqual({ kind: 'rejected', errorCode: 'unsupported_item_kind:flow', retryable: false });
        expect(net.sent).toHaveLength(0);
    });

    it('clasifica el error de Meta con su propio código y no reintenta adentro', async () => {
        net.answer(400, graphErr(190));
        await expect(adapter.sendStrict(request(), 'token'))
            .resolves.toEqual({ kind: 'rejected', errorCode: 'meta_190', retryable: false });
        expect(net.sent).toHaveLength(1);
    });

    it('deja desconocido lo que no contestó', async () => {
        net.throws(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
        await expect(adapter.sendStrict(request(), 'token'))
            .resolves.toEqual({ kind: 'unknown', errorCode: 'provider_timeout' });
    });
});

describe('Telegram strict dispatch', () => {
    const adapter = new TelegramAdapter({ get: () => undefined } as any);
    const net = transport();
    const request = (over: Partial<StrictDispatchRequest> = {}): StrictDispatchRequest => ({
        itemKind: 'text', to: '99', channelAccountId: 'bot-1',
        payload: { text: 'Hola' }, ...over,
    });
    beforeEach(() => net.reset());
    afterEach(() => { delete (global as any).fetch; });

    it('envía un texto y devuelve el identificador como recibo', async () => {
        net.answer(200, tgOk(4242));
        await expect(adapter.sendStrict(request(), 'bot-token'))
            .resolves.toEqual({ kind: 'accepted', receipt: '4242' });
        expect(net.sent[0].url).toContain('/botbot-token/sendMessage');
        expect(net.sent[0].body).toMatchObject({ chat_id: '99', parse_mode: 'HTML' });
    });

    it('escapa el texto, porque un solo < era un 400 y la respuesta se perdía', async () => {
        net.answer(200, tgOk());
        await adapter.sendStrict(request({ payload: { text: 'Precio < 100 & envío' } }), 'bot-token');
        expect(net.sent[0].body.text).not.toContain('< 100');
        expect(net.sent[0].body.text).toContain('&lt;');
    });

    it('elige el método por el tipo de archivo y no manda caption con la foto', async () => {
        for (const [url, method, field] of [
            ['https://example.test/a.jpg', 'sendPhoto', 'photo'],
            ['https://example.test/a.mp4', 'sendVideo', 'video'],
            ['https://example.test/a.pdf', 'sendDocument', 'document'],
        ] as const) {
            net.reset();
            net.answer(200, tgOk());
            await adapter.sendStrict(request({ itemKind: 'media',
                payload: { mediaUrl: url, caption: 'Una foto' } }), 'bot-token');
            expect(net.sent[0].url).toContain(`/${method}`);
            expect(net.sent[0].body[field]).toBe(url);
            // Ni el caption ni un caption vacío: el caption es la fila siguiente.
            expect(JSON.stringify(net.sent[0].body)).not.toContain('caption');
        }
    });

    it('rechaza un Flow y un payload que no puede expresar, sin gastar intento', async () => {
        net.answer(200, tgOk());
        for (const broken of [
            request({ payload: { text: '   ' } }),
            request({ itemKind: 'media', payload: {} }),
            request({ itemKind: 'flow', payload: { flowId: 'f-1', text: 'Agenda' } }),
        ]) {
            await expect(adapter.sendStrict(broken, 'bot-token'))
                .resolves.toMatchObject({ kind: 'rejected', retryable: false });
        }
        expect(net.sent).toHaveLength(0);
    });

    it('rechaza sin token en vez de pedir a una ruta con `botundefined`', async () => {
        net.answer(200, tgOk());
        await expect(adapter.sendStrict(request(), ''))
            .resolves.toEqual({ kind: 'rejected', errorCode: 'telegram_token_missing', retryable: false });
        expect(net.sent).toHaveLength(0);
    });

    it('no reintenta adentro y conserva el código del proveedor', async () => {
        net.answer(403, tgErr(403, 'Forbidden: bot was blocked by the user'));
        await expect(adapter.sendStrict(request(), 'bot-token'))
            .resolves.toEqual({ kind: 'rejected', errorCode: 'telegram_403', retryable: false });
        expect(net.sent).toHaveLength(1);
    });

    it('deja desconocido lo que no contestó', async () => {
        net.throws(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
        await expect(adapter.sendStrict(request(), 'bot-token'))
            .resolves.toEqual({ kind: 'unknown', errorCode: 'provider_timeout' });
    });
});

describe('el gateway reconoce los cuatro canales migrados', () => {
    it('devuelve transporte estricto para WhatsApp, Messenger, Instagram y Telegram', () => {
        // El interruptor de despliegue deriva de acá lo que considera migrado,
        // así que esta es la única prueba que ata las dos cosas: implementar
        // `sendStrict` es lo que hace que un canal pueda encenderse, y un canal
        // sin transporte tiene que seguir siendo invisible para el interruptor.
        const config = { get: () => undefined } as any;
        const gateway = new ChannelGatewayService();
        for (const adapter of [
            new WhatsAppAdapter(config), new MessengerAdapter(config),
            new InstagramAdapter(config), new TelegramAdapter(config),
            { channelType: 'email', handleWebhook: async () => null } as any,
        ]) gateway.registerAdapter(adapter as any);

        for (const channel of ['whatsapp', 'messenger', 'instagram', 'telegram'] as const) {
            expect(gateway.getStrictTransport(channel)).toBeDefined();
        }
        expect(gateway.getStrictTransport('email' as any)).toBeUndefined();
    });
});
