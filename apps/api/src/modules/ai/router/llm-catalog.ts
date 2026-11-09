/**
 * El catálogo LLM: qué modelos existen, cuánto cuestan, en qué orden responde
 * cada tarea y qué modelo cumple cada rol auxiliar (ADR-0029, ADR-0030).
 *
 * Todo lector del catálogo pasa por `activeLlmCatalog()` (fase 1 de ADR-0030).
 * Desde la fase 2 la versión activa la carga `LlmCatalogService` desde
 * `llm_catalog_versions` y la cambia una publicación, sin desplegar. La
 * semilla de este archivo sólo rige en una base vacía (se guarda como versión
 * 1) y como último recurso si Postgres no responde al arrancar: editarla ya no
 * cambia el catálogo de un entorno que tiene versiones.
 */
import type { ModelTier } from '@parallext/shared';
import { modelFamily } from '../providers/model-request-params';

/**
 * Tiers que pueden encabezar `tool_calling` (ADR-0028/0029). Es una regla de
 * ruteo, así que vive en código; la usa el router y la validación de publicación.
 */
export const TOOL_CALLING_LEAD_TIERS: ReadonlySet<ModelTier> = new Set<ModelTier>([
    'tier_1_premium',
    'tier_2_standard',
]);

export const MODEL_TIERS: readonly ModelTier[] = ['tier_1_premium', 'tier_2_standard', 'tier_3_efficient', 'tier_4_budget'];

/**
 * - `conversation` / `tool_calling`: the reply of a turn.
 * - `classify`: a short, strict-JSON, temperature-0 judgement that runs BEFORE
 *   the reply (the health safety triage today). It never decides tools and
 *   never writes, so it takes a fixed cheap chain: no value-based reordering,
 *   no tool-calling floor and no sticky affinity — the same message must reach
 *   the same model whatever the conversation did before.
 */
export type TaskType = 'conversation' | 'tool_calling' | 'classify';

export interface ModelConfig {
    id: string;
    provider: string;
    tier: ModelTier;
    /** Blended display rate (USD per 1k tokens). Kept for routing-decision display. */
    costPer1kTokens: number;
    /** Real input/output rates (USD per 1k tokens) — used for accurate cost tracking. */
    costInPer1k: number;
    costOutPer1k: number;
    /**
     * Entrada leída de la caché de prompts del proveedor (ADR-0027). Sin este
     * dato la caché se cobra a precio completo: el 52 % de la entrada de
     * sep–nov 2026 era caché y la estimación quedó 71 % por encima de la factura.
     */
    costCachedInPer1k?: number;
    /** Entrada escrita en caché; sólo Anthropic la cobra aparte (1,25× la entrada). */
    costCacheWritePer1k?: number;
    maxContextTokens: number;
    supportsTools: boolean;
    /** Página oficial de precios de donde salen las tarifas. Publicar la exige (ADR-0030 §4). */
    priceSourceUrl?: string;
    /** Fecha ISO (AAAA-MM-DD) en que se verificaron las tarifas. Publicar la exige. */
    priceCheckedAt?: string;
    /**
     * Retirado: no puede estar en ninguna cadena ni rol, pero se conserva para
     * contabilizar el gasto histórico (ADR-0027). Nada se borra del catálogo.
     */
    retired?: boolean;
}

/** Páginas oficiales de precios por proveedor, verificadas el 9-nov-2026 (ADR-0029). */
const SEED_PRICE_SOURCES: Record<string, string> = {
    openai: 'https://openai.com/api/pricing/',
    anthropic: 'https://www.anthropic.com/pricing#api',
    google: 'https://ai.google.dev/gemini-api/docs/pricing',
    xai: 'https://docs.x.ai/docs/models',
    deepseek: 'https://api-docs.deepseek.com/quick_start/pricing',
};
const SEED_PRICE_CHECKED_AT = '2026-11-09';

// Rates are USD per 1k tokens (provider list price / 1000), input vs output
// separated because output is typically 3-5× input. Update when providers
// change pricing. costPer1kTokens is a rough blended figure for display only.

/**
 * The one catalogue. Anything that needs to know what a model costs — the
 * router at runtime, a certification plan that has to state a maximum spend
 * before anyone authorises it — reads THIS, because a second copy of a price
 * list is a price list that will be wrong on the day it matters.
 */
const SEED_MODELS: ModelConfig[] = [
    // Catálogo migrado el 9-nov-2026 (ADR-0029). Precios de lista verificados ese día en la página
    // oficial de cada proveedor, USD por 1k tokens. Caché con la convención de ADR-0027: lectura en
    // `costCachedInPer1k`; escritura en `costCacheWritePer1k` sólo donde se cobra aparte (OpenAI
    // GPT-5.6+/GPT-6 y Anthropic, 1,25× la entrada a 30 min / 5 min).
    //
    // Tier 1 — Premium (enterprise/custom).
    { id: 'gpt-6-sol', provider: 'openai', tier: 'tier_1_premium', costPer1kTokens: 0.006, costInPer1k: 0.002, costOutPer1k: 0.010, costCachedInPer1k: 0.0002, costCacheWritePer1k: 0.0025, maxContextTokens: 1050000, supportsTools: true },
    // Sin clave de Anthropic en la plataforma (9-nov-2026): no medido, va al final de cada cadena.
    { id: 'claude-sonnet-5-5', provider: 'anthropic', tier: 'tier_1_premium', costPer1kTokens: 0.006, costInPer1k: 0.002, costOutPer1k: 0.010, costCachedInPer1k: 0.0001, costCacheWritePer1k: 0.0025, maxContextTokens: 1000000, supportsTools: true },
    // xAI no tiene hoy un modelo barato: grok-4.3 es el más barato de su lista ($1,25/$0,20/$2,50 por M
    // bajo 200k de prompt). Es el respaldo de otro proveedor cuando OpenAI y DeepSeek caen.
    { id: 'grok-4.3', provider: 'xai', tier: 'tier_1_premium', costPer1kTokens: 0.001875, costInPer1k: 0.00125, costOutPer1k: 0.0025, costCachedInPer1k: 0.0002, maxContextTokens: 200000, supportsTools: true },
    // Tier 2 — Standard (pro).
    { id: 'gpt-6-luna', provider: 'openai', tier: 'tier_2_standard', costPer1kTokens: 0.0003, costInPer1k: 0.0001, costOutPer1k: 0.0005, costCachedInPer1k: 0.00001, costCacheWritePer1k: 0.000125, maxContextTokens: 1050000, supportsTools: true },
    // Haiku 5.5 cobra 5× sobre 100k de prompt: el tope de contexto lo mantiene en su tarifa baja.
    { id: 'claude-haiku-5-5', provider: 'anthropic', tier: 'tier_2_standard', costPer1kTokens: 0.0003, costInPer1k: 0.0001, costOutPer1k: 0.0005, costCachedInPer1k: 0.00001, costCacheWritePer1k: 0.000125, maxContextTokens: 100000, supportsTools: true },
    { id: 'gpt-5.6-luna', provider: 'openai', tier: 'tier_2_standard', costPer1kTokens: 0.0007, costInPer1k: 0.0002, costOutPer1k: 0.0012, costCachedInPer1k: 0.00002, costCacheWritePer1k: 0.00025, maxContextTokens: 1050000, supportsTools: true },
    // Tier 3 — Efficient (starter). Google redirige gemini-2.5-flash a este modelo el 1-dic-2026.
    // Piensa en `minimal` y no se puede apagar. Sin herramientas: el adaptador no devuelve la
    // `thoughtSignature` que Gemini 3.x exige en el turno siguiente a una llamada de función.
    { id: 'gemini-3.5-flash-lite', provider: 'google', tier: 'tier_3_efficient', costPer1kTokens: 0.0014, costInPer1k: 0.0003, costOutPer1k: 0.0025, costCachedInPer1k: 0.00003, maxContextTokens: 1048576, supportsTools: false },
    // Tier 4 — Budget. Tarifa de hora pico (lun–vie 01–04 y 06–10 UTC); el resto del día cuesta la
    // mitad. Se cataloga la pico: el error queda del lado conservador.
    { id: 'deepseek-flash', provider: 'deepseek', tier: 'tier_4_budget', costPer1kTokens: 0.00075, costInPer1k: 0.0003, costOutPer1k: 0.0012, costCachedInPer1k: 0.000006, maxContextTokens: 1000000, supportsTools: true },
];

// Cadenas por tarea (ADR-0029). Dentro de cada una el orden es el de la medición QA del 9-nov:
// primero el mejor modelo barato, después otros proveedores para que un apagón de OpenAI (8-nov:
// sin créditos) no deje al agente sin respuesta, y lo premium al final.
//   ensayo de un turno (7 tenants)  ·  confirmación firmada (28 casos, mismo hash tras el «sí»)
//   gpt-6-luna   0,940 · 28/28      gpt-5.6-luna 0,927 · 12/28      deepseek-flash 0,914 · 19/28
//   gpt-6-sol    0,971 · 28/28      grok-4.3     0,925 · 26/28      (gpt-4o-mini, control: 0,874 · 11/28)
const SEED_CHAINS: Record<TaskType, string[]> = {
    conversation: [
        'gpt-6-luna',
        'deepseek-flash',
        'gemini-3.5-flash-lite',
        'claude-haiku-5-5',
        'gpt-5.6-luna',
        'gpt-6-sol',
        'grok-4.3',
        'claude-sonnet-5-5',
    ],
    tool_calling: [
        'gpt-6-luna',
        'claude-haiku-5-5',
        'gpt-5.6-luna',
        'deepseek-flash',
        'gpt-6-sol',
        'grok-4.3',
        'claude-sonnet-5-5',
    ],
    // Cheap, JSON-capable models first; a premium model only as the last
    // resort so a classification is still produced when the cheap providers
    // are down (an unavailable classifier degrades the safety triage).
    //
    // Esta cadena también es la del verificador de evidencia (pide `task:
    // 'classify'`, así que su `model` fijo no cuenta). Medido el 9-nov (ADR-0029):
    // con gpt-6-luna a la cabeza el verificador borraba la frase de traspaso y
    // dejaba «Claro que sí.» (C30 falló 4–9 veces por corrida); con
    // gemini-3.5-flash-lite, 0 fallos y el mejor resultado global (0,940).
    // deepseek-flash va tarde: es el juez del ensayo y no debe verificarse a sí mismo.
    classify: [
        'gemini-3.5-flash-lite',
        'gpt-5.6-luna',
        'gpt-6-luna',
        'deepseek-flash',
        'claude-haiku-5-5',
        'gpt-6-sol',
    ],
};

/**
 * Roles auxiliares (ADR-0030 §3): los servicios piden un rol, no un modelo.
 * Cada rol es una lista ordenada; quien llama por el router usa la cabeza, y
 * quien habla con un proveedor concreto (visión, feature-requests) toma el
 * primer modelo de ese proveedor.
 */
export type CatalogRole = 'aux_reasoning' | 'aux_cheap' | 'judge_rehearsal' | 'judge_quality' | 'vision';

export const CATALOG_ROLES: readonly CatalogRole[] = ['aux_reasoning', 'aux_cheap', 'judge_rehearsal', 'judge_quality', 'vision'];

const SEED_ROLES: Record<CatalogRole, string[]> = {
    // Copilot, consola del agente, handoff, reescritura, intérprete de intención,
    // nurturing, feature-requests, conflictos de conocimiento, extracción del onboarding.
    aux_reasoning: ['gpt-6-luna'],
    // Resúmenes de CRM: volumen alto y poco riesgo.
    aux_cheap: ['deepseek-flash'],
    // Juez del ensayo (rehearsal). No puede encabezar `conversation`, `tool_calling` ni `classify`.
    judge_rehearsal: ['deepseek-flash'],
    // Juez de calidad y de certificación.
    judge_quality: ['gpt-6-luna'],
    // Descripción de imágenes. Planes tier_3/4 usan Google si hay clave; el resto prueba xAI,
    // OpenAI y Google, en ese orden (image-vision.service).
    vision: ['gemini-3.5-flash-lite', 'grok-4.3', 'gpt-6-luna'],
};

export interface LlmCatalogSnapshot {
    /** 'seed' para la semilla de código; si no, el número de versión de `llm_catalog_versions`. */
    readonly version: string;
    readonly models: readonly Readonly<ModelConfig>[];
    readonly chains: Readonly<Record<TaskType, readonly string[]>>;
    readonly roles: Readonly<Record<CatalogRole, readonly string[]>>;
}

/** El contenido de una versión, sin el número: lo que se guarda en `snapshot` y lo que se compara. */
export interface LlmCatalogContent {
    models: ModelConfig[];
    chains: Record<TaskType, string[]>;
    roles: Record<CatalogRole, string[]>;
}

export const CATALOG_TASKS: readonly TaskType[] = ['conversation', 'tool_calling', 'classify'];
/** Proveedores con adaptador. Uno nuevo exige código (ADR-0030 §1). */
export const CATALOG_PROVIDERS: readonly string[] = ['openai', 'anthropic', 'google', 'xai', 'deepseek'];

/** Un modelo con sus campos en orden fijo y sin campos ajenos: así dos versiones iguales serializan igual. */
function canonicalModel(m: ModelConfig): ModelConfig {
    const out: ModelConfig = {
        id: m.id, provider: m.provider, tier: m.tier,
        costPer1kTokens: m.costPer1kTokens, costInPer1k: m.costInPer1k, costOutPer1k: m.costOutPer1k,
        maxContextTokens: m.maxContextTokens, supportsTools: m.supportsTools,
    };
    if (m.costCachedInPer1k != null) out.costCachedInPer1k = m.costCachedInPer1k;
    if (m.costCacheWritePer1k != null) out.costCacheWritePer1k = m.costCacheWritePer1k;
    if (m.priceSourceUrl) out.priceSourceUrl = m.priceSourceUrl;
    if (m.priceCheckedAt) out.priceCheckedAt = m.priceCheckedAt;
    if (m.retired) out.retired = true;
    return out;
}

function freezeSnapshot(version: string, s: LlmCatalogContent): LlmCatalogSnapshot {
    return Object.freeze({
        version,
        models: Object.freeze(s.models.map(m => Object.freeze(canonicalModel(m)))),
        chains: Object.freeze(Object.fromEntries(CATALOG_TASKS.map(k => [k, Object.freeze([...s.chains[k]])]))) as LlmCatalogSnapshot['chains'],
        roles: Object.freeze(Object.fromEntries(CATALOG_ROLES.map(k => [k, Object.freeze([...s.roles[k]])]))) as LlmCatalogSnapshot['roles'],
    });
}

/** La semilla de código. */
export const SEED_LLM_CATALOG: LlmCatalogSnapshot = freezeSnapshot('seed', {
    models: SEED_MODELS.map(m => ({ ...m, priceSourceUrl: SEED_PRICE_SOURCES[m.provider], priceCheckedAt: SEED_PRICE_CHECKED_AT })),
    chains: SEED_CHAINS,
    roles: SEED_ROLES,
});

let activeCatalog: LlmCatalogSnapshot = SEED_LLM_CATALOG;

/** La versión del catálogo que rige ahora. Toda lectura del catálogo pasa por aquí. */
export function activeLlmCatalog(): LlmCatalogSnapshot {
    return activeCatalog;
}

/**
 * Cambia la versión que rige en este proceso. Sólo la llama `LlmCatalogService`
 * al cargar o publicar, con un snapshot que ya pasó `parseLlmCatalogSnapshot`.
 */
export function setActiveLlmCatalog(snapshot: LlmCatalogSnapshot): void {
    activeCatalog = snapshot;
}

/** El contenido mutable de una versión, para guardarlo o editarlo en un borrador. */
export function catalogContent(snapshot: LlmCatalogSnapshot): LlmCatalogContent {
    return JSON.parse(JSON.stringify({ models: snapshot.models, chains: snapshot.chains, roles: snapshot.roles }));
}

/** Dos versiones con el mismo contenido (el número no cuenta). */
export function sameCatalogContent(a: LlmCatalogSnapshot, b: LlmCatalogSnapshot): boolean {
    return JSON.stringify(catalogContent(a)) === JSON.stringify(catalogContent(b));
}

const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const NUMERIC_FIELDS = ['costPer1kTokens', 'costInPer1k', 'costOutPer1k'] as const;
const OPTIONAL_NUMERIC_FIELDS = ['costCachedInPer1k', 'costCacheWritePer1k'] as const;

/**
 * Lee un snapshot que viene de la base o del API y lo devuelve congelado y en
 * forma canónica. Revisa sólo la FORMA (tipos, nombres de tareas y roles,
 * proveedores con adaptador); la coherencia la revisa `catalogIntegrityProblems`.
 */
export function parseLlmCatalogSnapshot(raw: unknown, version: string): { snapshot?: LlmCatalogSnapshot; problems: string[] } {
    const problems: string[] = [];
    const obj = raw as any;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { problems: ['snapshot_not_object'] };
    if (!Array.isArray(obj.models) || !obj.models.length) problems.push('models_not_array');
    const models: ModelConfig[] = [];
    for (const [i, m] of (Array.isArray(obj.models) ? obj.models : []).entries()) {
        const where = typeof m?.id === 'string' ? m.id : `#${i}`;
        if (!m || typeof m !== 'object') { problems.push(`model_not_object:${where}`); continue; }
        if (typeof m.id !== 'string' || !MODEL_ID_RE.test(m.id)) problems.push(`model_bad_id:${where}`);
        if (!CATALOG_PROVIDERS.includes(m.provider)) problems.push(`model_unknown_provider:${where}:${String(m.provider)}`);
        if (!MODEL_TIERS.includes(m.tier)) problems.push(`model_bad_tier:${where}`);
        for (const f of NUMERIC_FIELDS) if (typeof m[f] !== 'number' || !Number.isFinite(m[f]) || m[f] < 0) problems.push(`model_bad_${f}:${where}`);
        for (const f of OPTIONAL_NUMERIC_FIELDS) {
            if (m[f] != null && (typeof m[f] !== 'number' || !Number.isFinite(m[f]) || m[f] < 0)) problems.push(`model_bad_${f}:${where}`);
        }
        if (!Number.isInteger(m.maxContextTokens) || m.maxContextTokens <= 0) problems.push(`model_bad_maxContextTokens:${where}`);
        if (typeof m.supportsTools !== 'boolean') problems.push(`model_bad_supportsTools:${where}`);
        if (m.priceSourceUrl != null && typeof m.priceSourceUrl !== 'string') problems.push(`model_bad_priceSourceUrl:${where}`);
        if (m.priceCheckedAt != null && typeof m.priceCheckedAt !== 'string') problems.push(`model_bad_priceCheckedAt:${where}`);
        if (m.retired != null && typeof m.retired !== 'boolean') problems.push(`model_bad_retired:${where}`);
        models.push(m as ModelConfig);
    }
    const lists = (value: any, keys: readonly string[], kind: 'chain' | 'role'): Record<string, string[]> => {
        const out: Record<string, string[]> = {};
        if (!value || typeof value !== 'object' || Array.isArray(value)) { problems.push(`${kind}s_not_object`); return out; }
        for (const k of Object.keys(value)) if (!keys.includes(k)) problems.push(`unknown_${kind}:${k}`);
        for (const k of keys) {
            const list = value[k];
            if (!Array.isArray(list) || list.some(id => typeof id !== 'string')) problems.push(`${kind}_not_list:${k}`);
            else out[k] = [...list];
        }
        return out;
    };
    const chains = lists(obj.chains, CATALOG_TASKS, 'chain');
    const roles = lists(obj.roles, CATALOG_ROLES, 'role');
    if (problems.length) return { problems };
    return { snapshot: freezeSnapshot(version, { models, chains: chains as LlmCatalogContent['chains'], roles: roles as LlmCatalogContent['roles'] }), problems };
}

/** El modelo con ese id en la versión activa, o undefined. */
export function catalogModel(id: string, catalog: LlmCatalogSnapshot = activeLlmCatalog()): Readonly<ModelConfig> | undefined {
    return catalog.models.find(m => m.id === id);
}

/** Los modelos de un rol, en orden. */
export function roleModels(role: CatalogRole, catalog: LlmCatalogSnapshot = activeLlmCatalog()): readonly string[] {
    return catalog.roles[role];
}

/** La cabeza del rol: el modelo que usa quien llama por el router. */
export function roleModel(role: CatalogRole, catalog: LlmCatalogSnapshot = activeLlmCatalog()): string {
    return catalog.roles[role][0];
}

/** El primer modelo del rol servido por `provider`, para quien habla directo con un proveedor. */
export function roleModelForProvider(role: CatalogRole, provider: string, catalog: LlmCatalogSnapshot = activeLlmCatalog()): string | undefined {
    return catalog.roles[role].find(id => catalogModel(id, catalog)?.provider === provider);
}

/**
 * Cabezas de cadena o de rol que cambian entre dos versiones (ADR-0030 §4):
 * cambiar quién responde primero exige medición; bajar o retirar un modelo no.
 */
export function catalogHeadChanges(from: LlmCatalogSnapshot, to: LlmCatalogSnapshot): string[] {
    const changes: string[] = [];
    for (const task of CATALOG_TASKS) {
        if (from.chains[task][0] !== to.chains[task][0]) changes.push(`chain:${task}:${from.chains[task][0] ?? '-'}->${to.chains[task][0] ?? '-'}`);
    }
    for (const role of CATALOG_ROLES) {
        if (from.roles[role][0] !== to.roles[role][0]) changes.push(`role:${role}:${from.roles[role][0] ?? '-'}->${to.roles[role][0] ?? '-'}`);
    }
    return changes;
}

/**
 * Coherencia interna de un catálogo (bloqueantes 1, 2, 5, 6 y 7 de ADR-0030 §4,
 * más la parte de la regla 4 que no depende de las claves). Devuelve los
 * problemas; vacío es válido. No llama a ningún proveedor. La semilla la cumple (test).
 */
export function catalogIntegrityProblems(catalog: LlmCatalogSnapshot): string[] {
    const problems: string[] = [];
    const ids = new Set<string>();
    for (const m of catalog.models) {
        if (ids.has(m.id)) problems.push(`duplicate_model:${m.id}`);
        ids.add(m.id);
        if (!(m.costInPer1k > 0) || !(m.costOutPer1k > 0)) problems.push(`missing_price:${m.id}`);
        if (m.costCachedInPer1k == null) problems.push(`missing_cache_price:${m.id}`);
        // Un retirado ya no recibe llamadas: su familia puede haber salido del código.
        if (m.retired) continue;
        if (modelFamily(m.provider, m.id) === 'unknown') problems.push(`unknown_family:${m.provider}:${m.id}`);
        if (!/^https:\/\/\S+$/.test(m.priceSourceUrl ?? '')) problems.push(`missing_price_source:${m.id}`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(m.priceCheckedAt ?? '')) problems.push(`missing_price_checked_at:${m.id}`);
    }
    const retired = new Set(catalog.models.filter(m => m.retired).map(m => m.id));
    for (const task of CATALOG_TASKS) {
        const chain = catalog.chains[task] ?? [];
        if (!chain.length) problems.push(`empty_chain:${task}`);
        if (new Set(chain).size !== chain.length) problems.push(`chain_duplicate_model:${task}`);
        for (const id of chain) {
            if (!ids.has(id)) problems.push(`chain_unknown_model:${task}:${id}`);
            else if (retired.has(id)) problems.push(`retired_in_chain:${task}:${id}`);
        }
        const providers = new Set(chain.map(id => catalogModel(id, catalog)?.provider).filter(Boolean));
        if (providers.size < 2) problems.push(`chain_single_provider:${task}`);
    }
    const toolHead = catalogModel(catalog.chains.tool_calling?.[0] ?? '', catalog);
    if (toolHead && !toolHead.supportsTools) problems.push(`tool_calling_head_without_tools:${toolHead.id}`);
    if (toolHead && !TOOL_CALLING_LEAD_TIERS.has(toolHead.tier)) problems.push(`tool_calling_head_tier:${toolHead.id}:${toolHead.tier}`);
    for (const role of CATALOG_ROLES) {
        const list = catalog.roles[role] ?? [];
        if (!list.length) problems.push(`empty_role:${role}`);
        for (const id of list) {
            if (!ids.has(id)) problems.push(`role_unknown_model:${role}:${id}`);
            else if (retired.has(id)) problems.push(`retired_in_role:${role}:${id}`);
        }
    }
    // Jueces independientes (§3): el juez del ensayo no encabeza ninguna cadena que evalúa.
    const judge = catalog.roles.judge_rehearsal?.[0];
    for (const task of CATALOG_TASKS) {
        if (judge && catalog.chains[task]?.[0] === judge) problems.push(`judge_heads_chain:${task}:${judge}`);
    }
    return problems;
}
