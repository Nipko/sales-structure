import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentUser } from '../../common/decorators/tenant.decorator';
import { AppointmentsService } from './appointments.service';

@ApiTags('appointments')
@Controller('appointments')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class AppointmentsController {
    constructor(private service: AppointmentsService) {}

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
