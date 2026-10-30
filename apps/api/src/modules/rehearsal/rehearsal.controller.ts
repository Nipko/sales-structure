import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { auditActor } from '../../common/utils/audit-actor.util';
import { RehearsalService } from './rehearsal.service';

const LANGS = new Set(['es', 'en', 'pt', 'fr']);

/**
 * Ensayo antes de salir (C0 §1.4 y §4.1, rebanada R7, ADR 0013), bajo `/readiness/:tenantId/rehearsal` con la misma
 * guarda de tenant y rol que el resto del panel de preparación (como la bandeja de R5). Lanzar: el dueño y la
 * plataforma (QA; el ensayo no escribe datos del negocio, así que no exige suplantación). Leer: también el supervisor.
 * El ensayo es consultivo (C0 §6 pregunta 7): no habilita ni bloquea la salida.
 */
@Controller('readiness')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class RehearsalController {
    constructor(private readonly rehearsal: RehearsalService) {}

    /** `{agentId?, seed?, maxCases? (≤ 40), languages?: ['es','en'…], repeatOf?: runId}` → la ejecución recién creada. */
    @Post(':tenantId/rehearsal/runs')
    @Roles('super_admin', 'tenant_admin')
    async start(@Param('tenantId') tenantId: string,
        @Body() body: { agentId?: unknown; seed?: unknown; maxCases?: unknown; languages?: unknown; repeatOf?: unknown }, @Req() req: any) {
        const str = (v: unknown, name: string, max = 200) => {
            if (v === undefined || v === null || v === '') return null;
            if (typeof v !== 'string' || v.length > max) throw new BadRequestException(`${name} inválido`);
            return v;
        };
        const maxCases = body?.maxCases === undefined || body?.maxCases === null ? null : Number(body.maxCases);
        if (maxCases !== null && !(Number.isInteger(maxCases) && maxCases >= 1 && maxCases <= 40)) throw new BadRequestException('maxCases debe estar entre 1 y 40');
        const languages = body?.languages === undefined || body?.languages === null ? null : body.languages;
        if (languages !== null && (!Array.isArray(languages) || languages.some(l => typeof l !== 'string' || !LANGS.has(l)))) {
            throw new BadRequestException('languages: es, en, pt o fr');
        }
        const { userId } = auditActor(req?.user);
        const run = await this.rehearsal.start(tenantId, {
            agentId: str(body?.agentId, 'agentId', 64), seed: str(body?.seed, 'seed', 64), maxCases,
            languages: languages as string[] | null, repeatOf: str(body?.repeatOf, 'repeatOf', 64), requestedBy: userId ?? null,
        });
        return { success: true, data: run };
    }

    @Get(':tenantId/rehearsal/runs')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async list(@Param('tenantId') tenantId: string, @Query('limit') limit?: string) {
        return { success: true, data: await this.rehearsal.list(tenantId, Number(limit) || 20) };
    }

    @Get(':tenantId/rehearsal/runs/:runId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async get(@Param('tenantId') tenantId: string, @Param('runId') runId: string) {
        return { success: true, data: await this.rehearsal.get(tenantId, runId) };
    }
}
