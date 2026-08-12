import { BadRequestException, Controller, Get, Post, Put, Delete, Body, Param, Query, Req, UseGuards, ConflictException, ForbiddenException, Header } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { LeadsRepository } from './repositories/leads.repository';
import { OpportunitiesRepository } from './repositories/opportunities.repository';
import { CatalogRepository } from './repositories/catalog.repository';
import { NotesService } from './services/notes/notes.service';
import { TasksService } from './services/tasks/tasks.service';
import { ActivityService } from './services/activity/activity.service';
import { LeadScoringService } from './services/lead-scoring/lead-scoring.service';
import { CustomAttributesService } from './services/custom-attributes/custom-attributes.service';
import { SegmentsService } from './services/segments/segments.service';
import { ImportExportService } from './services/import-export/import-export.service';
import { CrmAnalyticsService } from './services/crm-analytics/crm-analytics.service';
import { CrmInsightsService } from './services/crm-insights/crm-insights.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { ensurePrimaryPipeline } from '../../common/utils/primary-pipeline.util';

interface ReplacePipelineStageInput {
    id?: string;
    name: string;
    slug?: string;
    color?: string;
    position?: number;
    default_probability?: number;
    sla_hours?: number | null;
    is_terminal?: boolean;
    terminal_outcome?: 'won' | 'lost' | null;
    transition_rules?: any[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canonicalPipelineStageSlug(value: string): string {
    const normalized = value.trim().toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
    return normalized === 'listo_cierre' ? 'listo_para_cierre' : normalized;
}

@Controller('crm')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class CrmController {

    constructor(
        private leadsRepo: LeadsRepository,
        private oppsRepo: OpportunitiesRepository,
        private catalogRepo: CatalogRepository,
        private notesService: NotesService,
        private tasksService: TasksService,
        private activityService: ActivityService,
        private leadScoring: LeadScoringService,
        private customAttrs: CustomAttributesService,
        private segmentsService: SegmentsService,
        private importExportService: ImportExportService,
        private crmAnalytics: CrmAnalyticsService,
        private crmInsights: CrmInsightsService,
        private prisma: PrismaService,
        private throttle: TenantThrottleService,
        private pipelineService: PipelineService,
    ) {}

    // ---- Kanban (Pipeline Board using Opportunities) ----

    @Get('kanban/:tenantId')
    async getKanban(@Param('tenantId') tenantId: string) {
        const kanban = await this.oppsRepo.getKanban(tenantId);
        return { success: true, data: kanban };
    }

    @Put('kanban/:tenantId/:opportunityId/move')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async moveOpportunity(
        @Param('tenantId') tenantId: string,
        @Param('opportunityId') opportunityId: string,
        @Body() body: { stage: string },
    ) {
        // Governance: enforce the target stage's transition rules on the manual board move,
        // same as the deal board — throws TRANSITION_RULE_FAILED:<type> which the dashboard
        // maps to a localized toast.
        await this.pipelineService.assertOpportunityMoveAllowed(tenantId, opportunityId, body.stage);
        await this.oppsRepo.moveOpportunity(tenantId, opportunityId, body.stage);
        return { success: true, message: 'Opportunity moved' };
    }

    // ---- Leads / Contacts (CRM list) ----

    @Get('leads/:tenantId')
    async listLeads(
        @Param('tenantId') tenantId: string,
        @Query('search') search?: string,
        @Query('stage') stage?: string,
        @Query('assignedTo') assignedTo?: string,
        @Query('courseId') courseId?: string,
        @Query('isVip') isVip?: string,
        @Query('scoreMin') scoreMin?: string,
        @Query('scoreMax') scoreMax?: string,
        @Query('dateFrom') dateFrom?: string,
        @Query('dateTo') dateTo?: string,
        @Query('tags') tags?: string,
        @Query('includeArchived') includeArchived?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const result = await this.leadsRepo.listLeads(tenantId, {
            search,
            stage,
            assignedTo,
            courseId,
            isVip: isVip !== undefined ? isVip === 'true' : undefined,
            scoreMin: scoreMin ? parseInt(scoreMin) : undefined,
            scoreMax: scoreMax ? parseInt(scoreMax) : undefined,
            dateFrom,
            dateTo,
            tags: tags ? tags.split(',') : undefined,
            includeArchived: includeArchived === 'true',
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 25,
        });
        return { success: true, ...result };
    }

    @Get('leads/:tenantId/:leadId')
    async getLead360(
        @Param('tenantId') tenantId: string,
        @Param('leadId') leadId: string,
    ) {
        const data = await this.leadsRepo.getLead360(tenantId, leadId);
        return { success: true, data };
    }

    @Post('leads/:tenantId')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async createLead(
        @Param('tenantId') tenantId: string,
        @Body() body: Record<string, any>,
    ) {
        const schema = await this.getSchema(tenantId);
        const cnt = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT COUNT(*)::int AS c FROM leads WHERE archived_at IS NULL`);
        await this.throttle.enforcePlanLimit(tenantId, 'maxContacts', cnt?.[0]?.c || 0, 'contactos');
        const stage = await this.pipelineService.resolveTenantStage(tenantId, body.stage, { schemaName: schema });
        const lead = await this.leadsRepo.createLead(tenantId, { ...body, stage: stage.slug });
        if (lead?.id) {
            const opportunities = await this.prisma.executeInTenantSchema<any[]>(schema,
                `INSERT INTO opportunities (lead_id, stage, score)
                 VALUES ($1::uuid, $2, 10) ON CONFLICT DO NOTHING
                 RETURNING id`,
                [String(lead.id), stage.slug],
            );
            const opportunityId = opportunities?.[0]?.id;
            if (opportunityId) {
                await this.pipelineService.syncOpportunityToDeal(
                    tenantId,
                    String(lead.id),
                    stage.slug,
                    String(opportunityId),
                );
            }
        }
        return { success: true, data: lead };
    }

    @Put('leads/:tenantId/:leadId')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async updateLead(
        @Param('tenantId') tenantId: string,
        @Param('leadId') leadId: string,
        @Body() body: Record<string, any>,
    ) {
        const { tags, stage, ...leadData } = body;
        if (Object.keys(leadData).length > 0) {
            await this.leadsRepo.updateLead(tenantId, leadId, leadData);
        }
        if (stage !== undefined) {
            await this.pipelineService.writeLeadStage(tenantId, leadId, String(stage));
        }
        if (Array.isArray(tags)) {
            await this.leadsRepo.updateLeadTags(tenantId, leadId, tags);
        }
        return { success: true, message: 'Lead updated' };
    }

    @Post('leads/:tenantId/bulk-update')
    @Roles('tenant_admin', 'tenant_supervisor')
    async bulkUpdateLeads(
        @Param('tenantId') tenantId: string,
        @Body() body: { leadIds: string[]; action: string; payload: any },
    ) {
        if (body.action === 'stage') {
            const requestedStage = body.payload?.stage;
            const canonical = await this.pipelineService.resolveTenantStage(tenantId, requestedStage);
            let updated = 0;
            for (const leadId of body.leadIds) {
                await this.pipelineService.writeLeadStage(tenantId, leadId, canonical.slug);
                updated++;
            }
            return { success: true, data: { updated } };
        }
        const result = await this.leadsRepo.bulkUpdate(tenantId, body.leadIds, body.action, body.payload || {});
        return { success: true, data: result };
    }

    @Delete('leads/:tenantId/:leadId')
    @Roles('tenant_admin', 'tenant_supervisor')
    async archiveLead(
        @Param('tenantId') tenantId: string,
        @Param('leadId') leadId: string,
    ) {
        await this.leadsRepo.archiveLead(tenantId, leadId);
        return { success: true, message: 'Lead archived' };
    }

    @Put('leads/:tenantId/:leadId/restore')
    @Roles('tenant_admin', 'tenant_supervisor')
    async restoreLead(
        @Param('tenantId') tenantId: string,
        @Param('leadId') leadId: string,
    ) {
        await this.leadsRepo.restoreLead(tenantId, leadId);
        return { success: true, message: 'Lead restored' };
    }

    // ---- Lead Scoring ----

    @Get('leads/:tenantId/:leadId/score')
    async getLeadScore(
        @Param('tenantId') tenantId: string,
        @Param('leadId') leadId: string,
    ) {
        const result = await this.leadScoring.calculateScore(tenantId, leadId);
        return { success: true, data: result };
    }

    @Post('leads/:tenantId/:leadId/rescore')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async rescoreLead(
        @Param('tenantId') tenantId: string,
        @Param('leadId') leadId: string,
    ) {
        const result = await this.leadScoring.updateLeadScore(tenantId, leadId);
        return { success: true, data: result };
    }

    // ---- Notes ----

    @Get('notes/:tenantId/:leadId')
    async getNotes(
        @Param('tenantId') tenantId: string,
        @Param('leadId') leadId: string,
    ) {
        const notes = await this.notesService.getNotes(tenantId, leadId);
        return { success: true, data: notes };
    }

    @Post('notes/:tenantId')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async createNote(
        @Param('tenantId') tenantId: string,
        @Body() body: {
            leadId: string;
            opportunityId?: string;
            conversationId?: string;
            content: string;
            createdBy?: string;
        },
    ) {
        const note = await this.notesService.createNote(tenantId, body);
        return { success: true, data: note };
    }

    // ---- Tasks ----

    @Get('tasks/:tenantId')
    async getTasks(
        @Param('tenantId') tenantId: string,
        @Query('leadId') leadId?: string,
        @Query('assignedTo') assignedTo?: string,
        @Query('status') status?: string,
    ) {
        const tasks = await this.tasksService.getTasks(tenantId, { leadId, assignedTo, status });
        return { success: true, data: tasks };
    }

    @Post('tasks/:tenantId')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async createTask(
        @Param('tenantId') tenantId: string,
        @Body() body: {
            leadId: string;
            opportunityId?: string;
            title: string;
            description?: string;
            type?: string;
            dueAt?: string;
            assignedTo?: string;
            createdBy?: string;
        },
    ) {
        const task = await this.tasksService.createTask(tenantId, body);
        return { success: true, data: task };
    }

    @Put('tasks/:tenantId/:taskId/status')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async updateTaskStatus(
        @Param('tenantId') tenantId: string,
        @Param('taskId') taskId: string,
        @Body() body: { status: string },
    ) {
        await this.tasksService.updateTaskStatus(tenantId, taskId, body.status);
        return { success: true, message: 'Task updated' };
    }

    // ---- Activity Timeline ----

    @Get('timeline/:tenantId/:leadId')
    async getTimeline(
        @Param('tenantId') tenantId: string,
        @Param('leadId') leadId: string,
    ) {
        const timeline = await this.activityService.getTimeline(tenantId, leadId);
        return { success: true, data: timeline };
    }

    // ---- Opportunities ----

    @Get('opportunities/:tenantId')
    async listOpportunities(
        @Param('tenantId') tenantId: string,
        @Query('stage') stage?: string,
    ) {
        const data = await this.oppsRepo.getOpportunities(tenantId, stage);
        return { success: true, data };
    }

    @Get('opportunities/:tenantId/:opportunityId')
    async getOpportunity(
        @Param('tenantId') tenantId: string,
        @Param('opportunityId') opportunityId: string,
    ) {
        const data = await this.oppsRepo.getOpportunityById(tenantId, opportunityId);
        return { success: true, data };
    }

    @Post('opportunities/:tenantId')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async createOpportunity(
        @Param('tenantId') tenantId: string,
        @Body() body: Record<string, any>,
    ) {
        const data = await this.oppsRepo.createOpportunity(tenantId, body);
        return { success: true, data };
    }

    @Put('opportunities/:tenantId/:opportunityId')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async updateOpportunity(
        @Param('tenantId') tenantId: string,
        @Param('opportunityId') opportunityId: string,
        @Body() body: Record<string, any>,
    ) {
        const data = await this.oppsRepo.updateOpportunity(tenantId, opportunityId, body);
        return { success: true, data };
    }

    // ---- Catalog (Courses & Campaigns) ----

    @Get('courses/:tenantId')
    async listCourses(@Param('tenantId') tenantId: string) {
        const data = await this.catalogRepo.getCourses(tenantId);
        return { success: true, data };
    }

    @Get('courses/:tenantId/:courseId')
    async getCourse(
        @Param('tenantId') tenantId: string,
        @Param('courseId') courseId: string,
    ) {
        const data = await this.catalogRepo.getCourseById(tenantId, courseId);
        return { success: true, data };
    }

    @Get('campaigns/:tenantId')
    async listCampaigns(@Param('tenantId') tenantId: string) {
        const data = await this.catalogRepo.getCampaigns(tenantId);
        return { success: true, data };
    }

    @Get('campaigns/:tenantId/active')
    async listActiveCampaigns(@Param('tenantId') tenantId: string) {
        const data = await this.catalogRepo.getActiveCampaigns(tenantId);
        return { success: true, data };
    }

    @Get('campaigns/:tenantId/:campaignId')
    async getCampaign(
        @Param('tenantId') tenantId: string,
        @Param('campaignId') campaignId: string,
    ) {
        const data = await this.catalogRepo.getCampaignById(tenantId, campaignId);
        return { success: true, data };
    }

    // ---- Custom Attributes ----

    @Get('custom-attributes/:tenantId')
    async getCustomAttributes(
        @Param('tenantId') tenantId: string,
        @Query('entityType') entityType?: string,
    ) {
        const data = await this.customAttrs.getDefinitions(tenantId, entityType);
        return { success: true, data };
    }

    @Post('custom-attributes/:tenantId')
    @Roles('tenant_admin', 'tenant_supervisor')
    async createCustomAttribute(@Param('tenantId') tenantId: string, @Body() body: any) {
        const schema = await this.getSchema(tenantId);
        const cnt = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT COUNT(*)::int AS c FROM custom_attribute_definitions`);
        await this.throttle.enforcePlanLimit(tenantId, 'customAttributes', cnt?.[0]?.c || 0, 'atributos personalizados');
        const data = await this.customAttrs.createDefinition(tenantId, body);
        return { success: true, data };
    }

    @Put('custom-attributes/:tenantId/:id')
    @Roles('tenant_admin', 'tenant_supervisor')
    async updateCustomAttribute(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
        @Body() body: any,
    ) {
        const data = await this.customAttrs.updateDefinition(tenantId, id, body);
        return { success: true, data };
    }

    // ---- Custom Attribute Values ----

    @Get('custom-attribute-values/:tenantId/:entityType/:entityId')
    async getCustomAttributeValues(
        @Param('tenantId') tenantId: string,
        @Param('entityType') entityType: string,
        @Param('entityId') entityId: string,
    ) {
        const data = await this.customAttrs.getValuesForEntity(tenantId, entityType, entityId);
        return { success: true, data };
    }

    @Post('custom-attribute-values/:tenantId/:entityType/:entityId')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async setCustomAttributeValues(
        @Param('tenantId') tenantId: string,
        @Param('entityType') entityType: string,
        @Param('entityId') entityId: string,
        @Body() body: { values: { definitionId: string; value: any }[] },
    ) {
        await this.customAttrs.setValuesForEntity(tenantId, entityType, entityId, body.values);
        return { success: true, message: 'Custom attribute values saved' };
    }

    // ---- Contact Segments ----

    @Get('segments/:tenantId')
    async getSegments(@Param('tenantId') tenantId: string) {
        const data = await this.segmentsService.getSegments(tenantId);
        return { success: true, data };
    }

    @Post('segments/:tenantId')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async createSegment(@Param('tenantId') tenantId: string, @Body() body: any) {
        const schema = await this.getSchema(tenantId);
        const cnt = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT COUNT(*)::int AS c FROM contact_segments`);
        await this.throttle.enforcePlanLimit(tenantId, 'segments', cnt?.[0]?.c || 0, 'segmentos');
        const data = await this.segmentsService.createSegment(tenantId, body);
        return { success: true, data };
    }

    @Put('segments/:tenantId/:segmentId')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async updateSegment(
        @Param('tenantId') tenantId: string,
        @Param('segmentId') segmentId: string,
        @Body() body: any,
    ) {
        const data = await this.segmentsService.updateSegment(tenantId, segmentId, body);
        return { success: true, data };
    }

    @Get('segments/:tenantId/:segmentId/contacts')
    async getSegmentContacts(
        @Param('tenantId') tenantId: string,
        @Param('segmentId') segmentId: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const data = await this.segmentsService.getSegmentContacts(
            tenantId, segmentId, Number(page) || 1, Number(limit) || 25,
        );
        return { success: true, data };
    }

    // ---- Import / Export ----

    @Post('import/:tenantId')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async importCSV(
        @Param('tenantId') tenantId: string,
        @Body() body: { csvContent: string; options?: { skipDuplicates?: boolean } },
    ) {
        const result = await this.importExportService.importCSV(tenantId, body.csvContent, body.options);
        return { success: true, data: result };
    }

    @Get('export/:tenantId')
    @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
    @Header('Pragma', 'no-cache')
    async exportCSV(
        @Param('tenantId') tenantId: string,
        @Query('segmentId') segmentId?: string,
    ) {
        const csvString = await this.importExportService.exportCSV(tenantId, segmentId);
        return { success: true, data: csvString };
    }

    @Get('import-template')
    @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
    @Header('Pragma', 'no-cache')
    async getImportTemplate() {
        const template = this.importExportService.getImportTemplate();
        return { success: true, data: template };
    }

    // ---- AI Insights ----

    @Get('leads/:tenantId/:leadId/insight')
    async getLeadInsight(
        @Param('tenantId') tenantId: string,
        @Param('leadId') leadId: string,
    ) {
        const enabled = await this.throttle.isFeatureEnabled(tenantId, 'aiInsights');
        if (!enabled) {
            throw new ForbiddenException({ error: 'feature_not_available', feature: 'aiInsights' });
        }
        const data = await this.crmInsights.getInsight(tenantId, leadId);
        return { success: true, data };
    }

    // ---- Deal Approval ----

    @Put('opportunities/:tenantId/:opportunityId/request-approval')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async requestApproval(
        @Param('tenantId') tenantId: string,
        @Param('opportunityId') opportunityId: string,
        @Body() body: { stage: string },
    ) {
        const schema = await this.getSchema(tenantId);
        await this.prisma.executeInTenantSchema(schema,
            `UPDATE opportunities SET approval_status = 'pending', approval_stage = $1, updated_at = NOW() WHERE id = $2::uuid`,
            [body.stage, opportunityId],
        );
        return { success: true, message: 'Approval requested' };
    }

    @Put('opportunities/:tenantId/:opportunityId/approve')
    @Roles('tenant_admin', 'tenant_supervisor')
    async approveOpportunity(
        @Param('tenantId') tenantId: string,
        @Param('opportunityId') opportunityId: string,
        @Req() req: any,
    ) {
        const schema = await this.getSchema(tenantId);
        const opp = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT approval_stage FROM opportunities WHERE id = $1::uuid`, [opportunityId]);
        if (!opp?.length) return { success: false, message: 'Not found' };

        // Move to the approved stage
        await this.oppsRepo.moveOpportunity(tenantId, opportunityId, opp[0].approval_stage);
        await this.prisma.executeInTenantSchema(schema,
            `UPDATE opportunities SET approval_status = 'approved', approved_by = $1, updated_at = NOW() WHERE id = $2::uuid`,
            [req.user?.sub || 'system', opportunityId],
        );
        return { success: true, message: 'Opportunity approved and moved' };
    }

    @Put('opportunities/:tenantId/:opportunityId/reject')
    @Roles('tenant_admin', 'tenant_supervisor')
    async rejectOpportunity(
        @Param('tenantId') tenantId: string,
        @Param('opportunityId') opportunityId: string,
        @Req() req: any,
        @Body() body: { reason?: string },
    ) {
        const schema = await this.getSchema(tenantId);
        await this.prisma.executeInTenantSchema(schema,
            `UPDATE opportunities SET approval_status = 'rejected', approved_by = $1, loss_reason = COALESCE($2, loss_reason), updated_at = NOW() WHERE id = $3::uuid`,
            [req.user?.sub || 'system', body.reason || null, opportunityId],
        );
        return { success: true, message: 'Opportunity rejected' };
    }

    // ---- Scoring Config ----

    @Get('scoring-config/:tenantId')
    async getScoringConfig(@Param('tenantId') tenantId: string) {
        const schema = await this.getSchema(tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT * FROM scoring_config WHERE tenant_id = $1::uuid AND is_active = true LIMIT 1`,
            [tenantId],
        );
        return { success: true, data: rows?.[0] || null };
    }

    @Post('scoring-config/:tenantId')
    @Roles('tenant_admin', 'tenant_supervisor')
    async saveScoringConfig(
        @Param('tenantId') tenantId: string,
        @Body() body: { weights?: any; purchase_keywords?: string[]; decay_enabled?: boolean; decay_days?: number; decay_factor?: number },
    ) {
        const schema = await this.getSchema(tenantId);
        const existing = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT id FROM scoring_config WHERE tenant_id = $1::uuid LIMIT 1`,
            [tenantId],
        );

        if (existing?.length > 0) {
            await this.prisma.executeInTenantSchema(schema,
                `UPDATE scoring_config SET weights = $1::jsonb, purchase_keywords = $2::text[], decay_enabled = $3::boolean, decay_days = $4::int, decay_factor = $5::numeric, updated_at = NOW()
                 WHERE id = $6::uuid`,
                [JSON.stringify(body.weights || {}), body.purchase_keywords || [], body.decay_enabled ?? false, body.decay_days ?? 30, body.decay_factor ?? 0.5, existing[0].id],
            );
        } else {
            await this.prisma.executeInTenantSchema(schema,
                `INSERT INTO scoring_config (tenant_id, weights, purchase_keywords, decay_enabled, decay_days, decay_factor)
                 VALUES ($1::uuid, $2::jsonb, $3::text[], $4::boolean, $5::int, $6::numeric)`,
                [tenantId, JSON.stringify(body.weights || {}), body.purchase_keywords || [], body.decay_enabled ?? false, body.decay_days ?? 30, body.decay_factor ?? 0.5],
            );
        }

        // Invalidate config cache
        await this.prisma.executeInTenantSchema(schema, `SELECT 1`, []);
        return { success: true, message: 'Scoring config saved' };
    }

    // ---- CRM Analytics ----

    @Get('analytics/:tenantId/overview')
    async getCrmOverview(@Param('tenantId') tenantId: string) {
        const data = await this.crmAnalytics.getOverviewKpis(tenantId);
        return { success: true, data };
    }

    @Get('analytics/:tenantId/funnel')
    async getConversionFunnel(
        @Param('tenantId') tenantId: string,
        @Query('dateFrom') dateFrom?: string,
        @Query('dateTo') dateTo?: string,
    ) {
        const data = await this.crmAnalytics.getConversionFunnel(tenantId, dateFrom, dateTo);
        return { success: true, data };
    }

    @Get('analytics/:tenantId/velocity')
    async getPipelineVelocity(
        @Param('tenantId') tenantId: string,
        @Query('dateFrom') dateFrom?: string,
        @Query('dateTo') dateTo?: string,
    ) {
        const data = await this.crmAnalytics.getPipelineVelocity(tenantId, dateFrom, dateTo);
        return { success: true, data };
    }

    @Get('analytics/:tenantId/win-loss')
    async getWinLossRate(
        @Param('tenantId') tenantId: string,
        @Query('dateFrom') dateFrom?: string,
        @Query('dateTo') dateTo?: string,
    ) {
        const data = await this.crmAnalytics.getWinLossRate(tenantId, dateFrom, dateTo);
        return { success: true, data };
    }

    @Get('analytics/:tenantId/leaderboard')
    async getAgentLeaderboard(
        @Param('tenantId') tenantId: string,
        @Query('dateFrom') dateFrom?: string,
        @Query('dateTo') dateTo?: string,
    ) {
        const data = await this.crmAnalytics.getAgentLeaderboard(tenantId, dateFrom, dateTo);
        return { success: true, data };
    }

    @Get('analytics/:tenantId/sources')
    async getSourceBreakdown(
        @Param('tenantId') tenantId: string,
        @Query('dateFrom') dateFrom?: string,
        @Query('dateTo') dateTo?: string,
    ) {
        const data = await this.crmAnalytics.getSourceBreakdown(tenantId, dateFrom, dateTo);
        return { success: true, data };
    }

    // ---- Pipeline Stages ----

    private async getSchema(tenantId: string): Promise<string> {
        const tenant = await this.prisma.$queryRaw<any[]>`SELECT schema_name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1`;
        if (!tenant?.[0]?.schema_name) throw new Error('Tenant not found');
        return tenant[0].schema_name;
    }

    private normalizePipelineStages(stages: ReplacePipelineStageInput[]) {
        if (!Array.isArray(stages) || stages.length === 0) {
            throw new BadRequestException('El pipeline requiere al menos una etapa');
        }

        const seenIds = new Set<string>();
        const seenSlugs = new Set<string>();
        return stages.map((stage, index) => {
            const name = String(stage?.name || '').trim();
            if (!name || name.length > 120) {
                throw new BadRequestException(`Nombre inválido en la etapa ${index + 1}`);
            }
            if (stage.id && !UUID_PATTERN.test(stage.id)) {
                throw new BadRequestException(`ID inválido en la etapa ${index + 1}`);
            }
            if (stage.id && seenIds.has(stage.id)) {
                throw new BadRequestException(`ID de etapa duplicado: ${stage.id}`);
            }
            if (stage.id) seenIds.add(stage.id);

            const slug = canonicalPipelineStageSlug(stage.slug || name);
            if (!slug || slug.length > 120) {
                throw new BadRequestException(`Slug inválido en la etapa ${index + 1}`);
            }
            if (seenSlugs.has(slug)) {
                throw new BadRequestException(`Slug de etapa duplicado: ${slug}`);
            }
            seenSlugs.add(slug);

            const probability = Number(stage.default_probability ?? 0);
            if (!Number.isFinite(probability) || probability < 0 || probability > 100) {
                throw new BadRequestException(`Probabilidad inválida en la etapa "${name}"`);
            }
            const slaHours = stage.sla_hours == null ? null : Number(stage.sla_hours);
            if (slaHours != null && (!Number.isInteger(slaHours) || slaHours <= 0)) {
                throw new BadRequestException(`SLA inválido en la etapa "${name}"`);
            }
            const isTerminal = stage.is_terminal === true;
            if (isTerminal && stage.terminal_outcome !== 'won' && stage.terminal_outcome !== 'lost') {
                throw new BadRequestException(`La etapa terminal "${name}" requiere terminal_outcome: won o lost`);
            }
            if (!isTerminal && stage.terminal_outcome != null) {
                throw new BadRequestException(`La etapa no terminal "${name}" no admite terminal_outcome`);
            }
            if (stage.transition_rules != null && !Array.isArray(stage.transition_rules)) {
                throw new BadRequestException(`Reglas inválidas en la etapa "${name}"`);
            }

            return {
                id: stage.id,
                name,
                slug,
                color: /^#[0-9a-f]{6}$/i.test(String(stage.color || '')) ? stage.color! : '#3498db',
                position: index,
                default_probability: probability,
                sla_hours: slaHours,
                is_terminal: isTerminal,
                terminal_outcome: isTerminal ? stage.terminal_outcome! : null,
                transition_rules: stage.transition_rules || [],
            };
        });
    }

    @Get('pipeline-stages/:tenantId')
    async getPipelineStages(@Param('tenantId') tenantId: string) {
        const schema = await this.getSchema(tenantId);
        const stages = await this.prisma.transactionInTenantSchema(schema, async (query) => {
            const { pipelineId } = await ensurePrimaryPipeline(query, tenantId);
            return query<any[]>(
                `SELECT * FROM pipeline_stages
                  WHERE tenant_id = $1::uuid AND pipeline_id = $2::uuid
                  ORDER BY position ASC`,
                [tenantId, pipelineId],
            );
        });
        return { success: true, data: stages || [] };
    }

    @Post('pipeline-stages/:tenantId')
    @Roles('tenant_admin', 'tenant_supervisor')
    async createPipelineStage(
        @Param('tenantId') tenantId: string,
        @Body() body: { name: string; slug?: string; color?: string; position?: number; default_probability?: number; sla_hours?: number; is_terminal?: boolean; terminal_outcome?: 'won' | 'lost'; transition_rules?: any[] },
    ) {
        const schema = await this.getSchema(tenantId);
        const slug = canonicalPipelineStageSlug(body.slug || body.name);
        const isTerminal = body.is_terminal ?? false;
        if (isTerminal && body.terminal_outcome !== 'won' && body.terminal_outcome !== 'lost') {
            throw new BadRequestException('Una etapa terminal requiere terminal_outcome: won o lost');
        }
        if (!isTerminal && body.terminal_outcome != null) {
            throw new BadRequestException('Una etapa no terminal no admite terminal_outcome');
        }
        const terminalOutcome = isTerminal ? body.terminal_outcome! : null;
        let result: any[] | undefined;
        try {
            result = await this.prisma.transactionInTenantSchema(schema, async (query) => {
                const { pipelineId } = await ensurePrimaryPipeline(query, tenantId);
                const cnt = await query<Array<{ c: number }>>(
                    `SELECT COUNT(*)::int AS c FROM pipeline_stages
                      WHERE tenant_id = $1::uuid AND pipeline_id = $2::uuid`,
                    [tenantId, pipelineId],
                );
                await this.throttle.enforcePlanLimit(
                    tenantId,
                    'pipelineStages',
                    Number(cnt?.[0]?.c || 0),
                    'etapas de pipeline',
                );
                return query<any[]>(
                    `INSERT INTO pipeline_stages
                        (tenant_id, pipeline_id, name, slug, color, position,
                         default_probability, sla_hours, is_terminal, terminal_outcome, transition_rules)
                     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
                     RETURNING *`,
                    [tenantId, pipelineId, body.name, slug, body.color || '#3498db', body.position ?? 0,
                        body.default_probability ?? 0, body.sla_hours || null, isTerminal, terminalOutcome,
                        JSON.stringify(body.transition_rules || [])],
                );
            });
        } catch (e: any) {
            // uidx_pipeline_stages_pipeline_slug (tenant-schema.sql): el slug se deriva
            // del nombre, así que repetir el nombre en el mismo embudo choca. Sin esto
            // el usuario veía un 500 con el texto crudo de Postgres.
            if (`${e?.code || ''} ${e?.message || ''}`.includes('23505')) {
                throw new ConflictException(`Ya existe una etapa con el nombre "${body.name}" en este embudo`);
            }
            throw e;
        }
        return { success: true, data: result?.[0] };
    }

    /**
     * Replace the editable stage set as one transaction. Existing stages are
     * matched by ID (or canonical slug for presets), so references remain
     * stable and a failed validation/update cannot leave a half-empty funnel.
     */
    @Put('pipeline-stages/:tenantId/bulk')
    @Roles('tenant_admin', 'tenant_supervisor')
    async replacePipelineStages(
        @Param('tenantId') tenantId: string,
        @Body() body: { stages: ReplacePipelineStageInput[] },
    ) {
        const stages = this.normalizePipelineStages(body?.stages);
        const limit = await this.throttle.getPlanLimit(tenantId, 'pipelineStages');
        if (limit !== -1 && stages.length > limit) {
            throw new BadRequestException(`El plan permite un máximo de ${limit} etapas de pipeline`);
        }
        const schema = await this.getSchema(tenantId);

        const data = await this.prisma.transactionInTenantSchema(schema, async (query) => {
            const { pipelineId } = await ensurePrimaryPipeline(query, tenantId);
            type ExistingStage = {
                id: string;
                slug: string;
                is_terminal: boolean;
                terminal_outcome: 'won' | 'lost' | null;
            };
            const existing = await query<ExistingStage[]>(
                `SELECT id, slug, is_terminal, terminal_outcome
                   FROM pipeline_stages
                  WHERE tenant_id = $1::uuid AND pipeline_id = $2::uuid
                  ORDER BY position ASC
                  FOR UPDATE`,
                [tenantId, pipelineId],
            );
            const byId = new Map(existing.map((stage) => [stage.id, stage]));
            const bySlug = new Map<string, ExistingStage>();
            for (const stage of existing) {
                const canonical = canonicalPipelineStageSlug(stage.slug);
                if (bySlug.has(canonical)) {
                    throw new ConflictException({
                        error: 'pipeline_stage_alias_collision',
                        slug: canonical,
                    });
                }
                bySlug.set(canonical, stage);
            }

            const resolved = stages.map((stage) => {
                const current = stage.id ? byId.get(stage.id) : bySlug.get(stage.slug);
                if (stage.id && !current) {
                    throw new BadRequestException(`La etapa ${stage.id} no pertenece a este tenant`);
                }
                return { ...stage, current };
            });
            const resolvedIds = new Set<string>();
            for (const stage of resolved) {
                if (!stage.current) continue;
                if (resolvedIds.has(stage.current.id)) {
                    throw new BadRequestException(`La etapa ${stage.current.id} fue enviada más de una vez`);
                }
                resolvedIds.add(stage.current.id);
            }

            const usageFor = async (stage: ExistingStage) => {
                const rows = await query<Array<{ opportunity_count: number; deal_count: number }>>(
                    `SELECT
                        (SELECT COUNT(*)::int FROM opportunities WHERE stage = $1) AS opportunity_count,
                        (SELECT COUNT(*)::int FROM deals WHERE stage_id = $2::uuid) AS deal_count`,
                    [stage.slug, stage.id],
                );
                return {
                    opportunityCount: Number(rows?.[0]?.opportunity_count || 0),
                    dealCount: Number(rows?.[0]?.deal_count || 0),
                };
            };

            for (const stage of resolved) {
                const current = stage.current;
                if (!current) continue;
                const slugChanged = current.slug !== stage.slug;
                const outcomeChanged = current.is_terminal !== stage.is_terminal
                    || current.terminal_outcome !== stage.terminal_outcome;
                if (!slugChanged && !outcomeChanged) continue;

                const usage = await usageFor(current);
                const canonicalizesLegacyAlias = current.slug === 'listo_cierre'
                    && stage.slug === 'listo_para_cierre'
                    && !outcomeChanged;
                if ((usage.opportunityCount > 0 || usage.dealCount > 0) && !canonicalizesLegacyAlias) {
                    throw new ConflictException({
                        error: 'pipeline_stage_in_use',
                        message: 'No se puede cambiar el slug o resultado de una etapa que contiene oportunidades o negocios.',
                        stageId: current.id,
                        opportunityCount: usage.opportunityCount,
                        dealCount: usage.dealCount,
                    });
                }
                if (canonicalizesLegacyAlias && usage.opportunityCount > 0) {
                    await query(
                        `UPDATE opportunities SET stage = 'listo_para_cierre', updated_at = NOW()
                          WHERE stage = 'listo_cierre'`,
                    );
                }
            }

            const removed = existing.filter((stage) => !resolvedIds.has(stage.id));
            for (const stage of removed) {
                const usage = await usageFor(stage);
                if (usage.opportunityCount > 0 || usage.dealCount > 0) {
                    throw new ConflictException({
                        error: 'pipeline_stage_in_use',
                        message: 'No se puede eliminar una etapa que contiene oportunidades o negocios.',
                        stageId: stage.id,
                        opportunityCount: usage.opportunityCount,
                        dealCount: usage.dealCount,
                    });
                }
            }

            // Remove unused stages before final slugs are written. For retained
            // stages whose slug changes, a temporary unique slug also permits A/B
            // swaps without violating the unique index mid-transaction.
            for (const stage of removed) {
                await query(
                    `DELETE FROM pipeline_stages
                      WHERE id = $1::uuid AND tenant_id = $2::uuid AND pipeline_id = $3::uuid`,
                    [stage.id, tenantId, pipelineId],
                );
            }
            for (const stage of resolved) {
                if (stage.current && stage.current.slug !== stage.slug) {
                    await query(
                        `UPDATE pipeline_stages SET slug = $1
                          WHERE id = $2::uuid AND tenant_id = $3::uuid AND pipeline_id = $4::uuid`,
                        [`__bulk_${stage.current.id.replace(/-/g, '')}`, stage.current.id, tenantId, pipelineId],
                    );
                }
            }

            for (const stage of resolved) {
                const params = [
                    stage.name,
                    stage.slug,
                    stage.color,
                    stage.position,
                    stage.default_probability,
                    stage.sla_hours,
                    stage.is_terminal,
                    stage.terminal_outcome,
                    JSON.stringify(stage.transition_rules),
                    tenantId,
                ];
                if (stage.current) {
                    await query(
                        `UPDATE pipeline_stages
                            SET name = $1, slug = $2, color = $3, position = $4,
                                default_probability = $5, sla_hours = $6,
                                is_terminal = $7, terminal_outcome = $8,
                                transition_rules = $9::jsonb
                          WHERE id = $11::uuid AND tenant_id = $10::uuid AND pipeline_id = $12::uuid`,
                        [...params, stage.current.id, pipelineId],
                    );
                } else {
                    await query(
                        `INSERT INTO pipeline_stages
                            (tenant_id, name, slug, color, position, default_probability,
                             sla_hours, is_terminal, terminal_outcome, transition_rules, pipeline_id)
                         VALUES ($10::uuid, $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $11::uuid)`,
                        [...params, pipelineId],
                    );
                }
            }

            return query<any[]>(
                `SELECT * FROM pipeline_stages
                  WHERE tenant_id = $1::uuid AND pipeline_id = $2::uuid
                  ORDER BY position ASC`,
                [tenantId, pipelineId],
            );
        });

        return { success: true, data };
    }

    @Put('pipeline-stages/:tenantId/:stageId')
    @Roles('tenant_admin', 'tenant_supervisor')
    async updatePipelineStage(
        @Param('tenantId') tenantId: string,
        @Param('stageId') stageId: string,
        @Body() body: Record<string, any>,
    ) {
        const schema = await this.getSchema(tenantId);
        if (body.slug !== undefined) body.slug = canonicalPipelineStageSlug(String(body.slug));
        await this.prisma.transactionInTenantSchema(schema, async (query) => {
            const { pipelineId } = await ensurePrimaryPipeline(query, tenantId);
            const currentRows = await query<any[]>(
                `SELECT slug, is_terminal, terminal_outcome, default_probability
                   FROM pipeline_stages
                  WHERE id = $1::uuid AND tenant_id = $2::uuid AND pipeline_id = $3::uuid
                  FOR UPDATE`,
                [stageId, tenantId, pipelineId],
            );
            const current = currentRows?.[0];
            if (!current) throw new BadRequestException('Stage not found');

            if (['slug', 'is_terminal', 'terminal_outcome', 'default_probability'].some((field) => body[field] !== undefined)) {
                const isTerminal = body.is_terminal ?? current.is_terminal;
                const outcome = body.terminal_outcome ?? current.terminal_outcome;
                if (isTerminal && outcome !== 'won' && outcome !== 'lost') {
                    throw new BadRequestException('Una etapa terminal requiere terminal_outcome: won o lost');
                }
                if (!isTerminal && body.terminal_outcome != null) {
                    throw new BadRequestException('Una etapa no terminal no admite terminal_outcome');
                }
                body.terminal_outcome = isTerminal ? outcome : null;

                const changesStageIdentity =
                    (body.slug !== undefined && body.slug !== current.slug)
                    || (body.is_terminal !== undefined && body.is_terminal !== current.is_terminal)
                    || (body.terminal_outcome !== undefined && body.terminal_outcome !== current.terminal_outcome);
                if (changesStageIdentity) {
                    const usage = await query<any[]>(
                        `SELECT
                            (SELECT COUNT(*)::int FROM opportunities WHERE stage = $1) AS opportunity_count,
                            (SELECT COUNT(*)::int FROM deals WHERE stage_id = $2::uuid) AS deal_count`,
                        [current.slug, stageId],
                    );
                    const opportunityCount = Number(usage?.[0]?.opportunity_count || 0);
                    const dealCount = Number(usage?.[0]?.deal_count || 0);
                    if (opportunityCount > 0 || dealCount > 0) {
                        throw new ConflictException({
                            error: 'pipeline_stage_in_use',
                            message: 'No se puede cambiar el slug o resultado de una etapa que contiene oportunidades o negocios.',
                            opportunityCount,
                            dealCount,
                        });
                    }
                }
            }

            const allowed = ['name', 'slug', 'color', 'position', 'default_probability', 'sla_hours', 'is_terminal', 'terminal_outcome', 'transition_rules'];
            const fields = Object.keys(body).filter(k => allowed.includes(k) && body[k] !== undefined);
            if (fields.length === 0) return;

            const setClause = fields.map((k, i) => `${k} = $${i + 2}${k === 'transition_rules' ? '::jsonb' : ''}`).join(', ');
            const values = [stageId, ...fields.map(k => k === 'transition_rules' ? JSON.stringify(body[k]) : body[k])];

            await query(
                `UPDATE pipeline_stages SET ${setClause}
                  WHERE id = $1::uuid
                    AND tenant_id = $${values.length + 1}::uuid
                    AND pipeline_id = $${values.length + 2}::uuid`,
                [...values, tenantId, pipelineId],
            );
        });
        return { success: true, message: 'Stage updated' };
    }

    @Delete('pipeline-stages/:tenantId/:stageId')
    @Roles('tenant_admin', 'tenant_supervisor')
    async deletePipelineStage(
        @Param('tenantId') tenantId: string,
        @Param('stageId') stageId: string,
    ) {
        const schema = await this.getSchema(tenantId);
        await this.prisma.transactionInTenantSchema(schema, async (query) => {
            const { pipelineId } = await ensurePrimaryPipeline(query, tenantId);
            const stages = await query<any[]>(
                `SELECT id, slug FROM pipeline_stages
                  WHERE id = $1::uuid AND tenant_id = $2::uuid AND pipeline_id = $3::uuid
                  FOR UPDATE`,
                [stageId, tenantId, pipelineId],
            );
            if (!stages?.[0]) throw new BadRequestException('Stage not found');
            const usage = await query<any[]>(
                `SELECT
                    (SELECT COUNT(*)::int FROM opportunities WHERE stage = $1) AS opportunity_count,
                    (SELECT COUNT(*)::int FROM deals WHERE stage_id = $2::uuid) AS deal_count`,
                [stages[0].slug, stageId],
            );
            const opportunityCount = Number(usage?.[0]?.opportunity_count || 0);
            const dealCount = Number(usage?.[0]?.deal_count || 0);
            if (opportunityCount > 0 || dealCount > 0) {
                throw new ConflictException({
                    error: 'pipeline_stage_in_use',
                    message: 'No se puede eliminar una etapa que contiene oportunidades o negocios.',
                    opportunityCount,
                    dealCount,
                });
            }
            await query(
                `DELETE FROM pipeline_stages
                  WHERE id = $1::uuid AND tenant_id = $2::uuid AND pipeline_id = $3::uuid`,
                [stageId, tenantId, pipelineId],
            );
        });
        return { success: true, message: 'Stage deleted' };
    }

    @Put('pipeline-stages/:tenantId/reorder')
    @Roles('tenant_admin', 'tenant_supervisor')
    async reorderPipelineStages(
        @Param('tenantId') tenantId: string,
        @Body() body: { stageIds: string[] },
    ) {
        const schema = await this.getSchema(tenantId);
        if (!Array.isArray(body.stageIds) || body.stageIds.length === 0
            || body.stageIds.some((id) => !UUID_PATTERN.test(id))
            || new Set(body.stageIds).size !== body.stageIds.length) {
            throw new BadRequestException('stageIds inválidos');
        }
        await this.prisma.transactionInTenantSchema(schema, async (query) => {
            const { pipelineId } = await ensurePrimaryPipeline(query, tenantId);
            const locked = await query<any[]>(
                `SELECT id FROM pipeline_stages
                  WHERE tenant_id = $1::uuid AND pipeline_id = $2::uuid
                  FOR UPDATE`,
                [tenantId, pipelineId],
            );
            const existing = new Set((locked || []).map((stage: any) => stage.id));
            if (body.stageIds.length !== existing.size || body.stageIds.some((id) => !existing.has(id))) {
                throw new BadRequestException('La lista de orden debe contener exactamente todas las etapas del pipeline');
            }
            for (let i = 0; i < body.stageIds.length; i++) {
                await query(
                    `UPDATE pipeline_stages SET position = $1
                      WHERE id = $2::uuid AND tenant_id = $3::uuid AND pipeline_id = $4::uuid`,
                    [i, body.stageIds[i], tenantId, pipelineId],
                );
            }
        });
        return { success: true, message: 'Stages reordered' };
    }
}
