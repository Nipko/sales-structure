/**
 * Las 10 primitivas de schema §9 y el contexto de un evaluador.
 * existe · estado = confirmado · vacío_confirmado · cuenta ≥ n · todos · ninguno · válido · sin_contradicción ·
 * no_caducado · ref_cumple
 */
import type { TenantFacts } from '../facts';
import type { ResolvedValue } from '../status';
import type {
    CompiledRequirement, CompiledSpec, GapCause, ItemRecord, Level, RequirementResult, StoredStatus, TenantSnapshot, ValueState,
} from '../types';

export interface Outcome {
    result: Exclude<RequirementResult, 'n/a'>;
    cause?: GapCause;
    ratio?: { ok: number; total: number };
    /** Para `predicate_by_level`: resultado de cada umbral. */
    levelResults?: Partial<Record<Level, 'cumple' | 'parcial' | 'no_cumple'>>;
    detail?: string;
    /** Placeholders del gap_message ({n}, {m}, {campos}, {objeto}…). */
    params?: Record<string, string | number>;
    /** Si falla SOLO porque falla otro requisito (ref_cumple o pack por REGION), su ID (schema §9, causa raíz). */
    rootCause?: string;
    warnings?: string[];
}

export interface EvalContext {
    req: CompiledRequirement;
    spec: CompiledSpec;
    snap: TenantSnapshot;
    now: Date;
    facts: TenantFacts;
    /** Parámetros de overrides activos (p. ej. `required_topics`). */
    params: Record<string, unknown>;
    /** Valor resuelto del propio requisito (alcance global). */
    value: ResolvedValue;
    valueOf(id: string): ResolvedValue;
    /** ref_cumple: resultado de otro requisito (null si no aplica al tenant). */
    resultOf(id: string): RequirementResult | null;
}

export type Evaluator = (ctx: EvalContext) => Outcome;

// ─────────────────────────── primitivas ───────────────────────────

export function get(obj: unknown, path: string): unknown {
    let cur: unknown = obj;
    for (const key of path.split('.')) {
        if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[key];
    }
    return cur;
}

/** existe(campo): no nulo y no texto vacío. Una lista vacía SÍ existe (vacío confirmado, §5). */
export function exists(v: unknown): boolean {
    if (v === undefined || v === null) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    return true;
}

export const nonEmptyList = (v: unknown): v is unknown[] => Array.isArray(v) && v.length > 0;
export const asObject = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {});
export const asList = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** estado(campo) = confirmado. */
export const confirmed = (rv: ResolvedValue): boolean => rv.state === 'confirmado';
/** Valor confirmado (o {} si no lo está). */
export const cval = (rv: ResolvedValue): Record<string, any> => (confirmed(rv) ? asObject(rv.record?.value) : {});

/** Causa del hueco a partir del estado del valor. */
export function causeOf(state: ValueState): GapCause {
    return state === 'confirmado' ? 'parcial' : state;
}

export const fail = (rv: ResolvedValue, detail?: string, extra: Partial<Outcome> = {}): Outcome =>
    ({ result: 'no_cumple', cause: causeOf(rv.state), ...(detail ? { detail } : {}), ...extra });
export const ok = (detail?: string, extra: Partial<Outcome> = {}): Outcome => ({ result: 'cumple', ...(detail ? { detail } : {}), ...extra });

/** cuenta/todos sobre una lista: cumple al 100 %, parcial si hay alguno, no cumple si ninguno o lista vacía. */
export function ratioOutcome(okCount: number, total: number, emptyCause: GapCause = 'ausente', extra: Partial<Outcome> = {}): Outcome {
    if (total === 0) return { result: 'no_cumple', cause: emptyCause, ratio: { ok: 0, total: 0 }, ...extra };
    if (okCount === total) return { result: 'cumple', ratio: { ok: okCount, total }, ...extra };
    return { result: okCount > 0 ? 'parcial' : 'no_cumple', cause: 'parcial', ratio: { ok: okCount, total }, ...extra };
}

/** Un ítem cuenta como dato del negocio si no es ejemplo ni sembrado (§7.1). */
export const itemConfirmed = (i: ItemRecord): boolean => i.contentStatus === 'confirmed';
/** Estado de un campo concreto del ítem (L4: el valor por defecto de columna es sembrado). */
export const fieldStatus = (i: ItemRecord, field: string): StoredStatus => i.fieldStatus?.[field] ?? i.contentStatus;

export const activeItems = (ctx: EvalContext, object: string): ItemRecord[] => (ctx.snap.items[object] ?? []).filter(i => i.active);

/** Objetos habilitados del tenant que tienen catálogo (plantilla CATALOG). */
export const catalogObjects = (ctx: EvalContext): string[] =>
    ctx.facts.enabledObjects.filter(o => ctx.spec.objects[o]?.templateApplies.includes('CATALOG'));

/** ref_cumple(ID): true si cumple o no aplica (un requisito n/a no bloquea a quien depende de él). */
export const refOk = (ctx: EvalContext, id: string): boolean => {
    const r = ctx.resultOf(id);
    return r === null || r === 'cumple';
};

/** no_caducado por edad de confirmación. */
export function olderThanDays(iso: string | null | undefined, days: number, now: Date): boolean {
    if (!iso) return true;
    return now.getTime() - Date.parse(iso) > days * 86_400_000;
}

/** Nombre visible del objeto para los mensajes. */
export const OBJECT_NOUNS: Readonly<Record<string, { records: string; items: string; item: string }>> = {
    appointment: { records: 'citas', items: 'servicios', item: 'servicio' },
    food_order: { records: 'pedidos', items: 'platos', item: 'plato' },
    catalog_order: { records: 'pedidos', items: 'productos', item: 'producto' },
    lodging_booking: { records: 'reservas', items: 'alojamientos', item: 'alojamiento' },
    tour_booking: { records: 'reservas', items: 'tours', item: 'tour' },
    real_estate: { records: 'visitas', items: 'inmuebles', item: 'inmueble' },
    enrollment: { records: 'inscripciones', items: 'cursos', item: 'curso' },
    membership: { records: 'membresías', items: 'planes', item: 'plan' },
    insurance: { records: 'pólizas', items: 'productos de seguro', item: 'producto de seguro' },
    service_request: { records: 'solicitudes', items: 'servicios', item: 'servicio' },
    rental: { records: 'alquileres', items: 'vehículos', item: 'vehículo' },
    pet_boarding: { records: 'reservas', items: 'servicios', item: 'servicio' },
    photo_session: { records: 'sesiones', items: 'paquetes', item: 'paquete' },
    professional_case: { records: 'casos', items: 'áreas de práctica', item: 'área de práctica' },
    lead: { records: 'solicitudes', items: 'solicitudes', item: 'solicitud' },
};
