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
    /**
     * A threshold the panel could not turn into a number used to become the
     * threshold. Nested objects were spread raw while only the flat scalars were
     * coerced, and `2 >= 'abc'` is `false` — so the alert quietly stopped
     * firing while the panel kept showing what somebody typed. An alert that
     * silently stops watching is worse than one nobody configured.
     */
    describe('a threshold that is not a number', () => {
        const build = (stored: any = {}) => {
            const prisma = {
                $queryRaw: jest.fn(async () => (Object.keys(stored).length
                    ? [{ value: JSON.stringify(stored) }] : [])),
                $executeRaw: jest.fn(async () => 1),
            };
            const redis = { getJson: jest.fn(async () => null), setJson: jest.fn(async (_k: string, _v: any, _t?: number) => undefined) };
            return { service: new AlertConfigService(prisma as any, redis as any), prisma, redis };
        };

        it('never lets an unreadable stored value become the threshold', async () => {
            const { service } = build({
                dispatchReconciliation: { backlog: 'abc', overdue: null, stalled: 4 },
                dispatchLatency: { p95Ms: '', minSamples: 120 },
                queueDepth: { 'inbound-messages': { warn: 'x', crit: 900 } },
                channels: { telegram: 'nope' },
            });
            const config = await service.get();
            // Reading is forgiving: one bad row must not take every alert down.
            expect(config.dispatchReconciliation).toEqual({
                backlog: ALERT_CONFIG_DEFAULTS.dispatchReconciliation.backlog,
                overdue: ALERT_CONFIG_DEFAULTS.dispatchReconciliation.overdue,
                stalled: 4,
            });
            expect(config.dispatchLatency).toEqual({
                p95Ms: ALERT_CONFIG_DEFAULTS.dispatchLatency.p95Ms, minSamples: 120,
            });
            expect(config.queueDepth['inbound-messages']).toEqual({
                warn: ALERT_CONFIG_DEFAULTS.queueDepth['inbound-messages'].warn, crit: 900,
            });
            expect(config.channels.telegram).toBe(ALERT_CONFIG_DEFAULTS.channels.telegram);
        });

        it('takes the numbers the panel sends as text', async () => {
            const { service } = build();
            const saved = await service.set({
                dispatchLatency: { p95Ms: '250' }, channels: { sms: 'true' },
                queueDepth: { 'outbound-messages': { warn: '300', crit: '1200' } },
            });
            expect(saved.dispatchLatency.p95Ms).toBe(250);
            expect(saved.channels.sms).toBe(true);
            expect(saved.queueDepth['outbound-messages']).toEqual({ warn: 300, crit: 1200 });
        });

        it('refuses a write it cannot read, instead of reporting the old value as saved', async () => {
            const { service, prisma, redis } = build();
            await expect(service.set({ dispatchReconciliation: { overdue: 'urgente' } }))
                .rejects.toMatchObject({ response: { error: 'alert_threshold_not_a_number',
                    fields: ['dispatchReconciliation.overdue'] } });
            // Writing is where a person is still watching, so nothing is stored.
            expect(prisma.$executeRaw).not.toHaveBeenCalled();
            // The one cache write is `get` warming the effective config it read;
            // the rejected value is not in it.
            expect(redis.setJson.mock.calls.map((call: any[]) => call[1].dispatchReconciliation.overdue))
                .toEqual([ALERT_CONFIG_DEFAULTS.dispatchReconciliation.overdue]);
        });

        it('names every bad field, not the first one', async () => {
            const { service } = build();
            await expect(service.set({
                dispatchLatency: { p95Ms: 'x', minSamples: 'y' }, llmBudgetPct: 'z',
            })).rejects.toMatchObject({ response: { fields:
                ['dispatchLatency.p95Ms', 'dispatchLatency.minSamples', 'llmBudgetPct'] } });
        });

        it('lets a field be left alone', async () => {
            const { service } = build();
            const saved = await service.set({ dispatchLatency: { p95Ms: undefined, minSamples: null } });
            expect(saved.dispatchLatency).toEqual(ALERT_CONFIG_DEFAULTS.dispatchLatency);
        });
    });
});
