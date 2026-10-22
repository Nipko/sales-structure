import type { FAQ } from '@parallext/shared';
import { pickTopicFallbackFaq } from './faq-search';
import { FaqsService } from './faqs.service';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';

/**
 * Production F4300-21 (real-estate QA tenant, 2026-10): «cuánto cobran de comisión por vender mi apartamento?» got
 * «No manejo información sobre comisiones» with search_faqs at 0 results, although two published FAQs answer it.
 * `plainto_tsquery` needs EVERY word, the ILIKE fallbacks need the whole message as a substring, and the per-part
 * search only runs for compound messages. A single question with extra words now falls back to its topic words.
 */
const faq = (id: string, question: string, answer: string) => ({ id, question, answer, isPublished: true } as FAQ);
const fold = (v: string) => v.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
const words = (v: string) => fold(v).match(/[\p{L}\p{N}_]+/gu) || [];

/** Minimal emulation of the SQL: `plainto_tsquery` requires EVERY word, the OR fallbacks accept ANY term. */
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
const search = (corpus: FAQ[], query: string) => new FaqsService({ $queryRawUnsafe: fakeDb(corpus) } as any, {} as any,
    { getSchemaName: jest.fn().mockResolvedValue('tenant_faq_topic') } as any)
    .search('tenant', query, 5, AGENT_TEST_EXECUTION_CONTEXT).then(rows => rows.map(r => r.id));

// The published FAQs of the production tenant (questions and answers verbatim).
const realEstate = [
    faq('properties', '¿Qué propiedades tienen disponibles?', 'Tenemos opciones en venta y arriendo. Cuéntame tu presupuesto, zona de interés y tipo de inmueble y te muestro las que mejor encajan.'),
    faq('commission', '¿Cuál es la comisión?', 'La comisión depende del tipo de operación. Te confirmo la cifra exacta antes de avanzar; si quieres, agendamos una reunión para revisarla con calma.'),
    faq('finance', '¿Ofrecen financiación?', 'Podemos orientarte sobre opciones de crédito hipotecario y contarte con qué entidades trabajamos. Agenda una asesoría y lo revisamos juntos.'),
    faq('visit', '¿Cómo agendo una visita?', 'Puedo agendar una visita para ti ahora mismo. Dime cuál propiedad te interesa y tus horarios disponibles.'),
    faq('documents', '¿Qué documentos necesito?', 'Depende de si compras o arriendas y de la entidad que participe. Cuéntame cuál es tu caso y un asesor te pasa la lista exacta de documentos.'),
    faq('credit', '¿Tienen opciones con financiación / crédito hipotecario?', 'La financiación depende de cada propiedad y de tu perfil.'),
    faq('visit-property', '¿Cómo agendo una visita a la propiedad?', 'Te muestro las propiedades disponibles según tu interés y agendamos visita con el asesor de zona.'),
    faq('fees', '¿Cuánto cobran de comisión / honorarios?', 'Los honorarios dependen de si es arriendo o venta y del inmueble. Te los confirma el asesor sobre la propiedad concreta que te interese, antes de cualquier compromiso.'),
    faq('rent-docs', '¿Qué documentos necesito para arrendar / comprar?', 'Arriendo: cédula, certificado laboral, extractos bancarios y codeudor. Compra: capacidad crediticia y separación.'),
    faq('admin-fee', '¿La administración / cuota de condominio está incluida en el precio?', 'En arriendo: la administración generalmente NO está incluida y se paga aparte.'),
];

describe('FAQ search for one question with extra words (F4300-21)', () => {
    it('finds the commission FAQ for «cuánto cobran de comisión por vender mi apartamento?»', async () => {
        expect(await search(realEstate, 'cuánto cobran de comisión por vender mi apartamento?')).toEqual(['fees']);
    });

    it('finds it with either commission FAQ alone, and without accents', async () => {
        const only = (id: string) => realEstate.filter(f => f.id === id || !['fees', 'commission'].includes(f.id));
        expect(await search(only('fees'), 'cuanto cobran de comision por vender mi apartamento')).toEqual(['fees']);
        expect(await search(only('commission'), 'cuánto cobran de comisión por vender mi apartamento?')).toEqual(['commission']);
    });

    it('never matches on words that only ask («cuánto», «cobran») when the topic is somewhere else', async () => {
        expect(await search(realEstate, '¿cuánto cobran por pintar la fachada de mi casa?')).toEqual([]);
    });

    it('keeps an unrelated FAQ out when the only shared topic word is in its answer, not its question', async () => {
        // «venta»/«arriendo» live in answers only: no FAQ QUESTION is about them.
        expect(await search(realEstate, '¿cuánto tardan en publicar mi arriendo?')).toEqual([]);
    });

    it('never guesses between FAQs that fit the message equally', () => {
        const a = faq('a', '¿Qué garantía tienen?', 'Doce meses.');
        const b = faq('b', '¿Cuál es la garantía?', 'Seis meses según el producto.');
        expect(pickTopicFallbackFaq([a, b], 'quiero información de garantía para mi oficina')).toBeNull();
        // one of them alone is not a guess
        expect(pickTopicFallbackFaq([a], 'quiero información de garantía para mi oficina')?.id).toBe('a');
    });

    it('never answers a named topic with a FAQ about a different name («Faro Rojo» is not «Faro Azul»)', async () => {
        const azul = faq('azul', '¿Cuánto dura el tour Faro Azul?', 'El tour Faro Azul dura 3 horas.');
        expect(await search([azul], '¿Cuánto dura el tour Faro Rojo para mi familia?')).toEqual([]);
        const tourWarranty = faq('tour', '¿Qué garantía tiene el tour Faro Rojo?', 'El tour Faro Rojo no tiene garantía de reembolso.');
        expect(await search([tourWarranty], '¿qué garantía tiene el audífono que compré?')).toEqual([]);
    });

    it('never answers a different question about the same topic («cuánto cuesta» is not «cuánto dura»)', async () => {
        const duration = faq('duration', '¿Cuánto dura la visita guiada?', 'La visita guiada dura 45 minutos.');
        expect(await search([duration], 'cuanto cuesta la visita guiada')).toEqual([]);
        expect(await search([duration], 'how much does the visita guiada cost')).toEqual([]);
        expect(await search([duration], 'cuánto dura la visita guiada del sábado?')).toEqual(['duration']);
    });

    it('returns the FAQ whose question covers a clear majority of the topic words', () => {
        const route = faq('route', '¿Qué incluye el tour Faro Azul?', 'Transporte y guía.');
        const other = faq('other', '¿Qué incluye el plan familiar?', 'Dos adultos y dos niños.');
        expect(pickTopicFallbackFaq([other, route], '¿qué incluye el tour faro azul si voy con mi abuela?')?.id).toBe('route');
    });

    it('stays empty when two different topic words each point to a different FAQ', () => {
        const commission = faq('c', '¿Cuál es la comisión?', 'Depende de la operación.');
        const sell = faq('s', '¿Qué necesito para vender?', 'Escrituras y certificado de libertad.');
        expect(pickTopicFallbackFaq([commission, sell], 'cuánto cobran de comisión por vender mi apartamento?')).toBeNull();
    });

    it('does not run when the strict search already found the FAQ', async () => {
        expect(await search(realEstate, '¿Cuál es la comisión?')).toEqual(['commission']);
    });
});
