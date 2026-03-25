import { Controller, Get, Post, Put, Body, Param, Query, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { KnowledgeService } from './knowledge.service';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';

@ApiTags('knowledge')
@Controller('knowledge')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class KnowledgeController {
    private readonly logger = new Logger(KnowledgeController.name);

    constructor(
        private readonly knowledgeService: KnowledgeService,
        private readonly prisma: PrismaService,
    ) {}

    private async schemaFor(tenantId: string) {
        return this.prisma.getTenantSchemaName(tenantId);
    }

    // ─── Resources ────────────────────────────────────────────────────────────

    @Get('resources/:tenantId')
    @ApiOperation({ summary: 'List knowledge resources' })
    async getResources(
        @Param('tenantId') tenantId: string,
        @Query('status') status?: string
    ) {
        return this.knowledgeService.getResources(await this.schemaFor(tenantId), status);
    }

    @Post('resources/:tenantId')
    @ApiOperation({ summary: 'Create a new knowledge resource (auto-chunks)' })
    async createResource(@Param('tenantId') tenantId: string, @Body() payload: any) {
        return this.knowledgeService.createResource(await this.schemaFor(tenantId), { ...payload, tenant_id: tenantId });
    }

    @Put('resources/:tenantId/:id/status')
    @ApiOperation({ summary: 'Update resource status' })
    async updateStatus(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
        @Body() payload: { status: string }
    ) {
        return this.knowledgeService.updateResourceStatus(await this.schemaFor(tenantId), id, payload.status);
    }

    // ─── Approvals ────────────────────────────────────────────────────────────

    @Post('resources/:tenantId/:id/approve')
    @ApiOperation({ summary: 'Approve a resource for Carla consumption' })
    async approveResource(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
        @Body() payload: { approved_by: string, notes?: string }
    ) {
        return this.knowledgeService.approveResource(await this.schemaFor(tenantId), id, payload.approved_by, payload.notes);
    }

    @Get('resources/:tenantId/:id/approvals')
    async getApprovals(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        return this.knowledgeService.getApprovals(await this.schemaFor(tenantId), id);
    }

    // ─── Chunks & Search ──────────────────────────────────────────────────────

    @Get('resources/:tenantId/:id/chunks')
    async getChunks(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        return this.knowledgeService.getChunks(await this.schemaFor(tenantId), id);
    }

    @Get('search/:tenantId')
    @ApiOperation({ summary: 'Search approved knowledge resources (RAG Retrieval)' })
    async searchChunks(
        @Param('tenantId') tenantId: string,
        @Query('query') query: string,
        @Query('limit') limit?: number
    ) {
        if (!query) return [];
        return this.knowledgeService.searchChunks(await this.schemaFor(tenantId), query, limit ? Number(limit) : 5);
    }
}
