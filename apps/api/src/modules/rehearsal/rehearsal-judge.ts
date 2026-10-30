/**
 * Juez de paráfrasis del ensayo (C0 §1.4 paso 4, rebanada R7, ADR 0013).
 *
 * Solo se llama cuando los chequeos deterministas del paquete no tienen evidencia (`needsJudge`): una AFIRMA de texto
 * sin cifras, una negación, un «no consta» dicho con otras palabras. Recibe la respuesta esperada de `qaTruth` (nunca
 * la adivina) y contesta si la respuesta del agente la cumple. Su veredicto queda marcado (`decidedBy: 'judge'`) y
 * **nunca** anula un fallo determinista: eso lo garantiza `gradeCase`, no este archivo.
 *
 * Modelo fijo y barato, temperatura 0, JSON; la llamada cuenta como uso de LLM del tenant (mismo router que el juez de
 * calidad) y sus tokens se suman al costo del ensayo.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { JudgeVerdict, RehearsalCase } from '@parallext/business-spec';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import type { LLMSourceAuthority } from '../ai/interfaces/llm-source-authority';
import { LLMRouterService } from '../ai/router/llm-router.service';

export const REHEARSAL_JUDGE_CALL = Object.freeze({ model: 'gpt-4o-mini', temperature: 0, maxTokens: 220 });

export const REHEARSAL_JUDGE_PROMPT = [
    'Eres el verificador del ensayo de un agente de atención al cliente. Recibes la pregunta del cliente, la respuesta',
    'esperada (sale de la especificación del negocio: código, comportamiento, dato confirmado y lo que nunca debe decir)',
    'y lo que respondió el agente. Decide solo si la respuesta CUMPLE la esperada en sustancia, aunque use otras palabras',
    'u otro idioma. Códigos: AFIRMA = da el dato confirmado; NIEGA = dice que no, con el vacío confirmado; COTIZA = sin',
    'cifra y ofrece cotizar; NC+AV = dice que no consta o está por confirmar y ofrece averiguarlo; PREG = pregunta lo que',
    'falta; HUM = pasa a una persona; EXT = da primero el contacto de emergencia; GAP = no puede responder porque falta un',
    'dato base. No premies el estilo ni penalices la brevedad. Si dice algo de la lista «Nunca», no cumple.',
    'Responde SOLO un objeto JSON: {"pass": true|false, "reason": "una frase en español"}.',
].join(' ');

export interface JudgeCall { verdict: JudgeVerdict; tokens: number }

/** Lee el JSON del juez; cualquier otra cosa es «sin veredicto» (el caso queda inconcluso, no aprobado). */
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

@Injectable()
export class RehearsalJudge {
    private readonly logger = new Logger(RehearsalJudge.name);

    constructor(@Optional() private readonly router?: LLMRouterService) {}

    get available(): boolean {
        return !!this.router;
    }

    async judge(tenantId: string, c: RehearsalCase, replies: string[], withSourceAuthority?: LLMSourceAuthority): Promise<JudgeCall | null> {
        if (!this.router) return null;
        const transcript = c.turns.flatMap((t, i) => [`Cliente: ${t}`, `Agente: ${String(replies[i] ?? '').slice(0, 4000)}`]).join('\n');
        try {
            const response = await this.router.execute({
                model: REHEARSAL_JUDGE_CALL.model,
                systemPrompt: REHEARSAL_JUDGE_PROMPT,
                messages: [{ role: 'user', content: JSON.stringify({ expected: c.expectation.paraphrase, language: c.language, transcript }) }],
                temperature: REHEARSAL_JUDGE_CALL.temperature,
                maxTokens: REHEARSAL_JUDGE_CALL.maxTokens,
                jsonMode: true,
                tenantId,
                executionContext: AGENT_TEST_EXECUTION_CONTEXT,
                withSourceAuthority,
            });
            const verdict = parseJudgeVerdict(response?.content, REHEARSAL_JUDGE_CALL.model);
            if (!verdict) this.logger.warn(`[rehearsal] juez sin veredicto legible: case=${c.key} finish=${String(response?.finishReason ?? 'unknown')}`);
            return verdict ? { verdict, tokens: Number(response?.usage?.totalTokens ?? 0) } : null;
        } catch (error) {
            this.logger.warn(`[rehearsal] juez no disponible: case=${c.key} ${(error as Error)?.message ?? error}`);
            return null;
        }
    }
}
