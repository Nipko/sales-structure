import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
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
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const result = await this.leadsRepo.listLeads(tenantId, {
            search,
            stage,
            assignedTo,
            courseId,
            isVip: isVip !== undefined ? isVip === 'true' : undefined,
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
        await this.leadsRepo.updateLead(tenantId, leadId, body);
        return { success: true, message: 'Lead updated' };
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
}
