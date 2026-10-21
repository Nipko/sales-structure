import { BadRequestException } from '@nestjs/common';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { PropertiesService } from '../vacation-rental/properties.service';

const propertyId = '11111111-1111-4111-8111-111111111111';

function harness() {
    const property = { id: propertyId, is_active: true, max_guests: 2, min_nights: 1, night_price: 100, cleaning_fee: 0, currency: 'COP' };
    const prisma = { executeInTenantSchema: jest.fn(async (_schema: string, sql: string) =>
        sql.includes('SELECT * FROM properties WHERE id') ? [property] : []) };
    // Use the real property date validator rather than a mock with a matching message.
    const properties = new PropertiesService(prisma as any, {} as any, {} as any);
    const executor = Reflect.construct(AIToolExecutorService, Array(40).fill({})) as any;
    executor.propertiesService = properties;
    jest.spyOn(executor.logger, 'warn').mockImplementation(() => undefined);
    return { executor, prisma, properties,
        check: (start: string, end: string, id = propertyId, guests = 1) =>
            executor.checkPropertyAvailability('tenant_test', id, start, end, guests, 'tenant') };
}

describe('Property availability input failures stay actionable', () => {
    it.each([
        ['2027-03-12', '2027-03-12', 'checkout_must_be_after_checkin'],
        ['2027-03-15', '2027-03-12', 'checkout_must_be_after_checkin'],
        ['2027-02-30', '2027-03-02', 'invalid_check_in_date'],
        ['2027-02-28', '2027-02-30', 'invalid_check_out_date'],
        ['12/03/2027', '2027-03-14', 'invalid_check_in_date'],
    ])('returns a non-retryable input error for %s to %s before database access', async (start, end, code) => {
        const h = harness();
        const result = await h.check(start, end);
        expect(result).toMatchObject({ status: 'error', error: code, errorCode: code, retryable: false, source: 'derived' });
        expect(result.message).toMatch(/fecha|salida|entrada/i);
        expect(result).not.toHaveProperty('available');
        expect(h.prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('tells the agent to resolve a property ID itself instead of asking the customer for a UUID', async () => {
        const h = harness();
        const result = await h.check('2027-03-12', '2027-03-14', 'Synthetic room');
        expect(result).toMatchObject({ errorCode: 'invalid_property_id', retryable: false, source: 'derived' });
        expect(result.message).toContain('list_properties');
        expect(result.message).toMatch(/no.*cliente/i);
        expect(h.prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('keeps a genuine database failure retryable and does not echo its details', async () => {
        const h = harness();
        h.prisma.executeInTenantSchema.mockRejectedValue(new Error('synthetic private database diagnostic'));
        const result = await h.check('2027-03-12', '2027-03-14');
        expect(result).toMatchObject({ errorCode: 'read_failed', retryable: true });
        expect(JSON.stringify(result)).not.toContain('private database diagnostic');
    });

    it('does not classify an unrelated BadRequest as a customer date error', async () => {
        const h = harness();
        jest.spyOn(h.properties, 'checkAvailability').mockRejectedValue(new BadRequestException('synthetic unrelated validation'));
        expect(await h.check('2027-03-12', '2027-03-14')).toMatchObject({ errorCode: 'read_failed', retryable: true });
    });

    it('preserves a valid stay and its price', async () => {
        const h = harness();
        expect(await h.check('2027-03-12', '2027-03-14')).toMatchObject({ available: true, nights: 2, totalPrice: 200, currency: 'COP' });
    });

    it('preserves a real capacity rejection', async () => {
        const h = harness();
        expect(await h.check('2027-03-12', '2027-03-14', propertyId, 3)).toMatchObject({ available: false, reason: expect.stringContaining('max 2') });
    });
});
