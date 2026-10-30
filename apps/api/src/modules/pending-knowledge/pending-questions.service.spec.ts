import { ConflictException } from '@nestjs/common';
import { PendingQuestionsService } from './pending-questions.service';

/**
 * Bucle de conocimiento pendiente (R5, ADR 0011) sobre una base en memoria que interpreta las sentencias del servicio:
 * deduplicación por tema, esperas idempotentes, máquina de estados, «guardar como dato» por BusinessFactsService con
 * reevaluación de la preparación, y aviso a las esperas solo tras responder.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const OWNER = '99999999-9999-4999-8999-999999999999';
const conv = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const PARKING = 'CORE.LOCATION.PARKING';

interface Row { [k: string]: any }

function fakeDb() {
    const questions: Row[] = [];
    const waiters: Row[] = [];
    let seq = 0;
    const id = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`;
    const allowed = (sql: string) => (sql.match(/status IN \(([^)]*)\)/)?.[1] ?? '').split(',').map(s => s.trim().replace(/'/g, ''));
    const query = jest.fn(async (sql: string, params: any[] = []): Promise<any[]> => {
        if (sql.includes('INSERT INTO pending_questions')) {
            const [requirement_id, item_ref, intent_id, topic_key, sample_question, sample_conversation_id, language, source] = params;
            const open = questions.find(q => q.topic_key === topic_key && ['gap', 'open'].includes(q.status));
            if (open) {
                if (sql.includes('occurrences = pending_questions.occurrences + 1')) open.occurrences += 1;
                return [{ id: open.id, status: open.status, occurrences: open.occurrences, inserted: false }];
            }
            const row = { id: id(), requirement_id, item_ref, intent_id, topic_key, sample_question, sample_conversation_id, language, source,
                status: 'gap', occurrences: 1, waiters_count: 0, sla_due_at: null, answer_text: null, stored_value_id: null };
            questions.push(row);
            return [{ id: row.id, status: 'gap', occurrences: 1, inserted: true }];
        }
        if (sql.includes('INSERT INTO pending_question_waiters')) {
            const [qid, conversation_id, contact_id, language] = params;
            if (waiters.some(w => w.pending_question_id === qid && w.conversation_id === conversation_id)) return [];
            const w = { id: id(), pending_question_id: qid, conversation_id, contact_id, language, notify_status: 'waiting' };
            waiters.push(w);
            return [{ id: w.id }];
        }
        if (sql.includes(`SET status = 'open'`)) {
            const [qid, fresh, inserted, slaMs] = params;
            const q = questions.find(x => x.id === qid && ['gap', 'open'].includes(x.status));
            if (!q) return [];
            q.status = 'open';
            q.waiters_count = waiters.filter(w => w.pending_question_id === qid).length;
            if (fresh && !inserted) q.occurrences += 1;
            q.sla_due_at ??= new Date(Date.parse('2026-10-30T10:00:00Z') + Number(slaMs)).toISOString();
            return [{ id: q.id, status: q.status, sla_due_at: q.sla_due_at, waiters_count: q.waiters_count }];
        }
        if (sql.includes(`SET status = 'stored'`)) {
            const [qid, valueId, answer, , requirementId] = params;
            const touched = questions.filter(q => (q.id === qid && allowed(sql).includes(q.status))
                || (q.requirement_id === requirementId && ['gap', 'open'].includes(q.status)));
            for (const q of touched) Object.assign(q, { status: 'stored', stored_value_id: valueId, answer_text: answer ?? q.answer_text });
            return touched.map(q => ({ id: q.id }));
        }
        if (sql.startsWith('UPDATE pending_questions SET status = $2')) {
            const [qid, to, ...rest] = params;
            const q = questions.find(x => x.id === qid && allowed(sql).includes(x.status));
            if (!q) return [];
            q.status = to;
            if (sql.includes('answer_text = $3')) q.answer_text = rest[0];
            return [{ ...q }];
        }
        if (sql.includes(`UPDATE pending_question_waiters SET notify_status = 'dismissed'`)) {
            for (const w of waiters) if (w.pending_question_id === params[0] && w.notify_status === 'waiting') w.notify_status = 'dismissed';
            return [];
        }
        if (sql.includes('FROM pending_questions WHERE id = $1::uuid')) return questions.filter(q => q.id === params[0]).map(q => ({ ...q }));
        if (sql.includes('FROM pending_question_waiters WHERE pending_question_id')) return waiters.filter(w => w.pending_question_id === params[0]);
        if (sql.includes('GROUP BY status')) {
            const by = new Map<string, number>();
            for (const q of questions) by.set(q.status, (by.get(q.status) ?? 0) + 1);
            return [...by].map(([status, n]) => ({ status, n, overdue: 0 }));
        }
        if (sql.includes('FROM pending_questions')) return questions.filter(q => ['gap', 'open'].includes(q.status)).map(q => ({ ...q }));
        throw new Error(`sentencia no prevista: ${sql.slice(0, 80)}`);
    });
    const prisma = {
        getTenantSchemaName: jest.fn(async () => 'tenant_x'),
        executeInTenantSchema: jest.fn((_s: string, sql: string, params?: any[]) => query(sql, params)),
        transactionInTenantSchema: jest.fn(async (_s: string, fn: any) => fn(query)),
    };
    return { questions, waiters, query, prisma };
}

function build(options: { routing?: unknown } = {}) {
    const db = fakeDb();
    const readiness = {
        spec: { requirements: { [PARKING]: {}, 'CORE.PENDING.ROUTING': {} } },
        currentVerdict: jest.fn(async () => 'limitado'),
        evaluateTenant: jest.fn(async () => ({ result: { verdict: 'listo', requirements: [{ id: PARKING, result: 'cumple' }] } })),
    };
    const facts = {
        get: jest.fn(async () => ({ fact: options.routing === undefined ? null : { value: options.routing } })),
        write: jest.fn(async (_t: string, input: any) => ({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', requirementId: input.requirementId, value: input.value })),
    };
    const notifier = { notifyQuestions: jest.fn(async (_t: string, ids: string[]) => ({ sent: ids.length })) };
    const events = { emit: jest.fn() };
    const service = new PendingQuestionsService(db.prisma as any, readiness as any, facts as any, notifier as any, events as any);
    jest.spyOn(service as any, 'now').mockReturnValue(new Date('2026-10-30T10:00:00Z'));
    return { ...db, readiness, facts, notifier, events, service };
}

const owner = { kind: 'user' as const, userId: OWNER, role: 'tenant_admin' };

describe('PendingQuestionsService · demanda y esperas', () => {
    it('10 clientes con la misma pregunta: 1 consulta abierta con 10 esperas (C0 R5 aceptación 3)', async () => {
        const t = build({ routing: { channel: ['panel'], sla: { min: 4, unit: 'h' } } });
        for (let i = 1; i <= 10; i++) {
            await t.service.acceptWait(TENANT, { question: i % 2 ? '¿Tienen parqueadero?' : 'tienen PARQUEADERO', conversationId: conv(i), language: 'es' });
        }
        expect(t.questions).toHaveLength(1);
        expect(t.questions[0]).toMatchObject({ status: 'open', waiters_count: 10, occurrences: 10 });
        expect(t.waiters).toHaveLength(10);
        expect(t.questions[0].sla_due_at).toBe('2026-10-30T14:00:00.000Z');
    });

    it('la misma conversación aceptando dos veces no agrega otra espera ni otra ocurrencia', async () => {
        const t = build();
        const first = await t.service.acceptWait(TENANT, { question: '¿Hay parqueo?', requirementId: PARKING, conversationId: conv(1) });
        const again = await t.service.acceptWait(TENANT, { question: 'y el parqueadero?', requirementId: PARKING, conversationId: conv(1) });
        expect(first.alreadyWaiting).toBe(false);
        expect(again).toMatchObject({ id: first.id, alreadyWaiting: true, waitersCount: 1 });
        expect(t.questions[0]).toMatchObject({ topic_key: `req:${PARKING}`, occurrences: 1 });
        expect(t.events.emit.mock.calls.filter(([e]) => e === 'pending_question.opened')).toHaveLength(1);
    });

    it('un requisito que la especificación no conoce se deduplica por el texto', async () => {
        const t = build();
        await t.service.acceptWait(TENANT, { question: '¿Tienen wifi?', requirementId: 'CORE.NO.EXISTE', conversationId: conv(1) });
        expect(t.questions[0].requirement_id).toBeNull();
        expect(t.questions[0].topic_key).toMatch(/^q:/);
    });

    it('sin SLA declarado, 4 h (D10)', async () => {
        const t = build();
        await t.service.acceptWait(TENANT, { question: 'x?', conversationId: conv(1) });
        expect(t.questions[0].sla_due_at).toBe('2026-10-30T14:00:00.000Z');
    });

    it('recordGap suma demanda sin esperas y nunca lanza', async () => {
        const t = build();
        await t.service.recordGap(TENANT, { question: '¿Venden gift cards?', source: 'retrieval' });
        await t.service.recordGap(TENANT, { question: 'venden gift cards', source: 'retrieval' });
        expect(t.questions).toEqual([expect.objectContaining({ status: 'gap', occurrences: 2, waiters_count: 0 })]);
        t.prisma.executeInTenantSchema.mockRejectedValueOnce(new Error('relation "pending_questions" does not exist'));
        await expect(t.service.recordGap(TENANT, { question: 'y', source: 'agent' })).resolves.toBeNull();
    });
});

describe('PendingQuestionsService · el dueño responde', () => {
    it('responder una vez: answered, avisa a las esperas y no toca la preparación', async () => {
        const t = build();
        const { id } = await t.service.acceptWait(TENANT, { question: '¿Abren el festivo?', conversationId: conv(1) });
        const out = await t.service.answerOnce(TENANT, id, 'Sí, de 9 a 13.', owner);
        expect(out.question).toMatchObject({ status: 'answered', answerText: 'Sí, de 9 a 13.' });
        expect(t.notifier.notifyQuestions).toHaveBeenCalledWith(TENANT, [id]);
        expect(t.facts.write).not.toHaveBeenCalled();
        expect(t.readiness.evaluateTenant).not.toHaveBeenCalled();
        await expect(t.service.answerOnce(TENANT, id, 'otra', owner)).rejects.toBeInstanceOf(ConflictException);
    });

    it('guardar como dato escribe por BusinessFactsService, reevalúa y resuelve todas las abiertas del requisito', async () => {
        const t = build();
        const a = await t.service.acceptWait(TENANT, { question: '¿Hay parqueo?', requirementId: PARKING, conversationId: conv(1) });
        // otra entrada del mismo requisito con otro ítem (otro tema) también se resuelve
        await t.service.acceptWait(TENANT, { question: '¿Parqueo para motos?', requirementId: PARKING, itemRef: 'motos', conversationId: conv(2) });
        const unrelated = await t.service.acceptWait(TENANT, { question: '¿Aceptan perros?', conversationId: conv(3) });
        const out = await t.service.store(TENANT, a.id, { value: { available: true, notes: 'gratis' }, expectedVersion: 2 }, owner);
        expect(t.facts.write).toHaveBeenCalledWith(TENANT, expect.objectContaining({
            requirementId: PARKING, value: { available: true, notes: 'gratis' }, expectedVersion: 2, origin: 'owner_form',
            sourceRef: { via: 'pending', pending_question_id: a.id },
        }), owner);
        expect(t.readiness.evaluateTenant).toHaveBeenCalledWith(TENANT, 'invalidated');
        expect(out.readiness).toMatchObject({ verdictBefore: 'limitado', verdictAfter: 'listo' });
        expect(out.resolved).toHaveLength(2);
        expect(t.questions.filter(q => q.status === 'stored').every(q => q.stored_value_id === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBe(true);
        expect(t.questions.find(q => q.id === unrelated.id)?.status).toBe('open');
        // sin texto del dueño, el valor como texto legible (nunca JSON crudo)
        expect(t.questions.find(q => q.id === a.id)?.answer_text).toBe('available: true; notes: gratis');
        expect(t.notifier.notifyQuestions).toHaveBeenCalledWith(TENANT, out.resolved);
    });

    it('una consulta sin requisito no se guarda como dato', async () => {
        const t = build();
        const { id } = await t.service.acceptWait(TENANT, { question: '¿Tienen wifi?', conversationId: conv(1) });
        await expect(t.service.store(TENANT, id, { value: 'sí' }, owner)).rejects.toThrow(/requisito/);
        expect(t.facts.write).not.toHaveBeenCalled();
    });

    it('descartar no avisa y marca las esperas; cerrar solo lo respondido', async () => {
        const t = build();
        const { id } = await t.service.acceptWait(TENANT, { question: 'spam?', conversationId: conv(1) });
        await expect(t.service.close(TENANT, id)).rejects.toBeInstanceOf(ConflictException);
        const dismissed = await t.service.dismiss(TENANT, id, owner);
        expect(dismissed.status).toBe('dismissed');
        expect(t.waiters[0].notify_status).toBe('dismissed');
        expect(t.notifier.notifyQuestions).not.toHaveBeenCalled();
    });
});
