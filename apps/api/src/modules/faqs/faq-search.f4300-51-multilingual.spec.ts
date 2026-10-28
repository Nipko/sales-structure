import type { FAQ } from '@parallext/shared';
import { pickTopicFallbackFaq, topicTermsOf, withEquivalents } from './faq-search';

/**
 * F4300-51 (production QA 28-oct, store tenant): the FAQ «¿Cuál es el plazo de garantía QA del audífono de prueba?» was found in
 * Spanish only; «how long is the warranty on the QA test headphone?», «combien de temps dure la garantie de l’audífono QA de test ?»
 * and «quanto tempo dura a garantia do audífono QA de teste?» got «no tengo información».
 */
const faq = (id: string, question: string, answer: string) => ({ id, question, answer, category: null, tags: [], orderIndex: 0, isPublished: true } as unknown as FAQ);
const STORE = [
    faq('hours', '¿Cuál es el horario de atención?', 'Cuéntame qué día te sirve y te confirmo nuestro horario de atención.'),
    faq('pay', '¿Cuáles son los métodos de pago?', 'Te confirmamos los medios de pago disponibles según lo que necesites.'),
    faq('where', '¿Dónde están ubicados?', 'Con gusto te compartimos nuestra dirección y cómo llegar.'),
    faq('returns', '¿Tienen política de devolución?', 'Cuéntanos tu caso y te confirmamos qué condiciones de cambio o devolución aplican.'),
    faq('contact', '¿Cómo puedo contactarlos?', 'Puedes escribirnos aquí, llamarnos o visitarnos. Estamos para ayudarte.'),
    faq('warranty', '¿Cuál es el plazo de garantía QA del audífono de prueba?', 'Para este piloto ficticio, el audífono QA tiene garantía de 72 días calendario desde la entrega.'),
];

describe('F4300-51 · a FAQ written in one language answers the same question in the other three', () => {
    it.each([
        '¿cuánto dura la garantía del audífono QA de prueba?',
        'how long is the warranty on the QA test headphone?',
        'combien de temps dure la garantie de l’audífono QA de test ?',
        'quanto tempo dura a garantia do audífono QA de teste?',
    ])('«%s» → the warranty FAQ', message => {
        expect(pickTopicFallbackFaq(STORE, message)?.id).toBe('warranty');
    });

    it.each([
        ['what payment methods do you accept?', 'pay'], ['quais são os métodos de pagamento?', 'pay'],
        ['do you have a returns policy?', 'returns'], ['quels sont vos horaires ?', 'hours'],
        ['how can I contact you?', 'contact'], ['comment puis-je vous contacter ?', 'contact'], ['como posso entrar em contato?', 'contact'],
    ])('«%s» → %s', (message, id) => {
        expect(pickTopicFallbackFaq(STORE, message)?.id).toBe(id);
    });

    it.each(['how long does shipping take to Medellín?', 'is the Aurora tour in English?', 'what colour is the headphone?'])('nothing to answer «%s»', message => {
        expect(pickTopicFallbackFaq(STORE, message)).toBeNull();
    });

    it('the candidate search looks for every spelling of the topic', () => {
        expect(withEquivalents(topicTermsOf('how long is the warranty?'))).toEqual(expect.arrayContaining(['warranty', 'garantia', 'garantie']));
    });

    it.each([
        'what documents do I need to buy a property?', 'quels documents me faut-il pour acheter un bien ?', 'que documentos preciso para comprar um imóvel?',
    ])('«%s» → the documents FAQ of the agency', message => {
        const AGENCY = [
            faq('docs', '¿Qué documentos necesito para arrendar / comprar?', 'Arriendo: cédula y certificado laboral. Compra: capacidad crediticia y separación.'),
            faq('commission', '¿Cuánto cobran de comisión / honorarios?', 'Los honorarios dependen de si es arriendo o venta.'),
            faq('visit', '¿Cómo agendo una visita a la propiedad?', 'Agendamos visita con el asesor de zona.'),
        ];
        expect(pickTopicFallbackFaq(AGENCY, message)?.id).toBe('docs');
    });

    it.each([
        ['is there a discount for children?', 'kids'], ['y a-t-il une réduction pour les enfants ?', 'kids'],
        ['what products do you use?', 'products'], ['how much commission do you charge?', 'commission'],
        ['how do I book a table?', 'table'], ['how long does orthodontic treatment take?', 'ortho'],
        ['what do I do in a dental emergency?', 'emergency'], ['what is the warranty period of the QA headphone?', 'warranty'],
    ])('batch 3: «%s» → %s', (message, id) => {
        const MIXED = [
            faq('kids', '¿Hay descuento para niños?', 'Las tarifas para niños dependen del paquete y de la edad.'),
            faq('products', '¿Qué productos usan?', 'Cuéntanos si tienes alguna alergia o preferencia y lo tenemos en cuenta.'),
            faq('commission', '¿Cuál es la comisión?', 'La comisión depende del tipo de operación.'),
            faq('table', '¿Cómo hago una reserva?', 'Puedo reservar tu mesa ahora. Dime para cuántas personas y la fecha.'),
            faq('ortho', '¿Cuánto tiempo dura un tratamiento de ortodoncia?', 'Depende de tu caso, generalmente entre 12 y 24 meses.'),
            faq('emergency', '¿Qué hago en caso de emergencia?', 'Acude al servicio de urgencias más cercano.'),
            faq('warranty', '¿Cuál es el plazo de garantía QA del audífono de prueba?', '72 días calendario desde la entrega.'),
        ];
        expect(pickTopicFallbackFaq(MIXED, message)?.id).toBe(id);
    });
});
