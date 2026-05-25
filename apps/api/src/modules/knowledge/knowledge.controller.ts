import {
    Controller, Get, Post, Put, Delete, Body, Param, Query,
    Logger, UseGuards, Req, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeService } from './knowledge.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';

@ApiTags('knowledge')
@Controller('knowledge')
export class KnowledgeController {
    private readonly logger = new Logger(KnowledgeController.name);

    constructor(
        private readonly knowledgeService: KnowledgeService,
        private readonly prisma: PrismaService,
        private readonly throttle: TenantThrottleService,
    ) {}

    // ─── Document RAG Endpoints ──────────────────────────────────────────────

    @Post('documents')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @ApiOperation({ summary: 'Upload / ingest a document (text or binary PDF/DOCX) into the knowledge base' })
    async uploadDocument(
        @Req() req: any,
        @Body() payload: {
            name: string;
            content?: string;
            fileBase64?: string;
            mimeType?: string;
            category?: string;
            isPublic?: boolean;
        },
    ) {
        const tenantId = req.user?.tenantId;
        return this.knowledgeService.ingestDocument(tenantId, {
            name: payload.name,
            content: payload.content,
            fileBase64: payload.fileBase64,
            mimeType: payload.mimeType,
            category: payload.category,
            isPublic: payload.isPublic,
        });
    }

    @Put('documents/:id')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @ApiOperation({ summary: 'Update a document content (re-chunks and re-embeds)' })
    async updateDocument(
        @Req() req: any,
        @Param('id') id: string,
        @Body() payload: { name?: string; content?: string; fileBase64?: string; mimeType?: string },
    ) {
        const tenantId = req.user?.tenantId;
        return this.knowledgeService.updateDocument(tenantId, id, payload);
    }

    @Get('documents')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @ApiOperation({ summary: 'List all knowledge documents for the tenant' })
    async listDocuments(@Req() req: any, @Query('category') category?: string, @Query('language') language?: string) {
        const tenantId = req.user?.tenantId;
        return this.knowledgeService.listDocuments(tenantId, category, language);
    }

    @Get('documents/categories')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @ApiOperation({ summary: 'List unique document categories' })
    async getCategories(@Req() req: any) {
        const tenantId = req.user?.tenantId;
        return this.knowledgeService.getDocumentCategories(tenantId);
    }

    @Put('documents/:id/meta')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @ApiOperation({ summary: 'Update document metadata (category, public, auto-recrawl) without re-embedding' })
    async updateDocumentMeta(
        @Req() req: any,
        @Param('id') id: string,
        @Body() payload: { name?: string; category?: string; isPublic?: boolean; autoRecrawl?: boolean },
    ) {
        const tenantId = req.user?.tenantId;
        return this.knowledgeService.updateDocumentMeta(tenantId, id, payload);
    }

    @Get('usage/:tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @ApiOperation({ summary: 'Get KB usage stats (embeddings, documents, cost)' })
    async getUsageStats(@Param('tenantId') tenantId: string) {
        return { success: true, data: await this.knowledgeService.getUsageStats(tenantId) };
    }

    @Delete('documents/:id')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Delete a document and all its embeddings' })
    async deleteDocument(@Req() req: any, @Param('id') id: string) {
        const tenantId = req.user?.tenantId;
        await this.knowledgeService.deleteDocument(tenantId, id);
    }

    @Post('documents/bulk')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @ApiOperation({ summary: 'Bulk import multiple documents at once' })
    async bulkUpload(
        @Req() req: any,
        @Body() payload: {
            files: Array<{
                name: string;
                content?: string;
                fileBase64?: string;
                mimeType?: string;
                category?: string;
                isPublic?: boolean;
            }>;
        },
    ) {
        const tenantId = req.user?.tenantId;
        if (!payload.files?.length) return { success: false, error: 'No files provided' };
        if (payload.files.length > 20) return { success: false, error: 'Maximum 20 files per batch' };
        const data = await this.knowledgeService.bulkIngest(tenantId, payload.files);
        return { success: true, data };
    }

    @Get('documents/quality')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @ApiOperation({ summary: 'Get quality scores for all documents' })
    async getQualityScores(@Req() req: any) {
        const tenantId = req.user?.tenantId;
        const data = await this.knowledgeService.getDocumentQualityScores(tenantId);
        return { success: true, data };
    }

    @Post('suggestions/:tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @ApiOperation({ summary: 'AI-generated article suggestions based on unanswered queries' })
    async getSuggestions(
        @Param('tenantId') tenantId: string,
        @Body() payload?: { maxSuggestions?: number },
    ) {
        const features = await this.throttle.getPlanFeatures(tenantId);
        if (!features.knowledgeAnalytics) {
            return { success: false, error: 'plan_upgrade_required' };
        }
        const data = await this.knowledgeService.generateArticleSuggestions(tenantId, payload?.maxSuggestions || 5);
        return { success: true, data };
    }

    @Get('documents/:id/versions')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @ApiOperation({ summary: 'Get version history for a document' })
    async getVersions(@Req() req: any, @Param('id') id: string) {
        const tenantId = req.user?.tenantId;
        const data = await this.knowledgeService.getDocumentVersions(tenantId, id);
        return { success: true, data };
    }

    @Post('documents/:id/restore')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @ApiOperation({ summary: 'Restore a document to a previous version' })
    async restoreVersion(
        @Req() req: any,
        @Param('id') id: string,
        @Body() payload: { versionId: string },
    ) {
        const tenantId = req.user?.tenantId;
        const userId = req.user?.id || req.user?.userId;
        const data = await this.knowledgeService.restoreDocumentVersion(tenantId, id, payload.versionId, userId);
        return { success: true, data };
    }

    @Post('search/advanced')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @ApiOperation({ summary: 'Advanced filtered search across the knowledge base' })
    async advancedSearch(
        @Req() req: any,
        @Body() payload: {
            query: string;
            category?: string;
            sourceType?: string;
            language?: string;
            dateFrom?: string;
            dateTo?: string;
            topK?: number;
        },
    ) {
        const tenantId = req.user?.tenantId;
        if (!payload.query) return { success: true, data: [] };
        const data = await this.knowledgeService.searchFiltered(tenantId, payload.query, payload);
        return { success: true, data };
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

    // ─── URL Crawling ────────────────────────────────────────────────────────

    @Post('documents/crawl')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @ApiOperation({ summary: 'Import a webpage into the knowledge base by URL (plan-gated)' })
    async crawlUrl(
        @Req() req: any,
        @Body() payload: { url: string; title?: string; category?: string },
    ) {
        const tenantId = req.user?.tenantId;
        const result = await this.knowledgeService.crawlUrl(tenantId, payload.url, payload.title, payload.category);
        return { success: true, data: result };
    }

    @Post('documents/:id/recrawl')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @ApiOperation({ summary: 'Re-crawl a URL document to refresh content' })
    async recrawlUrl(@Req() req: any, @Param('id') id: string) {
        const tenantId = req.user?.tenantId;
        const result = await this.knowledgeService.recrawlUrl(tenantId, id);
        return { success: true, data: result };
    }

    // ─── KB Analytics ────────────────────────────────────────────────────────

    @Get('analytics/:tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @ApiOperation({ summary: 'Get KB usage analytics (plan-gated: starter+)' })
    async getAnalytics(
        @Param('tenantId') tenantId: string,
        @Query('days') days?: string,
    ) {
        const features = await this.throttle.getPlanFeatures(tenantId);
        if (!features.knowledgeAnalytics) {
            return {
                success: false,
                error: 'plan_upgrade_required',
                message: 'KB analytics require Starter plan or higher.',
            };
        }
        const data = await this.knowledgeService.getAnalytics(tenantId, days ? parseInt(days, 10) : 30);
        return { success: true, data };
    }

    @Post('analytics/:tenantId/resolve/:queryId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Mark an unanswered query as resolved' })
    async resolveQuery(
        @Param('tenantId') tenantId: string,
        @Param('queryId') queryId: string,
    ) {
        await this.knowledgeService.resolveUnansweredQuery(tenantId, queryId);
        return { success: true };
    }

    // ─── Public Knowledge Base Endpoints (no auth) ────────────────────────────

    @Get('public/:tenantSlug/articles')
    @ApiOperation({ summary: 'List public knowledge articles for a tenant (no auth)' })
    async getPublicArticles(@Param('tenantSlug') tenantSlug: string) {
        const articles = await this.knowledgeService.getPublicArticles(tenantSlug);
        return { success: true, data: articles };
    }

    @Get('public/:tenantSlug/articles/:slug')
    @ApiOperation({ summary: 'Get a single public article by slug (no auth)' })
    async getPublicArticle(
        @Param('tenantSlug') tenantSlug: string,
        @Param('slug') slug: string,
    ) {
        const article = await this.knowledgeService.getPublicArticle(tenantSlug, slug);
        if (!article) return { success: false, error: 'Article not found' };
        return { success: true, data: article };
    }

    // ─── Legacy Resource Endpoints ───────────────────────────────────────────

    @Get('resources/:tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @ApiOperation({ summary: 'List knowledge resources' })
    async getResources(
        @Param('tenantId') tenantId: string,
        @Query('status') status?: string,
    ) {
        return this.knowledgeService.getResources(await this.schemaFor(tenantId), status);
    }

    @Post('resources/:tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @ApiOperation({ summary: 'Create a knowledge resource' })
    async createResource(
        @Param('tenantId') tenantId: string,
        @Body() body: { title: string; type?: string; content?: string; source_url?: string },
    ) {
        const schema = await this.schemaFor(tenantId);
        const existing = await this.knowledgeService.getResources(schema);
        await this.throttle.enforcePlanLimit(tenantId, 'knowledgeArticles', existing.length, 'documentos de conocimiento');
        return this.knowledgeService.createResource(schema, tenantId, body);
    }

    @Delete('resources/:tenantId/:resourceId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Delete a knowledge resource' })
    async deleteResource(
        @Param('tenantId') tenantId: string,
        @Param('resourceId') resourceId: string,
    ) {
        const schema = await this.schemaFor(tenantId);
        await this.knowledgeService.deleteResource(schema, resourceId);
    }

    @Get('search/:tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @ApiOperation({ summary: 'Semantic search over the knowledge base (hybrid vector + keyword)' })
    async searchChunks(
        @Param('tenantId') tenantId: string,
        @Query('query') query: string,
        @Query('limit') limit?: number,
    ) {
        if (!query) return [];
        return this.knowledgeService.searchRelevant(tenantId, query, limit ? Number(limit) : 5);
    }

    private async schemaFor(tenantId: string): Promise<string> {
        return this.prisma.getTenantSchemaName(tenantId);
    }
}
