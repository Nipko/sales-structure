import { PersonaService } from './persona.service';
import { ConversationsService } from '../conversations/conversations.service';
import {
    deriveInformationalHours,
    hoursSource,
    UNKNOWN_INFORMATIONAL_HOURS,
    type InformationalHours,
} from '../conversations/informational-hours';

/**
 * Salon "Salon QA Citas" (review of 2026-10-08): the agent's own Horario is empty, Configuracion >
 * Horarios de atencion was never saved, and the appointment agenda is Monday-Saturday 09-19. The bot
 * told customers "No tengo el horario de atencion configurado".
 *
 * The three screens describe one thing - when the business attends - and the agent must answer from the
 * first of them that really carries a schedule:
 *   business hours  >  the agent's own schedule  >  the appointment agenda  >  honest "not configured".
 * Each case below goes through the same two steps a turn takes: `resolvePromptBusinessHours` (which hours
 * the prompt gets) and `PersonaService.buildSystemPrompt` (what the model is actually told).
 */
const slot = (day: number) => ({ user_id: 'u1', day_of_week: day, start_time: '09:00:00', end_time: '19:00:00' });
const agenda = deriveInformationalHours([1, 2, 3, 4, 5, 6].map(slot), 'America/Bogota') as InformationalHours;

const businessHours = {
    is247: false, timezone: 'America/Bogota',
    schedule: { monday: { open: '08:00', close: '12:00' }, tuesday: { enabled: false } },
};
const agentHours = {
    timezone: 'America/Bogota',
    schedule: { monday: { start: '10:00', end: '16:00' }, sunday: { start: '11:00', end: '14:00' } },
};
// What the onboarding wizard stores when the owner picked "business hours" but listed no day.
const wizardShell = { is247: false, timezone: 'America/Bogota', schedule: {}, afterHoursMessage: 'Estamos cerrados' };

const config = (hours: any) => ({
    persona: { name: 'Luna', role: 'Asistente', personality: {} },
    behavior: { mainInstructions: 'Atiende', rules: [], forbiddenTopics: [], handoffTriggers: [] },
    hours, industry: 'salon', language: 'es',
}) as any;

describe('customer-facing opening hours: precedence', () => {
    const persona = new PersonaService({} as any, {} as any, {} as any, {} as any, {} as any);
    // `resolvePromptBusinessHours` only needs `loadInformationalHours`, so the service is built bare.
    const conversations: any = Object.create(ConversationsService.prototype);

    async function promptFor(tenantHours: any, agent: any, availability: InformationalHours | null) {
        conversations.loadInformationalHours = jest.fn().mockResolvedValue(availability);
        const cfg = config(agent);
        const promptHours = await conversations.resolvePromptBusinessHours('tenant-1', cfg, tenantHours, null, 'America/Bogota');
        return {
            prompt: persona.buildSystemPrompt(cfg, promptHours),
            source: hoursSource(tenantHours, agent, promptHours),
            agendaWasRead: conversations.loadInformationalHours.mock.calls.length > 0,
        };
    }

    it('business hours set -> used, the agenda is not even read', async () => {
        const { prompt, source, agendaWasRead } = await promptFor(businessHours, agentHours, agenda);
        expect(source).toBe('business');
        expect(agendaWasRead).toBe(false);
        expect(prompt).toContain('<day name="monday" start="08:00" end="12:00" />');
        expect(prompt).not.toContain('start="10:00"');
        expect(prompt).not.toContain('appointment_availability');
        expect(prompt).not.toContain('<status>unknown</status>');
    });

    it('agent hours set (business hours empty) -> the agent schedule is used, not the agenda', async () => {
        const { prompt, source } = await promptFor(null, agentHours, agenda);
        expect(source).toBe('agent');
        expect(prompt).toContain('<day name="monday" start="10:00" end="16:00" />');
        expect(prompt).toContain('<day name="sunday" start="11:00" end="14:00" />');
        expect(prompt).not.toContain('appointment_availability');
    });

    it('agent hours set while business hours is only the wizard shell -> the shell does not shadow them', async () => {
        const { prompt, source } = await promptFor(wizardShell, agentHours, agenda);
        expect(source).toBe('agent');
        expect(prompt).toContain('<day name="monday" start="10:00" end="16:00" />');
        expect(prompt).toContain('<after_hours_message>Estamos cerrados</after_hours_message>');
        expect(prompt).not.toContain('<status>unknown</status>');
    });

    it('agent empty + business hours set -> business hours are used', async () => {
        const { prompt, source } = await promptFor(businessHours, { schedule: {}, timezone: 'America/Bogota' }, agenda);
        expect(source).toBe('business');
        expect(prompt).toContain('<day name="monday" start="08:00" end="12:00" />');
        expect(prompt).toContain('<day name="tuesday">closed</day>');
        expect(prompt).not.toContain('appointment_availability');
    });

    it('24/7 business hours are an explicit schedule too', async () => {
        const { prompt, source } = await promptFor({ is247: true }, { schedule: {} }, agenda);
        expect(source).toBe('business');
        expect(prompt).toContain('<mode>24/7</mode>');
    });

    it('both empty + appointment agenda -> the bookable hours answer (Mon-Sat 09-19), never "not configured"', async () => {
        for (const tenantHours of [null, undefined, {}, wizardShell]) {
            const { prompt, source } = await promptFor(tenantHours, { schedule: {}, timezone: 'America/Bogota' }, agenda);
            expect(source).toBe('appointment_availability');
            expect(prompt).toContain('<source>appointment_availability</source>');
            expect(prompt).toContain('<day name="monday" start="09:00" end="19:00" />');
            expect(prompt).toContain('<day name="saturday" start="09:00" end="19:00" />');
            expect(prompt).toContain('<day name="sunday">closed</day>');
            expect(prompt).not.toContain('<status>unknown</status>');
            expect(prompt).not.toMatch(/No hay un horario de atenci/);
        }
    });

    it('nothing anywhere -> the honest "not configured" instruction, with a person offered', async () => {
        for (const tenantHours of [null, wizardShell]) {
            const { prompt, source } = await promptFor(tenantHours, { schedule: {}, timezone: 'America/Bogota' }, UNKNOWN_INFORMATIONAL_HOURS);
            expect(source).toBe('none');
            expect(prompt).toContain('<status>unknown</status>');
            expect(prompt).toMatch(/No hay un horario de atenci/);
            expect(prompt).toMatch(/persona del equipo/);
            expect(prompt).not.toMatch(/<day /);
        }
    });

    it('agenda unreadable + only the wizard shell -> still says "not configured" instead of an empty block', async () => {
        const { prompt, source } = await promptFor(wizardShell, { schedule: {} }, null);
        expect(source).toBe('none');
        expect(prompt).toContain('<status>unknown</status>');
        expect(prompt).not.toMatch(/<day /);
    });
});
