import { Client } from 'pg';
import { ensurePrimaryPipeline, TenantTransactionQuery } from './primary-pipeline.util';

const RUN_PG = process.env.RUN_PIPELINE_OWNERSHIP_PG_TESTS === '1';
const describePg = RUN_PG ? describe : describe.skip;

describePg('ensurePrimaryPipeline PostgreSQL ownership smoke', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const schema = `pipeline_ownership_${process.pid}_${Date.now()}`;
    let client: Client;

    jest.setTimeout(30_000);

    beforeAll(async () => {
        if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the PostgreSQL ownership smoke');
        client = new Client({ connectionString: process.env.DATABASE_URL });
        await client.connect();
        await client.query(`CREATE SCHEMA "${schema}"`);
        await client.query(`
            CREATE TABLE "${schema}".pipelines (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                tenant_id UUID NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                is_default BOOLEAN DEFAULT false,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await client.query(`
            CREATE UNIQUE INDEX uidx_pipeline_default_test
            ON "${schema}".pipelines (tenant_id) WHERE is_default = true
        `);
        await client.query(`
            CREATE TABLE "${schema}".pipeline_stages (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                tenant_id UUID NOT NULL,
                pipeline_id UUID,
                name TEXT NOT NULL,
                slug TEXT,
                color TEXT,
                position INTEGER,
                default_probability INTEGER,
                sla_hours INTEGER,
                is_terminal BOOLEAN DEFAULT false,
                terminal_outcome TEXT,
                transition_rules JSONB DEFAULT '[]'::jsonb
            )
        `);
        await client.query(`
            CREATE UNIQUE INDEX uidx_pipeline_stages_test
            ON "${schema}".pipeline_stages (pipeline_id, slug) NULLS NOT DISTINCT
        `);
        await client.query(`
            CREATE TABLE "${schema}".deals (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                stage_id UUID,
                pipeline_id UUID
            )
        `);
        await client.query(`
            CREATE TABLE "${schema}".stage_transitions (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                deal_id UUID,
                from_stage TEXT,
                to_stage TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
    });

    afterAll(async () => {
        if (!client) return;
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        await client.end();
    });

    beforeEach(async () => {
        await client.query(`TRUNCATE "${schema}".stage_transitions, "${schema}".deals, "${schema}".pipeline_stages, "${schema}".pipelines`);
    });

    async function inOwnershipTransaction<T>(connection: Client, run: (query: TenantTransactionQuery) => Promise<T>) {
        await connection.query('BEGIN');
        try {
            await connection.query(`SET LOCAL search_path TO "${schema}", public`);
            const query: TenantTransactionQuery = async <R = any[]>(sql: string, params: any[] = []) =>
                (await connection.query(sql, params)).rows as R;
            const result = await run(query);
            await connection.query('COMMIT');
            return result;
        } catch (error) {
            await connection.query('ROLLBACK');
            throw error;
        }
    }

    async function createDefault(connection = client): Promise<string> {
        const rows = await connection.query<{ id: string }>(
            `INSERT INTO "${schema}".pipelines
                (tenant_id, name, is_default, is_active)
             VALUES ($1::uuid, 'Pipeline Principal', true, true)
             RETURNING id`,
            [tenantId],
        );
        return rows.rows[0].id;
    }

    async function createActiveNonDefault(name: string, connection = client): Promise<string> {
        const rows = await connection.query<{ id: string }>(
            `INSERT INTO "${schema}".pipelines
                (tenant_id, name, is_default, is_active)
             VALUES ($1::uuid, $2, false, true)
             RETURNING id`,
            [tenantId, name],
        );
        return rows.rows[0].id;
    }

    async function seedSeven(pipelineId: string | null, editedSlug?: string): Promise<void> {
        for (let position = 0; position < 7; position++) {
            const slug = `stage_${position}`;
            await client.query(
                `INSERT INTO "${schema}".pipeline_stages
                    (tenant_id, pipeline_id, name, slug, color, position,
                     default_probability, sla_hours, is_terminal, terminal_outcome, transition_rules)
                 VALUES ($1::uuid, $2::uuid, $3, $4, '#123456', $5, $6, 24, false, NULL, '[]'::jsonb)`,
                [
                    tenantId,
                    pipelineId,
                    slug === editedSlug ? `Edited ${slug}` : `Stage ${position}`,
                    slug,
                    position,
                    position * 10,
                ],
            );
        }
    }

    it('repairs the exact 7 owned + 7 orphan retry state to seven and remains idempotent', async () => {
        const pipelineId = await createDefault();
        await seedSeven(pipelineId);
        await seedSeven(null);
        const stages = await client.query<{ id: string; slug: string; pipeline_id: string | null }>(
            `SELECT id, slug, pipeline_id
               FROM "${schema}".pipeline_stages
              WHERE slug IN ('stage_1', 'stage_2')
              ORDER BY slug, pipeline_id NULLS FIRST`,
        );
        const orphanFrom = stages.rows.find((stage) => stage.slug === 'stage_1' && stage.pipeline_id === null)!;
        const orphanTo = stages.rows.find((stage) => stage.slug === 'stage_2' && stage.pipeline_id === null)!;
        const ownedFrom = stages.rows.find((stage) => stage.slug === 'stage_1' && stage.pipeline_id === pipelineId)!;
        const ownedTo = stages.rows.find((stage) => stage.slug === 'stage_2' && stage.pipeline_id === pipelineId)!;
        const transition = await client.query<{ id: string }>(
            `INSERT INTO "${schema}".stage_transitions (from_stage, to_stage)
             VALUES (UPPER($1), $2)
             RETURNING id`,
            [orphanFrom.id, orphanTo.id],
        );

        const first = await inOwnershipTransaction(client, (query) => ensurePrimaryPipeline(query, tenantId));
        const second = await inOwnershipTransaction(client, (query) => ensurePrimaryPipeline(query, tenantId));
        const counts = await client.query<{ stages: number; orphaned: number }>(
            `SELECT COUNT(*)::int AS stages,
                    COUNT(*) FILTER (WHERE pipeline_id IS NULL)::int AS orphaned
               FROM "${schema}".pipeline_stages`,
        );
        const remapped = await client.query<{ from_stage: string | null; to_stage: string }>(
            `SELECT from_stage, to_stage
               FROM "${schema}".stage_transitions
              WHERE id = $1::uuid`,
            [transition.rows[0].id],
        );

        expect(first).toEqual({ pipelineId, repairedDuplicateStages: 7 });
        expect(second).toEqual({ pipelineId, repairedDuplicateStages: 0 });
        expect(counts.rows[0]).toEqual({ stages: 7, orphaned: 0 });
        expect(remapped.rows[0]).toEqual({
            from_stage: ownedFrom.id,
            to_stage: ownedTo.id,
        });
    });

    it('rolls back and preserves an edited duplicate for explicit review', async () => {
        const pipelineId = await createDefault();
        await seedSeven(pipelineId);
        await seedSeven(null, 'stage_3');

        await expect(inOwnershipTransaction(client, (query) => ensurePrimaryPipeline(query, tenantId)))
            .rejects.toMatchObject({ status: 409 });
        const counts = await client.query<{ stages: number; orphaned: number }>(
            `SELECT COUNT(*)::int AS stages,
                    COUNT(*) FILTER (WHERE pipeline_id IS NULL)::int AS orphaned
               FROM "${schema}".pipeline_stages`,
        );
        expect(counts.rows[0]).toEqual({ stages: 14, orphaned: 7 });
    });

    it('rolls back and preserves an in-use duplicate and its deal reference', async () => {
        const pipelineId = await createDefault();
        await seedSeven(pipelineId);
        await seedSeven(null);
        const orphan = await client.query<{ id: string }>(
            `SELECT id FROM "${schema}".pipeline_stages WHERE pipeline_id IS NULL AND slug = 'stage_2'`,
        );
        await client.query(
            `INSERT INTO "${schema}".deals (stage_id) VALUES ($1::uuid)`,
            [orphan.rows[0].id],
        );

        await expect(inOwnershipTransaction(client, (query) => ensurePrimaryPipeline(query, tenantId)))
            .rejects.toMatchObject({ status: 409 });
        const referenced = await client.query<{ pipeline_id: string | null }>(
            `SELECT ps.pipeline_id
               FROM "${schema}".pipeline_stages ps
               JOIN "${schema}".deals d ON d.stage_id = ps.id`,
        );
        expect(referenced.rows[0].pipeline_id).toBeNull();
    });

    it('repairs duplicate orphan slugs left by a schema that predated the unique index', async () => {
        await client.query(`DROP INDEX "${schema}".uidx_pipeline_stages_test`);
        try {
            await seedSeven(null);
            await seedSeven(null);
            const duplicatePair = await client.query<{ id: string }>(
                `SELECT id
                   FROM "${schema}".pipeline_stages
                  WHERE pipeline_id IS NULL AND slug = 'stage_3'
                  ORDER BY id`,
            );
            const transition = await client.query<{ id: string }>(
                `INSERT INTO "${schema}".stage_transitions (from_stage, to_stage)
                 VALUES ($1, UPPER($1))
                 RETURNING id`,
                [duplicatePair.rows[1].id],
            );

            const resolution = await inOwnershipTransaction(
                client,
                (query) => ensurePrimaryPipeline(query, tenantId),
            );
            const counts = await client.query<{ stages: number; orphaned: number }>(
                `SELECT COUNT(*)::int AS stages,
                        COUNT(*) FILTER (WHERE pipeline_id IS NULL)::int AS orphaned
                   FROM "${schema}".pipeline_stages`,
            );
            const remapped = await client.query<{ from_stage: string | null; to_stage: string }>(
                `SELECT from_stage, to_stage
                   FROM "${schema}".stage_transitions
                  WHERE id = $1::uuid`,
                [transition.rows[0].id],
            );
            expect(resolution.repairedDuplicateStages).toBe(7);
            expect(counts.rows[0]).toEqual({ stages: 7, orphaned: 0 });
            expect(remapped.rows[0]).toEqual({
                from_stage: duplicatePair.rows[0].id,
                to_stage: duplicatePair.rows[0].id,
            });
        } finally {
            await client.query(`TRUNCATE "${schema}".stage_transitions, "${schema}".deals, "${schema}".pipeline_stages, "${schema}".pipelines`);
            await client.query(`
                CREATE UNIQUE INDEX uidx_pipeline_stages_test
                ON "${schema}".pipeline_stages (pipeline_id, slug) NULLS NOT DISTINCT
            `);
        }
    });

    it('repairs fourteen exact stages already adopted into a pre-index default pipeline', async () => {
        await client.query(`DROP INDEX "${schema}".uidx_pipeline_stages_test`);
        try {
            const pipelineId = await createDefault();
            await seedSeven(pipelineId);
            await seedSeven(pipelineId);
            const duplicatePair = await client.query<{ id: string }>(
                `SELECT id
                   FROM "${schema}".pipeline_stages
                  WHERE pipeline_id = $1::uuid AND slug = 'stage_5'
                  ORDER BY id`,
                [pipelineId],
            );
            const transition = await client.query<{ id: string }>(
                `INSERT INTO "${schema}".stage_transitions (from_stage, to_stage)
                 VALUES (UPPER($1), $1)
                 RETURNING id`,
                [duplicatePair.rows[1].id],
            );

            const resolution = await inOwnershipTransaction(
                client,
                (query) => ensurePrimaryPipeline(query, tenantId),
            );
            const counts = await client.query<{ stages: number }>(
                `SELECT COUNT(*)::int AS stages FROM "${schema}".pipeline_stages`,
            );
            const remapped = await client.query<{ from_stage: string | null; to_stage: string }>(
                `SELECT from_stage, to_stage
                   FROM "${schema}".stage_transitions
                  WHERE id = $1::uuid`,
                [transition.rows[0].id],
            );
            expect(resolution).toEqual({ pipelineId, repairedDuplicateStages: 7 });
            expect(counts.rows[0].stages).toBe(7);
            expect(remapped.rows[0]).toEqual({
                from_stage: duplicatePair.rows[0].id,
                to_stage: duplicatePair.rows[0].id,
            });
        } finally {
            await client.query(`TRUNCATE "${schema}".stage_transitions, "${schema}".deals, "${schema}".pipeline_stages, "${schema}".pipelines`);
            await client.query(`
                CREATE UNIQUE INDEX uidx_pipeline_stages_test
                ON "${schema}".pipeline_stages (pipeline_id, slug) NULLS NOT DISTINCT
            `);
        }
    });

    it('preserves and reports an edited duplicate already inside the default pipeline', async () => {
        await client.query(`DROP INDEX "${schema}".uidx_pipeline_stages_test`);
        try {
            const pipelineId = await createDefault();
            await seedSeven(pipelineId);
            await seedSeven(pipelineId, 'stage_4');

            await expect(inOwnershipTransaction(client, (query) => ensurePrimaryPipeline(query, tenantId)))
                .rejects.toMatchObject({ status: 409 });
            const counts = await client.query<{ stages: number }>(
                `SELECT COUNT(*)::int AS stages FROM "${schema}".pipeline_stages`,
            );
            expect(counts.rows[0].stages).toBe(14);
        } finally {
            await client.query(`TRUNCATE "${schema}".stage_transitions, "${schema}".deals, "${schema}".pipeline_stages, "${schema}".pipelines`);
            await client.query(`
                CREATE UNIQUE INDEX uidx_pipeline_stages_test
                ON "${schema}".pipeline_stages (pipeline_id, slug) NULLS NOT DISTINCT
            `);
        }
    });

    it('serializes two concurrent adopters into one default pipeline', async () => {
        await seedSeven(null);
        if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
        const secondClient = new Client({ connectionString: process.env.DATABASE_URL });
        await secondClient.connect();
        try {
            const [first, second] = await Promise.all([
                inOwnershipTransaction(client, (query) => ensurePrimaryPipeline(query, tenantId)),
                inOwnershipTransaction(secondClient, (query) => ensurePrimaryPipeline(query, tenantId)),
            ]);
            const counts = await client.query<{ pipelines: number; stages: number; orphaned: number }>(
                `SELECT
                    (SELECT COUNT(*)::int FROM "${schema}".pipelines) AS pipelines,
                    (SELECT COUNT(*)::int FROM "${schema}".pipeline_stages) AS stages,
                    (SELECT COUNT(*)::int FROM "${schema}".pipeline_stages WHERE pipeline_id IS NULL) AS orphaned`,
            );
            expect(first.pipelineId).toBe(second.pipelineId);
            expect(counts.rows[0]).toEqual({ pipelines: 1, stages: 7, orphaned: 0 });
        } finally {
            await secondClient.end();
        }
    });

    it('promotes the sole active legacy pipeline instead of hiding its owned stages', async () => {
        const legacyPipelineId = await createActiveNonDefault('Legacy sales');
        await seedSeven(legacyPipelineId);

        const resolution = await inOwnershipTransaction(
            client,
            (query) => ensurePrimaryPipeline(query, tenantId),
        );
        const state = await client.query<{
            pipelines: number;
            defaults: number;
            stages_in_legacy: number;
        }>(
            `SELECT
                (SELECT COUNT(*)::int FROM "${schema}".pipelines) AS pipelines,
                (SELECT COUNT(*)::int FROM "${schema}".pipelines WHERE is_default = true) AS defaults,
                (SELECT COUNT(*)::int FROM "${schema}".pipeline_stages
                  WHERE pipeline_id = $1::uuid) AS stages_in_legacy`,
            [legacyPipelineId],
        );

        expect(resolution).toEqual({
            pipelineId: legacyPipelineId,
            repairedDuplicateStages: 0,
        });
        expect(state.rows[0]).toEqual({
            pipelines: 1,
            defaults: 1,
            stages_in_legacy: 7,
        });
    });

    it('fails closed when multiple active pipelines have no explicit default', async () => {
        const firstPipelineId = await createActiveNonDefault('Sales one');
        const secondPipelineId = await createActiveNonDefault('Sales two');

        await expect(inOwnershipTransaction(
            client,
            (query) => ensurePrimaryPipeline(query, tenantId),
        )).rejects.toMatchObject({
            status: 409,
            response: expect.objectContaining({
                error: 'pipeline_default_ambiguous',
                pipelineIds: expect.arrayContaining([firstPipelineId, secondPipelineId]),
            }),
        });
        const state = await client.query<{ pipelines: number; defaults: number }>(
            `SELECT
                COUNT(*)::int AS pipelines,
                COUNT(*) FILTER (WHERE is_default = true)::int AS defaults
               FROM "${schema}".pipelines`,
        );
        expect(state.rows[0]).toEqual({ pipelines: 2, defaults: 0 });
    });

    it('inherits a NULL deal pipeline from its secondary stage before primary fallback', async () => {
        const defaultPipelineId = await createDefault();
        const secondaryPipelineId = await createActiveNonDefault('Renewals');
        const stage = await client.query<{ id: string }>(
            `INSERT INTO "${schema}".pipeline_stages
                (tenant_id, pipeline_id, name, slug, color, position,
                 default_probability, sla_hours, is_terminal, transition_rules)
             VALUES ($1::uuid, $2::uuid, 'Renewal', 'renewal', '#123456', 0,
                     50, 24, false, '[]'::jsonb)
             RETURNING id`,
            [tenantId, secondaryPipelineId],
        );
        const deal = await client.query<{ id: string }>(
            `INSERT INTO "${schema}".deals (stage_id, pipeline_id)
             VALUES ($1::uuid, NULL)
             RETURNING id`,
            [stage.rows[0].id],
        );

        const resolution = await inOwnershipTransaction(
            client,
            (query) => ensurePrimaryPipeline(query, tenantId),
        );
        const owner = await client.query<{ pipeline_id: string | null }>(
            `SELECT pipeline_id FROM "${schema}".deals WHERE id = $1::uuid`,
            [deal.rows[0].id],
        );

        expect(resolution.pipelineId).toBe(defaultPipelineId);
        expect(owner.rows[0].pipeline_id).toBe(secondaryPipelineId);
    });
});
