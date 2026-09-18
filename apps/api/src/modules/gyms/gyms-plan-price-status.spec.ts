import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GymsService, resolvePlanPriceStatus } from './gyms.service';

/**
 * D10 for membership plans. The seed writes plans as 'example' and
 * `get_membership_plans` withholds an unconfirmed amount — so before this, an
 * owner who corrected "Mensual" saved the right number and the agent kept
 * refusing to say it, forever: `updatePlan` never touched `price_status`.
 *
 * These specs pin the rule and the statement the service sends. What the
 * database does with it (NOT NULL price, a re-run of the backfill never undoing
 * a confirmation) is proven against PostgreSQL in
 * `verticals/seeded-price-backfill.postgres.spec.ts`.
 */

const EXAMPLE_PLAN = { id: '00000000-0000-4000-8000-000000000001', price: '150000.00', price_status: 'example' };
const PLACEHOLDER_PLAN = { id: '00000000-0000-4000-8000-000000000002', price: '0.00', price_status: 'example' };
const CONFIRMED_PLAN = { id: '00000000-0000-4000-8000-000000000003', price: '120000.00', price_status: 'confirmed' };

function priceMissing(run: () => unknown): void {
    try {
        run();
    } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toMatchObject({ error: 'price_missing', message: expect.stringContaining('plan') });
        return;
    }
    throw new Error('expected price_missing');
}

describe('resolvePlanPriceStatus', () => {
    it('a changed price is a confirmation', () => {
        expect(resolvePlanPriceStatus({ price: 165000 }, EXAMPLE_PLAN)).toBe('confirmed');
    });

    it('the same price coming back with the form is not', () => {
        expect(resolvePlanPriceStatus({ price: 150000, name: 'Mensual' }, EXAMPLE_PLAN)).toBe('example');
        expect(resolvePlanPriceStatus({ price: '150000.00' }, EXAMPLE_PLAN)).toBe('example');
        expect(resolvePlanPriceStatus({ name: 'Mensual' }, EXAMPLE_PLAN)).toBe('example');
    });

    it('"Confirmar precio" confirms the example amount without retyping it', () => {
        expect(resolvePlanPriceStatus({ priceStatus: 'confirmed' }, EXAMPLE_PLAN)).toBe('confirmed');
    });

    it('the owner may mark a plan as quoted, and never as an example', () => {
        expect(resolvePlanPriceStatus({ priceStatus: 'quote' }, CONFIRMED_PLAN)).toBe('quote');
        expect(() => resolvePlanPriceStatus({ priceStatus: 'example' }, CONFIRMED_PLAN)).toThrow(BadRequestException);
    });

    it('an example 0 is a missing price, not a free plan', () => {
        // `price` is NOT NULL, so outside the six countries with an example the
        // seed stores 0. Confirming it — with the button alone, or with the
        // form resending that 0 — would publish a free membership.
        priceMissing(() => resolvePlanPriceStatus({ priceStatus: 'confirmed' }, PLACEHOLDER_PLAN));
        priceMissing(() => resolvePlanPriceStatus({ priceStatus: 'confirmed', price: 0 }, PLACEHOLDER_PLAN));
        expect(resolvePlanPriceStatus({ price: 0 }, PLACEHOLDER_PLAN)).toBe('example');
        expect(resolvePlanPriceStatus({ price: 90000 }, PLACEHOLDER_PLAN)).toBe('confirmed');
        // A plan the owner already confirmed at 0 is theirs to keep at 0.
        expect(resolvePlanPriceStatus({ price: 0 }, { price: '0.00', price_status: 'confirmed' })).toBe('confirmed');
    });

    it('the 0 a quoted plan stores is a placeholder too', () => {
        // "Se cotiza" still has to write something into a NOT NULL column.
        const quoted = { price: '0.00', price_status: 'quote' };
        priceMissing(() => resolvePlanPriceStatus({ priceStatus: 'confirmed' }, quoted));
        expect(resolvePlanPriceStatus({ price: 0, name: 'Corporativo' }, quoted)).toBe('quote');
        expect(resolvePlanPriceStatus({ price: 210000 }, quoted)).toBe('confirmed');
    });

    it('a new plan is confirmed as typed, and cannot confirm a price it does not have', () => {
        expect(resolvePlanPriceStatus({ price: 80000 })).toBe('confirmed');
        expect(resolvePlanPriceStatus({ priceStatus: 'quote' })).toBe('quote');
        priceMissing(() => resolvePlanPriceStatus({ priceStatus: 'confirmed' }));
    });
});

describe('a free plan is an explicit choice, like a free service (FX1-5)', () => {
    it('"Es gratis" confirms a placeholder at 0; resending the 0 alone still does not', () => {
        // Before FX1 a deliberately typed 0 was refused as price_missing and
        // there was no other way to say "this plan is free", while the service
        // editor confirmed a quote row's 0 as free. Both now need `free: true`.
        expect(resolvePlanPriceStatus({ free: true }, PLACEHOLDER_PLAN)).toBe('confirmed');
        expect(resolvePlanPriceStatus({ priceStatus: 'confirmed', price: 0, free: true }, PLACEHOLDER_PLAN)).toBe('confirmed');
        expect(resolvePlanPriceStatus({ priceStatus: 'confirmed', price: 0, free: true }, { price: '0.00', price_status: 'quote' })).toBe('confirmed');
        priceMissing(() => resolvePlanPriceStatus({ priceStatus: 'confirmed', price: 0 }, PLACEHOLDER_PLAN));
    });

    it('typing 0 over a real amount is not "free" without saying so', () => {
        priceMissing(() => resolvePlanPriceStatus({ price: 0 }, EXAMPLE_PLAN));
        priceMissing(() => resolvePlanPriceStatus({ price: 0 }, CONFIRMED_PLAN));
        expect(resolvePlanPriceStatus({ price: 0, free: true }, CONFIRMED_PLAN)).toBe('confirmed');
    });

    it('"Es gratis" with a number or with "se cotiza" is a contradiction', () => {
        expect(() => resolvePlanPriceStatus({ free: true, price: 90000 }, PLACEHOLDER_PLAN)).toThrow(BadRequestException);
        expect(() => resolvePlanPriceStatus({ free: true, priceStatus: 'quote' }, PLACEHOLDER_PLAN)).toThrow(BadRequestException);
    });

    it('the refusal names the way out, "Es gratis" included', () => {
        try {
            resolvePlanPriceStatus({ priceStatus: 'confirmed' }, PLACEHOLDER_PLAN);
        } catch (error) {
            expect((error as BadRequestException).getResponse()).toMatchObject({ message: expect.stringContaining('gratis') });
            return;
        }
        throw new Error('expected price_missing');
    });
});

describe('GymsService plan writes', () => {
    function harness(current: Record<string, unknown> | null) {
        const calls: Array<{ sql: string; params: any[] }> = [];
        const executeInTenantSchema = jest.fn(async (_schema: string, sql: string, params: any[] = []) => {
            calls.push({ sql, params });
            if (sql.startsWith('SELECT price, price_status FROM membership_plans')) return current ? [current] : [];
            if (sql.startsWith('UPDATE membership_plans') || sql.includes('INSERT INTO membership_plans')) {
                // RETURNING * echoes the status this statement wrote, if any.
                const written = params.find((value) => value === 'confirmed' || value === 'quote');
                return [{ id: 'plan', price: '1.00', price_status: written ?? null }];
            }
            if (sql.startsWith('SELECT * FROM membership_plans')) return [{ id: 'a', price_status: 'example' }, { id: 'b', price_status: null }];
            return [];
        });
        const service = new GymsService({ executeInTenantSchema } as any);
        const update = () => calls.find((call) => call.sql.startsWith('UPDATE membership_plans'));
        return { service, calls, update };
    }

    it('correcting the price writes the confirmation in the same statement that bumps updated_at', async () => {
        const { service, update } = harness(EXAMPLE_PLAN);
        await service.updatePlan('tenant_x', EXAMPLE_PLAN.id, { price: 165000 });
        const { sql, params } = update()!;
        expect(sql).toMatch(/price = \$1, price_status = \$2, updated_at = NOW\(\) WHERE id = \$3::uuid/);
        expect(params).toEqual([165000, 'confirmed', EXAMPLE_PLAN.id]);
    });

    it('"Confirmar precio" alone is a write, not a no-op', async () => {
        // Before, a body with only `priceStatus` matched no column and
        // `updatePlan` returned null without writing anything.
        const { service, update } = harness(EXAMPLE_PLAN);
        const row = await service.updatePlan('tenant_x', EXAMPLE_PLAN.id, { priceStatus: 'confirmed' });
        expect(update()!.sql).toMatch(/SET price_status = \$1, updated_at = NOW\(\)/);
        expect(row).toBeTruthy();
    });

    it('a resent, unchanged price leaves the status alone', async () => {
        const { service, update } = harness(EXAMPLE_PLAN);
        await service.updatePlan('tenant_x', EXAMPLE_PLAN.id, { price: 150000, description: 'Todo incluido' });
        expect(update()!.sql).not.toContain('price_status');
    });

    it('a missing plan is a 404 before anything is written', async () => {
        const { service, update } = harness(null);
        await expect(service.updatePlan('tenant_x', EXAMPLE_PLAN.id, { price: 1 })).rejects.toBeInstanceOf(NotFoundException);
        expect(update()).toBeUndefined();
    });

    it('a cleared price is refused unless the plan is quoted', async () => {
        await expect(harness(CONFIRMED_PLAN).service.updatePlan('tenant_x', CONFIRMED_PLAN.id, { price: null }))
            .rejects.toMatchObject({ response: { error: 'price_required' } });
        const quoted = harness(CONFIRMED_PLAN);
        await quoted.service.updatePlan('tenant_x', CONFIRMED_PLAN.id, { price: null, priceStatus: 'quote' });
        expect(quoted.update()!.params).toEqual([0, 'quote', CONFIRMED_PLAN.id]);
    });

    it('a created plan declares its status instead of taking the column default', async () => {
        const { service, calls } = harness(null);
        await service.createPlan('tenant_x', { name: 'Plan familiar', durationDays: 30, price: 250000 });
        const insert = calls.find((call) => call.sql.includes('INSERT INTO membership_plans'))!;
        expect(insert.sql).toContain('perks, price_status');
        expect(insert.params[3]).toBe(250000);
        expect(insert.params[insert.params.length - 1]).toBe('confirmed');
        await expect(service.createPlan('tenant_x', { name: 'Sin precio', durationDays: 30 }))
            .rejects.toMatchObject({ response: { error: 'price_required' } });
    });

    it('"Es gratis" writes the 0 and the confirmation in one statement, on update and on create', async () => {
        const { service, update } = harness(PLACEHOLDER_PLAN);
        await service.updatePlan('tenant_x', PLACEHOLDER_PLAN.id, { free: true, description: 'Plan comunitario' });
        const { sql, params } = update()!;
        expect(sql).toMatch(/description = \$1, price = \$2, price_status = \$3, updated_at = NOW\(\) WHERE id = \$4::uuid/);
        expect(params).toEqual(['Plan comunitario', 0, 'confirmed', PLACEHOLDER_PLAN.id]);
        expect(sql).not.toMatch(/\bfree\b/);

        const created = harness(null);
        await created.service.createPlan('tenant_x', { name: 'Plan becado', durationDays: 30, free: true } as any);
        const insert = created.calls.find((call) => call.sql.includes('INSERT INTO membership_plans'))!;
        expect(insert.params[3]).toBe(0);
        expect(insert.params[insert.params.length - 1]).toBe('confirmed');
    });

    it('the placeholder 0 resent with "Precio confirmado" is refused before anything is written', async () => {
        const { service, update } = harness(PLACEHOLDER_PLAN);
        await expect(service.updatePlan('tenant_x', PLACEHOLDER_PLAN.id, { price: 0, priceStatus: 'confirmed' }))
            .rejects.toMatchObject({ response: { error: 'price_missing' } });
        expect(update()).toBeUndefined();
    });

    it('every plan row the API returns says where its price stands', async () => {
        const { service } = harness(EXAMPLE_PLAN);
        expect(await service.listPlans('tenant_x', true)).toEqual([
            { id: 'a', price_status: 'example' },
            // A row written before the column existed reads as confirmed,
            // exactly as get_membership_plans reads it.
            { id: 'b', price_status: 'confirmed' },
        ]);
        expect(await service.updatePlan('tenant_x', EXAMPLE_PLAN.id, { price: 165000 })).toMatchObject({ price_status: 'confirmed' });
    });
});
