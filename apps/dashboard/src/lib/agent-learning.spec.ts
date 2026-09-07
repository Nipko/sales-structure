import { canApproveLearningExample, canSelectLearningExample, learningEvaluationSummary, parseLearningTranscript, type LearningExample, type LearningRelease } from './agent-learning';

describe('learning conversation import', () => {
    it.each([
        ['Cliente: Hola\nAgente: ¿Qué necesitas?', 'Hola'],
        ['Customer: Hello\nAgent: How can I help?', 'Hello'],
        ['Cliente: Olá\nAssistente: Como posso ajudar?', 'Olá'],
        ['Client: Bonjour\nAgent: Comment puis-je vous aider ?', 'Bonjour'],
    ])('recognizes complete messages in %s', (text, first) => {
        expect(parseLearningTranscript(text)).toEqual([{ role: 'customer', text: first },
            { role: 'assistant', text: expect.any(String) }]);
    });
    it('keeps multiline messages and quoted facts in their original role', () => {
        expect(parseLearningTranscript('\uFEFFCliente: Tengo una pregunta\r\nPrecio: 25\r\nAgente: Claro\r\nTe ayudo.'))
            .toEqual([{ role: 'customer', text: 'Tengo una pregunta\nPrecio: 25' }, { role: 'assistant', text: 'Claro\nTe ayudo.' }]);
    });
    it.each(['', 'Un texto sin roles', 'Cliente: Hola', 'Cliente:\nAgente: Hola'])('rejects incomplete or ambiguous imports', text => {
        expect(() => parseLearningTranscript(text)).toThrow('transcriptFormat');
    });
    it('rejects oversized messages before uploading', () => {
        expect(() => parseLearningTranscript(`Cliente: ${'x'.repeat(10_001)}\nAgente: Hola`)).toThrow('tooLarge');
    });
    it('never selects unreviewed examples, reserved cases, facts or memories for releases', () => {
        const example = { status: 'approved', kind: 'brand_style', split: 'train' } as LearningExample;
        expect(canSelectLearningExample(example)).toBe(true);
        for (const patch of [{ status: 'analyzed' }, { split: 'holdout' }, { kind: 'business_fact' }, { kind: 'customer_memory' }]) {
            expect(canSelectLearningExample({ ...example, ...patch })).toBe(false);
        }
    });
    it('retains incomplete runs in the displayed failure count', () => {
        const release = { evaluation: { totalCases: 3, completedCases: 2, failedCases: 2 } } as LearningRelease;
        expect(learningEvaluationSummary(release)).toEqual({ total: 3, completed: 2, failed: 2 });
    });
    it('shows approval only after all required quality dimensions pass', () => {
        const scores = Object.fromEntries(['accuracy', 'toolUse', 'understanding', 'clarity', 'brevity', 'empathy', 'brandTone', 'uncertainty', 'closure'].map(key => [key, key === 'brevity' ? 2 : 3]));
        const example = { status: 'analyzed', dedup_status: 'clear', analysis: { scores, exclusions: [] } } as unknown as LearningExample;
        expect(canApproveLearningExample(example)).toBe(true);
        expect(canApproveLearningExample({ ...example, analysis: { scores: { ...scores, accuracy: 2 }, exclusions: [] } })).toBe(false);
        expect(canApproveLearningExample({ ...example, analysis: { scores, exclusions: ['unverified_operation'] } })).toBe(false);
        expect(canApproveLearningExample({ ...example, dedup_status: 'conflict' })).toBe(false);
    });
});
