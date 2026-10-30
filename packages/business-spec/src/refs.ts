/** «appointment(table)» → {object, variant}. */
export function parseObjectRef(ref: string): { object: string; variant: string | null } {
    const m = String(ref).trim().match(/^([a-z_]+)(?:\(([a-z_]+)\))?$/);
    return m ? { object: m[1], variant: m[2] ?? null } : { object: String(ref), variant: null };
}
