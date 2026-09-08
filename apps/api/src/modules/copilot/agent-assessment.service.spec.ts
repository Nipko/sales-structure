import { ConflictException, NotFoundException } from '@nestjs/common';
import { AgentAssessmentService } from './agent-assessment.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
function harness(options: { missing?: boolean; drift?: boolean; unknown?: boolean; mission?: any } = {}) {
    const query = jest.fn(async (_schema, sql, params) => sql.startsWith('SELECT version') ? [{ version: options.drift ? 3 : 2 }] : options.missing ? [] : [{
        id: AGENT, version: 2, template_id: 'restaurant', channels: ['whatsapp', 'telegram'], channel_bindings: [],
        config_json: { persona: { role: 'Atender pedidos', name: 'Luna', secret: 'NEVER EXPOSE' },
            tools: { restaurants: { enabled: true, token: 'SECRET TOKEN' } }, mission: options.mission },
    }]);
    const prisma = { getTenantSchemaName: jest.fn().mockResolvedValue('tenant_test'), executeInTenantSchema: query,
        tenant: { findUnique: jest.fn().mockResolvedValue({ industry: 'restaurantes', settings: { verticalConfig: { subType: 'casual_dining' } } }) } };
    const check = (code: string, status = 'pass') => ({ code, status, evidence: status === 'unknown' ? { sourceAvailability: 'unavailable' } : {}, dimension: 'business_scope', critical: true, weight: 1 });
    const overview = { agent: { id: AGENT, version: 2, name: 'Luna' }, preparation: { dimensions: [{ checks: [check('persona_identity'), check('knowledge_coverage', options.unknown ? 'unknown' : 'pass'), check('tool_appointments', 'not_applicable')] }] }, tested: { status: 'ready', stale: false } };
    const quality = { getOverview: jest.fn().mockResolvedValue(overview) };
    const capabilities = { resolve: jest.fn().mockResolvedValue({ contract: { publishedTools: ['search_menu'], resolvedAt: '2026-09-06T00:00:00Z' } }) };
    return { service: new AgentAssessmentService(prisma as any, quality as any, capabilities as any), prisma, quality, capabilities, overview };
}

describe('shared agent assessment', () => {
    it('resolves a default agent server-side and reuses the runtime composer on each assigned channel', async () => {
        const { service, capabilities, prisma } = harness();
        const assessment = await service.getAssessment(TENANT);
        expect(prisma.executeInTenantSchema.mock.calls[0][2]).toEqual([null]);
        expect(capabilities.resolve).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT, agentId: AGENT, channelType: 'whatsapp', role: 'tenant_agent' }));
        expect(capabilities.resolve).toHaveBeenCalledWith(expect.objectContaining({ channelType: 'telegram' }));
        expect(assessment.mission.source).toBe('template_derived');
        expect(assessment.requiredTests.every(test => test.evidence === 'not_verified')).toBe(true);
        expect(JSON.stringify(assessment.configuration)).not.toMatch(/SECRET|NEVER EXPOSE/);
    });
    it('keeps unavailable knowledge unknown even when other preparation checks pass', async () => {
        const { service } = harness({ unknown: true });
        const result = await service.getAssessment(TENANT, AGENT);
        expect(result.tasks.find(task => task.key === 'knowledge')?.status).toBe('unknown');
    });
    it('says every task in the one vocabulary the surfaces share', async () => {
        const { service } = harness();
        const assessment = await service.getAssessment(TENANT, AGENT);
        // Three screens reading one status and inventing three labels is what
        // this replaces, so the word has to arrive with the task.
        for (const task of assessment.tasks) {
            expect(['unknown', 'pending', 'prepared', 'tested', 'operating', 'degraded'])
                .toContain(task.state);
        }
        // Running on the template's mission is pending, not broken and not done.
        expect(assessment.tasks.find(task => task.key === 'mission')?.state).toBe('pending');
    });

    it('never rolls a whole agent up to operating while a part could not be read', async () => {
        const { service } = harness({ unknown: true });
        const assessment = await service.getAssessment(TENANT, AGENT);
        expect(assessment.tasks.find(task => task.key === 'knowledge')?.state).toBe('unknown');
        // An unreadable table is not an empty table, and it is not a pass either.
        expect(assessment.state).toBe('unknown');
    });

    it('marks a channel whose projection could not be read as unknown, not as ready', async () => {
        const { service, capabilities } = harness();
        capabilities.resolve.mockRejectedValue(new Error('composer unavailable'));
        const assessment = await service.getAssessment(TENANT, AGENT);
        expect(assessment.channels.every(channel => channel.state === 'unknown')).toBe(true);
        expect(assessment.state).toBe('unknown');
    });

    it('does not widen the template when a saved mission requests an unsupported intent', async () => {
        const { service } = harness({ mission: { version: 1, objective: 'Sell everything', intentKeys: ['unregistered_wire_transfer'], successCriteria: [], handoffConditions: [] } });
        const result = await service.getAssessment(TENANT, AGENT);
        expect(result.mission.unsupportedIntents).toEqual(['unregistered_wire_transfer']);
        expect(result.tasks.find(task => task.key === 'mission')?.status).toBe('fail');
        expect(result.requiredTests).toEqual([]);
    });
    it('rejects mixed agent revisions instead of publishing contradictory evidence', async () => {
        const { service, quality } = harness({ drift: true });
        await expect(service.getAssessment(TENANT, AGENT)).rejects.toBeInstanceOf(ConflictException);
        expect(quality.getOverview).toHaveBeenCalledTimes(2);
    });
    it('distinguishes a new tenant with no agent from an invalid requested agent', async () => {
        const { service, capabilities } = harness({ missing: true });
        await expect(service.getAssessment(TENANT)).resolves.toMatchObject({ agent: null, nextTask: 'agent' });
        await expect(service.getAssessment(TENANT, AGENT)).rejects.toBeInstanceOf(NotFoundException);
        expect(capabilities.resolve).not.toHaveBeenCalled();
    });
});
