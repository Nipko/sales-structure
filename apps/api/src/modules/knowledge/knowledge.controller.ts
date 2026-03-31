import {
    Controller, Get, Post, Delete, Body, Param, Query,
    Logger, UseGuards, Req, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeService } from './knowledge.service';

@ApiTags('knowledge')
@Controller('knowledge')
export class KnowledgeController {
    private readonly logger = new Logger(KnowledgeController.name);

    constructor(
        private readonly knowledgeService: KnowledgeService,
        private readonly prisma: PrismaService,
    ) {}

    // ─── Document RAG Endpoints ──────────────────────────────────────────────

    @Post('documents')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @ApiOperation({ summary: 'Upload / ingest a document into the knowledge base' })
    async uploadDocument(@Req() req: any, @Body() payload: { name: string; content: string; mimeType?: string }) {
        const tenantId = req.user?.tenantId;
        return this.knowledgeService.ingestDocument(tenantId, {
            name: payload.name,
            content: payload.content,
            mimeType: payload.mimeType,
        });
    }

    @Get('documents')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @ApiOperation({ summary: 'List all knowledge documents for the tenant' })
    async listDocuments(@Req() req: any) {
        const tenantId = req.user?.tenantId;
        return this.knowledgeService.listDocuments(tenantId);
    }

    @Delete('documents/:id')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Delete a document and all its embeddings' })
    async deleteDocument(@Req() req: any, @Param('id') id: string) {
        const tenantId = req.user?.tenantId;
        await this.knowledgeService.deleteDocument(tenantId, id);
    }

    @Post('search')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @ApiOperation({ summary: 'Search the knowledge base (vector similarity)' })
    async searchKnowledge(
        @Req() req: any,
        @Body() payload: { query: string; topK?: number },
    ) {
        const tenantId = req.user?.tenantId;
        if (!payload.query) return [];
        return this.knowledgeService.searchRelevant(tenantId, payload.query, payload.topK || 5);
    }

    // ─── Legacy Resource Endpoints ───────────────────────────────────────────

    @Get('resources/:tenantId')
    @ApiOperation({ summary: 'List knowledge resources (legacy)' })
    async getResources(
        @Param('tenantId') tenantId: string,
        @Query('status') status?: string,
    ) {
        return this.knowledgeService.getResources(await this.schemaFor(tenantId), status);
    }

    @Get('search/:tenantId')
    @ApiOperation({ summary: 'Search approved knowledge resources (legacy ILIKE)' })
    async searchChunks(
        @Param('tenantId') tenantId: string,
        @Query('query') query: string,
        @Query('limit') limit?: number,
    ) {
        if (!query) return [];
        return this.knowledgeService.searchChunks(await this.schemaFor(tenantId), query, limit ? Number(limit) : 5);
    }

    private async schemaFor(tenantId: string): Promise<string> {
        return this.prisma.getTenantSchemaName(tenantId);
    }
}
