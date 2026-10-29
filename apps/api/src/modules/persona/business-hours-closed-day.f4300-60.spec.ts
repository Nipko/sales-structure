import { PersonaService } from './persona.service';

/**
 * F4300-60 (production QA 29-oct, «Agencia QA Viajes»): the agent's schedule is Monday–Friday 08–18, Saturday 08–14 and `dom: null`.
 * The null day was left out of <business_hours>, and «¿atienden los domingos?» was answered «los domingos de 08:00 a 14:00» in
 * es/en/pt/fr — Saturday's hours.
 */
const config = (hours: any) => ({
    persona: { name: 'Sofía', role: 'Asistente', personality: {} },
    behavior: { mainInstructions: 'Atiende', rules: [], forbiddenTopics: [], handoffTriggers: [] },
    hours, industry: 'turismo', language: 'es',
}) as any;
const day = { start: '08:00', end: '18:00' };

describe('F4300-60 · a day the schedule leaves empty is said closed', () => {
    const persona = new PersonaService({} as any, {} as any, {} as any, {} as any, {} as any);

    it('the agent schedule: «dom: null» is a closed Sunday', () => {
        const prompt = persona.buildSystemPrompt(config({ timezone: 'America/Bogota', schedule: {
            lun: day, mar: day, mie: day, jue: day, vie: day, sab: { start: '08:00', end: '14:00' }, dom: null } }));
        expect(prompt).toContain('<day name="dom">closed</day>');
        expect(prompt).toContain('<day name="sab" start="08:00" end="14:00" />');
    });

    it('the business hours: a null day is closed too', () => {
        const prompt = persona.buildSystemPrompt(config({}), { is247: false, timezone: 'America/Bogota',
            schedule: { monday: { open: '08:00', close: '18:00' }, sunday: null } });
        expect(prompt).toContain('<day name="sunday">closed</day>');
    });
});
