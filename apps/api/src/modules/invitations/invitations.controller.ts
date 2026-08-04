import {
    BadRequestException, Body, Controller, Delete, Get, Param, Post, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsArray, IsEmail, IsIn, IsOptional, IsString } from 'class-validator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { InvitationsService } from './invitations.service';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';

class CreateInvitationDto {
    @IsEmail() email!: string;
    @IsString() @IsIn(['tenant_admin', 'tenant_supervisor', 'tenant_agent']) role!: string;
    @IsOptional() @IsArray() skillTags?: string[];
}

class AcceptInvitationDto {
    @IsString() password!: string;
    @IsString() firstName!: string;
    @IsOptional() @IsString() lastName?: string;
}

/**
 * Invitations API.
 * - /tenants/:tenantId/invitations/* — admin operations (JWT + RolesGuard)
 * - /invitations/by-token/:token/* — public, no auth (token is the cred)
 */
@ApiTags('invitations')
@Controller()
export class InvitationsController {
    constructor(private readonly service: InvitationsService) {}

    // ── Admin endpoints ─────────────────────────────────────────────

    @Get('tenants/:tenantId/invitations')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'List invitations for a tenant' })
    async list(@Param('tenantId') tenantId: string) {
        const data = await this.service.list(tenantId);
        return { success: true, data };
    }

    @Post('tenants/:tenantId/invitations')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard, EmailVerifiedGuard)
    @Roles('super_admin', 'tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Create a new invitation' })
    async create(
        @Param('tenantId') tenantId: string,
        @Body() body: CreateInvitationDto,
        @Req() req: any,
    ) {
        const data = await this.service.create({
            tenantId,
            email: body.email,
            role: body.role,
            skillTags: body.skillTags,
            invitedByUserId: req.user?.sub,
        });
        return { success: true, data };
    }

    @Post('tenants/:tenantId/invitations/:id/resend')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard, EmailVerifiedGuard)
    @Roles('super_admin', 'tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Resend invitation email + bump expiration' })
    async resend(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        const data = await this.service.resend(tenantId, id);
        return { success: true, data };
    }

    @Delete('tenants/:tenantId/invitations/:id')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Revoke a pending invitation' })
    async revoke(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        const data = await this.service.revoke(tenantId, id);
        return { success: true, data };
    }

    // ── Public endpoints (no auth — token is the credential) ──────

    @Get('invitations/by-token/:token')
    @ApiOperation({ summary: 'Get invitation info by token (renders accept page)' })
    async getByToken(@Param('token') token: string) {
        const result = await this.service.getByToken(token);
        return { success: result.valid, data: result };
    }

    @Post('invitations/by-token/:token/accept')
    @ApiOperation({ summary: 'Accept invitation (no auth — creates user with assigned role)' })
    async accept(@Param('token') token: string, @Body() body: AcceptInvitationDto) {
        if (!body.password || !body.firstName) {
            throw new BadRequestException('password and firstName are required');
        }
        const data = await this.service.accept(token, body);
        return { success: true, data };
    }
}
