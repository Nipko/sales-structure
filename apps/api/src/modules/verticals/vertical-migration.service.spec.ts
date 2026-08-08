import { ConflictException } from '@nestjs/common';
import { VerticalMigrationService } from './vertical-migration.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const MIGRATION_ID = '33333333-3333-4333-8333-333333333333';

describe('VerticalMigrationService', () => {
    const prisma: any = {
        tenant: { findUnique: jest.fn() },
        executeInTenantSchema: jest.fn(),
        transactionInTenantSchema: jest.fn(),
    };
    const redis: any = { del: jest.fn() };
    const service = new VerticalMigrationService(prisma, redis);

    beforeEach(() => jest.clearAllMocks());

    it('produces an additive diff and preserves conflicts/custom rows', () => {
        const diff = service.buildMigrationDiff({
            pipelineStages: [
                { id: 'old-1', slug: 'nuevo', name: 'Personalizado' },
                { id: 'old-2', slug: 'legacy', name: 'Legacy' },
            ],
            faqs: [{ id: 'faq-1', question: 'Igual', answer: 'Sí' }],
            services: [],
        }, {
            pipelineStages: [
                { slug: 'nuevo', name: 'Canónico' },
                { slug: 'cierre', name: 'Cierre' },
            ],
            faqs: [{ question: 'Igual', answer: 'Sí' }],
            services: [{ name: 'Consulta', durationMinutes: 30 }],
        });

        expect(diff.pipelineStages.add).toEqual([{ slug: 'cierre', name: 'Cierre' }]);
        expect(diff.pipelineStages.conflicts).toHaveLength(1);
        expect(diff.pipelineStages.preserved).toEqual([
            { id: 'old-2', slug: 'legacy', name: 'Legacy' },
        ]);
        expect(diff.faqs.unchanged).toEqual([{ question: 'Igual', answer: 'Sí' }]);
        expect(diff.services.add).toHaveLength(1);
    });

    it('persists a hashed preview with inventory and does not change tenant identity', async () => {
        prisma.tenant.findUnique.mockResolvedValue({
            industry: 'salud',
            language: 'es-CO',
            schemaName: 'tenant_demo',
            settings: { verticalConfig: { subType: 'dental' } },
        });
        const query = jest.fn().mockResolvedValue([]);
        prisma.transactionInTenantSchema.mockImplementation(async (_schema: string, callback: any) => callback(query));
        prisma.executeInTenantSchema
            .mockResolvedValueOnce([{
                contacts: 2, leads: 1, opportunities: 1, conversations: 3,
                appointments: 1, services: 0, faqs: 0, pipeline_stages: 0, agents: 1,
            }])
            .mockResolvedValueOnce([]);

        const preview = await service.preview(TENANT_ID, 'turismo', 'agencia_viajes', USER_ID);

        expect(preview.from).toEqual({ industry: 'salud', subType: 'dental' });
        expect(preview.to).toEqual({ industry: 'turismo', subType: 'agencia_viajes' });
        expect(preview.previewHash).toMatch(/^[a-f0-9]{64}$/);
        expect(preview.applySupported).toBe(false);
        expect(preview.mappingCoverage).toEqual(expect.arrayContaining([
            expect.objectContaining({ objectKind: 'agent_personas_and_tools', status: 'unmapped' }),
            expect.objectContaining({ objectKind: 'vertical_operational_objects', status: 'unmapped' }),
        ]));
        expect(preview.warnings).toContain('Existing appointments remain unchanged and require operational review.');
        const insert = prisma.executeInTenantSchema.mock.calls[1];
        expect(insert[1]).toContain('INSERT INTO vertical_migrations');
        expect(insert[2]).toContain(preview.previewHash);
        expect(prisma.tenant.update).toBeUndefined();
    });

    it('keeps apply fail-closed even for an approved seed diff', async () => {
        prisma.tenant.findUnique.mockResolvedValue({ schemaName: 'tenant_demo' });
        prisma.executeInTenantSchema.mockResolvedValueOnce([{
            status: 'approved',
            preview_hash: 'exact',
            preview_payload: {
                applySupported: false,
                mappingCoverage: [{ objectKind: 'appointments', status: 'unmapped', rowCount: 1 }],
            },
        }]);

        await expect(service.apply(TENANT_ID, MIGRATION_ID, 'exact', USER_ID))
            .rejects.toMatchObject({ response: expect.objectContaining({
                error: 'vertical_migration_apply_not_supported',
                applySupported: false,
            }) });
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('requires exact preview approval and rejects a stale/mismatched hash', async () => {
        prisma.tenant.findUnique.mockResolvedValue({ schemaName: 'tenant_demo' });
        const query = jest.fn().mockResolvedValueOnce([{
            id: MIGRATION_ID,
            status: 'preview',
            preview_hash: 'expected',
            requested_by: USER_ID,
            expires_at: new Date(Date.now() + 60_000),
        }]);
        prisma.transactionInTenantSchema.mockImplementation(async (_schema: string, callback: any) => callback(query));

        await expect(service.approve(TENANT_ID, MIGRATION_ID, 'different', USER_ID))
            .rejects.toBeInstanceOf(ConflictException);
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('refuses rollback when an inserted row was customized after migration', async () => {
        prisma.tenant.findUnique.mockResolvedValue({ schemaName: 'tenant_demo' });
        const query = jest.fn()
            .mockResolvedValueOnce([{
                id: MIGRATION_ID,
                status: 'applied',
                inserted_rows: {
                    pipelineStages: [{ id: '44444444-4444-4444-8444-444444444444', fingerprint: 'not-current' }],
                    faqs: [],
                    services: [],
                },
                snapshot: {
                    identity: { industry: 'salud', subType: 'dental' },
                    settings: { verticalConfig: { industry: 'salud', subType: 'dental' } },
                },
            }])
            .mockResolvedValueOnce([{
                id: '44444444-4444-4444-8444-444444444444',
                slug: 'customized', name: 'Changed', color: '#000', position: 0,
                probability: 10, sla_hours: null, is_terminal: false,
                terminal_outcome: null, transition_rules: [],
            }]);
        prisma.transactionInTenantSchema.mockImplementation(async (_schema: string, callback: any) => callback(query));

        await expect(service.rollback(TENANT_ID, MIGRATION_ID, USER_ID))
            .rejects.toBeInstanceOf(ConflictException);
        expect(query.mock.calls.some(([sql]: [string]) => sql.includes('DELETE FROM pipeline_stages'))).toBe(false);
    });
});
