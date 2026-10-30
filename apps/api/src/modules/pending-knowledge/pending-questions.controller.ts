import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { auditActor } from '../../common/utils/audit-actor.util';
import type { BusinessFactActor } from '../readiness/business-facts.service';
import { PendingQuestionsService } from './pending-questions.service';

const LIST_STATUSES = new Set(['active', 'all', 'gap', 'open', 'answered', 'stored', 'closed', 'dismissed']);

/**
 * Bandeja de conocimiento pendiente (C0 §1.5 y §4.1, rebanada R5, ADR 0011): `/readiness/:tenantId/pending`, con la
 * misma guarda de tenant y de rol que el resto del panel de preparación (ADR 0010 §7). Lectura para el dueño y el
 * supervisor; responder, guardar como dato y descartar, solo el dueño (la plataforma, suplantando).
 */
@Controller('readiness')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class PendingQuestionsController {
    constructor(private readonly pending: PendingQuestionsService) {}

    /** `?status=active` (gap + open, por defecto) | `all` | un estado. Con los contadores por estado y los vencidos. */
    @Get(':tenantId/pending')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async list(@Param('tenantId') tenantId: string, @Query('status') status?: string, @Query('limit') limit?: string) {
        const filter = status && LIST_STATUSES.has(status) ? status as any : 'active';
        return { success: true, data: await this.pending.list(tenantId, { status: filter, limit: Number(limit) || undefined }) };
    }

    @Get(':tenantId/pending/:id')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async get(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        return { success: true, data: await this.pending.get(tenantId, id) };
    }

    /**
     * Responder (C0 §4.1): `{mode: 'once', text}` → respuesta puntual; `{mode: 'store', value, expectedVersion?,
     * scopeKey?, text?}` → guardar como dato del requisito (reevalúa la preparación y devuelve el delta, como el cajón).
     */
    @Post(':tenantId/pending/:id/answer')
    @Roles('super_admin', 'tenant_admin')
    async answer(@Param('tenantId') tenantId: string, @Param('id') id: string,
        @Body() body: { mode?: unknown; text?: unknown; value?: unknown; expectedVersion?: unknown; scopeKey?: unknown }, @Req() req: any) {
        const actor = this.actorOf(req);
        if (body?.mode === 'once') {
            if (typeof body.text !== 'string') throw new BadRequestException('falta text');
            return { success: true, data: await this.pending.answerOnce(tenantId, id, body.text, actor) };
        }
        if (body?.mode === 'store') {
            if (!('value' in body)) throw new BadRequestException('falta value');
            const expected = body.expectedVersion === undefined || body.expectedVersion === null ? undefined : Number(body.expectedVersion);
            if (expected !== undefined && !Number.isInteger(expected)) throw new BadRequestException('expectedVersion inválido');
            return {
                success: true,
                data: await this.pending.store(tenantId, id, {
                    value: body.value, expectedVersion: expected, scopeKey: typeof body.scopeKey === 'string' ? body.scopeKey : '',
                    answerText: typeof body.text === 'string' ? body.text : null,
                }, actor),
            };
        }
        throw new BadRequestException('mode debe ser once o store');
    }

    @Post(':tenantId/pending/:id/dismiss')
    @Roles('super_admin', 'tenant_admin')
    async dismiss(@Param('tenantId') tenantId: string, @Param('id') id: string, @Req() req: any) {
        return { success: true, data: await this.pending.dismiss(tenantId, id, this.actorOf(req)) };
    }

    @Post(':tenantId/pending/:id/close')
    @Roles('super_admin', 'tenant_admin')
    async close(@Param('tenantId') tenantId: string, @Param('id') id: string, @Req() req: any) {
        this.actorOf(req);
        return { success: true, data: await this.pending.close(tenantId, id) };
    }

    /** Reintenta el aviso de las esperas que quedaron `waiting` (un fallo transitorio de la salida). */
    @Post(':tenantId/pending/:id/notify')
    @Roles('super_admin', 'tenant_admin')
    async notify(@Param('tenantId') tenantId: string, @Param('id') id: string, @Req() req: any) {
        this.actorOf(req);
        return { success: true, data: await this.pending.renotify(tenantId, id) };
    }

    /** Mismo actor que las escrituras del panel: la plataforma escribe solo suplantando. */
    private actorOf(req: any): BusinessFactActor {
        const user = req?.user;
        if (user?.role === 'super_admin' && !user?.isImpersonation) {
            throw new ForbiddenException('para responder por un negocio, suplanta al negocio con un motivo');
        }
        const { userId, delegation } = auditActor(user);
        return { kind: 'user', userId: userId ?? null, role: user?.role ?? null, ...(delegation ? { delegation } : {}) };
    }
}
