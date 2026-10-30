/**
 * Estado efectivo de un valor (schema §7.1–§7.3): precedencia entre fuentes, contradicción y caducidad.
 * Ausente, contradictorio y caducado se CALCULAN aquí; nunca se guardan (C0 §0.3).
 */
import { canonicalJson } from './hash';
import type { ItemRecord, TextRecord, ValueRecord, ValueState } from './types';

export interface ResolvedValue {
    state: ValueState;
    /** El registro que manda (confirmado de mayor precedencia, o el ejemplo/sembrado si no hay confirmado). */
    record: ValueRecord | null;
    /** Registros confirmados del mismo nivel con valores distintos. */
    conflicts: ValueRecord[];
    /** Confirmados de menor precedencia que dicen otra cosa (aviso de calidad, no contradicción). */
    shadowed: ValueRecord[];
}

/** §7.2: 1 integración y campo estructurado confirmado; 2 dato de plataforma (pack de país). */
function tier(origin: string): number {
    return origin === 'country_pack' ? 2 : 1;
}

export const ABSENT: ResolvedValue = Object.freeze({ state: 'ausente', record: null, conflicts: [], shadowed: [] }) as ResolvedValue;

export function resolveValue(records: readonly ValueRecord[] | undefined, now: Date, scopeKey = ''): ResolvedValue {
    const scoped = (records ?? []).filter(r => (r.scopeKey ?? '') === scopeKey);
    if (!scoped.length) return ABSENT;
    const expired = (r: ValueRecord) => Boolean(r.validUntil) && Date.parse(String(r.validUntil)) < now.getTime();
    const confirmed = scoped.filter(r => r.status === 'confirmed' && !expired(r));
    if (confirmed.length) {
        const top = Math.min(...confirmed.map(r => tier(r.origin)));
        const topRecords = confirmed.filter(r => tier(r.origin) === top)
            .sort((a, b) => String(b.confirmedAt ?? '').localeCompare(String(a.confirmedAt ?? '')));
        const distinct = new Map<string, ValueRecord>();
        for (const r of topRecords) if (!distinct.has(canonicalJson(r.value))) distinct.set(canonicalJson(r.value), r);
        const head = topRecords[0];
        const shadowed = confirmed.filter(r => tier(r.origin) > top && canonicalJson(r.value) !== canonicalJson(head.value));
        if (distinct.size > 1) return { state: 'contradictorio', record: null, conflicts: [...distinct.values()], shadowed };
        return { state: 'confirmado', record: head, conflicts: [], shadowed };
    }
    if (scoped.some(r => r.status === 'confirmed' && expired(r))) {
        return { state: 'caducado', record: scoped.find(r => r.status === 'confirmed') ?? null, conflicts: [], shadowed: [] };
    }
    const example = scoped.find(r => r.status === 'example');
    if (example) return { state: 'ejemplo', record: example, conflicts: [], shadowed: [] };
    return { state: 'sembrado', record: scoped.find(r => r.status === 'seeded') ?? null, conflicts: [], shadowed: [] };
}

/** Orígenes de los datos heredados (schema §7.5): lo deducido por L6/L7 y lo que la migración dejó escrito con ese origen. */
const INHERITED_ORIGINS = new Set(['legacy', 'legacy_inferred']);

/**
 * Valor confirmado que viene de datos heredados (L6/L7, o migrado con origin legacy o legacy_inferred): el panel
 * pide «dato heredado: confírmalo» (schema §7.5, C0 §2.9 L6).
 */
export const isInheritedRecord = (r: ValueRecord | null | undefined): boolean =>
    Boolean(r) && (r!.legacyRule === 'L6' || r!.legacyRule === 'L7' || INHERITED_ORIGINS.has(r!.origin));

/** Ítem que nadie escribió con el formulario nuevo: reglas L o procedencia migrada (sus listas vacías son el default de columna, L4). */
export const isInheritedItem = (i: ItemRecord): boolean =>
    i.legacyRule != null || INHERITED_ORIGINS.has(i.origin) || i.origin === 'platform_seed';

/** ¿El estado permite afirmar el valor al cliente? (§7.1) */
export const isAffirmable = (s: ValueState | null): boolean => s === 'confirmado';

// ─────────────────────────── textos (§7.3, §7.4) ───────────────────────────

/** Patrones de desvío: una FAQ que no dice nada y remite a otra conversación (schema §7.4). */
const DEFLECTION = [
    /cu[ée]ntame/i, /te confirm(o|amos)/i, /con gusto te (compart|cuent|ayud)/i, /\bdime\b/i, /ind[ií]ca(nos|me)/i,
    /escr[ií]be(nos|me)/i, /cont[aá]ctanos/i, /te (conecto|paso|comunico)/i, /consult(a|anos) (con|al)/i,
    /depende de/i, /cada (paquete|caso|tratamiento|servicio) es (distinto|diferente)/i, /te (asesoramos|orientamos)/i,
];

/** Números, horas, fechas o montos presentes en un texto (extractor determinista §7.3). */
export function extractFigures(text: string): string[] {
    return (String(text ?? '').match(/\d{1,2}:\d{2}|\$?\s?\d[\d.,]*\s?(%|h|horas?|d[ií]as?|min(utos)?|cop|usd|k)?/gi) ?? [])
        .map(s => s.trim().toLowerCase()).filter(s => /\d/.test(s));
}

/** Un texto «sin dato»: patrón de desvío y ninguna cifra, o demasiado corto para afirmar algo. */
export function isTextWithoutData(text: string): boolean {
    const t = String(text ?? '').trim();
    if (t.length < 25) return true;
    return DEFLECTION.some(re => re.test(t)) && extractFigures(t).length === 0;
}

/** Evidencia de texto confirmada y con dato para un requisito con `accepts_text_evidence` (§7.2.5). */
export function textEvidenceFor(texts: readonly TextRecord[], requirementId: string): TextRecord | null {
    return texts.find(t => t.published && t.status === 'confirmed' && (t.covers ?? []).includes(requirementId) && !isTextWithoutData(t.body)) ?? null;
}
