import { Controller, Get, Post, Put, Body, Param, Query, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CarlaService } from './carla.service';

@ApiTags('carla')
@Controller('carla')
export class CarlaController {
    private readonly logger = new Logger(CarlaController.name);

    constructor(private readonly carlaService: CarlaService) {}

    private schemaFor(tenantId: string) {
        return `tenant_${tenantId.replace(/-/g, '_')}`;
    }

    // ─── Personality Profiles ─────────────────────────────────────────────────

    @Get('profiles/:tenantId')
    @ApiOperation({ summary: 'List Carla personality profiles' })
    async getProfiles(@Param('tenantId') tenantId: string) {
        return this.carlaService.getProfiles(this.schemaFor(tenantId));
    }

    @Post('profiles/:tenantId')
    @ApiOperation({ summary: 'Create a personality profile' })
    async createProfile(@Param('tenantId') tenantId: string, @Body() payload: any) {
        return this.carlaService.createProfile(this.schemaFor(tenantId), { ...payload, tenant_id: tenantId });
    }

    @Put('profiles/:tenantId/:id')
    @ApiOperation({ summary: 'Update a personality profile' })
    async updateProfile(@Param('tenantId') tenantId: string, @Param('id') id: string, @Body() payload: any) {
        return this.carlaService.updateProfile(this.schemaFor(tenantId), id, payload);
    }

    // ─── Prompt Templates ─────────────────────────────────────────────────────

    @Get('prompts/:tenantId')
    @ApiOperation({ summary: 'List Carla prompt templates' })
    async getPrompts(@Param('tenantId') tenantId: string) {
        return this.carlaService.getPromptTemplates(this.schemaFor(tenantId));
    }

    @Post('prompts/:tenantId')
    @ApiOperation({ summary: 'Create a prompt template' })
    async createPrompt(@Param('tenantId') tenantId: string, @Body() payload: any) {
        return this.carlaService.createPromptTemplate(this.schemaFor(tenantId), { ...payload, tenant_id: tenantId });
    }

    @Put('prompts/:tenantId/:id')
    @ApiOperation({ summary: 'Update a prompt template' })
    async updatePrompt(@Param('tenantId') tenantId: string, @Param('id') id: string, @Body() payload: any) {
        return this.carlaService.updatePromptTemplate(this.schemaFor(tenantId), id, payload);
    }

    // ─── Context ──────────────────────────────────────────────────────────────

    @Get('context/:tenantId')
    @ApiOperation({ summary: 'List recent conversation contexts' })
    async getContexts(@Param('tenantId') tenantId: string, @Query('conversationId') conversationId?: string) {
        return this.carlaService.getConversationContexts(this.schemaFor(tenantId), conversationId);
    }

    @Get('context/:tenantId/build/:conversationId')
    @ApiOperation({ summary: 'Build full Carla context for a conversation' })
    async buildContext(@Param('tenantId') tenantId: string, @Param('conversationId') conversationId: string) {
        return this.carlaService.buildCarlaContext(this.schemaFor(tenantId), tenantId, conversationId);
    }
}
