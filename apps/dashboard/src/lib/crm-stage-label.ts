export interface CrmStageDefinition {
    id?: string;
    slug?: string;
    name?: string;
}

/** Configured names are tenant data; only legacy stage keys belong to the shared dictionary. */
export function crmStageLabel(
    stage: unknown,
    definitions: readonly CrmStageDefinition[],
    translate: { (key: string): string; has(key: string): boolean },
    unavailable: string,
): string {
    const value = typeof stage === 'string' ? stage.trim() : '';
    if (!value) return unavailable;
    const configured = definitions.find(item => item.slug === value || item.id === value);
    if (typeof configured?.name === 'string' && configured.name.trim()) return configured.name.trim();
    const key = `stages.${value}`;
    if (translate.has(key)) return translate(key);
    const readable = value.replace(/[_-]+/g, ' ').trim();
    return readable ? readable.charAt(0).toUpperCase() + readable.slice(1) : unavailable;
}
