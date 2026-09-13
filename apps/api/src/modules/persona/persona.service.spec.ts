import { PersonaService } from './persona.service';

// Drafts reuse this validator. Operational update is now deactivation-only.
describe('Canonical persona validation for editable revisions', () => {
    const service = Object.create(PersonaService.prototype) as PersonaService;
    const valid = () => ({ persona: { name: 'Sofía', role: 'Support', fallbackMessage: 'A colleague can help.' },
        behavior: { rules: ['Use confirmed facts'], handoffTriggers: ['Human requested'] } });
    it('accepts a complete configuration', () => expect(() => service.assertAgentConfigValid(valid())).not.toThrow());
    it.each(['name', 'role', 'fallbackMessage'])('rejects an empty %s', key => {
        const config: any = valid(); config.persona[key] = ' ';
        expect(() => service.assertAgentConfigValid(config)).toThrow();
    });
    it.each(['rules', 'handoffTriggers'])('rejects empty or whitespace-only %s', key => {
        const config: any = valid(); config.behavior[key] = [' '];
        expect(() => service.assertAgentConfigValid(config)).toThrow();
    });
    it('allows missing fields in an explicitly partial draft while rejecting a present empty value', () => {
        expect(() => service.assertAgentConfigValid({ persona: { name: 'Alex' } }, { partial: true })).not.toThrow();
        expect(() => service.assertAgentConfigValid({ persona: { name: '' } }, { partial: true })).toThrow();
    });
    it('requires the actual custom prompt in prompt mode', () => {
        expect(() => service.assertAgentConfigValid({ editorMode: 'prompt', customPrompt: 'Respond using the supplied facts.' })).not.toThrow();
        expect(() => service.assertAgentConfigValid({ _mode: 'prompt', _customPrompt: ' ' })).toThrow();
    });
    it('accepts existing bounded model settings while rejecting states the editor cannot safely produce', () => {
        expect(() => service.assertAgentConfigValid({ persona: { name: 'Alex' }, language: 'es',
            llm: { temperature: 0.6, maxTokens: 500 }, rag: { enabled: true, topK: 5, similarityThreshold: 0.75 },
            upsell: { enabled: true, intensity: 'subtle', maxDiscountPercent: 15 },
            tools: { appointments: { enabled: true, canBook: true } } }, { partial: true })).not.toThrow();
        for (const config of [
            { language: 'de-DE' },
            { persona: { personality: { emojiUsage: 'always' } } },
            { skillset: 'marketing' },
            { upsell: { enabled: true, maxDiscountPercent: 31 } },
            { llm: { temperature: Number.NaN, maxTokens: 800 } },
            { rag: { enabled: true, topK: 0, similarityThreshold: 0.75 } },
            { hours: { aiOutsideHours: 'yes' } },
            { tools: { appointments: { enabled: 'yes' } } },
        ]) expect(() => service.assertAgentConfigValid(config, { partial: true })).toThrow();
    });
    it('rejects unknown tool families and family-specific permission typos', () => {
        const cases: Array<[any, string]> = [
            [{ tools: { paymnts: { enabled: true } } }, 'tools.paymnts'],
            [{ tools: { payments: { enabled: true, canCreateLink: true } } }, 'tools.payments.canCreateLink'],
            [{ tools: { offers: { enabled: true, canBook: true } } }, 'tools.offers.canBook'],
            [{ tools: [] }, 'tools'],
        ];
        for (const [config, field] of cases) {
            try {
                service.assertAgentConfigValid(config, { partial: true });
                throw new Error('expected_invalid_tool_configuration');
            } catch (error: any) {
                expect(error.response?.fields).toContain(field);
            }
        }
        expect(() => service.assertAgentConfigValid({ tools: {
            appointments: { enabled: false, pendingPrerequisites: true },
        } }, { partial: true })).not.toThrow();
    });
});

describe('PersonaService — plantilla de preguntas frecuentes', () => {
    const service = new PersonaService({} as any, {} as any, {} as any, {} as any, {} as any);

    it.each(['es', 'en'])('en %s enciende FAQs y deja RAG apagado', (lang) => {
        const template = service.getBuiltinTemplates(lang).find((t: any) => t.id === 'tpl_faq');

        expect(template).toBeDefined();
        // Con `rag.enabled === true` el check crítico `rag_knowledge` exige
        // fragmentos vectorizados que este tenant nunca prometió tener.
        expect(template.config_json.rag.enabled).toBe(false);
        expect(template.config_json.tools.faqs.enabled).toBe(true);
    });
});
