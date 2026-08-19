import * as sharp from 'sharp';
import { ChannelGatewayService } from './channel-gateway.service';
import { channelSafeImageUrl } from '../../common/utils/media-url.util';

/**
 * Ninguna foto se entregó nunca por WhatsApp.
 *
 * MediaService convierte todo lo que sube el dueño a WebP, y WhatsApp reserva
 * WebP para stickers: un mensaje de imagen sólo acepta image/jpeg e image/png.
 * Instagram documenta png/jpeg. Meta iba a buscar el archivo, lo rechazaba, y el
 * rechazo volvía en un webhook de estado que se descartaba — así que del lado
 * nuestro el log decía "Sent" y la conversación seguía como si nada.
 *
 * Estos tests recorren el camino real: el borde del gateway por el que pasan los
 * cuatro canales, y la transcodificación de verdad (con sharp, sin mocks),
 * comprobando los bytes mágicos del JPEG resultante.
 */

const MEDIA = 'https://api.parallly-chat.cloud/api/v1/media/file/t-1/31abcd0a.webp';

function gatewayWith(channelType: string) {
    const calls: Array<{ mediaUrl: string; mediaType: string }> = [];
    const adapter = {
        channelType,
        sendTextMessage: jest.fn(async () => 'id-text'),
        sendMediaMessage: jest.fn(async (
            _to: string, mediaUrl: string, _caption: any, _acc: string, _tok: string, mediaType: string,
        ) => {
            calls.push({ mediaUrl, mediaType });
            return 'id-media';
        }),
        handleWebhook: jest.fn(),
    };
    const gateway = new ChannelGatewayService();
    gateway.registerAdapter(adapter as any);
    return { gateway, calls };
}

function outbound(channelType: string, content: any) {
    return {
        tenantId: 't-1', to: '573208010737', channelType,
        channelAccountId: 'acc-1', content,
    } as any;
}

describe('el saliente entrega imágenes en un formato que los canales aceptan', () => {
    // Los cuatro adaptadores mandan la URL por link y NO descargan el archivo:
    // la plataforma remota lo va a buscar y valida el tipo. Por eso la
    // conversión va en el borde comun y no en cada adaptador.
    it.each(['whatsapp', 'instagram', 'messenger', 'telegram'])(
        'pide el JPEG en lugar del WebP — %s', async (channelType) => {
            const { gateway, calls } = gatewayWith(channelType);

            await gateway.sendMessage(outbound(channelType, { type: 'image', mediaUrl: MEDIA }), 'token');

            expect(calls).toHaveLength(1);
            expect(calls[0].mediaType).toBe('image');
            expect(calls[0].mediaUrl).toBe(
                'https://api.parallly-chat.cloud/api/v1/media/file/t-1/31abcd0a.jpg',
            );
            expect(calls[0].mediaUrl).not.toContain('.webp');
        },
    );

    it('no toca un documento: el PDF se sirve tal cual', async () => {
        const { gateway, calls } = gatewayWith('whatsapp');
        const pdf = 'https://api.parallly-chat.cloud/api/v1/media/file/t-1/contrato.pdf';

        await gateway.sendMessage(outbound('whatsapp', { type: 'document', mediaUrl: pdf }), 'token');

        expect(calls[0]).toMatchObject({ mediaUrl: pdf, mediaType: 'document' });
    });

    it('no reescribe una imagen alojada fuera de la plataforma', async () => {
        const { gateway, calls } = gatewayWith('whatsapp');
        const externa = 'https://cdn.proveedor.example/catalogo/zapato.webp';

        await gateway.sendMessage(outbound('whatsapp', { type: 'image', mediaUrl: externa }), 'token');

        // No es nuestra: no sabemos servir otra versión, reescribirla daría 404.
        expect(calls[0].mediaUrl).toBe(externa);
    });

    it('deja pasar lo que ya es servible', () => {
        expect(channelSafeImageUrl('/api/v1/media/file/t/a.jpg')).toBe('/api/v1/media/file/t/a.jpg');
        expect(channelSafeImageUrl('/api/v1/media/file/t/a.png')).toBe('/api/v1/media/file/t/a.png');
        expect(channelSafeImageUrl(undefined)).toBeUndefined();
    });
});

describe('la transcodificación produce un JPEG de verdad', () => {
    it('convierte un WebP con transparencia a JPEG opaco', async () => {
        const webp = await sharp({
            create: { width: 32, height: 32, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 0.5 } },
        }).webp().toBuffer();
        expect(webp.subarray(8, 12).toString('ascii')).toBe('WEBP');

        // El mismo pipeline que usa readFileForDelivery.
        const jpeg = await sharp(webp).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();

        // Bytes magicos de JPEG: FF D8 FF. Es lo que Meta valida al descargar.
        expect(jpeg[0]).toBe(0xff);
        expect(jpeg[1]).toBe(0xd8);
        expect(jpeg[2]).toBe(0xff);

        const meta = await sharp(jpeg).metadata();
        expect(meta.format).toBe('jpeg');
        // JPEG no tiene alfa: si no se aplanaba, sharp fallaba o dejaba el fondo en negro.
        expect(meta.hasAlpha).toBe(false);
    });
});
