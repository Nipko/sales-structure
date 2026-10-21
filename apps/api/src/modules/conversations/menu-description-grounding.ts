/** Public dish descriptions must be read before claiming the business has none. */
export function requiresMenuDescriptionLookup(query: string): boolean {
    const text = String(query || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return /\b(?:descri\w*|decriv\w*)\b/.test(text)
        && /\b(?:platos?|pratos?|dish(?:es)?|plats?|menu(?:\s+items?)?)\b/.test(text);
}
