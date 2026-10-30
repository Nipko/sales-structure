import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { loadSpec } from '@parallext/business-spec/load';
import { BusinessFactsService, type BusinessFactActor } from '../readiness/business-facts.service';
import { CopilotProposalsListener } from './copilot-proposals.listener';
import { CopilotProposalsService, type CopilotProposalDraft } from './copilot-proposals.service';

/**
 * R6 (C0 §1.3 y §2.8, ADR 0012): el ciclo de una propuesta del copiloto. Se ejerce el SQL real del servicio sobre una
 * base en memoria, y la aprobación pasa por el BusinessFactsService real: la propuesta no es un valor hasta que una
 * persona la aprueba, y entonces se escribe con `origin=copilot`, `confirmed_by` y la propuesta en `source_ref`.
 */
const TENANT = '5f7883f0-0000-4000-8000-000000000001';
const SCHEMA = 'tenant_copilot_test';
const OWNER: BusinessFactActor = { kind: 'user', userId: '11111111-1111-4111-8111-111111111111', role: 'tenant_admin' };
const RUN = '22222222-2222-4222-8222-222222222222';
const PAYMENT = 'CORE.PAYMENT.METHODS';
const EVIDENCE = [{ sourceRef: 'S1', origin: 'knowledge_documents:d1', label: 'Inicio', url: 'https://sonrisa.co', quote: 'Aceptamos efectivo y transferencia' }];
const spec = loadSpec();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function fakeDb() {
    const ledger: Record<string, any>[] = [];
    const values = new Map<string, Record<string, any>>();
    const now = () => Date.now();
    const open = (r: any) => r.status === 'proposed';
    const exec = jest.fn(async (_schema: string, sql: string, params: any[] = []) => {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (s.startsWith('INSERT INTO agent_content_proposals')) {
            if (ledger.some(r => r.requested_by === params[1] && r.request_key === params[2])) return [];
            const row = {
                id: randomUUID(), operation: params[0], requested_by: params[1], request_key: params[2], digest: params[3],
                input: JSON.parse(params[4]), status: 'proposed', expires_at: new Date(now() + 30 * 86_400_000).toISOString(),
                created_at: new Date().toISOString(), requirement_id: params[5], target_ref: params[6], evidence: JSON.parse(params[7]),
                extraction_run_id: params[8], applied_at: null, applied_by: null, decided_by: null, decided_at: null, decision_note: null, created_object_id: null,
            };
            ledger.push(row);
            return [clone(row)];
        }
        if (s.includes("SET status = 'superseded'")) {
            const hit = ledger.filter(r => r.operation.startsWith('copilot.') && open(r) && r.requirement_id === params[0] && (r.target_ref ?? '') === params[1] && r.id !== params[3]);
            for (const r of hit) Object.assign(r, { status: 'superseded', decision_note: params[2], decided_at: new Date().toISOString() });
            return hit.map(r => ({ id: r.id }));
        }
        if (s.includes("SET status = 'expired'")) {
            for (const r of ledger) if (r.operation.startsWith('copilot.') && open(r) && Date.parse(r.expires_at) <= now()) r.status = 'expired';
            return [];
        }
        if (s.startsWith('SELECT status, COUNT(*)')) {
            const counts = new Map<string, number>();
            for (const r of ledger) if (r.operation.startsWith('copilot.')) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
            return [...counts].map(([status, n]) => ({ status, n }));
        }
        if (s.startsWith("SELECT * FROM agent_content_proposals WHERE id = $1::uuid AND operation LIKE 'copilot.%'")) {
            return clone(ledger.filter(r => r.id === params[0] && r.operation.startsWith('copilot.')));
        }
        if (s.startsWith("SELECT * FROM agent_content_proposals WHERE operation LIKE 'copilot.%'")) {
            const rows = ledger.filter(r => r.operation.startsWith('copilot.') && (!s.includes('AND status = $1') || r.status === params[0]));
            return clone(rows.reverse());
        }
        if (s.includes("SET status = 'applied'")) {
            const r = ledger.find(x => x.id === params[0]);
            if (!r || !open(r) || Date.parse(r.expires_at) <= now()) return [];
            Object.assign(r, { status: 'applied', applied_by: params[1], decided_by: params[1], applied_at: new Date().toISOString(), decided_at: new Date().toISOString() });
            return [clone(r)];
        }
        if (s.includes("SET status = 'proposed', applied_at = NULL")) {
            const r = ledger.find(x => x.id === params[0] && x.status === 'applied' && !x.created_object_id);
            if (r) Object.assign(r, { status: 'proposed', applied_at: null, applied_by: null, decided_by: null, decided_at: null });
            return [];
        }
        if (s.startsWith('UPDATE agent_content_proposals SET created_object_id')) {
            const r = ledger.find(x => x.id === params[0]);
            if (r) Object.assign(r, { created_object_id: params[1], decision_note: params[2] });
            return r ? [clone(r)] : [];
        }
        if (s.includes("SET status = 'rejected'")) {
            const r = ledger.find(x => x.id === params[0] && open(x) && x.operation.startsWith('copilot.'));
            if (!r) return [];
            Object.assign(r, { status: 'rejected', decided_by: params[1], decision_note: params[2], decided_at: new Date().toISOString() });
            return [clone(r)];
        }
        // la sentencia única de BusinessFactsService (como en business-facts.service.spec.ts)
        if (/^WITH written AS \( INSERT INTO requirement_values/.test(s)) {
            const [requirementId, scopeKey, value, status, origin, confirmedBy, confirmedAt, sourceRef, , specVersion, , expected] = params;
            const key = `${requirementId}|${scopeKey}`;
            const cur = values.get(key);
            if (cur && expected !== null && expected !== undefined && cur.version !== expected) return [];
            // el CHECK requirement_values_copilot_confirmed de la base
            if (origin === 'copilot' && (status !== 'confirmed' || !confirmedBy)) throw new Error('violates check constraint requirement_values_copilot_confirmed');
            const row = {
                id: cur?.id ?? randomUUID(), requirement_id: requirementId, scope_key: scopeKey, value: JSON.parse(value), status, origin,
                confirmed_by: confirmedBy, confirmed_at: confirmedAt, source_ref: sourceRef ? JSON.parse(sourceRef) : null, valid_until: null,
                spec_version: specVersion, version: cur ? cur.version + 1 : 1, updated_at: new Date().toISOString(),
            };
            values.set(key, row);
            return [clone(row)];
        }
        throw new Error(`SQL inesperado: ${s}`);
    });
    const prisma = {
        getTenantSchemaName: jest.fn(async () => SCHEMA),
        ensureCanonicalTables: jest.fn(async () => undefined),
        executeInTenantSchema: exec,
        auditLog: { create: jest.fn(async () => ({})) },
    };
    return { prisma, ledger, values };
}

function make() {
    const db = fakeDb();
    const readiness = {
        spec,
        currentVerdict: jest.fn(async () => 'no_listo'),
        evaluateTenant: jest.fn(async () => ({ result: { verdict: 'limitado', requirements: [{ id: PAYMENT, result: 'cumple' }] } })),
        invalidate: jest.fn(async () => undefined),
    };
    const events = { emit: jest.fn() };
    const facts = new BusinessFactsService(db.prisma as any, readiness as any, events as any);
    const service = new CopilotProposalsService(db.prisma as any, facts, readiness as any);
    return { db, readiness, events, facts, service };
}

const valueDraft = (value: unknown, requirementId = PAYMENT): CopilotProposalDraft =>
    ({ kind: 'value', requirementId, targetRef: '', input: { value }, evidence: EVIDENCE });

describe('CopilotProposalsService: una propuesta no es un valor', () => {
    it('guardar propuestas no escribe ningún valor del negocio', async () => {
        const kit = make();
        const write = jest.spyOn(kit.facts, 'write');
        const stored = await kit.service.storeRun(TENANT, RUN, OWNER.kind === 'user' ? OWNER.userId! : '', [valueDraft({ methods: ['efectivo', 'transferencia'] })]);
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({ kind: 'value', requirementId: PAYMENT, status: 'proposed', runId: RUN, evidence: EVIDENCE });
        // caduca a los 30 días (C0 §2.8)
        expect(Date.parse(stored[0].expiresAt) - Date.now()).toBeGreaterThan(29 * 86_400_000);
        expect(write).not.toHaveBeenCalled();
        expect(kit.db.values.size).toBe(0);
        expect(kit.readiness.evaluateTenant).not.toHaveBeenCalled();
    });
});

describe('CopilotProposalsService.approve', () => {
    it('escribe por BusinessFactsService con origin=copilot, confirmed_by y la propuesta en source_ref', async () => {
        const kit = make();
        const [p] = await kit.service.storeRun(TENANT, RUN, '11111111-1111-4111-8111-111111111111', [valueDraft({ methods: ['efectivo', 'transferencia'] })]);
        const result = await kit.service.approve(TENANT, p.id, {}, OWNER);
        expect(result.fact).toMatchObject({
            requirementId: PAYMENT, status: 'confirmed', origin: 'copilot', confirmedBy: '11111111-1111-4111-8111-111111111111', value: { methods: ['efectivo', 'transferencia'] },
        });
        expect(result.fact.sourceRef).toMatchObject({ via: 'copilot', proposal_id: p.id, extraction_run_id: RUN, edited: false, evidence: [{ origin: 'knowledge_documents:d1', quote: EVIDENCE[0].quote }] });
        expect(result.proposal).toMatchObject({ status: 'applied', factId: result.fact.id });
        expect(result.readiness).toMatchObject({ verdictBefore: 'no_listo', verdictAfter: 'limitado' });
        expect(kit.db.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'copilot.proposal_approved' }) }));
    });

    it('editar y aprobar: guarda el valor del dueño y lo marca editado', async () => {
        const kit = make();
        const [p] = await kit.service.storeRun(TENANT, RUN, '11111111-1111-4111-8111-111111111111', [valueDraft({ methods: ['efectivo'] })]);
        const result = await kit.service.approve(TENANT, p.id, { value: { methods: ['efectivo', 'Nequi'] } }, OWNER);
        expect(result.fact.value).toEqual({ methods: ['efectivo', 'Nequi'] });
        expect(result.fact.sourceRef).toMatchObject({ edited: true });
        expect(result.proposal.decisionNote).toBe('edited');
    });

    it('sin una persona no se aprueba (y la base tampoco admitiría copilot sin confirmed_by)', async () => {
        const kit = make();
        const [p] = await kit.service.storeRun(TENANT, RUN, '11111111-1111-4111-8111-111111111111', [valueDraft({ methods: ['efectivo'] })]);
        await expect(kit.service.approve(TENANT, p.id, {}, { kind: 'script', name: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
        await expect(kit.service.approve(TENANT, p.id, {}, { kind: 'user', userId: null })).rejects.toBeInstanceOf(ForbiddenException);
        await expect(kit.facts.write(TENANT, { requirementId: PAYMENT, value: { methods: ['efectivo'] }, origin: 'copilot' }, { kind: 'script', name: 'x' }))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(kit.db.values.size).toBe(0);
    });

    it('un valor que no cumple la especificación no se escribe y la propuesta vuelve a estar abierta', async () => {
        const kit = make();
        const [p] = await kit.service.storeRun(TENANT, RUN, '11111111-1111-4111-8111-111111111111', [valueDraft({ methods: ['efectivo'] })]);
        await expect(kit.service.approve(TENANT, p.id, { value: { metodos: ['efectivo'] } }, OWNER)).rejects.toBeInstanceOf(BadRequestException);
        expect((await kit.service.get(TENANT, p.id)).status).toBe('proposed');
        expect(kit.db.values.size).toBe(0);
    });

    it('una pregunta no se aprueba, y una contradicción entre fuentes exige elegir el valor', async () => {
        const kit = make();
        const [q, c] = await kit.service.storeRun(TENANT, RUN, '11111111-1111-4111-8111-111111111111', [
            { kind: 'question', requirementId: 'CORE.HOURS.REGULAR', targetRef: '', input: { question: { code: 'owner_question', text: '¿Abren los festivos?' } }, evidence: [] },
            { kind: 'contradiction', requirementId: PAYMENT, targetRef: '', evidence: EVIDENCE, input: { alternatives: [{ value: { methods: ['efectivo'] }, evidence: EVIDENCE }, { value: { methods: ['Nequi'] }, evidence: EVIDENCE }] } },
        ]);
        await expect(kit.service.approve(TENANT, q.id, {}, OWNER)).rejects.toBeInstanceOf(BadRequestException);
        await expect(kit.service.approve(TENANT, c.id, {}, OWNER)).rejects.toBeInstanceOf(BadRequestException);
        const chosen = await kit.service.approve(TENANT, c.id, { value: { methods: ['Nequi'] } }, OWNER);
        expect(chosen.fact).toMatchObject({ origin: 'copilot', value: { methods: ['Nequi'] } });
    });

    it('caducada a los 30 días: ya no se aprueba', async () => {
        const kit = make();
        const [p] = await kit.service.storeRun(TENANT, RUN, '11111111-1111-4111-8111-111111111111', [valueDraft({ methods: ['efectivo'] })]);
        kit.db.ledger[0].expires_at = new Date(Date.now() - 1000).toISOString();
        await expect(kit.service.approve(TENANT, p.id, {}, OWNER)).rejects.toBeInstanceOf(ConflictException);
        expect((await kit.service.get(TENANT, p.id)).status).toBe('expired');
        expect(kit.db.values.size).toBe(0);
    });

    it('aprobar dos veces escribe una sola vez', async () => {
        const kit = make();
        const [p] = await kit.service.storeRun(TENANT, RUN, '11111111-1111-4111-8111-111111111111', [valueDraft({ methods: ['efectivo'] })]);
        await kit.service.approve(TENANT, p.id, {}, OWNER);
        await expect(kit.service.approve(TENANT, p.id, {}, OWNER)).rejects.toBeInstanceOf(ConflictException);
        expect([...kit.db.values.values()][0].version).toBe(1);
    });
});

describe('CopilotProposalsService: reemplazo y rechazo', () => {
    it('una propuesta más nueva del mismo requisito deja la anterior en superseded', async () => {
        const kit = make();
        const [old] = await kit.service.storeRun(TENANT, RUN, '11111111-1111-4111-8111-111111111111', [valueDraft({ methods: ['efectivo'] })]);
        const [fresh] = await kit.service.storeRun(TENANT, '33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', [valueDraft({ methods: ['Nequi'] })]);
        expect((await kit.service.get(TENANT, old.id))).toMatchObject({ status: 'superseded', decisionNote: 'newer_proposal' });
        expect((await kit.service.get(TENANT, fresh.id)).status).toBe('proposed');
        await expect(kit.service.approve(TENANT, old.id, {}, OWNER)).rejects.toBeInstanceOf(ConflictException);
    });

    it('un valor escrito por otra puerta (el formulario) reemplaza las abiertas; la aprobación del copiloto no', async () => {
        const kit = make();
        const [p] = await kit.service.storeRun(TENANT, RUN, '11111111-1111-4111-8111-111111111111', [valueDraft({ methods: ['efectivo'] })]);
        const listener = new CopilotProposalsListener(kit.service);
        await listener.onFactWritten({ tenantId: TENANT, requirementId: PAYMENT, scopeKey: '', version: 1, origin: 'copilot' });
        expect((await kit.service.get(TENANT, p.id)).status).toBe('proposed');
        await listener.onFactWritten({ tenantId: TENANT, requirementId: PAYMENT, scopeKey: '', version: 2, origin: 'owner_form' });
        expect((await kit.service.get(TENANT, p.id))).toMatchObject({ status: 'superseded', decisionNote: 'newer_value' });
    });

    it('aprobar una deja las demás abiertas del requisito en superseded', async () => {
        const kit = make();
        const [a] = await kit.service.storeRun(TENANT, RUN, '11111111-1111-4111-8111-111111111111', [valueDraft({ methods: ['efectivo'] })]);
        // otra abierta del mismo requisito (otra ejecución la habría reemplazado; se inserta a mano)
        kit.db.ledger.push({ ...clone(kit.db.ledger[0]), id: randomUUID(), request_key: 'otra', status: 'proposed' });
        await kit.service.approve(TENANT, a.id, {}, OWNER);
        expect(kit.db.ledger.map(r => r.status).sort()).toEqual(['applied', 'superseded']);
    });

    it('rechazar deja quién y cuándo, y no escribe nada', async () => {
        const kit = make();
        const [p] = await kit.service.storeRun(TENANT, RUN, '11111111-1111-4111-8111-111111111111', [valueDraft({ methods: ['efectivo'] })]);
        const rejected = await kit.service.reject(TENANT, p.id, 'no aceptamos efectivo', OWNER);
        expect(rejected).toMatchObject({ status: 'rejected', decisionNote: 'no aceptamos efectivo' });
        expect(kit.db.ledger[0].decided_by).toBe('11111111-1111-4111-8111-111111111111');
        expect(kit.db.values.size).toBe(0);
        const list = await kit.service.list(TENANT, { status: 'all' });
        expect(list.counts).toMatchObject({ rejected: 1, proposed: 0 });
    });
});
