import {
    PriceOverrideValidationError,
    reconcilePlanPriceSync,
} from './billing-plan-price-sync.util';

describe('reconcilePlanPriceSync', () => {
    const existingOverrides = {
        CO: {
            currency: 'COP',
            amountCents: 100,
            mpPlanId: 'co-month-old',
            syncedAmountCents: 100,
            syncedCurrency: 'COP',
            annual: {
                amountCents: 1_000,
                mpPlanId: 'co-year-old',
                syncedAmountCents: 1_000,
                syncedCurrency: 'COP',
            },
        },
        MX: {
            currency: 'MXN',
            amountCents: 50,
            mpPlanId: 'mx-month-old',
            syncedAmountCents: 50,
            syncedCurrency: 'MXN',
        },
    };

    it('invalidates only the changed monthly cycle and the legacy CO id', () => {
        const result = reconcilePlanPriceSync({
            planSlug: 'starter',
            existingOverrides,
            incomingOverrides: {
                CO: { amountCents: 120, mpPlanId: 'co-month-old' },
            },
            existingUsdPriceCents: 49,
            nextUsdPriceCents: 49,
            existingLegacyMpPlanId: 'co-legacy-old',
        });

        expect(result.priceLocalOverrides.CO).toMatchObject({
            currency: 'COP',
            amountCents: 120,
            annual: { amountCents: 1_000, mpPlanId: 'co-year-old' },
        });
        expect(result.priceLocalOverrides.CO).not.toHaveProperty('mpPlanId');
        expect(result.priceLocalOverrides.CO).not.toHaveProperty('syncedAmountCents');
        expect(result.priceLocalOverrides.CO).not.toHaveProperty('syncedCurrency');
        expect(result.priceLocalOverrides.MX.mpPlanId).toBe('mx-month-old');
        expect(result.legacyMpPlanId).toBeNull();
        expect(result.invalidated).toEqual([
            { country: 'CO', cycle: 'month', source: 'override' },
            { country: 'CO', cycle: 'month', source: 'legacy' },
        ]);
        expect(existingOverrides.CO.mpPlanId).toBe('co-month-old');
    });

    it('invalidates an annual id without disturbing monthly or legacy ids', () => {
        const result = reconcilePlanPriceSync({
            planSlug: 'starter',
            existingOverrides,
            incomingOverrides: {
                CO: { annual: { amountCents: 1_200, mpPlanId: 'co-year-old' } },
            },
            existingUsdPriceCents: 49,
            nextUsdPriceCents: 49,
            existingLegacyMpPlanId: 'co-legacy-old',
        });

        expect(result.priceLocalOverrides.CO.mpPlanId).toBe('co-month-old');
        expect(result.priceLocalOverrides.CO.annual).toMatchObject({ amountCents: 1_200, currency: 'COP' });
        expect(result.priceLocalOverrides.CO.annual).not.toHaveProperty('syncedAmountCents');
        expect(result.priceLocalOverrides.CO.annual).not.toHaveProperty('syncedCurrency');
        expect(result.legacyMpPlanId).toBe('co-legacy-old');
        expect(result.invalidated).toEqual([
            { country: 'CO', cycle: 'year', source: 'override' },
        ]);
    });

    it('preserves every provider id for feature-only or unchanged price payloads', () => {
        const featureOnly = reconcilePlanPriceSync({
            planSlug: 'starter',
            existingOverrides,
            existingUsdPriceCents: 49,
            nextUsdPriceCents: 49,
            existingLegacyMpPlanId: 'co-legacy-old',
        });
        const unchangedFullPayload = reconcilePlanPriceSync({
            planSlug: 'starter',
            existingOverrides,
            incomingOverrides: existingOverrides,
            existingUsdPriceCents: 49,
            nextUsdPriceCents: 49,
            existingLegacyMpPlanId: 'co-legacy-old',
        });

        expect(featureOnly.priceLocalOverrides).toEqual(existingOverrides);
        expect(unchangedFullPayload.priceLocalOverrides).toMatchObject(existingOverrides);
        expect(unchangedFullPayload.priceLocalOverrides.CO.annual.currency).toBe('COP');
        expect(featureOnly.legacyMpPlanId).toBe('co-legacy-old');
        expect(unchangedFullPayload.legacyMpPlanId).toBe('co-legacy-old');
        expect(featureOnly.invalidated).toEqual([]);
        expect(unchangedFullPayload.invalidated).toEqual([]);
    });

    it('fails closed for a USD price change only when no fixed CO override exists', () => {
        const noOverride = reconcilePlanPriceSync({
            planSlug: 'starter',
            existingOverrides: {},
            existingUsdPriceCents: 49,
            nextUsdPriceCents: 59,
            existingLegacyMpPlanId: 'co-legacy-old',
        });
        const fixedOverride = reconcilePlanPriceSync({
            planSlug: 'starter',
            existingOverrides,
            existingUsdPriceCents: 49,
            nextUsdPriceCents: 59,
            existingLegacyMpPlanId: 'co-legacy-old',
        });

        expect(noOverride.legacyMpPlanId).toBeNull();
        expect(noOverride.invalidated).toEqual([
            { country: 'CO', cycle: 'month', source: 'legacy' },
        ]);
        expect(fixedOverride.legacyMpPlanId).toBe('co-legacy-old');
        expect(fixedOverride.priceLocalOverrides.CO.mpPlanId).toBe('co-month-old');
        expect(fixedOverride.invalidated).toEqual([]);
    });

    it('does not clear the legacy CO id when another country price changes', () => {
        const result = reconcilePlanPriceSync({
            planSlug: 'starter',
            existingOverrides,
            incomingOverrides: { MX: { amountCents: 60, mpPlanId: 'mx-month-old' } },
            existingUsdPriceCents: 49,
            nextUsdPriceCents: 49,
            existingLegacyMpPlanId: 'co-legacy-old',
        });

        expect(result.priceLocalOverrides.MX).not.toHaveProperty('mpPlanId');
        expect(result.priceLocalOverrides.CO.mpPlanId).toBe('co-month-old');
        expect(result.legacyMpPlanId).toBe('co-legacy-old');
    });

    it('ignores stale provider ids from the browser and keeps the database-owned ids', () => {
        const result = reconcilePlanPriceSync({
            planSlug: 'starter',
            existingOverrides,
            incomingOverrides: {
                CO: {
                    currency: 'COP',
                    amountCents: 100,
                    mpPlanId: 'stale-month-id',
                    syncedAmountCents: 999,
                    syncedCurrency: 'USD',
                    annual: {
                        amountCents: 1_000,
                        mpPlanId: 'stale-year-id',
                        syncedAmountCents: 9_999,
                        syncedCurrency: 'USD',
                    },
                },
            },
            existingUsdPriceCents: 49,
            nextUsdPriceCents: 49,
            existingLegacyMpPlanId: 'co-legacy-old',
        });

        expect(result.priceLocalOverrides.CO.mpPlanId).toBe('co-month-old');
        expect(result.priceLocalOverrides.CO.annual.mpPlanId).toBe('co-year-old');
        expect(result.priceLocalOverrides.CO.syncedAmountCents).toBe(100);
        expect(result.priceLocalOverrides.CO.syncedCurrency).toBe('COP');
        expect(result.priceLocalOverrides.CO.annual.syncedAmountCents).toBe(1_000);
        expect(result.priceLocalOverrides.CO.annual.syncedCurrency).toBe('COP');
        expect(result.legacyMpPlanId).toBe('co-legacy-old');
        expect(result.invalidated).toEqual([]);
    });

    it('folds country aliases case-insensitively and rejects duplicate incoming aliases', () => {
        const normalized = reconcilePlanPriceSync({
            planSlug: 'starter',
            existingOverrides: { co: existingOverrides.CO },
            incomingOverrides: { co: { currency: 'cop', amountCents: 100 } },
            existingUsdPriceCents: 49,
            nextUsdPriceCents: 49,
            existingLegacyMpPlanId: 'co-legacy-old',
        });
        expect(normalized.priceLocalOverrides).toHaveProperty('CO');
        expect(normalized.priceLocalOverrides).not.toHaveProperty('co');

        expect(() => reconcilePlanPriceSync({
            planSlug: 'starter',
            existingOverrides,
            incomingOverrides: {
                CO: { currency: 'COP', amountCents: 100 },
                co: { currency: 'COP', amountCents: 100 },
            },
            existingUsdPriceCents: 49,
            nextUsdPriceCents: 49,
            existingLegacyMpPlanId: 'co-legacy-old',
        })).toThrow(PriceOverrideValidationError);
    });

    it.each([
        [{ ZZ: { currency: 'USD', amountCents: 100 } }, 'unsupported_country'],
        [{ CO: { currency: 'USD', amountCents: 100 } }, 'invalid_currency'],
        [{ CO: { currency: 'COP', amountCents: -1 } }, 'invalid_amount'],
        [{ CO: { currency: 'COP', amountCents: 1.5 } }, 'invalid_amount'],
        [{ CO: { currency: 'COP', amountCents: 0 } }, 'zero_not_allowed'],
        [{ CO: { currency: 'COP', annual: { amountCents: -1 } } }, 'invalid_amount'],
    ])('rejects malformed override payload %# with a clear issue code', (incomingOverrides, code) => {
        try {
            reconcilePlanPriceSync({
                planSlug: 'starter',
                existingOverrides,
                incomingOverrides,
                existingUsdPriceCents: 49,
                nextUsdPriceCents: 49,
                existingLegacyMpPlanId: 'co-legacy-old',
            });
            throw new Error('expected validation error');
        } catch (error) {
            expect(error).toBeInstanceOf(PriceOverrideValidationError);
            expect((error as PriceOverrideValidationError).issues).toEqual(
                expect.arrayContaining([expect.objectContaining({ code })]),
            );
        }
    });

    it('allows zero local amounts only for Custom', () => {
        const result = reconcilePlanPriceSync({
            planSlug: 'custom',
            existingOverrides: {},
            incomingOverrides: {
                CO: { currency: 'COP', amountCents: 0, annual: { currency: 'COP', amountCents: 0 } },
            },
            existingUsdPriceCents: 0,
            nextUsdPriceCents: 0,
            existingLegacyMpPlanId: null,
        });
        expect(result.priceLocalOverrides.CO).toMatchObject({
            amountCents: 0,
            annual: { amountCents: 0 },
        });
    });

    it('invalidates both cycles and the CO legacy id when correcting stored currency', () => {
        const result = reconcilePlanPriceSync({
            planSlug: 'starter',
            existingOverrides: {
                CO: {
                    currency: 'USD',
                    amountCents: 100,
                    mpPlanId: 'co-month-old',
                    annual: { currency: 'USD', amountCents: 1_000, mpPlanId: 'co-year-old' },
                },
            },
            incomingOverrides: {
                CO: { currency: 'COP', amountCents: 100, annual: { currency: 'COP', amountCents: 1_000 } },
            },
            existingUsdPriceCents: 49,
            nextUsdPriceCents: 49,
            existingLegacyMpPlanId: 'co-legacy-old',
        });

        expect(result.priceLocalOverrides.CO).not.toHaveProperty('mpPlanId');
        expect(result.priceLocalOverrides.CO).not.toHaveProperty('syncedAmountCents');
        expect(result.priceLocalOverrides.CO.annual).not.toHaveProperty('mpPlanId');
        expect(result.priceLocalOverrides.CO.annual).not.toHaveProperty('syncedAmountCents');
        expect(result.legacyMpPlanId).toBeNull();
        expect(result.invalidated).toEqual(expect.arrayContaining([
            { country: 'CO', cycle: 'month', source: 'override' },
            { country: 'CO', cycle: 'month', source: 'legacy' },
            { country: 'CO', cycle: 'year', source: 'override' },
        ]));
    });
});
