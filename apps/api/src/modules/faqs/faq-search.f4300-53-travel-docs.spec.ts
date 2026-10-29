import { pickTopicFallbackFaq } from './faq-search';

/**
 * F4300-53 (production QA 29-oct, image 29d21a93; FAQs read from the agency's DB): «¿necesito pasaporte para viajar con ustedes?» in
 * four languages found no FAQ (turn_traces: faqResultIds []), so the agent answered «No puedo brindar información oficial sobre
 * requisitos migratorios» although «¿Qué documentos necesito para viajar?» answers it. Also «¿qué marcas usan?» for «¿Qué productos usan?».
 */
const faq = (id: string, question: string, answer: string) => ({ id, question, answer } as any);
const DOCS = faq('docs', '¿Qué documentos necesito para viajar?', 'Depende del destino: en viajes nacionales suele bastar tu documento de identidad y en internacionales se pide pasaporte vigente, a veces con visa.');
const INSURANCE = faq('ins', '¿Necesito seguro de viaje?', 'Siempre recomendamos viajar con seguro.');
const MEET = faq('meet', '¿Dónde es el punto de encuentro?', 'Te enviaré el punto exacto al confirmar la reserva. Generalmente recogemos en hoteles del centro 15 minutos antes de la salida.');
const PRODUCTS = faq('prod', '¿Qué productos usan?', 'Cuéntanos si tienes alguna alergia o preferencia. Si quieres saber qué marcas usamos para tu servicio, te lo confirmo.');

describe('F4300-53 · a passport is a travel document; a brand is a product', () => {
    it.each([
        ['¿necesito pasaporte para viajar con ustedes?', 'docs'],
        ['do I need a passport to travel with you?', 'docs'],
        ['preciso de passaporte para viajar com vocês?', 'docs'],
        ['ai-je besoin d’un passeport pour voyager avec vous ?', 'docs'],
        ['¿necesito seguro de viaje?', 'ins'],
        ['¿qué marcas o productos usan en el tinte?', 'prod'],
        ['¿qué papeles necesito para un viaje internacional?', 'docs'],
        ['what papers do I need for an international trip?', 'docs'],
        ['quels papiers faut-il pour un voyage international ?', 'docs'],
        ['¿dónde nos encontramos para salir al tour?', 'meet'],
        ['where do we meet for the tour?', 'meet'],
        ['onde nos encontramos para o tour?', 'meet'],
    ])('%s → %s', (message, expected) => {
        expect(pickTopicFallbackFaq([DOCS, INSURANCE, PRODUCTS, MEET], message)?.id ?? null).toBe(expected);
    });
});
