import { PersonaService } from './persona.service';
import { PromptAssemblerService } from '../conversations/prompt-assembler.service';
import { editorConfigForSave } from '../../../../dashboard/src/app/admin/agent/[agentId]/agent-editor-save-config';

/**
 * PREPARED ONLY, root preregisters before execution.
 * Destination: apps/api/src/modules/persona/agent-required-fields-legacy-consumer.spec.ts
 *
 * Four locales x legacy / mixed / canonical / empty required information.
 * Real source template, editor save producer, canonical validator, persona
 * renderer and full prompt assembler; no mocked prompt builder/normalizer.
 * Tests prompt configuration inventory before and after a valid added field.
 * No model, database, HTTP, customer query, catalogue read, handoff or PII is
 * involved. This is NOT efficacy of L1/LLM and does NOT reopen DEF019.
 */
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
const LOCALE_CODES = { es: 'es-CO', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR' } as const;
const LEGACY = { name: { required: true }, email: { required: true }, phone: { required: false } };
const CASES = [
    { name: 'legacy technology template requirements', fields: LEGACY, expected: ['email', 'name'] },
    { name: 'mixed legacy and canonical context', fields: { ...LEGACY,
        quote: [{ field: 'tax_id', question: 'QA_TAX_ID_QUESTION' }] }, expected: ['email', 'name', 'tax_id'] },
    { name: 'canonical requirement context', fields: { general: [
        { field: 'name', question: 'QA_NAME_QUESTION' }, { field: 'email', question: 'QA_EMAIL_QUESTION' },
    ] }, expected: ['email', 'name'] },
    { name: 'no prior required information', fields: {}, expected: [] },
] as const;
function promptFields(systemPrompt: string): string[] {
    const body = /<required_information>([\s\S]*?)<\/required_information>/.exec(systemPrompt)?.[1] || '';
    return Array.from(body.matchAll(/<field name="([^"]+)"/g)).map(match => match[1]).sort();
}
describe.each(LOCALES)('saved required information remains consumed (%s)', locale => {
    const persona = new PersonaService({} as any, {} as any, {} as any, {} as any, {} as any);
    const assembler = new PromptAssemblerService(persona);
    it.each(CASES)('$name survives a valid additional context/field', testcase => {
        // Current vertical template is the primary source. Localization retains
        // this structure, not just the Spanish literal in a historical comment.
        const template = persona.getVerticalTemplates('technology', locale)?.find((item: any) => item.id === 'tpl_technology_ventas');
        expect(template).toBeDefined();
        expect(template.config_json.behavior.requiredFields).toEqual(LEGACY);
        const before: any = {
            persona: { name: 'Synthetic required-information agent', role: 'Support', fallbackMessage: 'No confirmed information.' },
            behavior: { rules: ['Use confirmed facts.'], handoffTriggers: ['Human requested'], requiredFields: testcase.fields },
            tools: { appointments: { enabled: false } }, language: LOCALE_CODES[locale], industry: 'technology',
        };
        const beforeCopy = JSON.parse(JSON.stringify(before));
        const savedBefore = editorConfigForSave(before, 'guided', '');
        expect(() => persona.assertAgentConfigValid(savedBefore)).not.toThrow();
        const turn: any = { language: locale, timezone: 'America/Bogota', now: '2026-10-16T12:00:00.000Z',
            upcomingDays: [], businessHoursStatus: 'unknown' };
        expect(promptFields(assembler.assemble(savedBefore as any, turn))).toEqual(testcase.expected);
        expect(before).toEqual(beforeCopy);

        // The semantically correct additive payload is representable and is
        // accepted/consumed by the actual existing producer and consumer.
        const withAddition = { ...before, behavior: { ...before.behavior, requiredFields: {
            ...before.behavior.requiredFields,
            nuevo_contexto: [{ field: 'qa_preference', question: 'QA_PREFERENCE_QUESTION_' + locale }],
        } } };
        const savedAfter = editorConfigForSave(withAddition, 'guided', '');
        expect(() => persona.assertAgentConfigValid(savedAfter)).not.toThrow();
        const prompt = assembler.assemble(savedAfter as any, turn);
        expect(promptFields(prompt)).toEqual([...testcase.expected, 'qa_preference'].sort());
        expect(prompt).toContain('QA_PREFERENCE_QUESTION_' + locale);
        expect(before).toEqual(beforeCopy);
    });
});
