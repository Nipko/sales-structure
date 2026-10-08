import { AutomationListenerService } from './automation-listener.service';
import { ConversationsService } from '../conversations/conversations.service';

/**
 * The automation listener asks "are we open?" before running rules (lead.captured is skipped when closed,
 * `businessHoursStatus` feeds new_message rules). It used to read only the agent schedule and look the day
 * up with English abbreviations (`mon`) while the agent stores Spanish ones (`lun`): no entry for today ->
 * "closed" every day of the week, and an empty `{}` schedule too. Now it shares the conversation gate.
 *
 * Wednesday 2026-10-07: 11:00, 15:00 and 20:00 in Bogota (UTC-5).
 */
const WED_11 = new Date('2026-10-07T16:00:00Z');
const WED_15 = new Date('2026-10-07T20:00:00Z');
const WED_20 = new Date('2026-10-08T01:00:00Z');
const TZ = 'America/Bogota';

function build(businessHours: any, opts: { failTenantRead?: boolean } = {}) {
    const prisma = {
        tenant: {
            findUnique: opts.failTenantRead
                ? jest.fn().mockRejectedValue(new Error('db down'))
                : jest.fn().mockResolvedValue({ settings: businessHours === undefined ? {} : { businessHours } }),
        },
    };
    const regional = { timezoneFor: jest.fn().mockResolvedValue('America/Mexico_City') };
    const service: any = new AutomationListenerService(prisma as any, {} as any, {} as any, {} as any, regional as any);
    return { service, prisma, regional };
}

describe('AutomationListenerService.isWithinBusinessHours', () => {
    afterEach(() => jest.useRealTimers());
    const at = (date: Date) => { jest.useFakeTimers(); jest.setSystemTime(date); };

    it('reads an agent schedule stored with Spanish keys (the production defect: always closed)', async () => {
        const { service } = build(undefined);
        const config = { hours: { timezone: TZ, schedule: { mie: { start: '14:00', end: '18:00' } } } };
        at(WED_15); expect(await service.isWithinBusinessHours(config, 't1')).toBe(true);
        at(WED_11); expect(await service.isWithinBusinessHours(config, 't1')).toBe(false);
        at(WED_20); expect(await service.isWithinBusinessHours(config, 't1')).toBe(false);
    });

    it('reads Monday (lun) and the closing-minute boundary', async () => {
        const { service } = build(undefined);
        const config = { hours: { timezone: TZ, schedule: { lun: { start: '08:00', end: '12:00' } } } };
        at(new Date('2026-10-05T11:00:00-05:00')); expect(await service.isWithinBusinessHours(config, 't1')).toBe(true);
        at(new Date('2026-10-05T12:00:00-05:00')); expect(await service.isWithinBusinessHours(config, 't1')).toBe(true);
        at(new Date('2026-10-05T12:01:00-05:00')); expect(await service.isWithinBusinessHours(config, 't1')).toBe(false);
        at(new Date('2026-10-06T11:00:00-05:00')); expect(await service.isWithinBusinessHours(config, 't1')).toBe(false);
    });

    it('honours an overnight agent window', async () => {
        const { service } = build(undefined);
        const config = { hours: { timezone: TZ, schedule: { lun: { start: '22:00', end: '02:00' } } } };
        at(new Date('2026-10-05T23:00:00-05:00')); expect(await service.isWithinBusinessHours(config, 't1')).toBe(true);
        at(new Date('2026-10-06T01:00:00-05:00')); expect(await service.isWithinBusinessHours(config, 't1')).toBe(true);
        at(new Date('2026-10-06T03:00:00-05:00')); expect(await service.isWithinBusinessHours(config, 't1')).toBe(false);
    });

    it('still reads English-abbreviated keys', async () => {
        const { service } = build(undefined);
        at(WED_15);
        expect(await service.isWithinBusinessHours({ hours: { timezone: TZ, schedule: { wed: { start: '14:00', end: '18:00' } } } }, 't1')).toBe(true);
    });

    it('business hours that list a week take precedence over the agent schedule', async () => {
        const { service } = build({ is247: false, timezone: TZ, schedule: { wednesday: { enabled: true, open: '08:00', close: '12:00' } } });
        const config = { hours: { timezone: TZ, schedule: { mie: { start: '14:00', end: '18:00' } } } };
        at(WED_11); expect(await service.isWithinBusinessHours(config, 't1')).toBe(true);
        at(WED_15); expect(await service.isWithinBusinessHours(config, 't1')).toBe(false);
    });

    it('24/7 business hours are always open', async () => {
        const { service } = build({ is247: true });
        at(WED_20);
        expect(await service.isWithinBusinessHours({ hours: { schedule: { mie: { start: '14:00', end: '18:00' } } } }, 't1')).toBe(true);
    });

    it('an empty agent schedule, an empty wizard record or nothing at all is open (it used to be closed)', async () => {
        at(WED_20);
        for (const [biz, hours] of [[undefined, { schedule: {} }], [{ is247: false, timezone: TZ, schedule: {} }, { schedule: {} }], [undefined, undefined]] as const) {
            const { service } = build(biz);
            expect(await service.isWithinBusinessHours({ hours }, 't1')).toBe(true);
        }
    });

    it('the empty wizard record does not hide the agent schedule', async () => {
        const { service } = build({ is247: false, timezone: TZ, schedule: {} });
        const config = { hours: { schedule: { mie: { start: '14:00', end: '18:00' } } } };
        at(WED_20);
        expect(await service.isWithinBusinessHours(config, 't1')).toBe(false);
    });

    it('uses the regional time zone only when neither source names one', async () => {
        const { service, regional } = build(undefined);
        const config = { hours: { schedule: { mie: { start: '14:00', end: '18:00' } } } };
        at(WED_15); // 15:00 Bogota = 14:00 Mexico City
        expect(await service.isWithinBusinessHours(config, 't1')).toBe(true);
        expect(regional.timezoneFor).toHaveBeenCalledWith('t1');
        const named = build(undefined);
        await named.service.isWithinBusinessHours({ hours: { timezone: TZ, schedule: { mie: { start: '14:00', end: '18:00' } } } }, 't1');
        expect(named.regional.timezoneFor).not.toHaveBeenCalled();
    });

    it('falls back to the agent schedule when the business hours cannot be read', async () => {
        const { service } = build(undefined, { failTenantRead: true });
        const config = { hours: { timezone: TZ, schedule: { mie: { start: '14:00', end: '18:00' } } } };
        at(WED_15);
        expect(await service.isWithinBusinessHours(config, 't1')).toBe(true);
    });
});

describe('the conversation gate and the automation gate agree on the same inputs', () => {
    afterEach(() => jest.useRealTimers());
    const conversations: any = Object.create(ConversationsService.prototype);
    conversations.logger = { debug: jest.fn(), log: jest.fn(), warn: jest.fn() };

    const wizard = { is247: false, timezone: TZ, schedule: {} };
    const week = { is247: false, timezone: TZ, schedule: { wednesday: { enabled: true, open: '08:00', close: '12:00' } } };
    const agentEs = { timezone: TZ, schedule: { mie: { start: '14:00', end: '18:00' } } };
    const agentEn = { timezone: TZ, schedule: { wed: { start: '14:00', end: '18:00' } } };
    const agentFull = { timezone: TZ, schedule: { wednesday: '14:00-18:00' } };

    const cases: Array<[string, any, any]> = [
        ['nothing', undefined, undefined],
        ['empty agent schedule', undefined, { schedule: {} }],
        ['wizard record only', wizard, { schedule: {} }],
        ['business week only', week, { schedule: {} }],
        ['business 24/7', { is247: true }, agentEs],
        ['business week + agent', week, agentEs],
        ['agent Spanish keys', undefined, agentEs],
        ['agent Spanish keys + wizard record', wizard, agentEs],
        ['agent English short keys', undefined, agentEn],
        ['agent string windows', undefined, agentFull],
    ];

    it.each(cases)('%s', async (_label, biz, agent) => {
        for (const now of [WED_11, WED_15, WED_20]) {
            jest.useFakeTimers(); jest.setSystemTime(now);
            const { service } = build(biz);
            const automation = await service.isWithinBusinessHours({ hours: agent }, 't1');
            const conversation = conversations.isWithinBusinessHours({ hours: agent }, biz ?? null);
            expect({ at: now.toISOString(), open: automation }).toEqual({ at: now.toISOString(), open: conversation });
        }
    });
});
