/**
 * Convierte la URL relativa que guarda MediaService (`/api/v1/media/file/...`)
 * en una absoluta.
 *
 * Hace falta porque el saliente no lo descarga la plataforma: Meta, Telegram y
 * el resto van a BUSCAR el archivo a la URL que les pasamos. Una ruta relativa
 * les llega como texto sin sentido y el envío falla sin error visible para el
 * dueño — el cliente simplemente nunca recibe la foto.
 */
export function absoluteMediaUrl(url?: string | null): string | undefined {
    if (!url) return undefined;
    if (/^https?:\/\//i.test(url)) return url; // ya es absoluta
    const origin = (
        process.env.API_PUBLIC_URL ||
        process.env.NEXT_PUBLIC_API_URL ||
        'https://api.parallly-chat.cloud/api/v1'
    ).replace(/\/api\/v1\/?$/, '');
    return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * La URL de una imagen en el formato que los canales SÍ aceptan.
 *
 * Todo lo que sube el dueño se guarda como WebP (MediaService lo convierte con
 * sharp), y WebP no sirve para un mensaje de imagen: WhatsApp sólo acepta
 * image/jpeg e image/png y reserva WebP para stickers; Instagram documenta
 * png/jpeg. Meta iba a buscar el archivo, lo rechazaba, y el fallo volvía en un
 * webhook de estado que se descartaba — así que el log decía "Sent" y el
 * cliente no recibía NINGUNA foto. Nunca.
 *
 * Se reescribe sólo la extensión de las rutas servidas por nuestro endpoint de
 * media: una URL externa (un producto alojado en otro lado) se devuelve intacta,
 * y un .jpg/.png ya servible también. El endpoint transcodifica a pedido, así
 * que esto funciona con todo lo que ya está subido, sin migración.
 */
export function channelSafeImageUrl(url?: string | null): string | undefined {
    if (!url) return undefined;
    if (!/\/media\/file\//i.test(url)) return url;
    return url.replace(/\.webp(\?|#|$)/i, '.jpg$1');
}
