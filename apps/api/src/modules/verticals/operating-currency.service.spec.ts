import { BadRequestException, ConflictException } from '@nestjs/common';
import { requireCurrencyMinorUnitExponent } from '../../common/utils/commercial-units.util';
import { OperatingCurrencyService } from './operating-currency.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

describe('OperatingCurrencyService', () => {
    const prisma: any = {};
    const service = new OperatingCurrencyService(prisma);

    it('uses pinned ISO exponents without consulting the runtime ICU data', () => {
        const numberFormat = jest.spyOn(Intl, 'NumberFormat').mockImplementation((() => {
            throw new Error('runtime ICU must not resolve commercial currency exponents');
        }) as unknown as typeof Intl.NumberFormat);

        try {
            expect(requireCurrencyMinorUnitExponent('COP')).toBe(2);
            expect(requireCurrencyMinorUnitExponent('JPY')).toBe(0);
            expect(requireCurrencyMinorUnitExponent('CLP')).toBe(0);
            expect(requireCurrencyMinorUnitExponent('USD')).toBe(2);
            expect(numberFormat).not.toHaveBeenCalled();
            expect(() => requireCurrencyMinorUnitExponent('ZZZ')).toThrow(BadRequestException);
        } finally {
            numberFormat.mockRestore();
        }
    });

    it('preserves source money and requires a dated FX snapshot for conversion', () => {
        const lineage = service.buildLineage({
            objectType: 'order',
            objectId: 'order-1',
            lineId: 'line-1',
            amountMinor: '12345',
            currency: 'USD',
            sourceSystem: 'shopify',
            idempotencyKey: 'order-1:line-1:v1',
            fx: {
                baseCurrency: 'USD',
                quoteCurrency: 'COP',
                rate: '4000.125',
                source: 'provider.daily',
                observedAt: '2026-08-08T12:00:00Z',
            },
        }, 'COP', new Date('2026-08-08T12:01:00Z'));

        expect(lineage).toMatchObject({
            sourceAmountMinor: '12345',
            sourceCurrency: 'USD',
            operatingAmountMinor: '49381543',
            operatingCurrency: 'COP',
            fxSnapshot: {
                baseCurrency: 'USD',
                quoteCurrency: 'COP',
                rate: '4000.125',
                source: 'provider.daily',
                observedAt: '2026-08-08T12:00:00.000Z',
                baseMinorUnitExponent: 2,
                quoteMinorUnitExponent: 2,
                capturedAt: '2026-08-08T12:01:00.000Z',
            },
        });
    });

    it('fails closed instead of relabeling cross-currency money', () => {
        expect(() => service.buildLineage({
            objectType: 'order',
            objectId: 'order-1',
            amountMinor: '100',
            currency: 'USD',
            sourceSystem: 'toast',
            idempotencyKey: 'order-1:v1',
        }, 'COP')).toThrow(BadRequestException);

        expect(() => service.buildLineage({
            objectType: 'order',
            objectId: 'order-1',
            amountMinor: '100',
            currency: 'USD',
            sourceSystem: 'toast',
            idempotencyKey: 'order-1:v1',
            fx: {
                baseCurrency: 'EUR',
                quoteCurrency: 'COP',
                rate: '4300',
                source: 'provider.daily',
                observedAt: '2026-08-08T12:00:00Z',
            },
        }, 'COP')).toThrow(BadRequestException);
    });

    it('keeps same-currency lines free of invented FX lineage', () => {
        const lineage = service.buildLineage({
            objectType: 'invoice',
            objectId: 'invoice-1',
            amountMinor: '-25',
            currency: 'cop',
            sourceSystem: 'internal.ledger',
            idempotencyKey: 'invoice-1:refund-1',
        }, 'COP');

        expect(lineage.sourceAmountMinor).toBe('-25');
        expect(lineage.operatingAmountMinor).toBe('-25');
        expect(lineage.fxSnapshot).toBeNull();
    });

    it('converts minor units with ISO-4217 exponents instead of relabeling cents as yen', () => {
        const usdToJpy = service.buildLineage({
            objectType: 'order', objectId: 'order-jpy', amountMinor: '100', currency: 'USD',
            sourceSystem: 'provider', idempotencyKey: 'usd-jpy',
            fx: {
                baseCurrency: 'USD', quoteCurrency: 'JPY', rate: '147',
                source: 'provider.daily', observedAt: '2026-08-08T12:00:00Z',
            },
        }, 'JPY');
        const jpyToUsd = service.buildLineage({
            objectType: 'order', objectId: 'order-usd', amountMinor: '147', currency: 'JPY',
            sourceSystem: 'provider', idempotencyKey: 'jpy-usd',
            fx: {
                baseCurrency: 'JPY', quoteCurrency: 'USD', rate: '0.0068',
                source: 'provider.daily', observedAt: '2026-08-08T12:00:00Z',
            },
        }, 'USD');

        expect(usdToJpy.operatingAmountMinor).toBe('147');
        expect(usdToJpy.fxSnapshot).toMatchObject({
            baseMinorUnitExponent: 2, quoteMinorUnitExponent: 0,
        });
        expect(jpyToUsd.operatingAmountMinor).toBe('100');
        expect(jpyToUsd.fxSnapshot).toMatchObject({
            baseMinorUnitExponent: 0, quoteMinorUnitExponent: 2,
        });
    });

    it('makes operating currency immutable after the first transaction', async () => {
        prisma.$transaction = jest.fn(async (callback: any) => callback({
            $queryRawUnsafe: jest.fn().mockResolvedValueOnce([{
                id: TENANT_ID,
                operating_currency: 'COP',
                operating_currency_locked_at: new Date('2026-08-08T10:00:00Z'),
            }]),
        }));

        await expect(service.configure(TENANT_ID, 'USD')).rejects.toBeInstanceOf(ConflictException);
    });

    it('is idempotent when configuring the already-selected currency', async () => {
        const query = jest.fn().mockResolvedValueOnce([{
            id: TENANT_ID,
            operating_currency: 'COP',
            operating_currency_locked_at: null,
        }]);
        prisma.$transaction = jest.fn(async (callback: any) => callback({ $queryRawUnsafe: query }));

        await expect(service.configure(TENANT_ID, 'cop')).resolves.toEqual({
            tenantId: TENANT_ID,
            operatingCurrency: 'COP',
            lockedAt: null,
        });
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('replays the same cross-currency writer input despite a later capture timestamp', async () => {
        let stored: any;
        let insertCount = 0;
        prisma.tenant = {
            findUnique: jest.fn().mockResolvedValue({ schemaName: 'tenant_1' }),
        };
        const query = jest.fn(async (sql: string, params: any[]) => {
            if (sql.includes('FROM public.tenants')) {
                return [{ id: TENANT_ID, operating_currency: 'COP', operating_currency_locked_at: null }];
            }
            if (sql.includes('FROM money_lineage')) return stored ? [stored] : [];
            if (sql.includes('INSERT INTO money_lineage')) {
                insertCount++;
                stored = {
                    id: params[0], object_type: params[1], object_id: params[2], line_id: params[3],
                    source_amount_minor: params[4], source_currency: params[5],
                    operating_amount_minor: params[6], operating_currency: params[7],
                    source_system: params[8], idempotency_key: params[9],
                    fx_snapshot: JSON.parse(params[10]), payload_hash: params[11],
                };
                return [stored];
            }
            return [];
        });
        prisma.transactionInTenantSchema = jest.fn(async (_schema: string, callback: any) => callback(query));
        const input = {
            objectType: 'order', objectId: 'order-1', amountMinor: '100', currency: 'USD',
            sourceSystem: 'shopify', idempotencyKey: 'order-1:v1',
            fx: {
                baseCurrency: 'USD', quoteCurrency: 'COP', rate: '4000',
                source: 'provider.daily', observedAt: '2026-08-08T12:00:00Z',
            },
        };

        const first = await service.recordTransactionalAmount(TENANT_ID, input);
        await new Promise((resolve) => setTimeout(resolve, 2));
        const replay = await service.recordTransactionalAmount(TENANT_ID, input);

        expect(replay.id).toBe(first.id);
        expect(insertCount).toBe(1);
    });

    it('rejects unsafe numeric and time inputs before persistence', () => {
        expect(() => service.buildLineage({
            objectType: 'order',
            objectId: 'order-1',
            amountMinor: '1.25',
            currency: 'USD',
            sourceSystem: 'shopify',
            idempotencyKey: 'x',
        }, 'USD')).toThrow('amountMinor must be an integer encoded as text');

        expect(() => service.buildLineage({
            objectType: 'order',
            objectId: 'order-1',
            amountMinor: '10',
            currency: 'USD',
            sourceSystem: 'shopify',
            idempotencyKey: 'x',
            fx: {
                baseCurrency: 'USD',
                quoteCurrency: 'COP',
                rate: '4000',
                source: 'provider',
                observedAt: '2026-08-08',
            },
        }, 'COP')).toThrow(BadRequestException);
    });
});
