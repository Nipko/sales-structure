import { Controller, Get, Post, Put, Delete, Param, Body, Query, Res, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentUser } from '../../common/decorators/tenant.decorator';
import { AppointmentsService } from './appointments.service';
import { ServicesService } from './services.service';
import { CalendarIntegrationService } from './calendar-integration.service';

@ApiTags('appointments')
@Controller('appointments')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class AppointmentsController {
    constructor(
        private service: AppointmentsService,
        private servicesService: ServicesService,
        private calendarService: CalendarIntegrationService,
    ) {}

    // ── Services CRUD ────────────────────────────────────────────

    @Get(':tenantId/services')
    async listServices(@Param('tenantId') tenantId: string, @CurrentUser() user: any) {
        const data = await this.servicesService.list(user.schemaName);
        return { success: true, data };
    }

    @Post(':tenantId/services')
    async createService(@Param('tenantId') tenantId: string, @Body() body: any, @CurrentUser() user: any) {
        const data = await this.servicesService.create(user.schemaName, body);
        return { success: true, data };
    }

    @Put(':tenantId/services/:serviceId')
    async updateService(
        @Param('tenantId') tenantId: string,
        @Param('serviceId') serviceId: string,
        @Body() body: any,
        @CurrentUser() user: any,
    ) {
        const data = await this.servicesService.update(user.schemaName, serviceId, body);
        return { success: true, data };
    }

    @Delete(':tenantId/services/:serviceId')
    @HttpCode(HttpStatus.OK)
    async deleteService(@Param('tenantId') tenantId: string, @Param('serviceId') serviceId: string, @CurrentUser() user: any) {
        await this.servicesService.delete(user.schemaName, serviceId);
        return { success: true };
    }

    // ── Service-Staff Assignment ─────────────────────────────────

    @Get(':tenantId/services/:serviceId/staff')
    @ApiOperation({ summary: 'List staff assigned to a service' })
    async getServiceStaff(
        @Param('serviceId') serviceId: string,
        @CurrentUser() user: any,
    ) {
        const data = await this.servicesService.getStaff(user.schemaName, serviceId);
        return { success: true, data };
    }

    @Post(':tenantId/services/:serviceId/staff')
    @ApiOperation({ summary: 'Assign staff to a service' })
    async assignStaff(
        @Param('serviceId') serviceId: string,
        @Body() body: { userId: string; isPrimary?: boolean },
        @CurrentUser() user: any,
    ) {
        await this.servicesService.assignStaff(user.schemaName, serviceId, body.userId, body.isPrimary);
        return { success: true };
    }

    @Delete(':tenantId/services/:serviceId/staff/:userId')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Remove staff from a service' })
    async removeStaff(
        @Param('serviceId') serviceId: string,
        @Param('userId') userId: string,
        @CurrentUser() user: any,
    ) {
        await this.servicesService.removeStaff(user.schemaName, serviceId, userId);
        return { success: true };
    }

    // ── Calendar Integrations ────────────────────────────────────

    @Get(':tenantId/calendar/integrations')
    async listCalendarIntegrations(@Param('tenantId') tenantId: string, @CurrentUser() user: any) {
        const data = await this.calendarService.listIntegrations(user.schemaName, user.id);
        return { success: true, data };
    }

    @Get(':tenantId/calendar/events')
    @ApiOperation({ summary: 'List external calendar events (Google/Microsoft)' })
    async listCalendarEvents(
        @Param('tenantId') tenantId: string,
        @Query('startDate') startDate: string,
        @Query('endDate') endDate: string,
        @CurrentUser() user: any,
    ) {
        const events = await this.calendarService.listExternalEvents(user.schemaName, user.id, startDate, endDate);
        return { success: true, data: events };
    }

    @Get(':tenantId/calendar/google/connect')
    async connectGoogle(@Param('tenantId') tenantId: string, @CurrentUser() user: any, @Res() res: Response) {
        const url = this.calendarService.getGoogleAuthUrl(tenantId, user.id);
        return res.json({ success: true, data: { url } });
    }

    @Get(':tenantId/calendar/microsoft/connect')
    async connectMicrosoft(@Param('tenantId') tenantId: string, @CurrentUser() user: any, @Res() res: Response) {
        const url = this.calendarService.getMicrosoftAuthUrl(tenantId, user.id);
        return res.json({ success: true, data: { url } });
    }

    @Delete(':tenantId/calendar/:integrationId')
    @HttpCode(HttpStatus.OK)
    async disconnectCalendar(@Param('tenantId') tenantId: string, @Param('integrationId') integrationId: string, @CurrentUser() user: any) {
        await this.calendarService.disconnect(user.schemaName, integrationId);
        return { success: true };
    }

    // ── Enhanced slots with service duration + calendar ───────────

    @Get(':tenantId/bookable-slots')
    async getBookableSlots(
        @Param('tenantId') tenantId: string,
        @Query('date') date: string,
        @Query('serviceId') serviceId: string,
        @Query('userId') userId?: string,
        @CurrentUser() user?: any,
    ) {
        const svc = await this.servicesService.getById(user.schemaName, serviceId);

        // Get calendar busy times if agent has connected calendar
        let calendarBusy: { start: string; end: string }[] = [];
        if (userId) {
            const timeMin = `${date}T00:00:00Z`;
            const timeMax = `${date}T23:59:59Z`;
            calendarBusy = await this.calendarService.getFreeBusy(user.schemaName, userId, timeMin, timeMax);
        }

        const slots = await this.service.getBookableSlots(
            user.schemaName, date, svc.durationMinutes, svc.bufferMinutes, userId, calendarBusy,
        );
        return { success: true, data: { service: svc, slots } };
    }

    // ── Static routes FIRST (before :appointmentId catch-all) ────

    @Get(':tenantId/availability')
    @ApiOperation({ summary: 'Get availability slots' })
    async getAvailability(
        @Param('tenantId') tenantId: string,
        @CurrentUser() user: any,
        @Query('userId') userId?: string,
    ) {
        const data = await this.service.getAvailability(user.schemaName, userId);
        return { success: true, data };
    }

    @Post(':tenantId/availability')
    @ApiOperation({ summary: 'Save availability slots for a user' })
    async saveAvailability(
        @Param('tenantId') tenantId: string,
        @Body() body: { userId: string; slots: { dayOfWeek: number; startTime: string; endTime: string; isActive?: boolean }[] },
        @CurrentUser() user: any,
    ) {
        const data = await this.service.saveAvailability(user.schemaName, body.userId, body.slots);
        return { success: true, data };
    }

    @Get(':tenantId/blocked-dates')
    @ApiOperation({ summary: 'Get blocked dates' })
    async getBlockedDates(
        @Param('tenantId') tenantId: string,
        @CurrentUser() user: any,
    ) {
        const data = await this.service.getBlockedDates(user.schemaName);
        return { success: true, data };
    }

    @Post(':tenantId/blocked-dates')
    @ApiOperation({ summary: 'Block a date' })
    async blockDate(
        @Param('tenantId') tenantId: string,
        @Body() body: { userId?: string; blockedDate: string; reason?: string },
        @CurrentUser() user: any,
    ) {
        const data = await this.service.createBlockedDate(user.schemaName, body);
        return { success: true, data };
    }

    @Delete(':tenantId/blocked-dates/:dateId')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Unblock a date' })
    async unblockDate(
        @Param('tenantId') tenantId: string,
        @Param('dateId') dateId: string,
        @CurrentUser() user: any,
    ) {
        await this.service.deleteBlockedDate(user.schemaName, dateId);
        return { success: true };
    }

    @Get(':tenantId/check-slots')
    @ApiOperation({ summary: 'Check available slots for a date (AI tool)' })
    async checkSlots(
        @Param('tenantId') tenantId: string,
        @Query('date') date: string,
        @Query('userId') userId?: string,
        @CurrentUser() user?: any,
    ) {
        const data = await this.service.checkAvailableSlots(user.schemaName, date, userId);
        return { success: true, data };
    }

    // ── Recurring Appointments ────────────────────────────────

    @Post(':tenantId/recurring')
    @ApiOperation({ summary: 'Create a recurring appointment series' })
    async createRecurring(
        @Param('tenantId') tenantId: string,
        @Body() body: any,
        @CurrentUser() user: any,
    ) {
        const data = await this.service.createRecurring(user.schemaName, body);
        return { success: true, data };
    }

    @Get(':tenantId/recurring/:groupId')
    @ApiOperation({ summary: 'Get all instances of a recurring series' })
    async getRecurringSeries(
        @Param('tenantId') tenantId: string,
        @Param('groupId') groupId: string,
        @CurrentUser() user: any,
    ) {
        const data = await this.service.getSeriesInstances(user.schemaName, groupId);
        return { success: true, data };
    }

    @Put(':tenantId/recurring/:groupId/cancel')
    @ApiOperation({ summary: 'Cancel all future instances of a recurring series' })
    async cancelRecurringSeries(
        @Param('tenantId') tenantId: string,
        @Param('groupId') groupId: string,
        @Body() body: { reason?: string },
        @CurrentUser() user: any,
    ) {
        const cancelled = await this.service.cancelSeries(user.schemaName, groupId, body.reason);
        return { success: true, data: { cancelled } };
    }

    // ── Dynamic routes AFTER static ones ─────────────────────────

    @Get(':tenantId')
    @ApiOperation({ summary: 'List appointments' })
    async list(
        @Param('tenantId') tenantId: string,
        @CurrentUser() user: any,
        @Query('status') status?: string,
        @Query('assignedTo') assignedTo?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
    ) {
        const data = await this.service.list(user.schemaName, { status, assignedTo, startDate, endDate });
        return { success: true, data };
    }

    @Post(':tenantId')
    @ApiOperation({ summary: 'Create an appointment' })
    async create(
        @Param('tenantId') tenantId: string,
        @Body() body: any,
        @CurrentUser() user: any,
    ) {
        const data = await this.service.create(user.schemaName, body);
        return { success: true, data };
    }

    @Put(':tenantId/:appointmentId')
    @ApiOperation({ summary: 'Update an appointment' })
    async update(
        @Param('tenantId') tenantId: string,
        @Param('appointmentId') appointmentId: string,
        @Body() body: any,
        @CurrentUser() user: any,
    ) {
        const data = await this.service.update(user.schemaName, appointmentId, body);
        return { success: true, data };
    }

    @Put(':tenantId/:appointmentId/cancel')
    @ApiOperation({ summary: 'Cancel an appointment' })
    async cancel(
        @Param('tenantId') tenantId: string,
        @Param('appointmentId') appointmentId: string,
        @Body() body: { reason?: string },
        @CurrentUser() user: any,
    ) {
        const data = await this.service.cancel(user.schemaName, appointmentId, body.reason);
        return { success: true, data };
    }

    @Get(':tenantId/:appointmentId')
    @ApiOperation({ summary: 'Get appointment by ID' })
    async getById(
        @Param('tenantId') tenantId: string,
        @Param('appointmentId') appointmentId: string,
        @CurrentUser() user: any,
    ) {
        const data = await this.service.getById(user.schemaName, appointmentId);
        return { success: true, data };
    }
}
