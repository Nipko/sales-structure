import { IcalSyncService } from './ical-sync.service';

describe('IcalSyncService.generateFeed', () => {
    it('keeps an OTA all-day DTEND exclusive and normalizes same-day events', () => {
        const service = new IcalSyncService({} as any, {} as any);
        const getRange = (event: any) => (service as any).getEventDateRange(event);

        expect(getRange({
            datetype: 'date',
            start: new Date('2026-08-10T00:00:00.000Z'),
            end: new Date('2026-08-12T00:00:00.000Z'),
        })).toEqual({ checkIn: '2026-08-10', checkOut: '2026-08-12' });

        expect(getRange({
            start: new Date('2026-08-10T15:00:00.000Z'),
            end: new Date('2026-08-10T18:00:00.000Z'),
        })).toEqual({ checkIn: '2026-08-10', checkOut: '2026-08-11' });
    });

    it('exports the stored checkout directly as exclusive DTEND', async () => {
        const prisma = {
            executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
                if (sql.includes('SELECT name FROM properties')) return [{ name: 'Casa Mar' }];
                if (sql.includes('FROM ical_blocks')) {
                    return [
                        {
                            id: '11111111-1111-4111-8111-111111111111',
                            check_in: '2026-08-10',
                            check_out: '2026-08-12',
                            source: 'Airbnb',
                            summary: 'Reserved',
                            date_range_semantics: 2,
                        },
                        {
                            id: '44444444-4444-4444-8444-444444444444',
                            check_in: '2026-09-01',
                            check_out: '2026-09-02',
                            source: 'Legacy',
                            summary: 'Reserved',
                            date_range_semantics: 1,
                        },
                    ];
                }
                if (sql.includes('FROM property_bookings')) {
                    return [{
                        id: '22222222-2222-4222-8222-222222222222',
                        check_in: '2026-08-20',
                        check_out: '2026-08-23',
                    }];
                }
                throw new Error(`Unexpected SQL: ${sql}`);
            }),
        };
        const service = new IcalSyncService(prisma as any, {} as any);

        const feed = await service.generateFeed(
            'tenant_vacation',
            '33333333-3333-4333-8333-333333333333',
        );

        expect(feed).toContain('DTSTART;VALUE=DATE:20260810');
        expect(feed).toContain('DTEND;VALUE=DATE:20260812');
        expect(feed).toContain('DTSTART;VALUE=DATE:20260820');
        expect(feed).toContain('DTEND;VALUE=DATE:20260823');
        expect(feed).toContain('DTSTART;VALUE=DATE:20260901');
        expect(feed).toContain('DTEND;VALUE=DATE:20260903');
        expect(feed).not.toContain('DTEND;VALUE=DATE:20260813');
        expect(feed).not.toContain('DTEND;VALUE=DATE:20260824');
    });
});
