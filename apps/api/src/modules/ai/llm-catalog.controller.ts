import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { auditActor } from '../../common/utils/audit-actor.util';
import { catalogContent, SEED_LLM_CATALOG, sameCatalogContent } from './router/llm-catalog';
import { LlmCatalogService } from './catalog/llm-catalog.service';

/**
 * Catálogo LLM versionado (ADR-0030 fase 2). Sólo super_admin: una publicación
 * cambia el modelo de todos los tenants en ≤10 s.
 *
 * Flujo: crear borrador (copia de la activa) → editar su snapshot → validar →
 * publicar. Volver atrás: `restore` sobre una versión ya publicada.
 */
@Controller('admin/llm-catalog')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin')
@ApiBearerAuth()
export class LlmCatalogController {
    constructor(private readonly catalog: LlmCatalogService) { }

    /** La versión que rige en este proceso. */
    @Get()
    active() {
        const active = this.catalog.active;
        return {
            success: true,
            data: { version: active.version, snapshot: catalogContent(active), sameAsCodeSeed: sameCatalogContent(active, SEED_LLM_CATALOG) },
        };
    }

    @Get('versions')
    async versions(@Query('limit') limit?: string) {
        return { success: true, data: await this.catalog.listVersions(Number(limit) || 50) };
    }

    @Get('versions/:version')
    async version(@Param('version', ParseIntPipe) version: number) {
        return { success: true, data: await this.catalog.getVersion(version) };
    }

    /** Body: `{ reason, fromVersion?, snapshot? }`. Sin snapshot copia `fromVersion` o la activa. */
    @Post('drafts')
    async createDraft(@Body() body: { reason?: string; fromVersion?: number; snapshot?: unknown }, @Req() req: any) {
        const fromVersion = body?.fromVersion != null ? Number(body.fromVersion) : undefined;
        const data = await this.catalog.createDraft({ reason: body?.reason ?? '', fromVersion, snapshot: body?.snapshot }, auditActor(req?.user));
        return { success: true, data };
    }

    /** Body: `{ snapshot?, reason? }`. */
    @Put('drafts/:version')
    async updateDraft(@Param('version', ParseIntPipe) version: number, @Body() body: { snapshot?: unknown; reason?: string }) {
        return { success: true, data: await this.catalog.updateDraft(version, { snapshot: body?.snapshot, reason: body?.reason }) };
    }

    /** Body: `{ unmeasured? }`. Hace las llamadas reales y guarda el resultado en el borrador. */
    @Post('drafts/:version/validate')
    async validate(@Param('version', ParseIntPipe) version: number, @Body() body: { unmeasured?: boolean }) {
        return { success: true, data: await this.catalog.validateDraft(version, { unmeasured: body?.unmeasured === true }) };
    }

    /** Body: `{ unmeasured?, reason? }`. «Publicar sin medición» exige `reason`. */
    @Post('drafts/:version/publish')
    async publish(@Param('version', ParseIntPipe) version: number, @Body() body: { unmeasured?: boolean; reason?: string }, @Req() req: any) {
        const data = await this.catalog.publish(version, { unmeasured: body?.unmeasured === true, reason: body?.reason }, auditActor(req?.user));
        return { success: true, data };
    }

    /** Body: `{ reason }`. Publica una versión nueva con el snapshot de `version`. */
    @Post('versions/:version/restore')
    async restore(@Param('version', ParseIntPipe) version: number, @Body() body: { reason?: string }, @Req() req: any) {
        return { success: true, data: await this.catalog.restore(version, body?.reason ?? '', auditActor(req?.user)) };
    }
}
