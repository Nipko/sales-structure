/**
 * D1a (ADR 0016): un turno sellado (Agent Test, ensayo, evaluación) ve el mismo `<knowledge_status>` que un turno vivo.
 * Antes de D1a ningún turno sellado lo recibía (`!evaluationContext` siempre falso con sesión), así que E1 midió un
 * agente que no sabía qué dato era de ejemplo, sembrado o ausente. El contrato se sella en la foto y el turno lo lee de
 * ahí: nunca del contrato vivo.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildTurnContract, evaluate, fromLegacyRows, type LegacyTenantRows } from '@parallext/business-spec';
import { loadSpec } from '@parallext/business-spec/load';
import { agentTurnFixture } from './__fixtures__/agent-turn.fixture';
import { resolveEvaluationTurnContext } from './evaluation-turn-context';

const FIXTURES = path.resolve(__dirname, '../../../../../packages/business-spec/test/fixtures/qa-tenants');
const NOW = new Date('2026-10-30T12:00:00.000Z');
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function dentalContract() {
    const spec = loadSpec();
    const rows = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'spark-qa-dental-03.snapshot.json'), 'utf8')) as LegacyTenantRows;
    const snap = fromLegacyRows({ ...rows, capturedAt: NOW.toISOString() } as any);
    return buildTurnContract(spec, snap, evaluate(spec, snap, NOW), { now: NOW });
}

function fixtureWith(contract: unknown) {
    const readinessContext = {
        contract: jest.fn().mockResolvedValue(contract),
        forTurn: jest.fn(async () => { throw new Error('live_contract_forbidden_in_sealed_turn'); }),
    };
    const f = agentTurnFixture({ readinessContext });
    f.prisma.tenant.findUnique.mockResolvedValue({ operatingCountry: 'CO', industry: 'health', settings: {} });
    return { f, readinessContext };
}

describe('D1a · contrato de conocimiento sellado en la foto de evaluación', () => {
    it('el turno sellado pinta <knowledge_status> desde la foto y ofrece «lo averiguo» según el contrato sellado', async () => {
        const contract = dentalContract();
        expect(contract.unknown.length).toBeGreaterThan(0);
        const { f, readinessContext } = fixtureWith(contract);
        const snapshot = await f.service.captureSnapshot('tenant', AGENT);
        expect(readinessContext.contract).toHaveBeenCalledWith('tenant');
        expect(snapshot.contextInputs?.knowledgeContract?.resultHash).toBe(contract.resultHash);

        const response = await f.service.test('tenant', AGENT, { message: '¿Cuál es su horario?' }, { agentSnapshot: snapshot });
        expect(response.debug.runtimeError).toBeUndefined();
        expect(response.debug.systemPrompt).toContain('<knowledge_status');
        expect(readinessContext.forTurn).not.toHaveBeenCalled();
        expect(f.turnCapabilityComposer.resolve).toHaveBeenCalledWith(expect.objectContaining({
            sealedKnowledgeOffers: { pendingQuestion: contract.offers.pendingQuestion === true },
        }));
    });

    it('una foto sin contrato (anterior a D1a o sin evaluación) corre sin el bloque y sin leer el contrato vivo', async () => {
        const { f, readinessContext } = fixtureWith(null);
        const snapshot = await f.service.captureSnapshot('tenant', AGENT);
        expect(snapshot.contextInputs).not.toHaveProperty('knowledgeContract');
        const response = await f.service.test('tenant', AGENT, { message: '¿Cuál es su horario?' }, { agentSnapshot: snapshot });
        expect(response.debug.systemPrompt).not.toContain('<knowledge_status');
        expect(readinessContext.forTurn).not.toHaveBeenCalled();
        expect(f.turnCapabilityComposer.resolve).toHaveBeenCalledWith(expect.objectContaining({ sealedKnowledgeOffers: { pendingQuestion: false } }));
    });

    it('la foto rechaza un contrato mal formado', async () => {
        const { f } = fixtureWith(dentalContract());
        const inputs = (await f.service.captureSnapshot('tenant', AGENT)).contextInputs!;
        expect(() => resolveEvaluationTurnContext({ ...inputs, knowledgeContract: 'x' as any }, 'tenant')).toThrow('agent_snapshot_context_inputs_required');
        expect(() => resolveEvaluationTurnContext({ ...inputs, knowledgeContract: { specVersion: 1 } as any }, 'tenant')).toThrow('agent_snapshot_context_inputs_required');
    });
});
