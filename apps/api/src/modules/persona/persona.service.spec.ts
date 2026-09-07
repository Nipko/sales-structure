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
