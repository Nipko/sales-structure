import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';
import { TelegramAdapter } from './telegram/telegram.adapter';
import { InstagramAdapter } from './instagram/instagram.adapter';
import { MessengerAdapter } from './messenger/messenger.adapter';
import { DISPATCH_ITEM_KINDS, interactiveOptionLabels } from './agent-dispatch-outbox';
import type { StrictDispatchRequest } from './strict-dispatch-transport';

/**
 * ═══ LAS DOS FORMAS QUE EL CARRIL DURABLE NO SABÍA DECIR ═══
 *
 * `item_kind` admitía texto, media, enlace de pago, Flow y plantilla. Faltaban
 * las dos que el carril REST manda todos los días:
 *
 *   · `interactive` — los botones de respuesta rápida y las listas con las que
 *     el agente pregunta "¿qué servicio?". Es otra llamada de la Graph API
 *     (`type: interactive`), no un texto con las opciones escritas adentro:
 *     aplanarlo pierde el TOQUE, y el toque es lo que hace que la respuesta no
 *     sea ambigua;
 *   · `location` — la dirección del local como PIN, que el cliente abre en su
 *     app de mapas. Como texto hay que copiarlo y pegarlo, y la mitad no lo
 *     hace.
 *
 * Mientras no existieran, esos dos no tenían fila que escribir: salían sin
 * lease y sin recibo, así que un reinicio entre decidir y hacer el POST los
 * perdía o los repetía — y desde octubre cada repetición es un cargo.
 *
 * Ninguna respuesta de proveedor de este archivo es real: se intercepta
 * `fetch`, se inspecciona el cuerpo que el adaptador armó y se contesta con un
 * sobre sintético. No se llama a nadie.
 */

const graphOk = { messages: [{ id: 'wamid.SYNTHETIC' }] };

function intercept() {
    let sent: { url: string; body: any }[] = [];
    (global as any).fetch = jest.fn(async (url: string, init: any) => {
        sent.push({ url, body: JSON.parse(init.body) });
        return { status: 200, json: async () => graphOk } as any;
    });
    return { get last() { return sent[sent.length - 1]?.body; }, get count() { return sent.length; } };
}

const request = (over: Partial<StrictDispatchRequest>): StrictDispatchRequest => ({
    itemKind: 'interactive' as any, to: '573000000000', channelAccountId: '15550001111',
    payload: {}, ...over,
});

const BUTTONS = {
    type: 'button',
    body: 'Elegí el servicio, *Ana*',
    action: { buttons: [
        { type: 'reply', reply: { id: 'corte', title: 'Corte' } },
        { type: 'reply', reply: { id: 'color', title: 'Color' } },
    ] },
};

const LIST = {
    type: 'list',
    body: '¿Qué horario te sirve?',
    headerText: 'Turnos del martes',
    footerText: 'Podés cambiarlo después',
    action: { button: 'Ver horarios', sections: [
        { title: 'Mañana', rows: [{ id: '10', title: '10:00' }, { id: '11', title: '11:00' }] },
        { title: 'Tarde', rows: [{ id: '15', title: '15:00' }] },
    ] },
};

const PIN = { latitude: 4.711, longitude: -74.0721, name: 'Salón Centro', address: 'Cra 7 #12-34' };

describe('the two shapes the durable lane could not express', () => {
    beforeEach(() => { jest.restoreAllMocks(); });

    it('carries both kinds, so a producer has a row to write', () => {
        expect(DISPATCH_ITEM_KINDS).toContain('interactive');
        expect(DISPATCH_ITEM_KINDS).toContain('location');
    });

    describe('what WhatsApp is actually asked to send', () => {
        const adapter = () => new WhatsAppAdapter({ get: () => undefined } as any);

        it('sends buttons as an interactive message, not as a text with options in it', async () => {
            const net = intercept();
            const outcome = await adapter().sendStrict(
                request({ itemKind: 'interactive' as any, payload: BUTTONS }), 'token');
            expect(outcome).toEqual({ kind: 'accepted', receipt: 'wamid.SYNTHETIC' });
            expect(net.last.type).toBe('interactive');
            expect(net.last.interactive.type).toBe('button');
            // The options travel as Meta's own structure, so the customer TAPS
            // one and the reply comes back identified.
            expect(net.last.interactive.action).toEqual(BUTTONS.action);
            // And the body keeps WhatsApp's own formatting rather than the
            // asterisks the agent wrote.
            expect(net.last.interactive.body.text).toContain('Ana');
            expect(net.last.text).toBeUndefined();
        });

        it('sends a list with its header, footer and every section', async () => {
            const net = intercept();
            await adapter().sendStrict(
                request({ itemKind: 'interactive' as any, payload: LIST }), 'token');
            expect(net.last.interactive.type).toBe('list');
            expect(net.last.interactive.action.sections).toHaveLength(2);
            expect(net.last.interactive.header).toEqual({ type: 'text', text: 'Turnos del martes' });
            expect(net.last.interactive.footer).toEqual({ text: 'Podés cambiarlo después' });
        });

        it('sends a location as a pin with its coordinates', async () => {
            const net = intercept();
            await adapter().sendStrict(
                request({ itemKind: 'location' as any, payload: PIN }), 'token');
            expect(net.last).toMatchObject({
                type: 'location',
                location: { latitude: 4.711, longitude: -74.0721,
                    name: 'Salón Centro', address: 'Cra 7 #12-34' },
            });
        });

        it('sends the pin even when nobody named the place', async () => {
            const net = intercept();
            await adapter().sendStrict(request({ itemKind: 'location' as any,
                payload: { latitude: 4.711, longitude: -74.0721 } }), 'token');
            expect(net.last.location).toEqual({ latitude: 4.711, longitude: -74.0721 });
        });

        it.each([
            ['an interactive with no options at all', 'interactive', { type: 'button', body: 'hola' },
                'empty_interactive_payload'],
            ['an interactive with no question', 'interactive', { type: 'button', action: { buttons: [] } },
                'empty_interactive_payload'],
            ['a shape Meta does not have', 'interactive',
                { type: 'carousel', body: 'hola', action: { buttons: [] } },
                'unsupported_interactive_type'],
            ['a location with no coordinates', 'location', { name: 'Salón Centro' },
                'invalid_location_payload'],
            ['a latitude off the planet', 'location', { latitude: 991, longitude: -74 },
                'invalid_location_payload'],
        ])('refuses %s rather than downgrading it to text', async (_case, kind, payload, code) => {
            // THE POINT OF REFUSING. A menu flattened into a message loses the
            // tap: the customer is asked to type an answer the agent then has
            // to guess at. A definite refusal costs nothing and says why.
            const net = intercept();
            expect(await adapter().sendStrict(
                request({ itemKind: kind as any, payload }), 'token'))
                .toEqual({ kind: 'rejected', errorCode: code, retryable: false });
            // And nothing was sent, so nothing is charged.
            expect(net.count).toBe(0);
        });
    });

    describe('the channels that cannot carry them', () => {
        it.each([
            ['telegram', () => new TelegramAdapter({ get: () => undefined } as any)],
            ['instagram', () => new InstagramAdapter({ get: () => undefined } as any)],
            ['messenger', () => new MessengerAdapter({ get: () => undefined } as any)],
        ])('%s names the kind it is refusing', async (_channel, build) => {
            // This said `unsupported_item_kind:flow` whatever arrived, so a
            // refusal to send a menu was diagnosed as a Flow problem and the
            // operator went looking in the wrong place.
            const net = intercept();
            for (const kind of ['interactive', 'location'] as const) {
                expect(await (build() as any).sendStrict(
                    request({ itemKind: kind as any, payload: BUTTONS }), 'token'))
                    .toEqual({ kind: 'rejected', errorCode: `unsupported_item_kind:${kind}`,
                        retryable: false });
            }
            expect(net.count).toBe(0);
        });
    });

    describe('what the agent console will read afterwards', () => {
        it('reads the tappable labels off buttons and off list rows alike', () => {
            // The history row carries the QUESTION and these labels, because
            // the customer's next message is one of them: storing only the body
            // makes "10:00" arrive as an answer to nothing, and the agent
            // picking the thread up cannot tell what was offered. The row
            // itself is asserted against real PostgreSQL in
            // `proactive-lane-semantics.postgres.spec.ts`.
            expect(interactiveOptionLabels(BUTTONS)).toEqual(['Corte', 'Color']);
            expect(interactiveOptionLabels(LIST)).toEqual(['10:00', '11:00', '15:00']);
        });

        it('answers nothing for a payload with no options in it', () => {
            expect(interactiveOptionLabels({})).toEqual([]);
            expect(interactiveOptionLabels({ action: { buttons: 'no' } } as any)).toEqual([]);
        });

        it('stops at thirty labels rather than writing an essay into the thread', () => {
            const many = { action: { sections: [{ rows: Array.from({ length: 50 },
                (_unused, index) => ({ title: `opcion ${index}` })) }] } };
            expect(interactiveOptionLabels(many)).toHaveLength(30);
        });
    });
});
