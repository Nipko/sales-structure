/**
 * Validación de un valor de negocio contra la especificación compilada (C0 §2.1): la usa `BusinessFactsService.write()`
 * antes de cada escritura en `requirement_values`, y la migración antes de copiar un valor heredado.
 *
 * Puro y determinista. `data.structure` de cada requisito es la forma del valor: un mapa campo → descripción, o una
 * descripción de lista. De la descripción se leen solo las partes normativas que no dejan lugar a interpretación:
 * `requerido`, `bool`, `enum [a, b]` y `enum_list [a, b]` cerrados (sin «…»). El resto de las reglas de
 * `data.validation` (prosa) las aplica el evaluador del requisito al calcular la preparación, no la escritura.
 */
import { MIGRATION_ORIGINS, PROVENANCE_ORIGINS, STORED_STATUSES } from './provenance';
import type { CompiledRequirement, CompiledSpec, StoredStatus } from './types';

export interface ValueIssue {
    /** Campo del valor (`''` = el valor entero). */
    path: string;
    code: 'unknown_requirement' | 'not_writable' | 'origin' | 'status' | 'scope' | 'shape' | 'required' | 'enum' | 'type' | 'size';
    message: string;
}

export interface ValueWriteInput {
    value: unknown;
    status: StoredStatus;
    origin: string;
    scopeKey?: string;
}

/** Tamaño máximo del valor serializado: un valor de negocio no es un documento. */
export const MAX_VALUE_BYTES = 64 * 1024;

/** Campos extra que admite cada tipo (C0 §2.3): las políticas migradas guardan su texto en `summary`; el horario, su zona. */
const TYPE_EXTRA_KEYS: Readonly<Record<string, readonly string[]>> = {
    policy_terms: ['summary', 'title'],
    weekly_hours: ['timezone'],
};

/** origen → fuente de `sources.allowed` (schema §4). */
const ORIGIN_SOURCE: Readonly<Record<string, string>> = {
    owner_form: 'owner_form', pending_answer: 'owner_form', copilot: 'copilot_approved', import: 'import',
    integration: 'integration', country_pack: 'country_pack',
};

const SCOPE = /^(|location:[^\s]+|object:[a-z_]+|item:[^\s]+)$/;

const isPlainObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim());
const closedList = (s: string): string[] | null => {
    if (/…|\.\.\./.test(s)) return null;
    return s.split(',').map(x => x.trim()).filter(Boolean);
};

/** ¿Se guarda en `requirement_values`? Los catálogos viven en sus tablas y los derivados no los escribe nadie. */
export function isValueRequirement(req: CompiledRequirement): boolean {
    const type = String(req.data?.type ?? '');
    return !req.derived && !req.platform && type !== 'derived' && !type.startsWith('item_list') && !type.startsWith('campos del objeto');
}

function checkField(path: string, desc: string, v: unknown, issues: ValueIssue[]): void {
    if (blank(v)) return;
    const d = desc.trim();
    const en = d.match(/^enum \[([^\]]*)\]/);
    if (en) {
        const allowed = closedList(en[1]);
        if (allowed && !allowed.includes(String(v))) issues.push({ path, code: 'enum', message: `${path} debe ser uno de: ${allowed.join(', ')}` });
        return;
    }
    const enl = d.match(/^enum_list \[([^\]]*)\]/);
    if (enl) {
        if (!Array.isArray(v)) { issues.push({ path, code: 'type', message: `${path} debe ser una lista` }); return; }
        const allowed = closedList(enl[1]);
        const bad = allowed ? v.filter(x => !allowed.includes(String(x))) : [];
        if (bad.length) issues.push({ path, code: 'enum', message: `${path}: valores fuera de la lista (${bad.join(', ')})` });
        return;
    }
    if (/^bool\b/.test(d) && typeof v !== 'boolean') issues.push({ path, code: 'type', message: `${path} debe ser sí/no (booleano)` });
}

/**
 * Problemas del valor (lista vacía = válido). `origin=default_accepted` acepta `value = null`: el valor es el default
 * de la plataforma para la `spec_version` guardada (C0 §2.5).
 */
export function validateRequirementValue(spec: CompiledSpec, requirementId: string, input: ValueWriteInput): ValueIssue[] {
    const req = spec.requirements[requirementId];
    if (!req) return [{ path: '', code: 'unknown_requirement', message: `requisito desconocido: ${requirementId}` }];
    const issues: ValueIssue[] = [];
    if (!isValueRequirement(req)) {
        return [{ path: '', code: 'not_writable', message: `${requirementId} no se guarda como valor del negocio (catálogo, derivado o dato de plataforma)` }];
    }
    if (!(PROVENANCE_ORIGINS as readonly string[]).includes(input.origin)) {
        issues.push({ path: '', code: 'origin', message: `origen desconocido: ${input.origin}` });
    } else if (input.origin === 'default_accepted') {
        if (req.predicateKind !== 'default_accepted') issues.push({ path: '', code: 'origin', message: `${requirementId} no tiene un valor por defecto que aceptar` });
    } else if (!MIGRATION_ORIGINS.has(input.origin)) {
        const source = ORIGIN_SOURCE[input.origin];
        if (!source || !req.sources.allowed.includes(source)) {
            issues.push({ path: '', code: 'origin', message: `${requirementId} no admite el origen ${input.origin} (fuentes: ${req.sources.allowed.join(', ')})` });
        }
    }
    if (!STORED_STATUSES.includes(input.status)) issues.push({ path: '', code: 'status', message: `estado inválido: ${input.status}` });
    // «sembrado» es un hecho de la plataforma, nunca de una persona (C0 §0.3)
    if ((input.status === 'seeded') !== (input.origin === 'platform_seed')) {
        issues.push({ path: '', code: 'status', message: 'solo la siembra de la plataforma escribe valores sembrados' });
    }
    if (!SCOPE.test(String(input.scopeKey ?? ''))) issues.push({ path: '', code: 'scope', message: `alcance inválido: ${input.scopeKey}` });

    const v = input.value;
    if (input.origin === 'default_accepted' && v === null) return issues;
    if (v === undefined || v === null) {
        issues.push({ path: '', code: 'shape', message: 'falta el valor (una lista vacía [] es «no hay», confirmado)' });
        return issues;
    }
    let size = 0;
    try { size = JSON.stringify(v).length; } catch { issues.push({ path: '', code: 'shape', message: 'el valor no es JSON' }); return issues; }
    if (size > MAX_VALUE_BYTES) issues.push({ path: '', code: 'size', message: `el valor supera ${MAX_VALUE_BYTES} bytes` });

    const structure = req.data?.structure;
    const type = String(req.data?.type ?? '');
    if (isPlainObject(structure)) {
        if (!isPlainObject(v)) {
            issues.push({ path: '', code: 'shape', message: `el valor de ${requirementId} es un objeto con: ${Object.keys(structure).map(k => k.replace(/\?$/, '')).join(', ')}` });
            return issues;
        }
        const fields = new Map(Object.entries(structure).map(([k, d]) => [k.replace(/\?$/, ''), String(d ?? '')]));
        for (const extra of TYPE_EXTRA_KEYS[type] ?? []) if (!fields.has(extra)) fields.set(extra, 'texto');
        for (const key of Object.keys(v)) {
            if (!fields.has(key)) issues.push({ path: key, code: 'shape', message: `campo desconocido: ${key}` });
        }
        for (const [key, desc] of fields) {
            if (/^requerido\b/.test(desc.trim()) && blank(v[key])) issues.push({ path: key, code: 'required', message: `falta ${key}` });
            checkField(key, desc, v[key], issues);
        }
    } else if (!Array.isArray(v) && !isPlainObject(v)) {
        issues.push({ path: '', code: 'shape', message: `el valor de ${requirementId} es una lista (o [] confirmado)` });
    }
    return issues;
}
