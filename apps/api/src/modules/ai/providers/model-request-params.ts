/**
 * Parámetros que cada familia de modelos acepta o exige (ADR-0029).
 *
 * Los modelos de 2026 razonan por defecto y rechazan parámetros que los
 * adaptadores mandaban siempre. Todo lo verificado contra la API real el
 * 9-nov-2026 vive aquí, en funciones puras, para que un modelo nuevo se
 * habilite en un solo lugar y con un test:
 *
 * - OpenAI GPT-5.6+/GPT-6: `max_tokens` → 400 (exige `max_completion_tokens`).
 *   Razonan en `medium` por defecto. En Chat Completions las herramientas y una
 *   `temperature` distinta de 1 sólo se aceptan con `reasoning_effort: "none"`.
 * - Anthropic Claude 4.7+ / 5.x: `temperature`, `top_p` y `top_k` → 400 si no
 *   son los valores por defecto. Haiku 5.5 piensa por defecto y acepta
 *   `thinking: {type: "disabled"}`. Sonnet/Opus 5.x rechazan `disabled`; el
 *   mínimo es `between_tools` (sin pensamiento antes de la primera respuesta).
 * - DeepSeek `deepseek-flash`: piensa por defecto (75 tokens de razonamiento
 *   en un «sí, resérvala»). `thinking: {type: "disabled"}` lo apaga.
 * - xAI `grok-4.3`: razona por defecto (458 tokens, 7,7 s en la misma
 *   prueba). `reasoning_effort: "none"` lo apaga.
 *
 * Nuestro tráfico son turnos de ~30 tokens de salida con herramientas: el
 * razonamiento no está medido como mejora en el banco QA y multiplica costo y
 * latencia, así que se apaga donde se puede.
 */

/** OpenAI GPT-5.x/GPT-6.x y la serie o: modelos de razonamiento. */
export function isOpenAIReasoningModel(model: string): boolean {
    return /^(gpt-5|gpt-6|o\d)/.test(model);
}

/**
 * Campos que dependen del modelo en una llamada de Chat Completions de OpenAI.
 * Los modelos clásicos (gpt-4o, gpt-4.1) siguen con `max_tokens` y temperatura.
 */
export function openAIChatParams(model: string, opts: { temperature?: number; maxTokens?: number }): Record<string, unknown> {
    const temperature = Number(opts.temperature ?? 0.7);
    const max = opts.maxTokens != null ? Number(opts.maxTokens) : undefined;
    if (isOpenAIReasoningModel(model)) {
        return {
            reasoning_effort: 'none',
            temperature,
            ...(max != null ? { max_completion_tokens: max } : {}),
        };
    }
    return { temperature, ...(max != null ? { max_tokens: max } : {}) };
}

/**
 * OpenAI GPT-5.6 y posteriores (GPT-6.x incluido): la caché de prompts sólo se
 * busca y se escribe en límites exactos — el final de ciertos mensajes y los
 * `prompt_cache_breakpoint` — sin el redondeo a bloques de 128 tokens de los
 * modelos anteriores (ADR-0032). Los anteriores (gpt-4.1, gpt-5.5…) no tienen
 * el campo y siguen cacheando por prefijo.
 */
export function openAISupportsCacheBreakpoints(model: string): boolean {
    const m = /^gpt-(\d+)(?:\.(\d+))?(?:-|$)/.exec(model);
    if (!m) return false;
    const major = Number(m[1]);
    const minor = m[2] != null ? Number(m[2]) : 0;
    return major > 5 || (major === 5 && minor >= 6);
}

/**
 * Contenido del mensaje system de OpenAI. Con un prefijo estable conocido
 * (contrato + persona) y un modelo con breakpoints, el texto se parte en dos
 * bloques y el primero lleva `prompt_cache_breakpoint`: así ese prefijo se
 * escribe y se relee entre turnos y conversaciones aunque el bloque <turn> que
 * le sigue cambie en cada llamada. Los dos bloques concatenados son el texto
 * original, carácter por carácter.
 */
export function openAISystemContent(
    model: string, systemPrompt: string, cacheableChars: number | undefined, breakpoints = true,
): string | Array<{ type: 'text'; text: string; prompt_cache_breakpoint?: { mode: 'explicit' } }> {
    if (!breakpoints || !openAISupportsCacheBreakpoints(model)) return systemPrompt;
    const cut = Number(cacheableChars);
    if (!Number.isInteger(cut) || cut <= 0 || cut >= systemPrompt.length) return systemPrompt;
    return [
        { type: 'text', text: systemPrompt.slice(0, cut), prompt_cache_breakpoint: { mode: 'explicit' } },
        { type: 'text', text: systemPrompt.slice(cut) },
    ];
}

/** xAI: grok-4.3 y posteriores razonan por defecto; el slug retirado ya llegaba con `none`. */
export function xaiChatParams(model: string, opts: { temperature?: number; maxTokens?: number }): Record<string, unknown> {
    const reasons = /^grok-4\.(?:[3-9]|\d{2})/.test(model);
    return {
        temperature: Number(opts.temperature ?? 0.7),
        ...(opts.maxTokens != null ? { max_tokens: Number(opts.maxTokens) } : {}),
        ...(reasons ? { reasoning_effort: 'none' } : {}),
    };
}

/** DeepSeek: todo nombre salvo `deepseek-reasoner` va sin razonamiento. */
export function deepseekChatExtras(model: string): Record<string, unknown> {
    return model === 'deepseek-reasoner' ? {} : { thinking: { type: 'disabled' } };
}

/** Generación de Claude: [familia, mayor, menor] o null si el id no sigue el patrón. */
function claudeVersion(model: string): { family: string; major: number; minor: number } | null {
    const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(model);
    if (!m) return null;
    return { family: m[1], major: Number(m[2]), minor: m[3] != null ? Number(m[3]) : 0 };
}

/** Claude 4.7+ y 5.x rechazan muestreo no por defecto; los anteriores lo aceptan. */
export function anthropicAcceptsSampling(model: string): boolean {
    const v = claudeVersion(model);
    if (!v) return true;
    return v.major < 4 || (v.major === 4 && v.minor < 7);
}

/**
 * El pensamiento mínimo que acepta cada Claude. Haiku 5.x: apagado. Sonnet,
 * Opus y Fable 5.x: `between_tools`. Los anteriores no piensan si no se pide.
 */
export function anthropicThinkingParam(model: string): { type: 'disabled' | 'between_tools' } | undefined {
    const v = claudeVersion(model);
    if (!v || v.major < 5) return undefined;
    return v.family === 'haiku' ? { type: 'disabled' } : { type: 'between_tools' };
}

/** Campos de muestreo y pensamiento de una llamada a Anthropic. */
export function anthropicRequestParams(model: string, opts: { temperature?: number }): Record<string, unknown> {
    const thinking = anthropicThinkingParam(model);
    return {
        ...(anthropicAcceptsSampling(model) ? { temperature: Number(opts.temperature ?? 0.7) } : {}),
        ...(thinking ? { thinking } : {}),
    };
}

/**
 * Razonamiento mínimo de Gemini. 2.x lo apaga con `thinkingBudget: 0`; 3.x no
 * acepta presupuesto (400 INVALID_ARGUMENT) y su mínimo es `thinkingLevel: "minimal"`.
 */
export function geminiThinkingConfig(model: string): Record<string, unknown> {
    return /^gemini-2\./.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: 'minimal' };
}

/**
 * Familias cuyos parámetros están verificados en este archivo (ADR-0030 §4).
 * Un modelo sólo puede entrar al catálogo si su familia es conocida: uno de una
 * familia nueva (gpt-7, gemini-4, claude-6…) puede exigir o rechazar parámetros
 * que no sabemos, y fallaría con 400 en la primera llamada. Para habilitar una
 * familia nueva: verificar contra la API real, ajustar las funciones de arriba,
 * agregarla aquí y en el test.
 */
export type ModelFamily =
    | 'openai_classic' | 'openai_reasoning'
    | 'anthropic_sampling' | 'anthropic_no_sampling'
    | 'gemini_2' | 'gemini_3'
    | 'xai_reasoning'
    | 'deepseek'
    | 'unknown';

export function modelFamily(provider: string, model: string): ModelFamily {
    switch (provider) {
        case 'openai':
            if (/^(gpt-5|gpt-6)(?:[.-]|$)/.test(model) || /^o\d/.test(model)) return 'openai_reasoning';
            if (/^gpt-4(?:o|\.1)(?:-|$)/.test(model)) return 'openai_classic';
            return 'unknown';
        case 'anthropic': {
            const v = claudeVersion(model);
            if (!v || v.major > 5) return 'unknown';
            return anthropicAcceptsSampling(model) ? 'anthropic_sampling' : 'anthropic_no_sampling';
        }
        case 'google':
            if (/^gemini-2\./.test(model)) return 'gemini_2';
            if (/^gemini-3\./.test(model)) return 'gemini_3';
            return 'unknown';
        case 'xai':
            return /^grok-4\.(?:[3-9]|\d{2})(?:-|$)/.test(model) ? 'xai_reasoning' : 'unknown';
        case 'deepseek':
            return /^deepseek-(?:flash|chat|reasoner)$/.test(model) ? 'deepseek' : 'unknown';
        default:
            return 'unknown';
    }
}
