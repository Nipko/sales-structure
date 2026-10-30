/**
 * PendingQuestionsService (C0 §1.5 y §2.6, rebanada R5, ADR 0011): la única puerta de escritura de
 * `pending_questions` y `pending_question_waiters`.
 *
 * - **Demanda (GAP).** `recordGap`: un tema que el agente no pudo responder suma una ocurrencia a su fila abierta, o la
 *   abre en `gap`. Lo llaman la búsqueda de conocimiento sin resultado (KnowledgeService, con `recordGapStatement` en
 *   su transacción) y la herramienta del agente.
 * - **«Lo averiguo».** `acceptWait`: el cliente aceptó esperar. Se guarda su espera (conversación, contacto, idioma) y
 *   la fila pasa a `open` con el SLA de `CORE.PENDING.ROUTING` (4 h por D10 si no hay).
 * - **El dueño responde** desde `/admin/readiness/pending`: `answerOnce` (texto puntual, no es dato, no cambia la
 *   preparación) → `answered`; `store` escribe el valor por BusinessFactsService (`origin=owner_form`,
 *   `source_ref.via=pending`), reevalúa la preparación y resuelve TODAS las abiertas de ese requisito → `stored`;
 *   `dismiss` → `dismissed`; `close` cierra lo respondido.
 * - Tras responder o guardar, PendingAnswerNotifier avisa a cada espera por la salida durable, en su idioma.
 *
 * Agent Test, el ensayo y la evaluación nunca llegan aquí: la herramienta corre en seco cuando la persistencia está
 * apagada (ai-tool-executor), y el aviso descarta los contactos de prueba.
 */
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessFactsService, type BusinessFactActor, type BusinessFactView } from '../readiness/business-facts.service';
import { ReadinessService } from '../readiness/readiness.service';
import { PendingAnswerNotifier, type NotifySummary } from './pending-answer-notifier.service';
import { pendingLanguage, renderStoredValue } from './pending-answer-text';
import {
    nextStatus, recordGapStatement, slaMsFrom, statusesAllowing,
    type GapInput, type PendingQuestionAction, type PendingQuestionStatus,
} from './pending-question-topic';

export const PENDING_QUESTION_EVENTS = Object.freeze({
    gap: 'pending_question.gap',
    opened: 'pending_question.opened',
    answered: 'pending_question.answered',
    customerNotified: 'pending_question.customer_notified',
});

export interface PendingWaiterView {
    id: string;
    conversationId: string;
    contactId: string | null;
    language: string | null;
    acceptedAt: string | null;
    notifiedAt: string | null;
    notifyStatus: string;
    notifyDetail: string | null;
}

export interface PendingQuestionView {
    id: string;
    requirementId: string | null;
    itemRef: string | null;
    intentId: string | null;
    topicKey: string;
    sampleQuestion: string;
    language: string | null;
    source: string;
    status: PendingQuestionStatus;
    occurrences: number;
    waitersCount: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    slaDueAt: string | null;
    overdue: boolean;
    answeredBy: string | null;
    answeredAt: string | null;
    answerText: string | null;
    storedValueId: string | null;
    closedAt: string | null;
    waiters?: PendingWaiterView[];
}

export interface AcceptWaitInput {
    question: string;
    requirementId?: string | null;
    itemRef?: string | null;
    conversationId: string;
    contactId?: string | null;
    language?: string | null;
}

export interface AcceptWaitResult {
    id: string;
    status: PendingQuestionStatus;
    slaDueAt: string | null;
    waitersCount: number;
    /** La conversación ya esperaba esta respuesta: no se agrega otra espera. */
    alreadyWaiting: boolean;
}

export interface StoreAnswerInput {
    value: unknown;
    scopeKey?: string;
    expectedVersion?: number;
    /** El mensaje para el cliente; si falta, el valor guardado como texto legible. */
    answerText?: string | null;
}

type Query = <R = any[]>(sql: string, params?: any[]) => Promise<R>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNDEFINED_TABLE = '42P01';
const isUndefinedTable = (err: unknown) => (err as { code?: string })?.code === UNDEFINED_TABLE
    || (err as { meta?: { code?: string } })?.meta?.code === UNDEFINED_TABLE
    || /relation .*pending_question.* does not exist/i.test(String((err as Error)?.message ?? ''));

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string).toISOString());

const COLUMNS = `id::text AS id, requirement_id, item_ref, intent_id, topic_key, sample_question, language, source, status,
       occurrences, waiters_count, first_seen_at, last_seen_at, sla_due_at, answered_by::text AS answered_by, answered_at,
       answer_text, stored_value_id::text AS stored_value_id, closed_at`;

export function toQuestionView(r: Record<string, any>, now = new Date()): PendingQuestionView {
    const slaDueAt = iso(r.sla_due_at);
    const status = r.status as PendingQuestionStatus;
    return {
        id: String(r.id), requirementId: r.requirement_id ?? null, itemRef: r.item_ref ?? null, intentId: r.intent_id ?? null,
        topicKey: String(r.topic_key), sampleQuestion: String(r.sample_question ?? ''), language: r.language ?? null,
        source: String(r.source ?? 'agent'), status, occurrences: Number(r.occurrences ?? 0), waitersCount: Number(r.waiters_count ?? 0),
        firstSeenAt: iso(r.first_seen_at), lastSeenAt: iso(r.last_seen_at), slaDueAt,
        overdue: status === 'open' && !!slaDueAt && new Date(slaDueAt).getTime() < now.getTime(),
        answeredBy: r.answered_by ?? null, answeredAt: iso(r.answered_at), answerText: r.answer_text ?? null,
        storedValueId: r.stored_value_id ?? null, closedAt: iso(r.closed_at),
    };
}

const toWaiterView = (r: Record<string, any>): PendingWaiterView => ({
    id: String(r.id), conversationId: String(r.conversation_id), contactId: r.contact_id ?? null, language: r.language ?? null,
    acceptedAt: iso(r.accepted_at), notifiedAt: iso(r.notified_at), notifyStatus: String(r.notify_status), notifyDetail: r.notify_detail ?? null,
});

@Injectable()
export class PendingQuestionsService {
    private readonly logger = new Logger(PendingQuestionsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly readiness: ReadinessService,
        private readonly facts: BusinessFactsService,
        @Optional() private readonly notifier?: PendingAnswerNotifier,
        @Optional() private readonly events?: EventEmitter2,
    ) {}

    protected now(): Date {
        return new Date();
    }

    /** Un requisito de la especificación vigente, o null (una pregunta sin requisito se deduplica por su texto). */
    knownRequirement(requirementId: unknown): string | null {
        const id = typeof requirementId === 'string' ? requirementId.trim() : '';
        return id && this.readiness.spec.requirements[id] ? id : null;
    }

    /** Registra la demanda. Nunca lanza: sin la tabla (tenant sin migrar) o con un fallo, el turno sigue. */
    async recordGap(tenantId: string, input: GapInput): Promise<{ id: string; status: PendingQuestionStatus; occurrences: number; inserted: boolean } | null> {
        try {
            const { sql, params } = recordGapStatement({ ...input, requirementId: this.knownRequirement(input.requirementId) });
            const [row] = await this.run<Record<string, any>[]>(tenantId, sql, params);
            if (!row) return null;
            if (row.inserted) this.events?.emit(PENDING_QUESTION_EVENTS.gap, { tenantId, id: row.id });
            return { id: String(row.id), status: row.status, occurrences: Number(row.occurrences), inserted: row.inserted === true };
        } catch (err) {
            this.logger.warn(`pending: hueco no registrado para ${tenantId}: ${(err as Error).message}`);
            return null;
        }
    }

    /** El cliente aceptó «lo averiguo»: su espera y la fila en `open` con el SLA. Idempotente por conversación. */
    async acceptWait(tenantId: string, input: AcceptWaitInput): Promise<AcceptWaitResult> {
        if (!UUID.test(String(input.conversationId ?? ''))) throw new BadRequestException('conversación inválida');
        const question = String(input.question ?? '').trim();
        if (!question) throw new BadRequestException('falta la pregunta');
        const requirementId = this.knownRequirement(input.requirementId);
        const language = pendingLanguage(input.language);
        const slaMs = slaMsFrom(await this.routingValue(tenantId));
        const contactId = input.contactId && UUID.test(input.contactId) ? input.contactId : null;
        const result = await this.transaction(tenantId, async query => {
            // la ocurrencia se cuenta abajo, una por espera nueva: aquí solo se asegura la fila abierta del tema
            const gap = recordGapStatement({
                question, requirementId, itemRef: input.itemRef, conversationId: input.conversationId, language, source: 'agent',
            }, { countOccurrence: false });
            const [row] = await query<Record<string, any>[]>(gap.sql, gap.params);
            const waiter = await query<Record<string, any>[]>(
                `INSERT INTO pending_question_waiters (pending_question_id, conversation_id, contact_id, language)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
                 ON CONFLICT (pending_question_id, conversation_id) DO NOTHING RETURNING id::text AS id`,
                [row.id, input.conversationId, contactId, language]);
            const fresh = waiter.length > 0;
            const [updated] = await query<Record<string, any>[]>(
                `UPDATE pending_questions
                    SET status = 'open',
                        waiters_count = (SELECT count(*)::int FROM pending_question_waiters WHERE pending_question_id = $1::uuid),
                        occurrences = occurrences + CASE WHEN $2::boolean AND NOT $3::boolean THEN 1 ELSE 0 END,
                        sla_due_at = COALESCE(sla_due_at, clock_timestamp() + ($4::bigint * INTERVAL '1 millisecond')),
                        last_seen_at = clock_timestamp(), updated_at = clock_timestamp()
                  WHERE id = $1::uuid AND status IN ('gap','open')
              RETURNING id::text AS id, status, sla_due_at, waiters_count`,
                [row.id, fresh, row.inserted === true, slaMs]);
            if (!updated) throw new ConflictException('la consulta cambió de estado; reintenta');
            return { id: String(updated.id), status: updated.status as PendingQuestionStatus, slaDueAt: iso(updated.sla_due_at), waitersCount: Number(updated.waiters_count), alreadyWaiting: !fresh };
        });
        if (!result.alreadyWaiting) this.events?.emit(PENDING_QUESTION_EVENTS.opened, { tenantId, id: result.id, waiters: result.waitersCount });
        return result;
    }

    async list(tenantId: string, filter: { status?: 'active' | 'all' | PendingQuestionStatus; limit?: number } = {}): Promise<{ items: PendingQuestionView[]; counts: Record<string, number> }> {
        const status = filter.status ?? 'active';
        const where = status === 'all' ? '' : status === 'active' ? `WHERE status IN ('gap','open')` : 'WHERE status = $2';
        const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 100) || 100, 1), 500);
        const params: unknown[] = [limit];
        if (where.includes('$2')) params.push(status);
        const rows = await this.read<Record<string, any>[]>(tenantId,
            `SELECT ${COLUMNS} FROM pending_questions ${where}
              ORDER BY (status = 'open') DESC, sla_due_at ASC NULLS LAST, waiters_count DESC, occurrences DESC, last_seen_at DESC
              LIMIT $1`, params);
        const counts = await this.read<Record<string, any>[]>(tenantId,
            `SELECT status, count(*)::int AS n, count(*) FILTER (WHERE status = 'open' AND sla_due_at < clock_timestamp())::int AS overdue
               FROM pending_questions GROUP BY status`, []);
        const byStatus: Record<string, number> = { gap: 0, open: 0, answered: 0, stored: 0, closed: 0, dismissed: 0, overdue: 0 };
        for (const c of counts) { byStatus[c.status] = Number(c.n); byStatus.overdue += Number(c.overdue ?? 0); }
        const now = this.now();
        return { items: rows.map(r => toQuestionView(r, now)), counts: byStatus };
    }

    async get(tenantId: string, id: string): Promise<PendingQuestionView> {
        const row = await this.find(tenantId, id);
        const waiters = await this.read<Record<string, any>[]>(tenantId,
            `SELECT id::text AS id, conversation_id::text AS conversation_id, contact_id::text AS contact_id, language, accepted_at,
                    notified_at, notify_status, notify_detail
               FROM pending_question_waiters WHERE pending_question_id = $1::uuid ORDER BY accepted_at`, [id]);
        return { ...toQuestionView(row, this.now()), waiters: waiters.map(toWaiterView) };
    }

    /** Respuesta puntual: no es dato y no cambia la preparación. Avisa a las esperas. */
    async answerOnce(tenantId: string, id: string, text: string, actor: BusinessFactActor): Promise<{ question: PendingQuestionView; notified: NotifySummary }> {
        const answer = String(text ?? '').trim();
        if (!answer) throw new BadRequestException('falta la respuesta');
        if (answer.length > 2000) throw new BadRequestException('la respuesta es demasiado larga (máx. 2000)');
        const row = await this.transition(tenantId, id, 'answer_once', {
            set: `answer_text = $3, answered_by = $4::uuid, answered_at = clock_timestamp()`, params: [answer.slice(0, 2000), userIdOf(actor)],
        });
        this.events?.emit(PENDING_QUESTION_EVENTS.answered, { tenantId, id, mode: 'once' });
        const notified = await this.notify(tenantId, [id]);
        return { question: toQuestionView(row, this.now()), notified };
    }

    /**
     * «Guardar como dato»: el valor se escribe por BusinessFactsService (valida contra la especificación, deja versión y
     * actor, invalida la caché) con `source_ref.via=pending`; la preparación se reevalúa y TODAS las consultas abiertas de
     * ese requisito quedan `stored` con el mismo valor. Avisa a las esperas de todas ellas.
     */
    async store(tenantId: string, id: string, input: StoreAnswerInput, actor: BusinessFactActor): Promise<{
        question: PendingQuestionView; fact: BusinessFactView; readiness: { verdictBefore: string | null; verdictAfter: string | null; requirement: unknown } | null;
        resolved: string[]; notified: NotifySummary;
    }> {
        const current = toQuestionView(await this.find(tenantId, id), this.now());
        if (!current.requirementId) throw new BadRequestException('esta consulta no corresponde a un requisito: respóndela una vez o descártala');
        if (!nextStatus(current.status, 'store')) throw new ConflictException(`no se puede guardar como dato una consulta en estado ${current.status}`);
        const before = await this.readiness.currentVerdict(tenantId).catch(() => null);
        const fact = await this.facts.write(tenantId, {
            requirementId: current.requirementId, scopeKey: input.scopeKey ?? '', value: input.value, expectedVersion: input.expectedVersion,
            origin: 'owner_form', sourceRef: { via: 'pending', pending_question_id: id },
        }, actor);
        const answer = String(input.answerText ?? '').trim().slice(0, 2000) || renderStoredValue(fact.value).slice(0, 2000) || null;
        const resolved = await this.transaction(tenantId, async query => {
            const rows = await query<Record<string, any>[]>(
                `UPDATE pending_questions
                    SET status = 'stored', stored_value_id = $2::uuid, answer_text = COALESCE($3, answer_text),
                        answered_by = $4::uuid, answered_at = clock_timestamp(), updated_at = clock_timestamp()
                  WHERE (id = $1::uuid AND status IN (${quoted(statusesAllowing('store'))}))
                     OR (requirement_id = $5 AND status IN ('gap','open'))
              RETURNING id::text AS id`,
                [id, fact.id, answer, userIdOf(actor), current.requirementId]);
            return rows.map(r => String(r.id));
        });
        if (!resolved.includes(id)) throw new ConflictException('la consulta cambió de estado mientras se guardaba; el valor quedó guardado');
        const after = await this.readiness.evaluateTenant(tenantId, 'invalidated').catch(() => null);
        for (const qid of resolved) this.events?.emit(PENDING_QUESTION_EVENTS.answered, { tenantId, id: qid, mode: 'store' });
        const notified = await this.notify(tenantId, resolved);
        return {
            question: toQuestionView(await this.find(tenantId, id), this.now()),
            fact,
            readiness: after ? {
                verdictBefore: before, verdictAfter: after.result.verdict,
                requirement: after.result.requirements.find((r: { id: string }) => r.id === current.requirementId) ?? null,
            } : null,
            resolved,
            notified,
        };
    }

    /** No aplica / spam: sin aviso al cliente; sus esperas quedan `dismissed`. */
    async dismiss(tenantId: string, id: string, actor: BusinessFactActor): Promise<PendingQuestionView> {
        const row = await this.transition(tenantId, id, 'dismiss', { set: `answered_by = $3::uuid, closed_at = clock_timestamp()`, params: [userIdOf(actor)] },
            `UPDATE pending_question_waiters SET notify_status = 'dismissed' WHERE pending_question_id = $1::uuid AND notify_status = 'waiting'`);
        return toQuestionView(row, this.now());
    }

    async close(tenantId: string, id: string): Promise<PendingQuestionView> {
        const row = await this.transition(tenantId, id, 'close', { set: `closed_at = clock_timestamp()`, params: [] });
        return toQuestionView(row, this.now());
    }

    /** Vuelve a intentar el aviso de las esperas que siguen `waiting` (p. ej. tras un fallo transitorio). */
    async renotify(tenantId: string, id: string): Promise<NotifySummary> {
        const row = toQuestionView(await this.find(tenantId, id), this.now());
        if (row.status !== 'answered' && row.status !== 'stored') throw new ConflictException('solo se avisa una consulta respondida');
        return this.notify(tenantId, [id]);
    }

    // ─────────────────────────── internos ───────────────────────────

    private async notify(tenantId: string, ids: string[]): Promise<NotifySummary> {
        if (!this.notifier || !ids.length) return {};
        try {
            const summary = await this.notifier.notifyQuestions(tenantId, ids);
            if (summary.sent) this.events?.emit(PENDING_QUESTION_EVENTS.customerNotified, { tenantId, ids, sent: summary.sent });
            return summary;
        } catch (err) {
            this.logger.warn(`pending: aviso a las esperas falló para ${tenantId}: ${(err as Error).message}`);
            return { failed: 1 };
        }
    }

    private async transition(tenantId: string, id: string, action: PendingQuestionAction, update: { set: string; params: unknown[] }, after?: string): Promise<Record<string, any>> {
        const current = await this.find(tenantId, id);
        const to = nextStatus(current.status as PendingQuestionStatus, action);
        if (!to) throw new ConflictException(`acción ${action} no permitida desde ${current.status}`);
        return this.transaction(tenantId, async query => {
            const [row] = await query<Record<string, any>[]>(
                `UPDATE pending_questions SET status = $2, ${update.set}, updated_at = clock_timestamp()
                  WHERE id = $1::uuid AND status IN (${quoted(statusesAllowing(action))}) RETURNING ${COLUMNS}`,
                [id, to, ...update.params]);
            if (!row) throw new ConflictException('la consulta cambió de estado; vuelve a cargarla');
            if (after) await query(after, [id]);
            return row;
        });
    }

    private async find(tenantId: string, id: string): Promise<Record<string, any>> {
        if (!UUID.test(String(id ?? ''))) throw new BadRequestException('id inválido');
        const [row] = await this.read<Record<string, any>[]>(tenantId, `SELECT ${COLUMNS} FROM pending_questions WHERE id = $1::uuid`, [id]);
        if (!row) throw new NotFoundException('consulta pendiente no encontrada');
        return row;
    }

    private async routingValue(tenantId: string): Promise<unknown> {
        try {
            return (await this.facts.get(tenantId, 'CORE.PENDING.ROUTING', '')).fact?.value ?? null;
        } catch {
            return null;
        }
    }

    private async transaction<T>(tenantId: string, fn: (query: Query) => Promise<T>): Promise<T> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        return this.prisma.transactionInTenantSchema(schema, fn as any) as Promise<T>;
    }

    private async run<T>(tenantId: string, sql: string, params: unknown[]): Promise<T> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        return this.prisma.executeInTenantSchema<T>(schema, sql, params as any[]);
    }

    /** Lectura: sin la tabla (tenant aún no migrado) no hay consultas. */
    private async read<T extends unknown[]>(tenantId: string, sql: string, params: unknown[]): Promise<T> {
        try {
            return await this.run<T>(tenantId, sql, params);
        } catch (err) {
            if (isUndefinedTable(err)) return [] as unknown as T;
            throw err;
        }
    }
}

const quoted = (statuses: readonly string[]) => statuses.map(s => `'${s}'`).join(',');
const userIdOf = (actor: BusinessFactActor): string | null => (actor.kind === 'user' && actor.userId && UUID.test(actor.userId) ? actor.userId : null);

