import { BroadcastService } from './broadcast.service';

/**
 * ═══ A FANOUT WITHOUT A CEILING IS THE EVENT THIS PREVENTS ═══
 *
 * A campaign is the one producer that turns a single click into five thousand
 * charges. Its ceiling is declared BEFORE the fanout for a reason that is only
 * about order: once `addBulk` returns, ten workers are running against the
 * campaign at once, and a window in a spending limit is the same as no limit.
 *
 * Two things were wrong with the declaration, and each of them made the ceiling
 * exist without applying:
 *
 *   1. It swallowed its own failure. A budget that could not be written was
 *      logged and the fanout went ahead — one error line, then five thousand
 *      successful sends. "Degrade rather than stop" is right almost everywhere
 *      and wrong here, because the thing being degraded IS the limit.
 *
 *   2. It used the UTC month. Every worker counts its effect against the
 *      calendar month of the WhatsApp account's OWN time zone, and for a WABA
 *      in Bogotá those disagree for five hours at every month boundary. A
 *      campaign launched at 00:30 UTC on 1 October declared a ceiling for
 *      `2026-10` while its workers counted against `2026-09`: correct, present,
 *      and applying to nothing.
 */
describe('a campaign does not start until its ceiling is confirmed', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const campaignId = '22222222-2222-4222-8222-222222222222';

    function harness(options: {
        zone?: string | null; budgetFails?: boolean; accountMissing?: boolean;
    } = {}) {
        const budgetTask = jest.fn(async () => {
            if (options.budgetFails) throw new Error('ledger unreachable');
            return { capDeliveries: 500, usedDeliveries: 0 } as any;
        });
        const prisma = {
            channelAccount: {
                findFirst: jest.fn(async () => (options.accountMissing ? null : {
                    accountId: 'phone-1',
                    wabaTimezone: options.zone === undefined ? 'America/Bogota' : options.zone,
                })),
            },
        };
        const service = new BroadcastService(
            prisma as any, {} as any, {} as any, {} as any, {} as any, {} as any,
            { budgetTask } as any,
        );
        jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
        jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
        return { service, budgetTask, prisma };
    }

    const declare = (service: BroadcastService, deliveries = 500) =>
        (service as any).declareCampaignBudget(
            'tenant_acme', tenantId, 'phone-1', campaignId, deliveries);

    it('declares the ceiling in the WhatsApp account’s own calendar month', async () => {
        const h = harness({ zone: 'America/Bogota' });
        // 01:30 UTC on 1 November is still 20:30 on 31 October in Bogotá, so
        // the workers will count these deliveries against October. The producer
        // has to agree, or the ceiling applies to a month with no messages in
        // it — which is indistinguishable from no ceiling at all.
        jest.useFakeTimers().setSystemTime(new Date('2026-11-01T01:30:00.000Z'));
        try {
            await declare(h.service);
        } finally {
            jest.useRealTimers();
        }
        expect(h.budgetTask).toHaveBeenCalledWith('tenant_acme',
            expect.objectContaining({ taskId: campaignId, period: '2026-10', deliveries: 500 }));
    });

    it('refuses to launch when the ceiling could not be written', async () => {
        // The whole correction. This used to log and continue.
        const h = harness({ budgetFails: true });
        await expect(declare(h.service)).rejects.toThrow('ledger unreachable');
    });

    it('refuses to launch a number with no billing time zone, rather than guessing one', async () => {
        // `America/Bogota` assumed for a WABA in Manila is the same defect with
        // a different sign: a ceiling attached to the wrong month.
        const h = harness({ zone: null });
        await expect(declare(h.service)).rejects.toThrow(/zona horaria de facturación/);
        expect(h.budgetTask).not.toHaveBeenCalled();
    });

    it('refuses when the campaign names a number this tenant does not have', async () => {
        const h = harness({ accountMissing: true });
        await expect(declare(h.service)).rejects.toThrow(/zona horaria de facturación/);
        expect(h.budgetTask).not.toHaveBeenCalled();
    });

    it('asks for nothing when the campaign sends no WhatsApp at all', async () => {
        // An email-only campaign has no WhatsApp ceiling to declare, and
        // demanding a WABA time zone from it would refuse a launch that costs
        // Meta nothing.
        const h = harness();
        await expect(declare(h.service, 0)).resolves.toBeUndefined();
        expect(h.budgetTask).not.toHaveBeenCalled();
        expect(h.prisma.channelAccount.findFirst).not.toHaveBeenCalled();
    });

    it('asks the ledger for the exact number of WhatsApp deliveries in the batch', async () => {
        const h = harness();
        await declare(h.service, 137);
        expect(h.budgetTask).toHaveBeenCalledWith('tenant_acme',
            expect.objectContaining({ deliveries: 137 }));
    });
});
