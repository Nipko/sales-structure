/**
 * R4 (C0 §2.3 y §4.2, ADR 0010): el modo de escritura que declara el NEGOCIO por objeto (`OBJ.<X>.WRITE_MODE`) decide
 * qué escritores puede usar el agente. Pregunta abierta 5, decidida: los interruptores por agente
 * (`tools.<familia>.canBook/canCancel`) ya no amplían nada; solo pueden restringir lo que el WRITE_MODE permite, y se
 * retiran de la pantalla del agente cuando la regla se aplique en todos los tenants.
 *
 * Puro: recibe la evaluación del motor y las herramientas ya publicadas por las reglas viejas y devuelve la exclusión
 * nueva y la diferencia con la vieja. EffectiveCapabilityService la registra (sombra) o la aplica (bandera
 * `readiness.writeModeCapability`).
 *
 * Un escritor del objeto O se excluye si:
 * - el modo resuelto es `none` o no está declarado (C0 `when_missing` de WRITE_MODE: sin modo, el objeto solo informa);
 * - o falla como bloqueante algún requisito del objeto (`OBJ.<O>.*` en `blockingGaps`: catálogo, fuente de
 *   disponibilidad, el propio WRITE_MODE…): C0 §1.2, «un R2 falla → el escritor se excluye, falla cerrada».
 * Las lecturas no se tocan: un catálogo sin datos se sigue pudiendo consultar (`catalog_empty`).
 */
import type { ReadinessResult } from '@parallext/business-spec';
import type { ToolDefinition } from '@parallext/shared';
import { staticToolsForAgentConfig } from './agent-tool-registry';
import { isNonCommittalTool } from './tool-policy-registry';

/**
 * Objeto de la especificación → familias de herramientas del agente que lo escriben (C0 §4.2 `OBJECT_TOOL_GROUPS`,
 * reemplaza a `TOOL_GROUP_READINESS` cuando la regla se aplique). `lead` no tiene familia propia: la captura de
 * contacto es del CRM, que no depende de un objeto transaccional.
 */
export const OBJECT_TOOL_GROUPS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    appointment: ['appointments', 'treatments'],
    food_order: ['restaurants'],
    catalog_order: ['catalog', 'ecommerce'],
    lodging_booking: ['properties'],
    tour_booking: ['tours'],
    real_estate: ['realEstate'],
    enrollment: ['education'],
    membership: ['gyms'],
    insurance: ['insurance'],
    service_request: ['homeServices', 'repairOrders'],
    rental: ['vehicleRentals'],
    pet_boarding: ['petBoarding'],
    photo_session: ['photography'],
    professional_case: ['professionalServices'],
    lead: [],
});

/** Herramientas que comprometen al negocio (no son lecturas) de las familias de un objeto. */
export function objectWriters(object: string): string[] {
    const families = OBJECT_TOOL_GROUPS[object] ?? [];
    if (!families.length) return [];
    const config = Object.fromEntries(families.map(f => [f, { enabled: true }]));
    return [...new Set(staticToolsForAgentConfig(config).map((t: ToolDefinition) => String(t.name)).filter(name => !isNonCommittalTool(name)))];
}

export interface WriteModeDecision {
    mode: 'shadow' | 'enforce';
    excludedWriters: string[];
    onlyNew: string[];
    objects: Record<string, { mode: string; declared: boolean; preconditionsMet: boolean }>;
}

export function writeModeDecision(
    result: Pick<ReadinessResult, 'config' | 'blockingGaps'>,
    publishedTools: readonly string[],
    mode: 'shadow' | 'enforce',
): WriteModeDecision {
    const excluded = new Set<string>();
    const objects: WriteModeDecision['objects'] = {};
    for (const o of result.config.objects) {
        const prefix = `OBJ.${o.object.toUpperCase()}.`;
        const preconditionsMet = !result.blockingGaps.some(id => id.startsWith(prefix));
        const resolved = o.writeModeDeclared ? o.writeMode : 'none';
        objects[o.object] = { mode: resolved, declared: o.writeModeDeclared, preconditionsMet };
        if (resolved === 'none' || !preconditionsMet) for (const tool of objectWriters(o.object)) excluded.add(tool);
    }
    const excludedWriters = [...excluded].sort();
    return { mode, excludedWriters, onlyNew: excludedWriters.filter(t => publishedTools.includes(t)), objects };
}
