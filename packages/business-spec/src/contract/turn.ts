/**
 * C2 · Contrato de conocimiento del turno (C0 §1.2, rebanada R4): qué puede afirmar el agente en este turno y qué
 * hace con lo que no consta. Función pura sobre la especificación, la foto y el resultado del motor (`evaluate`).
 *
 * Reglas (C0 §0.5 y §1.2):
 * - El agente se comporta igual en cualquier estado del tenant: el contrato trae el estado de cada dato y lo que no
 *   consta se trata con su `when_missing` (PREG / NC+AV / HUM / EXT / GAP), nunca se inventa.
 * - `unknown` NO depende de detectar la intención: lista TODO requisito aplicable que el agente no puede afirmar
 *   (sin valor), así un error del clasificador no hace desaparecer el «no consta».
 * - `facts` trae siempre los `always_in_context`; los `read_on_intent` solo para las intenciones pedidas.
 * - `ejemplo` y `sembrado` van en `unknown`: el ítem puede nombrarse, su valor no.
 * - `offers` dice qué puede ofrecer el turno: «lo averiguo» solo si CORE.PENDING.ROUTING cumple; una persona solo
 *   si CORE.HANDOFF.TEAM cumple; reservar o pedir según `OBJ.<X>.WRITE_MODE` (sin modo declarado = `none`).
 *
 * `renderKnowledgeStatus` lo pinta como el bloque `<knowledge_status>` de la capa 3 del prompt (≤ 600 tokens p95).
 */
import { compose } from '../compose';
import { COMMON_NEVER } from '../qa/truth';
import { resolveFacts } from '../facts';
import { resolveValue, textEvidenceFor } from '../status';
import type { CompiledSpec, GapCause, MissingCode, ReadinessResult, RequirementEvaluation, TenantSnapshot, ValueState, Verdict } from '../types';

export const TURN_CONTRACT_SCHEMA = 'business-spec/turn-contract@1' as const;

/** Estado de un dato para el agente (los seis de C0 §0.3, en inglés porque viajan al prompt). */
export type KnowledgeState = 'confirmed' | 'example' | 'seeded' | 'absent' | 'contradictory' | 'stale';
export type ObjectWriteMode = 'direct_commit' | 'request_to_business' | 'none';

/** Exposiciones que el agente ve en el turno (`platform_only` y `account_read` no son conocimiento del negocio). */
const TURN_EXPOSURES = new Set(['always_in_context', 'read_on_intent']);


export interface TurnContractFact {
    id: string;
    topic: string;
    state: 'confirmed';
    /** De dónde sale lo afirmable: el valor, una FAQ o documento confirmado, el default aceptado o los ítems del catálogo. */
    source: 'value' | 'text' | 'default' | 'items';
    value?: unknown;
    /** Calificadores del valor (p. ej. `valid_until`). */
    qualifiers?: Record<string, string>;
}

export interface TurnContractUnknown {
    id: string;
    topic: string;
    state: KnowledgeState;
    /** Qué hace el agente (`when_missing.code`). */
    code: MissingCode;
    /** Prohibiciones propias del requisito (las comunes van en `never` del contrato). */
    never: string[];
    /** Listas: cuántos ítems cumplen (el resto, «no consta»). */
    ratio?: { ok: number; total: number };
}

export interface TurnKnowledgeContract {
    schema: typeof TURN_CONTRACT_SCHEMA;
    specVersion: string;
    verdict: Verdict;
    /** `resultHash` de la evaluación de la que sale el contrato. */
    resultHash: string;
    facts: TurnContractFact[];
    unknown: TurnContractUnknown[];
    never: string[];
    offers: {
        /** «Lo consulto con el equipo y te aviso» (CORE.PENDING.ROUTING cumple). */
        pendingQuestion: boolean;
        /** Pasar a una persona (CORE.HANDOFF.TEAM cumple) y su horario o tiempos si constan (CORE.HANDOFF.HOURS_SLA). */
        handoff: { available: boolean; hoursSla?: unknown };
        /** Por objeto habilitado: el modo de escritura que el negocio declaró; sin declarar = `none` (C0 when_missing). */
        writes: Record<string, { mode: ObjectWriteMode; declared: boolean }>;
    };
}

export interface TurnContractOptions {
    /** Intenciones detectadas en el turno (IDs de B1): suman sus `read_on_intent` a `facts`. */
    intents?: readonly string[];
    now?: Date;
}

const STATE_OF: Readonly<Record<ValueState, KnowledgeState>> = {
    confirmado: 'confirmed', ejemplo: 'example', sembrado: 'seeded', ausente: 'absent', contradictorio: 'contradictory', caducado: 'stale',
};
const CAUSE_STATE: Partial<Record<GapCause, KnowledgeState>> = {
    ausente: 'absent', ejemplo: 'example', sembrado: 'seeded', contradictorio: 'contradictory', caducado: 'stale',
};

const passes = (r: RequirementEvaluation) => r.result === 'cumple' && Object.values(r.levelResults ?? {}).every(x => x === 'cumple');

/**
 * Estado de un requisito que no se puede afirmar. Manda la causa del hueco; un «parcial» (lista con huecos) o un
 * valor confirmado que no alcanza el predicado se dicen «absent»: lo que falta no consta.
 */
function unknownState(r: RequirementEvaluation): KnowledgeState {
    const fromCause = r.gap ? CAUSE_STATE[r.gap.cause] : undefined;
    if (fromCause) return fromCause;
    const fromValue = r.valueState ? STATE_OF[r.valueState] : 'absent';
    return fromValue === 'confirmed' ? 'absent' : fromValue;
}

const WRITE_MODES = new Set<ObjectWriteMode>(['direct_commit', 'request_to_business', 'none']);

export function buildTurnContract(spec: CompiledSpec, snap: TenantSnapshot, result: ReadinessResult, options: TurnContractOptions = {}): TurnKnowledgeContract {
    const at = options.now ?? new Date(result.asOf);
    const intents = new Set(options.intents ?? []);
    const evals = new Map(result.requirements.map(r => [r.id, r]));
    const effective = compose(spec, resolveFacts(spec, snap, at)).filter(e => e.applies);
    const inContract = new Set(effective.filter(e => TURN_EXPOSURES.has(e.req.exposure)).map(e => e.req.id));

    const facts: TurnContractFact[] = [];
    const unknown: TurnContractUnknown[] = [];
    for (const e of effective) {
        const req = e.req;
        if (!inContract.has(req.id)) continue;
        const ev = evals.get(req.id);
        if (!ev || !ev.applies) continue;
        if (passes(ev)) {
            const wanted = req.exposure === 'always_in_context' || req.answers.some(a => intents.has(a));
            if (!wanted) continue;
            const rv = resolveValue(snap.values[req.id], at);
            const record = rv.state === 'confirmado' ? rv.record : null;
            const isList = String(req.data?.type ?? '').startsWith('item_list');
            const fact: TurnContractFact = { id: req.id, topic: req.title, state: 'confirmed', source: 'value' };
            if (record && record.value !== null && record.value !== undefined) {
                fact.value = record.value;
                if (record.validUntil) fact.qualifiers = { valid_until: String(record.validUntil) };
            } else if (isList) fact.source = 'items';
            else if (record?.origin === 'default_accepted' || snap.defaultsAcceptance.some(a => a.ids.includes(req.id))) fact.source = 'default';
            else if (req.sources.acceptsTextEvidence && textEvidenceFor(snap.texts, req.id)) fact.source = 'text';
            facts.push(fact);
            continue;
        }
        // el hueco se muestra en su raíz (schema §9), si la raíz también está en el contrato
        if (ev.gap?.rootCause && inContract.has(ev.gap.rootCause)) continue;
        unknown.push({
            id: req.id, topic: req.title, state: unknownState(ev), code: req.whenMissing.code, never: [...req.whenMissing.never],
            ...(ev.ratio && ev.ratio.total > 0 && ev.ratio.ok < ev.ratio.total ? { ratio: ev.ratio } : {}),
        });
    }

    const passed = (id: string) => { const r = evals.get(id); return Boolean(r && r.applies && passes(r)); };
    const sla = resolveValue(snap.values['CORE.HANDOFF.HOURS_SLA'], at);
    const handoffAvailable = passed('CORE.HANDOFF.TEAM');
    const writes: TurnKnowledgeContract['offers']['writes'] = {};
    for (const o of result.config.objects) {
        const mode = WRITE_MODES.has(o.writeMode as ObjectWriteMode) ? o.writeMode as ObjectWriteMode : 'none';
        writes[o.object] = { mode: o.writeModeDeclared ? mode : 'none', declared: o.writeModeDeclared };
    }

    return {
        schema: TURN_CONTRACT_SCHEMA,
        specVersion: result.specVersion,
        verdict: result.verdict,
        resultHash: result.resultHash,
        facts,
        unknown,
        // las prohibiciones comunes a todo dato que no consta (schema §8, las mismas de la verdad QA): una vez por bloque
        never: [...COMMON_NEVER],
        offers: {
            pendingQuestion: passed('CORE.PENDING.ROUTING'),
            handoff: { available: handoffAvailable, ...(handoffAvailable && sla.state === 'confirmado' && sla.record ? { hoursSla: sla.record.value } : {}) },
            writes,
        },
    };
}

// ─────────────────────────── bloque del prompt ───────────────────────────

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s: string) => xml(s).replace(/"/g, '&quot;');

/** Un valor como texto compacto (JSON sin espacios), recortado para el presupuesto del bloque. */
export function compactValue(value: unknown, max = 240): string {
    let text: string;
    try { text = typeof value === 'string' ? value : JSON.stringify(value); } catch { text = String(value); }
    text = String(text ?? '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export interface RenderKnowledgeStatusOptions {
    /** Sangría de cada línea (la capa 3 usa dos espacios). */
    indent?: string;
    /** Máximo de caracteres del valor de un `fact`. */
    maxValueChars?: number;
    /**
     * Pinta `writes` en `<offers>` (default true). La API lo apaga mientras la exclusión por WRITE_MODE está en modo
     * sombra: el prompt no puede decir «none» de un escritor que el contrato de capacidades todavía publica.
     */
    includeWrites?: boolean;
    /**
     * Pinta las prohibiciones comunes en `<never>` (default true). La API las lleva en la regla fija del contrato L1
     * (prefijo cacheable) y las omite aquí para no pagarlas en cada turno.
     */
    includeCommonNever?: boolean;
}

/** Orden de los grupos de `unknown` en el bloque: lo que más protege primero. */
const CODE_ORDER: readonly MissingCode[] = ['EXT', 'HUM', 'NC+AV', 'PREG', 'GAP'];
/** Códigos cuyas prohibiciones propias viajan en el bloque (seguridad y derivación); el resto queda en el contrato (QA, ensayo). */
const NEVER_IN_PROMPT = new Set<MissingCode>(['EXT', 'HUM']);

/**
 * `<knowledge_status>`: datos, no instrucciones (la regla del contrato L1 dice qué hacer con cada código).
 * - `fact`: afirmable, con su valor compacto (o de dónde sale: `items` por herramienta, `text` en una FAQ confirmada).
 * - `unknown code="…"`: los IDs que no constan, agrupados por código; `[seeded]`, `[example]`, `[contradictory]`,
 *   `[stale]` marcan un valor que existe y no se puede afirmar; `[n/m]`, cuántos ítems de la lista constan.
 * - `never`: las prohibiciones comunes y las propias de los requisitos EXT y HUM.
 * - `offers`: qué puede ofrecer el turno.
 * Presupuesto: ≤ 600 tokens p95 (C0 §1.2); por eso el tema y las prohibiciones NC+AV no viajan (están en el contrato).
 */
export function renderKnowledgeStatus(c: TurnKnowledgeContract, options: RenderKnowledgeStatusOptions = {}): string {
    const pad = options.indent ?? '';
    const max = options.maxValueChars ?? 200;
    const lines = [`${pad}<knowledge_status spec="${attr(c.specVersion)}" verdict="${attr(c.verdict)}">`];
    for (const f of c.facts) {
        const q = Object.entries(f.qualifiers ?? {}).map(([k, v]) => ` ${k}="${attr(v)}"`).join('');
        const body = f.value === undefined ? '' : xml(compactValue(f.value, max));
        const source = f.source === 'value' ? '' : ` source="${f.source}"`;
        lines.push(`${pad}  <fact id="${attr(f.id)}"${source}${q}>${body}</fact>`);
    }
    const never = options.includeCommonNever === false ? [] : [...c.never];
    for (const code of CODE_ORDER) {
        const group = c.unknown.filter(u => u.code === code);
        if (!group.length) continue;
        const ids = group.map(u => {
            const marks = [u.state === 'absent' ? '' : u.state, u.ratio ? `${u.ratio.ok}/${u.ratio.total}` : ''].filter(Boolean);
            return marks.length ? `${u.id}[${marks.join(' ')}]` : u.id;
        });
        lines.push(`${pad}  <unknown code="${attr(code)}">${xml(ids.join(', '))}</unknown>`);
        if (NEVER_IN_PROMPT.has(code)) for (const u of group) if (u.never.length) never.push(`${u.id}: ${u.never.join('; ')}`);
    }
    if (never.length) lines.push(`${pad}  <never>${xml(never.join(' | '))}</never>`);
    const hours = c.offers.handoff.hoursSla === undefined ? '' : ` handoff_hours="${attr(compactValue(c.offers.handoff.hoursSla, 160))}"`;
    const writes = options.includeWrites === false ? ''
        : ` writes="${attr(Object.entries(c.offers.writes).map(([o, w]) => `${o}=${w.mode}`).join(' '))}"`;
    lines.push(`${pad}  <offers pending_question="${c.offers.pendingQuestion}" handoff="${c.offers.handoff.available}"${hours}${writes} />`);
    lines.push(`${pad}</knowledge_status>`);
    return lines.join('\n');
}
