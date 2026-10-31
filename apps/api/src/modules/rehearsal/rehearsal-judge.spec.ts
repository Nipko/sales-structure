import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fromLegacyRows, generateRehearsal, type RehearsalCase } from '@parallext/business-spec';
import { loadSpec } from '@parallext/business-spec/load';
import { judgeInput, parseJudgeVerdict, RehearsalJudge, REHEARSAL_JUDGE_DEFAULT_MODEL, REHEARSAL_JUDGE_PROMPT } from './rehearsal-judge';

/**
 * Juez de paráfrasis (R7, calibrado en E1.1, ADR 0014): recibe los hechos del caso (estado y valor del requisito, regla
 * «si falta», ficha del ítem), no inventa la verdad (`pass: null` = sin veredicto) y su modelo es configurable. El LLM
 * se simula: lo que se prueba es lo que se le envía y cómo se lee lo que devuelve.
 */
const spec = loadSpec();
const FIXTURES = resolve(__dirname, '../../../../../packages/business-spec/test/fixtures/qa-tenants');
const snapshotOf = (slug: string) => fromLegacyRows(JSON.parse(readFileSync(resolve(FIXTURES, `${slug}.snapshot.json`), 'utf8')));
const bank = generateRehearsal(spec, snapshotOf('spark-qa-dental-03'), { seed: 'e1' });

function routerReturning(content: string) {
    return { execute: jest.fn(async (_req: any) => ({ content, usage: { totalTokens: 77 }, finishReason: 'stop' })) };
}

describe('RehearsalJudge', () => {
    it('envía los hechos del caso: estado del requisito, regla «si falta» y, si nombra un ítem, su ficha con estados', async () => {
        const c = bank.cases.find(x => x.itemId) ?? bank.cases[0];
        const router = routerReturning('{"pass": true, "reason": "cumple"}');
        const judge = new RehearsalJudge(router as any);
        const call = await judge.judge('t1', c, ['respuesta']);
        expect(call).toEqual({ verdict: { pass: true, reason: 'cumple', model: REHEARSAL_JUDGE_DEFAULT_MODEL }, tokens: 77 });
        const req = router.execute.mock.calls[0][0];
        expect(req).toMatchObject({ model: REHEARSAL_JUDGE_DEFAULT_MODEL, temperature: 0, jsonMode: true, tenantId: 't1', systemPrompt: REHEARSAL_JUDGE_PROMPT });
        const sent = JSON.parse(req.messages[0].content);
        expect(sent.facts.requirement).toMatchObject({ id: c.requirementIds[0], valueState: c.facts.requirement.valueState });
        expect(sent.facts.requirement.whenMissing.code).toBe(spec.requirements[c.requirementIds[0]].whenMissing.code);
        if (c.itemId) expect(Object.values(sent.facts.item.fields).every((f: any) => typeof f.state === 'string')).toBe(true);
        expect(sent.transcript).toContain('Agente: respuesta');
    });

    it('el prompt dice que «de ejemplo» no es un hecho y que sin hechos suficientes no decide', () => {
        expect(REHEARSAL_JUDGE_PROMPT).toMatch(/«ejemplo» o «sembrado» no es un hecho/);
        expect(REHEARSAL_JUDGE_PROMPT).toMatch(/"pass": null/);
    });

    it('«pass: null» o un JSON ilegible es «sin veredicto» (el caso queda inconcluso, nunca aprobado)', async () => {
        expect(parseJudgeVerdict('{"pass": null, "reason": "no alcanza"}', 'm')).toBeNull();
        expect(parseJudgeVerdict('quizás', 'm')).toBeNull();
        expect(parseJudgeVerdict('```json\n{"pass": false, "reason": "niega sin dato"}\n```', 'm')).toEqual({ pass: false, reason: 'niega sin dato', model: 'm' });
        const judge = new RehearsalJudge(routerReturning('{"pass": null, "reason": "los hechos no alcanzan"}') as any);
        expect(await judge.judge('t1', bank.cases[0], ['x'])).toBeNull();
    });

    it('modelo configurable con REHEARSAL_JUDGE_MODEL; por defecto el de siempre', async () => {
        const config = { get: jest.fn((k: string) => (k === 'REHEARSAL_JUDGE_MODEL' ? 'gpt-4.1' : undefined)) };
        const router = routerReturning('{"pass": false, "reason": "no"}');
        const judge = new RehearsalJudge(router as any, config as any);
        expect(judge.model).toBe('gpt-4.1');
        await judge.judge('t1', bank.cases[0], ['x']);
        expect(router.execute.mock.calls[0][0].model).toBe('gpt-4.1');
        expect(new RehearsalJudge(router as any, { get: () => '  ' } as any).model).toBe(REHEARSAL_JUDGE_DEFAULT_MODEL);
    });

    it('un banco congelado antes de E1.1 (sin hechos) lo dice explícitamente', () => {
        const { facts: _facts, ...old } = bank.cases[0];
        const sent = judgeInput(old as unknown as RehearsalCase, ['x']);
        expect(String(sent.facts)).toMatch(/sin hechos/);
    });

    it('sin router no hay juez; un error del router es «sin veredicto»', async () => {
        expect(new RehearsalJudge().available).toBe(false);
        expect(await new RehearsalJudge().judge('t1', bank.cases[0], ['x'])).toBeNull();
        const failing = { execute: jest.fn(async () => { throw new Error('cuota'); }) };
        expect(await new RehearsalJudge(failing as any).judge('t1', bank.cases[0], ['x'])).toBeNull();
    });
});
