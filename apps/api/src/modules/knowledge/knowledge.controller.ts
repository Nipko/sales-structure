import { Controller, Get, Post, Put, Body, Param, Query, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { KnowledgeService } from './knowledge.service';

@ApiTags('knowledge')
@Controller('knowledge')
export class KnowledgeController {
    private readonly logger = new Logger(KnowledgeController.name);

    constructor(private readonly knowledgeService: KnowledgeService) {}

    private schemaFor(tenantId: string) {
        return `tenant_${tenantId.replace(/-/g, '_')}`;
    }

    // ─── Resources ────────────────────────────────────────────────────────────

    @Get('resources/:tenantId')
    @ApiOperation({ summary: 'List knowledge resources' })
    async getResources(
        @Param('tenantId') tenantId: string,
        @Query('status') status?: string
    ) {
        return this.knowledgeService.getResources(this.schemaFor(tenantId), status);
    }

    @Post('resources/:tenantId')
    @ApiOperation({ summary: 'Create a new knowledge resource (auto-chunks)' })
    async createResource(@Param('tenantId') tenantId: string, @Body() payload: any) {
        return this.knowledgeService.createResource(this.schemaFor(tenantId), { ...payload, tenant_id: tenantId });
    }

    @Put('resources/:tenantId/:id/status')
    @ApiOperation({ summary: 'Update resource status' })
    async updateStatus(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
        @Body() payload: { status: string }
    ) {
        return this.knowledgeService.updateResourceStatus(this.schemaFor(tenantId), id, payload.status);
    }

    // ─── Approvals ────────────────────────────────────────────────────────────

    @Post('resources/:tenantId/:id/approve')
    @ApiOperation({ summary: 'Approve a resource for Carla consumption' })
    async approveResource(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
        @Body() payload: { approved_by: string, notes?: string }
    ) {
        return this.knowledgeService.approveResource(this.schemaFor(tenantId), id, payload.approved_by, payload.notes);
    }

    @Get('resources/:tenantId/:id/approvals')
    async getApprovals(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        return this.knowledgeService.getApprovals(this.schemaFor(tenantId), id);
    }

    // ─── Chunks & Search ──────────────────────────────────────────────────────

    @Get('resources/:tenantId/:id/chunks')
    async getChunks(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        return this.knowledgeService.getChunks(this.schemaFor(tenantId), id);
    }

    @Get('search/:tenantId')
    @ApiOperation({ summary: 'Search approved knowledge resources (RAG Retrieval)' })
    async searchChunks(
        @Param('tenantId') tenantId: string,
        @Query('query') query: string,
        @Query('limit') limit?: number
    ) {
        if (!query) return [];
        return this.knowledgeService.searchChunks(this.schemaFor(tenantId), query, limit ? Number(limit) : 5);
    }
}
