/** Photo requests require a current authorized catalogue read, not a failed FAQ. */
const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function requiresPropertyPhotoLookup(text: string): boolean {
    const value = fold(String(text || ''));
    if (/\b(?:no\s+(?:me\s+)?(?:envies|mandes|muestres|quiero)|do not send|don'?t send|nao envie|ne.*envoyez.*pas)\b/.test(value)) return false;
    return /\b(?:foto|fotos|photo|photos|picture|pictures|image|images|imagen|imagenes|imagem|imagens)\b/.test(value)
        && /\b(?:alojamiento|alojamientos|habitacion|habitaciones|propiedad|propiedades|property|properties|accommodation|room|rooms|logement|hebergement|quarto|hospedagem)\b/.test(value);
}

interface PropertyPhotoRow { id: string; name: string; images: unknown[] }
function currentProperties(result: unknown): PropertyPhotoRow[] {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
    const value = result as Record<string, unknown>;
    if (value.error || value.stale === true || (value.status && value.status !== 'ok') || !Array.isArray(value.properties)) return [];
    // Reject an incomplete/oversized result rather than silently dropping an
    // ambiguous property and grounding the answer in the remaining one.
    if (value.properties.length > 50 || value.properties.some(p => !p || !UUID.test(p.id)
        || typeof p.name !== 'string' || !p.name.trim() || !Array.isArray(p.images))) return [];
    return value.properties;
}

export function propertyPhotoCatalogue(result: unknown) {
    return currentProperties(result).map(p => ({ id: p.id, title: p.name.slice(0, 200), category: 'property' }));
}

/** Only an exact current single-property match can establish missing photos.
 * No media is sent, no booking changes and no error/absent tool becomes proof.
 */
export function groundMissingPropertyPhotoReply(text: string, reads: readonly { name: string; result: unknown }[] | undefined, language?: string): string | null {
    if (!requiresPropertyPhotoLookup(text)) return null;
    const lookup = [...(reads || [])].reverse().find(r => r.name === 'list_properties');
    if (!lookup) return null;
    const properties = currentProperties(lookup.result);
    const value = fold(text);
    const ids: string[] = value.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g) || [];
    const matching = properties.filter(p => ids.length ? ids.includes(p.id.toLowerCase()) : value.includes(fold(p.name)));
    if (matching.length !== 1 || new Set(ids).size > 1 || matching[0].images.length !== 0) return null;
    const name = Array.from(matching[0].name, char => {
        const code = char.charCodeAt(0);
        return code <= 31 || code === 127 ? ' ' : char;
    }).join('').trim().slice(0, 200);
    const replies: Record<string, string> = {
        es: `El alojamiento "${name}" está registrado, pero no tiene fotos disponibles.`,
        en: `The property "${name}" is listed, but it has no photos available.`,
        pt: `A hospedagem "${name}" está cadastrada, mas não tem fotos disponíveis.`,
        fr: `Le logement "${name}" est enregistré, mais aucune photo n’est disponible.`,
    };
    return replies[String(language || 'es').toLowerCase().split(/[-_]/)[0]] || replies.es;
}
