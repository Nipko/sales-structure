const MEDIA_API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1";

/**
 * La URL con la que el navegador puede pedir un archivo de media.
 *
 * Lo que se guarda en la base es una ruta enraizada (`/media/file/...`), no una
 * URL absoluta: el origen del API cambia entre entornos y congelarlo en la
 * fila haría que las fotos de producción apunten a localhost. Seis pantallas
 * traían su propia copia de esta función; una que se corrija sin las otras es
 * exactamente cómo una galería empieza a mostrar imágenes rotas en un lado y
 * no en el otro.
 */
export function resolveMediaUrl(url: string): string {
    if (!url) return url;
    if (/^https?:\/\//i.test(url)) return url;
    const apiOrigin = MEDIA_API_BASE.replace(/\/api\/v1\/?$/, "");
    return `${apiOrigin}${url.startsWith("/") ? url : "/" + url}`;
}

export const MEDIA_UPLOAD_BASE = MEDIA_API_BASE;
