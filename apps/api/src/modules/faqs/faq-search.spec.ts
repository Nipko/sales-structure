import type { FAQ } from '@parallext/shared';
import { faqSearchTerms, lastInterrogativePhrase, rankPartialFaqMatches, stripFaqQueryNoise } from './faq-search';
import { FaqsService } from './faqs.service';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { sealStructuredKnowledgeCapture } from '../evaluation-revision/evaluation-structured-knowledge';

const faq = (id: string, question: string, answer: string) => ({ id, question, answer, isPublished: true } as FAQ);
const faro = faq('faro', '¿Qué incluye la demostración Faro Azul?',
    'Faro Azul es una demostración de Parallly para una inmobiliaria de prueba en Bogotá. Incluye consultas simuladas sobre compra y arriendo y una visita virtual de prueba de 20 minutos. No hay inmuebles reales disponibles, no se cobra dinero y no se solicitan documentos personales. Si deseas ayuda, el correo de prueba es contacto@example.test.');
const visitSeed = faq('seed', '¿Cómo agendo una visita a la propiedad?', 'Te muestro propiedades disponibles según tu interés y agendamos visita con el asesor.');
const financeSeed = faq('finance', '¿Ofrecen financiación?', 'La financiación depende de la propiedad y de tu perfil.');

describe('FAQ search with added question details', () => {
    it('retrieves the named demonstration and excludes loosely related real-estate seeds', () => {
        const query = 'Que incluye la demostración Faro Azul y cuánto dura la visita?';
        expect(rankPartialFaqMatches([visitSeed, financeSeed, faro], query, 3)).toEqual([faro]);
    });

    it('does not answer a different named topic from one shared word', () => {
        expect(rankPartialFaqMatches([visitSeed, financeSeed, faro], 'La visita proyecto Horizonte Verde incluye estacionamiento?', 3)).toEqual([]);
    });

    it.each(['Horizonte Verde', 'Faro Rojo', 'horizonte verde', 'faro rojo'])(
        'never substitutes Faro Azul for the requested topic %s despite generic-word overlap', (topic) => {
            const genericAnswer = { ...faro, answer: 'Incluye la demostración y la visita dura 20 minutos.' };
            expect(rankPartialFaqMatches([genericAnswer], `¿Qué incluye la demostración ${topic} y cuánto dura la visita?`, 3)).toEqual([]);
        },
    );

    it.each([
        '¿Qué incluye la demostración y cuánto dura la visita faro rojo?',
        '¿Qué incluye la demostración y cuánto dura la visita Faro Rojo?',
        '¿Qué incluye la demostración? ¿Cuánto dura la visita faro rojo?',
        '¿Qué incluye la demostración? ¿Cuánto dura la visita Horizonte Verde?',
    ])('preserves a requested topic even when it only appears in a follow-up: %s', query => {
        expect(rankPartialFaqMatches([{ ...faro, answer: 'Incluye la demostración y la visita dura 20 minutos.' }], query, 3)).toEqual([]);
    });

    it.each([
        ['What does the Blue Lighthouse demo include and how long is the visit?', 'What does the Blue Lighthouse demo include?', 'The demo includes a visit lasting thirty minutes.'],
        ['O que inclui a demonstração Farol Azul e quanto dura a visita?', 'O que inclui a demonstração Farol Azul?', 'A demonstração inclui uma visita de trinta minutos.'],
        ['Que comprend la démonstration Phare Bleu et quelle est la durée de la visite?', 'Que comprend la démonstration Phare Bleu?', 'La démonstration comprend une visite de trente minutes.'],
    ])('keeps the named topic in %s', (query, question, answer) => {
        const match = faq('translated', question, answer);
        expect(rankPartialFaqMatches([visitSeed, match], query, 3)).toEqual([match]);
    });

    it('does not turn punctuation, apostrophes or operators into tsquery syntax', () => {
        expect(faqSearchTerms("' | ! : * (Faro) & <-> Azul --")).toEqual(['faro', 'azul']);
    });

    it('uses a bounded, published-only fallback after the canonical exact search misses', async () => {
        const raw = (value: FAQ) => ({ id: value.id, question: value.question, answer: value.answer, is_published: true });
        const query = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([raw(visitSeed), raw(faro)]);
        const tenants = { getSchemaName: jest.fn().mockResolvedValue('tenant_faq_search') };
        const service = new FaqsService({ $queryRawUnsafe: query } as any, {} as any, tenants as any);
        const result = await service.search('tenant', 'Que incluye la demostracion Faro Azul y cuanto dura la visita?', 3, AGENT_TEST_EXECUTION_CONTEXT);
        expect(result.map(row => row.id)).toEqual(['faro']);
        expect(query).toHaveBeenCalledTimes(2);
        expect(query.mock.calls[1][0]).toContain('WHERE is_published = true');
        expect(query.mock.calls[1][1]).toContain('faro | azul');
        expect(query.mock.calls[1][2]).toBe(20);
        expect(tenants.getSchemaName).toHaveBeenCalledWith('tenant', AGENT_TEST_EXECUTION_CONTEXT);
    });

    it('uses the same sealed captured collection for fallback without reading live tenant data', async () => {
        const row = { id: faro.id, question: faro.question, answer: faro.answer, is_published: true };
        const captured = sealStructuredKnowledgeCapture({ version: 1, tenantId: 'tenant', sourceSchema: 'tenant_faq_search',
            capturedAt: new Date().toISOString(), faqs: { state: 'present', rows: [row] }, policies: { state: 'present', rows: [] } });
        const query = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([row]);
        const tenants = { getSchemaName: jest.fn().mockRejectedValue(new Error('live schema lookup forbidden')) };
        const service = new FaqsService({ $queryRawUnsafe: query } as any, {} as any, tenants as any);
        expect((await service.search('tenant', 'Que incluye la demostración Faro Azul y cuánto dura la visita?',
            3, AGENT_TEST_EXECUTION_CONTEXT, captured))[0].id).toBe('faro');
        for (const call of query.mock.calls) {
            expect(call[0]).toContain('jsonb_to_recordset($3::jsonb)');
            expect(JSON.parse(call[3])).toEqual([row]);
        }
        expect(tenants.getSchemaName).not.toHaveBeenCalled();
    });

    it('keeps exact results without making a second query', async () => {
        const query = jest.fn().mockResolvedValue([{ id: faro.id, question: faro.question, answer: faro.answer, is_published: true }]);
        const service = new FaqsService({ $queryRawUnsafe: query } as any, {} as any,
            { getSchemaName: jest.fn().mockResolvedValue('tenant_faq_search') } as any);
        expect((await service.search('tenant', faro.question, 3, AGENT_TEST_EXECUTION_CONTEXT))[0].id).toBe('faro');
        expect(query).toHaveBeenCalledTimes(1);
    });
});

describe('FAQ lexical matching of rephrased questions', () => {
    const visitDuration = faq('dur', '¿Cuánto dura la visita guiada?', 'La visita guiada dura 45 minutos.');
    const visitPrice = faq('price', '¿Cuánto cuesta la visita guiada?', 'La visita guiada cuesta 20 mil pesos y dura 45 minutos.');

    it.each([
        'cuanto tiempo dura la visita guiada',
        'duración de la visita guiada?',
        'cuál es la duración de la visita guiada',
        'cuánto dura la visita guiada',
        'cuanto duran las visitas guiadas',
    ])('finds the duration FAQ for %p', query => {
        expect(rankPartialFaqMatches([visitDuration], query, 3)).toEqual([visitDuration]);
    });

    it.each([
        ['a price question', 'cuanto cuesta la visita guiada'],
        ['another kind of visit', 'cuanto dura la visita privada'],
        ['another topic with duration', 'duración de la entrega'],
        ['only the duration word', 'cuanto tiempo dura'],
        ['a different named topic', 'cuanto dura la visita guiada nocturna'],
    ])('does not answer %s (%p) with the duration FAQ', (_label, query) => {
        expect(rankPartialFaqMatches([visitDuration], query, 3)).toEqual([]);
    });

    // "time" and "last" are ordinary words: "what time" asks for a schedule and "the last tour" is
    // the final one. Only "how long" / "dura" / "duracion" / "duration" mean duration.
    const tourDuration = faq('tdur', 'How long does the tour last?', 'The tour lasts 90 minutes.');
    const tourStart = faq('tstart', 'What time does the tour start?', 'The tour starts at 9 am.');
    const arrival = faq('arr', '¿A qué hora y cuánto tiempo antes debo llegar al tour?', 'Llega 15 minutos antes de la hora del tour.');
    const returns = faq('ret', '¿Cuánto tiempo tengo para devolver un producto?', 'Tienes 15 días para devolver tu producto.');

    it.each([
        ['How long does the tour last?', tourStart],
        ['When is the last tour?', tourDuration],
        ['What time is the tour?', tourDuration],
        ['cuanto dura el tour', arrival],
        ['cuanto dura el producto', returns],
    ])('does not answer %p with an unrelated FAQ (%#)', (query, wrong) => {
        expect(rankPartialFaqMatches([wrong], query, 3)).toEqual([]);
    });

    it.each([
        ['How long does the tour last?', tourDuration],
        ['how long is the tour', tourDuration],
        ['What time does the tour start?', tourStart],
        ['cuanto tiempo antes debo llegar al tour', arrival],
    ])('still answers %p with its own FAQ', (query, right) => {
        expect(rankPartialFaqMatches([right], query, 3)).toEqual([right]);
    });

    it('keeps each FAQ for its own question', () => {
        expect(rankPartialFaqMatches([visitDuration, visitPrice], 'cuanto cuesta la visita guiada', 3)).toEqual([visitPrice]);
        expect(rankPartialFaqMatches([visitPrice, visitDuration], 'cuanto tiempo dura la visita guiada', 3).map(f => f.id)).toEqual(['dur']);
    });
});

describe('FAQ search with identifier noise in the message', () => {
    const warranty = faq('warranty', '¿Cuál es el plazo de garantía QA del audífono de prueba?',
        'El plazo de garantía QA del audífono de prueba es de 72 días calendario desde la entrega.');
    const unrelatedFaq = faq('hours', '¿Cuál es el horario de atención?', 'Atendemos de lunes a viernes de 9 a 18.');
    const prefixed = 'Prueba QA QA_C20261006P_T01_1: ¿Cuál es el plazo de garantía QA del audífono de prueba?';

    // Minimal emulation of the SQL: `plainto_tsquery` requires EVERY word, the fallback accepts ANY term.
    const fold = (v: string) => v.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
    const words = (v: string) => fold(v).match(/[\p{L}\p{N}_]+/gu) || [];
    const fakeDb = (corpus: FAQ[]) => jest.fn(async (sql: string, q: string) => {
        const raw = (f: FAQ) => ({ id: f.id, question: f.question, answer: f.answer, is_published: true });
        const doc = (f: FAQ) => new Set(words(`${f.question} ${f.answer}`));
        if (sql.includes('plainto_tsquery')) {
            const need = words(q);
            return corpus.filter(f => need.length && need.every(w => doc(f).has(w))).map(raw);
        }
        const any = q.split(' | ');
        return corpus.filter(f => any.some(w => doc(f).has(w))).map(raw);
    });
    const service = (corpus: FAQ[]) => {
        const query = fakeDb(corpus);
        return { query, svc: new FaqsService({ $queryRawUnsafe: query } as any, {} as any,
            { getSchemaName: jest.fn().mockResolvedValue('tenant_faq_search') } as any) };
    };

    it('strips mixed letter/digit tokens, long ids and XXX_YYY: prefixes', () => {
        expect(stripFaqQueryNoise(prefixed)).toBe('Prueba QA ¿Cuál es el plazo de garantía QA del audífono de prueba?');
        expect(stripFaqQueryNoise('Mi pedido 123456789 llegó roto, ¿cuál es la garantía?')).toBe('Mi pedido llegó roto, ¿cuál es la garantía?');
        expect(stripFaqQueryNoise('ORD-8841X: ¿hacen envíos?')).toBe('¿hacen envíos?');
        expect(stripFaqQueryNoise('¿Cuántos días tiene el plan 2025?')).toBe('¿Cuántos días tiene el plan 2025?');
    });

    it('extracts the last interrogative phrase', () => {
        expect(lastInterrogativePhrase('Hola, soy Ana. ¿Hacen envíos? Gracias. ¿Cuál es la garantía?')).toBe('¿Cuál es la garantía?');
        expect(lastInterrogativePhrase('what is the warranty? ok. how long is shipping?')).toBe('how long is shipping?');
        expect(lastInterrogativePhrase('sin pregunta')).toBeNull();
    });

    it('finds the QA warranty FAQ when the message carries a test code prefix', async () => {
        const { svc } = service([unrelatedFaq, warranty]);
        const result = await svc.search('tenant', prefixed, 3, AGENT_TEST_EXECUTION_CONTEXT);
        expect(result.map(r => r.id)).toEqual(['warranty']);
    });

    it('finds it from the cleaned message alone, without relying on the last-question retry', async () => {
        const { svc } = service([unrelatedFaq, warranty]);
        const result = await svc.search('tenant', 'Prueba QA QA_C20261006P_T01_1: cuál es el plazo de garantía QA del audífono de prueba',
            3, AGENT_TEST_EXECUTION_CONTEXT);
        expect(result.map(r => r.id)).toEqual(['warranty']);
    });

    it('retries with the last question when the first search is empty', async () => {
        const { svc, query } = service([unrelatedFaq, warranty]);
        const result = await svc.search('tenant',
            'Prueba QA Quiero saber otra cosa sobre mi cuenta mensual de la tienda. ¿Cuál es el plazo de garantía QA del audífono de prueba?',
            3, AGENT_TEST_EXECUTION_CONTEXT);
        expect(result.map(r => r.id)).toEqual(['warranty']);
        expect(query.mock.calls.length).toBeGreaterThan(2);
    });

    it('does not find the warranty FAQ for an unrelated question carrying a code', async () => {
        const { svc } = service([warranty]);
        expect(await svc.search('tenant', 'Prueba QA QA_C20261006P_T01_2: ¿Venden pizzas congeladas?', 3, AGENT_TEST_EXECUTION_CONTEXT)).toEqual([]);
    });
});
