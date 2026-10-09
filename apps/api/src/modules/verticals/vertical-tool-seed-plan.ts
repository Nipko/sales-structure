import type { ResolvedVerticalCapabilityManifest } from '@parallext/shared';

/**
 * Plan de familias de herramientas que el alta de un negocio deja encendidas.
 *
 * Antes el alta llevaba su propia tabla (`toolsByIndustry` + un `if` por
 * subtipo) y el manifiesto de capacidades llevaba la suya. Eran dos fuentes de
 * verdad para lo mismo y divergieron en silencio: el manifiesto le daba a
 * `automotriz/alquiler` la familia `vehicleRentals` y a `pet_services/guarderia`
 * y `/hotel` la familia `petBoarding` ("el agente veía el objeto en el menú y no
 * tenía con qué reservarlo"), pero la tabla del alta no las conocía, así que
 * ningún negocio nacía con ellas. Nada fallaba: la familia faltante simplemente
 * no existía en el agente.
 *
 * Ahora el manifiesto es la única fuente. Agregar una familia a un subtipo en
 * `vertical-capability-manifest.ts` basta para que el alta la encienda y para
 * que `assertProvisioningInvariants` la exija; la prueba
 * `vertical-tool-seed-plan.spec.ts` recorre los perfiles del catálogo para que
 * ese contrato no vuelva a divergir.
 */

/**
 * `appointments` no se enciende aquí: depende de que el alta haya podido sembrar
 * servicios y horarios (`restoreAppointmentsTool`). `faqs` lo enciende el paso
 * de conocimiento. Ambos siguen siendo parte de lo que el agente debe tener
 * (ver `requiredToolFamilies`).
 */
const HANDLED_BY_OTHER_STEPS = new Set<string>(['appointments', 'faqs']);

export interface VerticalToolSeedPlan {
    /** Familias que `seedVerticalTools` enciende en todos los agentes activos. */
    enable: string[];
    /** Familias heredadas que el subtipo NO opera y se apagan. */
    disable: string[];
}

export function planVerticalToolSeed(
    manifest: Pick<ResolvedVerticalCapabilityManifest, 'industry' | 'toolGroups'>,
    extraTools: readonly string[] = [],
): VerticalToolSeedPlan {
    const enable = new Set<string>(extraTools);
    for (const group of manifest.toolGroups) {
        if (!HANDLED_BY_OTHER_STEPS.has(group)) enable.add(group);
    }
    // Repuestos y taller heredan `vehicles` de la industria en la plantilla del
    // agente; su manifiesto lo quita porque operan pedidos de repuestos y
    // órdenes de reparación, no inventario de concesionario.
    const disable = manifest.industry === 'automotriz' && !manifest.toolGroups.includes('vehicles')
        ? ['vehicles']
        : [];
    return { enable: [...enable], disable };
}

/** Todo lo que `assertProvisioningInvariants` exige encendido en cada agente. */
export function requiredToolFamilies(
    manifest: Pick<ResolvedVerticalCapabilityManifest, 'industry' | 'toolGroups'>,
    effectiveBooking: boolean,
    extraTools: readonly string[] = [],
): string[] {
    const required = new Set<string>(['faqs', ...extraTools, ...planVerticalToolSeed(manifest, extraTools).enable]);
    if (effectiveBooking) required.add('appointments');
    return [...required];
}
