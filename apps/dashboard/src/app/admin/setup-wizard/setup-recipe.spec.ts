import { readSetupRecipe } from './setup-recipe';

describe('the setup recipe reader', () => {
    const four = (es: string, en = 'English') => ({ es, en, pt: 'Português', fr: 'Français' });

    it('localises the cards and never counts an answer with blanks as ready', () => {
        const result = readSetupRecipe({ success: true, data: {
            source: 'registry',
            recipe: {
                mainInstructions: four('Agenda citas'),
                whenUnsure: [four('Lo confirmo')],
                handoffReasons: [{ text: four('Dolor fuerte'), trigger: 'dolor intenso' }],
                purchaseModes: ['appointment', 'invalid'],
                canonicalQuestions: [
                    { question: four('¿Dónde quedan?'), answer: four('Estamos en [dirección].') },
                    { question: four('¿Abren hoy?'), answer: four('Sí, abrimos hoy.') },
                ],
                testQuestions: [four('Necesito una cita')],
            },
            setup: { services: [{ name: 'Valoración', durationMinutes: 30, priceState: 'example' }], businessHours: { monday: '09:00-17:00' } },
        } }, 'es-CO');

        expect(result).toMatchObject({ mainInstructions: 'Agenda citas', purchaseModes: ['appointment'] });
        expect(result?.questions).toEqual([
            expect.objectContaining({ blanks: ['dirección'], complete: false }),
            expect.objectContaining({ blanks: [], complete: true }),
        ]);
        expect(result?.services[0]).toEqual({ name: 'Valoración', durationMinutes: 30, priceState: 'example' });
    });

    it.each([null, {}, { success: true, data: { source: 'none', recipe: null } }])('returns null for an unavailable recipe', (value) => {
        expect(readSetupRecipe(value, 'es')).toBeNull();
    });
});
