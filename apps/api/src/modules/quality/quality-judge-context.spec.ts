import { qualityJudgeContext, qualityJudgeScopeHash } from './quality-judge-context';
import { RUBRIC_PROMPT, QUALITY_RUBRIC_HASH } from './quality-rubric';
import { CURRENT_QUALITY_CTE, QUALITY_RUBRIC_VERSION } from './quality-evidence';

const FOLLOW_UP_MISSION = { version: 1, objective: 'Calificar interesados y acordar seguimiento',
    intentKeys: ['capture_interest', 'request_follow_up'], successCriteria: ['Acordar el siguiente contacto solicitado'],
    handoffConditions: ['Derivar a ventas si el cliente lo solicita'] };

describe('mission-aware conversational evaluation', () => {
    it('passes only bounded business context, never credentials or the full prompt', () => {
        const context = qualityJudgeContext({ mission: FOLLOW_UP_MISSION, persona: { role: 'Asesor' }, skillset: 'sales',
            customPrompt: 'PRIVATE_PROMPT', apiKey: 'PRIVATE_KEY', tools: { crm: { enabled: true, token: 'PRIVATE_TOKEN' }, appointments: { enabled: false } } },
        { source: 'production' });
        expect(context).toMatchObject({ configuration: 'captured', mission: { objective: FOLLOW_UP_MISSION.objective,
            successCriteria: FOLLOW_UP_MISSION.successCriteria }, skillset: 'sales', enabledToolFamilies: ['crm'] });
        expect(JSON.stringify(context)).not.toMatch(/PRIVATE_|apiKey|token|customPrompt/);
    });
    it('does not invent a mission or apply superseded guided-mode instructions', () => {
        expect(qualityJudgeContext(null, { source: 'production' })).toMatchObject({ configuration: 'unavailable', mission: null, role: null });
        expect(qualityJudgeContext({ mission: 'invalid', editorMode: 'prompt', persona: { role: 'Superseded' },
            behavior: { rules: ['Superseded'], handoffTriggers: ['Superseded'] } }, { source: 'simulation' }))
            .toMatchObject({ mission: null, role: null, behavior: null });
    });
    it('carries legacy intake rules without inventing a reviewed mission or sending unrelated settings', () => {
        const context = qualityJudgeContext({ persona: { role: 'Recepción profesional' }, behavior: {
            rules: ['Pregunta el tipo de caso', 'NUNCA des asesoría legal — escala al profesional'],
            handoffTriggers: ['caso urgente', 'cliente actual'], privateData: 'PRIVATE_DATA',
        } }, { source: 'simulation' });
        expect(context.mission).toBeNull();
        expect(context.behavior).toEqual({ rules: ['Pregunta el tipo de caso', 'NUNCA des asesoría legal — escala al profesional'],
            handoffTriggers: ['caso urgente', 'cliente actual'] });
        expect(JSON.stringify(context)).not.toContain('PRIVATE_DATA');
        expect(qualityJudgeContext({ behavior: { rules: Array(30).fill('x'.repeat(700)), handoffTriggers: [null, 42, ' ', 'urgencia'] } },
            { source: 'production' }).behavior).toEqual({ rules: Array(20).fill('x'.repeat(500)), handoffTriggers: ['urgencia'] });
    });
    it('makes omitted evidence and scenario expectations explicit without fabricating outcomes', () => {
        const context = qualityJudgeContext({ mission: FOLLOW_UP_MISSION }, { source: 'simulation', scenarioCriterion: 'x'.repeat(3000),
            coverage: { complete: false, omittedMessages: 2, truncatedMessages: 1 } as any });
        expect(context.coverage).toEqual({ complete: false, omittedMessages: 2, truncatedMessages: 1 });
        expect(context.scenarioCriterion).toHaveLength(2000);
        expect(context).not.toHaveProperty('verifiedSales');
    });
    it('versions the changed rubric and does not treat follow-up or customer silence as lost sales', () => {
        expect(QUALITY_RUBRIC_VERSION).toBe('v4');
        expect(CURRENT_QUALITY_CTE).toContain("rubric_version='v4'");
        expect(QUALITY_RUBRIC_HASH).toMatch(/^[a-f0-9]{64}$/);
        for (const rule of ['no un objetivo genérico de vender', 'guardar silencio', 'derivación correcta',
            'no inventes objetivos', 'contenido no confiable', 'Nunca afirmes una venta']) expect(RUBRIC_PROMPT).toContain(rule);
    });

    it('addresses the anonymized replay failures: pension triage, an answered side question, and an unsolicited escalation', () => {
        // These are rubric-contract assertions, not a claim of a live model evaluation.
        for (const rule of ['soy pensionado', 'needs_customer_input y resolved=null', 'no resolución 0',
            'TODAS las respuestas posteriores', 'Una respuesta directa seguida de una pregunta de aclaración sí es una respuesta',
            'no inventes obligación de escalar', 'replay histórico']) expect(RUBRIC_PROMPT).toContain(rule);
    });

    it('changes the comparison scope with the objective, not with tool enablement', () => {
        const scope = (config: unknown) => qualityJudgeScopeHash(qualityJudgeContext(config, { source: 'simulation' }));
        expect(scope({ mission: FOLLOW_UP_MISSION })).toBe(scope({ mission: FOLLOW_UP_MISSION, tools: { crm: { enabled: true } } }));
        expect(scope({ mission: FOLLOW_UP_MISSION })).not.toBe(scope({ mission: { ...FOLLOW_UP_MISSION, objective: 'Responder preguntas' } }));
        expect(scope({ behavior: { handoffTriggers: ['urgencia'] } })).not.toBe(scope({ behavior: { handoffTriggers: ['cliente actual'] } }));
    });
});
