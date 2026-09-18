import { PublicBookingController, publicBookingService } from './public-booking.controller';

/**
 * The public booking API is public JSON: whatever it returns, anyone with the
 * slug can read, whether or not the booking page draws it. An example price
 * nobody confirmed must therefore never travel in it — the same rule as every
 * other customer-facing reader (`customerFacingPrice`).
 */
const serviceId = '11111111-1111-4111-8111-111111111111';

const base = {
    id: serviceId, name: 'Mensualidad', description: null, durationMinutes: 60, durationMinutesMax: null,
    durationType: 'fixed', bufferMinutes: 0, currency: 'COP', color: '#6c5ce7', isActive: true, sortOrder: 0,
    category: null, maxConcurrent: 1, rebookAfterDays: null, requiredFields: [], paymentPolicy: 'none',
    depositPercent: null, depositAmount: null,
};
const example = { ...base, id: 'svc-example', price: 180000, priceStatus: 'example' };
const quote = { ...base, id: 'svc-quote', price: 0, priceStatus: 'quote' };
const noAmount = { ...base, id: 'svc-none', price: null, priceStatus: 'confirmed' };
const confirmed = { ...base, id: 'svc-confirmed', price: 95000, priceStatus: 'confirmed' };
const free = { ...base, id: 'svc-free', price: 0, priceStatus: 'confirmed' };

function harness(services: any[]) {
    const prisma = {
        $queryRaw: jest.fn().mockResolvedValue([{
            id: '33333333-3333-4333-8333-333333333333', schema_name: 'tenant_public_booking', name: 'Negocio',
            is_internal: false, subscription_status: 'active', public_booking_enabled: true,
        }]),
    };
    const servicesService = {
        list: jest.fn(async () => services),
        getById: jest.fn(async (_schema: string, id: string) => services.find((service) => service.id === id)),
    };
    const appointments = { getBookableSlots: jest.fn().mockResolvedValue([]) };
    const calendar = { getFreeBusyForDate: jest.fn().mockResolvedValue([]) };
    const redis = { incrementRateLimit: jest.fn().mockResolvedValue(1) };
    const controller = new PublicBookingController(prisma as any, redis as any, appointments as any,
        servicesService as any, calendar as any, {} as any, { phoneRegionFor: jest.fn() } as any);
    return { controller };
}

describe('public booking API price projection', () => {
    it('never puts an unconfirmed amount in the public service list', async () => {
        const { controller } = harness([example, quote, noAmount, confirmed, free]);

        const result = await controller.listServices('negocio');

        expect(result.data.map(({ id, price, priceStatus }: any) => ({ id, price, priceStatus }))).toEqual([
            { id: 'svc-example', price: null, priceStatus: 'example' },
            { id: 'svc-quote', price: null, priceStatus: 'quote' },
            // No amount at all is "por confirmar", never a free service.
            { id: 'svc-none', price: null, priceStatus: 'example' },
            { id: 'svc-confirmed', price: 95000, priceStatus: 'confirmed' },
            // A confirmed 0 is the owner's own "free".
            { id: 'svc-free', price: 0, priceStatus: 'confirmed' },
        ]);
        expect(JSON.stringify(result)).not.toContain('180000');
    });

    it('projects the single-service read the same way', async () => {
        const { controller } = harness([example]);

        const result = await controller.getService('negocio', 'svc-example');

        expect(result.data).toMatchObject({ id: 'svc-example', name: 'Mensualidad', price: null, priceStatus: 'example' });
        expect(JSON.stringify(result)).not.toContain('180000');
    });

    it('projects the service that travels with the slots too', async () => {
        const { controller } = harness([example]);

        const result = await controller.getAvailableSlots('negocio', '2026-09-20', 'svc-example', { ip: '127.0.0.1' });

        expect(result.data.service).toMatchObject({ price: null, priceStatus: 'example' });
        expect(JSON.stringify(result)).not.toContain('180000');
    });

    it('keeps every other field of the service as it was', () => {
        expect(publicBookingService(confirmed)).toEqual(confirmed);
        expect(publicBookingService(example)).toEqual({ ...example, price: null, priceStatus: 'example' });
    });
});
