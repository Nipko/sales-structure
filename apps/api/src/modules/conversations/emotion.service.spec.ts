import { EmotionService } from './emotion.service';

describe('EmotionService', () => {
    const service = new EmotionService();

    it('reads shouting as frustration', () => {
        // The ratio was computed on an already-lowercased string, so it was
        // always zero: SHOUTING — one of the clearest signals of an angry
        // customer — never registered at all.
        const shouting = service.detect('ESTO NO FUNCIONA Y LLEVO TRES DIAS ESPERANDO');
        const calm = service.detect('esto no me ha funcionado, llevo tres dias esperando');

        expect(shouting.frustration).toBeGreaterThan(calm.frustration);
    });

    it('does not invent frustration in a neutral message', () => {
        const state = service.detect('Hola, quisiera saber los horarios de mañana');
        expect(state.frustration).toBe(0);
        expect(state.urgency).toBe('low');
    });

    it('detects confusion and urgency separately', () => {
        expect(service.detect('no entiendo cómo funciona').confusion).toBeGreaterThan(0);
        expect(service.detect('es urgente, lo necesito hoy mismo').urgency).toBe('high');
    });

    it('keeps the customer objection in their own words', () => {
        // The objection is only captured once frustration is unmistakable, so a
        // mildly annoyed message does not get filed as one.
        const state = service.detect('Ya dije que esto no funciona y estoy harto de esperar!');
        expect(state.frustration).toBeGreaterThan(0.5);
        expect(state.lastObjection).toContain('no funciona');

        expect(service.detect('El precio me parece alto').lastObjection).toBeUndefined();
    });

    it('survives an empty or missing message', () => {
        expect(service.detect('').frustration).toBe(0);
        expect(service.detect(undefined as any).confusion).toBe(0);
    });
});
