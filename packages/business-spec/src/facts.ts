/**
 * Hechos de operación del tenant (schema §4.1): cada átomo de `applies_when` con su fuente única.
 * Un hecho no declarado toma el valor por defecto del perfil; sin valor por defecto, el requisito aplica
 * (falla segura) y CORE.IDENTITY.PROFILE pide declararlo.
 */
import type { ExprEnv } from './expr';
import { parseObjectRef } from './refs';
import { resolveValue } from './status';
import type { CompiledSpec, ProfileDef, TenantSnapshot } from './types';

/** Objetos con fecha u hora (schema §4.1, `any_object_reservable`). */
export const RESERVABLE_OBJECTS: ReadonlySet<string> = new Set([
    'appointment', 'lodging_booking', 'tour_booking', 'rental', 'photo_session', 'pet_boarding', 'enrollment', 'membership',
]);

export type WriteMode = 'direct_commit' | 'request_to_business' | 'none';

export interface TenantFacts extends ExprEnv {
    subtypeId: string | null;
    profile: ProfileDef | null;
    objects: { object: string; variant: string | null; declared: boolean }[];
    writeModes: Record<string, { mode: WriteMode; declared: boolean; paymentRequired: boolean; requiredFields: string[] }>;
    /** Hechos que el perfil no puede suplir y el dueño no declaró (hueco de CORE.IDENTITY.PROFILE). */
    undeclaredFacts: string[];
    sources: Record<string, 'declarado' | 'perfil' | 'derivado' | 'desconocido'>;
}

const WRITE_MODES = new Set<WriteMode>(['direct_commit', 'request_to_business', 'none']);
const asRecord = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {});

export function resolveFacts(spec: CompiledSpec, snap: TenantSnapshot, now: Date): TenantFacts {
    const sources: TenantFacts['sources'] = {};
    const pv = resolveValue(snap.values['CORE.IDENTITY.PROFILE'], now);
    const pval = pv.state === 'confirmado' ? asRecord(pv.record?.value) : {};
    const subtypeId: string | null = typeof pval.subtype === 'string' ? pval.subtype : null;
    const profileId: string | null = (typeof pval.profile === 'string' && spec.profiles[pval.profile] ? pval.profile : null)
        ?? (subtypeId ? spec.subtypeToProfile[subtypeId] ?? null : null);
    const profile = profileId ? spec.profiles[profileId] ?? null : null;
    const declared = asRecord(pval.operating_facts);
    const undeclaredFacts: string[] = [];

    // objetos habilitados
    let objects: TenantFacts['objects'];
    if (Array.isArray(pval.objects_enabled) && pval.objects_enabled.length) {
        objects = pval.objects_enabled.map((o: unknown) => {
            const ref = typeof o === 'string' ? parseObjectRef(o) : { object: String(asRecord(o).object), variant: asRecord(o).variant ?? null };
            return { ...ref, declared: true };
        }).filter((o: { object: string }) => spec.objects[o.object]);
        sources.objects_enabled = 'declarado';
    } else {
        objects = (profile?.objectsDefault ?? []).map(o => ({ ...o, declared: false }));
        sources.objects_enabled = profile ? 'perfil' : 'desconocido';
    }
    const enabled = objects.map(o => o.object);

    // modo de escritura por objeto
    const writeModes: TenantFacts['writeModes'] = {};
    for (const o of enabled) {
        const rv = resolveValue(snap.values[`OBJ.${o.toUpperCase()}.WRITE_MODE`], now);
        const v = rv.state === 'confirmado' ? asRecord(rv.record?.value) : {};
        const mode = WRITE_MODES.has(v.mode) ? v.mode as WriteMode : spec.objects[o].defaultWriteMode;
        writeModes[o] = {
            mode, declared: WRITE_MODES.has(v.mode), paymentRequired: v.payment_required_to_confirm === true,
            requiredFields: Array.isArray(v.required_fields) ? v.required_fields.map(String) : [],
        };
    }

    const defaults = profile?.operatingFactsDefaults ?? { modality: null, delivery_offered: null, has_prepayment: null };
    const pick = <T>(name: string, declaredValue: T | undefined, defaultValue: T | null, unknownValue: T): T => {
        if (declaredValue !== undefined && declaredValue !== null) { sources[name] = 'declarado'; return declaredValue; }
        if (defaultValue !== null && defaultValue !== undefined) { sources[name] = 'perfil'; return defaultValue; }
        sources[name] = 'desconocido';
        if (profile) undeclaredFacts.push(name);
        return unknownValue;
    };
    const modality = Array.isArray(declared.modality) ? declared.modality.map(String)
        : pick<string[] | null>('modality', undefined, defaults.modality, null);
    if (Array.isArray(declared.modality)) sources.modality = 'declarado';
    const deliveryOffered = pick<boolean>('delivery_offered', typeof declared.delivery_offered === 'boolean' ? declared.delivery_offered : undefined, defaults.delivery_offered, true);

    const timing = resolveValue(snap.values['CORE.PAYMENT.TIMING_DEPOSIT'], now);
    const timingWhen = timing.state === 'confirmado' ? asRecord(timing.record?.value).when : undefined;
    let hasPrepayment: boolean;
    if (typeof declared.has_prepayment === 'boolean') { hasPrepayment = declared.has_prepayment; sources.has_prepayment = 'declarado'; }
    else if (Object.values(writeModes).some(w => w.mode !== 'none' && w.paymentRequired) || timingWhen === 'al_reservar' || timingWhen === 'anticipo_parcial') {
        hasPrepayment = true; sources.has_prepayment = 'derivado';
    } else hasPrepayment = pick<boolean>('has_prepayment', undefined, defaults.has_prepayment, true);

    const hours = resolveValue(snap.values['CORE.HOURS.REGULAR'], now);
    const hoursAlwaysOpen = hours.state === 'confirmado' && asRecord(hours.record?.value).always_open === true;

    // dominios: incondicionales del perfil + condicionales cuyo hecho se declaró verdadero
    const domains = new Set<string>(profile?.domains ?? []);
    const cdfDeclared = asRecord(declared.conditional_domain_facts);
    for (const [fact, domain] of Object.entries(profile?.conditionalDomainFacts ?? {})) {
        if (typeof cdfDeclared[fact] === 'boolean') { sources[fact] = 'declarado'; if (cdfDeclared[fact]) domains.add(domain); }
        else { sources[fact] = 'desconocido'; undeclaredFacts.push(fact); }
    }

    const estimateRequired = (snap.items.service_request ?? []).some(i => i.active && i.fields.estimate_required === true);
    const booksByStaff = (writeModes.appointment?.requiredFields ?? []).some(f => /profesional|staff/i.test(f));

    return {
        subtypeId, profile, objects, writeModes, undeclaredFacts, sources,
        object: undefined,
        objectEnabled: (o: string) => enabled.includes(o),
        variant: (o: string) => objects.find(x => x.object === o)?.variant ?? null,
        writeMode: (o: string) => writeModes[o]?.mode ?? null,
        paymentRequired: (o: string) => writeModes[o]?.paymentRequired ?? false,
        availabilityKinds: (o: string) => spec.objects[o]?.availabilityKinds ?? [],
        enabledObjects: enabled,
        reservableObjects: RESERVABLE_OBJECTS,
        profileId,
        domains,
        modality,
        deliveryOffered,
        sellsGoods: enabled.includes('food_order') || enabled.includes('catalog_order'),
        hasPrepayment,
        hoursAlwaysOpen,
        staffCount: snap.staff.activeBookable,
        estimateRequired,
        booksByStaff,
        subtype: subtypeId ? subtypeId.split('/')[1] ?? subtypeId : null,
    };
}
