import { languageMismatch } from '../reply-language';
import { isPastOrdersQuestion, lexicalRequiredReadsOperation } from './operation-lexical-cues';

/**
 * Production QA 26-oct (image fee22cc7, renderedFacts on): three French turns were answered without the read that holds the
 * answer, and one French reply went out half in Spanish.
 *   - store «combien de commandes ai-je chez vous ?» / «j'ai passé combien de commandes dans la boutique ?»: only search_faqs
 *     (2 of 2); the count the model typed from memory was rightly not confirmed by the renderer, so the customer got no number;
 *   - tours «à quelle heure part le Spark QA Tour du 15 décembre ?»: only search_faqs (2 of 2), «je n'ai pas l'heure exacte… »
 *     (the departure is at 09:00);
 *   - store «El total de su última commande est de 119 900 COP et son statut est annulé.» to a French turn: no rewrite.
 */
const CATALOG = ['list_my_catalog_orders', 'search_products'];
const RESTAURANT = ['list_my_orders', 'get_menu'];
const TOURS = ['search_packages'];

describe('how many orders: the customer\'s own orders are read', () => {
    it.each([
        'combien de commandes ai-je chez vous ?', "j'ai passé combien de commandes dans la boutique ?", 'combien d\'achats ai-je faits ?',
        'cuántos pedidos he hecho en la tienda?', 'cuántas compras tengo?', 'how many orders have I made?', 'how many purchases have I made in the store?',
        'quantos pedidos eu fiz?', 'quantas compras eu tenho?',
    ])('«%s»', text => {
        expect(isPastOrdersQuestion(text)).toBe(true);
        expect(lexicalRequiredReadsOperation(text, 'catalog', CATALOG)).toBe('track_catalog_order');
        expect(lexicalRequiredReadsOperation(text, 'restaurants', RESTAURANT)).toBe('check_my_orders');
    });

    it('a write about them is not a question («annuler mes commandes»)', () => {
        expect(isPastOrdersQuestion('combien de commandes puis-je annuler ?')).toBe(false);
    });
});

describe('at what time a tour leaves: its departures are read', () => {
    it.each([
        'à quelle heure part le Spark QA Tour du 15 décembre ?', 'le Spark QA Tour du 15 décembre part à quelle heure ?',
        'a qué hora sale el Spark QA Tour?', 'que horas sai o Spark QA Tour?', 'what time does the Spark QA Tour leave?',
    ])('«%s»', text => {
        expect(lexicalRequiredReadsOperation(text, 'tours', TOURS)).toBe('package_availability');
    });
});

describe('a French sentence that drifts into Spanish is a mismatch', () => {
    it('the production reply', () => {
        const reply = 'El total de su última commande est de 119 900 COP et son statut est annulé. Puis-je vous aider avec autre chose ?';
        expect(languageMismatch(reply, 'fr')).toBe('es');
    });

    it.each([
        ['fr', 'Le total de votre dernière commande est de 119 900 COP et son statut est annulé. Puis-je vous aider avec autre chose ?'],
        ['fr', "Le Spark QA Tour dure 4 heures et il est guidé en espagnol. Souhaitez-vous que je vous aide à réserver ?"],
        ['es', 'El total de su último pedido es de 119.900 COP y su estado es cancelado. ¿Le puedo ayudar con algo más?'],
        ['pt', 'O total do seu último pedido é de 119.900 COP e o status é cancelado. Posso ajudar com mais alguma coisa?'],
    ])('a reply in one language stays («%s»)', (lang, reply) => {
        expect(languageMismatch(reply, lang)).toBeNull();
    });
});
