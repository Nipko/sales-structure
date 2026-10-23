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

/**
 * Evidencia (QA producción, oct-2026, tenant dental, gpt-4.1-mini): el catálogo
 * tenía solo Consulta general, Consulta especializada y Control y seguimiento,
 * y el agente respondía "Sí, ofrecemos tratamiento de ortodoncia", "Sí,
 * realizamos tratamientos de implantes dentales" y ofrecía valoración para
 * blanqueamiento. No había FAQ de implantes ni de blanqueamiento: la causa era
 * la plantilla "Sofía - Recepción Odontológica", cuyas reglas nombraban esos
 * tratamientos como si la clínica los hiciera ("Para ortodoncia/blanqueamiento/
 * tratamientos: ofrece valoración previa de 30min"). Las reglas nuevas atan
 * cada oferta al catálogo de servicios.
 */
export const DENTAL_ASSESSMENT_RULE =
    'Si preguntan por un tratamiento que está en el catálogo de servicios, ofrece la valoración previa de 30 min; si no está en el catálogo, di que no lo ofrecemos y muestra los servicios que sí hay';

export const DENTAL_REASON_RULE =
    'Pregunta el motivo de la consulta (por ejemplo dolor, control o un tratamiento) y ofrece solo los servicios que están en el catálogo';

export const DENTAL_ROUTINE_BOOKING_RULE =
    'Para limpieza o control de rutina, si está en el catálogo de servicios, agenda directamente desde el calendario';

export const LEGACY_PERSONA_RULE_REWRITES: Readonly<Record<string, string>> = Object.freeze({
    'NUNCA prometas precio final ni descuentos — el asesor confirma en la visita': REAL_ESTATE_PUBLISHED_PRICE_RULE,
    'Para ortodoncia/blanqueamiento/tratamientos: ofrece valoración previa de 30min': DENTAL_ASSESSMENT_RULE,
    'Pregunta el motivo: ¿limpieza de rutina, dolor, tratamiento estético, ortodoncia?': DENTAL_REASON_RULE,
    'Para limpieza/control rutinario: agenda directamente desde el calendario': DENTAL_ROUTINE_BOOKING_RULE,
});

export function rewriteLegacyPersonaRule(rule: string): string {
    if (typeof rule !== 'string') return rule;
    const replacement = Object.prototype.hasOwnProperty.call(LEGACY_PERSONA_RULE_REWRITES, rule.trim())
        ? LEGACY_PERSONA_RULE_REWRITES[rule.trim()]
        : undefined;
    return replacement ?? rule;
}
