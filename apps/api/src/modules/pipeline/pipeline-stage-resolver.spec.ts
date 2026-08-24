import { BadRequestException } from '@nestjs/common';
import { VERTICAL_REGISTRY } from '../verticals/vertical-definitions';
import {
    PipelineService,
    resolveTenantNativeStage,
    TenantStageMapping,
} from './pipeline.service';

const VERTICAL_CASES = Object.entries(VERTICAL_REGISTRY).map(([industry, definition]) => ({
    industry,
    definition,
}));

function catalogFor(definition: (typeof VERTICAL_CASES)[number]['definition']): TenantStageMapping[] {
    return definition.pipeline.stages.map((stage, position) => ({
        id: `${position}`,
        name: stage.name.es,
        slug: stage.slug,
        position,
        is_terminal: stage.isTerminal,
        terminal_outcome: stage.isTerminal ? stage.terminalOutcome : null,
        prob: stage.probability,
    }));
}

describe('tenant-native pipeline stage resolver', () => {
    it('covers exactly the 20 canonical vertical catalogs', () => {
        expect(VERTICAL_CASES).toHaveLength(20);
    });

    it.each(VERTICAL_CASES)('$industry never resolves outside its own pipeline', ({ definition }) => {
        const stages = catalogFor(definition);
        const ownSlugs = new Set(stages.map((stage) => stage.slug));
        const firstNonTerminal = stages.find((stage) => !stage.is_terminal)!;

        expect(resolveTenantNativeStage(stages).slug).toBe(firstNonTerminal.slug);
        expect(resolveTenantNativeStage(stages, 'new').is_terminal).toBe(false);
        expect(resolveTenantNativeStage(stages, 'qualified').is_terminal).toBe(false);

        for (const stage of stages) {
            expect(resolveTenantNativeStage(stages, stage.slug).slug).toBe(stage.slug);
            expect(resolveTenantNativeStage(stages, stage.name).slug).toBe(stage.slug);
        }

        for (const alias of ['nuevo', 'respondió', 'ready to close']) {
            expect(ownSlugs.has(resolveTenantNativeStage(stages, alias).slug)).toBe(true);
        }

        for (const outcome of ['won', 'lost'] as const) {
            const matching = stages.filter((stage) => stage.terminal_outcome === outcome);
            if (!matching.length) {
                expect(() => resolveTenantNativeStage(stages, outcome)).toThrow(BadRequestException);
                continue;
            }
            const resolved = resolveTenantNativeStage(stages, outcome);
            expect(ownSlugs.has(resolved.slug)).toBe(true);
            expect(resolved.is_terminal).toBe(true);
            expect(resolved.terminal_outcome).toBe(outcome);
        }
    });

    it('fails closed for unknown non-empty CSV/API labels', () => {
        const stages = catalogFor(VERTICAL_REGISTRY.salud);
        expect(() => resolveTenantNativeStage(stages, 'etapa_totalmente_inventada'))
            .toThrow(BadRequestException);
    });

    it('only uses the explicit policy for an unknown repair fallback', () => {
        const stages = catalogFor(VERTICAL_REGISTRY.salud);
        const first = stages.find((stage) => !stage.is_terminal)!;
        expect(resolveTenantNativeStage(stages, 'legacy_unknown', 'first_non_terminal').slug).toBe(first.slug);
    });

    it('canonicalizes a legacy opportunity even when auto-progress is disabled and no signal advances it', async () => {
        const stages = catalogFor(VERTICAL_REGISTRY.salud);
        const leadId = '33333333-3333-4333-8333-333333333333';
        const prisma: any = {
            executeInTenantSchema: jest.fn(async (_schema: string, query: string, params: unknown[] = []) => {
                if (query.includes('FROM opportunities o')) {
                    return [{ opp_id: '22222222-2222-4222-8222-222222222222', opp_stage: 'nuevo', lead_id: leadId }];
                }
                if (query.includes('FROM pipeline_stages')) return stages;
                return [];
            }),
        };
        const redis: any = {
            get: jest.fn(async (key: string) => key.startsWith('tenant:') ? 'tenant_contract' : '0'),
        };
        const service = new PipelineService(
            prisma,
            redis,
            { emit: jest.fn() } as any,
            {} as any,
            {} as any,
        );
        const canonical = stages.find((stage) => !stage.is_terminal)!;
        const writeLeadStage = jest.spyOn(service, 'writeLeadStage').mockResolvedValue({
            stage: canonical,
            updatedOpportunities: 1,
        });

        await service.autoProgressFromConversation('11111111-1111-4111-8111-111111111111', 'conv', {});

        expect(writeLeadStage).toHaveBeenCalledWith(
            '11111111-1111-4111-8111-111111111111',
            leadId,
            canonical.slug,
            expect.objectContaining({
                opportunityId: '22222222-2222-4222-8222-222222222222',
                onlyActiveOpportunities: false,
                triggeredBy: 'canonical_repair',
            }),
        );
    });

    it('reuses an explicitly linked terminal deal instead of duplicating it on retry', async () => {
        const stages = catalogFor(VERTICAL_REGISTRY.inmobiliaria);
        const terminal = stages
            .find((stage) => stage.terminal_outcome === 'won')!;
        const pipelineId = '33333333-3333-4333-8333-333333333333';
        const dealId = '44444444-4444-4444-8444-444444444444';
        const opportunityId = '66666666-6666-4666-8666-666666666666';
        const leadId = '22222222-2222-4222-8222-222222222222';
        const txQueries: string[] = [];
        const prisma: any = {
            executeInTenantSchema: jest.fn(async (_schema: string, query: string) => {
                if (query.includes('FROM pipelines WHERE tenant_id')) return [{ id: pipelineId }];
                if (query.includes('FROM pipeline_stages')) return stages;
                return [];
            }),
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(
                async (query: string) => {
                    txQueries.push(query);
                    if (query.includes('FROM opportunities o')) {
                        return [{
                            id: opportunityId,
                            stage: terminal.slug,
                            lead_id: leadId,
                            deal_id: dealId,
                            contact_id: '55555555-5555-4555-8555-555555555555',
                            first_name: 'Ada',
                            last_name: 'Lovelace',
                        }];
                    }
                    if (query.includes('FROM deals')) {
                        return [{
                            id: dealId,
                            stage_id: terminal.id,
                            contact_id: '55555555-5555-4555-8555-555555555555',
                        }];
                    }
                    if (query.includes('FROM pipelines')) return [{ id: pipelineId }];
                    return [];
                },
            )),
        };
        const redis: any = {
            get: jest.fn(async (key: string) => key.startsWith('tenant:') ? 'tenant_contract' : '1'),
        };
        const service = new PipelineService(
            prisma,
            redis,
            { emit: jest.fn() } as any,
            {} as any,
            {} as any,
        );
        await service.syncOpportunityToDeal(
            '11111111-1111-4111-8111-111111111111',
            leadId,
            terminal.slug,
            opportunityId,
        );
        await service.syncOpportunityToDeal(
            '11111111-1111-4111-8111-111111111111',
            leadId,
            terminal.slug,
            opportunityId,
        );

        expect(txQueries.some((query) => query.includes('INSERT INTO deals'))).toBe(false);
        expect(txQueries.some((query) => query.includes('WHERE id = $1::uuid AND contact_id = $2::uuid'))).toBe(true);
        expect(txQueries.some((query) => query.includes('WHERE d.contact_id'))).toBe(false);
    });

    it('moves the exact linked opportunity with the canonical slug atomically after ownership migration', async () => {
        const tenantId = '11111111-1111-4111-8111-111111111111';
        const dealId = '22222222-2222-4222-8222-222222222222';
        const opportunityId = '33333333-3333-4333-8333-333333333333';
        const leadId = '44444444-4444-4444-8444-444444444444';
        const pipelineId = '77777777-7777-4777-8777-777777777777';
        const currentStageId = '55555555-5555-4555-8555-555555555555';
        const targetStageId = '66666666-6666-4666-8666-666666666666';
        const transactions: Array<Array<{ query: string; params: unknown[] }>> = [];
        const prisma: any = {
            executeInTenantSchema: jest.fn(async (_schema: string, query: string) => {
                if (query.includes('SELECT id FROM pipeline_stages')) return [{ id: targetStageId }];
                if (query.includes('transition_rules')) {
                    return [{
                        id: targetStageId,
                        slug: 'listo_para_cierre',
                        sla_hours: 24,
                        default_probability: 95,
                        is_terminal: false,
                        terminal_outcome: null,
                        transition_rules: [],
                    }];
                }
                return [];
            }),
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => {
                const txCalls: Array<{ query: string; params: unknown[] }> = [];
                transactions.push(txCalls);
                return callback(async (query: string, params: unknown[] = []) => {
                    txCalls.push({ query, params });
                    if (query.includes('SELECT id FROM pipelines') && query.includes('is_default = true')) {
                        return [{ id: pipelineId }];
                    }
                    if (query.includes('AS has_orphans')) {
                        return [{ has_orphans: false, has_owned_duplicates: false }];
                    }
                    if (query.includes('FROM deals d') && query.includes('WHERE d.id = $1::uuid')) {
                        return [{
                            stage_id: currentStageId,
                            deal_pipeline_id: pipelineId,
                            stage_pipeline_id: pipelineId,
                            current_is_terminal: false,
                            current_terminal_outcome: null,
                            current_slug: 'contactado',
                        }];
                    }
                    if (query.includes('FROM pipeline_stages') && query.includes('ORDER BY position ASC')) {
                        return [{
                            id: targetStageId,
                            pipeline_id: pipelineId,
                            name: 'Listo para cierre',
                            slug: 'listo_para_cierre',
                            position: 1,
                            is_terminal: false,
                            terminal_outcome: null,
                            sla_hours: 24,
                            transition_rules: [],
                            prob: 95,
                        }];
                    }
                    if (query.includes('FROM opportunities')) {
                        return [{ id: opportunityId, lead_id: leadId, stage: 'contactado' }];
                    }
                    return [];
                });
            }),
        };
        const redis: any = { get: jest.fn().mockResolvedValue('tenant_contract') };
        const emitter = { emit: jest.fn() };
        const service = new PipelineService(prisma, redis, emitter as any, {} as any, {} as any);

        await service.moveToStage(tenantId, dealId, targetStageId);

        expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(2);
        const moveCalls = transactions.at(-1)!;
        const exactLookup = moveCalls.find(({ query }) => query.includes('FROM opportunities'));
        expect(exactLookup?.query).toContain('WHERE deal_id = $1::uuid');
        expect(exactLookup?.query).not.toContain('contact_id');
        const opportunityWrite = moveCalls.find(({ query }) => query.includes('UPDATE opportunities'));
        expect(opportunityWrite?.params).toEqual(['listo_para_cierre', opportunityId]);
        expect(moveCalls.some(({ query }) => query.includes('INSERT INTO stage_history'))).toBe(true);
        expect(moveCalls.some(({ query }) => query.includes('INSERT INTO stage_transitions'))).toBe(true);
        expect(emitter.emit).toHaveBeenCalledTimes(1);
    });

    it('does not emit a stage event when the atomic history write fails', async () => {
        const pipelineId = '77777777-7777-4777-8777-777777777777';
        const targetStageId = '66666666-6666-4666-8666-666666666666';
        const prisma: any = {
            executeInTenantSchema: jest.fn(async (_schema: string, query: string) => {
                if (query.includes('SELECT id FROM pipeline_stages')) return [{ id: targetStageId }];
                if (query.includes('transition_rules')) {
                    return [{
                        id: targetStageId,
                        slug: 'listo_para_cierre',
                        default_probability: 95,
                        is_terminal: false,
                        terminal_outcome: null,
                        transition_rules: [],
                    }];
                }
                return [];
            }),
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(
                async (query: string) => {
                    if (query.includes('SELECT id FROM pipelines') && query.includes('is_default = true')) {
                        return [{ id: pipelineId }];
                    }
                    if (query.includes('AS has_orphans')) {
                        return [{ has_orphans: false, has_owned_duplicates: false }];
                    }
                    if (query.includes('FROM deals d') && query.includes('WHERE d.id = $1::uuid')) {
                        return [{
                            stage_id: '55555555-5555-4555-8555-555555555555',
                            deal_pipeline_id: pipelineId,
                            stage_pipeline_id: pipelineId,
                            current_is_terminal: false,
                        }];
                    }
                    if (query.includes('FROM pipeline_stages') && query.includes('ORDER BY position ASC')) {
                        return [{
                            id: targetStageId,
                            pipeline_id: pipelineId,
                            name: 'Listo para cierre',
                            slug: 'listo_para_cierre',
                            position: 1,
                            default_probability: 95,
                            prob: 95,
                            is_terminal: false,
                            terminal_outcome: null,
                            transition_rules: [],
                        }];
                    }
                    if (query.includes('FROM opportunities')) {
                        return [{
                            id: '33333333-3333-4333-8333-333333333333',
                            lead_id: '44444444-4444-4444-8444-444444444444',
                            stage: 'contactado',
                        }];
                    }
                    if (query.includes('INSERT INTO stage_history')) throw new Error('audit unavailable');
                    return [];
                },
            )),
        };
        const emitter = { emit: jest.fn() };
        const service = new PipelineService(
            prisma,
            { get: jest.fn().mockResolvedValue('tenant_contract') } as any,
            emitter as any,
            {} as any,
            {} as any,
        );

        await expect(service.moveToStage(
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
            targetStageId,
        )).rejects.toThrow('audit unavailable');
        expect(emitter.emit).not.toHaveBeenCalled();
    });
});
