import { VERTICAL_REGISTRY } from '../../../verticals/vertical-definitions';
import { TenantStageMapping } from '../../../pipeline/pipeline.service';
import { ImportExportService } from './import-export.service';

function saludCatalog(): TenantStageMapping[] {
    return VERTICAL_REGISTRY.salud.pipeline.stages.map((stage, position) => ({
        id: `${position}`,
        name: stage.name.es,
        slug: stage.slug,
        position,
        is_terminal: stage.isTerminal,
        terminal_outcome: stage.isTerminal ? stage.terminalOutcome : null,
        prob: stage.probability,
    }));
}

describe('ImportExportService tenant-native stage validation', () => {
    function setup() {
        const prisma: any = {
            executeInTenantSchema: jest.fn(async (_schema: string, query: string) => {
                if (query.includes('SELECT id, metadata FROM leads')) return [];
                return [];
            }),
        };
        const redis: any = { get: jest.fn().mockResolvedValue('tenant_contract') };
        const throttle: any = { getPlanLimit: jest.fn().mockResolvedValue(Infinity) };
        const pipeline: any = {
            getTenantStageCatalog: jest.fn().mockResolvedValue(saludCatalog()),
            writeLeadStage: jest.fn(),
        };
        return {
            service: new ImportExportService(prisma, redis, throttle, pipeline),
            prisma,
        };
    }

    it('rejects an unknown non-empty stage before any row-side write', async () => {
        const { service, prisma } = setup();
        const result = await service.importCSV(
            '11111111-1111-4111-8111-111111111111',
            'phone,stage\n+573001234567,etapa_inventada',
        );

        expect(result).toMatchObject({ imported: 0, skipped: 1 });
        expect(result.errors[0]).toContain('Etapa inválida');
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('maps a semantic alias to a real vertical stage before inserting', async () => {
        const { service, prisma } = setup();
        const result = await service.importCSV(
            '11111111-1111-4111-8111-111111111111',
            'phone,stage\n+573001234567,qualified',
        );

        expect(result).toMatchObject({ imported: 1, skipped: 0, errors: [] });
        const insert = prisma.executeInTenantSchema.mock.calls.find(([, query]: [string, string]) =>
            query.includes('INSERT INTO leads'),
        );
        expect(insert).toBeDefined();
        expect(saludCatalog().some((stage) => stage.slug === insert[2][5])).toBe(true);
        expect(insert[2][5]).not.toBe('calificado');
    });
});
