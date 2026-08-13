import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { QualityController } from './quality.controller';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_ID = '22222222-2222-4222-8222-222222222222';
const SIGNAL_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
const ELEVATED_ROLES = ['super_admin', 'tenant_admin', 'tenant_supervisor'];

describe('QualityController agent quality endpoints', () => {
    const quality = {
        getQualitySummary: jest.fn(),
        getFlagged: jest.fn(),
    };
    const agentQuality = {
        listAgents: jest.fn(),
        getOverview: jest.fn(),
    };
    const qualitySignals = {
        getAttentionSummary: jest.fn(),
        reconcileTenantManual: jest.fn(),
        getSignals: jest.fn(),
        acknowledgeSignal: jest.fn(),
        snoozeSignal: jest.fn(),
    };
    const controller = new QualityController(quality as any, agentQuality as any, qualitySignals as any);

    beforeEach(() => jest.clearAllMocks());

    it('keeps TenantGuard on the protected controller', () => {
        const guards = Reflect.getMetadata(GUARDS_METADATA, QualityController) || [];
        expect(guards).toContain(TenantGuard);
    });

    it.each([
        'listAgents',
        'getAgentOverview',
        'getAttentionSummary',
        'reconcileAttention',
        'getSignals',
        'acknowledgeSignal',
        'snoozeSignal',
    ] as const)(
        'restricts %s to super admin, tenant admin and tenant supervisor',
        (method) => {
            expect(Reflect.getMetadata(ROLES_KEY, QualityController.prototype[method])).toEqual(ELEVATED_ROLES);
        },
    );

    it('returns the minimal selector in the standard response envelope', async () => {
        const data = [{ id: AGENT_ID, name: 'Luna', is_default: true, is_active: true }];
        agentQuality.listAgents.mockResolvedValue(data);

        await expect(controller.listAgents(TENANT_ID)).resolves.toEqual({ success: true, data });
        expect(agentQuality.listAgents).toHaveBeenCalledWith(TENANT_ID);
    });

    it('forwards both tenant and agent scope and wraps the overview', async () => {
        const data = { agent: { id: AGENT_ID }, status: 'ready_for_pilot' };
        agentQuality.getOverview.mockResolvedValue(data);

        await expect(controller.getAgentOverview(TENANT_ID, AGENT_ID)).resolves.toEqual({ success: true, data });
        expect(agentQuality.getOverview).toHaveBeenCalledWith(TENANT_ID, AGENT_ID);
    });

    it('wraps the global attention summary without accepting client scope', async () => {
        const data = { attentionCount: 2, openCritical: 1, openHigh: 1 };
        qualitySignals.getAttentionSummary.mockResolvedValue(data);

        await expect(controller.getAttentionSummary(TENANT_ID)).resolves.toEqual({ success: true, data });
        expect(qualitySignals.getAttentionSummary).toHaveBeenCalledWith(TENANT_ID);
    });

    it('explicitly refreshes bounded tenant evidence before returning a fresh summary', async () => {
        const data = { attentionCount: 1, openCritical: 1, openHigh: 0 };
        qualitySignals.reconcileTenantManual.mockResolvedValue(data);

        await expect(controller.reconcileAttention(TENANT_ID)).resolves.toEqual({ success: true, data });
        expect(qualitySignals.reconcileTenantManual).toHaveBeenCalledWith(TENANT_ID);
    });

    it('bounds signal listing in the service and forwards the typed state', async () => {
        qualitySignals.getSignals.mockResolvedValue([]);

        await expect(controller.getSignals(TENANT_ID, 'acknowledged', '25'))
            .resolves.toEqual({ success: true, data: [] });
        expect(qualitySignals.getSignals).toHaveBeenCalledWith(TENANT_ID, 'acknowledged', 25);
    });

    it('derives the acknowledgement actor from the authenticated request', async () => {
        const data = { id: SIGNAL_ID, state: 'acknowledged' };
        qualitySignals.acknowledgeSignal.mockResolvedValue(data);

        await expect(controller.acknowledgeSignal(
            TENANT_ID, SIGNAL_ID, { user: { sub: ACTOR_ID } },
        )).resolves.toEqual({ success: true, data });
        expect(qualitySignals.acknowledgeSignal).toHaveBeenCalledWith(TENANT_ID, SIGNAL_ID, ACTOR_ID);
    });

    it('forwards only bounded snooze input plus the authenticated actor', async () => {
        const data = { id: SIGNAL_ID, state: 'snoozed' };
        qualitySignals.snoozeSignal.mockResolvedValue(data);

        await expect(controller.snoozeSignal(
            TENANT_ID, SIGNAL_ID, { durationHours: 24 }, { user: { id: ACTOR_ID } },
        )).resolves.toEqual({ success: true, data });
        expect(qualitySignals.snoozeSignal).toHaveBeenCalledWith(
            TENANT_ID, SIGNAL_ID, ACTOR_ID, { durationHours: 24 },
        );
    });
});
