import { PaymentOperationService } from './payment-operation.service';
import { TenantMercadoPagoOperationProvider } from '../tenant-payments/tenant-mercadopago-operation.provider';
import { TenantPaymentsService } from '../tenant-payments/tenant-payments.service';
import { TenantPaymentStoreService } from '../tenant-payments/tenant-payment-store.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { RegionalProfileService } from '../tenants/regional-profile.service';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';

it('propagates preview through payment capability, plan resolution and ledger availability without DDL or cache writes', async () => {
    const prisma: any = {
        getTenantSchemaName: jest.fn().mockResolvedValue('tenant_schema'),
        executeInTenantSchema: jest.fn().mockResolvedValue([{ available: true }]),
        tenant: { findUnique: jest.fn().mockResolvedValue({ plan: 'pro', settings: {} }) },
        billingPlan: { findUnique: jest.fn().mockResolvedValue({ features: { customerPayments: true } }) },
    };
    const redis = { get: jest.fn().mockResolvedValue(null), getJson: jest.fn().mockResolvedValue(null), set: jest.fn(), setJson: jest.fn() };
    const store = new TenantPaymentStoreService(prisma);
    const ensure = jest.spyOn(store, 'ensureForTenant');
    const payments: any = Object.assign(Object.create(TenantPaymentsService.prototype), { store,
        getConfig: jest.fn().mockResolvedValue({ connected: true, ready: true, activeProvider: 'wompi' }) });
    const throttle = Object.assign(Object.create(TenantThrottleService.prototype), { prisma, redis });
    const operation: PaymentOperationService = Object.assign(Object.create(PaymentOperationService.prototype), {
        provider: new TenantMercadoPagoOperationProvider(payments), throttle,
    });
    expect(await operation.getRuntimeCapability('tenant', AGENT_TEST_EXECUTION_CONTEXT)).toMatchObject({ planEnabled: true, ready: true, statusAvailable: true });
    expect(ensure).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.setJson).not.toHaveBeenCalled();
    expect(prisma.executeInTenantSchema.mock.calls.every((call: any[]) => /^SELECT /.test(call[1]))).toBe(true);
});

it('keeps regional fallback resolution uncached in preview', async () => {
    const redis: any = { getJson: jest.fn().mockResolvedValue(null), setJson: jest.fn() };
    const service: any = new RegionalProfileService({} as any, redis);
    service.build = jest.fn().mockResolvedValue({ timezone: { value: 'America/Bogota', source: 'configured' } });
    expect(await service.resolve('tenant', AGENT_TEST_EXECUTION_CONTEXT)).toMatchObject({ timezone: { value: 'America/Bogota' } });
    expect(redis.setJson).not.toHaveBeenCalled();
});
