import { pickTopicFallbackFaq } from './faq-search';

/**
 * F4300-53 (production QA 29-oct, image 29d21a93; FAQs read from the agency's DB): «¿necesito pasaporte para viajar con ustedes?» in
 * four languages found no FAQ (turn_traces: faqResultIds []), so the agent answered «No puedo brindar información oficial sobre
 * requisitos migratorios» although «¿Qué documentos necesito para viajar?» answers it. Also «¿qué marcas usan?» for «¿Qué productos usan?».
 */
const faq = (id: string, question: string, answer: string) => ({ id, question, answer } as any);
const DOCS = faq('docs', '¿Qué documentos necesito para viajar?', 'Depende del destino: en viajes nacionales suele bastar tu documento de identidad y en internacionales se pide pasaporte vigente, a veces con visa.');
const INSURANCE = faq('ins', '¿Necesito seguro de viaje?', 'Siempre recomendamos viajar con seguro.');
const PRODUCTS = faq('prod', '¿Qué productos usan?', 'Cuéntanos si tienes alguna alergia o preferencia. Si quieres saber qué marcas usamos para tu servicio, te lo confirmo.');

describe('F4300-53 · a passport is a travel document; a brand is a product', () => {
    it.each([
        ['¿necesito pasaporte para viajar con ustedes?', 'docs'],
        ['do I need a passport to travel with you?', 'docs'],
        ['preciso de passaporte para viajar com vocês?', 'docs'],
        ['ai-je besoin d’un passeport pour voyager avec vous ?', 'docs'],
        ['¿necesito seguro de viaje?', 'ins'],
        ['¿qué marcas o productos usan en el tinte?', 'prod'],
    ])('%s → %s', (message, expected) => {
        expect(pickTopicFallbackFaq([DOCS, INSURANCE, PRODUCTS], message)?.id ?? null).toBe(expected);
    });
});
