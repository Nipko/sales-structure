import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ensurePrimaryPipeline, TenantTransactionQuery } from './primary-pipeline.util';

describe('ensurePrimaryPipeline', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const pipelineId = '22222222-2222-4222-8222-222222222222';

    it('serializa, resuelve el principal y adopta solo huérfanas sin conflicto', async () => {
        const calls: Array<{ sql: string; params: any[] }> = [];
        const queryMock = jest.fn(async (sql: string, params: any[] = []) => {
            calls.push({ sql, params });
            if (sql.includes('SELECT id FROM pipelines')) return [{ id: pipelineId }];
            if (sql.includes('AS has_orphans')) return [{ has_orphans: true }];
            if (sql.includes('AS has_deals')) return [];
            if (sql.includes('RETURNING orphan.id')) return [{ id: 'a' }, { id: 'b' }];
            return [];
        });
        const query = queryMock as unknown as TenantTransactionQuery;

        const result = await ensurePrimaryPipeline(query, tenantId);

        expect(result).toEqual({ pipelineId, repairedDuplicateStages: 2 });
        expect(calls[0].sql).toContain('pg_advisory_xact_lock');
        expect(calls.some(({ sql }) => sql.includes('INSERT INTO pipelines'))).toBe(false);
        const ownershipLock = calls.find(({ sql }) => sql.includes('LOCK TABLE pipeline_stages'));
        expect(ownershipLock?.sql).toContain('deals, stage_transitions');
        const adoption = calls.find(({ sql }) => sql.includes('UPDATE pipeline_stages orphan'));
        expect(adoption?.sql).toContain('NOT EXISTS');
        expect(adoption?.sql).toContain('owned.slug IS NOT DISTINCT FROM orphan.slug');
        expect(adoption?.params).toEqual([pipelineId]);
        const conservativeRepair = calls.find(({ sql }) => sql.includes('DELETE FROM pipeline_stages orphan'));
        expect(conservativeRepair?.sql).toContain('owned.name IS NOT DISTINCT FROM orphan.name');
        expect(conservativeRepair?.sql).toContain('NOT EXISTS');
        expect(conservativeRepair?.sql).toContain('deals d');
        const stageOwnedDealBackfill = calls.findIndex(({ sql }) => sql.includes('UPDATE deals d'));
        const primaryDealFallback = calls.findIndex(({ sql }) => sql.includes('UPDATE deals SET pipeline_id'));
        expect(stageOwnedDealBackfill).toBeGreaterThan(-1);
        expect(calls[stageOwnedDealBackfill].sql).toContain('d.stage_id = stage.id');
        expect(calls[stageOwnedDealBackfill].sql).toContain('stage.pipeline_id IS NOT NULL');
        expect(primaryDealFallback).toBeGreaterThan(stageOwnedDealBackfill);
        expect(calls[primaryDealFallback].params).toEqual([pipelineId]);

        const ownedRemap = calls.findIndex(({ sql }) =>
            sql.includes('UPDATE stage_transitions AS history')
            && sql.includes('WHERE pipeline_id = $1::uuid'));
        const ownedDelete = calls.findIndex(({ sql }) =>
            sql.includes('DELETE FROM pipeline_stages duplicate')
            && sql.includes('WHERE pipeline_id = $1::uuid'));
        const orphanToOwnedRemap = calls.findIndex(({ sql }) =>
            sql.includes('UPDATE stage_transitions AS history')
            && sql.includes('SELECT orphan.id AS duplicate_id, owned.id AS keeper_id'));
        const orphanToOwnedDelete = calls.findIndex(({ sql }) =>
            sql.includes('DELETE FROM pipeline_stages orphan'));
        const orphanDuplicateRemap = calls.findIndex(({ sql }) =>
            sql.includes('UPDATE stage_transitions AS history')
            && sql.includes('WHERE pipeline_id IS NULL')
            && sql.includes('FIRST_VALUE(id)'));
        const orphanDuplicateDelete = calls.findIndex(({ sql }) =>
            sql.includes('DELETE FROM pipeline_stages duplicate')
            && sql.includes('WHERE pipeline_id IS NULL'));

        expect(ownedRemap).toBeGreaterThan(-1);
        expect(ownedRemap).toBeLessThan(ownedDelete);
        expect(orphanToOwnedRemap).toBeGreaterThan(ownedDelete);
        expect(orphanToOwnedRemap).toBeLessThan(orphanToOwnedDelete);
        expect(orphanDuplicateRemap).toBeGreaterThan(orphanToOwnedDelete);
        expect(orphanDuplicateRemap).toBeLessThan(orphanDuplicateDelete);
        for (const index of [ownedRemap, orphanToOwnedRemap, orphanDuplicateRemap]) {
            expect(calls[index].sql).toContain('from_stage = COALESCE');
            expect(calls[index].sql).toContain('to_stage = COALESCE');
            expect(calls[index].sql).toContain('map.keeper_id::text');
            expect(calls[index].sql).toContain('NOT EXISTS (SELECT 1 FROM deals d');
        }
    });

    it('remapea el historial dentro del cleanup atómico del template antes de borrar', () => {
        // Los saltos se normalizan a LF: el .sql se versiona con LF pero un
        // checkout en Windows lo materializa con CRLF, y las búsquedas de abajo
        // incluyen el salto de línea. Sin esto la prueba falla sólo en Windows,
        // por el final de línea y no por el SQL.
        const tenantSchema = readFileSync(
            resolve(__dirname, '../../../prisma/tenant-schema.sql'),
            'utf8',
        ).replace(/\r\n/g, '\n');
        const blockStart = tenantSchema.indexOf('DO $pipeline_stage_cleanup$');
        const lock = tenantSchema.indexOf('"stage_transitions"\n        IN SHARE ROW EXCLUSIVE MODE', blockStart);
        const historyUpdate = tenantSchema.indexOf('UPDATE "{{SCHEMA_NAME}}"."stage_transitions" history', blockStart);
        const duplicateDelete = tenantSchema.indexOf('DELETE FROM "{{SCHEMA_NAME}}"."pipeline_stages" a', blockStart);
        const blockEnd = tenantSchema.indexOf('$pipeline_stage_cleanup$;', blockStart + 1);

        expect(blockStart).toBeGreaterThan(-1);
        expect(lock).toBeGreaterThan(blockStart);
        expect(historyUpdate).toBeGreaterThan(lock);
        expect(duplicateDelete).toBeGreaterThan(historyUpdate);
        expect(blockEnd).toBeGreaterThan(duplicateDelete);
        const cleanup = tenantSchema.slice(blockStart, blockEnd);
        expect(cleanup).toContain('LOWER(history."from_stage") = map.duplicate_id::text');
        expect(cleanup).toContain('LOWER(history."to_stage") = map.duplicate_id::text');
        expect(cleanup).toContain('map.keeper_id::text');
        expect(cleanup).toContain('NOT EXISTS (');
        expect(cleanup).toContain('"deals" d');
    });

    it('promueve el único pipeline activo cuando el legado no marcó un principal', async () => {
        const calls: Array<{ sql: string; params: any[] }> = [];
        const queryMock = jest.fn(async (sql: string, params: any[] = []) => {
            calls.push({ sql, params });
            if (sql.includes('SET is_default = true')) return [{ id: pipelineId }];
            if (sql.includes('is_default = true')) return [];
            if (sql.includes('is_active = true') && sql.includes('SELECT id FROM pipelines')) {
                return [{ id: pipelineId }];
            }
            if (sql.includes('AS has_orphans')) {
                return [{ has_orphans: false, has_owned_duplicates: false }];
            }
            return [];
        });

        await expect(ensurePrimaryPipeline(
            queryMock as unknown as TenantTransactionQuery,
            tenantId,
        )).resolves.toEqual({ pipelineId, repairedDuplicateStages: 0 });

        const promotion = calls.find(({ sql }) => sql.includes('SET is_default = true'));
        expect(promotion?.params).toEqual([pipelineId, tenantId]);
        expect(calls.some(({ sql }) => sql.includes('INSERT INTO pipelines'))).toBe(false);
    });

    it('crea el principal solo cuando no existe ningún pipeline activo', async () => {
        const calls: Array<{ sql: string; params: any[] }> = [];
        const queryMock = jest.fn(async (sql: string, params: any[] = []) => {
            calls.push({ sql, params });
            if (sql.includes('is_default = true')) return [];
            if (sql.includes('is_active = true') && sql.includes('SELECT id FROM pipelines')) return [];
            if (sql.includes('INSERT INTO pipelines')) return [{ id: pipelineId }];
            if (sql.includes('AS has_orphans')) {
                return [{ has_orphans: false, has_owned_duplicates: false }];
            }
            return [];
        });

        await expect(ensurePrimaryPipeline(
            queryMock as unknown as TenantTransactionQuery,
            tenantId,
        )).resolves.toEqual({ pipelineId, repairedDuplicateStages: 0 });

        expect(calls.filter(({ sql }) => sql.includes('INSERT INTO pipelines'))).toHaveLength(1);
        expect(calls.some(({ sql }) => sql.includes('SET is_default = true'))).toBe(false);
    });

    it('falla cerrado si hay varios pipelines activos sin principal', async () => {
        const secondPipelineId = '33333333-3333-4333-8333-333333333333';
        const calls: Array<{ sql: string; params: any[] }> = [];
        const queryMock = jest.fn(async (sql: string, params: any[] = []) => {
            calls.push({ sql, params });
            if (sql.includes('is_default = true')) return [];
            if (sql.includes('is_active = true') && sql.includes('SELECT id FROM pipelines')) {
                return [{ id: pipelineId }, { id: secondPipelineId }];
            }
            return [];
        });

        await expect(ensurePrimaryPipeline(
            queryMock as unknown as TenantTransactionQuery,
            tenantId,
        )).rejects.toMatchObject({
            status: 409,
            response: expect.objectContaining({
                error: 'pipeline_default_ambiguous',
                pipelineIds: [pipelineId, secondPipelineId],
            }),
        });
        expect(calls.some(({ sql }) => sql.includes('INSERT INTO pipelines'))).toBe(false);
        expect(calls.some(({ sql }) => sql.includes('UPDATE pipeline_stages orphan'))).toBe(false);
        expect(calls.some(({ sql }) => sql.includes('UPDATE deals'))).toBe(false);
    });

    it('falla con 409 y no adopta una huérfana editada o referenciada', async () => {
        const queryMock = jest.fn(async (sql: string) => {
            if (sql.includes('SELECT id FROM pipelines')) return [{ id: pipelineId }];
            if (sql.includes('AS has_orphans')) return [{ has_orphans: true }];
            if (sql.includes('AS has_deals')) {
                return [{ id: 'stage-1', slug: 'lead', has_deals: true, differs: false }];
            }
            return [];
        });
        const query = queryMock as unknown as TenantTransactionQuery;

        await expect(ensurePrimaryPipeline(query, tenantId)).rejects.toMatchObject({
            status: 409,
            response: expect.objectContaining({ error: 'pipeline_stage_ownership_conflict' }),
        });
        expect(queryMock.mock.calls.some(([sql]: [string]) => sql.includes('UPDATE pipeline_stages orphan')))
            .toBe(false);
    });

    it('falla cerrado si no puede establecer un pipeline por defecto', async () => {
        const query = jest.fn(async () => []) as unknown as TenantTransactionQuery;

        await expect(ensurePrimaryPipeline(query, tenantId))
            .rejects.toThrow(`Default pipeline could not be established for tenant ${tenantId}`);
    });
});
