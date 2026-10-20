/** Retain an already-authorized CRM task tool for an explicit task command.
 * Selection is not consent, permission or proof of execution. Quoted payload
 * and negative commands must not become new task requests.
 */
export function explicitlyRequestsCrmTask(query: string): boolean {
    const text = (query || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/"[^"]*"|“[^”]*”|«[^»]*»/g, ' ');
    return text.split(/[.!?;\n]+/).some(part => {
        const command = part.trim().replace(/^[¿¡]\s*/, '');
        return /^(?:(?:por favor[, ]+)|(?:(?:puedes|podrias|puede|podria)\s+))?(?:crear?|cree|registrar?|registre|agregar?|agregue|anad(?:e|ir))\b[^.!?;\n]{0,100}\btareas?\b/.test(command)
            || /^(?:(?:please[, ]+)|(?:(?:can|could|would) you\s+))?(?:create|add|record|schedule)\b[^.!?;\n]{0,100}\btasks?\b/.test(command)
            || /^(?:(?:por favor[, ]+)|(?:(?:pode|podes|poderia)\s+))?(?:crie|criar|registre|registrar|adicione|adicionar)\b[^.!?;\n]{0,100}\btarefas?\b/.test(command)
            || /^(?:(?:s'il vous plait[, ]+)|(?:(?:peux-tu|pouvez-vous)\s+))?(?:cree|creer|creez|ajoute|ajouter|ajoutez|enregistre|enregistrer)\b[^.!?;\n]{0,100}\btaches?\b/.test(command);
    });
}
