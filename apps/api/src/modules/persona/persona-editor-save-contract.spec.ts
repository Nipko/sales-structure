import { BadRequestException } from '@nestjs/common';
import { PersonaService } from './persona.service';
import { editorConfigForSave } from '../../../../dashboard/src/app/admin/agent/[agentId]/agent-editor-save-config';

describe('the editor payload and the canonical agent validator', () => {
    const validator = Object.create(PersonaService.prototype) as PersonaService;
    const complete = () => ({
        persona: { name: 'Luna QA', role: 'Asistente virtual', fallbackMessage: 'No tengo esa información confirmada.' },
        behavior: { rules: ['Consulta el catálogo.'], handoffTriggers: ['petición de una persona'] },
        editorMode: 'guided', _mode: 'wizard', customPrompt: 'legacy text', _customPrompt: 'legacy text',
    });

    it('accepts a complete guided form loaded from a legacy wizard configuration', () => {
        // Reproduce the producer/validator mismatch before applying the fix.
        expect(() => validator.assertAgentConfigValid(complete())).toThrow(BadRequestException);
        const payload = editorConfigForSave(complete(), 'guided', '');
        expect(() => validator.assertAgentConfigValid(payload)).not.toThrow();
        expect(payload.customPrompt).toBeUndefined();
        expect(payload._customPrompt).toBeUndefined();
    });

    it('accepts an authored prompt without requiring guided-only fields', () => {
        const payload = editorConfigForSave({ persona: { name: 'Luna QA' } }, 'prompt', 'Soy una asistente virtual de un salón QA.');
        expect(() => validator.assertAgentConfigValid(payload)).not.toThrow();
        expect(payload.customPrompt).toBe('Soy una asistente virtual de un salón QA.');
    });

    it('still rejects incomplete guided configurations', () => {
        const payload = editorConfigForSave({ persona: { name: 'Luna QA' } }, 'guided', '');
        expect(() => validator.assertAgentConfigValid(payload)).toThrow(BadRequestException);
    });
});
