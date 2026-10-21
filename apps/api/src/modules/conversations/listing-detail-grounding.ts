/** Named property questions need current authorized data before model prose. */
const fold = (s: string) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function requiresListingDetailLookup(query: string): boolean {
    const text = fold(query);
    return /\b(?:inmueble\w*|propiedad\w*|apartamento\w*|casa\w*|listing\w*|property|apartment\w*|imovel|imoveis|appartement\w*|logement\w*)\b/.test(text)
        && /\b(?:financ\w*|deposit\w*|depot|hoa|administracion|administracao|condominio|constru\w*|year\s+built|estrato|stratum|area|metros?\s+cuadrados?|m2|square\s+(?:met\w*|feet)|superficie|surface|parking|parqueadero\w*|estacionamiento\w*|garag\w*|vaga\w*|enlace\w*|link\w*|url|lien\w*|habitacion\w*|dormitorio\w*|bedroom\w*|chambre\w*|bano\w*|bathroom\w*|amen\w*|comodidade\w*)\b/.test(text);
}

export function listingDetailIdForQuestion(query: string, result: unknown): string | null {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
    const value = result as Record<string, any>;
    if (value.error || value.stale === true || value.truncated === true || value.success === false
        || (value.status && value.status !== 'ok') || !Array.isArray(value.listings) || value.listings.length > 8) return null;
    if (value.listings.some(row => !row || typeof row.id !== 'string' || !UUID.test(row.id)
        || typeof row.name !== 'string' || !row.name.trim() || (row.status && row.status !== 'available'))) return null;
    if (new Set(value.listings.map(row => row.id.toLowerCase())).size !== value.listings.length) return null;
    const text = fold(query);
    const ids: string[] = text.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g) || [];
    if (new Set(ids).size > 1 || (!ids.length && value.listings.length >= 8)) return null;
    const matches = value.listings.filter(row => {
        if (ids.length) return ids.includes(row.id.toLowerCase());
        const name = fold(row.name).trim(), index = text.indexOf(name);
        return index >= 0 && !/[a-z0-9]/.test(text[index - 1] || ' ')
            && !/[a-z0-9]/.test(text[index + name.length] || ' ');
    });
    return matches.length === 1 ? matches[0].id : null;
}
