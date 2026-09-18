import { AIToolExecutorService } from './ai-tool-executor.service';
import { appointmentServiceTerms, appointmentTermsReviewResult } from '../appointments/appointment-service-terms';
import { customerFacingPrice, projectAvailableService } from '../appointments/service-price-status';

/**
 * FX1-1 (sep-2026): a row with no amount is "no price", never "free".
 *
 * D17 seeds services WITHOUT an amount outside the six countries that have an
 * example price. Before FX1, "Confirmar precio" on one of those rows stored it
 * as confirmed with price NULL, and every projection the customer reads coerced
 * the NULL: `Number(s.price || 0)` handed the model `price: 0` next to
 * `priceStatus: 'confirmed'` — a free service, stated as fact. The write path
 * no longer produces that row, but a row like it can still exist (legacy data,
 * a service created without a price), so every customer-facing projection
 * reads it the same way: no number, "te confirman el precio".
 */

const base = {
    description: null, duration_minutes: 45, buffer_minutes: 0, currency: 'UYU', duration_type: 'fixed',
    duration_minutes_max: null, payment_policy: 'none', deposit_percent: null, deposit_amount: null,
    category: 'consulta', is_active: true,
};
const CONFIRMED_NO_AMOUNT = { ...base, id: '11111111-1111-4111-8111-111111111111', name: 'Consulta general', price: null, price_status: 'confirmed' };
const CONFIRMED_FREE = { ...base, id: '22222222-2222-4222-8222-222222222222', name: 'Clase de prueba', price: '0', price_status: 'confirmed' };

function executor(rows: any[], plans: any[] = []) {
    const service = Object.create(AIToolExecutorService.prototype);
    service.prisma = {
        $queryRawUnsafe: jest.fn(async () => rows),
        executeInTenantSchema: jest.fn(async () => rows),
    };
    service.gymsService = { listPlans: jest.fn(async () => plans) };
    service.logger = { warn: jest.fn() };
    return service;
}

describe('a confirmed row without an amount is not free', () => {
    it('the single reading: no amount means no number and a pending status', () => {
        expect(customerFacingPrice({ price: null, price_status: 'confirmed' })).toEqual({ priceStatus: 'example', price: null });
        expect(customerFacingPrice({ price: '', price_status: null })).toEqual({ priceStatus: 'example', price: null });
        expect(customerFacingPrice({ price: '0', price_status: 'confirmed' })).toEqual({ priceStatus: 'confirmed', price: 0 });
        expect(customerFacingPrice({ price: '80000.00', price_status: null })).toEqual({ priceStatus: 'confirmed', price: 80000 });
        expect(customerFacingPrice({ price: '40000', price_status: 'example' })).toEqual({ priceStatus: 'example', price: null });
        expect(customerFacingPrice({ price: '0', price_status: 'quote' })).toEqual({ priceStatus: 'quote', price: null });
    });

    it('list_services hands the model no number, the pending note and no payment', async () => {
        const out = await executor([CONFIRMED_NO_AMOUNT, CONFIRMED_FREE]).listServices('tenant_x');
        expect(out.services[0]).toMatchObject({ price: null, priceStatus: 'example', requiresPaymentToConfirm: false, amountDueToConfirm: null });
        expect(out.services[0].priceNote).toMatch(/no digas ningún monto/);
        // A 0 the owner confirmed IS free, and stays so.
        expect(out.services[1]).toMatchObject({ price: 0, priceStatus: 'confirmed' });
        expect(out.services[1].priceNote).toBeUndefined();
    });

    it('the pet and photo package lists read it the same way', async () => {
        const out = await executor([CONFIRMED_NO_AMOUNT]).listConfiguredServicesTool('tenant_x');
        expect(out.services[0]).toMatchObject({ price: null, priceStatus: 'example' });
        expect(out.services[0].priceNote).toMatch(/no digas ningún monto/);
    });

    it('get_membership_plans never states a placeholder, and states a declared free plan', async () => {
        const out = await executor([], [
            { id: 'p1', name: 'Mensual', description: null, duration_days: 30, price: '0.00', price_status: 'example', currency: 'UYU', perks: [] },
            { id: 'p2', name: 'Comunitario', description: null, duration_days: 30, price: '0.00', price_status: 'confirmed', currency: 'UYU', perks: [] },
        ]).getMembershipPlans('tenant_x');
        expect(out.plans[0]).toMatchObject({ price: undefined, priceStatus: 'example', currency: undefined });
        expect(out.plans[1]).toMatchObject({ price: 0, priceStatus: 'confirmed', currency: 'UYU' });
    });

    it('the frozen appointment terms carry the pending status, so a re-proposal never says "0"', () => {
        const terms = appointmentServiceTerms(CONFIRMED_NO_AMOUNT);
        expect(terms).toMatchObject({ price: 0, priceStatus: 'example', requiresPayment: false, amountDue: null });
        const review = appointmentTermsReviewResult(terms).service as any;
        expect(review).toMatchObject({ price: null, priceStatus: 'example' });
        expect(review.priceNote).toMatch(/no digas ningún monto/);
        expect(appointmentServiceTerms(CONFIRMED_FREE)).not.toHaveProperty('priceStatus');
    });

    it('the prompt projection does not print a confirmed service with a null price as confirmed', () => {
        expect(projectAvailableService({ id: 'a', name: 'Consulta', price: null, priceStatus: 'confirmed' }))
            .toMatchObject({ price: undefined, priceStatus: 'example' });
        expect(projectAvailableService({ id: 'b', name: 'Clase', price: 0, priceStatus: 'confirmed' }))
            .toMatchObject({ price: 0, priceStatus: 'confirmed' });
    });
});
