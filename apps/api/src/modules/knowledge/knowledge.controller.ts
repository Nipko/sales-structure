import { Controller, Post, Body, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { KnowledgeService } from './knowledge.service';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';

@ApiTags('knowledge')
@Controller('knowledge')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class KnowledgeController {
    private readonly logger = new Logger(KnowledgeController.name);

    constructor(private knowledgeService: KnowledgeService) { }

    @Post('ingest/text')
    @ApiOperation({ summary: 'Ingest raw text into the RAG knowledge base' })
    async ingestText(
        @CurrentTenant() tenantId: string,
        @Body() body: { title: string; text: string; metadata?: any }
    ) {
        const result = await this.knowledgeService.ingestDocument(
            tenantId,
            body.title,
            body.text,
            body.metadata || {}
        );

        return { success: true, data: result };
    }

    @Post('search')
    @ApiOperation({ summary: 'Test semantic search on tenant knowledge base' })
    async search(
        @CurrentTenant() tenantId: string,
        @Body() body: { query: string; topK?: number; threshold?: number }
    ) {
        const config = {
            enabled: true,
            chunkSize: 512,
            chunkOverlap: 50,
            topK: body.topK || 5,
            similarityThreshold: body.threshold || 0.70
        };

        const results = await this.knowledgeService.searchRelevantKnowledge(tenantId, body.query, config);
        return { success: true, data: results };
    }
}
