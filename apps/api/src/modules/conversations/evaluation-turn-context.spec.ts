import { agentTurnFixture } from './__fixtures__/agent-turn.fixture';
import { EVALUATION_CONTEXT_LANGUAGES } from './evaluation-turn-context';
import { RegionalProfileService } from '../tenants/regional-profile.service';
import { sealEvaluationSnapshot } from './agent-evaluation-snapshot';

describe('Frozen factual context in the operational evaluation core', () => {
    it.each(EVALUATION_CONTEXT_LANGUAGES)('uses captured facts in %s without another source read', async language => {
        const f = agentTurnFixture();
        f.prisma.tenant.findUnique.mockResolvedValue({ operatingCountry: 'MX', industry: 'legacy_domain', settings: {
            businessHours: { timezone: 'America/Mexico_City', enabled: false }, privateCredential: 'never-capture-this',
        } });
        f.businessInfoService.getPrimary.mockResolvedValue({ companyName: 'Captured shop', country: 'MX',
            metadata: { secret: 'never-capture-this' }, id: 'private-row', logoUrl: 'private-logo' });
        f.verticalTurnContext.resolve.mockImplementation(async (input: { language: string }) => ({ industry: 'retail', subType: 'moda',
            customerNoun: `customer-${input.language}`, businessGoals: ['Captured objective'] }));
        const snapshot = await f.service.captureSnapshot('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        expect(JSON.stringify(snapshot.contextInputs)).not.toContain('never-capture-this');
        expect(JSON.stringify(snapshot.contextInputs)).not.toContain('private-row');
        expect(snapshot.contextInputs?.businessHours?.timezone).toBe('America/Mexico_City');
        for (const reader of [f.prisma.tenant.findUnique, f.businessInfoService.getPrimary,
            f.businessInfoService.captureForEvaluation, f.verticalTurnContext.resolve]) {
            reader.mockClear(); reader.mockRejectedValue(new Error('source_read_forbidden_after_capture'));
        }
        jest.spyOn(f.regionalProfile, 'resolve').mockRejectedValue(new Error('regional_source_forbidden'));
        jest.spyOn(f.languageDetector, 'detect').mockReturnValue(language);
        const response = await f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'Information please' }, { agentSnapshot: snapshot });
        expect(response.debug.runtimeError).toBeUndefined();
        expect(response.debug.turnContext).toMatchObject({ language, timezone: 'America/Mexico_City',
            regional: { operatingCountry: 'MX' }, business: { companyName: 'Captured shop' },
            verticalContext: { customerNoun: `customer-${language}`, businessGoals: ['Captured objective'] } });
        expect(f.prisma.tenant.findUnique).not.toHaveBeenCalled();
        expect(f.businessInfoService.getPrimary).not.toHaveBeenCalled();
        expect(f.businessInfoService.captureForEvaluation).not.toHaveBeenCalled();
        expect(f.verticalTurnContext.resolve).not.toHaveBeenCalled();
        expect(f.regionalProfile.resolve).not.toHaveBeenCalled();
        expect(f.turnCapabilityComposer.resolve).toHaveBeenCalledWith(expect.objectContaining({ operatingCountry: 'MX', jurisdiction: 'MX' }));
        expect(f.activeOperationsContext.populateTurnContext).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            fallbackPolicyContext: { industry: 'legacy_domain' },
        }));
    });

    it('keeps an explicitly empty identity empty and detaches returned debug data between turns', async () => {
        const f = agentTurnFixture(), snapshot = await f.service.captureSnapshot('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        expect(snapshot.contextInputs?.business).toBeNull();
        const first = await f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'hola' }, { agentSnapshot: snapshot });
        first.debug.turnContext.verticalContext!.industry = 'tampered';
        f.businessInfoService.getPrimary.mockResolvedValue({ companyName: 'New live shop' });
        const next = await f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'hola', runtimeSessionId: first.debug.runtimeSessionId });
        expect(next.debug.turnContext.business).toBeUndefined();
        expect(next.debug.turnContext.verticalContext?.industry).toBe('retail');
    });

    it.each(['contextInputs', 'businessHours', 'business', 'regional', 'vertical', 'fr', 'activeObjectPolicy'])
    ('rejects missing %s before the model even when resealed by a test fixture', async field => {
        const f = agentTurnFixture(), snapshot = await f.service.captureSnapshot('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        if (field === 'contextInputs') delete snapshot.contextInputs;
        else if (field === 'fr') delete (snapshot.contextInputs!.vertical as any).fr;
        else delete (snapshot.contextInputs as any)[field];
        sealEvaluationSnapshot(snapshot);
        await expect(f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'hola' }, { agentSnapshot: snapshot }))
            .rejects.toThrow('agent_snapshot_context_inputs_required');
        expect(f.llmRouter.execute).not.toHaveBeenCalled();
    });

    it('binds context contents to the manifest and rejects another tenant regional profile', async () => {
        const f = agentTurnFixture(), snapshot = await f.service.captureSnapshot('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        snapshot.contextInputs!.business = { companyName: 'Changed' };
        await expect(f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'hola' }, { agentSnapshot: snapshot }))
            .rejects.toThrow('frozen_dependencies_integrity_mismatch');
        snapshot.contextInputs!.regional.tenantId = 'other'; sealEvaluationSnapshot(snapshot);
        await expect(f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: 'hola' }, { agentSnapshot: snapshot }))
            .rejects.toThrow('agent_snapshot_context_inputs_required');
        expect(f.llmRouter.execute).not.toHaveBeenCalled();
    });

    it.each(['tenant', 'business', 'vertical'])('does not freeze a %s source failure as absence', async source => {
        const f = agentTurnFixture();
        const reader = source === 'tenant' ? f.prisma.tenant.findUnique : source === 'business'
            ? f.businessInfoService.captureForEvaluation : f.verticalTurnContext.resolve;
        reader.mockRejectedValue(new Error('synthetic_context_failure'));
        await expect(f.service.captureSnapshot('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).rejects.toThrow('synthetic_context_failure');
        expect(f.llmRouter.execute).not.toHaveBeenCalled();
    });

    it('rejects a change detected by the final global manifest guard', async () => {
        const f = agentTurnFixture();
        f.revisions.assertCurrent.mockRejectedValue(new Error('evaluation_dependencies_changed:public.tenants'));
        await expect(f.service.captureSnapshot('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).rejects.toThrow('evaluation_dependencies_changed:public.tenants');
        expect(f.businessInfoService.captureForEvaluation).toHaveBeenCalled();
        expect(f.llmRouter.execute).not.toHaveBeenCalled();
    });

    it.each([null, new Error('database unavailable')])('strict regional capture distinguishes failed/missing tenant from undeclared country: %s', async result => {
        const findUnique = result instanceof Error ? jest.fn().mockRejectedValue(result) : jest.fn().mockResolvedValue(result);
        const redis = { getJson: jest.fn(), setJson: jest.fn() };
        const service = new RegionalProfileService({ tenant: { findUnique } } as any, redis as any);
        await expect(service.captureForEvaluation('tenant')).rejects.toThrow('evaluation_regional_source_unavailable');
        expect(redis.getJson).not.toHaveBeenCalled(); expect(redis.setJson).not.toHaveBeenCalled();
    });
});
