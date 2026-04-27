import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
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
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';

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
        private prisma: PrismaService,
    ) {}

    // ---- Kanban (Pipeline Board using Opportunities) ----

    @Get('kanban/:tenantId')
    async getKanban(@Param('tenantId') tenantId: string) {
        const kanban = await this.oppsRepo.getKanban(tenantId);
        return { success: true, data: kanban };
    }

    @Put('kanban/:tenantId/:opportunityId/move')
    async moveOpportunity(
        @Param('tenantId') tenantId: string,
        @Param('opportunityId') opportunityId: string,
        @Body() body: { stage: string },
    ) {
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
    async createLead(
        @Param('tenantId') tenantId: string,
        @Body() body: Record<string, any>,
    ) {
        const lead = await this.leadsRepo.createLead(tenantId, body);
        return { success: true, data: lead };
    }

    @Put('leads/:tenantId/:leadId')
    async updateLead(
        @Param('tenantId') tenantId: string,
        @Param('leadId') leadId: string,
        @Body() body: Record<string, any>,
    ) {
        const { tags, ...leadData } = body;
        if (Object.keys(leadData).length > 0) {
            await this.leadsRepo.updateLead(tenantId, leadId, leadData);
        }
        if (Array.isArray(tags)) {
            await this.leadsRepo.updateLeadTags(tenantId, leadId, tags);
        }
        return { success: true, message: 'Lead updated' };
    }

    @Post('leads/:tenantId/bulk-update')
    async bulkUpdateLeads(
        @Param('tenantId') tenantId: string,
        @Body() body: { leadIds: string[]; action: string; payload: any },
    ) {
        const result = await this.leadsRepo.bulkUpdate(tenantId, body.leadIds, body.action, body.payload || {});
        return { success: true, data: result };
    }

    @Delete('leads/:tenantId/:leadId')
    async archiveLead(
        @Param('tenantId') tenantId: string,
        @Param('leadId') leadId: string,
    ) {
        await this.leadsRepo.archiveLead(tenantId, leadId);
        return { success: true, message: 'Lead archived' };
    }

    @Put('leads/:tenantId/:leadId/restore')
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
    async createOpportunity(
        @Param('tenantId') tenantId: string,
        @Body() body: Record<string, any>,
    ) {
        const data = await this.oppsRepo.createOpportunity(tenantId, body);
        return { success: true, data };
    }

    @Put('opportunities/:tenantId/:opportunityId')
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
    async createCustomAttribute(@Param('tenantId') tenantId: string, @Body() body: any) {
        const data = await this.customAttrs.createDefinition(tenantId, body);
        return { success: true, data };
    }

    @Put('custom-attributes/:tenantId/:id')
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
    async createSegment(@Param('tenantId') tenantId: string, @Body() body: any) {
        const data = await this.segmentsService.createSegment(tenantId, body);
        return { success: true, data };
    }

    @Put('segments/:tenantId/:segmentId')
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
    async importCSV(
        @Param('tenantId') tenantId: string,
        @Body() body: { csvContent: string; options?: { skipDuplicates?: boolean } },
    ) {
        const result = await this.importExportService.importCSV(tenantId, body.csvContent, body.options);
        return { success: true, data: result };
    }

    @Get('export/:tenantId')
    async exportCSV(
        @Param('tenantId') tenantId: string,
        @Query('segmentId') segmentId?: string,
    ) {
        const csvString = await this.importExportService.exportCSV(tenantId, segmentId);
        return { success: true, data: csvString };
    }

    @Get('import-template')
    async getImportTemplate() {
        const template = this.importExportService.getImportTemplate();
        return { success: true, data: template };
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

    @Get('pipeline-stages/:tenantId')
    async getPipelineStages(@Param('tenantId') tenantId: string) {
        const schema = await this.getSchema(tenantId);
        const stages = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT * FROM pipeline_stages WHERE tenant_id = $1 ORDER BY position ASC`,
            [tenantId],
        );
        return { success: true, data: stages || [] };
    }

    @Post('pipeline-stages/:tenantId')
    async createPipelineStage(
        @Param('tenantId') tenantId: string,
        @Body() body: { name: string; slug?: string; color?: string; position?: number; default_probability?: number; sla_hours?: number; is_terminal?: boolean },
    ) {
        const schema = await this.getSchema(tenantId);
        const slug = body.slug || body.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        const result = await this.prisma.executeInTenantSchema<any[]>(schema,
            `INSERT INTO pipeline_stages (tenant_id, name, slug, color, position, default_probability, sla_hours, is_terminal)
             VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [tenantId, body.name, slug, body.color || '#3498db', body.position ?? 0, body.default_probability ?? 0, body.sla_hours || null, body.is_terminal ?? false],
        );
        return { success: true, data: result?.[0] };
    }

    @Put('pipeline-stages/:tenantId/:stageId')
    async updatePipelineStage(
        @Param('tenantId') tenantId: string,
        @Param('stageId') stageId: string,
        @Body() body: Record<string, any>,
    ) {
        const schema = await this.getSchema(tenantId);
        const allowed = ['name', 'slug', 'color', 'position', 'default_probability', 'sla_hours', 'is_terminal'];
        const fields = Object.keys(body).filter(k => allowed.includes(k) && body[k] !== undefined);
        if (fields.length === 0) return { success: true };

        const setClause = fields.map((k, i) => `${k} = $${i + 2}`).join(', ');
        const values = [stageId, ...fields.map(k => body[k])];

        await this.prisma.executeInTenantSchema(schema,
            `UPDATE pipeline_stages SET ${setClause} WHERE id = $1::uuid`,
            values,
        );
        return { success: true, message: 'Stage updated' };
    }

    @Delete('pipeline-stages/:tenantId/:stageId')
    async deletePipelineStage(
        @Param('tenantId') tenantId: string,
        @Param('stageId') stageId: string,
    ) {
        const schema = await this.getSchema(tenantId);
        await this.prisma.executeInTenantSchema(schema,
            `DELETE FROM pipeline_stages WHERE id = $1::uuid AND tenant_id = $2::uuid`,
            [stageId, tenantId],
        );
        return { success: true, message: 'Stage deleted' };
    }

    @Put('pipeline-stages/:tenantId/reorder')
    async reorderPipelineStages(
        @Param('tenantId') tenantId: string,
        @Body() body: { stageIds: string[] },
    ) {
        const schema = await this.getSchema(tenantId);
        for (let i = 0; i < body.stageIds.length; i++) {
            await this.prisma.executeInTenantSchema(schema,
                `UPDATE pipeline_stages SET position = $1 WHERE id = $2::uuid AND tenant_id = $3::uuid`,
                [i, body.stageIds[i], tenantId],
            );
        }
        return { success: true, message: 'Stages reordered' };
    }
}
