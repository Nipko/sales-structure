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

    const serviceWith = (account: { id: string } | null) => {
        const update = jest.fn().mockResolvedValue({});
        const prisma = {
            channelAccount: { findFirst: jest.fn().mockResolvedValue(account), update },
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
            .resolves.toEqual({ phoneNumberId: NUMBER, timeZone: 'America/Bogota' });
        expect(update).toHaveBeenCalledWith({
            where: { id: 'acct-1' }, data: { wabaTimezone: 'America/Bogota' },
        });
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
            where: { id: 'acct-1' }, data: { wabaTimezone: 'America/Bogota' },
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
