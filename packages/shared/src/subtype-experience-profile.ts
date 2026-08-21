import {
    VERTICAL_CAPABILITY_MANIFEST_VERSION,
    resolveVerticalCapabilityManifest,
    type ResolvedVerticalCapabilityManifest,
    type VerticalManifestIndustry,
} from './vertical-capability-manifest';

/**
 * The single registry for what a subtype IS.
 *
 * The selector offered 75 subtypes over roughly 27 effective profiles: a label
 * a tenant picked at signup that changed almost nothing downstream. Meanwhile
 * every surface answered "what is this business" on its own — the manifest knew
 * capabilities, the persona resolver knew a template, the sidebar knew routes,
 * marketing knew a claim, and none of them agreed.
 *
 * This registry is the one answer. It deliberately does NOT restate what the
 * capability manifest already owns (capabilities, tool groups, primary object,
 * routes, readiness keys, assurance): those are COMPOSED at resolve time, so a
 * change lands in one place. What lives here is the commercial and governance
 * truth the manifest has no opinion about — how far this profile may be sold,
 * whether it may be sold at all, what it explicitly does not promise, and the
 * audited evidence behind that decision.
 *
 * The plan's own risk register warns about "76 forks": the moment a difference
 * can live in a shared component, it must not live in 76 entries.
 */

export const SUBTYPE_EXPERIENCE_PROFILE_VERSION = 1 as const;

/** How Parallly delivers this profile. */
export type SubtypeStrategy =
    /** Build it natively. */
    | 'build'
    /** Integrate the system of record; do not rebuild it. */
    | 'integrate'
    /** Native experience over an integrated record. */
    | 'hybrid'
    /** Product/taxonomy decision missing. */
    | 'define'
    /**
     * The taxonomy question is answered and this id now resolves elsewhere.
     *
     * Distinct from `stop`: a migrated profile IS sellable — as the experience
     * it should always have been. Marking it blocked would contradict its own
     * alias and hide a working product behind a scary word.
     */
    | 'migrate'
    /** Not commercialised: selling it would promise what we cannot deliver. */
    | 'stop';

/**
 * How far this profile may be sold TODAY. Not an aspiration — the claim
 * marketing and the agent are both allowed to make.
 */
export type SubtypeScope =
    /** Capture and route interest. */
    | 'captacion'
    /** Qualify against declared criteria. */
    | 'calificacion'
    /** Produce a quote or proposal. */
    | 'cotizacion'
    /** Coordinate real work without owning the record. */
    | 'coordinacion'
    /** Operate natively: the agent creates and changes real objects. */
    | 'operacion_ligera'
    /** Operate against an integrated system of record. */
    | 'operacion_integrada';

/**
 * Audit alerts carried forward verbatim, so a reader can trace a decision to
 * the finding that produced it.
 *
 * `STOP` not commercialisable · `MISCLASS` wrong taxonomy · `SOR` no system of
 * record · `REG` regulated · `CAP` capacity/resources missing · `PAY` payments
 * missing · `LIVE` no live data · `UX` dead end · `WRITER` no writer ·
 * `SEC` security · `E2E` no end-to-end evidence.
 */
export type SubtypeAlert =
    | 'STOP' | 'MISCLASS' | 'SOR' | 'REG' | 'CAP'
    | 'PAY' | 'LIVE' | 'UX' | 'WRITER' | 'SEC' | 'E2E';

/**
 * Si este perfil se puede ELEGIR hoy, en un alta nueva.
 *
 * Es un eje distinto de `strategy`, y mezclarlos fue el error del primer
 * intento: `strategy` dice CÓMO se entrega (nativo, integrado, migrado) y es
 * una decisión de producto; esto dice si el selector lo ofrece. Un perfil
 * `migrate` es perfectamente vendible —es la experiencia que siempre debió
 * ser—, y un perfil `build` puede estar en piloto mientras se termina.
 *
 * `legacy_only` es lo que hace posible cerrar la puerta sin romper a nadie: el
 * tenant que ya está adentro sigue resolviendo su perfil, conserva su producto
 * y NO se lo migra en silencio. Simplemente no entran más.
 */
export type SubtypeAvailability =
    /** Cualquiera lo elige en el alta. */
    | 'selectable'
    /** Solo por invitación: lo habilita un super_admin al crear el tenant. */
    | 'pilot'
    /** Hay demanda registrada y todavía no producto. Nadie lo elige. */
    | 'waitlist'
    /** Cerrado a altas nuevas. Los tenants existentes siguen operando igual. */
    | 'legacy_only';

export interface SubtypeExperienceProfileEntry {
    industry: VerticalManifestIndustry;
    /** `__none__` for the industry-level `otro` configuration. */
    subtype: string;
    strategy: SubtypeStrategy;
    /** 0 decide · 1 honesty/P0 · 2 native depth · 3 integration · 4 regulated. */
    wave: 0 | 1 | 2 | 3 | 4;
    scope: SubtypeScope;
    alerts: readonly SubtypeAlert[];
    /** Sector reference the audit measured against. */
    benchmark: string;
    primaryGap: string;
    /** 0-100 from the August competitive audit. Evidence, not a target. */
    auditedReadiness: number;
    auditedDemand: number;
    /** A/B/C confidence of that audit. */
    auditConfidence: string;
    /** What this profile explicitly does not promise. */
    exclusions: readonly string[];
    /**
     * Si el selector lo ofrece hoy. Omitido = derivado: un perfil `stop` es
     * `legacy_only` y cualquier otro es `selectable`. Se declara explícito solo
     * cuando la respuesta NO se deduce de la estrategia — un piloto, o una
     * espera con demanda registrada.
     */
    availability?: SubtypeAvailability;
    /** Present only when `strategy === 'stop'`. */
    blockedReason?: string;
    /** Present only when `strategy === 'migrate'`: the canonical profile id. */
    migratesTo?: string;
    /** Why this id moved, kept with the tenant's migration record. */
    migrationNote?: string;
}

/**
 * Legacy ids kept resolvable so no tenant silently changes product.
 *
 * A migration moves the EXPERIENCE; the id a tenant was created with keeps
 * resolving, because changing what a business is without telling them is worse
 * than carrying an alias.
 */
export const SUBTYPE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
    // Grooming is a Pet Services business. It lived under Veterinaria and
    // inherited a clinical persona, vaccination rules and a "patient journey".
    'veterinaria/peluqueria_canina': 'pet_services/peluqueria',
    // `fotografia/wedding_planner` is NOT aliased on purpose. A wedding planner
    // is not a photographer — it received the full photography product and none
    // of its own objects — but Event Planning does not exist yet as an industry,
    // so there is nowhere honest to send it. Pointing it back at photography
    // would re-create the misclassification an alias is supposed to fix.

    // Pre-manifest ids that must never return to the selector.
    'moda_belleza/boutique': 'retail/moda',
    'pet_services/tienda': 'retail/moda',
    'restaurantes/delivery': 'restaurantes/comida_rapida',
});

/**
 * `satisfies` (not a type annotation) so every literal is checked against the
 * entry contract while the ids stay literal for `SubtypeExperienceProfileId`.
 * The exported binding is widened to the interface, because iterating a union
 * of 76 literal shapes is unusable — `Object.values()` would give a union whose
 * only common members are the ones every profile happens to share.
 */
const PROFILES = Object.freeze({
    'salud/dental': {
        industry: 'salud',
        subtype: 'dental',
        strategy: 'hybrid',
        wave: 3,
        scope: 'operacion_integrada',
        alerts: ['SOR', 'REG', 'CAP', 'PAY', 'E2E'],
        benchmark: 'NexHealth',
        primaryGap: 'PMS/EHR, consentimientos, sillón/staff, recall y pagos',
        auditedReadiness: 47,
        auditedDemand: 87,
        auditConfidence: 'A',
        exclusions: ['expediente clinico', 'diagnostico', 'prescripcion'],
    },
    'salud/medica_general': {
        industry: 'salud',
        subtype: 'medica_general',
        strategy: 'integrate',
        wave: 4,
        scope: 'coordinacion',
        alerts: ['STOP', 'SOR', 'REG', 'CAP', 'E2E'],
        benchmark: 'Pabau',
        primaryGap: 'Solo agenda; falta EHR, intake clínico y recursos',
        auditedReadiness: 38,
        auditedDemand: 75,
        auditConfidence: 'B',
        exclusions: ['expediente clinico', 'diagnostico', 'prescripcion'],
    },
    'salud/dermatologia': {
        industry: 'salud',
        subtype: 'dermatologia',
        strategy: 'hybrid',
        wave: 4,
        scope: 'operacion_integrada',
        alerts: ['SOR', 'REG', 'CAP', 'PAY', 'UX', 'E2E'],
        benchmark: 'Pabau',
        primaryGap: 'Fotos clínicas, consentimiento, EMR, lotes y recursos',
        auditedReadiness: 43,
        auditedDemand: 86,
        auditConfidence: 'A',
        exclusions: ['expediente clinico', 'diagnostico', 'prescripcion'],
    },
    'salud/psicologia': {
        industry: 'salud',
        subtype: 'psicologia',
        strategy: 'integrate',
        wave: 4,
        scope: 'coordinacion',
        alerts: ['SOR', 'REG', 'PAY', 'E2E'],
        benchmark: 'SimplePractice',
        primaryGap: 'EHR protegido, notas, telehealth y protocolo de crisis',
        auditedReadiness: 40,
        auditedDemand: 86,
        auditConfidence: 'A',
        exclusions: ['expediente clinico', 'diagnostico', 'prescripcion'],
    },
    'salud/farmacia': {
        industry: 'salud',
        subtype: 'farmacia',
        strategy: 'hybrid',
        wave: 1,
        scope: 'operacion_ligera',
        alerts: ['STOP', 'SOR', 'REG', 'LIVE', 'PAY', 'UX', 'E2E'],
        benchmark: 'PioneerRx',
        primaryGap: 'Catálogo OTC no cubre receta, lotes, validación ni dispensación',
        auditedReadiness: 30,
        auditedDemand: 65,
        auditConfidence: 'B',
        exclusions: ['expediente clinico', 'diagnostico', 'prescripcion'],
    },
    'moda_belleza/salon_belleza': {
        industry: 'moda_belleza',
        subtype: 'salon_belleza',
        strategy: 'build',
        wave: 2,
        scope: 'operacion_ligera',
        alerts: ['CAP', 'PAY', 'UX', 'E2E'],
        benchmark: 'Zenoti',
        primaryGap: 'Staff/resources UI, POS, comisiones, paquetes y rebooking',
        auditedReadiness: 42,
        auditedDemand: 84,
        auditConfidence: 'A',
        exclusions: ['expediente clinico', 'promesa de resultado'],
    },
    'moda_belleza/barberia': {
        industry: 'moda_belleza',
        subtype: 'barberia',
        strategy: 'build',
        wave: 2,
        scope: 'operacion_ligera',
        alerts: ['CAP', 'PAY', 'UX', 'E2E'],
        benchmark: 'SQUIRE',
        primaryGap: 'Cola/walk-in, silla, membresía, tips/comisión y POS',
        auditedReadiness: 41,
        auditedDemand: 75,
        auditConfidence: 'B',
        exclusions: ['expediente clinico', 'promesa de resultado'],
    },
    'moda_belleza/spa': {
        industry: 'moda_belleza',
        subtype: 'spa',
        strategy: 'build',
        wave: 2,
        scope: 'operacion_ligera',
        alerts: ['CAP', 'PAY', 'UX', 'WRITER', 'E2E'],
        benchmark: 'Zenoti',
        primaryGap: 'Cabina/equipo, multiservicio, paquetes, POS e inventario',
        auditedReadiness: 43,
        auditedDemand: 85,
        auditConfidence: 'A',
        exclusions: ['expediente clinico', 'promesa de resultado'],
    },
    'moda_belleza/estetica': {
        industry: 'moda_belleza',
        subtype: 'estetica',
        strategy: 'hybrid',
        wave: 4,
        scope: 'coordinacion',
        alerts: ['SOR', 'REG', 'CAP', 'PAY', 'UX', 'E2E'],
        benchmark: 'Pabau',
        primaryGap: 'EMR, consentimientos, fotos clínicas, lotes y protocolos',
        auditedReadiness: 45,
        auditedDemand: 88,
        auditConfidence: 'A',
        exclusions: ['expediente clinico', 'promesa de resultado'],
    },
    'inmobiliaria/venta': {
        industry: 'inmobiliaria',
        subtype: 'venta',
        strategy: 'hybrid',
        wave: 1,
        scope: 'calificacion',
        alerts: ['LIVE', 'UX', 'SOR', 'E2E'],
        benchmark: 'Lofty',
        primaryGap: 'Fotos no cargables en Listings; feed vivo y transacción',
        auditedReadiness: 52,
        auditedDemand: 84,
        auditConfidence: 'A',
        exclusions: ['avaluo', 'cierre de escritura'],
    },
    'inmobiliaria/arriendo': {
        industry: 'inmobiliaria',
        subtype: 'arriendo',
        strategy: 'hybrid',
        wave: 3,
        scope: 'calificacion',
        alerts: ['LIVE', 'UX', 'SOR', 'PAY', 'REG', 'E2E'],
        benchmark: 'AppFolio',
        primaryGap: 'Aplicación, screening, contrato, depósito y mantenimiento',
        auditedReadiness: 48,
        auditedDemand: 84,
        auditConfidence: 'A',
        exclusions: ['avaluo', 'cierre de escritura'],
    },
    'inmobiliaria/comercial': {
        industry: 'inmobiliaria',
        subtype: 'comercial',
        strategy: 'integrate',
        wave: 3,
        scope: 'captacion',
        alerts: ['STOP', 'SOR', 'LIVE', 'UX', 'E2E'],
        benchmark: 'Buildout',
        primaryGap: 'Espacios/unidades, comps, documentos, propietarios y deal room',
        auditedReadiness: 39,
        auditedDemand: 70,
        auditConfidence: 'B',
        exclusions: ['avaluo', 'cierre de escritura'],
    },
    'inmobiliaria/construccion': {
        industry: 'inmobiliaria',
        subtype: 'construccion',
        strategy: 'stop',
        wave: 0,
        scope: 'captacion',
        alerts: ['STOP', 'MISCLASS', 'SOR', 'PAY', 'E2E'],
        benchmark: 'Buildertrend',
        primaryGap: 'Ambigüedad promotor vs constructor; falta proyecto de obra',
        auditedReadiness: 29,
        auditedDemand: 60,
        auditConfidence: 'C',
        exclusions: ['avaluo', 'cierre de escritura'],
        blockedReason: 'Taxonomia sin resolver: promotor de proyecto nuevo y contratista de obra '
            + 'son dos negocios con objetos, ciclos y compradores distintos. '
            + '`business_model` es obligatorio antes de escribir prompt, variables o '
            + 'menu.',
    },
    'restaurantes/casual_dining': {
        industry: 'restaurantes',
        subtype: 'casual_dining',
        strategy: 'hybrid',
        wave: 2,
        scope: 'operacion_ligera',
        alerts: ['SOR', 'LIVE', 'CAP', 'PAY', 'E2E'],
        benchmark: 'SevenRooms',
        primaryGap: 'Mesa/turno/waitlist, POS/KDS, depósitos y guest CRM',
        auditedReadiness: 48,
        auditedDemand: 74,
        auditConfidence: 'A',
        exclusions: ['POS/KDS propio', 'contabilidad'],
    },
    'restaurantes/comida_rapida': {
        industry: 'restaurantes',
        subtype: 'comida_rapida',
        strategy: 'hybrid',
        wave: 2,
        scope: 'operacion_ligera',
        alerts: ['SOR', 'LIVE', 'PAY', 'E2E'],
        benchmark: 'Toast',
        primaryGap: 'POS/KDS, modificadores, pago, delivery y conciliación',
        auditedReadiness: 50,
        auditedDemand: 76,
        auditConfidence: 'A',
        exclusions: ['POS/KDS propio', 'contabilidad'],
    },
    'restaurantes/cafeteria': {
        industry: 'restaurantes',
        subtype: 'cafeteria',
        strategy: 'build',
        wave: 2,
        scope: 'operacion_ligera',
        alerts: ['SOR', 'LIVE', 'PAY', 'E2E'],
        benchmark: 'Lightspeed',
        primaryGap: 'Variantes, cola/ETA, POS, loyalty e inventario de ingredientes',
        auditedReadiness: 46,
        auditedDemand: 70,
        auditConfidence: 'B',
        exclusions: ['POS/KDS propio', 'contabilidad'],
    },
    'restaurantes/dark_kitchen': {
        industry: 'restaurantes',
        subtype: 'dark_kitchen',
        strategy: 'integrate',
        wave: 3,
        scope: 'operacion_ligera',
        alerts: ['SOR', 'LIVE', 'CAP', 'PAY', 'E2E'],
        benchmark: 'Deliverect',
        primaryGap: 'Agregadores, multi-marca, POS/KDS, dispatch y conciliación',
        auditedReadiness: 49,
        auditedDemand: 77,
        auditConfidence: 'A',
        exclusions: ['POS/KDS propio', 'contabilidad'],
    },
    'automotriz/concesionario': {
        industry: 'automotriz',
        subtype: 'concesionario',
        strategy: 'hybrid',
        wave: 3,
        scope: 'calificacion',
        alerts: ['SOR', 'LIVE', 'REG', 'PAY', 'E2E'],
        benchmark: 'Tekion',
        primaryGap: 'DMS/VIN vivo, trade-in, F&I, documentos y compra',
        auditedReadiness: 50,
        auditedDemand: 75,
        auditConfidence: 'A',
        exclusions: ['DMS propio', 'diagnostico mecanico'],
    },
    'automotriz/taller': {
        industry: 'automotriz',
        subtype: 'taller',
        strategy: 'hybrid',
        wave: 3,
        scope: 'coordinacion',
        alerts: ['STOP', 'MISCLASS', 'SOR', 'CAP', 'PAY', 'E2E'],
        benchmark: 'Shopmonkey',
        primaryGap: 'Repair order, inspección, estimate, aprobación, partes y bahía',
        auditedReadiness: 30,
        auditedDemand: 75,
        auditConfidence: 'A',
        exclusions: ['DMS propio', 'diagnostico mecanico'],
    },
    'automotriz/repuestos': {
        industry: 'automotriz',
        subtype: 'repuestos',
        strategy: 'hybrid',
        wave: 1,
        scope: 'operacion_ligera',
        alerts: ['SOR', 'LIVE', 'PAY', 'E2E'],
        benchmark: 'PartsTech',
        primaryGap: 'Fitment VIN, proveedores, backorder, devolución y garantía',
        auditedReadiness: 38,
        auditedDemand: 68,
        auditConfidence: 'B',
        exclusions: ['DMS propio', 'diagnostico mecanico'],
    },
    'automotriz/alquiler': {
        industry: 'automotriz',
        subtype: 'alquiler',
        strategy: 'build',
        wave: 1,
        scope: 'operacion_ligera',
        alerts: ['STOP', 'WRITER', 'CAP', 'LIVE', 'PAY', 'REG', 'E2E'],
        benchmark: 'HQ Rental Software',
        primaryGap: 'No writer IA; intervalo, elegibilidad, depósito, contrato y daños',
        auditedReadiness: 27,
        auditedDemand: 66,
        auditConfidence: 'B',
        exclusions: ['DMS propio', 'diagnostico mecanico'],
    },
    'turismo/agencia_viajes': {
        industry: 'turismo',
        subtype: 'agencia_viajes',
        strategy: 'hybrid',
        wave: 3,
        scope: 'cotizacion',
        alerts: ['STOP', 'MISCLASS', 'SOR', 'LIVE', 'PAY', 'E2E'],
        benchmark: 'Travefy',
        primaryGap: 'Itinerario/propuesta, proveedores, cotización viva y comisión',
        auditedReadiness: 39,
        auditedDemand: 68,
        auditConfidence: 'B',
        exclusions: ['PMS hotelero propio', 'emision de tiquetes'],
    },
    'turismo/hotel': {
        industry: 'turismo',
        subtype: 'hotel',
        strategy: 'hybrid',
        wave: 1,
        scope: 'operacion_ligera',
        alerts: ['SOR', 'LIVE', 'CAP', 'PAY', 'E2E'],
        benchmark: 'Cloudbeds',
        primaryGap: 'PMS/channel manager, room types, rates, folio y housekeeping',
        auditedReadiness: 49,
        auditedDemand: 84,
        auditConfidence: 'A',
        exclusions: ['PMS hotelero propio', 'emision de tiquetes'],
    },
    'turismo/tours': {
        industry: 'turismo',
        subtype: 'tours',
        strategy: 'build',
        wave: 1,
        scope: 'operacion_ligera',
        alerts: ['CAP', 'LIVE', 'PAY', 'UX', 'E2E'],
        benchmark: 'Rezdy',
        primaryGap: 'Pago posconfirmación, recursos, manifest, pickup, waiver y OTA',
        auditedReadiness: 52,
        auditedDemand: 74,
        auditConfidence: 'B',
        exclusions: ['PMS hotelero propio', 'emision de tiquetes'],
    },
    'turismo/alquiler_vacacional': {
        industry: 'turismo',
        subtype: 'alquiler_vacacional',
        strategy: 'hybrid',
        wave: 1,
        scope: 'operacion_ligera',
        alerts: ['SOR', 'LIVE', 'PAY', 'REG', 'E2E'],
        benchmark: 'Guesty',
        primaryGap: 'Channel manager API, fees, verificación, tareas y owner accounting',
        auditedReadiness: 51,
        auditedDemand: 86,
        auditConfidence: 'A',
        exclusions: ['PMS hotelero propio', 'emision de tiquetes'],
    },
    'education/idiomas': {
        industry: 'education',
        subtype: 'idiomas',
        strategy: 'build',
        wave: 2,
        scope: 'operacion_ligera',
        alerts: ['CAP', 'PAY', 'SOR', 'E2E'],
        benchmark: 'Teachworks',
        primaryGap: 'Cohortes/niveles, recurrencia, asistencia, docente y progreso',
        auditedReadiness: 43,
        auditedDemand: 76,
        auditConfidence: 'A',
        exclusions: ['LMS propio', 'decision de admision'],
    },
    'education/universitaria': {
        industry: 'education',
        subtype: 'universitaria',
        strategy: 'integrate',
        wave: 3,
        scope: 'captacion',
        alerts: ['STOP', 'MISCLASS', 'SOR', 'REG', 'PAY', 'E2E'],
        benchmark: 'Element451',
        primaryGap: 'Admissions applicant-to-student, documentos, SIS/LMS y decisión',
        auditedReadiness: 25,
        auditedDemand: 65,
        auditConfidence: 'B',
        exclusions: ['LMS propio', 'decision de admision'],
    },
    'education/online': {
        industry: 'education',
        subtype: 'online',
        strategy: 'hybrid',
        wave: 3,
        scope: 'coordinacion',
        alerts: ['STOP', 'SOR', 'PAY', 'E2E'],
        benchmark: 'Thinkific',
        primaryGap: 'Contenido, acceso, progreso, evaluación, certificado y commerce',
        auditedReadiness: 30,
        auditedDemand: 70,
        auditConfidence: 'B',
        exclusions: ['LMS propio', 'decision de admision'],
    },
    'education/capacitacion': {
        industry: 'education',
        subtype: 'capacitacion',
        strategy: 'build',
        wave: 2,
        scope: 'cotizacion',
        alerts: ['SOR', 'CAP', 'PAY', 'E2E'],
        benchmark: 'Arlo',
        primaryGap: 'Empresa/cohorte, logística, factura, asistencia y certificación',
        auditedReadiness: 35,
        auditedDemand: 72,
        auditConfidence: 'B',
        exclusions: ['LMS propio', 'decision de admision'],
    },
    'finanzas/asesoria': {
        industry: 'finanzas',
        subtype: 'asesoria',
        strategy: 'integrate',
        wave: 4,
        scope: 'calificacion',
        alerts: ['STOP', 'SOR', 'REG', 'LIVE', 'E2E'],
        benchmark: 'Salesforce FSC',
        primaryGap: 'Household, riesgo, KYC, portafolio vivo, consentimiento y auditoría',
        auditedReadiness: 24,
        auditedDemand: 62,
        auditConfidence: 'B',
        exclusions: ['asesoria de inversion', 'decision crediticia', 'core financiero'],
    },
    'finanzas/fintech': {
        industry: 'finanzas',
        subtype: 'fintech',
        strategy: 'stop',
        wave: 0,
        scope: 'captacion',
        alerts: ['STOP', 'MISCLASS', 'SOR', 'REG', 'LIVE', 'E2E'],
        benchmark: 'Mambu+Alloy',
        primaryGap: 'No hay producto concreto, ledger, KYC/AML, riesgo ni disputas',
        auditedReadiness: 17,
        auditedDemand: 55,
        auditConfidence: 'C',
        exclusions: ['asesoria de inversion', 'decision crediticia', 'core financiero'],
        blockedReason: '"Fintech" no es un producto: pagos, wallet, remesas, neobanco e inversion '
            + 'tienen licencias, ledgers y riesgos incompatibles. Taxonomia, gating y '
            + 'contratos existen; el perfil no se comercializa hasta elegir familia.',
    },
    'finanzas/creditos': {
        industry: 'finanzas',
        subtype: 'creditos',
        strategy: 'integrate',
        wave: 4,
        scope: 'calificacion',
        alerts: ['STOP', 'SOR', 'REG', 'LIVE', 'PAY', 'E2E'],
        benchmark: 'Blend',
        primaryGap: 'Solicitud, documentos, buró, underwriting, oferta y desembolso',
        auditedReadiness: 20,
        auditedDemand: 67,
        auditConfidence: 'B',
        exclusions: ['asesoria de inversion', 'decision crediticia', 'core financiero'],
    },
    'servicios_profesionales/abogados': {
        industry: 'servicios_profesionales',
        subtype: 'abogados',
        strategy: 'hybrid',
        wave: 3,
        scope: 'captacion',
        alerts: ['STOP', 'SOR', 'REG', 'PAY', 'UX', 'E2E'],
        benchmark: 'Clio',
        primaryGap: 'Conflict check, matter, documentos, plazos, retainer y facturación',
        auditedReadiness: 27,
        auditedDemand: 68,
        auditConfidence: 'B',
        exclusions: ['asesoria juridica', 'representacion', 'declaracion fiscal'],
    },
    'servicios_profesionales/contadores': {
        industry: 'servicios_profesionales',
        subtype: 'contadores',
        strategy: 'hybrid',
        wave: 3,
        scope: 'coordinacion',
        alerts: ['STOP', 'SOR', 'REG', 'PAY', 'E2E'],
        benchmark: 'TaxDome',
        primaryGap: 'Entidad/periodo, portal, documentos, recurring workflow y fiscal',
        auditedReadiness: 25,
        auditedDemand: 70,
        auditConfidence: 'B',
        exclusions: ['asesoria juridica', 'representacion', 'declaracion fiscal'],
    },
    'servicios_profesionales/arquitectos': {
        industry: 'servicios_profesionales',
        subtype: 'arquitectos',
        strategy: 'integrate',
        wave: 3,
        scope: 'captacion',
        alerts: ['STOP', 'MISCLASS', 'SOR', 'PAY', 'E2E'],
        benchmark: 'Monograph',
        primaryGap: 'Proyecto/fases, entregables, recursos, horas, invoice y margen',
        auditedReadiness: 19,
        auditedDemand: 55,
        auditConfidence: 'C',
        exclusions: ['asesoria juridica', 'representacion', 'declaracion fiscal'],
    },
    'servicios_profesionales/consultores': {
        industry: 'servicios_profesionales',
        subtype: 'consultores',
        strategy: 'hybrid',
        wave: 3,
        scope: 'captacion',
        alerts: ['STOP', 'SOR', 'CAP', 'PAY', 'E2E'],
        benchmark: 'Scoro',
        primaryGap: 'SOW, proyecto, staffing, tiempo/gasto, retainer y rentabilidad',
        auditedReadiness: 22,
        auditedDemand: 60,
        auditConfidence: 'C',
        exclusions: ['asesoria juridica', 'representacion', 'declaracion fiscal'],
    },
    'retail/moda': {
        industry: 'retail',
        subtype: 'moda',
        strategy: 'build',
        wave: 1,
        scope: 'operacion_ligera',
        alerts: ['SOR', 'LIVE', 'PAY', 'E2E'],
        benchmark: 'Shopify',
        primaryGap: 'Variantes, stock por ubicación, checkout, fulfillment y devoluciones',
        auditedReadiness: 39,
        auditedDemand: 72,
        auditConfidence: 'A',
        exclusions: ['ERP propio', 'contabilidad'],
    },
    'retail/electronica': {
        industry: 'retail',
        subtype: 'electronica',
        strategy: 'build',
        wave: 1,
        scope: 'operacion_ligera',
        alerts: ['SOR', 'LIVE', 'PAY', 'E2E'],
        benchmark: 'Lightspeed',
        primaryGap: 'Specs/compatibilidad, serial, garantía, RMA y servicio',
        auditedReadiness: 36,
        auditedDemand: 68,
        auditConfidence: 'B',
        exclusions: ['ERP propio', 'contabilidad'],
    },
    'retail/hogar': {
        industry: 'retail',
        subtype: 'hogar',
        strategy: 'build',
        wave: 1,
        scope: 'operacion_ligera',
        alerts: ['SOR', 'LIVE', 'CAP', 'PAY', 'E2E'],
        benchmark: 'Shopify',
        primaryGap: 'Dimensiones/configuración, entrega/instalación y special order',
        auditedReadiness: 38,
        auditedDemand: 66,
        auditConfidence: 'B',
        exclusions: ['ERP propio', 'contabilidad'],
    },
    'retail/marketplace': {
        industry: 'retail',
        subtype: 'marketplace',
        strategy: 'stop',
        wave: 0,
        scope: 'captacion',
        alerts: ['STOP', 'MISCLASS', 'SOR', 'REG', 'PAY', 'E2E'],
        benchmark: 'Mirakl',
        primaryGap: 'Seller/KYB, catálogo multi-vendor, comisión, payout y disputas',
        auditedReadiness: 18,
        auditedDemand: 60,
        auditConfidence: 'C',
        exclusions: ['ERP propio', 'contabilidad'],
        blockedReason: 'Operar un marketplace exige merchant of record, alta de vendedores con '
            + 'KYB, orden multi-vendedor, comision, payout y disputas. Reutilizar el '
            + 'comercio monovendedor produciria ordenes que nadie puede liquidar.',
    },
    'technology/saas': {
        industry: 'technology',
        subtype: 'saas',
        strategy: 'hybrid',
        wave: 3,
        scope: 'calificacion',
        alerts: ['STOP', 'SOR', 'LIVE', 'REG', 'E2E'],
        benchmark: 'Intercom Fin',
        primaryGap: 'Identidad/entitlement, billing, telemetry, ticket y acciones seguras',
        auditedReadiness: 29,
        auditedDemand: 70,
        auditConfidence: 'B',
        exclusions: ['ticketing propio', 'entrega de software'],
    },
    'technology/consultoria_ti': {
        industry: 'technology',
        subtype: 'consultoria_ti',
        strategy: 'stop',
        wave: 0,
        scope: 'captacion',
        alerts: ['STOP', 'SOR', 'CAP', 'PAY', 'E2E'],
        benchmark: 'ConnectWise PSA',
        primaryGap: 'Ticket/SLA, activos, dispatch, contrato, proyecto y billing',
        auditedReadiness: 22,
        auditedDemand: 55,
        auditConfidence: 'C',
        exclusions: ['ticketing propio', 'entrega de software'],
        blockedReason: 'Mesa de servicio MSP y consultoria por proyectos son dos productos: uno '
            + 'vive de SLA y activos, el otro de alcance y entregables. Elegir antes de '
            + 'construir.',
    },
    'technology/desarrollo': {
        industry: 'technology',
        subtype: 'desarrollo',
        strategy: 'integrate',
        wave: 3,
        scope: 'captacion',
        alerts: ['STOP', 'SOR', 'CAP', 'PAY', 'E2E'],
        benchmark: 'Productive',
        primaryGap: 'Scope, backlog/milestones, capacidad, cambios, aceptación y Jira/Git',
        auditedReadiness: 20,
        auditedDemand: 53,
        auditConfidence: 'C',
        exclusions: ['ticketing propio', 'entrega de software'],
    },
    'technology/hardware': {
        industry: 'technology',
        subtype: 'hardware',
        strategy: 'build',
        wave: 1,
        scope: 'operacion_ligera',
        alerts: ['SOR', 'LIVE', 'PAY', 'E2E'],
        benchmark: 'Cin7',
        primaryGap: 'Compatibilidad, serial, multi-bodega, fulfillment, warranty/RMA',
        auditedReadiness: 35,
        auditedDemand: 62,
        auditConfidence: 'C',
        exclusions: ['ticketing propio', 'entrega de software'],
    },
    'veterinaria/clinica_general': {
        industry: 'veterinaria',
        subtype: 'clinica_general',
        strategy: 'hybrid',
        wave: 3,
        scope: 'coordinacion',
        alerts: ['SOR', 'REG', 'LIVE', 'PAY', 'E2E'],
        benchmark: 'ezyVet',
        primaryGap: 'PIMS/EMR, consentimientos, órdenes, inventario y facturación',
        auditedReadiness: 41,
        auditedDemand: 72,
        auditConfidence: 'B',
        exclusions: ['historia clinica', 'diagnostico', 'prescripcion'],
    },
    'veterinaria/hospital_24h': {
        industry: 'veterinaria',
        subtype: 'hospital_24h',
        strategy: 'integrate',
        wave: 4,
        scope: 'coordinacion',
        alerts: ['STOP', 'SOR', 'REG', 'CAP', 'LIVE', 'E2E'],
        benchmark: 'Instinct',
        primaryGap: 'Triage, cola ER, camas, treatment sheets y guardias reales',
        auditedReadiness: 29,
        auditedDemand: 68,
        auditConfidence: 'B',
        exclusions: ['historia clinica', 'diagnostico', 'prescripcion'],
    },
    'veterinaria/exoticos': {
        industry: 'veterinaria',
        subtype: 'exoticos',
        strategy: 'integrate',
        wave: 4,
        scope: 'coordinacion',
        alerts: ['STOP', 'SOR', 'REG', 'CAP', 'E2E'],
        benchmark: 'ezyVet',
        primaryGap: 'Especie, rangos/protocolos, especialista, hábitat y PIMS',
        auditedReadiness: 34,
        auditedDemand: 55,
        auditConfidence: 'C',
        exclusions: ['historia clinica', 'diagnostico', 'prescripcion'],
    },
    'veterinaria/peluqueria_canina': {
        industry: 'veterinaria',
        subtype: 'peluqueria_canina',
        strategy: 'migrate',
        migratesTo: 'pet_services/peluqueria',
        wave: 0,
        scope: 'operacion_ligera',
        alerts: ['MISCLASS', 'CAP', 'PAY', 'E2E'],
        benchmark: 'MoeGo',
        primaryGap: 'Duplicado de pet grooming; hereda herramientas clínicas',
        auditedReadiness: 35,
        auditedDemand: 65,
        auditConfidence: 'B',
        exclusions: ['historia clinica', 'diagnostico', 'prescripcion'],
        migrationNote: 'Heredaba persona clinica veterinaria, reglas de vacunacion y un '
            + '"patient journey" que no son de este negocio. La experiencia canonica es '
            + 'Pet Services / peluqueria; este id sigue resolviendo por alias para no '
            + 'cambiarle el producto a nadie en silencio.',
    },
    'gimnasios/gimnasio_general': {
        industry: 'gimnasios',
        subtype: 'gimnasio_general',
        strategy: 'build',
        wave: 2,
        scope: 'operacion_ligera',
        alerts: ['LIVE', 'CAP', 'PAY', 'UX', 'E2E'],
        benchmark: 'Glofox',
        primaryGap: 'Billing/dunning, check-in/access, waivers y entitlement',
        auditedReadiness: 48,
        auditedDemand: 78,
        auditConfidence: 'A',
        exclusions: ['prescripcion de ejercicio', 'promesa de resultado fisico'],
    },
    'gimnasios/crossfit': {
        industry: 'gimnasios',
        subtype: 'crossfit',
        strategy: 'build',
        wave: 2,
        scope: 'operacion_ligera',
        alerts: ['SOR', 'CAP', 'PAY', 'E2E'],
        benchmark: 'Wodify',
        primaryGap: 'WOD, PRs, benchmarks, leaderboard y performance history',
        auditedReadiness: 42,
        auditedDemand: 77,
        auditConfidence: 'A',
        exclusions: ['prescripcion de ejercicio', 'promesa de resultado fisico'],
    },
    'gimnasios/yoga_pilates': {
        industry: 'gimnasios',
        subtype: 'yoga_pilates',
        strategy: 'build',
        wave: 2,
        scope: 'operacion_ligera',
        alerts: ['CAP', 'PAY', 'UX', 'E2E'],
        benchmark: 'Mariana Tek',
        primaryGap: 'Sala/reformer/spot, waitlist, packs y booking visual',
        auditedReadiness: 43,
        auditedDemand: 80,
        auditConfidence: 'A',
        exclusions: ['prescripcion de ejercicio', 'promesa de resultado fisico'],
    },
    'gimnasios/cycling': {
        industry: 'gimnasios',
        subtype: 'cycling',
        strategy: 'build',
        wave: 2,
        scope: 'operacion_ligera',
        alerts: ['CAP', 'LIVE', 'PAY', 'UX', 'E2E'],
        benchmark: 'Mariana Tek',
        primaryGap: 'Bike/spot map, preferencias, waitlist y mantenimiento',
        auditedReadiness: 39,
        auditedDemand: 70,
        auditConfidence: 'B',
        exclusions: ['prescripcion de ejercicio', 'promesa de resultado fisico'],
    },
    'gimnasios/martial_arts': {
        industry: 'gimnasios',
        subtype: 'martial_arts',
        strategy: 'build',
        wave: 2,
        scope: 'operacion_ligera',
        alerts: ['REG', 'CAP', 'PAY', 'E2E'],
        benchmark: 'Zen Planner',
        primaryGap: 'Family/minors, belt/skill, currículo, evaluación y billing',
        auditedReadiness: 36,
        auditedDemand: 73,
        auditConfidence: 'B',
        exclusions: ['prescripcion de ejercicio', 'promesa de resultado fisico'],
    },
    'seguros/broker': {
        industry: 'seguros',
        subtype: 'broker',
        strategy: 'hybrid',
        wave: 4,
        scope: 'calificacion',
        alerts: ['SOR', 'REG', 'LIVE', 'PAY', 'E2E'],
        benchmark: 'Applied Epic',
        primaryGap: 'AMS/carriers, submissions, bind, renewal, comisión y documentos',
        auditedReadiness: 39,
        auditedDemand: 74,
        auditConfidence: 'A',
        exclusions: ['suscripcion', 'ajuste de siniestro', 'cobertura vinculante'],
    },
    'seguros/aseguradora': {
        industry: 'seguros',
        subtype: 'aseguradora',
        strategy: 'stop',
        wave: 4,
        scope: 'captacion',
        alerts: ['STOP', 'MISCLASS', 'SOR', 'REG', 'LIVE', 'E2E'],
        benchmark: 'Guidewire',
        primaryGap: 'Underwriting, PAS, billing, claims, reservas y reaseguro',
        auditedReadiness: 19,
        auditedDemand: 58,
        auditConfidence: 'C',
        exclusions: ['suscripcion', 'ajuste de siniestro', 'cobertura vinculante'],
        blockedReason: 'Una carrier necesita PAS, billing y claims con autoridad de suscripcion. '
            + 'Parallly es capa conversacional sobre esos sistemas, nunca su reemplazo.',
    },
    'seguros/vida': {
        industry: 'seguros',
        subtype: 'vida',
        strategy: 'integrate',
        wave: 4,
        scope: 'captacion',
        alerts: ['STOP', 'SOR', 'REG', 'LIVE', 'E2E'],
        benchmark: 'Equisoft',
        primaryGap: 'Beneficiarios, illustration, evidence, underwriting, emisión y claim',
        auditedReadiness: 32,
        auditedDemand: 72,
        auditConfidence: 'B',
        exclusions: ['suscripcion', 'ajuste de siniestro', 'cobertura vinculante'],
    },
    'seguros/auto': {
        industry: 'seguros',
        subtype: 'auto',
        strategy: 'integrate',
        wave: 4,
        scope: 'calificacion',
        alerts: ['SOR', 'REG', 'LIVE', 'PAY', 'E2E'],
        benchmark: 'Applied Epic+Guidewire',
        primaryGap: 'Vehículo/conductor, rating, bind, fotos FNOL y red de taller',
        auditedReadiness: 34,
        auditedDemand: 74,
        auditConfidence: 'B',
        exclusions: ['suscripcion', 'ajuste de siniestro', 'cobertura vinculante'],
    },
    'seguros/salud': {
        industry: 'seguros',
        subtype: 'salud',
        strategy: 'stop',
        wave: 4,
        scope: 'captacion',
        alerts: ['STOP', 'SOR', 'REG', 'LIVE', 'E2E'],
        benchmark: 'Salesforce Digital Insurance',
        primaryGap: 'Miembro/dependiente, red, elegibilidad, autorización, claim/EOB',
        auditedReadiness: 30,
        auditedDemand: 70,
        auditConfidence: 'B',
        exclusions: ['suscripcion', 'ajuste de siniestro', 'cobertura vinculante'],
        blockedReason: 'Elegibilidad, autorizaciones y EOB son PHI con verificacion reforzada y '
            + 'core del pagador. Sin ese sistema no hay respuesta correcta que dar.',
    },
    'servicios_hogar/plomeria': {
        industry: 'servicios_hogar',
        subtype: 'plomeria',
        strategy: 'build',
        wave: 2,
        scope: 'operacion_ligera',
        alerts: ['SOR', 'CAP', 'LIVE', 'PAY', 'E2E'],
        benchmark: 'ServiceTitan',
        primaryGap: 'Dispatch, skill, ETA, pricebook, work order, partes y factura',
        auditedReadiness: 33,
        auditedDemand: 75,
        auditConfidence: 'B',
        exclusions: ['garantia de obra', 'permisos'],
    },
    'servicios_hogar/electricidad': {
        industry: 'servicios_hogar',
        subtype: 'electricidad',
        strategy: 'build',
        wave: 2,
        scope: 'operacion_ligera',
        alerts: ['REG', 'CAP', 'LIVE', 'PAY', 'E2E'],
        benchmark: 'ServiceTitan',
        primaryGap: 'Routing seguro, certificación, inspección, estimate y dispatch',
        auditedReadiness: 31,
        auditedDemand: 72,
        auditConfidence: 'B',
        exclusions: ['garantia de obra', 'permisos'],
    },
    'servicios_hogar/fumigacion': {
        industry: 'servicios_hogar',
        subtype: 'fumigacion',
        strategy: 'hybrid',
        wave: 3,
        scope: 'coordinacion',
        alerts: ['STOP', 'SOR', 'REG', 'CAP', 'PAY', 'E2E'],
        benchmark: 'FieldRoutes',
        primaryGap: 'Recurrencia, rutas, licencia, químicos/lotes y compliance',
        auditedReadiness: 27,
        auditedDemand: 70,
        auditConfidence: 'B',
        exclusions: ['garantia de obra', 'permisos'],
    },
    'servicios_hogar/limpieza': {
        industry: 'servicios_hogar',
        subtype: 'limpieza',
        strategy: 'build',
        wave: 2,
        scope: 'operacion_ligera',
        alerts: ['CAP', 'LIVE', 'PAY', 'E2E'],
        benchmark: 'Jobber',
        primaryGap: 'Scope/checklist, recurrencia, crew/route, QA e invoice',
        auditedReadiness: 30,
        auditedDemand: 74,
        auditConfidence: 'B',
        exclusions: ['garantia de obra', 'permisos'],
    },
    'servicios_hogar/jardineria': {
        industry: 'servicios_hogar',
        subtype: 'jardineria',
        strategy: 'build',
        wave: 2,
        scope: 'operacion_ligera',
        alerts: ['CAP', 'LIVE', 'PAY', 'E2E'],
        benchmark: 'Jobber',
        primaryGap: 'Sitio, recurrencia estacional, crew/equipo, route y job costing',
        auditedReadiness: 28,
        auditedDemand: 68,
        auditConfidence: 'B',
        exclusions: ['garantia de obra', 'permisos'],
    },
    'servicios_hogar/cerrajeria': {
        industry: 'servicios_hogar',
        subtype: 'cerrajeria',
        strategy: 'build',
        wave: 2,
        scope: 'operacion_ligera',
        alerts: ['STOP', 'REG', 'CAP', 'LIVE', 'PAY', 'E2E'],
        benchmark: 'Housecall Pro',
        primaryGap: 'Verificar autoridad, dispatch 24h, ETA, pricebook y auditoría',
        auditedReadiness: 25,
        auditedDemand: 63,
        auditConfidence: 'C',
        exclusions: ['garantia de obra', 'permisos'],
    },
    'servicios_hogar/pintura': {
        industry: 'servicios_hogar',
        subtype: 'pintura',
        strategy: 'build',
        wave: 2,
        scope: 'cotizacion',
        alerts: ['CAP', 'PAY', 'E2E'],
        benchmark: 'Jobber',
        primaryGap: 'Medición/estimate, proyecto multi-día, crew, cambios y milestones',
        auditedReadiness: 29,
        auditedDemand: 67,
        auditConfidence: 'B',
        exclusions: ['garantia de obra', 'permisos'],
    },
    'pet_services/peluqueria': {
        industry: 'pet_services',
        subtype: 'peluqueria',
        strategy: 'build',
        wave: 1,
        scope: 'operacion_ligera',
        alerts: ['CAP', 'PAY', 'UX', 'E2E'],
        benchmark: 'MoeGo',
        primaryGap: 'Ficha grooming, groomer/bather, media, depósito y recurrencia',
        auditedReadiness: 40,
        auditedDemand: 72,
        auditConfidence: 'B',
        exclusions: ['diagnostico veterinario', 'garantia de conducta'],
    },
    'pet_services/guarderia': {
        industry: 'pet_services',
        subtype: 'guarderia',
        strategy: 'build',
        wave: 1,
        scope: 'operacion_ligera',
        alerts: ['STOP', 'WRITER', 'CAP', 'LIVE', 'REG', 'PAY', 'E2E'],
        benchmark: 'MoeGo',
        primaryGap: 'Availability cuenta objeto equivocado; no writer ni capacidad atómica',
        auditedReadiness: 27,
        auditedDemand: 68,
        auditConfidence: 'B',
        exclusions: ['diagnostico veterinario', 'garantia de conducta'],
    },
    'pet_services/hotel': {
        industry: 'pet_services',
        subtype: 'hotel',
        strategy: 'build',
        wave: 1,
        scope: 'operacion_ligera',
        alerts: ['STOP', 'WRITER', 'CAP', 'LIVE', 'REG', 'PAY', 'E2E'],
        benchmark: 'MoeGo',
        primaryGap: 'Kennel/noches, no writer, alimentación/meds, contrato y depósito',
        auditedReadiness: 25,
        auditedDemand: 69,
        auditConfidence: 'B',
        exclusions: ['diagnostico veterinario', 'garantia de conducta'],
    },
    'pet_services/paseos': {
        industry: 'pet_services',
        subtype: 'paseos',
        strategy: 'build',
        wave: 2,
        scope: 'coordinacion',
        alerts: ['SOR', 'CAP', 'LIVE', 'REG', 'PAY', 'E2E'],
        benchmark: 'Time To Pet',
        primaryGap: 'Recurrencia, ruta/GPS, acceso, walker, proof of service y reemplazo',
        auditedReadiness: 31,
        auditedDemand: 65,
        auditConfidence: 'B',
        exclusions: ['diagnostico veterinario', 'garantia de conducta'],
    },
    'pet_services/adiestramiento': {
        industry: 'pet_services',
        subtype: 'adiestramiento',
        strategy: 'build',
        wave: 2,
        scope: 'coordinacion',
        alerts: ['CAP', 'REG', 'PAY', 'E2E'],
        benchmark: 'Gingr',
        primaryGap: 'Evaluación, programa, prerequisitos, progreso y paquetes',
        auditedReadiness: 29,
        auditedDemand: 63,
        auditConfidence: 'C',
        exclusions: ['diagnostico veterinario', 'garantia de conducta'],
    },
    'fotografia/estudio': {
        industry: 'fotografia',
        subtype: 'estudio',
        strategy: 'build',
        wave: 1,
        scope: 'cotizacion',
        alerts: ['UX', 'CAP', 'PAY', 'SOR', 'E2E'],
        benchmark: 'Pixieset',
        primaryGap: 'Paquetes no sembrados, recursos, hold, contrato y galería',
        auditedReadiness: 33,
        auditedDemand: 64,
        auditConfidence: 'B',
        exclusions: ['DAM propio', 'cesion de derechos'],
    },
    'fotografia/bodas': {
        industry: 'fotografia',
        subtype: 'bodas',
        strategy: 'build',
        wave: 2,
        scope: 'cotizacion',
        alerts: ['UX', 'CAP', 'PAY', 'E2E'],
        benchmark: 'HoneyBook',
        primaryGap: 'Fecha exclusiva, timeline, contrato/retainer, equipo y entrega',
        auditedReadiness: 31,
        auditedDemand: 72,
        auditConfidence: 'B',
        exclusions: ['DAM propio', 'cesion de derechos'],
    },
    'fotografia/eventos': {
        industry: 'fotografia',
        subtype: 'eventos',
        strategy: 'build',
        wave: 2,
        scope: 'cotizacion',
        alerts: ['UX', 'CAP', 'PAY', 'E2E'],
        benchmark: 'HoneyBook',
        primaryGap: 'Venue/cobertura/equipo, SLA, contrato y factura B2B',
        auditedReadiness: 30,
        auditedDemand: 68,
        auditConfidence: 'B',
        exclusions: ['DAM propio', 'cesion de derechos'],
    },
    'fotografia/producto': {
        industry: 'fotografia',
        subtype: 'producto',
        strategy: 'hybrid',
        wave: 3,
        scope: 'cotizacion',
        alerts: ['STOP', 'MISCLASS', 'SOR', 'PAY', 'E2E'],
        benchmark: 'Pixieset+DAM',
        primaryGap: 'Brief/SKU, lotes, revisión/aprobación, derechos y assets versionados',
        auditedReadiness: 26,
        auditedDemand: 60,
        auditConfidence: 'C',
        exclusions: ['DAM propio', 'cesion de derechos'],
    },
    'fotografia/wedding_planner': {
        industry: 'fotografia',
        subtype: 'wedding_planner',
        strategy: 'stop',
        wave: 0,
        scope: 'captacion',
        alerts: ['STOP', 'MISCLASS', 'SOR', 'PAY', 'E2E'],
        benchmark: 'Aisle Planner',
        primaryGap: 'Recibe fotografía; faltan evento, budget, vendors, timeline e invitados',
        auditedReadiness: 11,
        auditedDemand: 70,
        auditConfidence: 'B',
        exclusions: ['DAM propio', 'cesion de derechos'],
        blockedReason: 'Recibe el producto de fotografia completo, que no es su negocio: un '
            + 'planner opera evento, presupuesto, proveedores, invitados y seating. Migra '
            + 'a Event Planning.',
    },
    'otro/__none__': {
        industry: 'otro',
        subtype: '__none__',
        strategy: 'define',
        wave: 0,
        scope: 'captacion',
        alerts: ['STOP', 'MISCLASS', 'UX', 'E2E'],
        benchmark: 'Zoho Custom Modules',
        primaryGap: 'Catálogo por defecto; faltan módulos/objetos/pipelines configurables',
        auditedReadiness: 25,
        auditedDemand: 50,
        auditConfidence: 'C',
        exclusions: ['tienda automatica', 'cualquier objeto no declarado'],
    },
}) satisfies Readonly<Record<string, SubtypeExperienceProfileEntry>>;

export const SUBTYPE_EXPERIENCE_PROFILES: Readonly<Record<string, SubtypeExperienceProfileEntry>> = PROFILES;

export type SubtypeExperienceProfileId = keyof typeof PROFILES;

/**
 * A subtype resolved into everything the platform knows about it.
 *
 * `capability` is the live manifest projection, not a copy: capabilities, tool
 * groups, routes and readiness keys have exactly one definition.
 */
export interface ResolvedSubtypeExperienceProfile extends SubtypeExperienceProfileEntry {
    version: typeof SUBTYPE_EXPERIENCE_PROFILE_VERSION;
    id: string;
    manifestVersion: typeof VERTICAL_CAPABILITY_MANIFEST_VERSION;
    capability: ResolvedVerticalCapabilityManifest;
    /** False when selling this profile would promise what we cannot deliver. */
    commercialisable: boolean;
    /** Disponibilidad efectiva: la declarada, o la derivada de la estrategia. */
    availability: SubtypeAvailability;
}

export function subtypeProfileId(industry: string, subtype?: string | null): string {
    const sub = String(subtype || '').trim() || '__none__';
    return `${industry}/${sub}`;
}

/**
 * Resolve a profile, following an alias when the id is a legacy one.
 *
 * Throws on an unknown id rather than falling back: a silent fallback is how a
 * tenant ends up running a product nobody chose for them.
 */
export function resolveSubtypeExperienceProfile(
    industry: string,
    subtype?: string | null,
): ResolvedSubtypeExperienceProfile {
    const requested = subtypeProfileId(industry, subtype);
    const id = SUBTYPE_ALIASES[requested] ?? requested;
    const entry = SUBTYPE_EXPERIENCE_PROFILES[id];
    if (!entry) throw new Error(`Unknown subtype experience profile: ${requested}`);

    const capability = resolveVerticalCapabilityManifest(
        entry.industry,
        entry.subtype === '__none__' ? undefined : entry.subtype,
    );
    return {
        ...entry,
        version: SUBTYPE_EXPERIENCE_PROFILE_VERSION,
        id,
        manifestVersion: VERTICAL_CAPABILITY_MANIFEST_VERSION,
        capability,
        // Reads the RESOLVED entry, so a migrated id inherits the target's
        // answer rather than its own historical one.
        commercialisable: entry.strategy !== 'stop',
        availability: subtypeAvailability(entry),
    };
}

/**
 * La disponibilidad efectiva de un perfil.
 *
 * Derivar `stop → legacy_only` en vez de anotar las siete entradas a mano es lo
 * que impide que un perfil bloqueado nuevo aparezca en el selector porque
 * alguien se olvidó de agregarle el campo. Fail-closed por defecto, con la
 * declaración explícita como excepción.
 */
export function subtypeAvailability(
    entry: Pick<SubtypeExperienceProfileEntry, 'strategy' | 'availability'>,
): SubtypeAvailability {
    if (entry.availability) return entry.availability;
    return entry.strategy === 'stop' ? 'legacy_only' : 'selectable';
}

/** Las disponibilidades que pueden elegirse en cada superficie de alta. */
export const SIGNUP_AVAILABILITY: readonly SubtypeAvailability[] =
    Object.freeze(['selectable']);
/** Un super_admin además puede poner a un tenant en un piloto. */
export const ADMIN_CREATE_AVAILABILITY: readonly SubtypeAvailability[] =
    Object.freeze(['selectable', 'pilot']);

/** Every canonical profile id. 76: 18 verticals, 75 subtypes and `otro`. */
export function listSubtypeExperienceProfileIds(): string[] {
    return Object.keys(SUBTYPE_EXPERIENCE_PROFILES);
}

/** Profiles that must not be sold yet, with the reason. */
export function listBlockedSubtypeProfiles(): SubtypeExperienceProfileEntry[] {
    return Object.values(SUBTYPE_EXPERIENCE_PROFILES).filter(p => p.strategy === 'stop');
}
