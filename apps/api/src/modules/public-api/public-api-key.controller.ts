import { Controller, Get, Post, Delete, Param, Body, Request, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PublicApiKeyService } from './public-api-key.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

@ApiTags('public-api-keys')
@Controller('public-api/keys')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@Roles('super_admin', 'tenant_admin')
export class PublicApiKeyController {
    constructor(private readonly apiKeyService: PublicApiKeyService) {}

    @Get(':tenantId')
    async list(@Param('tenantId') tenantId: string) {
        const keys = await this.apiKeyService.listKeys(tenantId);
        return { success: true, data: keys };
    }

    @Post(':tenantId')
    async create(
        @Param('tenantId') tenantId: string,
        @Request() req: any,
        @Body() body: CreateApiKeyDto,
    ) {
        const result = await this.apiKeyService.createKey(tenantId, req.user?.sub, {
            name: body.name,
            scopes: body.scopes,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        });
        return { success: true, data: result };
    }

    @Delete(':tenantId/:keyId')
    async revoke(
        @Param('tenantId') tenantId: string,
        @Param('keyId') keyId: string,
    ) {
        await this.apiKeyService.revokeKey(tenantId, keyId);
        return { success: true, message: 'API key revoked' };
    }

    @Post(':tenantId/:keyId/rotate')
    async rotate(
        @Param('tenantId') tenantId: string,
        @Param('keyId') keyId: string,
    ) {
        const result = await this.apiKeyService.rotateKey(tenantId, keyId);
        return { success: true, data: result };
    }
}
