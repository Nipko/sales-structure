import { Controller, Get, Post, Put, Body, Query, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentTenant } from '../../common/decorators/tenant.decorator';
import { ChannelManagerService, ChannelManagerConfig } from './channel-manager.service';

@ApiTags('channel-manager')
@Controller('channel-manager')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class ChannelManagerController {
    constructor(private readonly cm: ChannelManagerService) {}

    @Get('config')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Get channel manager config' })
    async getConfig(@CurrentUser() user: any) {
        const config = await this.cm.getConfig(user.tenantId);
        return {
            success: true,
            data: config ? { ...config, apiKey: config.apiKey ? '***' : undefined, apiSecret: config.apiSecret ? '***' : undefined } : null,
        };
    }

    @Put('config')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Update channel manager config' })
    async updateConfig(@CurrentUser() user: any, @Body() body: Partial<ChannelManagerConfig>) {
        const config = await this.cm.updateConfig(user.tenantId, body);
        return {
            success: true,
            data: { ...config, apiKey: config.apiKey ? '***' : undefined, apiSecret: config.apiSecret ? '***' : undefined },
        };
    }

    @Get('listings')
    @ApiOperation({ summary: 'List all property listings' })
    async listListings(@CurrentTenant() schema: string) {
        const listings = await this.cm.listListings(schema);
        return { success: true, data: listings };
    }

    @Post('listings')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Create a new listing' })
    async createListing(@CurrentTenant() schema: string, @Body() body: any) {
        const listing = await this.cm.createListing(schema, body);
        return { success: true, data: listing };
    }

    @Get('reservations')
    @ApiOperation({ summary: 'List reservations' })
    async listReservations(
        @CurrentTenant() schema: string,
        @Query('listingId') listingId?: string,
        @Query('status') status?: string,
        @Query('fromDate') fromDate?: string,
        @Query('toDate') toDate?: string,
    ) {
        const reservations = await this.cm.listReservations(schema, { listingId, status, fromDate, toDate });
        return { success: true, data: reservations };
    }

    @Post('reservations')
    @ApiOperation({ summary: 'Create a reservation' })
    async createReservation(@CurrentTenant() schema: string, @Body() body: any) {
        const reservation = await this.cm.createReservation(schema, body);
        return { success: true, data: reservation };
    }

    @Get('availability')
    @ApiOperation({ summary: 'Get availability calendar for a listing' })
    async getAvailability(
        @CurrentTenant() schema: string,
        @Query('listingId') listingId: string,
        @Query('from') from: string,
        @Query('to') to: string,
    ) {
        const availability = await this.cm.getAvailability(schema, listingId, from, to);
        return { success: true, data: availability };
    }

    @Post('sync/hostaway')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Sync listings and reservations from Hostaway' })
    async syncHostaway(@CurrentUser() user: any) {
        const result = await this.cm.syncHostaway(user.tenantId);
        return { success: true, data: result };
    }
}
