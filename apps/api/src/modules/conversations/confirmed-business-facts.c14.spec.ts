/**
 * C14 (dental, medición QA): el dueño confirmó `CORE.PAYMENT.METHODS = {methods: [efectivo, tarjeta_débito, tarjeta_crédito, Nequi,
 * transferencia]}`; el cliente pregunta «¿Aceptan tarjeta?» y el agente respondía «No consta en la información registrada qué
 * medios de pago acepta el negocio». Lo confirmado fuera de `RUNTIME_FACT_IDS` no llegaba al agente, y el guardia de medios de
 * pago (F4300-58) solo contaba lecturas de herramientas como respaldo.
 *
 * Ahora: los datos confirmados (y solo los confirmados y vigentes: lo sembrado no) se sellan en la foto de evaluación, se pintan
 * en `<confirmed_business_facts>` y respaldan la respuesta ante el guardia y el verificador de evidencia.
 */
import { BusinessFactsReader } from '../readiness/business-facts.reader';
import { agentTurnFixture } from './__fixtures__/agent-turn.fixture';
import { sealEvaluationSnapshot } from './agent-evaluation-snapshot';
import { resolveEvaluationTurnContext } from './evaluation-turn-context';
import { hasPolicyEvidence } from './policy-grounding';
import { PromptAssemblerService } from './prompt-assembler.service';
import { turnEvidence } from './runtime/evidence-verifier';
import { confirmedFactsAsReads, unbackedPaymentCorrection } from './unbacked-payment';

const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PAYMENT = { methods: ['efectivo', 'tarjeta_débito', 'tarjeta_crédito', 'Nequi', 'transferencia'] };
const PAYMENT_TEXT = 'efectivo, tarjeta débito, tarjeta crédito, Nequi, transferencia';
const REPLY = 'Sí, aceptamos tarjeta débito y tarjeta crédito, además de efectivo, Nequi y transferencia.';

const rv = (requirement_id: string, value: unknown, extra: Record<string, unknown> = {}) => ({
    id: `rv-${requirement_id}`, requirement_id, scope_key: '', value, status: 'confirmed', origin: 'owner_form', version: 1,
    confirmed_at: '2026-10-20T10:00:00.000Z', source_ref: null, valid_until: null, ...extra,
});

/** BusinessFactsReader real sobre una base mínima del tenant dental: pago confirmado, idiomas solo sembrados. */
function dentalReader(rows = [
    rv('CORE.PAYMENT.METHODS', PAYMENT),
    rv('OBJ.APPOINTMENT.CUSTOMER_REQUIREMENTS', [{ trámite: 'primera_cita', documents: ['nombre completo', 'teléfono', 'número de documento'] }]),
    rv('CORE.LANGUAGES.SERVED', { human_languages: ['es', 'en'] }, { status: 'seeded', origin: 'platform_seed' }),
    rv('CORE.HANDOFF.ALWAYS_HUMAN', { topics: ['quejas'] }, { status: 'seeded', origin: 'platform_seed' }),
]) {
    const prisma = {
        $queryRawUnsafe: jest.fn(async () => [{ ref: 'tenant', slug: 'spark-qa-dental-03', name: 'Spark QA Dental', created_at: null,
            settings: {}, operating_country: 'CO', operating_timezone: 'America/Bogota', schema_name: 'tenant_test' }]),
        executeInTenantSchema: jest.fn(async (_schema: string, sql: string, params: any[] = []) =>
            /FROM requirement_values/.test(sql) ? rows.filter(r => params[0].includes(r.requirement_id)) : []),
    };
    return new BusinessFactsReader(prisma as any);
}

function fixture(businessFacts: unknown = dentalReader()) {
    const f = agentTurnFixture({ businessFacts });
    f.prisma.tenant.findUnique.mockResolvedValue({ operatingCountry: 'CO', industry: 'health', settings: {} });
    return f;
}

describe('C14 · datos confirmados por el negocio en el turno sellado', () => {
    it('la foto sella el medio de pago confirmado (no lo sembrado) y el prompt lo pinta legible', async () => {
        const f = fixture();
        const snapshot = await f.service.captureSnapshot('tenant', AGENT);
        const sealed = snapshot.contextInputs?.confirmedFacts ?? [];
        expect(sealed.map((x: { id: string }) => x.id)).toEqual(['CORE.PAYMENT.METHODS', 'OBJ.APPOINTMENT.CUSTOMER_REQUIREMENTS']);
        expect(sealed[0]).toEqual({ id: 'CORE.PAYMENT.METHODS', title: 'Medios de pago aceptados', text: PAYMENT_TEXT });

        const response = await f.service.test('tenant', AGENT, { message: '¿Aceptan tarjeta?' }, { agentSnapshot: snapshot });
        expect(response.debug.runtimeError).toBeUndefined();
        expect(response.debug.turnContext.confirmedFacts).toEqual(sealed);
        const prompt = response.debug.systemPrompt as string;
        expect(prompt).toContain('<confirmed_business_facts note="Datos confirmados por el negocio');
        expect(prompt).toContain(`- Medios de pago aceptados: ${PAYMENT_TEXT}`);
        expect(prompt).toContain('número de documento');
        // opción B: lo sembrado no es un dato
        expect(prompt).not.toContain('Idiomas de atención');
        expect(prompt).not.toContain('quejas');
    });

    it('«¿Aceptan tarjeta?» respondido con los medios confirmados sale tal cual (el guardia F4300-58 no lo cambia por «no consta»)', async () => {
        const f = fixture();
        f.llmRouter.execute.mockResolvedValue({ content: REPLY, model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 });
        const snapshot = await f.service.captureSnapshot('tenant', AGENT);
        const response = await f.service.test('tenant', AGENT, { message: '¿Aceptan tarjeta?' }, { agentSnapshot: snapshot });
        expect(response.reply).toContain('aceptamos tarjeta débito');
        expect(response.reply).not.toContain('No consta en la información registrada qué medios de pago');
    });

    it('sin el medio de pago confirmado (solo sembrado) la misma respuesta sigue siendo «no consta»', async () => {
        const f = fixture(dentalReader([rv('CORE.PAYMENT.METHODS', PAYMENT, { status: 'seeded', origin: 'platform_seed' })]));
        f.llmRouter.execute.mockResolvedValue({ content: REPLY, model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 });
        const snapshot = await f.service.captureSnapshot('tenant', AGENT);
        expect(snapshot.contextInputs).not.toHaveProperty('confirmedFacts');
        const response = await f.service.test('tenant', AGENT, { message: '¿Aceptan tarjeta?' }, { agentSnapshot: snapshot });
        expect(response.debug.systemPrompt).not.toContain('<confirmed_business_facts');
        expect(response.reply).toContain('No consta en la información registrada qué medios de pago');
    });

    it('una foto sellada antes del cambio (sin confirmedFacts) sigue validando y corre sin el bloque ni lectura viva', async () => {
        const reader = dentalReader();
        const f = fixture(reader);
        const snapshot = await f.service.captureSnapshot('tenant', AGENT);
        delete (snapshot.contextInputs as any).confirmedFacts;
        sealEvaluationSnapshot(snapshot);
        expect(() => resolveEvaluationTurnContext(snapshot.contextInputs, 'tenant')).not.toThrow();
        const spy = jest.spyOn(reader, 'confirmedFacts');
        const response = await f.service.test('tenant', AGENT, { message: '¿Aceptan tarjeta?' }, { agentSnapshot: snapshot });
        expect(response.debug.runtimeError).toBeUndefined();
        expect(response.debug.systemPrompt).not.toContain('<confirmed_business_facts');
        expect(spy).not.toHaveBeenCalled();
    });

    it('la foto rechaza datos confirmados mal formados', async () => {
        const inputs = (await fixture().service.captureSnapshot('tenant', AGENT)).contextInputs!;
        expect(() => resolveEvaluationTurnContext({ ...inputs, confirmedFacts: 'x' as any }, 'tenant')).toThrow('agent_snapshot_context_inputs_required');
        expect(() => resolveEvaluationTurnContext({ ...inputs, confirmedFacts: [{ id: 'CORE.PAYMENT.METHODS', title: 'Medios' }] as any }, 'tenant'))
            .toThrow('agent_snapshot_context_inputs_required');
    });

    it('un fallo al leer los datos confirmados en la captura no se sella como ausencia', async () => {
        const reader = dentalReader();
        jest.spyOn(reader, 'confirmedFacts').mockRejectedValue(new Error('synthetic_confirmed_facts_failure'));
        await expect(fixture(reader).service.captureSnapshot('tenant', AGENT)).rejects.toThrow('synthetic_confirmed_facts_failure');
    });
});

describe('C14 · los datos confirmados respaldan la respuesta', () => {
    const facts = [{ id: 'CORE.PAYMENT.METHODS', title: 'Medios de pago aceptados', text: PAYMENT_TEXT }];

    it('guardia de medios de pago: respaldado con el dato confirmado, «no consta» sin él', () => {
        expect(unbackedPaymentCorrection(REPLY, '¿Aceptan tarjeta?', confirmedFactsAsReads(facts), 'es')).toBeNull();
        expect(unbackedPaymentCorrection(REPLY, '¿Aceptan tarjeta?', confirmedFactsAsReads([]), 'es'))
            .toContain('No consta en la información registrada qué medios de pago');
    });

    it('verificador de evidencia: el dato confirmado viaja en la evidencia, como la identidad del negocio', () => {
        const evidence = turnEvidence({ confirmedFacts: facts, business: { companyName: 'Spark QA Dental' } });
        expect(evidence[0]).toBe(`business_confirmed_facts: CORE.PAYMENT.METHODS (Medios de pago aceptados) = ${PAYMENT_TEXT}`);
        expect(turnEvidence({})).toEqual([]);
    });

    it('reglas de cambio confirmadas cuentan como fuente de la política de cancelación', () => {
        const prompt = new PromptAssemblerService({ buildSystemPrompt: () => '<persona>x</persona>' } as any).assemble({} as any, {
            language: 'es', timezone: 'America/Bogota', now: '2026-10-30T12:00:00.000Z', upcomingDays: [], businessHoursStatus: 'open',
            confirmedFacts: [{ id: 'OBJ.APPOINTMENT.CHANGE_RULES', title: 'Modificar y cancelar el objeto',
                text: 'cancelación por el agente: directo; condiciones: cancelar sin costo hasta 24 horas antes' }],
        } as any);
        expect(prompt).toContain('<confirmed_business_facts');
        expect(hasPolicyEvidence({ systemPrompt: prompt })).toBe(true);
        expect(hasPolicyEvidence({ systemPrompt: prompt.replace(/<confirmed_business_facts[\s\S]*?<\/confirmed_business_facts>/, '') })).toBe(false);
    });

    it('sin datos confirmados el prompt no cambia (sin bloque)', () => {
        const assembler = new PromptAssemblerService({ buildSystemPrompt: () => '<persona>x</persona>' } as any);
        const turn = { language: 'es', timezone: 'America/Bogota', now: '2026-10-30T12:00:00.000Z', upcomingDays: [], businessHoursStatus: 'open' } as any;
        expect(assembler.assemble({} as any, turn)).toBe(assembler.assemble({} as any, { ...turn, confirmedFacts: [] }));
        expect(assembler.assemble({} as any, turn)).not.toContain('confirmed_business_facts');
    });
});
