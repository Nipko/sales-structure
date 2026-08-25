import { providerToolDataMode } from '@parallext/shared';
import { GET_FITNESS_SCHEDULE_TOOL } from '../conversations/tools/vertical-integration-tools';
import { VerticalIntegrationsService } from './vertical-integrations.service';

describe('Mindbody live-capacity boundary', () => {
    it('declares the schedule as mirrored discovery, never live availability', () => {
        expect(providerToolDataMode('get_fitness_schedule')).toBe('mirrored_discovery');
        expect(GET_FITNESS_SCHEDULE_TOOL.description).toContain('does NOT provide live capacity');
        expect(GET_FITNESS_SCHEDULE_TOOL.description).toContain('live_capacity_unavailable');
    });

    it('removes mirrored isAvailable and returns a typed live-capacity block', async () => {
        const service = new VerticalIntegrationsService(
            {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
        );
        (service as any).getToolGate = jest.fn().mockResolvedValue({
            allowed: true,
            health: {
                projectionVersion: 1,
                provider: 'mindbody',
                connectionId: 'mindbody:tenant',
                resourceType: 'tenant',
                resourceId: 'all',
                lastAttemptAt: '2026-08-24T12:00:00.000Z',
                lastSuccessAt: '2026-08-24T12:00:00.000Z',
                asOf: '2026-08-24T12:00:00.000Z',
                expectedInterval: 3600,
                freshUntil: '2026-08-24T13:00:00.000Z',
                health: 'healthy',
                freshness: { state: 'fresh' },
                degradedReason: null,
                sourceVersion: 'v6',
                observedAt: '2026-08-24T12:00:00.000Z',
            },
            binding: {
                version: 1, mode: 'tenant_wide_conservative', bindingId: null,
                externalId: null, generation: 0, owner: 'external',
                reason: 'resource_binding_required',
            },
        });
        (service as any).listItemsInSchema = jest.fn().mockResolvedValue([{
            title: 'Yoga', subtitle: 'Ana',
            data: { startDateTime: '2099-01-01T10:00:00.000Z', endDateTime: '2099-01-01T11:00:00.000Z', isAvailable: true, location: 'Sala 1' },
        }]);
        const result = await service.getScheduleForAI(tenantId, 'tenant_one');
        expect(result).toMatchObject({
            mode: 'mirrored_discovery', asOf: '2026-08-24T12:00:00.000Z',
            liveCapacity: { error: 'live_capacity_unavailable', bookingSupported: false, nextAction: 'handoff_or_waitlist' },
            integrationProjection: { binding: { mode: 'tenant_wide_conservative', owner: 'external' } },
        });
        expect(result.classes[0]).not.toHaveProperty('available');
    });
});

const tenantId = '11111111-1111-4111-8111-111111111111';
