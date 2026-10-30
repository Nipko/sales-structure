/**
 * YAML ya parseado → CompiledSpec. Puro: no lee archivos (eso lo hace `load.ts`).
 *
 * Cada defecto tiene un código estable; la CI (`business-spec check`) falla con cualquiera.
 * Hay un test por código en test/compile.spec.ts.
 */
import Ajv from 'ajv';
import { parseExpr, validateExpr, type Expr } from './expr';
import {
    LEVEL_RANK, LEVEL_RULES,
    type CompiledRequirement, type CompiledSpec, type CriticalityWhen, type IntentDef, type Level,
    type MissingCode, type ObjectDef, type OverrideRule, type PredicateKind, type ProfileDef, type Rule,
} from './types';
import { CUSTOM_EVALUATOR_IDS } from './engine/evaluators';
import { parseObjectRef } from './refs';

export { parseObjectRef };

export type SpecErrorCode =
    | 'SCHEMA_INVALID' | 'VERSION_MISMATCH' | 'DUPLICATE_ID' | 'UNKNOWN_REFERENCE' | 'UNKNOWN_INTENT'
    | 'INVALID_ENUM' | 'LEVEL_RULE_MISMATCH' | 'UNEVALUABLE_EXPRESSION' | 'UNEVALUABLE_PREDICATE'
    | 'PREDICATE_PARAMS_INVALID' | 'EVALUATOR_PARITY' | 'OVERRIDE_LOWERS_WITHOUT_ADR' | 'DUPLICATE_SUBTYPE'
    | 'SUBTYPE_COVERAGE' | 'UNKNOWN_UI_TARGET' | 'DOCS_STALE';

export interface SpecError { code: SpecErrorCode; id?: string; message: string }

export interface SpecDocs {
    core: any;
    objects: any;
    profiles: any;
    intents: any;
    /** spec/requirement.schema.json */
    schema: any;
}

export interface CompileOptions {
    /** IDs con evaluador `custom` registrado (por defecto, el registro real del motor). */
    evaluatorIds?: readonly string[];
}

const GAP_CAUSES = new Set(['ausente', 'ejemplo', 'sembrado', 'contradictorio', 'parcial', 'caducado', 'hecho_sin_declarar', 'plataforma']);
const WRITE_MODES = new Set(['direct_commit', 'request_to_business', 'none']);
const LEVEL_WORD = /^(bloqueante|necesario|recomendado)\s*\((R[1-5])\)/i;
const GENERIC_KINDS: readonly PredicateKind[] = ['confirmed_fields', 'value_or_empty', 'default_accepted', 'count_min', 'platform_pack'];

const ajvCache = new WeakMap<object, ReturnType<Ajv['compile']>>();

function upper(o: string): string { return o.toUpperCase(); }


function firstAdminPath(text: string): string | null {
    const m = String(text ?? '').match(/\/admin(?:\/[A-Za-z0-9_\-[\]]+)*/);
    return m ? m[0] : null;
}

export function compile(docs: SpecDocs, options: CompileOptions = {}): { spec: CompiledSpec; errors: SpecError[] } {
    const errors: SpecError[] = [];
    const err = (code: SpecErrorCode, message: string, id?: string) => errors.push({ code, message, ...(id ? { id } : {}) });
    const evaluatorIds = new Set(options.evaluatorIds ?? CUSTOM_EVALUATOR_IDS);

    // ── versión ──
    const versions = [docs.core?.spec_version, docs.objects?.spec_version, docs.profiles?.spec_version, docs.intents?.spec_version].map(v => String(v ?? ''));
    const specVersion = versions[0];
    if (versions.some(v => v !== specVersion) || !specVersion) err('VERSION_MISMATCH', `spec_version distinto entre archivos: ${versions.join(' / ')}`);

    // ── intenciones ──
    const intents: Record<string, IntentDef> = {};
    for (const raw of docs.intents?.intents ?? []) {
        const id = String(raw?.id ?? '');
        if (intents[id]) err('DUPLICATE_ID', `intención duplicada ${id}`, id);
        intents[id] = {
            id, layer: String(raw.layer ?? ''), block: String(raw.block ?? ''), title: String(raw.title ?? ''),
            ifMissing: Array.isArray(raw.if_missing) ? raw.if_missing.map(String) : [], conversational: raw.conversational === true,
        };
    }

    // ── objetos ──
    const objects: Record<string, ObjectDef> = {};
    for (const o of docs.objects?.objects ?? []) {
        const name = String(o.object);
        if (objects[name]) err('DUPLICATE_ID', `objeto duplicado ${name}`, name);
        if (!WRITE_MODES.has(o.default_write_mode)) err('INVALID_ENUM', `default_write_mode inválido en ${name}: ${o.default_write_mode}`, name);
        objects[name] = {
            object: name, label: String(o.label ?? name), variants: o.variants ?? {},
            templateApplies: (o.template_applies ?? []).map(String),
            catalogFields: { required: (o.catalog_fields?.required ?? []).map(String), optional: (o.catalog_fields?.optional ?? []).map(String) },
            availabilityKinds: (o.availability_kinds ?? []).map(String),
            defaultWriteMode: o.default_write_mode, defaultIdentity: String(o.default_identity ?? 'canal'),
            ...(o.availability_default ? { availabilityDefault: o.availability_default } : {}),
        };
    }
    const objectNames = new Set(Object.keys(objects));

    // ── dominios y perfiles ──
    const domainDocs: any[] = docs.profiles?.domains ?? [];
    const domains = domainDocs.map(d => String(d.domain));
    const domainSet = new Set(domains);
    const factsDefaults = docs.profiles?.operating_facts_defaults ?? {};
    const profiles: Record<string, ProfileDef> = {};
    for (const p of docs.profiles?.profiles ?? []) {
        const id = String(p.profile);
        const facts = factsDefaults[id];
        if (!facts) err('UNKNOWN_REFERENCE', `${id} no tiene operating_facts_defaults`, id);
        const objectsDefault = (p.objects_default ?? []).map((r: string) => parseObjectRef(r));
        for (const od of objectsDefault) {
            if (!objectNames.has(od.object)) err('UNKNOWN_REFERENCE', `${id}: objeto desconocido «${od.object}»`, id);
            else if (od.variant && !(od.variant in objects[od.object].variants)) err('UNKNOWN_REFERENCE', `${id}: variante desconocida «${od.object}(${od.variant})»`, id);
        }
        const cdf: Record<string, string> = facts?.conditional_domain_facts ?? {};
        const unconditional: string[] = [];
        for (const d of (p.domains ?? []).map(String)) {
            const base = d.split(/\s+/)[0];
            if (!domainSet.has(base)) { err('UNKNOWN_REFERENCE', `${id}: dominio desconocido «${base}»`, id); continue; }
            if (/\s+si\s+/.test(d)) {
                if (!Object.values(cdf).includes(base)) err('UNKNOWN_REFERENCE', `${id}: dominio condicional «${d}» sin hecho en conditional_domain_facts`, id);
            } else unconditional.push(base);
        }
        for (const [fact, dom] of Object.entries(cdf)) if (!domainSet.has(dom)) err('UNKNOWN_REFERENCE', `${id}: hecho ${fact} apunta a dominio desconocido «${dom}»`, id);
        profiles[id] = {
            profile: id, name: String(p.name ?? id), objectsDefault, domains: unconditional, conditionalDomainFacts: cdf,
            operatingFactsDefaults: { modality: facts?.modality ?? null, delivery_offered: facts?.delivery_offered ?? null, has_prepayment: facts?.has_prepayment ?? null },
        };
    }
    const profileSet = new Set(Object.keys(profiles));
    const known = { objects: objectNames, domains: domainSet, profiles: profileSet };

    const subtypeToProfile: Record<string, string> = {};
    for (const [prof, list] of Object.entries<any>(docs.profiles?.subtypes ?? {})) {
        if (!profileSet.has(prof)) err('UNKNOWN_REFERENCE', `subtypes: perfil desconocido ${prof}`, prof);
        for (const st of list ?? []) {
            if (subtypeToProfile[st]) err('DUPLICATE_SUBTYPE', `subtipo ${st} en ${subtypeToProfile[st]} y ${prof}`, st);
            subtypeToProfile[String(st)] = prof;
        }
    }

    // ── requisitos crudos ──
    type Raw = { raw: any; layer: string; object?: string; templateId?: string };
    const rawList: Raw[] = [];
    for (const r of docs.core?.requirements ?? []) rawList.push({ raw: r, layer: 'core' });
    const templates: Record<string, any> = {};
    for (const t of docs.objects?.template ?? []) {
        const name = String(t.id ?? '').replace(/^OBJ\.\*\./, '');
        if (templates[name]) err('DUPLICATE_ID', `plantilla duplicada ${t.id}`, t.id);
        templates[name] = t;
    }
    for (const o of docs.objects?.objects ?? []) for (const r of o.extra_requirements ?? []) rawList.push({ raw: r, layer: `object:${o.object}`, object: String(o.object) });
    for (const d of domainDocs) for (const r of d.requirements ?? []) rawList.push({ raw: r, layer: `domain:${d.domain}` });
    for (const p of docs.profiles?.profiles ?? []) for (const r of p.extra_requirements ?? []) rawList.push({ raw: r, layer: `profile:${p.profile}` });

    // JSON Schema (plantillas incluidas)
    let validate = docs.schema ? ajvCache.get(docs.schema) : undefined;
    if (docs.schema && !validate) {
        validate = new Ajv({ allErrors: true, strict: false }).compile(docs.schema);
        ajvCache.set(docs.schema, validate);
    }
    for (const r of [...rawList.map(x => x.raw), ...Object.values(templates)]) {
        if (validate && !validate(r)) {
            for (const e of validate.errors ?? []) err('SCHEMA_INVALID', `${r?.id ?? '?'}${e.instancePath} ${e.message}${e.params && 'allowedValues' in e.params ? ` (${(e.params as any).allowedValues.join(', ')})` : ''}`, r?.id);
        }
    }

    // instanciar plantillas
    for (const o of docs.objects?.objects ?? []) {
        for (const name of o.template_applies ?? []) {
            const t = templates[name];
            if (!t) { err('UNKNOWN_REFERENCE', `${o.object}: plantilla OBJ.*.${name} no existe`, o.object); continue; }
            rawList.push({ raw: { ...t, id: `OBJ.${upper(o.object)}.${name}` }, layer: `object:${o.object}`, object: String(o.object), templateId: String(t.id) });
        }
    }

    // ── compilar cada requisito ──
    const requirements: Record<string, CompiledRequirement> = {};
    const order: string[] = [];
    const seenIds = new Set<string>();
    const parse = (src: string, where: string, object?: string): Expr => {
        let s = String(src ?? '');
        if (object) s = s.replace(/WRITE_MODE\s*(≠|!=)\s*none/g, 'writes(<O>)').replace(/<O>/g, object);
        try {
            const e = parseExpr(s);
            for (const m of validateExpr(e, known)) err('UNEVALUABLE_EXPRESSION', `${where}: ${m}`, where.split(' ')[0]);
            return e;
        } catch (e) {
            err('UNEVALUABLE_EXPRESSION', `${where}: ${(e as Error).message}`, where.split(' ')[0]);
            return { t: 'const', v: true };
        }
    };

    for (const { raw, layer, object, templateId } of rawList) {
        const id = String(raw?.id ?? '');
        if (seenIds.has(id)) { err('DUPLICATE_ID', `ID duplicado ${id}`, id); continue; }
        seenIds.add(id);
        const crit = raw.criticality ?? {};
        const level = crit.level as Level;
        const rule = crit.rule as Rule;
        if (LEVEL_RULES[level] && !LEVEL_RULES[level].includes(rule)) err('LEVEL_RULE_MISMATCH', `${id}: ${level} no puede venir de ${rule}`, id);
        const when: CriticalityWhen[] = [];
        for (const w of crit.when ?? []) {
            if (LEVEL_RULES[w.level as Level] && !LEVEL_RULES[w.level as Level].includes(w.rule)) err('LEVEL_RULE_MISMATCH', `${id}: when ${w.level} con ${w.rule}`, id);
            when.push({ if: parse(w.if, `${id} criticality.when`, object), ifSource: String(w.if), level: w.level, rule: w.rule });
        }
        const readiness = raw.readiness ?? {};
        const kind = readiness.predicate_kind as PredicateKind;
        const params = (readiness.predicate_params ?? {}) as Record<string, unknown>;
        const blockingOrNeeded = LEVEL_RANK[level] >= 2 || when.some(w => LEVEL_RANK[w.level] >= 2);
        const evaluatorKey = templateId ?? id;
        if (!kind) err('UNEVALUABLE_PREDICATE', `${id}: sin predicate_kind${blockingOrNeeded ? ' (R1–R4)' : ''}`, id);
        else if (kind === 'custom' && !evaluatorIds.has(evaluatorKey)) err('UNEVALUABLE_PREDICATE', `${id}: predicate_kind custom sin evaluador registrado`, id);
        else if (kind !== 'custom' && !GENERIC_KINDS.includes(kind)) err('UNEVALUABLE_PREDICATE', `${id}: predicate_kind desconocido ${kind}`, id);
        if (kind === 'confirmed_fields' && !Array.isArray(params.fields) && !Array.isArray(params.any_of)) err('PREDICATE_PARAMS_INVALID', `${id}: confirmed_fields exige fields o any_of`, id);
        if (kind === 'count_min' && (typeof params.path !== 'string' || typeof params.min !== 'number')) err('PREDICATE_PARAMS_INVALID', `${id}: count_min exige path y min`, id);
        if (kind === 'platform_pack' && typeof params.field !== 'string') err('PREDICATE_PARAMS_INVALID', `${id}: platform_pack exige field`, id);
        if (!readiness.predicate && !readiness.predicate_by_level) err('UNEVALUABLE_PREDICATE', `${id}: sin predicado en prosa`, id);
        if (readiness.predicate_by_level) for (const k of Object.keys(readiness.predicate_by_level)) if (!(k in LEVEL_RANK)) err('INVALID_ENUM', `${id}: predicate_by_level.${k}`, id);
        if (readiness.gap_message && typeof readiness.gap_message === 'object') {
            for (const k of Object.keys(readiness.gap_message)) if (!GAP_CAUSES.has(k)) err('INVALID_ENUM', `${id}: gap_message.${k} no es una causa`, id);
        }
        for (const a of raw.answers ?? []) if (!intents[a]) err('UNKNOWN_INTENT', `${id}: answers ${a} no existe en intents.yaml`, id);
        const allowed: string[] = (raw.sources?.allowed ?? []).map(String);
        const objUi = object ? firstAdminPath(String((docs.objects?.objects ?? []).find((x: any) => x.object === object)?.storage_today?.ui ?? '')) : null;
        const uiToday = String(raw.collection?.ui_today ?? '');
        const uiTarget = object && (/objeto/.test(uiToday) || !firstAdminPath(uiToday)) && objUi ? objUi : firstAdminPath(uiToday);
        requirements[id] = {
            id, title: String(raw.title ?? id), layer, kind: String(raw.kind ?? ''),
            ...(object ? { object } : {}), ...(templateId ? { templateId } : {}),
            appliesWhen: parse(raw.applies_when, `${id} applies_when`, object), appliesWhenSource: String(raw.applies_when ?? ''),
            answers: (raw.answers ?? []).map(String), exposure: String(raw.exposure ?? ''), data: raw.data ?? {},
            level, rule, ...(crit.conditional ? { conditional: String(crit.conditional) } : {}), when,
            whenMissing: { code: raw.when_missing?.code as MissingCode, behavior: String(raw.when_missing?.behavior ?? ''), never: (raw.when_missing?.never ?? []).map(String) },
            sources: { allowed, acceptsTextEvidence: raw.sources?.accepts_text_evidence === true, ...(raw.sources?.max_age ? { maxAge: String(raw.sources.max_age) } : {}) },
            platform: allowed.length > 0 && allowed.every(s => s === 'country_pack' || s === 'derived'),
            uiToday, uiTarget, storageToday: String(raw.collection?.storage_today ?? ''),
            predicate: String(readiness.predicate ?? ''), ...(readiness.predicate_by_level ? { predicateByLevel: readiness.predicate_by_level } : {}),
            predicateKind: kind, predicateParams: params, gapMessage: readiness.gap_message ?? '', derived: readiness.derived === true,
            qaTruth: String(raw.qa_truth ?? ''),
            ...(raw.deprecated_by ? { deprecatedBy: String(raw.deprecated_by) } : {}),
            ...(raw.owner_decision ? { ownerDecision: String(raw.owner_decision) } : {}),
        };
        order.push(id);
    }
    for (const r of Object.values(requirements)) {
        if (r.deprecatedBy && !requirements[r.deprecatedBy]) err('UNKNOWN_REFERENCE', `${r.id}: deprecated_by ${r.deprecatedBy} no existe`, r.id);
    }

    // paridad ID ↔ evaluador (las dos direcciones)
    const customKeys = new Set(Object.values(requirements).filter(r => r.predicateKind === 'custom').map(r => r.templateId ?? r.id));
    for (const k of evaluatorIds) if (!customKeys.has(k)) err('EVALUATOR_PARITY', `evaluador registrado para ${k}, que no existe o no es custom`, k);

    // ── overrides ──
    const overrides: OverrideRule[] = [];
    const minLevel = (r: CompiledRequirement) => Math.min(LEVEL_RANK[r.level], ...r.when.map(w => LEVEL_RANK[w.level]));
    const addOverride = (source: string, target: string, value: any, object?: string) => {
        const req = requirements[target];
        if (!req) { err('UNKNOWN_REFERENCE', `${source}: override sobre ${target}, que no existe`, target); return; }
        const rule: OverrideRule = { target, source, why: '' };
        if (value && typeof value === 'object') {
            rule.level = value.level; rule.rule = value.rule; rule.params = value.params; rule.why = String(value.why ?? '');
            if (value.adr) rule.adr = String(value.adr);
            if (value.if) { rule.ifSource = String(value.if); rule.if = parse(value.if, `${target} override(${source})`, object); }
        } else {
            const text = String(value ?? '');
            rule.why = text;
            const m = text.match(LEVEL_WORD);
            if (m) {
                rule.level = m[1].toLowerCase() as Level; rule.rule = m[2].toUpperCase() as Rule;
                const rest = text.slice(m[0].length);
                const cond = rest.match(/^\s*si\s+([^:;(]+)/);
                const en = rest.match(/^\s*en\s+([a-z_]+)/);
                let condSrc: string | null = null;
                if (cond) condSrc = cond[1].trim().replace(/WRITE_MODE\s*=\s*direct_commit/, 'direct_commit(<O>)').replace(/WRITE_MODE\s*(≠|!=)\s*none/, 'writes(<O>)');
                else if (en && object && en[1] in objects[object].variants) condSrc = `variant = ${en[1]}`;
                if (condSrc) {
                    if (/<O>/.test(condSrc) && !object) err('UNEVALUABLE_EXPRESSION', `${source}: condición de objeto fuera de un objeto «${condSrc}»`, target);
                    rule.ifSource = condSrc; rule.if = parse(condSrc, `${target} override(${source})`, object);
                }
            } else rule.params = { note: text };
        }
        if (rule.level) {
            if (!LEVEL_RULES[rule.level]?.includes(rule.rule as Rule)) err('LEVEL_RULE_MISMATCH', `${source}: override ${target} ${rule.level} con ${rule.rule}`, target);
            if (LEVEL_RANK[rule.level] < minLevel(req) && !rule.adr) err('OVERRIDE_LOWERS_WITHOUT_ADR', `${source}: override baja ${target} a ${rule.level} sin ADR`, target);
        }
        overrides.push(rule);
    };
    for (const p of docs.profiles?.profiles ?? []) for (const [t, v] of Object.entries(p.overrides ?? {})) addOverride(`profile:${p.profile}`, t, v);
    for (const o of docs.objects?.objects ?? []) for (const [t, v] of Object.entries(o.overrides ?? {})) addOverride(`object:${o.object}`, t, v, String(o.object));
    for (const d of domainDocs) for (const [t, v] of Object.entries(d.raises ?? {})) addOverride(`domain:${d.domain}`, t, v);

    const spec: CompiledSpec = { specVersion, requirements, order, objects, profiles, domains, subtypeToProfile, intents, overrides };
    return { spec, errors };
}

export function compileOrThrow(docs: SpecDocs, options?: CompileOptions): CompiledSpec {
    const { spec, errors } = compile(docs, options);
    if (errors.length) throw new Error(`La especificación tiene ${errors.length} defecto(s):\n${errors.map(e => `- [${e.code}] ${e.message}`).join('\n')}`);
    return spec;
}

/** Comprobaciones que necesitan datos de fuera del paquete (los aporta la CLI desde @parallext/shared). */
export function checkExternal(spec: CompiledSpec, ext: { canonicalSubtypes?: readonly string[]; uiTargetExists?: (path: string) => boolean }): SpecError[] {
    const errors: SpecError[] = [];
    if (ext.canonicalSubtypes) {
        const mapped = new Set(Object.keys(spec.subtypeToProfile));
        const canon = new Set(ext.canonicalSubtypes);
        for (const s of canon) if (!mapped.has(s)) errors.push({ code: 'SUBTYPE_COVERAGE', id: s, message: `subtipo canónico ${s} sin perfil en profiles.yaml` });
        for (const s of mapped) if (!canon.has(s)) errors.push({ code: 'SUBTYPE_COVERAGE', id: s, message: `profiles.yaml mapea ${s}, que no es un subtipo canónico` });
    }
    if (ext.uiTargetExists) {
        for (const r of Object.values(spec.requirements)) {
            if (r.uiTarget && !ext.uiTargetExists(r.uiTarget)) errors.push({ code: 'UNKNOWN_UI_TARGET', id: r.id, message: `${r.id}: ${r.uiTarget} no está en dashboard-page-access.ts o el dueño (tenant_admin) no la puede abrir` });
        }
    }
    return errors;
}
