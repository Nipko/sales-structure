import { PromptAssemblerService } from './prompt-assembler.service';
import { PersonaService } from '../persona/persona.service';
import { SCHEDULE_TIME_ZONE_MEANING, scheduleTimeZoneElement } from './informational-hours';

/**
 * F4300-28 (production QA 23/24-oct, hotel tenant): «en qué ciudad queda el hotel?» → «Estamos en Bogotá, pero no tengo
 * la dirección exacta registrada», and the same in English and Portuguese, 4/4. The property says city «Ciudad QA»; the
 * only «Bogota» of the tenant is the schedule time zone (`hours.timezone: "America/Bogota"`), which reached the prompt
 * as a bare `<timezone>America/Bogota</timezone>` next to rule 13f, whose own example sentence said «Estamos en Bogotá».
 * The time zone is now rendered as what it is, the location only from the business record, and a business with no
 * city and no address says so.
 */
const persona = new PersonaService({} as any, {} as any, {} as any, {} as any, {} as any);
const assembler = new PromptAssemblerService(persona);
const config: any = {
    persona: { name: 'Sofía', role: 'Recepción', personality: {} },
    behavior: { mainInstructions: 'Atiende a los huéspedes', rules: [], forbiddenTopics: [], handoffTriggers: [] },
    // The production agent: an empty schedule and the Colombian clock.
    hours: { schedule: {}, timezone: 'America/Bogota' },
    industry: 'hotel', language: 'es',
};
const turn = (business?: Record<string, unknown>): any => ({
    language: 'es', timezone: 'America/Bogota', now: '2026-10-23T15:00:00.000Z', upcomingDays: [], businessHoursStatus: 'open',
    ...(business ? { business } : {}),
});
const TENANT_HOURS = { is247: false, timezone: 'America/Bogota', schedule: { monday: { enabled: true, open: '08:00', close: '18:00' } } };

/** The prompt with every labelled schedule time zone taken out: what is left must never name Bogotá. */
const outsideTimeZone = (prompt: string) => prompt.split(scheduleTimeZoneElement('America/Bogota')).join('');

describe('F4300-28 the schedule time zone is never presented as the business location', () => {
    it('production: hotel with city «Ciudad QA» and a synthetic address — the location is that city, Bogotá appears only as the labelled clock', () => {
        const prompt = assembler.assemble(config, turn({ companyName: 'Hotel QA', city: 'Ciudad QA', address: 'Direccion sintetica QA' }), TENANT_HOURS);
        expect(prompt).toContain('<city>Ciudad QA</city>');
        expect(prompt).toContain('<address>Direccion sintetica QA</address>');
        expect(prompt).not.toContain('<location_status>');
        expect(prompt).toContain(scheduleTimeZoneElement('America/Bogota'));
        expect(outsideTimeZone(prompt)).not.toMatch(/bogot/i);
    });

    it('no business record at all: the location is stated as not registered, and Bogotá is still only the labelled clock', () => {
        const prompt = assembler.assemble(config, turn(), TENANT_HOURS);
        expect(prompt).toContain('<location_status>not_registered</location_status>');
        expect(prompt).not.toMatch(/<city>|<address>/);
        expect(outsideTimeZone(prompt)).not.toMatch(/bogot/i);
    });

    it('a business record with no city and no address says the location is not registered', () => {
        const prompt = assembler.assemble(config, turn({ companyName: 'Hotel QA', phone: '+57 300 000 0000', city: '  ' }));
        expect(prompt).toContain('<location_status>not_registered</location_status>');
        expect(outsideTimeZone(prompt)).not.toMatch(/bogot/i);
    });

    it('the time zone is never a bare city-like token: no <timezone> element, and its label says it is not a location', () => {
        for (const prompt of [
            assembler.assemble(config, turn(), TENANT_HOURS),
            assembler.assemble({ ...config, hours: { schedule: { monday: { start: '08:00', end: '18:00' } }, timezone: 'America/Bogota' } }, turn()),
        ]) {
            expect(prompt).not.toContain('<timezone>');
            expect(prompt).toContain(`meaning="${SCHEDULE_TIME_ZONE_MEANING}"`);
        }
        expect(SCHEDULE_TIME_ZONE_MEANING).toMatch(/does not say where the business is/);
    });

    it('rule 13f takes the location only from the business record (or a tool result), never from the time zone, and has no example city', () => {
        const prompt = assembler.assemble(config, turn());
        const rule = prompt.slice(prompt.indexOf('13f. WHERE THE BUSINESS IS'), prompt.indexOf('14.', prompt.indexOf('13f. WHERE THE BUSINESS IS')));
        expect(rule).not.toMatch(/bogot/i);
        expect(rule).toContain('never from &lt;schedule_time_zone&gt; (a clock, not a place)');
        expect(rule).toContain('&lt;location_status&gt; is not_registered, neither the city nor the address is on file');
        expect(rule).toContain('give the city AND say in the same answer that the exact address is not on file');
    });

    it('a real configured city is still shown, even when it is the time zone city', () => {
        const qa = assembler.assemble(config, turn({ companyName: 'Hotel QA', city: 'Ciudad QA' }));
        expect(qa).toContain('<city>Ciudad QA</city>');
        expect(qa).not.toContain('<location_status>');
        const bogota = assembler.assemble(config, turn({ companyName: 'Hotel Andino', city: 'Bogotá' }));
        expect(bogota).toContain('<city>Bogotá</city>');
        expect(bogota).not.toContain('<location_status>');
    });
});
