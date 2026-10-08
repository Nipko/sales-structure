import { ConversationsService } from './conversations.service';

/**
 * The after-hours gate (`aiOutsideHours = false` -> send the after-hours reply) must decide with the same
 * precedence as the hours the prompt quotes to the customer (informational-hours.ts):
 *   business hours that list a week  >  the agent's own schedule  >  nothing configured = open.
 * The appointment agenda is not a source of the gate (bookable hours would silence the bot outside slots).
 *
 * "Now" is pinned: Wednesday 2026-10-07 at 20:00 and at 11:00 in Bogota (UTC-5, no DST).
 */
const WEDNESDAY_8PM = new Date('2026-10-08T01:00:00Z');
const WEDNESDAY_11AM = new Date('2026-10-07T16:00:00Z');

const businessWeek = { is247: false, timezone: 'America/Bogota', schedule: { wednesday: { enabled: true, open: '08:00', close: '12:00' } } };
const wizardShell = { is247: false, timezone: 'America/Bogota', schedule: {}, afterHoursMessage: 'Cerrado' };
const agentWeek = { timezone: 'America/Bogota', schedule: { mie: { start: '14:00', end: '18:00' } } };

describe('after-hours gate: isWithinBusinessHours follows the prompt precedence', () => {
    const service: any = Object.create(ConversationsService.prototype);
    service.logger = { debug: jest.fn(), log: jest.fn(), warn: jest.fn() };
    const open = (hours: any, bizHours: any) => service.isWithinBusinessHours({ hours } as any, bizHours);

    afterEach(() => jest.useRealTimers());
    const at = (date: Date) => { jest.useFakeTimers(); jest.setSystemTime(date); };

    describe('business hours that list a week decide (and win over the agent schedule)', () => {
        it('is open inside the listed day, closed outside it', () => {
            at(WEDNESDAY_11AM);
            expect(open(agentWeek, businessWeek)).toBe(true);
            at(WEDNESDAY_8PM);
            expect(open(agentWeek, businessWeek)).toBe(false);
        });

        it('24/7 is always open, whatever the agent schedule says', () => {
            at(WEDNESDAY_8PM);
            expect(open(agentWeek, { is247: true })).toBe(true);
        });
    });

    describe('no business schedule -> the agent schedule decides', () => {
        it.each([
            ['no record', null],
            ['the empty wizard record', wizardShell],
            ['an empty object', {}],
        ])('%s: closed outside the agent window (the one the prompt quotes), open inside it', (_label, bizHours) => {
            at(WEDNESDAY_8PM);
            expect(open(agentWeek, bizHours)).toBe(false);
            at(new Date('2026-10-07T20:00:00Z')); // 15:00 Bogota, inside 14:00-18:00
            expect(open(agentWeek, bizHours)).toBe(true);
        });

        it('uses the wizard record timezone when the agent schedule has none', () => {
            // 20:00 Bogota is 21:00 in Caracas (UTC-4): inside a 20:30-22:00 window there, outside it in Bogota.
            const agent = { schedule: { mie: { start: '20:30', end: '22:00' } } };
            at(WEDNESDAY_8PM); // 20:00 Bogota
            expect(open(agent, { ...wizardShell, timezone: 'America/Bogota' })).toBe(false);
            expect(open(agent, { ...wizardShell, timezone: 'America/Caracas' })).toBe(true); // 21:00 there
        });
    });

    describe('nothing configured anywhere -> open, as before (the appointment agenda is not consulted)', () => {
        it.each([
            ['no agent hours, no record', undefined, null],
            ['empty agent schedule, no record', { schedule: {} }, null],
            ['empty agent schedule + wizard record', { schedule: {}, timezone: 'America/Bogota' }, wizardShell],
            ['no agent schedule at all + wizard record', {}, wizardShell],
        ])('%s', (_label, hours, bizHours) => {
            at(WEDNESDAY_8PM);
            expect(open(hours, bizHours)).toBe(true);
        });
    });
});
