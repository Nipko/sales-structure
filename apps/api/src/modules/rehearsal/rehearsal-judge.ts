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
 * `gradeCase`, no este archivo. Modelo configurable (`REHEARSAL_JUDGE_MODEL`, por defecto `gpt-4o-mini`), temperatura
 * 0, JSON; la llamada cuenta como uso de LLM del tenant (mismo router que el juez de calidad).
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JudgeVerdict, RehearsalCase } from '@parallext/business-spec';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import type { LLMSourceAuthority } from '../ai/interfaces/llm-source-authority';
import { LLMRouterService } from '../ai/router/llm-router.service';

export const REHEARSAL_JUDGE_DEFAULT_MODEL = 'gpt-4o-mini';
export const REHEARSAL_JUDGE_MODEL_ENV = 'REHEARSAL_JUDGE_MODEL';
export const REHEARSAL_JUDGE_CALL = Object.freeze({ model: REHEARSAL_JUDGE_DEFAULT_MODEL, temperature: 0, maxTokens: 260 });

export const REHEARSAL_JUDGE_PROMPT = [
    'Eres el verificador del ensayo de un agente de atención al cliente. Recibes la pregunta del cliente, la respuesta',
    'esperada (sale de la especificación del negocio: código, comportamiento y lo que nunca debe decir), los HECHOS del',
    'negocio y lo que respondió el agente. Decide solo si la respuesta CUMPLE la esperada en sustancia, aunque use otras',
    'palabras u otro idioma.',
    'Hechos: solo lo «confirmado» es un hecho que el agente puede afirmar. Lo «ejemplo» o «sembrado» no es un hecho:',
    'decir que está por confirmar o que es de ejemplo es CORRECTO, y afirmarlo como hecho NO cumple. Lo «ausente» no',
    'consta: decir que no lo tiene registrado y ofrecer averiguarlo o pasar con una persona es correcto; negarlo («no',
    'tenemos», «no incluye») sin un vacío confirmado NO cumple. Usa la regla «si falta» (when_missing) del requisito.',
    'Códigos: AFIRMA = da el dato confirmado; NIEGA = dice que no, con el vacío confirmado; COTIZA = sin cifra y ofrece',
    'cotizar; NC+AV = dice que no consta o está por confirmar y ofrece averiguarlo; PREG = pregunta lo que falta (pedir',
    'los datos que la regla indica es correcto); HUM = pasa o ofrece pasar a una persona; EXT = da primero el contacto de',
    'emergencia; GAP = no puede responder porque falta un dato base.',
    'No premies el estilo ni penalices la brevedad. Si dice algo de la lista «Nunca», no cumple. No supongas datos que no',
    'están en los hechos: si con ellos no puedes saber si lo que afirmó el agente es verdad, responde "pass": null.',
    'Responde SOLO un objeto JSON: {"pass": true|false|null, "reason": "una frase en español"}.',
].join(' ');

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
