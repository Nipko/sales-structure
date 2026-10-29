import { quantityTotalNote } from './quantity-total';

/**
 * F4300-47 residue (production QA 29-oct, image b3e02e68): «¿y si me llevo 2?» after the Audífono's price was answered with an offer
 * to place the order and no total, in es/en/pt/fr.
 */
const CATALOG = [{ title: 'Audífono QA Aurora', price: 119900, currency: 'COP', stock: 2 }];
const spaced = (text: string | null) => String(text).replace(/\s/g, ' ');

describe('F4300-47 · a quantity of the catalogue product gets its total', () => {
    it.each([
        ['es', '¿y si me llevo 2?', 'Puedo ayudarle a hacer un pedido de 2 unidades del Audífono QA Aurora en azul. ¿Quiere que continúe con la orden?',
            'Por 2 unidades serían 239.800 COP (2 × 119.900 COP). ¿Quiere que continúe con la orden?'],
        ['en', 'and if I take 2?', 'I can help you place an order for 2 units of the Audífono QA Aurora in blue. Would you like me to proceed with that?',
            'For 2 units it would be 239,800 COP (2 × 119,900 COP). Would you like me to proceed with that?'],
        ['fr', 'et si j’en prends 2 ?', 'Je peux vous aider à passer une commande pour 2 unités de l’Audífono QA Aurora en bleu. Voulez-vous que je continue avec la commande ?',
            'Pour 2 unités, cela ferait 239 800 COP (2 × 119 900 COP).'],
    ])('[%s] %s', (lang, ask, reply, expected) => {
        expect(spaced(quantityTotalNote(reply, ask, CATALOG, lang))).toContain(spaced(expected));
    });

    it.each([
        ['the reply has an amount', '¿y si me llevo 2?', 'Por 2 unidades son 239.800 COP.'],
        ['no quantity', '¿lo tienen en azul?', 'Sí, el Audífono QA Aurora está en azul.'],
        ['more than the stock', '¿y si me llevo 3?', 'Puedo ayudarle con 3 unidades del Audífono QA Aurora.'],
        ['no product named', '¿y si me llevo 2?', 'Claro, ¿de qué producto?'],
    ])('stays: %s', (_why, ask, reply) => {
        expect(quantityTotalNote(reply, ask, CATALOG, 'es')).toBeNull();
    });
});
