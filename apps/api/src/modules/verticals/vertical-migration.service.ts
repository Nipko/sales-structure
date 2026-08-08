import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import {
    resolveVerticalCapabilityManifest,
    type TenantVerticalConfig,
} from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { getVerticalDefinition } from './vertical-definitions';
import { resolveVerticalAgendaSeedContract } from './verticals.service';
import {
    InvalidVerticalSelectionError,
    resolveVerticalSelection,
} from './vertical-identifiers';

export type VerticalMigrationStatus =
    | 'preview'
    | 'approved'
    | 'applying'
    | 'applied'
    | 'rolled_back'
    | 'failed';

export interface VerticalIdentity {
    industry: string;
    subType: string | null;
}

export interface VerticalSeedDiff<T = Record<string, unknown>> {
    add: T[];
    unchanged: T[];
    conflicts: Array<{ key: string; current: Record<string, unknown>; target: T }>;
    preserved: Record<string, unknown>[];
}

export interface VerticalMigrationPreview {
    migrationId: string;
    previewHash: string;
    status: 'preview';
    from: VerticalIdentity;
    to: VerticalIdentity;
    inventory: Record<string, number>;
    diff: {
        pipelineStages: VerticalSeedDiff;
        faqs: VerticalSeedDiff;
        services: VerticalSeedDiff;
    };
    mappingCoverage: Array<{
        objectKind: string;
        rowCount: number;
        status: 'mapped' | 'empty' | 'additive_only' | 'unmapped';
        reason: string;
    }>;
    /** Remains false until every required object kind has a tested adapter. */
    applySupported: boolean;
    warnings: string[];
    expiresAt: string;
}

interface TargetSeedSet {
    pipelineStages: Record<string, unknown>[];
    faqs: Record<string, unknown>[];
    services: Record<string, unknown>[];
}

interface ExistingSeedSet {
    pipelineStages: Record<string, unknown>[];
    faqs: Record<string, unknown>[];
    services: Record<string, unknown>[];
}

interface InsertedRows {
    pipelineStages: Array<{ id: string; fingerprint: string }>;
    faqs: Array<{ id: string; fingerprint: string }>;
    services: Array<{ id: string; fingerprint: string }>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREVIEW_TTL_HOURS = 24;
// No end-to-end vertical object/persona/tool mapping adapter exists yet. This
// explicit compile-time gate prevents a seed-only reseed from becoming a
// general vertical migration by changing a DB payload or controller flag.
const CURRENT_VERTICAL_MIGRATION_ADAPTER: string | null = null;

/**
 * Explicit, auditable vertical migration workflow. Generic tenant updates stay
 * blocked by `vertical_migration_required`; only an exact, non-stale approved
 * preview can enter this service. Seeds are additive and every inserted row is
 * fingerprinted so rollback refuses to delete a tenant customization.
 */
@Injectable()
export class VerticalMigrationService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    async preview(
        tenantId: string,
        targetIndustry: string,
        targetSubType: string | null | undefined,
        requestedBy: string,
    ): Promise<VerticalMigrationPreview> {
        this.uuid(tenantId, 'tenantId');
        this.uuid(requestedBy, 'requestedBy');
        const target = this.resolveTarget(targetIndustry, targetSubType);
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { industry: true, language: true, schemaName: true, settings: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');
        const settings: any = tenant.settings || {};
        const source: VerticalIdentity = {
            industry: tenant.industry,
            subType: settings.verticalConfig?.subType ?? settings.subType ?? null,
        };
        if (source.industry === target.industry && source.subType === target.subType) {
            throw new ConflictException({ error: 'vertical_migration_no_change' });
        }

        const language = this.languageKey(tenant.language);
        const targetSeeds = this.targetSeeds(target, language);
        const existing = await this.readExistingSeeds(tenant.schemaName);
        const inventory = await this.readInventory(tenant.schemaName);
        const diff = this.buildMigrationDiff(existing, targetSeeds);
        const mappingCoverage = this.buildMappingCoverage(inventory, diff);
        const applySupported = CURRENT_VERTICAL_MIGRATION_ADAPTER !== null
            && mappingCoverage.every((entry) => entry.status === 'mapped' || entry.status === 'empty');
        const sourceFingerprint = this.sourceFingerprint(source, existing);
        const expiresAt = new Date(Date.now() + PREVIEW_TTL_HOURS * 3_600_000).toISOString();
        const previewPayload = {
            from: source,
            to: target,
            inventory,
            diff,
            mappingCoverage,
            applySupported,
            targetSeeds,
            sourceFingerprint,
            language,
            expiresAt,
        };
        const previewHash = this.hash(previewPayload);
        const migrationId = randomUUID();

        await this.prisma.executeInTenantSchema(
            tenant.schemaName,
            `INSERT INTO vertical_migrations
                (id, status, from_industry, from_subtype, to_industry, to_subtype,
                 preview_hash, preview_payload, source_fingerprint, requested_by, expires_at)
             VALUES ($1::uuid, 'preview', $2, $3, $4, $5, $6, $7::jsonb, $8, $9::uuid, $10::timestamptz)`,
            [
                migrationId,
                source.industry,
                source.subType,
                target.industry,
                target.subType,
                previewHash,
                JSON.stringify(previewPayload),
                sourceFingerprint,
                requestedBy,
                expiresAt,
            ],
        );

        return {
            migrationId,
            previewHash,
            status: 'preview',
            from: source,
            to: target,
            inventory,
            diff,
            mappingCoverage,
            applySupported,
            warnings: this.previewWarnings(diff, inventory),
            expiresAt,
        };
    }

    async approve(
        tenantId: string,
        migrationId: string,
        previewHash: string,
        approvedBy: string,
    ): Promise<{ migrationId: string; status: 'approved'; approvedAt: string }> {
        const schemaName = await this.schemaForTenant(tenantId);
        this.uuid(migrationId, 'migrationId');
        this.uuid(approvedBy, 'approvedBy');
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const rows: any[] = await query(
                `SELECT id, status, preview_hash, requested_by, expires_at
                 FROM vertical_migrations WHERE id = $1::uuid FOR UPDATE`,
                [migrationId],
            );
            const migration = rows?.[0];
            if (!migration) throw new NotFoundException('Vertical migration preview not found');
            if (migration.status !== 'preview') {
                throw new ConflictException({ error: 'vertical_migration_not_preview' });
            }
            if (migration.preview_hash !== previewHash) {
                throw new ConflictException({ error: 'vertical_migration_preview_hash_mismatch' });
            }
            if (new Date(migration.expires_at).getTime() <= Date.now()) {
                throw new ConflictException({ error: 'vertical_migration_preview_expired' });
            }

            const updated = await query<any[]>(
                `UPDATE vertical_migrations
                 SET status = 'approved', approved_by = $2::uuid,
                     approved_at = NOW(), updated_at = NOW()
                 WHERE id = $1::uuid
                 RETURNING approved_at`,
                [migrationId, approvedBy],
            );
            return {
                migrationId,
                status: 'approved' as const,
                approvedAt: new Date(updated[0].approved_at).toISOString(),
            };
        });
    }

    async apply(
        tenantId: string,
        migrationId: string,
        previewHash: string,
        appliedBy: string,
    ): Promise<{ migrationId: string; status: 'applied'; inserted: Record<string, number> }> {
        this.uuid(appliedBy, 'appliedBy');
        const schemaName = await this.schemaForTenant(tenantId);
        this.uuid(migrationId, 'migrationId');

        const gates: any[] = await this.prisma.executeInTenantSchema(
            schemaName,
            `SELECT status, preview_hash, preview_payload
             FROM vertical_migrations WHERE id = $1::uuid`,
            [migrationId],
        );
        const gate = gates[0];
        if (!gate) throw new NotFoundException('Vertical migration not found');
        if (gate.preview_hash !== previewHash) {
            throw new ConflictException({ error: 'vertical_migration_preview_hash_mismatch' });
        }
        if (
            CURRENT_VERTICAL_MIGRATION_ADAPTER === null
            || gate.preview_payload?.applySupported !== true
            || !Array.isArray(gate.preview_payload?.mappingCoverage)
            || gate.preview_payload.mappingCoverage.some(
                (entry: any) => entry.status !== 'mapped' && entry.status !== 'empty',
            )
        ) {
            throw new ConflictException({
                error: 'vertical_migration_apply_not_supported',
                message: 'The preview is planning-only until every object, persona and tool mapping has a tested adapter.',
                applySupported: false,
                mappingCoverage: gate.preview_payload?.mappingCoverage || [],
            });
        }

        const result = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const rows: any[] = await query(
                `SELECT * FROM vertical_migrations WHERE id = $1::uuid FOR UPDATE`,
                [migrationId],
            );
            const migration = rows?.[0];
            if (!migration) throw new NotFoundException('Vertical migration not found');
            if (migration.status !== 'approved') {
                throw new ConflictException({ error: 'vertical_migration_not_approved' });
            }
            if (migration.preview_hash !== previewHash) {
                throw new ConflictException({ error: 'vertical_migration_preview_hash_mismatch' });
            }
            if (new Date(migration.expires_at).getTime() <= Date.now()) {
                throw new ConflictException({ error: 'vertical_migration_preview_expired' });
            }

            const tenantRows = await query<any[]>(
                `SELECT id, industry, language, settings
                 FROM public.tenants WHERE id = $1::uuid FOR UPDATE`,
                [tenantId],
            );
            const tenant = tenantRows?.[0];
            if (!tenant) throw new NotFoundException('Tenant not found');
            const settings = tenant.settings || {};
            const currentIdentity: VerticalIdentity = {
                industry: tenant.industry,
                subType: settings.verticalConfig?.subType ?? settings.subType ?? null,
            };
            if (
                currentIdentity.industry !== migration.from_industry
                || currentIdentity.subType !== (migration.from_subtype || null)
            ) {
                throw new ConflictException({ error: 'vertical_migration_source_changed' });
            }

            const existing = await this.readExistingSeedsWithQuery(query);
            const currentFingerprint = this.sourceFingerprint(currentIdentity, existing);
            if (currentFingerprint !== migration.source_fingerprint) {
                throw new ConflictException({
                    error: 'vertical_migration_preview_stale',
                    message: 'Managed vertical content changed after preview; generate a new diff.',
                });
            }

            const previewPayload = migration.preview_payload || {};
            const targetSeeds = previewPayload.targetSeeds as TargetSeedSet;
            const archiveId = randomUUID();
            const archive = {
                identity: currentIdentity,
                settings,
                seeds: existing,
                archivedAt: new Date().toISOString(),
            };
            await query(
                `INSERT INTO vertical_migration_archives
                    (id, migration_id, snapshot, created_by)
                 VALUES ($1::uuid, $2::uuid, $3::jsonb, $4::uuid)`,
                [archiveId, migrationId, JSON.stringify(archive), appliedBy],
            );
            await query(
                `UPDATE vertical_migrations
                 SET status = 'applying', archive_id = $2::uuid, updated_at = NOW()
                 WHERE id = $1::uuid`,
                [migrationId, archiveId],
            );

            const inserted = await this.insertAdditiveSeeds(
                query,
                tenantId,
                targetSeeds,
                previewPayload.diff,
            );
            const target: VerticalIdentity = {
                industry: migration.to_industry,
                subType: migration.to_subtype || null,
            };
            const nextSettings = {
                ...settings,
                subType: target.subType,
                verticalConfig: this.targetConfig(target),
            };
            await query(
                `UPDATE public.tenants
                 SET industry = $2, settings = $3::jsonb, updated_at = NOW()
                 WHERE id = $1::uuid`,
                [tenantId, target.industry, JSON.stringify(nextSettings)],
            );
            await query(
                `UPDATE vertical_migrations
                 SET status = 'applied', inserted_rows = $2::jsonb,
                     applied_by = $3::uuid, applied_at = NOW(), updated_at = NOW()
                 WHERE id = $1::uuid`,
                [migrationId, JSON.stringify(inserted), appliedBy],
            );
            await query(
                `INSERT INTO vertical_migration_outbox
                    (id, migration_id, event_type, idempotency_key, payload)
                 VALUES ($1::uuid, $2::uuid, 'vertical.migrated', $3, $4::jsonb)
                 ON CONFLICT (idempotency_key) DO NOTHING`,
                [
                    randomUUID(),
                    migrationId,
                    `vertical-migration:${migrationId}:applied`,
                    JSON.stringify({ tenantId, migrationId, from: currentIdentity, to: target }),
                ],
            );
            return inserted;
        });

        await this.invalidateTenantCache(tenantId);
        return {
            migrationId,
            status: 'applied',
            inserted: {
                pipelineStages: result.pipelineStages.length,
                faqs: result.faqs.length,
                services: result.services.length,
            },
        };
    }

    async rollback(
        tenantId: string,
        migrationId: string,
        rolledBackBy: string,
    ): Promise<{ migrationId: string; status: 'rolled_back' }> {
        this.uuid(rolledBackBy, 'rolledBackBy');
        const schemaName = await this.schemaForTenant(tenantId);
        this.uuid(migrationId, 'migrationId');

        await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const rows: any[] = await query(
                `SELECT m.*, a.snapshot
                 FROM vertical_migrations m
                 JOIN vertical_migration_archives a ON a.id = m.archive_id
                 WHERE m.id = $1::uuid
                 FOR UPDATE OF m, a`,
                [migrationId],
            );
            const migration = rows?.[0];
            if (!migration) throw new NotFoundException('Applied vertical migration not found');
            if (migration.status !== 'applied') {
                throw new ConflictException({ error: 'vertical_migration_not_applied' });
            }

            const inserted = (migration.inserted_rows || {}) as InsertedRows;
            await this.assertInsertedRowsUntouched(query, inserted);
            await this.deleteInsertedRows(query, inserted);

            const snapshot = migration.snapshot || {};
            if (!snapshot.identity?.industry || !snapshot.settings) {
                throw new ConflictException({ error: 'vertical_migration_archive_invalid' });
            }
            await query(
                `UPDATE public.tenants
                 SET industry = $2, settings = $3::jsonb, updated_at = NOW()
                 WHERE id = $1::uuid`,
                [tenantId, snapshot.identity.industry, JSON.stringify(snapshot.settings)],
            );
            await query(
                `UPDATE vertical_migrations
                 SET status = 'rolled_back', rolled_back_by = $2::uuid,
                     rolled_back_at = NOW(), updated_at = NOW()
                 WHERE id = $1::uuid`,
                [migrationId, rolledBackBy],
            );
            await query(
                `INSERT INTO vertical_migration_outbox
                    (id, migration_id, event_type, idempotency_key, payload)
                 VALUES ($1::uuid, $2::uuid, 'vertical.migration_rolled_back', $3, $4::jsonb)
                 ON CONFLICT (idempotency_key) DO NOTHING`,
                [
                    randomUUID(),
                    migrationId,
                    `vertical-migration:${migrationId}:rolled-back`,
                    JSON.stringify({ tenantId, migrationId, restored: snapshot.identity }),
                ],
            );
        });

        await this.invalidateTenantCache(tenantId);
        return { migrationId, status: 'rolled_back' };
    }

    buildMigrationDiff(existing: ExistingSeedSet, target: TargetSeedSet): VerticalMigrationPreview['diff'] {
        return {
            pipelineStages: this.diffByKey(existing.pipelineStages, target.pipelineStages, 'slug'),
            faqs: this.diffByKey(existing.faqs, target.faqs, 'question'),
            services: this.diffByKey(existing.services, target.services, 'name'),
        };
    }

    private diffByKey(
        existing: Record<string, unknown>[],
        target: Record<string, unknown>[],
        keyField: string,
    ): VerticalSeedDiff {
        const currentByKey = new Map(existing.map((row) => [String(row[keyField]), row]));
        const targetKeys = new Set(target.map((row) => String(row[keyField])));
        const diff: VerticalSeedDiff = { add: [], unchanged: [], conflicts: [], preserved: [] };
        for (const row of target) {
            const key = String(row[keyField]);
            const current = currentByKey.get(key);
            if (!current) diff.add.push(row);
            else if (this.hash(this.comparable(current, keyField)) === this.hash(this.comparable(row, keyField))) {
                diff.unchanged.push(row);
            } else diff.conflicts.push({ key, current, target: row });
        }
        diff.preserved = existing.filter((row) => !targetKeys.has(String(row[keyField])));
        return diff;
    }

    private async readExistingSeeds(schemaName: string): Promise<ExistingSeedSet> {
        return this.prisma.transactionInTenantSchema(schemaName, (query) => this.readExistingSeedsWithQuery(query));
    }

    private async readExistingSeedsWithQuery(query: any): Promise<ExistingSeedSet> {
        const [pipelineStages, faqs, services] = await Promise.all([
            query(
                `SELECT id, slug, name, color, position, default_probability AS probability,
                        sla_hours, is_terminal, terminal_outcome, transition_rules
                 FROM pipeline_stages WHERE pipeline_id IS NULL ORDER BY position, id`,
            ),
            query(
                `SELECT id, question, answer, category, is_published
                 FROM faqs ORDER BY question, id`,
            ),
            query(
                `SELECT id, name, description, duration_minutes, price::text AS price,
                        currency, category, duration_type, is_active, sort_order
                 FROM services ORDER BY name, id`,
            ),
        ]);
        return {
            pipelineStages: (pipelineStages || []).map((row: any) => this.normalizeStageRow(row)),
            faqs: (faqs || []).map((row: any) => this.normalizeFaqRow(row)),
            services: (services || []).map((row: any) => this.normalizeServiceRow(row)),
        };
    }

    private async readInventory(schemaName: string): Promise<Record<string, number>> {
        const rows: any[] = await this.prisma.executeInTenantSchema(
            schemaName,
            `SELECT
                (SELECT COUNT(*)::int FROM contacts) AS contacts,
                (SELECT COUNT(*)::int FROM leads) AS leads,
                (SELECT COUNT(*)::int FROM opportunities) AS opportunities,
                (SELECT COUNT(*)::int FROM conversations) AS conversations,
                (SELECT COUNT(*)::int FROM appointments) AS appointments,
                (SELECT COUNT(*)::int FROM services) AS services,
                (SELECT COUNT(*)::int FROM faqs) AS faqs,
                (SELECT COUNT(*)::int FROM pipeline_stages) AS pipeline_stages,
                (SELECT COUNT(*)::int FROM agent_personas) AS agents`,
        );
        const row = rows[0] || {};
        return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value || 0)]));
    }

    private targetSeeds(identity: VerticalIdentity, language: string): TargetSeedSet {
        const definition = getVerticalDefinition(identity.industry);
        const agenda = resolveVerticalAgendaSeedContract(definition, identity.subType);
        return {
            pipelineStages: definition.pipeline.stages.map((stage, position) => ({
                slug: stage.slug,
                name: stage.name[language] || stage.name.es || stage.slug,
                color: stage.color,
                position,
                probability: stage.probability,
                slaHours: stage.slaHours || null,
                isTerminal: stage.isTerminal,
                terminalOutcome: stage.isTerminal ? stage.terminalOutcome : null,
                transitionRules: (stage as any).transitionRules || [],
            })),
            faqs: definition.faqs.map((faq) => ({
                question: faq.question[language] || faq.question.es,
                answer: faq.answer[language] || faq.answer.es,
                category: faq.category,
                isPublished: true,
            })),
            services: agenda.agendaAllowed
                ? agenda.services.map((service, sortOrder) => ({
                    name: service.name[language] || service.name.es,
                    description: service.description[language] || service.description.es,
                    durationMinutes: service.durationMinutes,
                    price: String(service.price),
                    currency: service.currency,
                    category: service.category,
                    durationType: service.durationType || 'fixed',
                    isActive: true,
                    sortOrder,
                }))
                : [],
        };
    }

    private async insertAdditiveSeeds(
        query: any,
        tenantId: string,
        targetSeeds: TargetSeedSet,
        diff: VerticalMigrationPreview['diff'],
    ): Promise<InsertedRows> {
        const inserted: InsertedRows = { pipelineStages: [], faqs: [], services: [] };
        const allowedStages = new Set(diff.pipelineStages.add.map((row: any) => row.slug));
        for (const stage of targetSeeds.pipelineStages.filter((row: any) => allowedStages.has(row.slug))) {
            const rows: any[] = await query(
                `INSERT INTO pipeline_stages
                    (tenant_id, name, slug, color, position, default_probability,
                     sla_hours, is_terminal, terminal_outcome, transition_rules)
                 VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
                 ON CONFLICT (pipeline_id, slug) DO NOTHING
                 RETURNING id`,
                [tenantId, stage.name, stage.slug, stage.color, stage.position,
                    stage.probability, stage.slaHours, stage.isTerminal,
                    stage.terminalOutcome, JSON.stringify(stage.transitionRules)],
            );
            if (rows?.[0]) inserted.pipelineStages.push({ id: rows[0].id, fingerprint: this.hash(stage) });
        }
        const allowedFaqs = new Set(diff.faqs.add.map((row: any) => row.question));
        for (const faq of targetSeeds.faqs.filter((row: any) => allowedFaqs.has(row.question))) {
            const rows: any[] = await query(
                `INSERT INTO faqs (question, answer, category, is_published, search_tsv)
                 VALUES ($1, $2, $3, true, to_tsvector('simple', $1 || ' ' || $2))
                 ON CONFLICT (question) DO NOTHING RETURNING id`,
                [faq.question, faq.answer, faq.category],
            );
            if (rows?.[0]) inserted.faqs.push({ id: rows[0].id, fingerprint: this.hash(faq) });
        }
        const allowedServices = new Set(diff.services.add.map((row: any) => row.name));
        for (const service of targetSeeds.services.filter((row: any) => allowedServices.has(row.name))) {
            const rows: any[] = await query(
                `INSERT INTO services
                    (name, description, duration_minutes, price, currency, category,
                     is_active, sort_order, duration_type)
                 VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)
                 ON CONFLICT (name) DO NOTHING RETURNING id`,
                [service.name, service.description, service.durationMinutes, service.price,
                    service.currency, service.category, service.sortOrder, service.durationType],
            );
            if (rows?.[0]) inserted.services.push({ id: rows[0].id, fingerprint: this.hash(service) });
        }
        return inserted;
    }

    private async assertInsertedRowsUntouched(query: any, inserted: InsertedRows): Promise<void> {
        const checks = [
            {
                kind: 'pipelineStages',
                table: 'pipeline_stages',
                rows: inserted.pipelineStages || [],
                sql: `SELECT id, slug, name, color, position, default_probability AS probability,
                             sla_hours, is_terminal, terminal_outcome, transition_rules
                      FROM pipeline_stages WHERE id = ANY($1::uuid[])`,
                normalize: (row: any) => this.withoutId(this.normalizeStageRow(row)),
            },
            {
                kind: 'faqs', table: 'faqs', rows: inserted.faqs || [],
                sql: `SELECT id, question, answer, category, is_published
                      FROM faqs WHERE id = ANY($1::uuid[])`,
                normalize: (row: any) => this.withoutId(this.normalizeFaqRow(row)),
            },
            {
                kind: 'services', table: 'services', rows: inserted.services || [],
                sql: `SELECT id, name, description, duration_minutes, price::text AS price,
                             currency, category, duration_type, is_active, sort_order
                      FROM services WHERE id = ANY($1::uuid[])`,
                normalize: (row: any) => this.withoutId(this.normalizeServiceRow(row)),
            },
        ];
        for (const check of checks) {
            if (!check.rows.length) continue;
            const current: any[] = await query(check.sql, [check.rows.map((row) => row.id)]);
            if (current.length !== check.rows.length) {
                throw new ConflictException({ error: 'vertical_rollback_rows_missing', kind: check.kind });
            }
            const expected = new Map(check.rows.map((row) => [row.id, row.fingerprint]));
            for (const row of current) {
                if (this.hash(check.normalize(row)) !== expected.get(row.id)) {
                    throw new ConflictException({
                        error: 'vertical_rollback_customization_conflict',
                        kind: check.kind,
                        rowId: row.id,
                    });
                }
            }
        }
    }

    private async deleteInsertedRows(query: any, inserted: InsertedRows): Promise<void> {
        // Child/business references make DELETE fail and roll the whole transaction
        // back, which is safer than orphaning a tenant customization.
        for (const [table, rows] of [
            ['pipeline_stages', inserted.pipelineStages || []],
            ['faqs', inserted.faqs || []],
            ['services', inserted.services || []],
        ] as const) {
            if (rows.length) await query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [rows.map((row) => row.id)]);
        }
    }

    private targetConfig(identity: VerticalIdentity): TenantVerticalConfig {
        const definition = getVerticalDefinition(identity.industry);
        const manifest = resolveVerticalCapabilityManifest(identity.industry, identity.subType);
        const bookingEnabled = definition.bookingEnabled
            && manifest.capabilities.includes('appointment_booking');
        return {
            industry: identity.industry,
            subType: identity.subType,
            terminology: definition.terminology,
            sidebar: definition.sidebar,
            dashboard: definition.dashboard,
            bookingEnabled,
            manifestVersion: manifest.manifestVersion,
            effectiveCapabilities: manifest.capabilities.filter(
                (capability) => capability !== 'appointment_booking' || bookingEnabled,
            ),
        };
    }

    private sourceFingerprint(identity: VerticalIdentity, existing: ExistingSeedSet): string {
        return this.hash({ identity, existing });
    }

    private resolveTarget(industry: string, subType: string | null | undefined): VerticalIdentity {
        try {
            const resolved = resolveVerticalSelection(industry, subType);
            return { industry: resolved.industry, subType: resolved.subType };
        } catch (error) {
            if (error instanceof InvalidVerticalSelectionError) {
                throw new BadRequestException({
                    error: 'invalid_vertical_selection',
                    message: error.message,
                    industry: error.industry,
                    subType: error.subType,
                });
            }
            throw error;
        }
    }

    private normalizeStageRow(row: any): Record<string, unknown> {
        return {
            ...(row.id ? { id: row.id } : {}),
            slug: row.slug,
            name: row.name,
            color: row.color,
            position: Number(row.position),
            probability: Number(row.probability),
            slaHours: row.sla_hours == null ? null : Number(row.sla_hours),
            isTerminal: Boolean(row.is_terminal),
            terminalOutcome: row.terminal_outcome || null,
            transitionRules: row.transition_rules || [],
        };
    }

    private normalizeFaqRow(row: any): Record<string, unknown> {
        return {
            ...(row.id ? { id: row.id } : {}),
            question: row.question,
            answer: row.answer,
            category: row.category,
            isPublished: Boolean(row.is_published),
        };
    }

    private normalizeServiceRow(row: any): Record<string, unknown> {
        return {
            ...(row.id ? { id: row.id } : {}),
            name: row.name,
            description: row.description,
            durationMinutes: Number(row.duration_minutes),
            price: String(row.price),
            currency: row.currency,
            category: row.category,
            durationType: row.duration_type || 'fixed',
            isActive: Boolean(row.is_active),
            sortOrder: Number(row.sort_order),
        };
    }

    private comparable(row: Record<string, unknown>, _keyField: string): Record<string, unknown> {
        return this.withoutId(row);
    }

    private withoutId(row: Record<string, unknown>): Record<string, unknown> {
        const { id: _id, ...rest } = row;
        return rest;
    }

    private buildMappingCoverage(
        inventory: Record<string, number>,
        diff: VerticalMigrationPreview['diff'],
    ): VerticalMigrationPreview['mappingCoverage'] {
        const entry = (
            objectKind: string,
            rowCount: number,
            status: 'mapped' | 'empty' | 'additive_only' | 'unmapped',
            reason: string,
        ) => ({ objectKind, rowCount, status, reason });
        const dataKind = (objectKind: string, inventoryKey: string) => {
            const count = inventory[inventoryKey] || 0;
            return entry(
                objectKind,
                count,
                count === 0 ? 'empty' : 'unmapped',
                count === 0
                    ? 'No source rows were present at preview time.'
                    : 'No versioned source-to-target mapping adapter exists.',
            );
        };
        return [
            entry('tenant_identity', 1, 'mapped', 'Canonical identifiers and capability manifest resolve strictly.'),
            entry(
                'pipeline_stages',
                inventory.pipeline_stages || 0,
                'additive_only',
                `${diff.pipelineStages.add.length} target stages could be added, but existing opportunity-stage mappings are not defined.`,
            ),
            entry(
                'faqs',
                inventory.faqs || 0,
                'additive_only',
                'Natural-key diff preserves custom FAQs; this is not a domain migration.',
            ),
            entry(
                'services',
                inventory.services || 0,
                'additive_only',
                'Natural-key diff preserves custom services; temporal/resource mappings remain undefined.',
            ),
            dataKind('contacts', 'contacts'),
            dataKind('leads', 'leads'),
            dataKind('opportunities', 'opportunities'),
            dataKind('conversations', 'conversations'),
            dataKind('appointments', 'appointments'),
            dataKind('agent_personas_and_tools', 'agents'),
            entry(
                'vertical_operational_objects',
                -1,
                'unmapped',
                'Orders, bookings, properties, inventory and vertical-specific objects require per-kind inventory and adapters.',
            ),
        ];
    }

    private previewWarnings(diff: VerticalMigrationPreview['diff'], inventory: Record<string, number>): string[] {
        const warnings: string[] = [
            'Planning only: apply is fail-closed until every object, persona and tool mapping has a tested adapter.',
        ];
        const conflicts = diff.pipelineStages.conflicts.length + diff.faqs.conflicts.length + diff.services.conflicts.length;
        if (conflicts) warnings.push(`${conflicts} customized rows conflict with target defaults and will be preserved.`);
        const preserved = diff.pipelineStages.preserved.length + diff.faqs.preserved.length + diff.services.preserved.length;
        if (preserved) warnings.push(`${preserved} existing rows are not target seeds and will be preserved.`);
        if ((inventory.appointments || 0) > 0) warnings.push('Existing appointments remain unchanged and require operational review.');
        if ((inventory.opportunities || 0) > 0) warnings.push('Existing opportunities keep their current stages; target stages are additive.');
        return warnings;
    }

    private languageKey(language: string): string {
        const key = String(language || 'es').slice(0, 2).toLowerCase();
        return ['es', 'en', 'pt', 'fr'].includes(key) ? key : 'es';
    }

    private hash(value: unknown): string {
        return createHash('sha256').update(this.stableStringify(value)).digest('hex');
    }

    private stableStringify(value: unknown): string {
        if (Array.isArray(value)) return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
        if (value && typeof value === 'object') {
            return `{${Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, item]) => `${JSON.stringify(key)}:${this.stableStringify(item)}`)
                .join(',')}}`;
        }
        return JSON.stringify(value);
    }

    private async schemaForTenant(tenantId: string): Promise<string> {
        this.uuid(tenantId, 'tenantId');
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { schemaName: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');
        return tenant.schemaName;
    }

    private async invalidateTenantCache(tenantId: string): Promise<void> {
        await Promise.all([
            this.redis.del(`vertical:${tenantId}`),
            this.redis.del(`tenant:${tenantId}:schema`),
        ]);
    }

    private uuid(value: string, field: string): string {
        if (!UUID_PATTERN.test(value || '')) throw new BadRequestException(`${field} must be a UUID`);
        return value.toLowerCase();
    }
}
