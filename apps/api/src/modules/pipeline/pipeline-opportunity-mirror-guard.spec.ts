import { ConflictException } from '@nestjs/common';
import { PipelineService, TenantStageMapping } from './pipeline.service';

const TENANT = '3e8ad32e-a16b-42e6-9634-b8e8cc29292d';
const LEAD = '11111111-1111-4111-8111-111111111111';
const OPPORTUNITY = '131aec15-2726-4467-90ac-0251e4c64cb7';

/** A tourism tenant: its native "ready to close" stage is `confirmado`. */
const CONFIRMADO: TenantStageMapping = {
    id: 'stage-confirmado',
    name: 'Confirmado',
    slug: 'confirmado',
    position: 5,
    is_terminal: false,
    terminal_outcome: null,
    pipeline_id: 'pipeline-1',
} as any;

/**
 * Only the guard is under test. Everything past it needs a contact, and the
 * method returns early without one — enough to prove the guard let it through.
 */
function queryFor(storedStage: string) {
    return jest.fn(async (sql: string) => {
        if (sql.includes('FROM opportunities o')) {
            return [{
                id: OPPORTUNITY,
                stage: storedStage,
                lead_id: LEAD,
                deal_id: null,
                contact_id: null,
                first_name: 'Nir',
                last_name: 'Levin',
                phone: '573208010737',
            }];
        }
        return [];
    }) as any;
}

describe('syncExactOpportunityDealTx stage guard', () => {
    const service = Object.create(PipelineService.prototype) as PipelineService;

    it('rejected every vertical tenant before the observed stage was passed', async () => {
        // Reproduces the production error verbatim: the opportunity carries the
        // generic slug while the caller resolved the tenant-native one.
        await expect(service.syncExactOpportunityDealTx(
            queryFor('listo_para_cierre'), TENANT, LEAD, OPPORTUNITY, CONFIRMADO,
        )).rejects.toBeInstanceOf(ConflictException);
    });

    it('accepts the generic slug the caller actually resolved from', async () => {
        await expect(service.syncExactOpportunityDealTx(
            queryFor('listo_para_cierre'), TENANT, LEAD, OPPORTUNITY, CONFIRMADO, 'listo_para_cierre',
        )).resolves.toBeUndefined();
    });

    it('still accepts an opportunity already stored at the canonical slug', async () => {
        await expect(service.syncExactOpportunityDealTx(
            queryFor('confirmado'), TENANT, LEAD, OPPORTUNITY, CONFIRMADO, 'listo_para_cierre',
        )).resolves.toBeUndefined();
    });

    it('still catches a genuine concurrent move to a third stage', async () => {
        // The guard's real job: somebody else dragged the card meanwhile.
        await expect(service.syncExactOpportunityDealTx(
            queryFor('perdido'), TENANT, LEAD, OPPORTUNITY, CONFIRMADO, 'listo_para_cierre',
        )).rejects.toBeInstanceOf(ConflictException);
    });

    it('ignores accent and separator noise in the stored slug', async () => {
        await expect(service.syncExactOpportunityDealTx(
            queryFor('Listo Para Cierre'), TENANT, LEAD, OPPORTUNITY, CONFIRMADO, 'listo_para_cierre',
        )).resolves.toBeUndefined();
    });
});
