/**
 * Requisitos efectivos de un tenant (schema §2): core ∪ object:* habilitados ∪ profile:<suyo> ∪ domain:* de su perfil,
 * con `criticality.when` resuelto y los overrides aplicados como piso (solo suben la criticidad).
 */
import { evalExpr } from './expr';
import { resolveFacts, type TenantFacts } from './facts';
import { emptySnapshot } from './snapshot';
import { LEVEL_RANK, type CompiledRequirement, type CompiledSpec, type Level, type Rule } from './types';

export interface EffectiveRequirement {
    req: CompiledRequirement;
    applies: boolean;
    level: Level;
    rule: Rule;
    /** Por qué tiene ese nivel: `base`, `when: …`, `override profile:P02`. */
    reasons: string[];
    /** Parámetros que aportan los overrides (p. ej. `required_topics`). */
    params: Record<string, unknown>;
}

const layerActive = (layer: string, facts: TenantFacts): boolean => {
    if (layer === 'core') return true;
    const [kind, name] = layer.split(':');
    if (kind === 'object') return facts.objectEnabled(name);
    // los extras de perfil pueden aplicar a varios perfiles (PROF.P09.PREPARATIONS: P08, P09, P17): decide applies_when
    if (kind === 'profile') return true;
    if (kind === 'domain') return facts.domains.has(name);
    return false;
};

export function compose(spec: CompiledSpec, facts: TenantFacts): EffectiveRequirement[] {
    const out: EffectiveRequirement[] = [];
    for (const id of spec.order) {
        const req = spec.requirements[id];
        const env = { ...facts, object: req.object };
        const applies = !req.deprecatedBy && layerActive(req.layer, facts) && evalExpr(req.appliesWhen, env);
        let level = req.level;
        let rule = req.rule;
        const reasons = ['base'];
        for (const w of req.when) {
            if (evalExpr(w.if, env)) { level = w.level; rule = w.rule; reasons.push(`when: ${w.ifSource}`); break; }
        }
        const params: Record<string, unknown> = {};
        for (const o of spec.overrides) {
            if (o.target !== id) continue;
            const [kind, name] = o.source.split(':');
            const active = kind === 'profile' ? facts.profileId === name
                : kind === 'object' ? facts.objectEnabled(name)
                    : kind === 'domain' ? facts.domains.has(name) : false;
            if (!active) continue;
            if (o.if && !evalExpr(o.if, { ...facts, object: kind === 'object' ? name : req.object })) continue;
            if (o.params) Object.assign(params, o.params);
            if (o.level && o.rule && LEVEL_RANK[o.level] > LEVEL_RANK[level]) {
                level = o.level; rule = o.rule; reasons.push(`override ${o.source}`);
            }
        }
        out.push({ req, applies, level, rule, reasons, params });
    }
    return out;
}

/**
 * compose(perfil, subtipo): los requisitos aplicables a un tipo de negocio con los valores por defecto
 * del perfil (sin datos del tenant). Sirve para documentación, bancos QA y el panel antes del alta.
 */
export function composeFor(spec: CompiledSpec, input: { subtype?: string; profile?: string }): EffectiveRequirement[] {
    const snap = emptySnapshot('compose');
    const value: Record<string, unknown> = {};
    if (input.subtype) value.subtype = input.subtype;
    if (input.profile) value.profile = input.profile;
    snap.values['CORE.IDENTITY.PROFILE'] = [{ value, status: 'confirmed', origin: 'owner_form' }];
    const facts = resolveFacts(spec, snap, new Date(snap.capturedAt));
    return compose(spec, facts).filter(e => e.applies);
}
