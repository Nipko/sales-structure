import {
    Controller, Get, Post, Put, Delete, Body, Param,
    Query, Request, UseGuards, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { ApiTags, ApiSecurity } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { WebhookSubscriptionService } from './webhook-subscription.service';
import { PublicApiGuard } from './guards/public-api.guard';
import { PublicApiRateLimitGuard } from './guards/public-api-rate-limit.guard';
import { ApiScopeGuard } from './guards/api-scope.guard';
import { ApiScope } from './decorators/api-scope.decorator';

@ApiTags('public-api')
@ApiSecurity('api-key')
@Controller('public')
@UseGuards(PublicApiGuard, PublicApiRateLimitGuard, ApiScopeGuard)
export class PublicApiController {
    constructor(
        private readonly prisma: PrismaService,
        private readonly pipelineService: PipelineService,
        private readonly appointmentsService: AppointmentsService,
        private readonly webhookSubscriptionService: WebhookSubscriptionService,
    ) {}

    private parsePagination(query: any): { page: number; pageSize: number; offset: number } {
        const page = Math.max(1, parseInt(query.page) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize) || 20));
        return { page, pageSize, offset: (page - 1) * pageSize };
    }

    private async getSchema(tenantId: string): Promise<string> {
        return this.prisma.getTenantSchemaName(tenantId);
    }

    // ── Auth test ──────────────────────────────────────────────────────

    @Get('me')
    async me(@Request() req: any) {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: req.tenantId },
            select: { id: true, name: true, slug: true, plan: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');
        return { data: tenant };
    }

    // ── Contacts ──────────────────────────────────────────────────────

    @Get('contacts')
    @ApiScope('read:contacts')
    async listContacts(@Request() req: any, @Query() query: any) {
        const { page, pageSize, offset } = this.parsePagination(query);
        const schema = await this.getSchema(req.tenantId);

        const search = query.search ? `%${query.search}%` : null;
        let sql = `SELECT id, name, phone, email, channel_type, avatar_url, metadata, created_at, updated_at
                   FROM contacts WHERE 1=1`;
        const params: any[] = [];
        let idx = 1;

        if (search) {
            sql += ` AND (name ILIKE $${idx} OR phone ILIKE $${idx} OR email ILIKE $${idx})`;
            params.push(search);
            idx++;
        }

        const countResult = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT COUNT(*) as total FROM contacts WHERE 1=1${search ? ` AND (name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1)` : ''}`,
            search ? [search] : [],
        );
        const total = parseInt(countResult?.[0]?.total || '0');

        sql += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(pageSize, offset);

        const rows = await this.prisma.executeInTenantSchema<any[]>(schema, sql, params);

        return {
            data: rows || [],
            meta: { page, pageSize, total },
        };
    }

    @Get('contacts/:id')
    @ApiScope('read:contacts')
    async getContact(@Request() req: any, @Param('id') id: string) {
        const schema = await this.getSchema(req.tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT id, name, phone, email, channel_type, avatar_url, metadata, created_at, updated_at
             FROM contacts WHERE id = $1::uuid`,
            [id],
        );
        if (!rows || rows.length === 0) throw new NotFoundException('Contact not found');
        return { data: rows[0] };
    }

    @Post('contacts')
    @ApiScope('write:contacts')
    async createContact(@Request() req: any, @Body() body: any) {
        if (!body.name) throw new BadRequestException('name is required');
        const schema = await this.getSchema(req.tenantId);

        // `external_id` es NOT NULL sin DEFAULT: omitirlo de la lista de columnas
        // hacía que TODA llamada a este endpoint fallara con 23502 — roto al
        // 100%, no en un caso borde. Se acepta el id del sistema externo (que es
        // lo que hace útil a la columna: reimportar sin duplicar) y, si no viene,
        // se sintetiza uno para esta fila.
        const externalId = String(body.externalId || body.external_id || `api_${randomUUID()}`);

        let rows: any[];
        try {
            rows = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `INSERT INTO contacts (external_id, name, phone, email, channel_type, metadata, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())
                 RETURNING id, external_id, name, phone, email, channel_type, avatar_url, metadata, created_at, updated_at`,
                [externalId, body.name, body.phone || null, body.email || null, body.channelType || 'api', JSON.stringify(body.metadata || {})],
            );
        } catch (error: any) {
            // (channel_type, external_id) es único. Reenviar el mismo externalId
            // es un conflicto legítimo del integrador, no un fallo del servidor:
            // sin esto sale como 500 opaco en una API pública.
            if (error?.code === '23505' || /duplicate key/i.test(error?.message ?? '')) {
                throw new ConflictException(
                    `Ya existe un contacto con externalId "${externalId}" en el canal "${body.channelType || 'api'}"`,
                );
            }
            throw error;
        }

        return { data: rows[0] };
    }

    @Put('contacts/:id')
    @ApiScope('write:contacts')
    async updateContact(@Request() req: any, @Param('id') id: string, @Body() body: any) {
        const schema = await this.getSchema(req.tenantId);
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (body.name !== undefined) { sets.push(`name = $${idx++}`); params.push(body.name); }
        if (body.phone !== undefined) { sets.push(`phone = $${idx++}`); params.push(body.phone); }
        if (body.email !== undefined) { sets.push(`email = $${idx++}`); params.push(body.email); }
        if (body.metadata !== undefined) { sets.push(`metadata = $${idx++}::jsonb`); params.push(JSON.stringify(body.metadata)); }
        sets.push('updated_at = NOW()');

        if (sets.length === 1) throw new BadRequestException('No fields to update');

        params.push(id);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `UPDATE contacts SET ${sets.join(', ')} WHERE id = $${idx}::uuid
             RETURNING id, name, phone, email, channel_type, avatar_url, metadata, created_at, updated_at`,
            params,
        );
        if (!rows || rows.length === 0) throw new NotFoundException('Contact not found');
        return { data: rows[0] };
    }

    // ── Deals ─────────────────────────────────────────────────────────

    @Get('deals')
    @ApiScope('read:deals')
    async listDeals(@Request() req: any, @Query() query: any) {
        const deals = await this.pipelineService.getDeals(req.tenantId, {
            stageId: query.stageId,
            status: query.status,
            assignedAgentId: query.assignedAgentId,
        });
        const { page, pageSize } = this.parsePagination(query);
        const start = (page - 1) * pageSize;
        const paged = deals.slice(start, start + pageSize);
        return {
            data: paged,
            meta: { page, pageSize, total: deals.length },
        };
    }

    @Get('deals/:id')
    @ApiScope('read:deals')
    async getDeal(@Request() req: any, @Param('id') id: string) {
        const detail = await this.pipelineService.getDealDetail(req.tenantId, id);
        if (!detail) throw new NotFoundException('Deal not found');
        return { data: detail };
    }

    @Post('deals')
    @ApiScope('write:deals')
    async createDeal(@Request() req: any, @Body() body: any) {
        if (!body.contactId || !body.title || body.value === undefined || !body.stageId) {
            throw new BadRequestException('contactId, title, value, and stageId are required');
        }
        const deal = await this.pipelineService.createDeal(req.tenantId, {
            contactId: body.contactId,
            title: body.title,
            value: body.value,
            stageId: body.stageId,
            probability: body.probability,
            expectedCloseDate: body.expectedCloseDate,
            assignedAgentId: body.assignedAgentId,
            notes: body.notes,
        });
        return { data: deal };
    }

    @Put('deals/:id/stage')
    @ApiScope('write:deals')
    async moveDealStage(@Request() req: any, @Param('id') id: string, @Body() body: any) {
        if (!body.stageId) throw new BadRequestException('stageId is required');
        await this.pipelineService.moveToStage(req.tenantId, id, body.stageId, undefined, body.reason);
        return { data: { success: true, message: 'Deal moved to new stage' } };
    }

    // ── Conversations ─────────────────────────────────────────────────

    @Get('conversations')
    @ApiScope('read:conversations')
    async listConversations(@Request() req: any, @Query() query: any) {
        const { page, pageSize, offset } = this.parsePagination(query);
        const schema = await this.getSchema(req.tenantId);

        let sql = `SELECT c.id, c.contact_id, c.channel_type, c.status, c.stage,
                          c.assigned_to, c.created_at, c.updated_at,
                          ct.name as contact_name, ct.phone as contact_phone
                   FROM conversations c
                   LEFT JOIN contacts ct ON ct.id = c.contact_id
                   WHERE 1=1`;
        const params: any[] = [];
        let idx = 1;

        if (query.status) {
            sql += ` AND c.status = $${idx++}`;
            params.push(query.status);
        }
        if (query.channelType) {
            sql += ` AND c.channel_type = $${idx++}`;
            params.push(query.channelType);
        }

        const countSql = sql.replace(/SELECT .+? FROM/, 'SELECT COUNT(*) as total FROM');
        const countResult = await this.prisma.executeInTenantSchema<any[]>(schema, countSql, params);
        const total = parseInt(countResult?.[0]?.total || '0');

        sql += ` ORDER BY c.updated_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(pageSize, offset);

        const rows = await this.prisma.executeInTenantSchema<any[]>(schema, sql, params);

        return {
            data: rows || [],
            meta: { page, pageSize, total },
        };
    }

    @Get('conversations/:id/messages')
    @ApiScope('read:conversations')
    async getMessages(@Request() req: any, @Param('id') id: string, @Query() query: any) {
        const { page, pageSize, offset } = this.parsePagination(query);
        const schema = await this.getSchema(req.tenantId);

        const countResult = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT COUNT(*) as total FROM messages WHERE conversation_id = $1::uuid`,
            [id],
        );
        const total = parseInt(countResult?.[0]?.total || '0');

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT id, conversation_id, sender, content, channel_type, media_url, metadata, created_at
             FROM messages WHERE conversation_id = $1::uuid
             ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
            [id, pageSize, offset],
        );

        return {
            data: rows || [],
            meta: { page, pageSize, total },
        };
    }

    // ── Appointments ──────────────────────────────────────────────────

    @Get('appointments')
    @ApiScope('read:appointments')
    async listAppointments(@Request() req: any, @Query() query: any) {
        const schema = await this.getSchema(req.tenantId);
        const appointments = await this.appointmentsService.list(schema, {
            status: query.status,
            assignedTo: query.assignedTo,
            startDate: query.startDate,
            endDate: query.endDate,
        });
        const { page, pageSize } = this.parsePagination(query);
        const start = (page - 1) * pageSize;
        const paged = appointments.slice(start, start + pageSize);
        return {
            data: paged,
            meta: { page, pageSize, total: appointments.length },
        };
    }

    @Post('appointments')
    @ApiScope('write:appointments')
    async createAppointment(@Request() req: any, @Body() body: any) {
        if (!body.contactId || !body.serviceName || !body.startAt || !body.endAt) {
            throw new BadRequestException('contactId, serviceName, startAt, and endAt are required');
        }
        const schema = await this.getSchema(req.tenantId);
        const appointment = await this.appointmentsService.create(schema, {
            contactId: body.contactId,
            conversationId: body.conversationId,
            assignedTo: body.assignedTo,
            serviceId: body.serviceId,
            serviceName: body.serviceName,
            startAt: body.startAt,
            endAt: body.endAt,
            location: body.location,
            notes: body.notes,
            metadata: body.metadata,
        });
        return { data: appointment };
    }

    // ── Webhook Subscriptions (REST hooks for Zapier/integrations) ────

    @Get('hooks')
    @ApiScope('read:webhooks')
    async listHooks(@Request() req: any) {
        const hooks = await this.webhookSubscriptionService.listHooks(req.tenantId);
        return { data: hooks };
    }

    @Post('hooks')
    @ApiScope('write:webhooks')
    async subscribeHook(
        @Request() req: any,
        @Body() body: { targetUrl: string; event: string },
    ) {
        if (!body.targetUrl || !body.event) {
            throw new BadRequestException('targetUrl and event are required');
        }
        const hook = await this.webhookSubscriptionService.subscribe(
            req.tenantId,
            body.targetUrl,
            body.event,
        );
        return { data: hook };
    }

    @Delete('hooks/:hookId')
    @ApiScope('write:webhooks')
    async unsubscribeHook(@Request() req: any, @Param('hookId') hookId: string) {
        await this.webhookSubscriptionService.unsubscribe(req.tenantId, hookId);
        return { data: { success: true, message: 'Webhook unsubscribed' } };
    }
}
