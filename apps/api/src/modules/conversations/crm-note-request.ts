/** A direct note request must not disappear behind English keyword retrieval.
 * This only retains an already-authorized tool; execution policy still decides
 * whether anything may be written. Quoted examples and negated commands do not
 * authorize retention. Other lifecycle writers keep their existing policy.
 */
export function explicitlyRequestsCrmNote(query: string): boolean {
    const command = (query || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().split(/["“«]/, 1)[0].trim().replace(/^[¿¡]\s*/, '');
    return /^(?:(?:por favor[, ]+)|(?:(?:puedes|podrias|puede|podria)\s+))?(?:guardar?|anotar?|registrar?|agregar?|anad(?:e|ir))\b[^.!?;\n]{0,100}\bnotas?\b/.test(command)
        || /^(?:(?:please[, ]+)|(?:(?:can|could|would) you\s+))?(?:save|add|record|store)\b[^.!?;\n]{0,100}\bnotes?\b/.test(command)
        || /^(?:(?:por favor[, ]+)|(?:(?:pode|podes|poderia)\s+))?(?:guarde|guardar|salve|salvar|adicione|adicionar|registre|registrar)\b[^.!?;\n]{0,100}\bnotas?\b/.test(command)
        || /^(?:(?:s'il vous plait[, ]+)|(?:(?:peux-tu|pouvez-vous)\s+))?(?:enregistre|enregistrer|enregistrez|ajoute|ajouter|ajoutez)\b[^.!?;\n]{0,100}\bnotes?\b/.test(command);
}
