import { ALERT_CONFIG_DEFAULTS, AlertConfigService } from './alert-config.service';

describe('AlertConfigService queue failure thresholds', () => {
    it('preserves the canonical queues while accepting safe per-queue overrides', async () => {
        const prisma = {
            $queryRaw: jest.fn(async () => [{ value: JSON.stringify({
                queueFailed: 999,
                queueFailedByQueue: { 'inbound-messages': 2, unknown: 0 },
            }) }]),
        };
        const redis = {
            getJson: jest.fn(async () => null),
            setJson: jest.fn(async () => undefined),
        };
        const service = new AlertConfigService(prisma as any, redis as any);

        const config = await service.get();

        expect(config.queueFailedByQueue['inbound-messages']).toBe(2);
        expect(config.queueFailedByQueue['outbound-messages']).toBe(
            ALERT_CONFIG_DEFAULTS.queueFailedByQueue['outbound-messages'],
        );
        expect(config.queueFailedByQueue.unknown).toBeUndefined();
        expect(config.queueFailed).toBe(999);
    });

    it('alerts on the first inbound or fiscal failure by default', () => {
        expect(ALERT_CONFIG_DEFAULTS.queueFailedByQueue['inbound-messages']).toBe(0);
        expect(ALERT_CONFIG_DEFAULTS.queueFailedByQueue['wa-webhooks']).toBe(0);
        expect(ALERT_CONFIG_DEFAULTS.queueFailedByQueue['fiscal-invoice']).toBe(0);
    });
});
