import { unbackedPaymentCorrection } from './unbacked-payment';

/**
 * F4300-58 (production QA 28-oct): payment methods no FAQ, policy or document of the business names — the restaurant listed its order
 * tool's enum, the dental clinic invented «cash, credit/debit cards and possibly bank transfers».
 */
const NO_PAYMENT_FAQ = [{ name: 'search_faqs', result: { faqs: [{ question: '¿Trabajan con seguros?', answer: 'Verificamos su convenio antes de la cita.' }] } }];
const PAYMENT_FAQ = [{ name: 'search_faqs', result: { faqs: [{ question: '¿Qué medios de pago aceptan?', answer: 'Aceptamos efectivo y Nequi.' }] } }];

describe('F4300-58 · payment methods are said only when a read names them', () => {
    it.each([
        ['es', '¿qué medios de pago aceptan?', 'Aceptamos pagos en efectivo, tarjeta, enlace de pago, PSE y transferencia. ¿Con cuál medio de pago le gustaría hacer su pedido?',
            'No consta en la información registrada qué medios de pago acepta el negocio.'],
        ['en', 'which payment methods do you accept?', 'I understand; generally, we accept cash, credit/debit cards, and possibly bank transfers. The clinic can confirm your insurance.',
            'The payment methods this business accepts are not recorded in the information I have. The clinic can confirm your insurance.'],
        ['pt', 'quais formas de pagamento vocês aceitam?', 'Aceitamos pagamento em dinheiro, cartão, link de pagamento, PSE e transferência bancária. Qual forma de pagamento você prefere para o seu pedido?',
            'Não consta na informação registrada quais formas de pagamento o negócio aceita.'],
        ['fr', 'quels moyens de paiement acceptez-vous ?', 'Nous acceptons les paiements en espèces, par carte et par virement bancaire. Quel moyen de paiement préférez-vous ?',
            'Les informations enregistrées ne précisent pas les moyens de paiement acceptés.'],
    ])('[%s] %s', (lang, ask, reply, expected) => {
        expect(unbackedPaymentCorrection(reply, ask, NO_PAYMENT_FAQ, lang)).toBe(expected);
    });

    it.each([
        ['a FAQ names the methods', '¿qué medios de pago aceptan?', 'Aceptamos efectivo y Nequi.', PAYMENT_FAQ],
        ['no payment question', '¿cómo hago un pedido?', 'Puede pagar en efectivo al recibir.', NO_PAYMENT_FAQ],
        ['no method named', '¿qué medios de pago aceptan?', 'No tengo información confirmada sobre los medios de pago.', NO_PAYMENT_FAQ],
    ])('stays: %s', (_why, ask, reply, reads) => {
        expect(unbackedPaymentCorrection(reply, ask, reads as any, 'es')).toBeNull();
    });
});
