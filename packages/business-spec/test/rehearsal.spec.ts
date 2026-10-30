/** Ensayo antes de salir (C0 §1.4, rebanada R7, ADR 0013): generador determinista y calificador. */
import { qaTruth } from '../src/qa/truth';
import { figuresOfText, figuresOfValue, hasMoneyFigure } from '../src/rehearsal/figures';
import { generateRehearsal, REHEARSAL_MAX_CASES, servedLanguages, type RehearsalCase } from '../src/rehearsal/generate';
import { gradeCase, passHatK, PENDING_TOOL, summarize } from '../src/rehearsal/grade';
import { admin, fixtureSnapshot, spec, val } from './helpers';

/** Los 7 tenants QA y su perfil efectivo. */
const FIXTURES: Record<string, string> = {
    'agencia-qa-viajes': 'P06',
    'inmobiliaria-qa': 'P07',
    'salon-qa-citas': 'P11',
    'spark-qa-comida-04': 'P02',
    'spark-qa-dental-03': 'P08',
    'spark-qa-hotel-09': 'P05',
    'tienda-qa-electronica': 'P03',
};

describe('intents.yaml: frases del ensayo (R7)', () => {
    it('toda intención no conversacional del núcleo y de los perfiles tiene al menos una frase en español', () => {
        const missing = Object.values(spec.intents).filter(i => !i.conversational && !i.phrases.es?.length).map(i => i.id);
        expect(missing).toEqual([]);
    });

    it('el núcleo tiene frases en los cuatro idiomas; la demanda de B1 §D pesa en las intenciones núcleo', () => {
        const core = Object.values(spec.intents).filter(i => i.layer === 'core' && !i.conversational);
        for (const i of core) expect(Object.keys(i.phrases).sort()).toEqual(['en', 'es', 'fr', 'pt']);
        expect(spec.intents.C09.demand).toBeGreaterThan(spec.intents.C33.demand);
        // T01 es el segundo turno de «lo averiguo»
        expect(spec.intents.T01.phrases.es?.length).toBeGreaterThan(0);
    });
});

describe.each(Object.entries(FIXTURES))('generateRehearsal · %s', (slug, profile) => {
    const snap = fixtureSnapshot(slug);
    const bank = generateRehearsal(spec, snap, { seed: 'r7' });

    it('es determinista: misma semilla → mismo banco; otra semilla → otro banco', () => {
        const again = generateRehearsal(spec, fixtureSnapshot(slug), { seed: 'r7' });
        expect(again).toEqual(bank);
        expect(again.bankHash).toBe(bank.bankHash);
        expect(generateRehearsal(spec, snap, { seed: 'otra' }).bankHash).not.toBe(bank.bankHash);
    });

    it(`cubre el perfil efectivo ${profile} dentro del tope`, () => {
        expect(bank.coverage.profile).toBe(profile);
        expect(bank.cases.length).toBeGreaterThan(0);
        expect(bank.cases.length).toBeLessThanOrEqual(REHEARSAL_MAX_CASES);
        expect(new Set(bank.cases.map(c => c.key)).size).toBe(bank.cases.length);
        // solo intenciones del núcleo o de su perfil, nunca conversacionales ni de cuenta
        for (const c of bank.cases) expect(['core', `profile:${profile}`]).toContain(c.layer);
        expect(bank.cases.some(c => c.layer === `profile:${profile}`)).toBe(true);
        // la mayor parte de las intenciones aplicables queda cubierta con 40 casos
        expect(bank.coverage.intentsCovered.length / bank.coverage.intentsApplicable.length).toBeGreaterThanOrEqual(0.8);
        const reasons = new Set(bank.coverage.skipped.map(s => s.reason));
        for (const r of reasons) expect(['sin_requisito', 'sin_frases', 'cuenta', 'no_aplica', 'requiere_item', 'tope']).toContain(r);
    });

    it('ningún caso tiene la respuesta esperada adivinada: todos llevan requisito y estado, y su verdad es la de qaTruth', () => {
        for (const c of bank.cases) {
            expect(c.requirementIds.length).toBeGreaterThan(0);
            expect(c.valueState).not.toBeNull();
            expect(['N/A', 'CUENTA', 'CONVERSACIONAL']).not.toContain(c.expected);
            const truth = qaTruth(spec, snap, { requirementId: c.requirementIds[0], intent: c.intentId, ...(c.itemId ? { itemId: c.itemId } : {}) });
            expect(c.truth).toEqual(truth.cases[0]);
            expect(c.expected).toBe(truth.expected);
            expect(c.turns[0]).not.toMatch(/\{item\}/);
            if (c.itemName) expect(c.turns[0]).toContain(c.itemName);
        }
    });

    it('las cifras prohibidas nunca coinciden con las exigidas', () => {
        for (const c of bank.cases) {
            for (const f of c.expectation.forbiddenFigures) expect(c.expectation.figuresAnyOf).not.toContain(f);
        }
    });
});

describe('generateRehearsal: opciones', () => {
    it('respeta el tope pedido y nunca pasa de 40', () => {
        const snap = fixtureSnapshot('spark-qa-dental-03');
        expect(generateRehearsal(spec, snap, { maxCases: 5 }).cases).toHaveLength(5);
        expect(generateRehearsal(spec, snap, { maxCases: 400 }).cases.length).toBeLessThanOrEqual(REHEARSAL_MAX_CASES);
    });

    it('idiomas: los atendidos del tenant por defecto; los pedidos si se indican', () => {
        const snap = fixtureSnapshot('tienda-qa-electronica');
        expect(servedLanguages(snap, new Date(snap.capturedAt))).toEqual(['es']);
        const bank = generateRehearsal(spec, snap, { languages: ['en', 'pt'] });
        expect(new Set(bank.cases.map(c => c.language))).toEqual(new Set(['en', 'pt']));
        expect(bank.coverage.languages).toEqual(['en', 'pt']);
    });

    it('con «lo averiguo» ofrecido (CORE.PENDING.ROUTING cumple), un NC+AV tiene el «sí» como segundo turno y espera la herramienta', () => {
        const snap = fixtureSnapshot('spark-qa-dental-03');
        admin(snap);
        val(snap, 'CORE.PENDING.ROUTING', { channel: ['panel'], sla: { min: 4, unit: 'h' } });
        snap.platform.followUpRegistry = true;
        const bank = generateRehearsal(spec, snap, { seed: 'r7' });
        const ncav = bank.cases.filter(c => c.expected === 'NC+AV');
        expect(ncav.length).toBeGreaterThan(0);
        for (const c of ncav) {
            expect(c.turns).toHaveLength(2);
            expect(spec.intents.T01.phrases.es).toContain(c.turns[1]);
            expect(c.expectation.event).toEqual({ turn: 2, kind: 'pending_question' });
        }
        for (const c of bank.cases.filter(x => x.expected !== 'NC+AV')) expect(c.turns).toHaveLength(1);
        // sin la oferta, un solo turno
        expect(generateRehearsal(spec, fixtureSnapshot('spark-qa-dental-03'), { seed: 'r7' }).cases.every(c => c.turns.length === 1)).toBe(true);
    });

    it('precio de ejemplo: la pregunta de precio no exige cifras y prohíbe el precio de ejemplo', () => {
        const snap = fixtureSnapshot('spark-qa-dental-03');
        const seeded = snap.items.appointment.find(i => i.priceStatus === 'example' || i.contentStatus !== 'confirmed') ?? snap.items.appointment[0];
        const bank = generateRehearsal(spec, snap, { seed: 'r7' });
        const priceCase = bank.cases.find(c => c.intentId === 'C09' && c.itemId === seeded.id);
        if (priceCase && priceCase.truth.fields?.price === 'ejemplo') {
            expect(priceCase.expectation.figuresAnyOf).toEqual([]);
            expect(priceCase.expectation.forbiddenFigures).toEqual(figuresOfValue(seeded.fields.price));
            expect(priceCase.expectation.unknownMarker).toBe(true);
            expect(priceCase.expectation.answerable).toBe(false);
        }
    });
});

describe('cifras normalizadas', () => {
    it('montos, miles, multiplicadores, horas y teléfonos', () => {
        expect(figuresOfText('Cuesta $45.000 COP')).toContain('n:45000');
        expect(figuresOfText('cuesta 45 mil pesos')).toContain('n:45000');
        expect(figuresOfText('it is 45k')).toContain('n:45000');
        expect(figuresOfText('abrimos a las 9 am y cerramos 7:30 pm')).toEqual(expect.arrayContaining(['t:9:00', 't:19:30']));
        expect(figuresOfText('de 09:00 a 18h')).toEqual(expect.arrayContaining(['t:9:00', 't:18:00']));
        expect(figuresOfText('llámanos al +57 300 123 4567')).toContain('tel:1234567');
        expect(figuresOfValue({ price: 45000, duration: 'PT45M', id: 'x-1' })).toEqual(['n:45000', 'n:45']);
        expect(figuresOfValue({ departures: ['2026-10-21T15:00:00Z'] })).toEqual([]);
        expect(hasMoneyFigure('Te lo cotizamos con gusto')).toBe(false);
        expect(hasMoneyFigure('alrededor de $120.000')).toBe(true);
    });
});

/** Un caso sintético con la expectativa indicada (lo demás, de un NC+AV típico). */
function makeCase(over: Partial<RehearsalCase> & { expectation?: Partial<RehearsalCase['expectation']> }): RehearsalCase {
    const { expectation, ...rest } = over;
    return {
        key: 'C14~CORE.PAYMENT.METHODS~es', intentId: 'C14', intentTitle: 'Medios de pago', layer: 'core',
        requirementIds: ['CORE.PAYMENT.METHODS'], requirementTitle: 'Medios de pago', uiTarget: null, itemId: null, itemName: null,
        language: 'es', turns: ['¿Aceptan tarjeta?'], expected: 'NC+AV', valueState: 'ausente',
        truth: { requirementId: 'CORE.PAYMENT.METHODS', applies: true, valueState: 'ausente', expected: 'NC+AV', never: [], behavior: 'NC+AV', rule: '' },
        ...rest,
        expectation: { figuresAnyOf: [], forbiddenFigures: [], noMoney: false, qualifier: null, event: null, unknownMarker: true, answerable: false, paraphrase: '', ...expectation },
    };
}

describe('gradeCase', () => {
    it('AFIRMA con la cifra del dato → responde bien (determinista, sin juez)', () => {
        const c = makeCase({ expected: 'AFIRMA', valueState: 'confirmado', expectation: { figuresAnyOf: ['n:45000'], unknownMarker: false, answerable: true } });
        const g = gradeCase(c, { replies: ['La consulta cuesta $45.000.'], toolCalls: [] });
        expect(g).toMatchObject({ outcome: 'answered', missClass: null, decidedBy: 'deterministic', needsJudge: false });
    });

    it('AFIRMA sin la cifra → respondió mal (producto); el juez no lo salva', () => {
        const c = makeCase({ expected: 'AFIRMA', valueState: 'confirmado', expectation: { figuresAnyOf: ['n:45000'], unknownMarker: false, answerable: true } });
        const g = gradeCase(c, { replies: ['No tengo ese dato, lo averiguo.'], toolCalls: [] }, { pass: true, reason: 'parece bien' });
        expect(g).toMatchObject({ outcome: 'wrong', missClass: 'producto', decidedBy: 'deterministic' });
        expect(g.checks.find(k => k.id === 'judge')?.detail).toMatch(/no decide/);
    });

    it('una cifra prohibida (precio de ejemplo) es un fallo de producto aunque diga «no consta»', () => {
        const c = makeCase({ expectation: { forbiddenFigures: ['n:120000'] } });
        const g = gradeCase(c, { replies: ['No consta el precio, pero suele ser 120.000'], toolCalls: [] });
        expect(g).toMatchObject({ outcome: 'wrong', missClass: 'producto' });
    });

    it('NC+AV dicho → «no lo sabe porque falta X» (clase dato, con el requisito)', () => {
        const g = gradeCase(makeCase({}), { replies: ['No tengo confirmados los medios de pago; si quieres lo averiguo.'], toolCalls: [] });
        expect(g).toMatchObject({ outcome: 'missing_data', missClass: 'dato', decidedBy: 'deterministic' });
        expect(g.reason).toContain('CORE.PAYMENT.METHODS');
    });

    it('sin evidencia determinista: inconcluso sin juez; con juez, decide y queda marcado', () => {
        const c = makeCase({});
        const obs = { replies: ['Aquí estamos para ayudarte con tu compra.'], toolCalls: [] };
        expect(gradeCase(c, obs)).toMatchObject({ outcome: 'inconclusive', needsJudge: true });
        expect(gradeCase(c, obs, { pass: false, reason: 'no dijo que no consta' })).toMatchObject({ outcome: 'wrong', missClass: 'producto', decidedBy: 'judge' });
        expect(gradeCase(c, obs, { pass: true, reason: 'lo dijo con otras palabras' })).toMatchObject({ outcome: 'missing_data', decidedBy: 'judge' });
    });

    it('COTIZA: cualquier cifra de dinero es un fallo', () => {
        const c = makeCase({ expected: 'COTIZA', valueState: 'confirmado', expectation: { noMoney: true, unknownMarker: false, answerable: true } });
        expect(gradeCase(c, { replies: ['Rondaría los $300.000'], toolCalls: [] }).outcome).toBe('wrong');
    });

    it('«desde»: la cifra sin el calificador es un fallo', () => {
        const c = makeCase({ expected: 'AFIRMA', valueState: 'confirmado', expectation: { figuresAnyOf: ['n:80000'], qualifier: 'desde', unknownMarker: false, answerable: true } });
        expect(gradeCase(c, { replies: ['Cuesta 80.000'], toolCalls: [] }).outcome).toBe('wrong');
        expect(gradeCase(c, { replies: ['Desde 80.000'], toolCalls: [] }).outcome).toBe('answered');
    });

    it('«lo averiguo»: tras el «sí» debe llamarse la herramienta en el segundo turno', () => {
        const c = makeCase({ turns: ['¿Aceptan tarjeta?', 'Sí, por favor'], expectation: { event: { turn: 2, kind: 'pending_question' } } });
        const replies = ['No lo tengo confirmado, ¿quieres que lo averigüe?', 'Listo, quedó registrado.'];
        expect(gradeCase(c, { replies, toolCalls: [] })).toMatchObject({ outcome: 'wrong', missClass: 'producto' });
        expect(gradeCase(c, { replies, toolCalls: [{ turn: 2, name: PENDING_TOOL }] })).toMatchObject({ outcome: 'missing_data', missClass: 'dato' });
    });

    it('HUM: el traspaso dicho o pedido por una herramienta cuenta como evidencia', () => {
        const c = makeCase({ expected: 'HUM', expectation: { unknownMarker: false } });
        expect(gradeCase(c, { replies: ['Te comunico con una persona del equipo.'], toolCalls: [] }).outcome).toBe('missing_data');
        expect(gradeCase(c, { replies: ['Un momento.'], toolCalls: [{ turn: 1, name: 'x', result: { shouldHandoff: true } }] }).outcome).toBe('missing_data');
    });

    it('un error del turno no se califica', () => {
        expect(gradeCase(makeCase({}), { replies: [], toolCalls: [], error: 'ai_message_quota_exceeded' }).outcome).toBe('error');
    });
});

describe('resumen y pass^k', () => {
    it('la tasa de aciertos cuenta lo que siguió la especificación; inconclusos y errores quedan fuera', () => {
        const s = summarize([{ outcome: 'answered' }, { outcome: 'missing_data' }, { outcome: 'wrong' }, { outcome: 'inconclusive' }, { outcome: 'error' }]);
        expect(s).toMatchObject({ total: 5, answered: 1, missingData: 1, wrong: 1, inconclusive: 1, errors: 1, passRate: 0.6667, answeredRate: 0.3333 });
        expect(summarize([]).passRate).toBeNull();
    });

    it('pass^k: pasa solo el caso que acierta en sus k intentos', () => {
        const attempts = [
            { caseKey: 'a', outcome: 'answered' as const }, { caseKey: 'a', outcome: 'answered' as const }, { caseKey: 'a', outcome: 'missing_data' as const },
            { caseKey: 'b', outcome: 'answered' as const }, { caseKey: 'b', outcome: 'wrong' as const }, { caseKey: 'b', outcome: 'answered' as const },
            { caseKey: 'c', outcome: 'answered' as const }, { caseKey: 'c', outcome: 'error' as const },
        ];
        expect(passHatK(attempts, 3)).toEqual({ k: 3, cases: 2, passAll: 1, rate: 0.5 });
        expect(passHatK(attempts, 1)).toEqual({ k: 1, cases: 3, passAll: 3, rate: 1 });
    });
});
