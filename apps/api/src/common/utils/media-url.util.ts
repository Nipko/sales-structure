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
