/** Detail questions must see current catalogue data before a FAQ/RAG-only reply. */
const fold = (value: string) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function requiresPackageDetailLookup(query: string): boolean {
    const text = fold(query);
    return /\b(?:tours?|paquetes?|packages?|pacotes?|excurs\w*|forfaits?)\b/.test(text)
        && /\b(?:inclu\w*|exclu\w*|equipaje|llevar|idioma\w*|langu\w*|duracion|duracao|dura|duration|lasts?|bring|luggage|baggage|levar|duree|dure|apporter|bagages?|cancel\w*|annul\w*)\b/.test(text);
}

/** Names/UUIDs are matched only against one current authorized search result.
 * A failed, ambiguous or malformed catalogue never authorizes a guessed detail read.
 */
export function packageDetailIdForQuestion(query: string, result: unknown): string | null {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
    const value = result as Record<string, any>;
    if (value.error || value.stale === true || value.truncated === true || value.success === false
        || (value.status && value.status !== 'ok') || !Array.isArray(value.packages) || value.packages.length > 50) return null;
    if (value.packages.some(row => !row || typeof row.id !== 'string' || !UUID.test(row.id) || typeof row.name !== 'string' || !row.name.trim()
        || row.is_active === false || row.isActive === false)) return null;
    if (new Set(value.packages.map(row => row.id)).size !== value.packages.length) return null;
    const text = fold(query);
    const ids: string[] = text.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g) || [];
    if (new Set(ids).size > 1) return null;
    // search_packages is capped at twenty: a full page cannot establish that
    // a name is unique outside the returned page. Explicit UUIDs stay exact.
    if (!ids.length && value.packages.length >= 20) return null;
    const matches = value.packages.filter(row => {
        if (ids.length) return ids.includes(String(row.id).toLowerCase());
        const name = fold(row.name).trim();
        const index = text.indexOf(name);
        if (index < 0) return false;
        const before = text[index - 1] || ' ';
        const after = text[index + name.length] || ' ';
        return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
    });
    return matches.length === 1 ? matches[0].id : null;
}
