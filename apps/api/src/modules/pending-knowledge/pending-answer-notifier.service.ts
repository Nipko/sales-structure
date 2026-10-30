/**
 * Aviso al cliente que esperaba una respuesta (C0 §1.5, rebanada R5, ADR 0011).
 *
 * Por cada espera `waiting` de una consulta respondida o guardada como dato, decide (función pura `decideWaiterNotice`)
 * y, si corresponde, prepara el mensaje en el idioma del cliente por la salida durable de siempre
 * (ProactiveDispatchService: fila en `agent_dispatch_outbox`, autoridad `pending_answer_ready` revalidada al enviar,
 * admisión del gasto en el procesador). Reglas que se respetan, ya existentes en la plataforma:
 * - **Ventana de 24 h** (WhatsApp, Instagram, Messenger): dentro, texto libre; fuera hace falta la plantilla
 *   utilitaria `pending_answer_ready`, que todavía no existe aprobada en Meta. Se registra `template_required` y el
 *   dueño ve en la bandeja que ese cliente no recibió el aviso (ADR 0011 §6).
 * - **Opt-out**: el registro de bajas de siempre (`isRecipientOptedOut`) → `opted_out`.
 * - **Conversación con una persona** (`with_human`) → `skipped_human`: el equipo ya está ahí y ve la respuesta en la
 *   bandeja; cerrada, archivada o spam → `skipped_closed`.
 * - **Pruebas**: los contactos de Agent Test y de la evaluación nunca reciben nada → `sandbox`.
 * Un fallo transitorio (`deferred`) deja la espera en `waiting` para reintentar desde la bandeja.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProactiveDispatchService } from '../channels/proactive-dispatch.service';
import { serviceWindowOpen } from '../channels/dispatch-price-facts';
import { isRecipientOptedOut } from '../../common/policies/opt-out-register';
import { AGENT_TEST_SANDBOX_CONTACT_ID, EVAL_SANDBOX_CONTACT_ID } from '../conversations/agent-test-tool-policy';
import { pendingAnswerText } from './pending-answer-text';

export type WaiterNoticeStatus = 'sent' | 'template_required' | 'opted_out' | 'skipped_human' | 'skipped_closed' | 'no_channel' | 'sandbox' | 'failed';
export type NotifySummary = Partial<Record<WaiterNoticeStatus | 'waiting' | 'unavailable', number>>;

export const PENDING_ANSWER_PRODUCER = 'pending_answer_ready';
/** Canales con la ventana de servicio de 24 h de Meta: fuera de ella, solo plantilla aprobada. */
export const WINDOWED_CHANNELS: ReadonlySet<string> = new Set(['whatsapp', 'instagram', 'messenger']);
const SANDBOX_CONTACTS: ReadonlySet<string> = new Set([AGENT_TEST_SANDBOX_CONTACT_ID, EVAL_SANDBOX_CONTACT_ID]);
const CLOSED_CONVERSATION = new Set(['resolved', 'archived', 'spam', 'closed', 'blocked']);

export interface WaiterNoticeInput {
    contactId: string | null;
    questionStatus: string;
    answerText: string | null;
    conversationStatus: string | null;
    /** null: la conversación no existe. */
    channelType: string | null;
    channelAccountId: string | null;
    recipient: string | null;
    /** Ventana de 24 h abierta (solo se pregunta para los canales con ventana). */
    windowOpen?: boolean;
}

export type WaiterNoticeDecision =
    | { kind: 'send' }
    | { kind: 'wait'; detail: string }
    | { kind: 'skip'; status: Exclude<WaiterNoticeStatus, 'sent' | 'failed'>; detail: string };

/** Qué se hace con una espera. Puro: el orden de las reglas es la política. */
export function decideWaiterNotice(input: WaiterNoticeInput): WaiterNoticeDecision {
    if (input.contactId && SANDBOX_CONTACTS.has(input.contactId.toLowerCase())) return { kind: 'skip', status: 'sandbox', detail: 'contacto de prueba' };
    if (!['answered', 'stored', 'closed'].includes(input.questionStatus) || !String(input.answerText ?? '').trim()) {
        return { kind: 'wait', detail: 'la consulta no tiene respuesta' };
    }
    if (!input.channelType) return { kind: 'skip', status: 'skipped_closed', detail: 'la conversación ya no existe' };
    const status = String(input.conversationStatus ?? 'active');
    if (CLOSED_CONVERSATION.has(status)) return { kind: 'skip', status: 'skipped_closed', detail: `conversación ${status}` };
    if (status === 'with_human') return { kind: 'skip', status: 'skipped_human', detail: 'la atiende una persona del equipo' };
    if (!String(input.channelAccountId ?? '').trim() || !String(input.recipient ?? '').trim()) return { kind: 'skip', status: 'no_channel', detail: 'sin conexión o destinatario' };
    if (WINDOWED_CHANNELS.has(input.channelType) && input.windowOpen !== true) {
        return { kind: 'skip', status: 'template_required', detail: 'fuera de la ventana de 24 h: falta la plantilla pending_answer_ready' };
    }
    return { kind: 'send' };
}

@Injectable()
export class PendingAnswerNotifier {
    private readonly logger = new Logger(PendingAnswerNotifier.name);

    constructor(
        private readonly prisma: PrismaService,
        @Optional() private readonly proactive?: ProactiveDispatchService,
    ) {}

    async notifyQuestions(tenantId: string, questionIds: readonly string[]): Promise<NotifySummary> {
        const summary: NotifySummary = {};
        const bump = (k: keyof NotifySummary) => { summary[k] = (summary[k] ?? 0) + 1; };
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        const query = <R = any[]>(sql: string, params: unknown[] = []) => this.prisma.executeInTenantSchema<R>(schema, sql, params as any[]);
        const rows = await query<Record<string, any>[]>(
            `SELECT w.id::text AS id, w.conversation_id::text AS conversation_id,
                    COALESCE(w.contact_id, c.contact_id)::text AS contact_id, w.language,
                    q.sample_question, q.answer_text, q.status AS question_status,
                    c.status AS conversation_status, c.channel_type, c.channel_account_id,
                    COALESCE(NULLIF(ct.external_id, ''), ct.phone) AS recipient
               FROM pending_question_waiters w
               JOIN pending_questions q ON q.id = w.pending_question_id
               LEFT JOIN conversations c ON c.id = w.conversation_id
               LEFT JOIN contacts ct ON ct.id = COALESCE(w.contact_id, c.contact_id)
              WHERE w.pending_question_id = ANY($1::uuid[]) AND w.notify_status = 'waiting'
              ORDER BY w.accepted_at`, [questionIds]);
        for (const row of rows) {
            const channelType = row.channel_type ? String(row.channel_type) : null;
            let windowOpen: boolean | undefined;
            if (channelType && WINDOWED_CHANNELS.has(channelType)) {
                windowOpen = await serviceWindowOpen(query as any, row.conversation_id).catch(() => false);
            }
            const decision = decideWaiterNotice({
                contactId: row.contact_id ?? null, questionStatus: String(row.question_status), answerText: row.answer_text ?? null,
                conversationStatus: row.conversation_status ?? null, channelType, channelAccountId: row.channel_account_id ?? null,
                recipient: row.recipient ?? null, windowOpen,
            });
            if (decision.kind === 'wait') { bump('waiting'); continue; }
            if (decision.kind === 'skip') { await this.mark(query, row.id, decision.status, decision.detail); bump(decision.status); continue; }
            if (await isRecipientOptedOut(query as any, { channel: String(channelType), ids: [row.contact_id] }).catch(() => true)) {
                await this.mark(query, row.id, 'opted_out', 'registro de bajas');
                bump('opted_out');
                continue;
            }
            if (!this.proactive) { bump('unavailable'); continue; }
            const outcome = await this.send(tenantId, schema, row, String(channelType));
            if (outcome.status === 'waiting') { bump('waiting'); continue; }
            await this.mark(query, row.id, outcome.status, outcome.detail);
            bump(outcome.status);
        }
        return summary;
    }

    private async send(tenantId: string, schema: string, row: Record<string, any>, channelType: string)
        : Promise<{ status: 'sent' | 'failed' | 'waiting'; detail: string }> {
        const proactive = this.proactive!;
        const channelAccountId = String(row.channel_account_id);
        const operationalScope = await proactive.policyAuthority(schema, {
            tenantId, producer: PENDING_ANSWER_PRODUCER, channelType, channelAccountId, entityId: String(row.id),
            contactId: row.contact_id ?? undefined,
        }).catch(() => undefined);
        if (!operationalScope) return { status: 'failed', detail: 'la espera ya no justifica el aviso' };
        const result = await proactive.send(tenantId, {
            originKey: `${PENDING_ANSWER_PRODUCER}:${row.id}`,
            conversationId: String(row.conversation_id), contactId: String(row.contact_id),
            channelType, channelAccountId, recipient: String(row.recipient),
            items: [{ kind: 'text', payload: { text: pendingAnswerText(row.language, { question: row.sample_question, answer: row.answer_text }) } }],
            operationalScope,
        });
        if (result.kind === 'prepared' || result.kind === 'already_present') return { status: 'sent', detail: result.kind };
        if (result.kind === 'deferred') {
            this.logger.warn(`pending: aviso diferido para la espera ${row.id}: ${result.reason}`);
            return { status: 'waiting', detail: result.reason };
        }
        return { status: 'failed', detail: `${result.kind}: ${result.reason}`.slice(0, 200) };
    }

    private async mark(query: <R = any[]>(sql: string, params?: unknown[]) => Promise<R>, waiterId: string, status: WaiterNoticeStatus, detail: string): Promise<void> {
        await query(
            `UPDATE pending_question_waiters
                SET notify_status = $2, notify_detail = $3,
                    notified_at = CASE WHEN $2 = 'sent' THEN clock_timestamp() ELSE notified_at END
              WHERE id = $1::uuid AND notify_status = 'waiting'`, [waiterId, status, detail.slice(0, 200)]);
    }
}
