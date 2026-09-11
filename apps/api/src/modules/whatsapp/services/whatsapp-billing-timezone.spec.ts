import { WhatsappConnectionService } from './whatsapp-connection.service';
import { isConnectionRefusal } from '../../channels/connection-refusal';
import { wabaLocalDate } from '../../billing/whatsapp-rates';

/**
 * ═══ THE ZONE META'S CHARGES ARE DATED IN ═══
 *
 * From 1 October 2026 the rate depends on the effective date and the free
 * thousand resets per number per calendar month. Both are answered in the WABA's
 * own zone, so it has to be settable — and it has to be settable to something
 * the pricing runtime can actually use.
 *
 * The trap this exists to close: Meta returns `timezone_id`, a NUMERIC Facebook
 * id. Written into an IANA column it would make `Intl.DateTimeFormat` reject
 * every price forever — a channel that quietly stopped delivering, months after
 * anyone touched it.
 */
describe('setting the WhatsApp billing time zone', () => {
    const TENANT = '11111111-1111-4111-8111-111111111111';
    const NUMBER = '15550001111';

    const serviceWith = (account: { id: string; metadata?: unknown } | null,
        siblings: any[] = []) => {
        const update = jest.fn().mockResolvedValue({});
        const prisma = {
            channelAccount: {
                findFirst: jest.fn().mockResolvedValue(account),
                findMany: jest.fn().mockResolvedValue(siblings),
                update,
            },
        };
        const service = new WhatsappConnectionService(
            prisma as any, {} as any, { get: () => undefined } as any, {} as any,
        );
        return { service, prisma, update };
    };

    const outcome = async (pending: Promise<unknown>) => {
        try { return `set:${JSON.stringify(await pending)}`; }
        catch (error: any) { return `refused:${error?.code ?? error?.message ?? 'unknown'}`; }
    };

    it('accepts an IANA zone and stores exactly that', async () => {
        const { service, update } = serviceWith({ id: 'acct-1' });
        await expect(service.setBillingTimeZone(TENANT, NUMBER, 'America/Bogota'))
            .resolves.toEqual({ phoneNumberId: NUMBER, timeZone: 'America/Bogota', alsoApplied: [] });
        expect(update).toHaveBeenCalledWith({
            where: { id: 'acct-1' },
            data: {
                wabaTimezone: 'America/Bogota',
                // The evidence beside the answer: without it the platform can
                // say WHAT the zone is and not WHY, and "why" is the difference
                // between a fact somebody confirmed and a value that appeared.
                metadata: {
                    wabaTimezoneEvidence: {
                        source: 'human_confirmed', at: expect.any(String),
                        timezoneId: null, wabaId: null,
                    },
                },
            },
        });
    });

    it('carries one confirmation to every number that reports the same Meta zone', async () => {
        // Six numbers on one business account used to mean six forms. Meta's
        // zone belongs to the WABA, so a sibling reporting the SAME numeric id
        // is the same fact read twice rather than a second guess.
        const { service, update } = serviceWith(
            { id: 'acct-1', metadata: { wabaId: 'waba-1', metaTimezoneId: '42', phoneNumberId: NUMBER } },
            [
                { id: 'acct-2', accountId: '15550002222',
                    metadata: { wabaId: 'waba-1', metaTimezoneId: '42' } },
                // Same WABA, DIFFERENT id: Meta says these are different zones.
                { id: 'acct-3', accountId: '15550003333',
                    metadata: { wabaId: 'waba-1', metaTimezoneId: '7' } },
                // Same id, DIFFERENT WABA: two accounts can share an id and sit
                // in different countries.
                { id: 'acct-4', accountId: '15550004444',
                    metadata: { wabaId: 'waba-2', metaTimezoneId: '42' } },
            ]);

        const result = await service.setBillingTimeZone(TENANT, NUMBER, 'America/Bogota');
        expect(result.alsoApplied).toEqual(['15550002222']);
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'acct-2' },
            data: expect.objectContaining({ wabaTimezone: 'America/Bogota' }),
        }));
        for (const id of ['acct-3', 'acct-4']) {
            expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id } }));
        }
    });

    it('never overwrites a number that already has its own zone', async () => {
        // The query asks only for numbers with no zone. Overwriting somebody's
        // explicit choice because a sibling was set later would be the platform
        // deciding it knows better, silently, about money.
        const { service, prisma } = serviceWith(
            { id: 'acct-1', metadata: { wabaId: 'waba-1', metaTimezoneId: '42' } }, []);
        await service.setBillingTimeZone(TENANT, NUMBER, 'America/Bogota');
        expect(prisma.channelAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ wabaTimezone: null }),
        }));
    });

    it('does not carry anything when Meta gave no id to match on', async () => {
        const { service, prisma } = serviceWith({ id: 'acct-1', metadata: { wabaId: 'waba-1' } }, []);
        expect((await service.setBillingTimeZone(TENANT, NUMBER, 'UTC')).alsoApplied).toEqual([]);
        expect(prisma.channelAccount.findMany).not.toHaveBeenCalled();
    });

    it('refuses Meta\'s numeric timezone_id, which is the value most likely to arrive', async () => {
        const { service, update } = serviceWith({ id: 'acct-1' });
        for (const value of ['12', '0', '  7 ']) {
            expect(await outcome(service.setBillingTimeZone(TENANT, NUMBER, value)))
                .toContain('no es una zona horaria IANA');
        }
        expect(update).not.toHaveBeenCalled();
    });

    it('refuses a typo instead of storing something that would refuse every price', async () => {
        const { service, update } = serviceWith({ id: 'acct-1' });
        for (const value of ['America/Bogotá', 'America/Bogot', 'GMT-5:00', '', '   ']) {
            expect(await outcome(service.setBillingTimeZone(TENANT, NUMBER, value)))
                .toContain('no es una zona horaria IANA');
        }
        expect(update).not.toHaveBeenCalled();
    });

    it('accepts only what the pricing runtime can date with', async () => {
        // Validated by the SAME function that resolves a rate. A zone accepted
        // here that the resolver later rejects would move the failure to the
        // first message somebody tried to send.
        const { service } = serviceWith({ id: 'acct-1' });
        for (const zone of ['America/Bogota', 'America/Argentina/Buenos_Aires', 'UTC', 'Europe/Madrid']) {
            expect({ zone, dated: wabaLocalDate(new Date(), zone) !== null })
                .toEqual({ zone, dated: true });
            await expect(service.setBillingTimeZone(TENANT, NUMBER, zone)).resolves.toBeTruthy();
        }
    });

    it('trims, because a trailing space is a typo and not a different zone', async () => {
        const { service, update } = serviceWith({ id: 'acct-1' });
        await service.setBillingTimeZone(TENANT, NUMBER, '  America/Bogota  ');
        expect(update).toHaveBeenCalledWith({
            where: { id: 'acct-1' },
            data: expect.objectContaining({ wabaTimezone: 'America/Bogota' }),
        });
    });

    it('refuses a number this tenant does not have, in the shared vocabulary', async () => {
        const { service, update } = serviceWith(null);
        try {
            await service.setBillingTimeZone(TENANT, NUMBER, 'America/Bogota');
            throw new Error('should have refused');
        } catch (error) {
            // The same codes every other resolver answers with, so a caller does
            // not have to learn a second set for this one endpoint.
            expect(isConnectionRefusal(error)).toBe(true);
            expect((error as any).code).toBe('connection_not_found');
        }
        expect(update).not.toHaveBeenCalled();
    });
});
