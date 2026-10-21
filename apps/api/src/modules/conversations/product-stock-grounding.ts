/** Only identify a product within the current authorized bounded catalogue. */
const fold = (s: string) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function requiresProductStockLookup(query: string): boolean {
    const text = fold(query);
    return /\b(?:stock|inventario|inventory|existencias|unidades?|units?|estoque|unites?)\b/.test(text)
        && !/\b(?:no\s+(?:consulte|consultes|verifique|verifiques)|do\s+not\s+check)\s+(?:el\s+)?(?:stock|inventario|inventory)\b/.test(text);
}
export function stockProductIdForQuestion(query: string, result: unknown): string | null {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
    const value = result as Record<string, any>;
    if (value.error || value.stale === true || value.truncated === true || value.success === false
        || (value.status && value.status !== 'ok') || !Array.isArray(value.products) || value.products.length > 20) return null;
    if (value.products.some(row => !row || typeof row.id !== 'string' || !UUID.test(row.id)
        || typeof row.name !== 'string' || row.name.trim().length < 3 || row.isAvailable === false || row.is_available === false)) return null;
    if (new Set(value.products.map(row => row.id.toLowerCase())).size !== value.products.length) return null;
    const text = fold(query);
    const ids: string[] = text.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g) || [];
    if (new Set(ids).size > 1 || (!ids.length && value.products.length >= 20)) return null;
    const matches = value.products.filter(row => {
        if (ids.length) return ids.includes(row.id.toLowerCase());
        const name = fold(row.name).trim(), index = text.indexOf(name);
        if (index < 0 || /[a-z0-9]/.test(text[index - 1] || ' ') || /[a-z0-9]/.test(text[index + name.length] || ' ')) return false;
        // A base catalogue item cannot establish stock of an unlisted variant.
        return !/^\s+(?:pro|plus|max|mini|ultra|premium)\b/.test(text.slice(index + name.length));
    });
    return matches.length === 1 ? matches[0].id : null;
}
