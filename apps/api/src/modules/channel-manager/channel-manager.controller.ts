import { Controller, Get, Post, Put, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { CurrentUser, CurrentTenant } from '../../common/decorators/tenant.decorator';
import { ChannelManagerService } from './channel-manager.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import {
    ChannelManagerAvailabilityQueryDto,
    ChannelManagerReservationQueryDto,
    CreateChannelManagerListingDto,
    CreateChannelManagerReservationDto,
    MapChannelManagerListingDto,
    UpdateChannelManagerConfigDto,
} from './channel-manager.dto';

@ApiTags('channel-manager')
@Controller('channel-manager')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard, FeatureGuard)
@RequireFeature('channelManager')
@ApiBearerAuth()
export class ChannelManagerController {
    constructor(
        private readonly cm: ChannelManagerService,
        private readonly throttle: TenantThrottleService,
    ) {}

    @Get('config')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Get channel manager config' })
    async getConfig(@CurrentUser() user: any) {
        // El panel nunca descifra: sólo necesita saber si hay credencial.
        return { success: true, data: await this.cm.getRedactedConfig(user.tenantId) };
    }

    @Put('config')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Update channel manager config' })
    async updateConfig(@CurrentUser() user: any, @Body() body: UpdateChannelManagerConfigDto) {
        const config = await this.cm.updateConfig(user.tenantId, body);
        return {
            success: true,
            data: { ...config, apiKey: config.apiKey ? '***' : undefined, apiSecret: config.apiSecret ? '***' : undefined },
        };
    }

    @Get('listings')
    @ApiOperation({ summary: 'List all property listings' })
    async listListings(@CurrentTenant() tenantId: string) {
        const listings = await this.cm.listListings(tenantId);
        return { success: true, data: listings };
    }

    @Post('listings')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Create a new listing' })
    async createListing(
        @CurrentUser() user: any,
        @CurrentTenant() tenantId: string,
        @Body() body: CreateChannelManagerListingDto,
    ) {
        const existing = await this.cm.listListings(tenantId);
        await this.throttle.enforcePlanLimit(user.tenantId, 'maxProperties', existing?.length ?? 0, 'propiedades');
        const listing = await this.cm.createListing(tenantId, body);
        return { success: true, data: listing };
    }

    @Get('reservations')
    @ApiOperation({ summary: 'List reservations' })
    async listReservations(
        @CurrentTenant() tenantId: string,
        @Query() query: ChannelManagerReservationQueryDto,
    ) {
        const reservations = await this.cm.listReservations(tenantId, query);
        return { success: true, data: reservations };
    }

    @Post('reservations')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Create a reservation' })
    async createReservation(
        @CurrentTenant() tenantId: string,
        @Body() body: CreateChannelManagerReservationDto,
    ) {
        const reservation = await this.cm.createReservation(tenantId, body);
        return { success: true, data: reservation };
    }

    @Get('availability')
    @ApiOperation({ summary: 'Get availability calendar for a listing' })
    async getAvailability(
        @CurrentTenant() tenantId: string,
        @Query() query: ChannelManagerAvailabilityQueryDto,
    ) {
        const availability = await this.cm.getAvailability(tenantId, query.listingId, query.from, query.to);
        return { success: true, data: availability };
    }

    @Get('mappings')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'List which properties are bridged to a channel-manager listing' })
    async listMappings(@CurrentTenant() tenantId: string) {
        const mappings = await this.cm.listMappings(tenantId);
        return { success: true, data: mappings };
    }

    @Put('mappings')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Bridge (or unbridge) a property to a channel-manager listing' })
    async mapListing(@CurrentTenant() tenantId: string, @Body() body: MapChannelManagerListingDto) {
        const propertyId = body?.propertyId === null || body?.propertyId === undefined
            ? null
            : String(body.propertyId);
        const mapping = await this.cm.mapListingToProperty(tenantId, String(body?.listingId || ''), propertyId);
        return { success: true, data: mapping };
    }

    @Post('sync/hostaway')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Sync listings and reservations from Hostaway' })
    async syncHostaway(@CurrentUser() user: any) {
        const result = await this.cm.syncHostaway(user.tenantId);
        return { success: true, data: result };
    }

    @Post('test/hostaway')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Test Hostaway credentials without mutating the mirror' })
    async testHostaway(@CurrentUser() user: any) {
        return { success: true, data: await this.cm.testHostawayConnection(user.tenantId) };
    }
}
