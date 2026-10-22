/** Resolve current property facts only through a unique authorized catalogue row. */
const fold = (s: string) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function requiresPropertyDetailLookup(query: string): boolean {
    const text = fold(query);
    if (/\b(?:no\s+consulte|do\s+not\s+check|nao\s+consulte)\b/.test(text)) return false;
    return /\b(?:alojamiento|habitacion|propiedad|apartamento|casa|property|accommodation|room|apartment|house|logement|hebergement|quarto|hospedagem)\b/.test(text)
        && /\b(?:horarios?|entrada|salida|check[ -]?in|check[ -]?out|amenities|comodidades|reglas|normas|rules|dormitorios?|banos?|bedrooms?|bathrooms?|estancia|minim[oa]|horaires?|arrivee|depart|equipements|regles|entrada|saida|regras|comodidades)\b/.test(text);
}
export function propertyDetailIdForQuestion(query: string, result: unknown): string | null {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
    const value = result as Record<string, any>;
    if (value.error || value.stale === true || value.truncated === true || value.success === false
        || (value.status && value.status !== 'ok') || !Array.isArray(value.properties) || value.properties.length > 50) return null;
    if (value.properties.some(row => !row || typeof row.id !== 'string' || !UUID.test(row.id)
        || typeof row.name !== 'string' || row.name.trim().length < 3 || row.isAvailable === false || row.is_available === false)) return null;
    if (new Set(value.properties.map(row => row.id.toLowerCase())).size !== value.properties.length) return null;
    const text = fold(query);
    const ids: string[] = text.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g) || [];
    if (new Set(ids).size > 1 || (!ids.length && value.properties.length > 50)) return null;
    const matches = value.properties.filter(row => {
        if (ids.length) return ids.includes(row.id.toLowerCase());
        const name = fold(row.name).trim(), index = text.indexOf(name);
        if (index < 0 || /[a-z0-9]/.test(text[index - 1] || ' ') || /[a-z0-9]/.test(text[index + name.length] || ' ')) return false;
        // A named base property cannot establish facts for an unlisted variant.
        return !/^\s+(?:pro|plus|max|mini|ultra|premium)\b/.test(text.slice(index + name.length));
    });
    return matches.length === 1 ? matches[0].id : null;
}
