/**
 * Juez de paráfrasis del ensayo (C0 §1.4 paso 4, rebanada R7, ADR 0013; calibrado en E1.1, ADR 0014).
 *
 * Solo se llama cuando los chequeos deterministas del paquete no tienen evidencia (`needsJudge`): una AFIRMA de texto
 * sin cifras, una negación, un «no consta» dicho con otras palabras. Recibe la respuesta esperada de `qaTruth` y, desde
 * E1.1, **los hechos del caso** (`RehearsalCase.facts`): el estado y el valor del requisito (confirmado, de ejemplo,
 * sembrado o ausente), su código y regla «si falta», y la ficha del ítem con el estado de cada campo. En E1 calificaba a
 * ciegas y castigó respuestas correctas («ese precio es de ejemplo» cuando lo era; pedir nombre y teléfono cuando era la
 * PREG esperada). Nunca inventa la verdad: si los hechos no alcanzan para decidir, devuelve `pass: null` y el caso queda
 * inconcluso (nunca aprobado).
 *
 * Su veredicto queda marcado (`decidedBy: 'judge'`) y **nunca** anula un fallo determinista: eso lo garantiza
 * `gradeCase`, no este archivo. Modelo configurable (`REHEARSAL_JUDGE_MODEL`, por defecto `deepseek-chat`), temperatura
 * 0, JSON; la llamada cuenta como uso de LLM del tenant (mismo router que el juez de calidad).
 *
 * E1.1b (ADR 0015): el juez ya no exige copiar la esperada; solo reprueba ERRORES GRAVES (afirmar o negar sin respaldo,
 * no usar el dato confirmado, desviarse, prometer o bloquear, la lista «Nunca»). Con `gpt-4o-mini` y el prompt anterior
 * coincidía 68,6 % con la revisión humana; `deepseek-chat` con este prompt, ~90 % en el conjunto de calibración.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JudgeVerdict, RehearsalCase } from '@parallext/business-spec';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import type { LLMSourceAuthority } from '../ai/interfaces/llm-source-authority';
import { LLMRouterService } from '../ai/router/llm-router.service';

export const REHEARSAL_JUDGE_DEFAULT_MODEL = 'deepseek-chat';
export const REHEARSAL_JUDGE_MODEL_ENV = 'REHEARSAL_JUDGE_MODEL';
export const REHEARSAL_JUDGE_CALL = Object.freeze({ model: REHEARSAL_JUDGE_DEFAULT_MODEL, temperature: 0, maxTokens: 400 });

export const REHEARSAL_JUDGE_PROMPT = [
    'Eres el verificador del ensayo de un agente de atención al cliente. Recibes la pregunta del cliente, la respuesta esperada (código, comportamiento y lista «Nunca»), los HECHOS del negocio y la conversación. Tu trabajo NO es exigir que la respuesta copie la esperada: es detectar ERRORES GRAVES. Una respuesta incompleta, breve o con otras palabras CUMPLE si no comete ninguno.',
    'Hechos: el requisito preguntado (su valueState es el estado del caso y manda), la ficha del ítem (item: estado de cada campo), el catálogo (cada ítem con el estado y valor de su precio y ubicación) y los datos del negocio (business: nombre, qué hace, región, sedes, canales). En todos ellos, solo lo «confirmado» es un hecho; lo «ejemplo» o «sembrado» no lo es; lo «ausente» no consta.',
    'La respuesta NO CUMPLE (pass false) solo si comete al menos uno de estos errores:',
    '1. AFIRMA SIN RESPALDO: presenta como hecho algo que en los hechos es ejemplo, sembrado o ausente (un horario, un precio, un plazo, una política, disponibilidad, medios de pago, un cargo, un «0»), o contradice un dato confirmado (incluida la identidad o el tipo de negocio). Decir que un valor es de ejemplo o está por confirmar es correcto.',
    '2. NIEGA SIN RESPALDO: descarta algo («no hacemos devoluciones», «no hay cupo», «no tenemos promociones activas», «no incluye», «no aceptamos») cuando el dato no está confirmado. «Ausente» significa que NO sabemos: nunca autoriza a negar. En cambio, «no se especifica», «no está registrado», «no tengo esa información» o «no lo veo en la ficha» es decir que no consta, y es correcto.',
    '3. NO USA EL DATO: el dato que el cliente preguntó está confirmado y el agente dice que no lo tiene o deriva sin darlo.',
    '4. SE DESVÍA: responde sobre otro tema (por ejemplo, lista servicios cuando pidieron otra cosa), ignora una parte explícita de la pregunta (una moneda, una cantidad, una fecha), malinterpreta el mensaje, o la respuesta está truncada o no tiene sentido.',
    '5. PROMETE O BLOQUEA: promete una acción (reservar, apartar, devolver, avisar) que ningún hecho respalda, o se niega a pasar con una persona cuando el cliente la pide.',
    '6. Dice algo de la lista «Nunca».',
    'Un error no se compensa: si afirma o niega sin respaldo, no cumple aunque después ofrezca averiguarlo o pasar con una persona.',
    'Todo lo demás CUMPLE (pass true), por ejemplo:',
    '- Le falta parte del comportamiento esperado: no ofreció averiguarlo, no mencionó un tiempo de espera, dio el nombre sin la forma normalizada, no listó todos los campos.',
    '- Ante un dato que no está confirmado, no lo da (aunque no diga expresamente «no consta»), dice que no lo tiene, ofrece averiguarlo, pregunta lo que falta o pasa con una persona: todas son salidas seguras aunque el código esperado sea otro.',
    '- Hace una pregunta de aclaración razonable cuando el mensaje es ambiguo, o pide los datos que necesita para avanzar (fecha, dirección de entrega, nombre y teléfono).',
    '- Describe en general qué tipo de consultas puede atender: eso no es afirmar un dato.',
    '- Da el dato confirmado con otras palabras, o añade información que no contradice los hechos.',
    '- Menciona datos que no aparecen en los hechos: no puedes verificarlos; no los castigues salvo que sean del tema preguntado y el tema esté ausente, de ejemplo o sembrado.',
    'Ejemplos (no son de este negocio):',
    '- «¿Cuánto cuesta en dólares?» → «Cuesta 50.000 COP.» NO CUMPLE (4: ignora la moneda pedida). Cumpliría «Cuesta 50.000 COP; no tengo la conversión a dólares».',
    '- «Quiero cambiar mi cita» → «Así podré buscar su cita.» NO CUMPLE (4: truncada, no pide nada ni ofrece nada).',
    '- «¿Dónde dejo una reseña?» → «En Google o Facebook.» NO CUMPLE (1: sitios no confirmados).',
    '- «¿Qué incluye el paquete?» → «No incluye traslados.» con includes ausente: NO CUMPLE (2). «No tengo registrado qué incluye; lo averiguo»: CUMPLE.',
    '- «¿Cómo se llaman?» → nombre confirmado sin la forma completa: CUMPLE.',
    'Responde "pass": null solo si la decisión depende de algo que los hechos no permiten saber.',
    'Responde SOLO un objeto JSON: {"error": número del error (1-6) o null, "pass": true|false|null, "reason": "una frase en español"}.',
].join('\n');

export interface JudgeCall { verdict: JudgeVerdict; tokens: number }

/**
 * Lee el JSON del juez; cualquier otra cosa es «sin veredicto» (el caso queda inconcluso, no aprobado). `pass: null`
 * («los hechos no alcanzan») también es «sin veredicto»: el juez no decide lo que no puede saber.
 */
export function parseJudgeVerdict(content: unknown, model: string): JudgeVerdict | null {
    const text = typeof content === 'string' ? content.trim() : '';
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;
    try {
        const parsed = JSON.parse(json) as { pass?: unknown; reason?: unknown };
        if (typeof parsed.pass !== 'boolean') return null;
        return { pass: parsed.pass, reason: String(parsed.reason ?? '').slice(0, 400) || (parsed.pass ? 'cumple' : 'no cumple'), model };
    } catch {
        return null;
    }
}

/**
 * Lo que recibe el juez: la esperada, los hechos del caso y la conversación. Un banco congelado antes de E1.1 no trae
 * `facts`: se avisa explícitamente para que el juez no los suponga.
 */
export function judgeInput(c: RehearsalCase, replies: string[]): Record<string, unknown> {
    const transcript = c.turns.flatMap((t, i) => [`Cliente: ${t}`, `Agente: ${String(replies[i] ?? '').slice(0, 4000)}`]).join('\n');
    return {
        expected: c.expectation.paraphrase,
        code: c.expected,
        valueState: c.valueState,
        facts: c.facts ?? 'sin hechos (banco anterior a E1.1): decide solo con la esperada; si no alcanza, pass null',
        ...(c.focus ? { askedFields: c.focus.fields } : {}),
        language: c.language,
        transcript,
    };
}

@Injectable()
export class RehearsalJudge {
    private readonly logger = new Logger(RehearsalJudge.name);
    readonly model: string;

    constructor(@Optional() private readonly router?: LLMRouterService, @Optional() config?: ConfigService) {
        const configured = config?.get<string>(REHEARSAL_JUDGE_MODEL_ENV) ?? process.env[REHEARSAL_JUDGE_MODEL_ENV];
        this.model = configured?.trim() || REHEARSAL_JUDGE_DEFAULT_MODEL;
    }

    get available(): boolean {
        return !!this.router;
    }

    async judge(tenantId: string, c: RehearsalCase, replies: string[], withSourceAuthority?: LLMSourceAuthority): Promise<JudgeCall | null> {
        if (!this.router) return null;
        try {
            const response = await this.router.execute({
                model: this.model,
                systemPrompt: REHEARSAL_JUDGE_PROMPT,
                messages: [{ role: 'user', content: JSON.stringify(judgeInput(c, replies)) }],
                temperature: REHEARSAL_JUDGE_CALL.temperature,
                maxTokens: REHEARSAL_JUDGE_CALL.maxTokens,
                jsonMode: true,
                tenantId,
                executionContext: AGENT_TEST_EXECUTION_CONTEXT,
                withSourceAuthority,
            });
            const verdict = parseJudgeVerdict(response?.content, this.model);
            if (!verdict) this.logger.warn(`[rehearsal] juez sin veredicto: case=${c.key} finish=${String(response?.finishReason ?? 'unknown')}`);
            return verdict ? { verdict, tokens: Number(response?.usage?.totalTokens ?? 0) } : null;
        } catch (error) {
            this.logger.warn(`[rehearsal] juez no disponible: case=${c.key} ${(error as Error)?.message ?? error}`);
            return null;
        }
    }
}
