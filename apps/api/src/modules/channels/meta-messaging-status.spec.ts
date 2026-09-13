import { classifyMetaMessagingEvent, isInboundMessagingEvent } from './meta-messaging-status';

/**
 * ═══ LO QUE META MANDA Y NADIE LEÍA ═══
 *
 * Los dos adaptadores contestaban una sola pregunta —"¿es un mensaje
 * entrante?"— y devolvían `null` para todo lo demás. El controller hacía
 * `if (!normalized) continue;` y ahí se perdían las confirmaciones de entrega y
 * los acuses de lectura, sin una línea de log. Es la misma ceguera que dejó
 * meses de imágenes WebP rechazadas diciendo "Sent".
 *
 * Las formas de abajo son las publicadas por Meta, con los identificadores
 * reemplazados por sintéticos. Las dos que importan y que NO son intercambiables:
 *
 *   - Messenger `message_reads` → `read: { watermark }`. No trae mid: dice
 *     "todo lo enviado a este hilo hasta este instante fue leído".
 *   - Instagram `messaging_seen`  → `read: { mid }`. Nombra UN mensaje.
 *
 * Y `message_deliveries` es sólo de Messenger: Meta lo documenta como "Only
 * available for Messenger conversations". Instagram no manda entregas.
 *
 * Ningún proveedor fue llamado para escribir esto.
 */

const PSID = '2345678901234567';
const IGSID = '17841400000000000';
const PAGE_ID = '109876543210987';
const IG_ID = '17841499999999999';

const fbDelivery = (mids: string[] | undefined, watermark = 1758668856253) => ({
    sender: { id: PSID },
    recipient: { id: PAGE_ID },
    delivery: { ...(mids ? { mids } : {}), watermark },
});
const fbRead = (watermark = 1758668856253) => ({
    sender: { id: PSID }, recipient: { id: PAGE_ID },
    timestamp: 1758668856463, read: { watermark },
});
const igRead = (mid: string) => ({
    sender: { id: IGSID }, recipient: { id: IG_ID },
    timestamp: 1758668856349, read: { mid },
});

describe('clasificar un evento messaging de Meta', () => {
    describe('entrega de Messenger', () => {
        it('abre un evento con varios mids en un recibo por mensaje', () => {
            const status = classifyMetaMessagingEvent(
                fbDelivery(['m_syntheticA', 'm_syntheticB', 'm_syntheticC']), 'messenger');
            expect(status.kind).toBe('delivery');
            // Uno a uno sobre el camino por recibo que ya existe. A diferencia de
            // WhatsApp —un mid por evento— acá un solo webhook abarca N.
            expect(status.events.map(event => event.providerMessageId))
                .toEqual(['m_syntheticA', 'm_syntheticB', 'm_syntheticC']);
            expect(status.events.every(event => event.status === 'delivered')).toBe(true);
            // Con ids nombrados el corte sobra: no hay nada que resolver.
            expect(status.watermark).toBeNull();
        });

        it('cae al corte cuando Meta no manda `mids`, que documenta como opcional', () => {
            const status = classifyMetaMessagingEvent(fbDelivery(undefined, 1758668856253), 'messenger');
            expect(status.events).toHaveLength(0);
            // "Field may not be present" por compatibilidad con clientes viejos.
            // Sin esto, esas entregas se perderían igual que antes.
            expect(status.watermark)
                .toEqual({ status: 'delivered', watermarkMs: 1758668856253, recipient: PSID });
        });

        it('descarta ids vacíos o desmedidos en vez de mandarlos a buscar', () => {
            const status = classifyMetaMessagingEvent(
                fbDelivery(['  ', 'x'.repeat(301), 'm_ok', 42 as any]), 'messenger');
            // 300 es el techo que el outbox impone al recibo: un id más largo
            // nunca pudo guardarse, así que buscarlo sólo produce un fallo.
            expect(status.events.map(event => event.providerMessageId)).toEqual(['m_ok']);
        });

        it('atribuye el corte al cliente, no a la página', () => {
            const status = classifyMetaMessagingEvent(fbDelivery(undefined), 'messenger');
            // `sender` es el cliente en un evento de estado; `recipient` somos
            // nosotros. Invertirlos apuntaría el corte a un hilo inexistente.
            expect(status.watermark?.recipient).toBe(PSID);
        });
    });

    describe('lectura', () => {
        it('de Messenger es un corte sin ningún mensaje nombrado', () => {
            const status = classifyMetaMessagingEvent(fbRead(1758668856253), 'messenger');
            expect(status.kind).toBe('read');
            expect(status.events).toHaveLength(0);
            expect(status.watermark)
                .toEqual({ status: 'read', watermarkMs: 1758668856253, recipient: PSID });
        });

        it('de Instagram nombra un mensaje y no necesita corte alguno', () => {
            const status = classifyMetaMessagingEvent(igRead('aWdfZG1fMTpzeW50aGV0aWM'), 'instagram');
            expect(status.kind).toBe('read');
            expect(status.events).toEqual([{
                providerMessageId: 'aWdfZG1fMTpzeW50aGV0aWM', status: 'read',
                recipient: IGSID, errorCode: null, errorDetail: null,
            }]);
            // El error caro sería tratarlo como corte: barrería el hilo entero
            // por un solo mensaje leído.
            expect(status.watermark).toBeNull();
        });

        it('no inventa un corte de Instagram a partir de un watermark que Meta no documenta', () => {
            const status = classifyMetaMessagingEvent(
                { sender: { id: IGSID }, recipient: { id: IG_ID }, read: { watermark: 1758668856253 } },
                'instagram');
            expect(status.kind).toBe('read');
            expect(status.events).toHaveLength(0);
            // Meta no publica tabla de propiedades para `messaging_seen`: sólo el
            // ejemplo con `mid`. Adivinar el resto es exactamente lo prohibido.
            expect(status.watermark).toBeNull();
        });
    });

    describe('cortes que no se pueden creer', () => {
        it.each([
            ['cero', 0],
            ['segundos en vez de milisegundos', 1758668856],
            ['texto', '1758668856253'],
            ['fraccionario', 1758668856253.7],
            ['un año en el futuro', Date.now() + 365 * 86_400_000],
        ])('rechaza un watermark %s', (_label, watermark) => {
            const status = classifyMetaMessagingEvent(fbRead(watermark as any), 'messenger');
            // Un corte de 1970 marcaría como leído todo lo que se le mandó al
            // contacto en la vida. Sin instante creíble no hay corte.
            expect(status.watermark).toBeNull();
            expect(status.kind).toBe('read');
        });

        it('rechaza un corte sin remitente, que no tendría hilo al que aplicarse', () => {
            const status = classifyMetaMessagingEvent(
                { recipient: { id: PAGE_ID }, read: { watermark: 1758668856253 } }, 'messenger');
            expect(status.watermark).toBeNull();
        });
    });

    describe('lo que sí es un mensaje entrante', () => {
        it('deja pasar un mensaje del cliente', () => {
            const status = classifyMetaMessagingEvent(
                { sender: { id: PSID }, recipient: { id: PAGE_ID }, timestamp: 1758668856000,
                  message: { mid: 'm_synthetic_in', text: 'hola' } }, 'messenger');
            expect(status.kind).toBe('inbound_message');
            expect(isInboundMessagingEvent(status)).toBe(true);
        });

        it('nombra el eco en vez de confundirlo con un mensaje del cliente', () => {
            const status = classifyMetaMessagingEvent(
                { sender: { id: PAGE_ID }, recipient: { id: PSID },
                  message: { mid: 'm_synthetic_echo', is_echo: true, text: 'lo nuestro' } }, 'messenger');
            // Es NUESTRO saliente volviendo. Tratarlo como entrante sería
            // contestarnos a nosotros mismos.
            expect(status.kind).toBe('echo');
            expect(isInboundMessagingEvent(status)).toBe(false);
        });
    });

    describe('tráfico real que no modelamos, con nombre propio', () => {
        it.each([
            ['reaction', { sender: { id: PSID }, reaction: { mid: 'm_x', action: 'react', emoji: '❤' } }],
            ['postback', { sender: { id: PSID }, postback: { title: 'Empezar', payload: 'START' } }],
            ['referral', { sender: { id: PSID }, referral: { source: 'ADS', type: 'OPEN_THREAD' } }],
            ['optin', { sender: { id: PSID }, optin: { type: 'notification_messages' } }],
            ['handover', { sender: { id: PSID }, pass_thread_control: { new_owner_app_id: '1' } }],
            ['account_linking', { sender: { id: PSID }, account_linking: { status: 'linked' } }],
            ['unknown', { sender: { id: PSID }, something_meta_added_later: {} }],
        ])('clasifica %s sin estado que aplicar', (kind, item) => {
            const status = classifyMetaMessagingEvent(item as any, 'messenger');
            expect(status.kind).toBe(kind);
            // Lo importante no es el veredicto sino que TENGA uno: el descarte
            // silencioso es lo que hizo falta descubrir a mano la vez pasada.
            expect(status.events).toHaveLength(0);
            expect(status.watermark).toBeNull();
            expect(isInboundMessagingEvent(status)).toBe(false);
        });

        it.each([[null], [undefined], ['texto suelto'], [7]])('no explota con %p', item => {
            expect(classifyMetaMessagingEvent(item as any, 'instagram').kind).toBe('unknown');
        });
    });
});
