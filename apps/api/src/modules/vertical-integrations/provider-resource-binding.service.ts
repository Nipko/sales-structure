import { BadRequestException, Injectable } from '@nestjs/common';
import {
    PROVIDER_RESOURCE_BINDING_VERSION,
    conservativeProviderBindingFallback,
    type ProviderBindingResolutionV1,
    type ProviderResourceBindingV1,
} from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface UpsertProviderResourceBindingInput {
    provider: string;
    connectionId: string;
    resourceType: string;
    resourceId: string;
    externalId: string;
    scopeType?: string | null;
    scopeId?: string | null;
}

@Injectable()
export class ProviderResourceBindingService {
    constructor(private readonly prisma: PrismaService) {}

    private text(value: unknown, field: string, max = 255): string {
        const normalized = String(value || '').trim();
        if (!normalized || normalized.length > max || !/^[A-Za-z0-9._:@/+-]+$/.test(normalized)) {
            throw new BadRequestException({ error: 'invalid_provider_binding_field', field });
        }
        return normalized;
    }

    private async schema(tenantId: string): Promise<string> {
        return this.prisma.getTenantSchemaName(tenantId);
    }

    private uuid(value: unknown, field: string): string {
        const normalized = String(value || '').trim();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
            throw new BadRequestException({ error: 'invalid_provider_binding_field', field });
        }
        return normalized;
    }

    private map(row: any): ProviderResourceBindingV1 {
        return {
            version: PROVIDER_RESOURCE_BINDING_VERSION,
            id: String(row.id),
            tenantId: String(row.tenant_id),
            provider: row.provider,
            connectionId: row.connection_id,
            resourceType: row.resource_type,
            resourceId: row.resource_id,
            externalId: row.external_id,
            scopeType: row.scope_type || null,
            scopeId: row.scope_id || null,
            state: row.state,
            generation: Number(row.generation),
            conflictReason: row.conflict_reason || null,
            createdAt: new Date(row.created_at).toISOString(),
            updatedAt: new Date(row.updated_at).toISOString(),
            tombstonedAt: row.tombstoned_at ? new Date(row.tombstoned_at).toISOString() : null,
        };
    }

    async list(tenantId: string, provider?: string): Promise<ProviderResourceBindingV1[]> {
        const schema = await this.schema(tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT * FROM integration_resource_bindings
             WHERE ($1::text IS NULL OR provider = $1)
             ORDER BY state = 'conflict' DESC, updated_at DESC`,
            [provider || null],
        );
        return rows.map((row) => this.map(row));
    }

    async upsert(tenantId: string, input: UpsertProviderResourceBindingInput): Promise<ProviderResourceBindingV1> {
        const schema = await this.schema(tenantId);
        const provider = this.text(input.provider, 'provider', 64).toLowerCase();
        const connectionId = this.text(input.connectionId, 'connectionId');
        const resourceType = this.text(input.resourceType, 'resourceType', 64).toLowerCase();
        const resourceId = this.text(input.resourceId, 'resourceId');
        const externalId = this.text(input.externalId, 'externalId');
        const scopeType = input.scopeType ? this.text(input.scopeType, 'scopeType', 64).toLowerCase() : null;
        const scopeId = input.scopeId ? this.text(input.scopeId, 'scopeId') : null;

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `INSERT INTO integration_resource_bindings (
                tenant_id, provider, connection_id, resource_type, resource_id,
                external_id, scope_type, scope_id, state, generation,
                conflict_reason, created_at, updated_at, tombstoned_at
             ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, 'active', 1, NULL, NOW(), NOW(), NULL)
             ON CONFLICT (provider, connection_id, resource_type, resource_id)
                WHERE state <> 'tombstoned'
             DO UPDATE SET
                external_id = EXCLUDED.external_id,
                scope_type = EXCLUDED.scope_type,
                scope_id = EXCLUDED.scope_id,
                state = 'active',
                conflict_reason = NULL,
                generation = integration_resource_bindings.generation + 1,
                updated_at = NOW(),
                tombstoned_at = NULL
             RETURNING *`,
            [tenantId, provider, connectionId, resourceType, resourceId, externalId, scopeType, scopeId],
        );
        await this.reconcileConflicts(schema, provider, connectionId, resourceType);
        const refreshed = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT * FROM integration_resource_bindings WHERE id = $1::uuid`,
            [rows[0].id],
        );
        return this.map(refreshed[0]);
    }

    async tombstone(tenantId: string, bindingId: string): Promise<void> {
        const schema = await this.schema(tenantId);
        const normalizedBindingId = this.uuid(bindingId, 'bindingId');
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `UPDATE integration_resource_bindings
             SET state = 'tombstoned', generation = generation + 1,
                 tombstoned_at = NOW(), updated_at = NOW(), conflict_reason = NULL
             WHERE id = $1::uuid AND tenant_id = $2::uuid
             RETURNING provider, connection_id, resource_type`,
            [normalizedBindingId, tenantId],
        );
        if (rows[0]) await this.reconcileConflicts(schema, rows[0].provider, rows[0].connection_id, rows[0].resource_type);
    }

    async tombstoneProvider(tenantId: string, provider: string): Promise<number> {
        const schema = await this.schema(tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `UPDATE integration_resource_bindings
             SET state = 'tombstoned', generation = generation + 1,
                 tombstoned_at = NOW(), updated_at = NOW(), conflict_reason = NULL
             WHERE tenant_id = $1::uuid AND provider = $2 AND state <> 'tombstoned'
             RETURNING id`,
            [tenantId, provider],
        );
        return rows.length;
    }

    async resolve(tenantId: string, input: {
        provider: string;
        connectionId: string;
        resourceType: string;
        resourceId: string;
    }): Promise<ProviderBindingResolutionV1> {
        const schema = await this.schema(tenantId);
        const provider = this.text(input.provider, 'provider', 64).toLowerCase();
        const connectionId = this.text(input.connectionId, 'connectionId');
        const resourceType = this.text(input.resourceType, 'resourceType', 64).toLowerCase();
        const resourceId = this.text(input.resourceId, 'resourceId');
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        const configured = !!((tenant?.settings as any)?.verticalIntegrations?.[provider]);
        const generationRows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT COALESCE(MAX(generation), 0)::int AS generation
             FROM integration_resource_bindings WHERE provider = $1 AND connection_id = $2`,
            [provider, connectionId],
        );
        const generation = Number(generationRows[0]?.generation || 0);
        if (!configured) {
            return conservativeProviderBindingFallback({ provider, connectionId, resourceType, resourceId, providerConfigured: false, generation });
        }

        const matches = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT b.*,
                    (SELECT COUNT(*)::int FROM integration_resource_bindings d
                     WHERE d.provider = b.provider AND d.connection_id = b.connection_id
                       AND d.resource_type = b.resource_type AND d.external_id = b.external_id
                       AND d.state <> 'tombstoned') AS external_duplicates
             FROM integration_resource_bindings b
             WHERE b.provider = $1 AND b.connection_id = $2
               AND b.resource_type = $3 AND b.resource_id = $4
               AND b.state <> 'tombstoned'`,
            [provider, connectionId, resourceType, resourceId],
        );
        if (matches.length !== 1 || matches[0].state === 'conflict' || Number(matches[0].external_duplicates) > 1) {
            if (matches.length > 0) {
                return {
                    version: PROVIDER_RESOURCE_BINDING_VERSION,
                    provider, connectionId, resourceType, resourceId,
                    mode: 'conflict', bindingId: matches[0]?.id || null, externalId: null,
                    generation, owner: 'blocked', allowExternalRead: false, allowExternalWrite: false,
                    allowLocalWrite: false, reason: 'binding_conflict', cache: 'not_cached',
                };
            }
            return conservativeProviderBindingFallback({ provider, connectionId, resourceType, resourceId, providerConfigured: true, generation });
        }

        const binding = matches[0];
        return {
            version: PROVIDER_RESOURCE_BINDING_VERSION,
            provider, connectionId, resourceType, resourceId,
            mode: 'exact', bindingId: binding.id, externalId: binding.external_id,
            generation: Number(binding.generation), owner: 'external', allowExternalRead: true,
            // Certification/write allowlists are evaluated separately; a map never enables writes.
            allowExternalWrite: false, allowLocalWrite: false, reason: 'exact_binding', cache: 'not_cached',
        };
    }

    private async reconcileConflicts(schema: string, provider: string, connectionId: string, resourceType: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE integration_resource_bindings b
             SET state = desired.state,
                 conflict_reason = desired.reason,
                 generation = b.generation + 1,
                 updated_at = NOW()
             FROM (
                SELECT candidate.id,
                       CASE WHEN COUNT(peer.id) > 1 THEN 'conflict' ELSE 'active' END AS state,
                       CASE WHEN COUNT(peer.id) > 1 THEN 'duplicate_external_mapping' ELSE NULL END AS reason
                FROM integration_resource_bindings candidate
                JOIN integration_resource_bindings peer
                  ON peer.provider = candidate.provider
                 AND peer.connection_id = candidate.connection_id
                 AND peer.resource_type = candidate.resource_type
                 AND peer.external_id = candidate.external_id
                 AND peer.state <> 'tombstoned'
                WHERE candidate.provider = $1 AND candidate.connection_id = $2
                  AND candidate.resource_type = $3 AND candidate.state <> 'tombstoned'
                GROUP BY candidate.id
             ) desired
             WHERE b.id = desired.id
               AND (b.state IS DISTINCT FROM desired.state OR b.conflict_reason IS DISTINCT FROM desired.reason)`,
            [provider, connectionId, resourceType],
        );
    }
}
