/**
 * El catálogo LLM: qué modelos existen, cuánto cuestan, en qué orden responde
 * cada tarea y qué modelo cumple cada rol auxiliar (ADR-0029, ADR-0030).
 *
 * Fase 1 de ADR-0030: todo lector del catálogo pasa por `activeLlmCatalog()`.
 * Hoy la versión activa es siempre la semilla de este archivo; en la fase 2
 * la carga `LlmCatalogService` desde `llm_catalog_versions` y esta semilla
 * queda como versión de arranque y último recurso si Postgres no responde.
 */
import type { ModelTier } from '@parallext/shared';
import { modelFamily } from '../providers/model-request-params';

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
}

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
    /** 'seed' para la semilla de código; el número de versión en la fase 2. */
    readonly version: string;
    readonly models: readonly Readonly<ModelConfig>[];
    readonly chains: Readonly<Record<TaskType, readonly string[]>>;
    readonly roles: Readonly<Record<CatalogRole, readonly string[]>>;
}

function freezeSnapshot(s: { version: string; models: ModelConfig[]; chains: Record<TaskType, string[]>; roles: Record<CatalogRole, string[]> }): LlmCatalogSnapshot {
    return Object.freeze({
        version: s.version,
        models: Object.freeze(s.models.map(m => Object.freeze({ ...m }))),
        chains: Object.freeze(Object.fromEntries(Object.entries(s.chains).map(([k, v]) => [k, Object.freeze([...v])]))) as LlmCatalogSnapshot['chains'],
        roles: Object.freeze(Object.fromEntries(Object.entries(s.roles).map(([k, v]) => [k, Object.freeze([...v])]))) as LlmCatalogSnapshot['roles'],
    });
}

/** La semilla de código. */
export const SEED_LLM_CATALOG: LlmCatalogSnapshot = freezeSnapshot({
    version: 'seed', models: SEED_MODELS, chains: SEED_CHAINS, roles: SEED_ROLES,
});

const activeCatalog: LlmCatalogSnapshot = SEED_LLM_CATALOG;

/** La versión del catálogo que rige ahora. Toda lectura del catálogo pasa por aquí. */
export function activeLlmCatalog(): LlmCatalogSnapshot {
    return activeCatalog;
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
 * Coherencia interna de un catálogo: lo que la fase 2 exige antes de publicar
 * una versión y que la semilla ya cumple (test). Devuelve los problemas; vacío
 * es válido. No llama a ningún proveedor.
 */
export function catalogIntegrityProblems(catalog: LlmCatalogSnapshot): string[] {
    const problems: string[] = [];
    const ids = new Set<string>();
    for (const m of catalog.models) {
        if (ids.has(m.id)) problems.push(`duplicate_model:${m.id}`);
        ids.add(m.id);
        if (!(m.costInPer1k > 0) || !(m.costOutPer1k > 0)) problems.push(`missing_price:${m.id}`);
        if (m.costCachedInPer1k == null) problems.push(`missing_cache_price:${m.id}`);
        if (modelFamily(m.provider, m.id) === 'unknown') problems.push(`unknown_family:${m.provider}:${m.id}`);
    }
    for (const [task, chain] of Object.entries(catalog.chains)) {
        if (!chain.length) problems.push(`empty_chain:${task}`);
        for (const id of chain) if (!ids.has(id)) problems.push(`chain_unknown_model:${task}:${id}`);
        const providers = new Set(chain.map(id => catalogModel(id, catalog)?.provider).filter(Boolean));
        if (providers.size < 2) problems.push(`chain_single_provider:${task}`);
    }
    const toolHead = catalogModel(catalog.chains.tool_calling[0] ?? '', catalog);
    if (toolHead && !toolHead.supportsTools) problems.push(`tool_calling_head_without_tools:${toolHead.id}`);
    for (const role of CATALOG_ROLES) {
        const list = catalog.roles[role] ?? [];
        if (!list.length) problems.push(`empty_role:${role}`);
        for (const id of list) if (!ids.has(id)) problems.push(`role_unknown_model:${role}:${id}`);
    }
    const judge = catalog.roles.judge_rehearsal?.[0];
    for (const task of ['conversation', 'tool_calling', 'classify'] as TaskType[]) {
        if (judge && catalog.chains[task]?.[0] === judge) problems.push(`judge_heads_chain:${task}:${judge}`);
    }
    return problems;
}
