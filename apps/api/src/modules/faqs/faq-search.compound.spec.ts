import type { FAQ } from '@parallext/shared';
import { splitCompoundQuery } from './faq-search';
import { FaqsService } from './faqs.service';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';

/**
 * Production 2026-10-08 (store, Telegram): «¿Cuánto cuesta el Audífono QA, cuántas unidades hay y qué garantía
 * tiene?» got «no tengo información específica» about the warranty although the FAQ alone («¿cuál es el plazo de
 * garantía?») answers it. `plainto_tsquery` needs EVERY word of the whole message and the OR-ranked fallback
 * anchors on the first question only. A multi-part message is searched part by part.
 */
const faq = (id: string, question: string, answer: string) => ({ id, question, answer, isPublished: true } as FAQ);
const fold = (v: string) => v.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
const words = (v: string) => fold(v).match(/[\p{L}\p{N}_]+/gu) || [];

/** Minimal emulation of the SQL: `plainto_tsquery` requires EVERY word, the fallback accepts ANY term. */
const fakeDb = (corpus: FAQ[]) => jest.fn(async (sql: string, q: string) => {
    const raw = (f: FAQ) => ({ id: f.id, question: f.question, answer: f.answer, is_published: true });
    const doc = (f: FAQ) => new Set(words(`${f.question} ${f.answer}`));
    if (sql.includes('plainto_tsquery')) {
        const need = words(q);
        const text = (f: FAQ) => fold(`${f.question} ${f.answer}`);
        return corpus.filter(f => (need.length && need.every(w => doc(f).has(w))) || text(f).includes(fold(q))).map(raw);
    }
    const any = q.split(' | ');
    return corpus.filter(f => any.some(w => doc(f).has(w))).map(raw);
});
const service = (corpus: FAQ[]) => new FaqsService({ $queryRawUnsafe: fakeDb(corpus) } as any, {} as any,
    { getSchemaName: jest.fn().mockResolvedValue('tenant_faq_compound') } as any);
const search = (corpus: FAQ[], query: string) => service(corpus).search('tenant', query, 3, AGENT_TEST_EXECUTION_CONTEXT).then(rows => rows.map(r => r.id));

const warranty = faq('warranty', '¿Cuál es el plazo de garantía?', 'El plazo de garantía del audífono QA es de 72 días calendario desde la entrega.');
const hours = faq('hours', '¿Cuál es el horario de atención?', 'Atendemos de lunes a viernes de 9 a 18.');
const shipping = faq('shipping', '¿Cuánto demora el envío?', 'El envío tarda de 2 a 4 días hábiles.');
const tourWarranty = faq('tour', '¿Qué garantía tiene el tour Faro Rojo?', 'El tour Faro Rojo no tiene garantía de reembolso.');

describe('splitCompoundQuery', () => {
    it.each([
        ['¿Cuánto cuesta el Audífono QA, cuántas unidades hay y qué garantía tiene?', ['Cuánto cuesta el Audífono QA', 'cuántas unidades hay', 'qué garantía tiene']],
        ['How much is the QA Headset, how many units are there and what warranty does it have?', ['How much is the QA Headset', 'how many units are there', 'what warranty does it have']],
        ['Quanto custa o Fone QA, quantas unidades há e qual a garantia?', ['Quanto custa o Fone QA', 'quantas unidades há', 'qual a garantia']],
        ['Combien coûte le Casque QA et quelle garantie a-t-il ?', ['Combien coûte le Casque QA', 'quelle garantie a-t-il']],
        ['¿Qué horario tienen? ¿Y hacen envíos?', ['Qué horario tienen', 'Y hacen envíos']],
    ])('splits %s', (query, expected) => {
        expect(splitCompoundQuery(query)).toEqual(expected);
    });

    it('leaves a single question alone and does not split a plain "y"', () => {
        expect(splitCompoundQuery('¿Cuál es el plazo de garantía?')).toEqual(['Cuál es el plazo de garantía']);
        expect(splitCompoundQuery('¿Tienen color y tratamiento?')).toEqual(['Tienen color y tratamiento']);
    });
});

describe('FAQ search with a multi-part message', () => {
    it('finds the warranty FAQ for «¿Cuánto cuesta el Audífono QA, cuántas unidades hay y qué garantía tiene?»', async () => {
        expect(await search([hours, warranty], '¿Cuánto cuesta el Audífono QA, cuántas unidades hay y qué garantía tiene?')).toEqual(['warranty']);
    });

    it.each([
        ['How much is the QA Headset, how many units are there and what warranty does it have?', faq('w', 'What is the warranty period?', 'The warranty period is 72 days.')],
        ['Quanto custa o Fone QA, quantas unidades há e qual a garantia?', faq('w', 'Qual é o prazo de garantia?', 'O prazo de garantia é de 72 dias.')],
        ['Combien coûte le Casque QA, combien d\'unités y a-t-il et quelle garantie a-t-il ?', faq('w', 'Quel est le délai de garantie ?', 'Le délai de garantie est de 72 jours.')],
    ])('works in the other languages: %s', async (query, right) => {
        expect(await search([hours, right], query)).toEqual(['w']);
    });

    it('answers each part with its own FAQ', async () => {
        expect((await search([hours, warranty, shipping], '¿Qué garantía tiene y cuál es el horario?')).sort()).toEqual(['hours', 'warranty']);
    });

    it('prefers the FAQ that shares the product the message names over another garantía FAQ', async () => {
        expect(await search([tourWarranty, warranty], '¿Cuánto cuesta el Audífono QA, cuántas unidades hay y qué garantía tiene?')).toEqual(['warranty']);
    });

    it('finds nothing rather than guess when two FAQs fit the topic equally', async () => {
        const other = faq('other', '¿Cuál es la garantía de la tienda?', 'Todos los productos tienen garantía legal.');
        expect(await search([warranty, other], '¿Cuánto cuesta el cargador, cuántas unidades hay y qué garantía tiene?')).toEqual([]);
    });

    it('finds nothing when no FAQ is about any part', async () => {
        expect(await search([hours, shipping], '¿Cuánto cuesta el Audífono QA, cuántas unidades hay y qué garantía tiene?')).toEqual([]);
    });

    it('keeps the earlier guarantees: another named tour or plan is never answered with a similar FAQ', async () => {
        const azul = faq('azul', '¿Cuánto dura el tour Faro Azul?', 'El tour Faro Azul dura 3 horas.');
        expect(await search([azul], 'Compré el tour Faro Rojo ayer. ¿Cuánto dura?')).toEqual([]);
        expect(await search([azul], 'Tour Faro Rojo, reserva RES_77: ¿Cuánto dura?')).toEqual([]);
    });
});
