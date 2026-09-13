import { ALERT_CONFIG_DEFAULTS } from './alert-config.service';
import { PlatformMonitorService } from './platform-monitor.service';

const HOUR = 60 * 60 * 1000;

function harness(values: Record<string, string | null>) {
    const alerts: Array<{ key: string; subject: string; value: number }> = [];
    const redis = {
        get: jest.fn(async (key: string) => values[key] ?? null),
        set: jest.fn(async (key: string, value: string) => { values[key] = value; }),
        del: jest.fn(async (key: string) => { delete values[key]; }),
    };
    const incidents = { resolveByKey: jest.fn(async () => undefined) };
    const monitor = new PlatformMonitorService(
        redis as any, {} as any, {} as any, {} as any, {} as any,
        incidents as any, {} as any, {} as any,
        { get: jest.fn(async () => ALERT_CONFIG_DEFAULTS) } as any,
        {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
        {} as any, {} as any,
    );
    (monitor as any).alert = jest.fn(async (key: string, subject: string, _html: string, value: number) => {
        alerts.push({ key, subject, value });
    });
    return { monitor, redis, incidents, alerts };
}

describe('PlatformMonitorService backup heartbeat', () => {
    const now = Date.UTC(2026, 8, 12, 12);

    beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(now));
    afterEach(() => jest.restoreAllMocks());

    it('starts a durable grace clock when no backup has ever reported success', async () => {
        const h = harness({});
        await (h.monitor as any).checkBackupHeartbeat();
        expect(h.redis.set).toHaveBeenCalledWith('backup:monitor_started_at', String(now));
        expect(h.alerts).toEqual([]);
    });

    it('alerts when the first heartbeat is still absent after the configured limit', async () => {
        const started = now - (ALERT_CONFIG_DEFAULTS.backupStaleHours + 1) * HOUR;
        const h = harness({ 'backup:monitor_started_at': String(started) });
        await (h.monitor as any).checkBackupHeartbeat();
        expect(h.alerts).toEqual([expect.objectContaining({
            key: 'backup:stale', subject: 'Ningun backup exitoso ha publicado heartbeat',
        })]);
    });

    it('clears the grace marker and resolves the incident after a recent success', async () => {
        const h = harness({
            'backup:last_success': String(now - HOUR),
            'backup:monitor_started_at': String(now - 2 * HOUR),
        });
        await (h.monitor as any).checkBackupHeartbeat();
        expect(h.redis.del).toHaveBeenCalledWith('backup:monitor_started_at');
        expect(h.incidents.resolveByKey).toHaveBeenCalledWith('backup:stale');
        expect(h.alerts).toEqual([]);
    });

    it('treats a corrupt or future heartbeat as an incident instead of silence', async () => {
        for (const last of ['not-a-date', String(now + 10 * 60 * 1000)]) {
            const h = harness({ 'backup:last_success': last });
            await (h.monitor as any).checkBackupHeartbeat();
            expect(h.alerts).toEqual([expect.objectContaining({
                key: 'backup:stale', subject: 'Heartbeat de backup invalido',
            })]);
        }
    });
});
