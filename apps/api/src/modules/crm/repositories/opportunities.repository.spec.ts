import { BadRequestException } from '@nestjs/common';
import { VERTICAL_REGISTRY } from '../../verticals/vertical-definitions';
import { OpportunitiesRepository } from './opportunities.repository';

const TERMINAL_STAGES = Object.values(VERTICAL_REGISTRY).flatMap((definition) =>
  definition.pipeline.stages
    .filter((stage) => stage.isTerminal)
    .map((stage) => ({
      industry: definition.industry,
      slug: stage.slug,
      outcome: stage.terminalOutcome,
      probability: stage.probability,
    })),
);

describe('OpportunitiesRepository terminal outcome propagation', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const opportunityId = '22222222-2222-4222-8222-222222222222';

  function setup(target?: { slug: string; outcome: 'won' | 'lost'; probability: number }) {
    const prisma: any = {
      executeInTenantSchema: jest.fn().mockResolvedValue([]),
    };
    const redis: any = { get: jest.fn().mockResolvedValue('tenant_contract') };
    const pipeline: any = {
      moveOpportunityStage: jest.fn(async (_tenantId: string, _opportunityId: string, requested: string) => {
        if (!target || requested !== target.slug) throw new BadRequestException(`Unknown pipeline stage: ${requested}`);
        return {
          id: '44444444-4444-4444-8444-444444444444',
          slug: target.slug,
          is_terminal: true,
          terminal_outcome: target.outcome,
          prob: target.probability,
          position: 1,
        };
      }),
    };
    const repository = new OpportunitiesRepository(prisma, redis, pipeline);
    return { repository, pipeline };
  }

  it('publishes at least one explicit terminal outcome for all 18 verticals', () => {
    expect(Object.keys(VERTICAL_REGISTRY)).toHaveLength(18);
    expect(new Set(TERMINAL_STAGES.map((stage) => stage.industry)).size).toBe(18);
    expect(TERMINAL_STAGES.length).toBeGreaterThanOrEqual(18);
  });

  it.each(TERMINAL_STAGES)(
    '$industry/$slug propagates explicit $outcome to Opportunity and Deal',
    async ({ slug, outcome, probability }) => {
      const { repository, pipeline } = setup({ slug, outcome, probability });

      await repository.moveOpportunity(tenantId, opportunityId, slug);

      expect(pipeline.moveOpportunityStage).toHaveBeenCalledWith(
        tenantId,
        opportunityId,
        slug,
        'agent',
      );
    },
  );

  it('rejects an unknown stage before mutating Opportunity, Lead or Deal', async () => {
    const { repository, pipeline } = setup();

    await expect(repository.moveOpportunity(tenantId, opportunityId, 'inventada'))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(pipeline.moveOpportunityStage).toHaveBeenCalledTimes(1);
  });
});
