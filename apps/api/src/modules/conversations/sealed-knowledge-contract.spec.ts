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
        expect(readinessContext.contract).toHaveBeenCalledTimes(1); // solo al capturar: el turno sellado no lee el contrato vivo
        expect(f.turnCapabilityComposer.resolve).toHaveBeenCalledWith(expect.objectContaining({
            sealedKnowledgeOffers: { pendingQuestion: contract.offers.pendingQuestion === true },
        }));
    });

    it('D1b: con la bandera sellada, la frase sin respaldo se quita y se agrega el aviso; sin bandera, no hay llamada', async () => {
        const contract = dentalContract();
        const reply = 'Nuestro horario es de lunes a viernes de 8 a 18. ¿Le ayudo con algo más?';
        for (const on of [true, false]) {
            const { f } = fixtureWith(contract);
            f.prisma.tenant.findUnique.mockResolvedValue({ operatingCountry: 'CO', industry: 'health',
                settings: on ? { featureFlags: { 'agentRuntime.evidenceVerifier': true } } : {} });
            f.llmRouter.execute.mockImplementation(async (req: any) => req.traceContext?.stage === 'evidence_verifier'
                ? { content: JSON.stringify({ violations: [{ sentence: 'Nuestro horario es de lunes a viernes de 8 a 18.', kind: 'claim', requirementId: 'CORE.HOURS.REGULAR' }] }), usage: {} }
                : { content: reply, model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 });
            const snapshot = await f.service.captureSnapshot('tenant', AGENT);
            expect(snapshot.contextInputs?.evidenceVerifier).toBe(on ? true : undefined);
            const response = await f.service.test('tenant', AGENT, { message: '¿Cuál es su horario?' }, { agentSnapshot: snapshot });
            const verifierCalls = f.llmRouter.execute.mock.calls.filter(([req]: any[]) => req.traceContext?.stage === 'evidence_verifier');
            if (on) {
                expect(verifierCalls).toHaveLength(1);
                // D1c: el verificador recibe la evidencia armada por turnEvidence (bloques con prefijo), no solo herramientas.
                const evidence = JSON.parse(verifierCalls[0][0].messages[0].content).evidence as string;
                expect(typeof evidence).toBe('string');
                expect(response.reply).not.toContain('lunes a viernes de 8 a 18');
                expect(response.reply).toContain('No tengo ese dato confirmado');
            } else {
                expect(verifierCalls).toHaveLength(0);
                expect(response.reply).toContain('lunes a viernes de 8 a 18');
            }
        }
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
