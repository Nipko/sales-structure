import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { auditActor } from '../../common/utils/audit-actor.util';
import type { BusinessFactActor } from '../readiness/business-facts.service';
import { CopilotProposalsService } from './copilot-proposals.service';
import { OnboardingExtractionService } from './onboarding-extraction.service';

/**
 * Copiloto de onboarding (C0 §1.3 y §4.1, rebanada R6, ADR 0012): `/readiness/:tenantId/copilot/…`, con la misma guarda
 * de tenant y de rol que el resto del panel de preparación. Ver las propuestas: dueño y supervisor. Analizar, aprobar
 * (con edición opcional) y rechazar: solo el dueño (la plataforma, suplantando; se registra el operador real).
 */
@Controller('readiness')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class OnboardingCopilotController {
    constructor(private readonly extraction: OnboardingExtractionService, private readonly proposals: CopilotProposalsService) {}

    /** «Analizar mis fuentes»: una ejecución de extracción (tope diario por tenant). */
    @Post(':tenantId/copilot/run')
    @Roles('super_admin', 'tenant_admin')
    async run(@Param('tenantId') tenantId: string, @Req() req: any) {
        return { success: true, data: await this.extraction.run(tenantId, this.actorOf(req)) };
    }

    /** `?status=open` (por defecto) | `all` | un estado. Con los contadores por estado. */
    @Get(':tenantId/copilot/proposals')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async list(@Param('tenantId') tenantId: string, @Query('status') status?: string, @Query('limit') limit?: string) {
        return { success: true, data: await this.proposals.list(tenantId, { status, limit: Number(limit) || undefined }) };
    }

    @Get(':tenantId/copilot/proposals/:id')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async get(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        return { success: true, data: await this.proposals.get(tenantId, id) };
    }

    /** Aprobar: `{value?, expectedVersion?}` (con `value` = editar y aprobar). Responde como el cajón: valor y delta. */
    @Post(':tenantId/copilot/proposals/:id/approve')
    @Roles('super_admin', 'tenant_admin')
    async approve(@Param('tenantId') tenantId: string, @Param('id') id: string,
        @Body() body: { value?: unknown; expectedVersion?: unknown }, @Req() req: any) {
        const expected = body?.expectedVersion === undefined || body?.expectedVersion === null ? undefined : Number(body.expectedVersion);
        if (expected !== undefined && !Number.isInteger(expected)) throw new BadRequestException('expectedVersion inválido');
        const input = { ...(body && 'value' in body ? { value: body.value } : {}), ...(expected !== undefined ? { expectedVersion: expected } : {}) };
        return { success: true, data: await this.proposals.approve(tenantId, id, input, this.actorOf(req)) };
    }

    /** Rechazar: `{note?}`. */
    @Post(':tenantId/copilot/proposals/:id/reject')
    @Roles('super_admin', 'tenant_admin')
    async reject(@Param('tenantId') tenantId: string, @Param('id') id: string, @Body() body: { note?: unknown }, @Req() req: any) {
        const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null;
        return { success: true, data: await this.proposals.reject(tenantId, id, note, this.actorOf(req)) };
    }

    /** Actor de la decisión. La plataforma decide solo suplantando (la suplantación lleva el operador real). */
    private actorOf(req: any): BusinessFactActor {
        const user = req?.user;
        if (user?.role === 'super_admin' && !user?.isImpersonation) {
            throw new ForbiddenException('para decidir propuestas de un negocio, suplanta al negocio con un motivo');
        }
        const { userId, delegation } = auditActor(user);
        return { kind: 'user', userId: userId ?? null, role: user?.role ?? null, ...(delegation ? { delegation } : {}) };
    }
}
