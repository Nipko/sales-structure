import { projectAvailableService } from '../appointments/service-price-status';
import { PromptAssemblerService } from './prompt-assembler.service';

/**
 * Telegram campaign 2026-10-07: «¿Qué incluye color y tratamiento?» got «Déjame verificar eso»: the prompt's
 * <available_services> carried the name, duration and price but not what the service includes, so the model
 * had nothing to answer with and fell back to the persona's "let me check".
 */
describe('what a service includes reaches the prompt', () => {
    const assembler = new PromptAssemblerService({ buildSystemPrompt: () => '' } as any);
    const layer = (availableServices: any[]): string => (assembler as any).buildTurnLayer({ language: 'es', timezone: 'America/Bogota', availableServices });

    it('projects a trimmed description and drops an empty one', () => {
        const base = { id: 'a', name: 'Color y tratamiento', durationMinutes: 120, price: 120000, currency: 'COP', priceStatus: 'confirmed' as const };
        expect(projectAvailableService({ ...base, description: '  Tinte completo\n y   tratamiento de hidratación.  ' }).description)
            .toBe('Tinte completo y tratamiento de hidratación.');
        expect(projectAvailableService({ ...base, description: '   ' }).description).toBeUndefined();
        expect(projectAvailableService({ ...base, description: null }).description).toBeUndefined();
        expect(projectAvailableService(base).description).toBeUndefined();
        expect(projectAvailableService({ ...base, description: 'x'.repeat(1000) }).description).toHaveLength(280);
    });

    it('renders it escaped as an attribute of the service', () => {
        const block = layer([projectAvailableService({
            id: 'a', name: 'Color y tratamiento', durationMinutes: 120,
            description: 'Tinte y "tratamiento" <hidratante>', priceStatus: 'example',
        })]);
        expect(block).toMatch(/<service [^>]*description="Tinte y &quot;tratamiento&quot; &lt;hidratante&gt;"[^>]*>Color y tratamiento<\/service>/);
    });

    it('renders nothing extra when the service has no description', () => {
        const block = layer([projectAvailableService({ id: 'a', name: 'Corte', durationMinutes: 45, priceStatus: 'example' })]);
        expect(block).not.toContain('description=');
    });
});
