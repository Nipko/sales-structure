import { ConflictException } from '@nestjs/common';

export type TenantTransactionQuery = <T = any[]>(sql: string, params?: any[]) => Promise<T>;

export interface PrimaryPipelineResolution {
    pipelineId: string;
    repairedDuplicateStages: number;
}

/**
 * Establish the tenant's canonical primary pipeline on the caller's tenant
 * transaction.
 *
 * The advisory lock is deliberately identical to PipelineService's historical
 * migration lock.  Bootstrap, lazy pipeline migration and startup repair must
 * never race while moving the legacy `pipeline_id IS NULL` rows.
 *
 * Orphan stages are adopted only when their slug does not already exist in the
 * primary pipeline. Exact, unreferenced duplicates are removed; edited or
 * referenced rows fail closed with a structured conflict. Deleting an
 * arbitrary same-slug row here could destroy a stage edited by the tenant.
 */
export async function ensurePrimaryPipeline(
    query: TenantTransactionQuery,
    tenantId: string,
): Promise<PrimaryPipelineResolution> {
    await query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [tenantId]);

    type PipelineCandidate = { id: string };
    const defaults = await query<PipelineCandidate[]>(
        `SELECT id FROM pipelines
          WHERE tenant_id = $1::uuid AND is_default = true
          ORDER BY created_at ASC, id ASC
          FOR UPDATE`,
        [tenantId],
    );
    if (defaults.length > 1) {
        throw new ConflictException({
            error: 'pipeline_default_ambiguous',
            message: 'Hay varios pipelines marcados como principales; se requiere reconciliación manual.',
            tenantId,
            pipelineIds: defaults.map((pipeline) => pipeline.id),
        });
    }

    let pipelineId = defaults?.[0]?.id;
    if (!pipelineId) {
        // Historical versions treated the oldest pipeline as primary without
        // persisting is_default=true. Preserve that existing ownership when it
        // is unambiguous instead of creating a new empty funnel and hiding its
        // stages/deals. More than one active candidate has no safe automatic
        // winner, so fail closed before mutating tenant data.
        const activeCandidates = await query<PipelineCandidate[]>(
            `SELECT id FROM pipelines
              WHERE tenant_id = $1::uuid AND is_active = true
              ORDER BY created_at ASC, id ASC
              FOR UPDATE`,
            [tenantId],
        );
        if (activeCandidates.length > 1) {
            throw new ConflictException({
                error: 'pipeline_default_ambiguous',
                message: 'Hay varios pipelines activos y ninguno está marcado como principal.',
                tenantId,
                pipelineIds: activeCandidates.map((pipeline) => pipeline.id),
            });
        }
        if (activeCandidates.length === 1) {
            const promoted = await query<PipelineCandidate[]>(
                `UPDATE pipelines
                    SET is_default = true, is_active = true, updated_at = NOW()
                  WHERE id = $1::uuid AND tenant_id = $2::uuid
                  RETURNING id`,
                [activeCandidates[0].id, tenantId],
            );
            pipelineId = promoted?.[0]?.id;
        } else {
            const created = await query<PipelineCandidate[]>(
                `INSERT INTO pipelines (tenant_id, name, description, is_default, is_active)
                 VALUES ($1::uuid, 'Pipeline Principal', 'Pipeline de ventas predeterminado', true, true)
                 ON CONFLICT DO NOTHING
                 RETURNING id`,
                [tenantId],
            );
            pipelineId = created?.[0]?.id;
            if (!pipelineId) {
                // A non-cooperating writer may have established the default
                // despite the advisory lock. Re-read it instead of reporting a
                // false creation failure.
                const concurrentDefault = await query<PipelineCandidate[]>(
                    `SELECT id FROM pipelines
                      WHERE tenant_id = $1::uuid AND is_default = true
                      ORDER BY created_at ASC, id ASC
                      FOR UPDATE`,
                    [tenantId],
                );
                if (concurrentDefault.length > 1) {
                    throw new ConflictException({
                        error: 'pipeline_default_ambiguous',
                        message: 'Hay varios pipelines marcados como principales; se requiere reconciliación manual.',
                        tenantId,
                        pipelineIds: concurrentDefault.map((pipeline) => pipeline.id),
                    });
                }
                pipelineId = concurrentDefault?.[0]?.id;
            }
        }
    }
    if (!pipelineId) {
        throw new Error(`Default pipeline could not be established for tenant ${tenantId}`);
    }
    await query(
        `UPDATE pipelines SET is_active = true, updated_at = NOW()
          WHERE id = $1::uuid AND is_active IS DISTINCT FROM true`,
        [pipelineId],
    );

    const ownershipProbe = await query<Array<{ has_orphans: boolean; has_owned_duplicates: boolean }>>(
        `SELECT
            EXISTS (
                SELECT 1 FROM pipeline_stages WHERE pipeline_id IS NULL
            ) AS has_orphans,
            EXISTS (
                SELECT 1
                  FROM pipeline_stages
                 WHERE pipeline_id = $1::uuid
                 GROUP BY tenant_id, slug
                HAVING COUNT(*) > 1
            ) AS has_owned_duplicates`,
        [pipelineId],
    );
    let repairedDuplicateStages = 0;
    if (ownershipProbe?.[0]?.has_orphans || ownershipProbe?.[0]?.has_owned_duplicates) {
        // A legacy CRM writer used to create pipeline_id=NULL rows.  Lock only
        // while orphan reconciliation is actually necessary, so normal reads
        // do not serialize every request after the migration is clean.
        // stage_transitions stores stage UUIDs as text rather than foreign keys.
        // Lock it with the two ownership tables so a concurrent move cannot
        // append a reference after the remap and immediately before deletion.
        await query(`LOCK TABLE pipeline_stages, deals, stage_transitions IN SHARE ROW EXCLUSIVE MODE`);

        type OwnershipConflict = {
            id: string;
            slug: string | null;
            has_deals: boolean;
            differs: boolean;
        };
        const ownedDuplicateConflicts = await query<OwnershipConflict[]>(
            `WITH ranked AS (
                SELECT id,
                       FIRST_VALUE(id) OVER (
                           PARTITION BY tenant_id, slug ORDER BY id
                       ) AS keeper_id
                  FROM pipeline_stages
                 WHERE pipeline_id = $1::uuid
             )
             SELECT duplicate.id,
                    duplicate.slug,
                    EXISTS (SELECT 1 FROM deals d WHERE d.stage_id = duplicate.id) AS has_deals,
                    NOT (
                        keeper.name IS NOT DISTINCT FROM duplicate.name
                        AND keeper.color IS NOT DISTINCT FROM duplicate.color
                        AND keeper.position IS NOT DISTINCT FROM duplicate.position
                        AND keeper.default_probability IS NOT DISTINCT FROM duplicate.default_probability
                        AND keeper.sla_hours IS NOT DISTINCT FROM duplicate.sla_hours
                        AND keeper.is_terminal IS NOT DISTINCT FROM duplicate.is_terminal
                        AND keeper.terminal_outcome IS NOT DISTINCT FROM duplicate.terminal_outcome
                        AND COALESCE(keeper.transition_rules, '[]'::jsonb)
                            = COALESCE(duplicate.transition_rules, '[]'::jsonb)
                    ) AS differs
               FROM ranked
               JOIN pipeline_stages duplicate ON duplicate.id = ranked.id
               JOIN pipeline_stages keeper ON keeper.id = ranked.keeper_id
              WHERE ranked.id <> ranked.keeper_id
                AND (
                    EXISTS (SELECT 1 FROM deals d WHERE d.stage_id = duplicate.id)
                    OR NOT (
                        keeper.name IS NOT DISTINCT FROM duplicate.name
                        AND keeper.color IS NOT DISTINCT FROM duplicate.color
                        AND keeper.position IS NOT DISTINCT FROM duplicate.position
                        AND keeper.default_probability IS NOT DISTINCT FROM duplicate.default_probability
                        AND keeper.sla_hours IS NOT DISTINCT FROM duplicate.sla_hours
                        AND keeper.is_terminal IS NOT DISTINCT FROM duplicate.is_terminal
                        AND keeper.terminal_outcome IS NOT DISTINCT FROM duplicate.terminal_outcome
                        AND COALESCE(keeper.transition_rules, '[]'::jsonb)
                            = COALESCE(duplicate.transition_rules, '[]'::jsonb)
                    )
                )
              ORDER BY duplicate.position, duplicate.id`,
            [pipelineId],
        );
        const ownedConflicts = await query<OwnershipConflict[]>(
            `SELECT orphan.id,
                    orphan.slug,
                    EXISTS (SELECT 1 FROM deals d WHERE d.stage_id = orphan.id) AS has_deals,
                    NOT (
                        owned.name IS NOT DISTINCT FROM orphan.name
                        AND owned.color IS NOT DISTINCT FROM orphan.color
                        AND owned.position IS NOT DISTINCT FROM orphan.position
                        AND owned.default_probability IS NOT DISTINCT FROM orphan.default_probability
                        AND owned.sla_hours IS NOT DISTINCT FROM orphan.sla_hours
                        AND owned.is_terminal IS NOT DISTINCT FROM orphan.is_terminal
                        AND owned.terminal_outcome IS NOT DISTINCT FROM orphan.terminal_outcome
                        AND COALESCE(owned.transition_rules, '[]'::jsonb)
                            = COALESCE(orphan.transition_rules, '[]'::jsonb)
                    ) AS differs
               FROM pipeline_stages orphan
               JOIN pipeline_stages owned
                 ON owned.pipeline_id = $1::uuid
                AND owned.tenant_id = orphan.tenant_id
                AND owned.slug IS NOT DISTINCT FROM orphan.slug
              WHERE orphan.pipeline_id IS NULL
                AND (
                    EXISTS (SELECT 1 FROM deals d WHERE d.stage_id = orphan.id)
                    OR NOT (
                        owned.name IS NOT DISTINCT FROM orphan.name
                        AND owned.color IS NOT DISTINCT FROM orphan.color
                        AND owned.position IS NOT DISTINCT FROM orphan.position
                        AND owned.default_probability IS NOT DISTINCT FROM orphan.default_probability
                        AND owned.sla_hours IS NOT DISTINCT FROM orphan.sla_hours
                        AND owned.is_terminal IS NOT DISTINCT FROM orphan.is_terminal
                        AND owned.terminal_outcome IS NOT DISTINCT FROM orphan.terminal_outcome
                        AND COALESCE(owned.transition_rules, '[]'::jsonb)
                            = COALESCE(orphan.transition_rules, '[]'::jsonb)
                    )
                )
              ORDER BY orphan.position, orphan.id`,
            [pipelineId],
        );
        // Some pre-index schemas can contain more than one orphan with the
        // same slug. Reconcile those among themselves before adoption; moving
        // both to the primary pipeline would otherwise commit a duplicate and
        // make the later unique-index migration fail forever.
        const orphanConflicts = await query<OwnershipConflict[]>(
            `WITH ranked AS (
                SELECT id,
                       FIRST_VALUE(id) OVER (
                           PARTITION BY tenant_id, slug ORDER BY id
                       ) AS keeper_id
                  FROM pipeline_stages
                 WHERE pipeline_id IS NULL
             )
             SELECT duplicate.id,
                    duplicate.slug,
                    EXISTS (SELECT 1 FROM deals d WHERE d.stage_id = duplicate.id) AS has_deals,
                    NOT (
                        keeper.name IS NOT DISTINCT FROM duplicate.name
                        AND keeper.color IS NOT DISTINCT FROM duplicate.color
                        AND keeper.position IS NOT DISTINCT FROM duplicate.position
                        AND keeper.default_probability IS NOT DISTINCT FROM duplicate.default_probability
                        AND keeper.sla_hours IS NOT DISTINCT FROM duplicate.sla_hours
                        AND keeper.is_terminal IS NOT DISTINCT FROM duplicate.is_terminal
                        AND keeper.terminal_outcome IS NOT DISTINCT FROM duplicate.terminal_outcome
                        AND COALESCE(keeper.transition_rules, '[]'::jsonb)
                            = COALESCE(duplicate.transition_rules, '[]'::jsonb)
                    ) AS differs
               FROM ranked
               JOIN pipeline_stages duplicate ON duplicate.id = ranked.id
               JOIN pipeline_stages keeper ON keeper.id = ranked.keeper_id
              WHERE ranked.id <> ranked.keeper_id
                AND (
                    EXISTS (SELECT 1 FROM deals d WHERE d.stage_id = duplicate.id)
                    OR NOT (
                        keeper.name IS NOT DISTINCT FROM duplicate.name
                        AND keeper.color IS NOT DISTINCT FROM duplicate.color
                        AND keeper.position IS NOT DISTINCT FROM duplicate.position
                        AND keeper.default_probability IS NOT DISTINCT FROM duplicate.default_probability
                        AND keeper.sla_hours IS NOT DISTINCT FROM duplicate.sla_hours
                        AND keeper.is_terminal IS NOT DISTINCT FROM duplicate.is_terminal
                        AND keeper.terminal_outcome IS NOT DISTINCT FROM duplicate.terminal_outcome
                        AND COALESCE(keeper.transition_rules, '[]'::jsonb)
                            = COALESCE(duplicate.transition_rules, '[]'::jsonb)
                    )
                )
              ORDER BY duplicate.position, duplicate.id`,
        );
        const conflicts = [...ownedDuplicateConflicts, ...ownedConflicts, ...orphanConflicts];
        if (conflicts.length > 0) {
            throw new ConflictException({
                error: 'pipeline_stage_ownership_conflict',
                message: 'Hay etapas heredadas editadas o en uso que no pueden fusionarse automáticamente con el embudo principal.',
                tenantId,
                pipelineId,
                stages: conflicts.map((stage) => ({
                    id: stage.id,
                    slug: stage.slug,
                    hasDeals: Boolean(stage.has_deals),
                    differs: Boolean(stage.differs),
                })),
            });
        }

        await query(
            `WITH ranked AS (
                SELECT id,
                       FIRST_VALUE(id) OVER (
                           PARTITION BY tenant_id, slug ORDER BY id
                       ) AS keeper_id
                  FROM pipeline_stages
                 WHERE pipeline_id = $1::uuid
             ),
             duplicate_stage_map AS (
                SELECT duplicate.id AS duplicate_id, keeper.id AS keeper_id
                  FROM ranked
                  JOIN pipeline_stages duplicate ON duplicate.id = ranked.id
                  JOIN pipeline_stages keeper ON keeper.id = ranked.keeper_id
                 WHERE ranked.id <> ranked.keeper_id
                   AND keeper.name IS NOT DISTINCT FROM duplicate.name
                   AND keeper.color IS NOT DISTINCT FROM duplicate.color
                   AND keeper.position IS NOT DISTINCT FROM duplicate.position
                   AND keeper.default_probability IS NOT DISTINCT FROM duplicate.default_probability
                   AND keeper.sla_hours IS NOT DISTINCT FROM duplicate.sla_hours
                   AND keeper.is_terminal IS NOT DISTINCT FROM duplicate.is_terminal
                   AND keeper.terminal_outcome IS NOT DISTINCT FROM duplicate.terminal_outcome
                   AND COALESCE(keeper.transition_rules, '[]'::jsonb)
                       = COALESCE(duplicate.transition_rules, '[]'::jsonb)
                   AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.stage_id = duplicate.id)
             )
             UPDATE stage_transitions AS history
                SET from_stage = COALESCE(
                        (SELECT map.keeper_id::text
                           FROM duplicate_stage_map map
                          WHERE LOWER(history.from_stage) = map.duplicate_id::text),
                        history.from_stage
                    ),
                    to_stage = COALESCE(
                        (SELECT map.keeper_id::text
                           FROM duplicate_stage_map map
                          WHERE LOWER(history.to_stage) = map.duplicate_id::text),
                        history.to_stage
                    )
              WHERE EXISTS (
                    SELECT 1
                      FROM duplicate_stage_map map
                     WHERE LOWER(history.from_stage) = map.duplicate_id::text
                        OR LOWER(history.to_stage) = map.duplicate_id::text
              )`,
            [pipelineId],
        );
        const ownedDuplicates = await query<Array<{ id: string }>>(
            `WITH ranked AS (
                SELECT id,
                       FIRST_VALUE(id) OVER (
                           PARTITION BY tenant_id, slug ORDER BY id
                       ) AS keeper_id
                  FROM pipeline_stages
                 WHERE pipeline_id = $1::uuid
             )
             DELETE FROM pipeline_stages duplicate
              USING ranked, pipeline_stages keeper
              WHERE duplicate.id = ranked.id
                AND keeper.id = ranked.keeper_id
                AND ranked.id <> ranked.keeper_id
                AND keeper.name IS NOT DISTINCT FROM duplicate.name
                AND keeper.color IS NOT DISTINCT FROM duplicate.color
                AND keeper.position IS NOT DISTINCT FROM duplicate.position
                AND keeper.default_probability IS NOT DISTINCT FROM duplicate.default_probability
                AND keeper.sla_hours IS NOT DISTINCT FROM duplicate.sla_hours
                AND keeper.is_terminal IS NOT DISTINCT FROM duplicate.is_terminal
                AND keeper.terminal_outcome IS NOT DISTINCT FROM duplicate.terminal_outcome
                AND COALESCE(keeper.transition_rules, '[]'::jsonb)
                    = COALESCE(duplicate.transition_rules, '[]'::jsonb)
                AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.stage_id = duplicate.id)
              RETURNING duplicate.id`,
            [pipelineId],
        );
        repairedDuplicateStages += ownedDuplicates.length;

        // At this point every same-slug pair is identical and has no current
        // deal. Preserve its audit trail by pointing textual UUIDs at the owned
        // keeper before deleting the orphan.
        await query(
            `WITH duplicate_stage_map AS (
                SELECT orphan.id AS duplicate_id, owned.id AS keeper_id
                  FROM pipeline_stages orphan
                  JOIN pipeline_stages owned
                    ON owned.pipeline_id = $1::uuid
                   AND owned.tenant_id = orphan.tenant_id
                   AND owned.slug IS NOT DISTINCT FROM orphan.slug
                 WHERE orphan.pipeline_id IS NULL
                   AND owned.name IS NOT DISTINCT FROM orphan.name
                   AND owned.color IS NOT DISTINCT FROM orphan.color
                   AND owned.position IS NOT DISTINCT FROM orphan.position
                   AND owned.default_probability IS NOT DISTINCT FROM orphan.default_probability
                   AND owned.sla_hours IS NOT DISTINCT FROM orphan.sla_hours
                   AND owned.is_terminal IS NOT DISTINCT FROM orphan.is_terminal
                   AND owned.terminal_outcome IS NOT DISTINCT FROM orphan.terminal_outcome
                   AND COALESCE(owned.transition_rules, '[]'::jsonb)
                       = COALESCE(orphan.transition_rules, '[]'::jsonb)
                   AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.stage_id = orphan.id)
             )
             UPDATE stage_transitions AS history
                SET from_stage = COALESCE(
                        (SELECT map.keeper_id::text
                           FROM duplicate_stage_map map
                          WHERE LOWER(history.from_stage) = map.duplicate_id::text),
                        history.from_stage
                    ),
                    to_stage = COALESCE(
                        (SELECT map.keeper_id::text
                           FROM duplicate_stage_map map
                          WHERE LOWER(history.to_stage) = map.duplicate_id::text),
                        history.to_stage
                    )
              WHERE EXISTS (
                    SELECT 1
                      FROM duplicate_stage_map map
                     WHERE LOWER(history.from_stage) = map.duplicate_id::text
                        OR LOWER(history.to_stage) = map.duplicate_id::text
              )`,
            [pipelineId],
        );
        const deleted = await query<Array<{ id: string }>>(
            `DELETE FROM pipeline_stages orphan
              USING pipeline_stages owned
              WHERE orphan.pipeline_id IS NULL
                AND owned.pipeline_id = $1::uuid
                AND owned.tenant_id = orphan.tenant_id
                AND owned.slug IS NOT DISTINCT FROM orphan.slug
                AND owned.name IS NOT DISTINCT FROM orphan.name
                AND owned.color IS NOT DISTINCT FROM orphan.color
                AND owned.position IS NOT DISTINCT FROM orphan.position
                AND owned.default_probability IS NOT DISTINCT FROM orphan.default_probability
                AND owned.sla_hours IS NOT DISTINCT FROM orphan.sla_hours
                AND owned.is_terminal IS NOT DISTINCT FROM orphan.is_terminal
                AND owned.terminal_outcome IS NOT DISTINCT FROM orphan.terminal_outcome
                AND COALESCE(owned.transition_rules, '[]'::jsonb)
                    = COALESCE(orphan.transition_rules, '[]'::jsonb)
                AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.stage_id = orphan.id)
              RETURNING orphan.id`,
            [pipelineId],
        );
        repairedDuplicateStages += deleted.length;

        await query(
            `WITH ranked AS (
                SELECT id,
                       FIRST_VALUE(id) OVER (
                           PARTITION BY tenant_id, slug ORDER BY id
                       ) AS keeper_id
                  FROM pipeline_stages
                 WHERE pipeline_id IS NULL
             ),
             duplicate_stage_map AS (
                SELECT duplicate.id AS duplicate_id, keeper.id AS keeper_id
                  FROM ranked
                  JOIN pipeline_stages duplicate ON duplicate.id = ranked.id
                  JOIN pipeline_stages keeper ON keeper.id = ranked.keeper_id
                 WHERE ranked.id <> ranked.keeper_id
                   AND keeper.name IS NOT DISTINCT FROM duplicate.name
                   AND keeper.color IS NOT DISTINCT FROM duplicate.color
                   AND keeper.position IS NOT DISTINCT FROM duplicate.position
                   AND keeper.default_probability IS NOT DISTINCT FROM duplicate.default_probability
                   AND keeper.sla_hours IS NOT DISTINCT FROM duplicate.sla_hours
                   AND keeper.is_terminal IS NOT DISTINCT FROM duplicate.is_terminal
                   AND keeper.terminal_outcome IS NOT DISTINCT FROM duplicate.terminal_outcome
                   AND COALESCE(keeper.transition_rules, '[]'::jsonb)
                       = COALESCE(duplicate.transition_rules, '[]'::jsonb)
                   AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.stage_id = duplicate.id)
             )
             UPDATE stage_transitions AS history
                SET from_stage = COALESCE(
                        (SELECT map.keeper_id::text
                           FROM duplicate_stage_map map
                          WHERE LOWER(history.from_stage) = map.duplicate_id::text),
                        history.from_stage
                    ),
                    to_stage = COALESCE(
                        (SELECT map.keeper_id::text
                           FROM duplicate_stage_map map
                          WHERE LOWER(history.to_stage) = map.duplicate_id::text),
                        history.to_stage
                    )
              WHERE EXISTS (
                    SELECT 1
                      FROM duplicate_stage_map map
                     WHERE LOWER(history.from_stage) = map.duplicate_id::text
                        OR LOWER(history.to_stage) = map.duplicate_id::text
              )`,
        );
        const orphanDuplicates = await query<Array<{ id: string }>>(
            `WITH ranked AS (
                SELECT id,
                       FIRST_VALUE(id) OVER (
                           PARTITION BY tenant_id, slug ORDER BY id
                       ) AS keeper_id
                  FROM pipeline_stages
                 WHERE pipeline_id IS NULL
             )
             DELETE FROM pipeline_stages duplicate
              USING ranked, pipeline_stages keeper
              WHERE duplicate.id = ranked.id
                AND keeper.id = ranked.keeper_id
                AND ranked.id <> ranked.keeper_id
                AND keeper.name IS NOT DISTINCT FROM duplicate.name
                AND keeper.color IS NOT DISTINCT FROM duplicate.color
                AND keeper.position IS NOT DISTINCT FROM duplicate.position
                AND keeper.default_probability IS NOT DISTINCT FROM duplicate.default_probability
                AND keeper.sla_hours IS NOT DISTINCT FROM duplicate.sla_hours
                AND keeper.is_terminal IS NOT DISTINCT FROM duplicate.is_terminal
                AND keeper.terminal_outcome IS NOT DISTINCT FROM duplicate.terminal_outcome
                AND COALESCE(keeper.transition_rules, '[]'::jsonb)
                    = COALESCE(duplicate.transition_rules, '[]'::jsonb)
                AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.stage_id = duplicate.id)
              RETURNING duplicate.id`,
        );
        repairedDuplicateStages += orphanDuplicates.length;
    }

    // Adopt only non-conflicting legacy stages.  A same-slug orphan remains
    // visible to the caller as a conflict instead of failing the whole UPDATE
    // with 23505 or silently deleting tenant-authored data.
    await query(
        `UPDATE pipeline_stages orphan
            SET pipeline_id = $1::uuid
          WHERE orphan.pipeline_id IS NULL
            AND NOT EXISTS (
                SELECT 1 FROM pipeline_stages owned
                 WHERE owned.pipeline_id = $1::uuid
                   AND owned.slug IS NOT DISTINCT FROM orphan.slug
            )`,
        [pipelineId],
    );
    // Preserve historical secondary-pipeline ownership. The old blanket
    // fallback assigned every NULL deal to the primary pipeline even when its
    // stage already belonged to another funnel, creating a cross-pipeline
    // mismatch that moveToStage correctly rejected later.
    await query(
        `UPDATE deals d
            SET pipeline_id = stage.pipeline_id
           FROM pipeline_stages stage
          WHERE d.pipeline_id IS NULL
            AND d.stage_id = stage.id
            AND stage.pipeline_id IS NOT NULL`,
    );
    await query(
        `UPDATE deals SET pipeline_id = $1::uuid WHERE pipeline_id IS NULL`,
        [pipelineId],
    );

    return {
        pipelineId,
        repairedDuplicateStages,
    };
}
