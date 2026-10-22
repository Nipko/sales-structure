/**
 * Reglas de persona heredadas que se reescriben al construir el prompt.
 *
 * Las plantillas built-in se COPIAN a `agent_personas.config_json` al crear el
 * agente, así que cambiar la plantilla no arregla a los tenants que ya la
 * tienen. Este mapa corrige esas copias en tiempo de lectura, sin escribir en
 * la base.
 *
 * Coincidencia EXACTA solamente (después de recortar espacios): una regla que
 * el dueño escribió o editó, aunque se parezca, se respeta tal cual.
 *
 * Evidencia (QA producción, oct-2026): la plantilla "Carlos - Asesor con
 * Catálogo" traía "NUNCA prometas precio final ni descuentos — el asesor
 * confirma en la visita". gpt-4.1-mini lo leía como "no des el precio" y
 * respondía que el precio "no está confirmado" justo después de que
 * search_listings devolviera price 250000 EUR con priceStatus 'confirmed'.
 * El tenant de QA tenía esa cadena copiada en config_json.
 */
export const REAL_ESTATE_PUBLISHED_PRICE_RULE =
    'Da el precio publicado del inmueble tal como lo trae search_listings o get_listing_details; NUNCA prometas descuentos, negociación ni el precio final de cierre — eso lo confirma el asesor';

export const LEGACY_PERSONA_RULE_REWRITES: Readonly<Record<string, string>> = Object.freeze({
    'NUNCA prometas precio final ni descuentos — el asesor confirma en la visita': REAL_ESTATE_PUBLISHED_PRICE_RULE,
});

export function rewriteLegacyPersonaRule(rule: string): string {
    if (typeof rule !== 'string') return rule;
    const replacement = Object.prototype.hasOwnProperty.call(LEGACY_PERSONA_RULE_REWRITES, rule.trim())
        ? LEGACY_PERSONA_RULE_REWRITES[rule.trim()]
        : undefined;
    return replacement ?? rule;
}
