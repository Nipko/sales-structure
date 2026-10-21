/** Keep an already-authorized tag tool for an explicit customer command.
 * Retrieval cannot decide that a requested tag exists; the executor checks it.
 * This neither grants CRM permission nor applies a tag without execution.
 */
export function explicitlyRequestsCrmTag(query: string): boolean {
    const command = (query || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().split(/["“«]/, 1)[0].trim().replace(/^[¿¡]\s*/, '');
    return /^(?:(?:por favor[, ]+)|(?:(?:puedes|podrias|puede|podria)\s+))?(?:agregar?|agregue|anad(?:e|ir)|pon(?:er)?|apli(?:ca|car|que)|asign(?:a|ar|e))\s+(?:(?:a|en) mi (?:ficha|perfil)\s+)?(?:(?:la|una|esta)\s+)?etiquetas?\b/.test(command)
        || /^(?:(?:please[, ]+)|(?:(?:can|could|would) you\s+))?(?:add|apply|assign)\s+(?:(?:the|an?|existing|my)\s+)*(?:tags?|labels?)\b/.test(command)
        || /^(?:(?:por favor[, ]+)|(?:(?:pode|podes|poderia)\s+))?(?:adicione|adicionar|aplique|aplicar|atribua|atribuir)\s+(?:(?:a|uma|essa)\s+)?etiquetas?\b/.test(command)
        || /^(?:(?:s'il vous plait[, ]+)|(?:(?:peux-tu|pouvez-vous)\s+))?(?:ajoute|ajouter|ajoutez|applique|appliquer|appliquez|attribue|attribuer|attribuez)\s+(?:(?:une|des|les|cette)\s+|l['’])?etiquettes?\b/.test(command);
}
