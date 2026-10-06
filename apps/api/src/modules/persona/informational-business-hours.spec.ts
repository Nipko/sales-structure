import { PersonaService } from './persona.service';
import {
    deriveInformationalHours,
    resolvePromptBusinessHours,
    UNKNOWN_INFORMATIONAL_HOURS,
    informationalStatus,
    promptHoursStatus,
} from '../conversations/informational-hours';

/**
 * Tenant "citas" (production, 2026-10-05): the 09:00-19:00 Monday-Saturday
 * hours live only in `availability_slots`; `tenant.settings.businessHours` is
 * absent and the agent has an empty schedule in 24/7 mode. The prompt carried no
 * `<business_hours>` at all, so "¿a qué hora abren?" had no answer.
 */
const slot = (day: number, start = '09:00:00', end = '19:00:00', user = 'u1') =>
    ({ user_id: user, day_of_week: day, start_time: start, end_time: end });
const citasRows = [1, 2, 3, 4, 5, 6].map(day => slot(day));

describe('deriveInformationalHours', () => {
    it('turns the citas availability into one window per working day and closes the rest', () => {
        const derived = deriveInformationalHours(citasRows, 'America/Bogota')!;
        expect(derived.informational).toBe(true);
        expect(derived.timezone).toBe('America/Bogota');
        expect(derived.schedule.monday).toEqual({ windows: [{ open: '09:00', close: '19:00' }] });
        expect(derived.schedule.saturday).toEqual({ windows: [{ open: '09:00', close: '19:00' }] });
        expect(derived.schedule.sunday).toEqual({ enabled: false });
    });

    it('unites the windows of several professionals and keeps real gaps', () => {
        const derived = deriveInformationalHours([
            slot(1, '09:00:00', '13:00:00', 'a'), slot(1, '11:00:00', '15:00:00', 'b'),
            slot(2, '09:00:00', '12:00:00', 'a'), slot(2, '14:00:00', '18:00:00', 'a'),
            slot(3, '09:00:00', '12:00:00', 'a'), slot(3, '12:00:00', '17:00:00', 'b'),
        ])!;
        expect(derived.schedule.monday.windows).toEqual([{ open: '09:00', close: '15:00' }]);
        expect(derived.schedule.tuesday.windows).toEqual([{ open: '09:00', close: '12:00' }, { open: '14:00', close: '18:00' }]);
        expect(derived.schedule.wednesday.windows).toEqual([{ open: '09:00', close: '17:00' }]);
    });

    it('returns null when there is nothing usable', () => {
        expect(deriveInformationalHours([])).toBeNull();
        expect(deriveInformationalHours([slot(1, '10:00:00', '10:00:00'), { day_of_week: 9, start_time: '09:00', end_time: '10:00' }])).toBeNull();
    });
});

describe('resolvePromptBusinessHours never overrides what the tenant configured', () => {
    const derived = deriveInformationalHours(citasRows)!;
    const configured = { is247: false, timezone: 'America/Bogota', schedule: { monday: { open: '08:00', close: '12:00' } } };

    it('keeps tenant hours, 24/7 mode and an agent schedule untouched', () => {
        expect(resolvePromptBusinessHours(configured, {}, derived)).toBe(configured);
        const always = { is247: true };
        expect(resolvePromptBusinessHours(always, {}, derived)).toBe(always);
        expect(resolvePromptBusinessHours(null, { schedule: { mon: '09:00-18:00' } }, derived)).toBeNull();
    });

    it('uses availability when no schedule exists anywhere', () => {
        expect(resolvePromptBusinessHours(null, { schedule: {} }, derived)).toEqual(derived);
        expect(resolvePromptBusinessHours(undefined, undefined, derived)).toEqual(derived);
    });

    it('fills an empty tenant schedule while keeping its other settings', () => {
        const resolved = resolvePromptBusinessHours({ is247: false, timezone: 'America/Lima', schedule: {}, afterHoursMessage: 'Cerrado' }, {}, derived);
        expect(resolved).toMatchObject({ informational: true, timezone: 'America/Lima', afterHoursMessage: 'Cerrado' });
        expect(resolved.schedule.monday.windows).toEqual([{ open: '09:00', close: '19:00' }]);
    });

    it('does not invent anything when availability is unknown and nothing else exists', () => {
        expect(resolvePromptBusinessHours(null, { schedule: {} }, null)).toBeNull();
        expect(resolvePromptBusinessHours(null, { schedule: {} }, UNKNOWN_INFORMATIONAL_HOURS)).toMatchObject({ informational: true, unknown: true });
    });
});

describe('the prompt carries the informational hours', () => {
    const service = new PersonaService({} as any, {} as any, {} as any, {} as any, {} as any);
    const config = (extra: Record<string, any> = {}) => ({
        persona: { name: 'Luna', role: 'Asistente', personality: {} },
        behavior: { mainInstructions: 'Atiende', rules: [], forbiddenTopics: [], handoffTriggers: [] },
        hours: { schedule: {}, timezone: 'America/Bogota' },
        industry: 'salon', language: 'es', ...extra,
    }) as any;

    it('is unchanged when there are no hours at all (existing behaviour)', () => {
        expect(service.buildSystemPrompt(config())).not.toContain('<business_hours>');
    });

    it('lists the derived days and never claims they gate the assistant', () => {
        const prompt = service.buildSystemPrompt(config(), deriveInformationalHours(citasRows, 'America/Bogota'));
        expect(prompt).toContain('<business_hours>');
        expect(prompt).toContain('<timezone>America/Bogota</timezone>');
        expect(prompt).toContain('<day name="monday" start="09:00" end="19:00" />');
        expect(prompt).toContain('<day name="saturday" start="09:00" end="19:00" />');
        expect(prompt).toContain('<day name="sunday">closed</day>');
        expect(prompt).toContain('appointment_availability');
        expect(prompt).not.toContain('<ai_outside_hours>');
    });

    it('also survives in free-prompt mode', () => {
        const prompt = service.buildSystemPrompt(config({ editorMode: 'prompt', customPrompt: 'Hola' }), deriveInformationalHours(citasRows));
        expect(prompt).toContain('<day name="monday" start="09:00" end="19:00" />');
    });

    it('tells the model to admit it lacks the hours and offer a person when none are known', () => {
        const prompt = service.buildSystemPrompt(config(), UNKNOWN_INFORMATIONAL_HOURS);
        expect(prompt).toContain('<business_hours>');
        expect(prompt).toContain('<status>unknown</status>');
        expect(prompt).toMatch(/persona del equipo/);
        expect(prompt).not.toContain('<day ');
    });
});

describe('the status the prompt states', () => {
    const agenda = deriveInformationalHours(citasRows, 'America/Bogota')!;
    // Bogota is UTC-5 all year.
    const at = (iso: string) => new Date(iso);

    it.each([
        ['Saturday 15:00 local', '2026-10-03T20:00:00Z', 'open'],
        ['Saturday 19:00 local (closing instant)', '2026-10-04T00:00:00Z', 'closed'],
        ['Sunday noon local', '2026-10-04T17:00:00Z', 'closed'],
        ['Monday 08:59 local', '2026-10-05T13:59:00Z', 'closed'],
        ['Monday 09:00 local', '2026-10-05T14:00:00Z', 'open'],
    ])('%s is %s according to the agenda', (_name, iso, expected) => {
        expect(informationalStatus(agenda, 'America/Bogota', at(iso))).toBe(expected);
    });

    it('is unknown, not open, without configured hours or an agenda', () => {
        expect(promptHoursStatus('open', false, null, 'America/Bogota')).toBe('unknown');
        expect(promptHoursStatus('open', false, UNKNOWN_INFORMATIONAL_HOURS, 'America/Bogota')).toBe('unknown');
    });

    it('keeps the existing verdict whenever hours are configured', () => {
        expect(promptHoursStatus('closed', true, null, 'America/Bogota')).toBe('closed');
        expect(promptHoursStatus('open', true, agenda, 'America/Bogota')).toBe('open');
    });

    it('uses the agenda when nothing is configured', () => {
        expect(promptHoursStatus('open', false, agenda, 'America/Bogota', at('2026-10-04T17:00:00Z'))).toBe('closed');
    });
});
