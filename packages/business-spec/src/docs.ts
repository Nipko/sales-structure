/**
 * docs/domain/business-requirements.md: lectura humana GENERADA desde el YAML (K2 §5.1: generado gana a escrito
 * a mano). `business-spec check` falla si el archivo commiteado no coincide. Sin fecha ni revisión a propósito.
 */
import { exprToString } from './expr';
import type { CompiledRequirement, CompiledSpec } from './types';

const esc = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
const level = (r: CompiledRequirement) => `${r.level} (${r.rule})${r.when.length ? ` · ${r.when.map(w => `${w.level} (${w.rule}) si ${w.ifSource}`).join('; ')}` : ''}`;
const predicate = (r: CompiledRequirement) => (r.predicateByLevel
    ? Object.entries(r.predicateByLevel).map(([k, v]) => `**${k}:** ${v}`).join(' · ') : r.predicate);
const kind = (r: CompiledRequirement) => `\`${r.predicateKind}\`${Object.keys(r.predicateParams).length ? ` ${esc(JSON.stringify(r.predicateParams))}` : ''}${r.derived ? ' · derivado' : ''}${r.platform ? ' · plataforma' : ''}`;

function table(reqs: CompiledRequirement[], applies = true): string[] {
    const head = applies
        ? ['| ID | Requisito | Nivel (regla) | Aplica si | Si falta | Predicado | Evaluación | Dónde se completa |', '|---|---|---|---|---|---|---|---|']
        : ['| ID | Requisito | Nivel (regla) | Si falta | Predicado | Evaluación | Dónde se completa |', '|---|---|---|---|---|---|---|'];
    return [...head, ...reqs.map(r => (applies
        ? `| \`${r.id}\` | ${esc(r.title)} | ${esc(level(r))} | ${esc(r.appliesWhenSource)} | ${r.whenMissing.code} | ${esc(predicate(r))} | ${kind(r)} | ${esc(r.uiToday)} |`
        : `| \`${r.id}\` | ${esc(r.title)} | ${esc(level(r))} | ${r.whenMissing.code} | ${esc(predicate(r))} | ${kind(r)} | ${esc(r.uiToday)} |`))];
}

export function generateRequirementsDoc(spec: CompiledSpec): string {
    const reqs = spec.order.map(id => spec.requirements[id]);
    const core = reqs.filter(r => r.layer === 'core');
    const templateIds = [...new Set(reqs.filter(r => r.templateId).map(r => r.templateId as string))];
    const objectExtras = reqs.filter(r => r.layer.startsWith('object:') && !r.templateId);
    const profiles = reqs.filter(r => r.layer.startsWith('profile:'));
    const domains = reqs.filter(r => r.layer.startsWith('domain:'));
    const total = core.length + templateIds.length + objectExtras.length + profiles.length + domains.length;
    const out: string[] = [
        '# Requisitos del negocio (generado)',
        '',
        '> **Generado** por `node packages/business-spec/bin/business-spec.cjs docs --write` desde `packages/business-spec/spec/*.yaml`.',
        '> No editar a mano: la CI (`verify-artifacts`) falla si este archivo no coincide con la especificación.',
        `> Formato: [business-requirements-format.md](business-requirements-format.md). Versión de la especificación: \`${spec.specVersion}\`.`,
        '',
        `**${total} requisitos** (${core.length} del núcleo, ${templateIds.length} de plantilla de objeto instanciados ${reqs.filter(r => r.templateId).length} veces, ${objectExtras.length} extras de objeto, ${profiles.length} de perfil y ${domains.length} de dominio), ${Object.keys(spec.objects).length} objetos, ${Object.keys(spec.profiles).length} perfiles, ${spec.domains.length} dominios y ${Object.keys(spec.intents).length} intenciones.`,
        '',
        '## Núcleo',
        '',
        ...table(core),
        '',
        '## Plantilla de objeto (`OBJ.*`)',
        '',
        ...table(templateIds.map(t => {
            const inst = reqs.filter(r => r.templateId === t);
            return { ...inst[0], id: t, appliesWhenSource: inst[0].appliesWhenSource } as CompiledRequirement;
        })),
        '',
        '| Plantilla | Objetos que la instancian |',
        '|---|---|',
        ...templateIds.map(t => `| \`${t}\` | ${reqs.filter(r => r.templateId === t).map(r => r.object).join(', ')} |`),
        '',
        '## Extras de objeto',
        '',
        ...table(objectExtras),
        '',
        '## Perfiles',
        '',
        ...table(profiles),
        '',
        '## Dominios regulados',
        '',
        ...table(domains),
        '',
        '## Overrides de perfil, objeto y dominio',
        '',
        '| Destino | Fuente | Efecto | Condición | Motivo |',
        '|---|---|---|---|---|',
        ...spec.overrides.map(o => `| \`${o.target}\` | ${o.source} | ${o.level ? `${o.level} (${o.rule})` : 'parámetro'} | ${esc(o.if ? exprToString(o.if) : '')} | ${esc(o.why || (o.params ? JSON.stringify(o.params) : ''))} |`),
        '',
        '## Perfiles efectivos y subtipos',
        '',
        '| Perfil | Nombre | Objetos por defecto | Dominios | Dominios condicionales | Subtipos |',
        '|---|---|---|---|---|---|',
        ...Object.values(spec.profiles).map(p => `| ${p.profile} | ${esc(p.name)} | ${p.objectsDefault.map(o => `${o.object}${o.variant ? `(${o.variant})` : ''}`).join(', ')} | ${p.domains.join(', ')} | ${Object.entries(p.conditionalDomainFacts).map(([f, d]) => `${d} si ${f}`).join(', ')} | ${Object.entries(spec.subtypeToProfile).filter(([, pp]) => pp === p.profile).map(([s]) => `\`${s}\``).join(', ')} |`),
        '',
    ];
    return out.join('\n');
}
