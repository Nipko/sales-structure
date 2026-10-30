import { randomUUID } from 'crypto';
import { AgentContentProposalService } from '../copilot/agent-content-proposal.service';
import { confirmedRowProvenanceStatement } from '../readiness/business-facts.service';

/**
 * R6 (C0 §4.3, ADR 0012), lo que se retira: una FAQ creada desde Assist ya no queda como una fila sin procedencia que el
 * motor lee con las reglas heredadas. Es una propuesta CON requisito (`CORE.KNOWLEDGE.SOURCES`: se ingiere como
 * documento de conocimiento), y al aplicarla la persona que la aprueba queda como `confirmed_by` del documento ingerido,
 * con la propuesta en `source_ref` y `origin=copilot`.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const ADMIN = { id: '33333333-3333-4333-8333-333333333333', role: 'tenant_admin' };
const FAQ = { title: '¿Hacen envíos?', content: 'Sí, a todo el país en 48 horas.' };

function harness(opts: { ingested?: boolean } = {}) {
    const ledger: any[] = [];
    const exec = jest.fn(async (_schema: string, sql: string, params: any[] = []) => {
        if (sql.includes('COUNT(*)::int AS c FROM knowledge_resources')) return [{ c: 0 }];
        if (sql.includes('FROM agent_content_proposals WHERE requested_by')) return ledger.filter(r => r.requested_by === params[0] && r.request_key === params[1]);
        if (sql.startsWith('SELECT * FROM agent_content_proposals WHERE id')) return ledger.filter(r => r.id === params[0]);
        if (sql.startsWith('INSERT INTO agent_content_proposals')) {
            const row = {
                id: randomUUID(), operation: params[0], requested_by: params[1], request_key: params[2], digest: params[3], input: JSON.parse(params[4]),
                requirement_id: params[5], target_ref: params[6], status: 'proposed', expires_at: new Date(Date.now() + 1_800_000).toISOString(), created_object_id: null,
            };
            ledger.push(row);
            return [row];
        }
        if (sql.includes("SET status='applied'")) {
            const row = ledger.find(r => r.id === params[0] && r.status === 'proposed');
            if (!row) return [];
            Object.assign(row, { status: 'applied', applied_by: params[1] });
            return [row];
        }
        if (sql.includes('SET created_object_id')) { ledger.find(r => r.id === params[0]).created_object_id = params[1]; return []; }
        if (sql.includes('SET target_ref')) { ledger.find(r => r.id === params[0]).target_ref = params[1]; return []; }
        if (sql.startsWith('SELECT id, title FROM knowledge_resources')) return [{ id: params[0], title: FAQ.title }];
        throw new Error(`SQL inesperado: ${sql}`);
    });
    const prisma: any = {
        getTenantSchemaName: jest.fn(async () => 'tenant_scope'), ensureCanonicalTables: jest.fn(async () => undefined),
        executeInTenantSchema: exec, auditLog: { create: jest.fn(async () => ({})) },
    };
    const throttle: any = { isFeatureEnabled: jest.fn(async () => true), enforcePlanLimit: jest.fn(async () => undefined) };
    const documentId = randomUUID();
    const knowledge: any = {
        createResource: jest.fn(async (_s: string, _t: string, data: any) => ({ id: randomUUID(), title: data.title, document_id: opts.ingested === false ? null : documentId })),
    };
    const verticals: any = { getVerticalConfig: jest.fn(async () => ({ effectiveCapabilities: ['faq_search'] })) };
    const facts: any = { stampRowProvenance: jest.fn(async () => true) };
    const service = new AgentContentProposalService(prisma, throttle, knowledge, {} as any, {} as any, {} as any, verticals, facts);
    return { service, ledger, facts, documentId };
}

describe('Assist: una FAQ es una propuesta con requisito y procedencia (R6)', () => {
    it('la propuesta guarda el requisito al que sirve', async () => {
        const kit = harness();
        await kit.service.propose(TENANT, 'knowledge.faq.create', FAQ, ADMIN);
        expect(kit.ledger[0]).toMatchObject({ requirement_id: 'CORE.KNOWLEDGE.SOURCES', target_ref: 'knowledge_documents' });
    });

    it('al aplicarla, el documento ingerido queda confirmado por la persona, con la propuesta en source_ref', async () => {
        const kit = harness();
        const proposal = await kit.service.propose(TENANT, 'knowledge.faq.create', FAQ, ADMIN);
        const applied = await kit.service.apply(TENANT, proposal.id, proposal.digest, ADMIN);
        expect(applied.verification).toBe('verified');
        expect(kit.facts.stampRowProvenance).toHaveBeenCalledWith(TENANT, {
            table: 'knowledge_documents', id: kit.documentId, origin: 'copilot',
            sourceRef: expect.objectContaining({ via: 'assist', proposal_id: proposal.id, digest: proposal.digest, requirement_id: 'CORE.KNOWLEDGE.SOURCES' }),
        }, expect.objectContaining({ kind: 'user', userId: ADMIN.id }));
        expect(kit.ledger[0].target_ref).toBe(`knowledge_documents:${kit.documentId}`);
    });

    it('si la ingesta falló no hay documento que estampar, y la FAQ igual se crea', async () => {
        const kit = harness({ ingested: false });
        const proposal = await kit.service.propose(TENANT, 'knowledge.faq.create', FAQ, ADMIN);
        await kit.service.apply(TENANT, proposal.id, proposal.digest, ADMIN);
        expect(kit.facts.stampRowProvenance).not.toHaveBeenCalled();
    });

    it('la sentencia de procedencia confirma, marca la fila y solo acepta tablas con el juego de columnas', () => {
        const st = confirmedRowProvenanceStatement({ table: 'knowledge_documents', id: 'd', origin: 'copilot', confirmedBy: ADMIN.id, sourceRef: { proposal_id: 'p' } });
        expect(st.sql).toContain("content_status = 'confirmed'");
        expect(st.sql).toContain("jsonb_build_object('row_updated_at', to_jsonb(updated_at))");
        expect(st.params).toEqual(['d', 'copilot', ADMIN.id, JSON.stringify({ proposal_id: 'p' })]);
        expect(() => confirmedRowProvenanceStatement({ table: 'knowledge_resources', id: 'd', origin: 'copilot', confirmedBy: ADMIN.id, sourceRef: {} })).toThrow(/sin columnas/);
    });
});
