import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { auditActor } from '../../common/utils/audit-actor.util';
import { BusinessFactsService, type BusinessFactActor } from './business-facts.service';
import { ReadinessService } from './readiness.service';

/**
 * Preparación del negocio (C0 §4.1): lectura desde R2 y, desde R3, los valores del negocio (`business-facts`).
 * Lectura para el dueño y el supervisor; escritura solo para el dueño (`tenant_admin`); la foto cruda, solo para la
 * plataforma (QA). Una escritura de la plataforma exige suplantación: se registra el actor real (auditActor).
 */
@Controller('readiness')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class ReadinessController {
    constructor(private readonly readiness: ReadinessService, private readonly facts: BusinessFactsService) {}

    /** Última evaluación (caché). `?refresh=1` reevalúa ahora. */
    @Get(':tenantId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async current(@Param('tenantId') tenantId: string, @Query('refresh') refresh?: string) {
        return { success: true, data: await this.readiness.getCurrent(tenantId, { refresh: refresh === '1' || refresh === 'true' }) };
    }

    /** Historial: una fila por resultado distinto, la más reciente primero. */
    @Get(':tenantId/history')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async history(@Param('tenantId') tenantId: string, @Query('limit') limit?: string) {
        return { success: true, data: await this.readiness.getHistory(tenantId, Number(limit) || undefined) };
    }

    /** La foto que evalúa el motor (`business-spec/tenant-snapshot@1`), para el arnés QA (`business-spec qa-truth`). */
    @Get(':tenantId/snapshot')
    @Roles('super_admin')
    async snapshot(@Param('tenantId') tenantId: string) {
        return { success: true, data: await this.readiness.readSnapshot(tenantId) };
    }

    /** Definición del requisito y su evaluación actual. */
    @Get(':tenantId/requirements/:requirementId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async requirement(@Param('tenantId') tenantId: string, @Param('requirementId') requirementId: string) {
        return { success: true, data: await this.readiness.getRequirement(tenantId, requirementId) };
    }

    // ─────────────────────────── valores del negocio (R3) ───────────────────────────

    /** Todos los valores con procedencia del tenant. */
    @Get(':tenantId/business-facts')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async listFacts(@Param('tenantId') tenantId: string) {
        return { success: true, data: await this.facts.list(tenantId) };
    }

    /** Aceptar los valores por defecto de la plataforma (C0 §2.5): `{ids[], specVersion}`. */
    @Post(':tenantId/business-facts/defaults/accept')
    @Roles('super_admin', 'tenant_admin')
    async acceptDefaults(@Param('tenantId') tenantId: string, @Body() body: { ids?: unknown; specVersion?: unknown }, @Req() req: any) {
        if (!Array.isArray(body?.ids) || typeof body?.specVersion !== 'string') throw new BadRequestException('se esperan ids[] y specVersion');
        return { success: true, data: await this.facts.acceptDefaults(tenantId, body.ids.map(String), body.specVersion, this.actorOf(req)) };
    }

    /** Valor de un requisito (`?scope=` para un alcance distinto del global). */
    @Get(':tenantId/business-facts/:requirementId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async getFact(@Param('tenantId') tenantId: string, @Param('requirementId') requirementId: string, @Query('scope') scope?: string) {
        return { success: true, data: await this.facts.get(tenantId, requirementId, scope ?? '') };
    }

    /** Versiones de un valor: quién lo escribió y cuándo. */
    @Get(':tenantId/business-facts/:requirementId/versions')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async factVersions(@Param('tenantId') tenantId: string, @Param('requirementId') requirementId: string,
        @Query('scope') scope?: string, @Query('limit') limit?: string) {
        return { success: true, data: await this.facts.history(tenantId, requirementId, scope ?? '', Number(limit) || undefined) };
    }

    /**
     * Escribe el valor (`origin=owner_form`, confirmado). Cuerpo: `{value, scopeKey?, expectedVersion?}`.
     * Devuelve el valor guardado y el delta de la preparación (veredicto antes y después, y la evaluación del requisito).
     */
    @Put(':tenantId/business-facts/:requirementId')
    @Roles('super_admin', 'tenant_admin')
    async writeFact(@Param('tenantId') tenantId: string, @Param('requirementId') requirementId: string,
        @Body() body: { value?: unknown; scopeKey?: unknown; expectedVersion?: unknown }, @Req() req: any) {
        if (!body || !('value' in body)) throw new BadRequestException('falta value');
        const expected = body.expectedVersion === undefined || body.expectedVersion === null ? undefined : Number(body.expectedVersion);
        if (expected !== undefined && !Number.isInteger(expected)) throw new BadRequestException('expectedVersion inválido');
        const actor = this.actorOf(req);
        const before = await this.readiness.currentVerdict(tenantId);
        const fact = await this.facts.write(tenantId, {
            requirementId, value: body.value, scopeKey: typeof body.scopeKey === 'string' ? body.scopeKey : '', expectedVersion: expected,
        }, actor);
        const after = await this.readiness.evaluateTenant(tenantId, 'invalidated').catch(() => null);
        return {
            success: true,
            data: {
                fact,
                readiness: after ? {
                    verdictBefore: before, verdictAfter: after.result.verdict,
                    requirement: after.result.requirements.find(r => r.id === requirementId) ?? null,
                } : null,
            },
        };
    }

    /** Actor de la escritura. La plataforma escribe solo suplantando (la suplantación lleva el operador real). */
    private actorOf(req: any): BusinessFactActor {
        const user = req?.user;
        if (user?.role === 'super_admin' && !user?.isImpersonation) {
            throw new ForbiddenException('para escribir valores de un negocio, suplanta al negocio con un motivo');
        }
        const { userId, delegation } = auditActor(user);
        return { kind: 'user', userId: userId ?? null, role: user?.role ?? null, ...(delegation ? { delegation } : {}) };
    }
}
