import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import * as crypto from 'crypto';

export const WEBHOOK_EVENTS = [
    'lead.created',
    'handoff.created',
    'appointment.booked',
    'message.received',
    'campaign.completed',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookEndpoint {
    id: string;
    url: string;
    events: WebhookEventType[];
    secret: string;
    is_active: boolean;
    description?: string;
    created_at: string;
    updated_at: string;
}

@Injectable()
export class WebhooksService {
    private readonly logger = new Logger(WebhooksService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private httpService: HttpService,
    ) {}

    async ensureWebhookTables(schemaName: string) {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `CREATE TABLE IF NOT EXISTS webhook_endpoints (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                url TEXT NOT NULL,
                events TEXT[] NOT NULL DEFAULT '{}',
                secret TEXT NOT NULL,
                description TEXT,
                is_active BOOLEAN NOT NULL DEFAULT true,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )`,
            [],
        );
        await this.prisma.executeInTenantSchema(
            schemaName,
            `CREATE TABLE IF NOT EXISTS webhook_deliveries (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
                event TEXT NOT NULL,
                payload JSONB NOT NULL DEFAULT '{}',
                status_code INT,
                response_body TEXT,
                error TEXT,
                attempt INT NOT NULL DEFAULT 1,
                delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )`,
            [],
        );
    }

    // ── CRUD ─────────────────────────────────────────────────────────────

    async list(tenantId: string): Promise<WebhookEndpoint[]> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureWebhookTables(schema);
        return this.prisma.executeInTenantSchema<WebhookEndpoint[]>(
            schema,
            `SELECT * FROM webhook_endpoints ORDER BY created_at DESC`,
            [],
        );
    }

    async create(
        tenantId: string,
        data: { url: string; events: WebhookEventType[]; description?: string },
    ): Promise<WebhookEndpoint> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureWebhookTables(schema);
        const secret = crypto.randomBytes(32).toString('hex');
        const rows = await this.prisma.executeInTenantSchema<WebhookEndpoint[]>(
            schema,
            `INSERT INTO webhook_endpoints (url, events, secret, description)
             VALUES ($1, $2::text[], $3, $4)
             RETURNING *`,
            [data.url, data.events, secret, data.description || null],
        );
        await this.invalidateCache(tenantId);
        return rows[0];
    }

    async update(
        tenantId: string,
        endpointId: string,
        data: { url?: string; events?: WebhookEventType[]; description?: string; is_active?: boolean },
    ): Promise<WebhookEndpoint> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (data.url !== undefined) { sets.push(`url = $${idx}::text`); params.push(data.url); idx++; }
        if (data.events !== undefined) { sets.push(`events = $${idx}::text[]`); params.push(data.events); idx++; }
        if (data.description !== undefined) { sets.push(`description = $${idx}::text`); params.push(data.description); idx++; }
        if (data.is_active !== undefined) { sets.push(`is_active = $${idx}::boolean`); params.push(data.is_active); idx++; }

        sets.push('updated_at = NOW()');
        params.push(endpointId);

        const rows = await this.prisma.executeInTenantSchema<WebhookEndpoint[]>(
            schema,
            `UPDATE webhook_endpoints SET ${sets.join(', ')} WHERE id = $${idx}::uuid RETURNING *`,
            params,
        );
        await this.invalidateCache(tenantId);
        return rows[0];
    }

    async delete(tenantId: string, endpointId: string): Promise<void> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        await this.prisma.executeInTenantSchema(
            schema,
            `DELETE FROM webhook_endpoints WHERE id = $1::uuid`,
            [endpointId],
        );
        await this.invalidateCache(tenantId);
    }

    async regenerateSecret(tenantId: string, endpointId: string): Promise<{ secret: string }> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        const secret = crypto.randomBytes(32).toString('hex');
        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE webhook_endpoints SET secret = $1, updated_at = NOW() WHERE id = $2::uuid`,
            [secret, endpointId],
        );
        await this.invalidateCache(tenantId);
        return { secret };
    }

    async getDeliveries(tenantId: string, endpointId: string, limit = 50): Promise<any[]> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        return this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT * FROM webhook_deliveries
             WHERE endpoint_id = $1::uuid
             ORDER BY delivered_at DESC
             LIMIT $2::int`,
            [endpointId, limit],
        );
    }

    // ── Dispatch ─────────────────────────────────────────────────────────

    async dispatch(tenantId: string, event: WebhookEventType, payload: Record<string, any>) {
        const endpoints = await this.getActiveEndpoints(tenantId, event);
        if (endpoints.length === 0) return;

        const schema = await this.prisma.getTenantSchemaName(tenantId);
        const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data: payload });

        for (const ep of endpoints) {
            this.deliverWithRetry(schema, ep, event, body).catch((err) =>
                this.logger.error(`Webhook delivery failed: endpoint=${ep.id} event=${event} error=${err.message}`),
            );
        }
    }

    private async deliverWithRetry(
        schemaName: string,
        endpoint: WebhookEndpoint,
        event: string,
        body: string,
        maxAttempts = 3,
    ) {
        const signature = crypto
            .createHmac('sha256', endpoint.secret)
            .update(body)
            .digest('hex');

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const response = await this.httpService.axiosRef.post(endpoint.url, body, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Webhook-Signature': signature,
                        'X-Webhook-Event': event,
                    },
                    timeout: 10_000,
                    validateStatus: () => true,
                });

                await this.logDelivery(schemaName, endpoint.id, event, body, response.status, String(response.data ?? '').slice(0, 500), null, attempt);

                if (response.status >= 200 && response.status < 300) {
                    this.logger.log(`Webhook delivered: endpoint=${endpoint.id} event=${event} status=${response.status}`);
                    return;
                }

                this.logger.warn(`Webhook non-2xx: endpoint=${endpoint.id} event=${event} status=${response.status} attempt=${attempt}`);
            } catch (err: any) {
                await this.logDelivery(schemaName, endpoint.id, event, body, null, null, err.message, attempt);
                this.logger.warn(`Webhook error: endpoint=${endpoint.id} event=${event} attempt=${attempt} error=${err.message}`);
            }

            if (attempt < maxAttempts) {
                await new Promise((r) => setTimeout(r, attempt * 2000));
            }
        }
    }

    private async logDelivery(
        schemaName: string,
        endpointId: string,
        event: string,
        payload: string,
        statusCode: number | null,
        responseBody: string | null,
        error: string | null,
        attempt: number,
    ) {
        try {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `INSERT INTO webhook_deliveries (endpoint_id, event, payload, status_code, response_body, error, attempt)
                 VALUES ($1::uuid, $2, $3::jsonb, $4, $5, $6, $7)`,
                [endpointId, event, payload, statusCode, responseBody, error, attempt],
            );
        } catch (e: any) {
            this.logger.error(`Failed to log webhook delivery: ${e.message}`);
        }
    }

    // ── Cache ────────────────────────────────────────────────────────────

    private async getActiveEndpoints(tenantId: string, event: WebhookEventType): Promise<WebhookEndpoint[]> {
        const cacheKey = `wh_endpoints:${tenantId}`;
        const cached = await this.redis.getJson<WebhookEndpoint[]>(cacheKey);
        if (cached) {
            return cached.filter((ep) => ep.is_active && ep.events.includes(event));
        }

        const schema = await this.prisma.getTenantSchemaName(tenantId);
        try {
            const hasTable = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'webhook_endpoints' LIMIT 1`,
                [schema],
            );
            if (!hasTable?.length) {
                await this.redis.setJson(cacheKey, [], 300);
                return [];
            }
            const all = await this.prisma.executeInTenantSchema<WebhookEndpoint[]>(
                schema,
                `SELECT * FROM webhook_endpoints WHERE is_active = true`,
                [],
            );
            await this.redis.setJson(cacheKey, all, 300);
            return all.filter((ep) => ep.events.includes(event));
        } catch {
            return [];
        }
    }

    private async invalidateCache(tenantId: string) {
        await this.redis.del(`wh_endpoints:${tenantId}`);
    }
}
