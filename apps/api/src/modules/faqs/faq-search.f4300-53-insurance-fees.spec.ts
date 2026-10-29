import { pickTopicFallbackFaq } from './faq-search';

/**
 * F4300-53 (production QA 29-oct, FAQ bank generated from the tenants' published FAQs): the agency, the real estate agency and the
 * shop were asked their own FAQs in other words and found none — the agent said it had no information on insurance, on fees or on
 * where the shop is, refused travel insurance outright, or listed rental documents of its own invention.
 */
const faq = (id: string, question: string) => ({ id, question, answer: 'Respuesta publicada.' } as any);
const TRAVEL = ['¿Qué destinos manejan?', '¿Qué incluye el paquete?', '¿Cuál es la política de cancelación?', '¿Necesito seguro de viaje?',
    '¿Qué documentos necesito para viajar?', '¿Incluye traslado desde el hotel?', '¿Hay descuento para niños?', '¿En qué idiomas se hace el tour?',
    '¿Dónde es el punto de encuentro?'].map((q, i) => faq(`t${i}`, q));
const REALTY = ['¿Cuál es la comisión?', '¿Ofrecen financiación?', '¿Cómo agendo una visita?', '¿Qué documentos necesito?',
    '¿Cuánto cobran de comisión / honorarios?', '¿Qué documentos necesito para arrendar / comprar?', '¿Qué propiedades tienen disponibles?']
    .map((q, i) => faq(`r${i}`, q));
// The real answer: what the customer's «propiedad» is called in it is «inmueble».
REALTY[5].answer = 'Arriendo: cédula, certificado laboral, extractos bancarios y codeudor (depende del inmueble). Compra: capacidad crediticia y separación.';
const SHOP = [faq('where', '¿Dónde están ubicados?'), faq('ship', '¿Hacen envíos?'), faq('pay', '¿Qué métodos de pago aceptan?')];

describe('F4300-53 · insurance, fees, location and rental papers asked in other words', () => {
    it.each([
        ['¿Es obligatorio contratar un seguro para el viaje?', '¿Necesito seguro de viaje?'],
        ['Faut-il souscrire une assurance voyage pour le déplacement ?', '¿Necesito seguro de viaje?'],
        ['is travel insurance required?', '¿Necesito seguro de viaje?'],
        ['what is your cancellation policy if I cancel?', '¿Cuál es la política de cancelación?'],
        ['¿Qué incluye el paquete?', '¿Qué incluye el paquete?'],
    ])('agency: %s', (message, expected) => {
        expect(pickTopicFallbackFaq(TRAVEL, message)?.question ?? null).toBe(expected);
    });

    it.each([
        ['Quais são as taxas que vocês cobram?', '¿Cuánto cobran de comisión / honorarios?'],
        ['¿Qué papeles tengo que tener listos si quiero alquilar o comprar la propiedad?', '¿Qué documentos necesito para arrendar / comprar?'],
    ])('real estate: %s', (message, expected) => {
        expect(pickTopicFallbackFaq(REALTY, message)?.question ?? null).toBe(expected);
    });

    it.each([
        ['Onde fica o estabelecimento?', 'where'],
        ['where are you located?', 'where'],
    ])('shop: %s', (message, expected) => {
        expect(pickTopicFallbackFaq(SHOP, message)?.id ?? null).toBe(expected);
    });
});
