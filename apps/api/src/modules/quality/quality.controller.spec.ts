import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { QualityController } from './quality.controller';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_ID = '22222222-2222-4222-8222-222222222222';
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
    const controller = new QualityController(quality as any, agentQuality as any);

    beforeEach(() => jest.clearAllMocks());

    it('keeps TenantGuard on the protected controller', () => {
        const guards = Reflect.getMetadata(GUARDS_METADATA, QualityController) || [];
        expect(guards).toContain(TenantGuard);
    });

    it.each(['listAgents', 'getAgentOverview'] as const)(
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
});
