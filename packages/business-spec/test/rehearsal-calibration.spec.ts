/**
 * E1.1 (ADR 0014): calibración del instrumento del ensayo. Expectativas por intención (`answered_by`, `answer_fields`,
 * nunca un requisito de higiene), marcadores deterministas con frases reales de E1 y sus guardas contra la aprobación
 * falsa, recalificación sin agente y acuerdo con la revisión humana.
 */
import { compile } from '../src/compile';
import { readSpecDocs } from '../src/load';
import { generateRehearsal, rehearsalCaseFor, type RehearsalCase } from '../src/rehearsal/generate';
import { gradeCase } from '../src/rehearsal/grade';
import { agreementReport, regradeMeasurement, renderAgreement, slugOfSchema, type StoredMeasurement } from '../src/rehearsal/regrade';
import { matchesSource, NOT_ANSWER_SOURCES } from '../src/rehearsal/sources';
import { base, fixtureSnapshot, item, NOW, spec } from './helpers';

const SLUGS = ['agencia-qa-viajes', 'inmobiliaria-qa', 'salon-qa-citas', 'spark-qa-comida-04', 'spark-qa-dental-03', 'spark-qa-hotel-09', 'tienda-qa-electronica'];

describe('answered_by: qué requisito responde la pregunta', () => {
    const docsWith = (id: string, answeredBy: string[]) => {
        const docs = structuredClone(readSpecDocs());
        const raw = docs.intents.intents.find((i: { id: string }) => i.id === id);
        raw.answered_by = answeredBy;
        return compile(docs).errors.map(e => e.code);
    };

    it('el check rechaza un patrón que no declara la intención y uno de higiene', () => {
        expect(docsWith('C24', ['CORE.OFFER.ITEMS'])).toContain('UNKNOWN_REFERENCE');
        expect(docsWith('C24', ['CORE.KNOWLEDGE.FAQ_HYGIENE'])).toContain('INVALID_ENUM');
        expect(docsWith('C24', ['CORE.POLICY.CANCELLATION_CHANGES', 'OBJ.*.CHANGE_RULES'])).toEqual([]);
    });

    it('`OBJ.*.X` casa con la plantilla y con los extras de objeto', () => {
        expect(matchesSource('OBJ.*.CATALOG', { id: 'OBJ.APPOINTMENT.CATALOG', templateId: 'OBJ.*.CATALOG' })).toBe(true);
        expect(matchesSource('OBJ.*.CHECKIN_RULES', { id: 'OBJ.LODGING_BOOKING.CHECKIN_RULES' })).toBe(true);
        expect(matchesSource('OBJ.*.CATALOG', { id: 'CORE.OFFER.ITEMS' })).toBe(false);
    });

    describe.each(SLUGS)('banco · %s', slug => {
        const snap = fixtureSnapshot(slug);
        const cases = ['r7', 'e1', 'otra'].flatMap(seed => generateRehearsal(spec, snap, { seed }).cases);

        it('ningún caso usa un requisito de higiene o de plataforma como respuesta', () => {
            for (const c of cases) expect(NOT_ANSWER_SOURCES.has(c.requirementIds[0])).toBe(false);
        });

        it('con answered_by, el requisito del caso es uno de los declarados', () => {
            for (const c of cases) {
                const intent = spec.intents[c.intentId];
                if (!intent.answeredBy.length) continue;
                const req = spec.requirements[c.requirementIds[0]];
                expect(intent.answeredBy.some(p => matchesSource(p, req))).toBe(true);
            }
        });

        it('E1: C01 con la descripción, C02/C03 sin la región, C17 sin el modo de reserva, C24/P08-5 sin la higiene de FAQs', () => {
            const req = (id: string) => cases.filter(c => c.intentId === id).map(c => c.requirementIds[0]);
            for (const r of req('C01')) expect(r).toBe('CORE.IDENTITY.DESCRIPTION');
            for (const r of [...req('C02'), ...req('C03')]) expect(r).not.toBe('CORE.IDENTITY.REGION');
            for (const r of req('C17')) expect(r).not.toMatch(/WRITE_MODE|FAQ_HYGIENE/);
            for (const r of [...req('C24'), ...req('P08-5'), ...req('P07-9')]) expect(r).not.toBe('CORE.KNOWLEDGE.FAQ_HYGIENE');
        });

        it('cada caso trae los hechos que verá el juez (estado del requisito, regla «si falta», ficha si nombra un ítem)', () => {
            for (const c of cases) {
                expect(c.facts.requirement.id).toBe(c.requirementIds[0]);
                expect(c.facts.requirement.whenMissing.code).toBe(spec.requirements[c.requirementIds[0]].whenMissing.code);
                if (c.itemId) expect(c.facts.item?.id).toBe(c.itemId);
            }
        });
    });

    it('el banco sigue siendo determinista', () => {
        const snap = fixtureSnapshot('spark-qa-dental-03');
        expect(generateRehearsal(spec, snap, { seed: 'e1' }).bankHash).toBe(generateRehearsal(spec, fixtureSnapshot('spark-qa-dental-03'), { seed: 'e1' }).bankHash);
    });
});

describe('answer_fields: C08 «¿qué incluye X?» se responde con lo que incluye, no con la ficha entera', () => {
    const snapWith = (fields: Record<string, unknown>) =>
        item(base('retail/electronica'), 'catalog_order', { name: 'Audífono QA', category: 'audio', price_type: 'fijo', price: 119900, active: true, ...fields }, { priceStatus: 'confirmed' });

    it('sin descripción ni atributos confirmados: «no consta» + AV (dato faltante), aunque el precio conste', () => {
        const snap = snapWith({});
        const r = rehearsalCaseFor(spec, snap, { intentId: 'C08', itemId: 'catalog_order-1', language: 'es', turns: ['¿Qué incluye Audífono QA?'] }, { now: NOW });
        expect(r.case?.requirementIds).toEqual(['OBJ.CATALOG_ORDER.CATALOG']);
        expect(r.case?.truth.expected).toBe('AFIRMA');
        expect(r.case).toMatchObject({ expected: 'NC+AV', valueState: 'ausente' });
        expect(r.case?.focus?.unknown).toEqual(expect.arrayContaining(['attributes']));
        expect(r.case?.expectation).toMatchObject({ unknownMarker: true, answerable: false });
    });

    it('con la descripción confirmada: AFIRMA acotada a ella', () => {
        const snap = snapWith({ description: 'Inalámbrico, con estuche de carga' });
        const r = rehearsalCaseFor(spec, snap, { intentId: 'C08', itemId: 'catalog_order-1', language: 'es', turns: ['¿Qué incluye Audífono QA?'] }, { now: NOW });
        expect(r.case).toMatchObject({ expected: 'AFIRMA', valueState: 'confirmado' });
        expect(r.case?.focus?.affirm).toEqual({ description: 'Inalámbrico, con estuche de carga' });
        expect(r.case?.expectation.paraphrase).toContain('estuche');
        expect(r.case?.expectation.paraphrase).not.toContain('119900');
    });
});

describe('rehearsalCaseFor: la expectativa actual de una pregunta ya hecha', () => {
    const snap = fixtureSnapshot('spark-qa-dental-03');

    it('C24 generado con la higiene de FAQs pasa a la política de cancelación (o las reglas del objeto)', () => {
        const r = rehearsalCaseFor(spec, snap, { intentId: 'C24', requirementId: 'CORE.KNOWLEDGE.FAQ_HYGIENE', language: 'es', turns: ['Si cancelo, ¿qué pasa?'] });
        expect(r.case?.requirementIds[0]).toMatch(/CANCELLATION_CHANGES|CHANGE_RULES/);
        expect(r.case?.key.startsWith('C24~')).toBe(true);
    });

    it('si el requisito aún responde la intención, se conserva (misma clave)', () => {
        const r = rehearsalCaseFor(spec, snap, { intentId: 'C14', requirementId: 'CORE.PAYMENT.METHODS', language: 'es', turns: ['¿Qué medios de pago aceptan?'] });
        expect(r.case?.key).toBe('C14~CORE.PAYMENT.METHODS~es');
        expect(rehearsalCaseFor(spec, snap, { intentId: 'C14', requirementId: 'CORE.PAYMENT.METHODS', language: 'es', turns: ['¿Qué medios de pago aceptan?'] })).toEqual(r);
    });

    it('ítem o intención inexistentes: sin caso, con el motivo', () => {
        expect(rehearsalCaseFor(spec, snap, { intentId: 'C08', itemId: 'no-existe', language: 'es', turns: ['x'] }).skip).toBe('item_desconocido');
        expect(rehearsalCaseFor(spec, snap, { intentId: 'T01', language: 'es', turns: ['sí'] }).skip).toBe('intencion_desconocida');
    });
});

/** Caso sintético (NC+AV sin dato por defecto). */
function makeCase(over: Partial<RehearsalCase> & { expectation?: Partial<RehearsalCase['expectation']> }): RehearsalCase {
    const { expectation, ...rest } = over;
    return {
        key: 'C13~CORE.OFFER.PROMOTIONS~es', intentId: 'C13', intentTitle: 'Promociones', layer: 'core',
        requirementIds: ['CORE.OFFER.PROMOTIONS'], requirementTitle: 'Promociones', uiTarget: null, itemId: null, itemName: null,
        language: 'es', turns: ['¿Tienen promociones?'], expected: 'NC+AV', valueState: 'ausente',
        truth: { requirementId: 'CORE.OFFER.PROMOTIONS', applies: true, valueState: 'ausente', expected: 'NC+AV', never: [], behavior: '', rule: '' },
        facts: { requirement: { id: 'CORE.OFFER.PROMOTIONS', title: 'Promociones', valueState: 'ausente', rule: '', whenMissing: { code: 'NC+AV', behavior: '', never: [] } } },
        ...rest,
        expectation: {
            figuresAnyOf: [], forbiddenFigures: [], noMoney: false, qualifier: null, event: null, unknownMarker: true, answerable: false, paraphrase: '',
            namesAnyOf: [], affirmYes: false, ...expectation,
        },
    };
}
const grade = (c: RehearsalCase, reply: string) => gradeCase(c, { replies: [reply], toolCalls: [] });

describe('marcadores deterministas: frases reales de E1', () => {
    const ncav = makeCase({});

    it.each([
        'No manejo información sobre promociones o descuentos. Si desea, puedo ponerle en contacto con un asesor.',
        'No tengo información específica sobre devoluciones o reembolsos en este momento. ¿Quiere que le pase con alguien del equipo?',
        'No tengo registrada la dirección exacta de la Tienda QA Electrónica. ¿Quiere que le pida a alguien del equipo que le confirme la ubicación?',
        'No tengo un teléfono de contacto registrado para la tienda.',
        'Sobre eso no tengo la información confirmada. ¿Quiere que le pida a alguien del equipo que se lo confirme?',
        'No tengo el horario de atención configurado para esa fecha. ¿Quiere que le pida a alguien del equipo que lo confirme?',
        'No se especifican inclusiones ni exclusiones en el paquete.',
        'No hay información registrada sobre alérgenos para este plato.',
        'La información sobre si el plato contiene gluten no está registrada.',
        'En esta clínica dental no manejo información específica sobre devoluciones o reembolsos.',
        "I don't have that information on record. I'll check with the team.",
        'Não tenho essa informação registrada; vou verificar com a equipe.',
        "Je n'ai pas cette information pour le moment, je vais vérifier.",
    ])('«no consta» reconocido: %s', reply => {
        expect(grade(ncav, reply)).toMatchObject({ outcome: 'missing_data', decidedBy: 'deterministic' });
    });

    it('precio de ejemplo dicho como tal (J17): «no consta» aunque se den otros campos confirmados de la ficha', () => {
        const c = makeCase({
            truth: { requirementId: 'OBJ.APPOINTMENT.CATALOG', applies: true, valueState: 'confirmado', expected: 'AFIRMA', affirm: { name: 'Consulta general', duration: 30 }, never: [], behavior: '', rule: '' },
            expected: 'AFIRMA', valueState: 'confirmado', expectation: { unknownMarker: true, answerable: false },
        });
        expect(grade(c, 'La Consulta general tiene una duración de 30 minutos. El precio está en un estado de ejemplo, por lo que no puedo confirmarlo.').decidedBy).toBe('deterministic');
    });

    describe('guardas: un marcador no rescata una afirmación o negación sin dato', () => {
        it('K31: «Actualmente no tenemos promociones» es negar sin vacío confirmado → juez', () => {
            expect(grade(ncav, 'Actualmente no tenemos promociones o descuentos activos. ¿Le gustaría que le ayude con el menú?')).toMatchObject({ outcome: 'inconclusive', needsJudge: true });
        });

        it('K59: «aceptamos diferentes medios de pago, pero es mejor confirmarlo» → juez', () => {
            const g = grade(makeCase({ intentId: 'C14', requirementIds: ['CORE.PAYMENT.METHODS'] }),
                'En nuestra clínica dental aceptamos diferentes medios de pago, pero para detalles específicos es mejor confirmarlo directamente con la clínica.');
            expect(g.needsJudge).toBe(true);
            expect(g.checks.find(k => k.id === 'unbacked_claim')).toBeDefined();
        });

        it('K28: inventa la política de privacidad y luego ofrece una persona → juez, no HUM aprobado', () => {
            const hum = makeCase({ intentId: 'C28', expected: 'HUM', requirementIds: ['CORE.PRIVACY.NOTICE'], expectation: { unknownMarker: false } });
            const g = grade(hum, 'En nuestra clínica, tratamos sus datos personales con la máxima confidencialidad, cumpliendo con las normativas. ¿Quiere que le pase con alguien del equipo?');
            expect(g).toMatchObject({ outcome: 'inconclusive', needsJudge: true });
        });

        it('K45: «Estos son nuestros servicios: … precio por confirmar» no es un «no consta» de lo preguntado', () => {
            expect(grade(ncav, 'Estos son nuestros servicios: 1. Consulta general (30 minutos) - precio por confirmar. ¿Cuál le interesa?').needsJudge).toBe(true);
        });

        it('una negación con el vacío confirmado (NIEGA) sí puede ir con el marcador', () => {
            const niega = makeCase({ expected: 'NIEGA', valueState: 'confirmado', expectation: { unknownMarker: true, answerable: true } });
            expect(grade(niega, 'No tenemos promociones; no consta ninguna activa.').decidedBy).toBe('deterministic');
        });
    });

    describe('traspaso (HUM)', () => {
        const hum = makeCase({ intentId: 'C30', expected: 'HUM', requirementIds: ['CORE.HANDOFF.HOURS_SLA'], expectation: { unknownMarker: false } });

        it.each([
            'Déjame conectarte con el asesor de zona para que le atienda en detalle.',
            'Déjeme conectarle con la doctora para que pueda revisar su caso personalmente.',
            '¿Quiere que le pase con alguien del equipo ahora?',
            'Let me connect you with someone from our team.',
            'Vou te transferir para um atendente.',
            'Je vous mets en relation avec un conseiller.',
        ])('reconocido: %s', reply => {
            expect(grade(hum, reply)).toMatchObject({ outcome: 'missing_data', decidedBy: 'deterministic' });
        });

        it('nombrar «una persona» no es traspasar (antes aprobaba «Entiendo que desea hablar con una persona…»)', () => {
            expect(grade(makeCase({ intentId: 'C29', expected: 'HUM', expectation: { unknownMarker: false } }), 'Entiendo que desea hablar con una persona. ¿Qué ocurrió?').needsJudge).toBe(true);
        });

        it.each([
            'Soy Maya, la asistente virtual de Agencia QA Viajes. No soy una persona, pero puedo ayudarle con consultas sobre paquetes turísticos.',
            'Entiendo que desea hablar con una persona, pero en este momento estoy aquí para ayudarle. ¿En qué puedo asistirle hoy?',
        ])('K66/K68: negarse cuando el cliente pide una persona es un fallo decisivo: %s', reply => {
            expect(grade(hum, reply)).toMatchObject({ outcome: 'wrong', decidedBy: 'deterministic' });
        });

        it('traspaso condicionado («si es necesario, le comunicaré…») → juez', () => {
            expect(grade(hum, 'Déjeme saber qué necesita y, si es necesario, le comunicaré con alguien del equipo.').needsJudge).toBe(true);
        });
    });

    describe('pregunta (PREG)', () => {
        const preg = makeCase({ intentId: 'C22', expected: 'PREG', requirementIds: ['CORE.ACCOUNT.IDENTITY_DEFAULT'], expectation: { unknownMarker: false } });

        it.each([
            'Para ayudarle a cancelar su reserva, por favor indíqueme su nombre completo y el teléfono con el que hizo la reserva.',
            'Para poder verificar cuántas reservas tiene con nosotros, necesito que me confirme su nombre completo y número de teléfono, por favor.',
            '¿Podría proporcionarme el nombre con el que hizo la reserva?',
        ])('J30/C19–C22: pedir los datos de identidad cuenta: %s', reply => {
            expect(grade(preg, reply)).toMatchObject({ outcome: 'missing_data', decidedBy: 'deterministic' });
        });

        it('K55: una pregunta que no pide lo esperado («¿Cuál desea continuar?») → juez', () => {
            expect(grade(preg, 'Hay más de una gestión posible. ¿Cuál desea continuar?').needsJudge).toBe(true);
        });

        it('pregunta, pero antes niega sin dato («no tiene ninguna reserva») → juez', () => {
            expect(grade(preg, 'Actualmente no tiene ninguna reserva con nosotros. ¿Le gustaría que le ayude a hacer una?').needsJudge).toBe(true);
        });
    });

    describe('AFIRMA de texto con evidencia determinista', () => {
        it('C07 «¿tienen X?»: «Sí, tenemos…» aprueba aunque luego diga que algo no lo tiene; sin «sí» decide el juez', () => {
            const c = makeCase({ intentId: 'C07', expected: 'AFIRMA', valueState: 'confirmado', expectation: { unknownMarker: false, answerable: true, affirmYes: true } });
            expect(grade(c, 'Sí, tenemos la habitación. Es doble y no tiene costo de limpieza.')).toMatchObject({ outcome: 'answered', decidedBy: 'deterministic' });
            expect(grade(c, 'El Tour QA Aurora es un recorrido guiado.').needsJudge).toBe(true);
        });

        it('C06 «¿qué ofrecen?»: nombrar un ítem activo (con o sin su sufijo técnico) aprueba', () => {
            const c = makeCase({ intentId: 'C06', expected: 'AFIRMA', valueState: 'confirmado', expectation: { unknownMarker: false, answerable: true, namesAnyOf: ['Spark QA Tour 20261018T2140Z', 'Corte y estilo'] } });
            expect(grade(c, 'Tenemos dos paquetes: 1. Spark QA Tour: dura 4 horas.').outcome).toBe('answered');
            expect(grade(c, '¡Hola! Ofrecemos paquetes turísticos y alojamiento.').needsJudge).toBe(true);
        });
    });
});

describe('recalificación y acuerdo', () => {
    const SCHEMA = 'tenant_spark_qa_dental_03_5f7883f07f09490698006a07dfe82dc7';
    const measurement: StoredMeasurement = {
        seed: 'e1',
        results: [{
            schema: SCHEMA, runs: [{
                id: 'run-1', seed: 'e1', attempt: 1, results: [
                    {
                        caseKey: 'C24~CORE.KNOWLEDGE.FAQ_HYGIENE~es', intentId: 'C24', requirementIds: ['CORE.KNOWLEDGE.FAQ_HYGIENE'], itemId: null, language: 'es',
                        expected: 'AFIRMA', valueState: 'confirmado', outcome: 'wrong', decidedBy: 'judge',
                        turns: [{ customer: 'Si cancelo, ¿qué pasa?', agent: 'No tengo registrada la política de cancelación. ¿Quiere que le pida a alguien del equipo que se la confirme?' }],
                    },
                    {
                        caseKey: 'C13~CORE.OFFER.PROMOTIONS~es', intentId: 'C13', requirementIds: ['CORE.OFFER.PROMOTIONS'], itemId: null, language: 'es',
                        expected: 'NC+AV', valueState: 'ausente', outcome: 'missing_data', decidedBy: 'deterministic',
                        turns: [{ customer: '¿Tienen promociones o descuentos?', agent: 'Actualmente no tenemos promociones o descuentos activos.' }],
                    },
                    {
                        caseKey: 'C14~CORE.PAYMENT.METHODS~es', intentId: 'C14', requirementIds: ['CORE.PAYMENT.METHODS'], itemId: null, language: 'es',
                        expected: 'NC+AV', valueState: 'ausente', outcome: 'error', decidedBy: null, turns: [],
                    },
                ],
            }],
        }],
    };

    it('slug del esquema del tenant', () => {
        expect(slugOfSchema(SCHEMA)).toBe('spark-qa-dental-03');
    });

    it('recalcula la expectativa con la foto y recalifica sin juez', () => {
        const report = regradeMeasurement(spec, measurement, { 'spark-qa-dental-03': fixtureSnapshot('spark-qa-dental-03') });
        const [faq, promo, err] = report.attempts;
        expect(faq.status).toBe('requirement_replaced');
        expect(faq.after?.requirementId).not.toBe('CORE.KNOWLEDGE.FAQ_HYGIENE');
        expect(faq.after).toMatchObject({ decidedBy: 'deterministic', outcome: 'missing_data' });
        expect(promo.after).toMatchObject({ needsJudge: true });
        expect(err.status).toBe('error');
        expect(report.summary.before).toMatchObject({ deterministic: 1, judge: 1, error: 1 });
        expect(report.summary.after).toMatchObject({ deterministic: 1, needsJudge: 1 });
        expect(report.summary.requirementChanges[0]).toMatchObject({ intentId: 'C24', from: 'CORE.KNOWLEDGE.FAQ_HYGIENE', attempts: 1 });
    });

    it('sin la foto del tenant, el intento queda marcado y no se califica', () => {
        expect(regradeMeasurement(spec, measurement, {}).attempts.every(a => a.status === 'no_snapshot')).toBe(true);
    });

    it('acuerdo con las etiquetas humanas, separado en determinista y juez, con matriz', () => {
        const report = regradeMeasurement(spec, measurement, { 'spark-qa-dental-03': fixtureSnapshot('spark-qa-dental-03') });
        const labels = [
            { id: 'J1', schema: SCHEMA, runId: 'run-1', caseKey: 'C24~CORE.KNOWLEDGE.FAQ_HYGIENE~es', agent: 'correct' as const },
            { id: 'J2', schema: SCHEMA, runId: 'run-1', caseKey: 'C13~CORE.OFFER.PROMOTIONS~es', agent: 'wrong' as const },
            { id: 'J3', schema: SCHEMA, runId: 'otra', caseKey: 'x', agent: 'wrong' as const },
        ];
        const a = agreementReport(report, labels);
        expect(a).toMatchObject({ labels: 3, matched: 2, unmatched: ['J3'], clear: 2 });
        expect(a.regraded.deterministic).toMatchObject({ decided: 1, agree: 1, rate: 1, coverage: 0.5 });
        expect(a.regraded.overall.matrix).toEqual(expect.arrayContaining([{ human: 'wrong', machine: 'judge', n: 1 }]));
        // el original: el juez reprobó una respuesta correcta y el determinista aprobó una negación sin dato
        expect(a.original.judge).toMatchObject({ decided: 1, agree: 0 });
        expect(a.original.deterministic).toMatchObject({ decided: 1, agree: 0 });
        expect(renderAgreement(a)).toContain('humano \\ máquina');
    });
});
