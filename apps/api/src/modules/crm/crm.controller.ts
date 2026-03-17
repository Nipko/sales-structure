import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { ContactsService } from './services/contacts/contacts.service';
import { NotesService } from './services/notes/notes.service';
import { TasksService } from './services/tasks/tasks.service';
import { ActivityService } from './services/activity/activity.service';

@Controller('crm')
export class CrmController {

    constructor(
        private contactsService: ContactsService,
        private notesService: NotesService,
        private tasksService: TasksService,
        private activityService: ActivityService,
    ) {}

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
        const result = await this.contactsService.listLeads(tenantId, {
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
        const data = await this.contactsService.getLead360(tenantId, leadId);
        return { success: true, data };
    }

    @Put('leads/:tenantId/:leadId')
    async updateLead(
        @Param('tenantId') tenantId: string,
        @Param('leadId') leadId: string,
        @Body() body: Record<string, any>,
    ) {
        await this.contactsService.updateLead(tenantId, leadId, body);
        return { success: true, message: 'Lead updated' };
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
}
