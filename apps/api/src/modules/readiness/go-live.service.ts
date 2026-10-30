/**
 * GoLiveService (C0 §1.2 y §4.1, rebanada R4, ADR 0010): publicar o despublicar el agente de un tenant y decidir, en
 * cada mensaje entrante de un canal real, si la IA atiende. La regla es `decideGoLive` (go-live-gate.ts); aquí solo hay
 * E/S: `public.tenants.go_live_*`, la bandera del modo y el registro `go_live_decisions` del modo sombra.
 *
 * - Publicar exige veredicto ≠ no_listo (409 con los bloqueantes). Si es «limitado», exige además que el dueño
 *   reconozca TODAS las intenciones que quedarán en «no consta» (`limitedIntents`): el reconocimiento se guarda como
 *   acto explícito en `go_live_ack` (quién, cuándo, con qué evaluación y versión de la especificación).
 * - `check()` nunca lanza: un fallo de lectura atiende (`unavailable`) y se registra. En sombra nunca bloquea.
 */
import { BadRequestException, ConflictException, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Verdict } from '@parallext/business-spec';
import { PrismaService } from '../prisma/prisma.service';
import { GO_LIVE_GATE_FLAG, resolveFeatureFlag } from '../throttle/feature-flags.service';
import { blocksTurn, contactKey, decideGoLive, type GoLiveDecision, type GoLiveMode, type GoLiveReason, type GoLiveState } from './go-live-gate';
import { ReadinessService } from './readiness.service';

/** Bandera por tenant que pasa el control de salida de sombra a aplicado (después de 7 días de datos de sombra). */
export { GO_LIVE_GATE_FLAG } from '../throttle/feature-flags.service';

export interface GoLiveActor { userId: string | null; delegation?: Record<string, unknown> }

export interface GoLiveAck {
    verdict: Verdict;
    intents: { id: string; title: string; requirementIds: string[] }[];
    resultHash: string;
    specVersion: string;
    acknowledgedBy: string | null;
    acknowledgedAt: string;
    delegation?: Record<string, unknown>;
}

export interface GoLiveDecisionRow { serve: boolean; reason: GoLiveReason; mode: GoLiveMode; channelType: string; verdict: string | null; createdAt: string }

export interface GoLiveStatus {
    state: GoLiveState;
    at: string | null;
    by: string | null;
    specVersion: string | null;
    ack: GoLiveAck | null;
    /** `shadow`: se registra y no bloquea; `enforce`: un tenant no publicado no recibe respuestas de la IA. */
    mode: GoLiveMode;
    /** La decisión que el control toma hoy para un cliente real (sin lista blanca). */
    decision: GoLiveDecision;
    lastDecision: GoLiveDecisionRow | null;
    /** Informe de sombra: decisiones de los últimos `days` días. */
    summary: { days: number; total: number; wouldBlock: number; byReason: Record<string, number>; since: string | null };
}

export interface GoLiveCheck { decision: GoLiveDecision; mode: GoLiveMode; blocks: boolean }

interface TenantGoLiveRow {
    go_live_state: string | null;
    go_live_at: Date | string | null;
    go_live_by: string | null;
    go_live_spec_version: string | null;
    go_live_ack: GoLiveAck | null;
    flags: unknown;
    test_contacts: unknown;
}

const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);
const UNDEFINED = new Set(['42P01', '42703']);
const isMissingSchema = (err: unknown) => UNDEFINED.has(String((err as { code?: string; meta?: { code?: string } })?.code ?? (err as { meta?: { code?: string } })?.meta?.code ?? ''))
    || /does not exist/i.test(String((err as Error)?.message ?? ''));

@Injectable()
export class GoLiveService {
    private readonly logger = new Logger(GoLiveService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly readiness: ReadinessService,
        @Optional() private readonly events?: EventEmitter2,
    ) {}

    private async row(tenantId: string): Promise<TenantGoLiveRow | null> {
        const rows = await this.prisma.$queryRawUnsafe<TenantGoLiveRow[]>(
            `SELECT go_live_state, go_live_at, go_live_by, go_live_spec_version, go_live_ack,
                    settings->'featureFlags' AS flags, settings->'goLive'->'testContacts' AS test_contacts
               FROM tenants WHERE id = $1::uuid`, tenantId);
        return rows?.[0] ?? null;
    }

    private modeOf(row: TenantGoLiveRow | null): GoLiveMode {
        return resolveFeatureFlag(row?.flags, GO_LIVE_GATE_FLAG) ? 'enforce' : 'shadow';
    }

    /**
     * La decisión para un mensaje entrante de un canal real. Registra la decisión (sombra y aplicado) sin esperar a que
     * se escriba. Nunca lanza.
     */
    async check(tenantId: string, input: { channelType: string; contact?: string | null; conversationId?: string | null }): Promise<GoLiveCheck> {
        let decision: GoLiveDecision = { serve: true, reason: 'unavailable' };
        let mode: GoLiveMode = 'shadow';
        let state: GoLiveState = 'off';
        let verdict: Verdict | null = null;
        try {
            const row = await this.row(tenantId);
            mode = this.modeOf(row);
            state = row?.go_live_state === 'on' ? 'on' : 'off';
            verdict = await this.readiness.currentVerdict(tenantId);
            const contacts = Array.isArray(row?.test_contacts) ? (row?.test_contacts as unknown[]).map(contactKey).filter(Boolean) : [];
            const testContact = Boolean(input.contact) && contacts.includes(contactKey(input.contact));
            decision = decideGoLive({ state, verdict, testContact });
        } catch (err) {
            this.logger.warn(`go-live: estado no disponible para ${tenantId} (se atiende): ${(err as Error).message}`);
        }
        const blocks = blocksTurn(mode, decision);
        // una línea por decisión que bloquearía: el registro durable es la tabla, esto es para verla en los logs
        if (!decision.serve) this.logger.log(`[go-live] tenant=${tenantId} mode=${mode} serve=false reason=${decision.reason} blocks=${blocks}`);
        void this.record(tenantId, { ...input, mode, decision, state, verdict });
        return { decision, mode, blocks };
    }

    private async record(tenantId: string, d: { channelType: string; conversationId?: string | null; mode: GoLiveMode; decision: GoLiveDecision; state: GoLiveState; verdict: Verdict | null }): Promise<void> {
        try {
            const schema = await this.prisma.getTenantSchemaName(tenantId);
            const conversation = d.conversationId && /^[0-9a-f-]{36}$/i.test(d.conversationId) ? d.conversationId : null;
            await this.prisma.executeInTenantSchema(schema,
                `INSERT INTO go_live_decisions (channel_type, conversation_id, mode, serve, reason, go_live_state, verdict, spec_version)
                 VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8)`,
                [d.channelType, conversation, d.mode, d.decision.serve, d.decision.reason, d.state, d.verdict, this.readiness.spec.specVersion]);
        } catch (err) {
            if (!isMissingSchema(err)) this.logger.warn(`go-live: no se pudo registrar la decisión de ${tenantId}: ${(err as Error).message}`);
        }
    }

    async status(tenantId: string, days = 7): Promise<GoLiveStatus> {
        const row = await this.row(tenantId).catch(err => { if (isMissingSchema(err)) return null; throw err; });
        const state: GoLiveState = row?.go_live_state === 'on' ? 'on' : 'off';
        const verdict = await this.readiness.currentVerdict(tenantId);
        const span = Math.min(Math.max(Math.trunc(days) || 7, 1), 90);
        return {
            state,
            at: iso(row?.go_live_at), by: row?.go_live_by ?? null, specVersion: row?.go_live_spec_version ?? null, ack: row?.go_live_ack ?? null,
            mode: this.modeOf(row),
            decision: decideGoLive({ state, verdict }),
            ...(await this.decisions(tenantId, span)),
        };
    }

    /** Informe de sombra de un tenant: cuántos mensajes entrantes habría dejado sin IA y por qué. */
    async decisions(tenantId: string, days: number): Promise<Pick<GoLiveStatus, 'lastDecision' | 'summary'>> {
        const empty = { lastDecision: null, summary: { days, total: 0, wouldBlock: 0, byReason: {}, since: null } };
        try {
            const schema = await this.prisma.getTenantSchemaName(tenantId);
            const groups = await this.prisma.executeInTenantSchema<Array<{ serve: boolean; reason: string; n: number; first: Date }>>(schema,
                `SELECT serve, reason, count(*)::int AS n, min(created_at) AS first FROM go_live_decisions
                  WHERE created_at > clock_timestamp() - make_interval(days => $1::int) GROUP BY serve, reason`, [days]);
            const last = await this.prisma.executeInTenantSchema<Array<{ serve: boolean; reason: GoLiveReason; mode: GoLiveMode; channel_type: string; verdict: string | null; created_at: Date }>>(schema,
                `SELECT serve, reason, mode, channel_type, verdict, created_at FROM go_live_decisions ORDER BY created_at DESC LIMIT 1`, []);
            const byReason: Record<string, number> = {};
            for (const g of groups) byReason[g.reason] = (byReason[g.reason] ?? 0) + Number(g.n);
            const firsts = groups.map(g => new Date(g.first).getTime()).filter(Number.isFinite);
            const l = last[0];
            return {
                lastDecision: l ? { serve: l.serve, reason: l.reason, mode: l.mode, channelType: l.channel_type, verdict: l.verdict, createdAt: new Date(l.created_at).toISOString() } : null,
                summary: {
                    days,
                    total: groups.reduce((n, g) => n + Number(g.n), 0),
                    wouldBlock: groups.filter(g => !g.serve).reduce((n, g) => n + Number(g.n), 0),
                    byReason,
                    since: firsts.length ? new Date(Math.min(...firsts)).toISOString() : null,
                },
            };
        } catch (err) {
            if (isMissingSchema(err)) return empty;
            throw err;
        }
    }

    /**
     * Publica (`off → on`). 409 si el veredicto es no_listo; si es «limitado», 409 hasta que `ack` traiga todas las
     * intenciones de `limitedIntents` (el dueño las reconoce una por una en el panel).
     */
    async publish(tenantId: string, ack: unknown, actor: GoLiveActor): Promise<GoLiveStatus> {
        if (ack !== undefined && ack !== null && !Array.isArray(ack)) throw new BadRequestException('ack debe ser la lista de intenciones reconocidas');
        const view = await this.readiness.getCurrent(tenantId, { refresh: true });
        const r = view.result;
        if (r.verdict === 'no_listo') {
            throw new ConflictException({ message: 'el negocio no está listo para atender: completa los bloqueantes', verdict: r.verdict, blockingGaps: r.blockingGaps });
        }
        let record: GoLiveAck | null = null;
        if (r.verdict === 'limitado') {
            const given = new Set((ack as unknown[] | undefined ?? []).map(String));
            const missing = r.limitedIntents.filter(i => !given.has(i.id)).map(i => i.id);
            if (missing.length) {
                throw new ConflictException({ message: 'reconoce las intenciones que quedarán en «no consta» para publicar', verdict: r.verdict, limitedIntents: r.limitedIntents, missing });
            }
            record = {
                verdict: r.verdict, intents: r.limitedIntents, resultHash: r.resultHash, specVersion: r.specVersion,
                acknowledgedBy: actor.userId, acknowledgedAt: new Date().toISOString(), ...(actor.delegation ? { delegation: actor.delegation } : {}),
            };
        }
        await this.prisma.$executeRawUnsafe(
            `UPDATE tenants SET go_live_state = 'on', go_live_at = clock_timestamp(), go_live_by = $2, go_live_spec_version = $3, go_live_ack = $4::jsonb
              WHERE id = $1::uuid`, tenantId, actor.userId, r.specVersion, record ? JSON.stringify(record) : null);
        this.events?.emit('go_live.changed', { tenantId, state: 'on', verdict: r.verdict, by: actor.userId });
        return this.status(tenantId);
    }

    /** Despublica (`on → off`): la IA deja de atender a clientes reales en cuanto el control esté aplicado. */
    async unpublish(tenantId: string, actor: GoLiveActor): Promise<GoLiveStatus> {
        await this.prisma.$executeRawUnsafe(
            `UPDATE tenants SET go_live_state = 'off', go_live_at = clock_timestamp(), go_live_by = $2 WHERE id = $1::uuid`, tenantId, actor.userId);
        this.events?.emit('go_live.changed', { tenantId, state: 'off', by: actor.userId });
        return this.status(tenantId);
    }
}
