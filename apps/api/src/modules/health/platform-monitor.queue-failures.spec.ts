import { ALERT_CONFIG_DEFAULTS } from './alert-config.service';
import { PlatformMonitorService } from './platform-monitor.service';

function queue(failed: number) {
    return {
        getWaitingCount: jest.fn(async () => 0),
        getActiveCount: jest.fn(async () => 0),
        getFailedCount: jest.fn(async () => failed),
    };
}

describe('PlatformMonitorService queue-specific failure thresholds', () => {
    it('alerts on one inbound failure without treating one bulk failure as equivalent', async () => {
        const alerts: string[] = [];
        const resolved: string[] = [];
        const redis = { client: { zcard: jest.fn(async () => 1) } };
        const incidents = { resolveByKey: jest.fn(async (key: string) => resolved.push(key)) };
        const alertConfig = { get: jest.fn(async () => ALERT_CONFIG_DEFAULTS) };
        const monitor = new PlatformMonitorService(
            redis as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            incidents as any,
            {} as any,
            {} as any,
            alertConfig as any,
            {} as any,
            {} as any,
            {} as any,
            queue(1) as any,
            queue(1) as any,
            queue(0) as any,
            queue(0) as any,
            queue(1) as any,
            {} as any,
        );
        (monitor as any).alert = jest.fn(async (key: string) => alerts.push(key));

        await monitor.checkQueues();

        expect(alerts).toEqual(expect.arrayContaining([
            'queue:inbound-messages:failed',
            'queue:wa-webhooks:failed',
        ]));
        expect(alerts).not.toContain('queue:outbound-messages:failed');
        expect(alerts).not.toContain('queue:broadcast-messages:failed');
    });
});
