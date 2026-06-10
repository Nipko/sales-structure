import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Headers,
    Req,
    Logger,
    UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { CustomerPortalService } from './customer-portal.service';

@ApiTags('customer-portal')
@Controller('portal')
export class CustomerPortalController {
    private readonly logger = new Logger(CustomerPortalController.name);

    constructor(private readonly portalService: CustomerPortalService) {}

    // ---- Auth Endpoints (no token required) ----

    @Post(':tenantId/request-access')
    @ApiOperation({ summary: 'Request portal access — sends a 6-digit code via WhatsApp or email' })
    async requestAccess(
        @Param('tenantId') tenantId: string,
        @Body() body: { phone?: string; email?: string },
        @Req() req: Request,
    ) {
        const result = await this.portalService.requestAccess(tenantId, body, req.ip);
        return {
            success: true,
            data: {
                message: `Verification code sent via ${result.channel}`,
                channel: result.channel,
                identifier: result.identifier,
            },
        };
    }

    @Post(':tenantId/verify')
    @ApiOperation({ summary: 'Verify 6-digit code and receive a portal JWT' })
    async verify(
        @Param('tenantId') tenantId: string,
        @Body() body: { code: string; phone?: string; email?: string },
    ) {
        const result = await this.portalService.verifyCode(tenantId, body);
        return {
            success: true,
            data: {
                token: result.token,
                expiresIn: result.expiresIn,
                contactId: result.contactId,
            },
        };
    }

    // ---- Protected Endpoints (X-Portal-Token required) ----

    @Get(':tenantId/profile')
    @ApiOperation({ summary: 'Get the authenticated customer profile' })
    @ApiHeader({ name: 'X-Portal-Token', description: 'Customer portal JWT', required: true })
    async getProfile(
        @Param('tenantId') tenantId: string,
        @Headers('x-portal-token') token: string,
    ) {
        const { sub: contactId } = await this.verifyToken(token, tenantId);
        const profile = await this.portalService.getProfile(tenantId, contactId);
        return { success: true, data: profile };
    }

    @Get(':tenantId/conversations')
    @ApiOperation({ summary: 'Get conversation history for the authenticated customer' })
    @ApiHeader({ name: 'X-Portal-Token', description: 'Customer portal JWT', required: true })
    async getConversations(
        @Param('tenantId') tenantId: string,
        @Headers('x-portal-token') token: string,
    ) {
        const { sub: contactId } = await this.verifyToken(token, tenantId);
        const conversations = await this.portalService.getConversations(tenantId, contactId);
        return { success: true, data: conversations };
    }

    @Get(':tenantId/appointments')
    @ApiOperation({ summary: 'Get upcoming appointments for the authenticated customer' })
    @ApiHeader({ name: 'X-Portal-Token', description: 'Customer portal JWT', required: true })
    async getAppointments(
        @Param('tenantId') tenantId: string,
        @Headers('x-portal-token') token: string,
    ) {
        const { sub: contactId } = await this.verifyToken(token, tenantId);
        const appointments = await this.portalService.getAppointments(tenantId, contactId);
        return { success: true, data: appointments };
    }

    @Get(':tenantId/orders')
    @ApiOperation({ summary: 'Get order history for the authenticated customer' })
    @ApiHeader({ name: 'X-Portal-Token', description: 'Customer portal JWT', required: true })
    async getOrders(
        @Param('tenantId') tenantId: string,
        @Headers('x-portal-token') token: string,
    ) {
        const { sub: contactId } = await this.verifyToken(token, tenantId);
        const orders = await this.portalService.getOrders(tenantId, contactId);
        return { success: true, data: orders };
    }

    // ---- Private Helpers ----

    /**
     * Verify the X-Portal-Token header and ensure it belongs to the correct tenant.
     */
    private async verifyToken(
        token: string,
        tenantId: string,
    ): Promise<{ sub: string; tenantId: string; type: string }> {
        if (!token) {
            throw new UnauthorizedException('X-Portal-Token header is required');
        }

        const payload = await this.portalService.verifyPortalToken(token);

        if (payload.tenantId !== tenantId) {
            throw new UnauthorizedException('Token does not match the requested tenant');
        }

        return payload;
    }
}
