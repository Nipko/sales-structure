import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ExternalCrmService } from './external-crm.service';
import { CrmAdapterFactory } from './crm-adapter.factory';
import { normalizePhoneE164 } from '../../common/utils/phone.util';
import type { CanonicalContact } from './types/crm.types';

export const CRM_IMPORT_QUEUE = 'crm-import';

export interface CrmImportJob {
    tenantId: string;
    importId: string;
    connectionId: string;
    provider: string;
}

export interface ImportPreview {
    sample: Array<CanonicalContact & { matchInternalId?: string | null }>;
    estimatedTotal: number | null;
    matchCount: number;
    newCount: number;
    invalidCount: number;
}

@Injectable()
export class CrmImportService {
    private readonly logger = new Logger(CrmImportService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly external: ExternalCrmService,
        private readonly factory: CrmAdapterFactory,
        @InjectQueue(CRM_IMPORT_QUEUE) private readonly queue: Queue<CrmImportJob>,
    ) {}

    /**
     * Pulls the first page (~100) from the remote CRM without persisting.
     * Used by the dashboard to show a preview table before the user commits
     * to the full import.
     */
    async preview(tenantId: string, connectionId: string): Promise<ImportPreview> {
        const ctx = await this.external.buildContext(tenantId, connectionId);
        const adapter = this.factory.get(ctx.metadata.provider);
        if (!adapter.pullContacts) {
            throw new BadRequestException(`Provider ${ctx.metadata.provider} does not support import`);
        }
        const page = await adapter.pullContacts(ctx);
        const enriched = await this.classify(tenantId, page.items);
        return {
            sample: enriched.items,
            estimatedTotal: page.total ?? null,
            matchCount: enriched.matchCount,
            newCount: enriched.newCount,
            invalidCount: enriched.invalidCount,
        };
    }

    /**
     * Creates an `crm_imports` row and enqueues a job that pages through
     * all contacts. Idempotent — if there is already a running import for
     * the same connection, returns it instead of starting another.
     */
    async start(tenantId: string, connectionId: string, startedBy: string): Promise<{ importId: string; status: string }> {
        const conn = await this.prisma.crmConnection.findFirst({ where: { id: connectionId, tenantId } });
        if (!conn) throw new NotFoundException('Connection not found');
        if (conn.status !== 'active') throw new BadRequestException(`Connection is ${conn.status}`);

        const schema = await this.tenantSchema(tenantId);

        // Reuse an in-flight import for the same connection.
        const existing = (await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT id, status FROM crm_imports
             WHERE connection_id = $1::uuid AND status IN ('pending', 'running')
             ORDER BY started_at DESC LIMIT 1`,
            [connectionId],
        )) as any[];
        if (existing.length > 0) {
            return { importId: existing[0].id, status: existing[0].status };
        }

        const insert = (await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `INSERT INTO crm_imports (provider, connection_id, entity, status, started_by)
             VALUES ($1, $2::uuid, 'contact', 'pending', $3::uuid) RETURNING id`,
            [conn.provider, connectionId, startedBy],
        )) as any[];
        const importId = insert[0].id;

        await this.queue.add(
            `${conn.provider}:import:${importId}`,
            { tenantId, importId, connectionId, provider: conn.provider },
            { attempts: 1, removeOnComplete: 50, removeOnFail: 100 },
        );

        return { importId, status: 'pending' };
    }

    async getStatus(tenantId: string, importId: string) {
        const schema = await this.tenantSchema(tenantId);
        const rows = (await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT * FROM crm_imports WHERE id = $1::uuid LIMIT 1`,
            [importId],
        )) as any[];
        if (rows.length === 0) throw new NotFoundException('Import not found');
        return rows[0];
    }

    async listImports(tenantId: string, connectionId?: string) {
        const schema = await this.tenantSchema(tenantId);
        if (connectionId) {
            return this.prisma.executeInTenantSchema(
                schema,
                `SELECT id, provider, status, total_pulled, matched, created, skipped, errors,
                        started_at, completed_at, last_error
                 FROM crm_imports WHERE connection_id = $1::uuid
                 ORDER BY started_at DESC LIMIT 20`,
                [connectionId],
            );
        }
        return this.prisma.executeInTenantSchema(
            schema,
            `SELECT id, provider, connection_id, status, total_pulled, matched, created, skipped, errors,
                    started_at, completed_at
             FROM crm_imports ORDER BY started_at DESC LIMIT 20`,
        );
    }

    /**
     * Processor entrypoint. Pages through the CRM, normalizing phones and
     * deduping against existing contacts. Updates progress on every page.
     */
    async runImport(job: CrmImportJob) {
        const schema = await this.tenantSchema(job.tenantId);
        const ctx = await this.external.buildContext(job.tenantId, job.connectionId);
        const adapter = this.factory.get(job.provider);
        if (!adapter.pullContacts) {
            await this.markFailed(schema, job.importId, `Provider ${job.provider} does not support import`);
            return;
        }

        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE crm_imports SET status = 'running', updated_at = NOW() WHERE id = $1::uuid`,
            [job.importId],
        );

        let cursor: string | null | undefined = undefined;
        let totalPulled = 0;
        let matched = 0;
        let created = 0;
        let skipped = 0;
        let errors = 0;
        const SAFETY_PAGE_LIMIT = 200;          // ~20k contacts at 100/page

        try {
            for (let i = 0; i < SAFETY_PAGE_LIMIT; i++) {
                const page = await adapter.pullContacts(ctx, cursor ?? undefined);
                if (page.items.length === 0) break;
                totalPulled += page.items.length;

                for (const c of page.items) {
                    try {
                        const result = await this.upsertImported(schema, job.provider, c);
                        if (result === 'matched') matched++;
                        else if (result === 'created') created++;
                        else skipped++;
                    } catch (e: any) {
                        errors++;
                        this.logger.warn(`Import row failed: ${e.message}`);
                    }
                }

                cursor = page.nextCursor ?? null;
                await this.prisma.executeInTenantSchema(
                    schema,
                    `UPDATE crm_imports
                     SET cursor = $1, total_pulled = $2, matched = $3, created = $4,
                         skipped = $5, errors = $6, updated_at = NOW()
                     WHERE id = $7::uuid`,
                    [cursor, totalPulled, matched, created, skipped, errors, job.importId],
                );

                if (!cursor) break;
            }

            await this.prisma.executeInTenantSchema(
                schema,
                `UPDATE crm_imports SET status = 'completed', completed_at = NOW(), updated_at = NOW()
                 WHERE id = $1::uuid`,
                [job.importId],
            );
            this.logger.log(
                `Import ${job.importId} completed: ${created} created, ${matched} matched, ${skipped} skipped, ${errors} errors`,
            );
        } catch (e: any) {
            await this.markFailed(schema, job.importId, e.message);
            throw e;
        }
    }

    // ─── Internals ──────────────────────────────────────────────────────────

    /**
     * Upsert with dedup logic:
     *  - If phone or email matches an existing contact → link the external id and skip insert.
     *  - Else → INSERT new contact + crm_external_links row.
     *  - If neither phone nor email is present → skipped (logged but not an error).
     */
    private async upsertImported(
        schema: string,
        provider: string,
        c: CanonicalContact,
    ): Promise<'matched' | 'created' | 'skipped'> {
        const phoneE164 = c.phoneE164 ? normalizePhoneE164(c.phoneE164) : null;
        const email = c.email?.trim().toLowerCase() || null;
        if (!phoneE164 && !email) return 'skipped';

        // Dedup: try to find an existing contact by phone or email.
        const existing = (await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT id FROM contacts
             WHERE ($1::text IS NOT NULL AND phone_e164 = $1)
                OR ($2::text IS NOT NULL AND email = $2)
             ORDER BY created_at ASC LIMIT 1`,
            [phoneE164, email],
        )) as any[];

        if (existing.length > 0) {
            await this.linkExternal(schema, provider, existing[0].id, c.id);
            return 'matched';
        }

        // No match — insert a new contact. The contacts table schema varies
        // slightly across deploys, so use a permissive INSERT and let unknown
        // columns surface as errors at the catch site (counts will reflect).
        const inserted = (await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `INSERT INTO contacts (first_name, last_name, email, phone_e164, source, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
             RETURNING id`,
            [c.firstName ?? null, c.lastName ?? null, email, phoneE164, provider],
        )) as any[];

        await this.linkExternal(schema, provider, inserted[0].id, c.id);
        return 'created';
    }

    private async linkExternal(schema: string, provider: string, internalId: string, externalId: string) {
        await this.prisma.executeInTenantSchema(
            schema,
            `INSERT INTO crm_external_links (provider, entity, internal_id, external_id, last_synced_at)
             VALUES ($1, 'contact', $2::uuid, $3, NOW())
             ON CONFLICT (provider, entity, internal_id)
             DO UPDATE SET external_id = EXCLUDED.external_id, last_synced_at = NOW(), updated_at = NOW()`,
            [provider, internalId, externalId],
        );
    }

    private async classify(tenantId: string, items: CanonicalContact[]) {
        const schema = await this.tenantSchema(tenantId);
        let matchCount = 0;
        let newCount = 0;
        let invalidCount = 0;
        const enriched: Array<CanonicalContact & { matchInternalId?: string | null }> = [];

        for (const c of items) {
            const phoneE164 = c.phoneE164 ? normalizePhoneE164(c.phoneE164) : null;
            const email = c.email?.trim().toLowerCase() || null;
            if (!phoneE164 && !email) {
                invalidCount++;
                enriched.push({ ...c, matchInternalId: null });
                continue;
            }
            const existing = (await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT id FROM contacts
                 WHERE ($1::text IS NOT NULL AND phone_e164 = $1)
                    OR ($2::text IS NOT NULL AND email = $2)
                 LIMIT 1`,
                [phoneE164, email],
            )) as any[];
            if (existing.length > 0) {
                matchCount++;
                enriched.push({ ...c, phoneE164: phoneE164 ?? undefined, email: email ?? undefined, matchInternalId: existing[0].id });
            } else {
                newCount++;
                enriched.push({ ...c, phoneE164: phoneE164 ?? undefined, email: email ?? undefined, matchInternalId: null });
            }
        }
        return { items: enriched, matchCount, newCount, invalidCount };
    }

    private async markFailed(schema: string, importId: string, msg: string) {
        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE crm_imports SET status = 'failed', last_error = $1, completed_at = NOW(), updated_at = NOW()
             WHERE id = $2::uuid`,
            [msg.slice(0, 500), importId],
        );
    }

    private async tenantSchema(tenantId: string): Promise<string> {
        const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { schemaName: true } });
        if (!t) throw new NotFoundException('Tenant not found');
        return t.schemaName;
    }
}
