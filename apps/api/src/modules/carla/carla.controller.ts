import { Controller, Get, Post, Put, Body, Param, Query, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { CarlaService } from './carla.service';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';

@ApiTags('carla')
@Controller('carla')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class CarlaController {
    private readonly logger = new Logger(CarlaController.name);

    constructor(
        private readonly carlaService: CarlaService,
        private readonly prisma: PrismaService,
    ) {}

    private async schemaFor(tenantId: string) {
        return this.prisma.getTenantSchemaName(tenantId);
    }

    // ─── Personality Profiles ─────────────────────────────────────────────────

    @Get('profiles/:tenantId')
    @ApiOperation({ summary: 'List Carla personality profiles' })
    async getProfiles(@Param('tenantId') tenantId: string) {
        return this.carlaService.getProfiles(await this.schemaFor(tenantId));
    }

    @Post('profiles/:tenantId')
    @ApiOperation({ summary: 'Create a personality profile' })
    async createProfile(@Param('tenantId') tenantId: string, @Body() payload: any) {
        return this.carlaService.createProfile(await this.schemaFor(tenantId), { ...payload, tenant_id: tenantId });
    }

    @Put('profiles/:tenantId/:id')
    @ApiOperation({ summary: 'Update a personality profile' })
    async updateProfile(@Param('tenantId') tenantId: string, @Param('id') id: string, @Body() payload: any) {
        return this.carlaService.updateProfile(await this.schemaFor(tenantId), id, payload);
    }

    // ─── Prompt Templates ─────────────────────────────────────────────────────

    @Get('prompts/:tenantId')
    @ApiOperation({ summary: 'List Carla prompt templates' })
    async getPrompts(@Param('tenantId') tenantId: string) {
        return this.carlaService.getPromptTemplates(await this.schemaFor(tenantId));
    }

    @Post('prompts/:tenantId')
    @ApiOperation({ summary: 'Create a prompt template' })
    async createPrompt(@Param('tenantId') tenantId: string, @Body() payload: any) {
        return this.carlaService.createPromptTemplate(await this.schemaFor(tenantId), { ...payload, tenant_id: tenantId });
    }

    @Put('prompts/:tenantId/:id')
    @ApiOperation({ summary: 'Update a prompt template' })
    async updatePrompt(@Param('tenantId') tenantId: string, @Param('id') id: string, @Body() payload: any) {
        return this.carlaService.updatePromptTemplate(await this.schemaFor(tenantId), id, payload);
    }

    // ─── Context ──────────────────────────────────────────────────────────────

    @Get('context/:tenantId')
    @ApiOperation({ summary: 'List recent conversation contexts' })
    async getContexts(@Param('tenantId') tenantId: string, @Query('conversationId') conversationId?: string) {
        return this.carlaService.getConversationContexts(await this.schemaFor(tenantId), conversationId);
    }

    @Get('context/:tenantId/build/:conversationId')
    @ApiOperation({ summary: 'Build full Carla context for a conversation' })
    async buildContext(@Param('tenantId') tenantId: string, @Param('conversationId') conversationId: string) {
        return this.carlaService.buildCarlaContext(await this.schemaFor(tenantId), tenantId, conversationId);
    }
}
