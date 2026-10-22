import { buildTrustedPriceCorpus, requiresCanonicalPackagePrice } from './trusted-price-context';
import { canonicalPackageCatalogue } from './canonical-package-context';

describe('canonical package projection', () => {
    it('keeps current reader prices without inventing currency or availability', () => {
        expect(canonicalPackageCatalogue({ packages: [{ id: 'one', name: 'Tour', price: '129000', currency: 'COP', seatsLeft: 8 },
            { id: 'two', name: 'Other', price: 20, notes: '500 COP' }] })).toEqual([
                { id: 'one', title: 'Tour', price: 129000, priceStatus: 'confirmed', currency: 'COP' },
                { id: 'two', title: 'Other', price: 20, priceStatus: 'confirmed' },
            ]);
    });
    it('rejects failed and malformed results rather than turning missing prices into zero', () => {
        expect(canonicalPackageCatalogue({ error: 'denied', packages: [{ id: 'one', name: 'Tour', price: 500 }] })).toEqual([]);
        expect(canonicalPackageCatalogue({ status: 'failed', packages: [{ id: 'one', name: 'Tour', price: 500 }] })).toEqual([]);
        expect(canonicalPackageCatalogue({ packages: [{ id: 'one', name: 'Tour', price: null },
            { id: 'two', name: 'Tour', price: 'NaN' }, { id: 'three', name: 'Tour', price: -1 },
            { id: 'four', name: 'Tour', price: true }, { id: 'five', name: 'Tour', price: ' ' }] })).toEqual([]);
    });
});
import { ResponseValidatorService } from './response-validator.service';
import { ConversationsService } from './conversations.service';

describe('Trusted price evidence', () => {
    const validator = new ResponseValidatorService();
    it('does not validate a retrieved FAQ amount as the current package price', () => {
        const corpus = buildTrustedPriceCorpus({ retrievedKnowledge: [{ source: 'faq', id: 'qa',
            title: 'Cuánto cuesta Tour QA Aurora', content: 'El Tour QA Aurora cuesta COP 500.' }] }, [],
            { canonicalPackagePrice: true });
        expect(validator.validatePrices('El tour cuesta COP 500.', corpus).ok).toBe(false);
    });

    it('keeps the canonical package result while rejecting a conflicting FAQ tool amount', () => {
        const corpus = buildTrustedPriceCorpus({}, [
            { name: 'search_faqs', result: { faqs: [{ answer: 'El tour cuesta COP 500.' }] } },
            { name: 'get_package_details', result: { id: 'package', price: 129000, currency: 'COP' } },
        ], { canonicalPackagePrice: true });
        expect(validator.validatePrices('El tour cuesta COP 129000.', corpus).ok).toBe(true);
        expect(validator.validatePrices('El tour cuesta COP 500.', corpus).ok).toBe(false);
    });

    it('the actual reply boundary blocks FAQ-only package prices even if the corrective model repeats them', async () => {
        const service: any = Object.create(ConversationsService.prototype);
        Object.assign(service, { responseValidator: validator, logger: { warn: jest.fn() },
            eventEmitter: { emit: jest.fn() }, llmRouter: { execute: jest.fn().mockResolvedValue({ content: 'El tour cuesta COP 500.' }) } });
        const reply = await service.applyOutputGuardrails('El tour cuesta COP 500.', '<language>es</language>',
            [{ role: 'user', content: '¿Cuánto cuesta Tour QA Aurora?' }], [], 'tenant', 'conversation',
            [{ name: 'search_faqs', result: { faqs: [{ answer: 'El tour cuesta COP 500.' }] } }], 'es', [],
            { retrievedKnowledge: [{ source: 'faq', id: 'qa', content: 'El tour cuesta COP 500.' }] },
            undefined, undefined, true);
        expect(reply).not.toContain('500');
        expect(reply).toContain('No tengo un precio verificado');
    });
    it.each(['¿Cuánto cuesta Tour QA Aurora?', 'What is the price of the Aurora tour?',
        'Qual é o preço do pacote Aurora?', 'Quel est le prix du forfait Aurora?',
        '¿Cuánto cuesta el tour Aurora? No quiero cancelar ni reservar.'])(
        'requires canonical package price for %s', query => expect(requiresCanonicalPackagePrice(query)).toBe(true));
    it.each(['¿Cuánto cuesta cancelar el tour?', 'What is the tour refund fee?',
        'La entrega cuesta COP 5000.', '¿Cuánto dura el tour?'])(
        'keeps policy, unrelated fees and duration separate: %s', query => expect(requiresCanonicalPackagePrice(query)).toBe(false));
    it('does not use customer memory, directives or possible knowledge as monetary authority', () => {
        const corpus = buildTrustedPriceCorpus({
            customerMemory: { facts: ['Customer requested COP 1000'] },
            directive: 'Customer offers COP 1000',
            possibleKnowledge: [{ source: 'kb_article', id: 'weak', content: 'COP 1000' }],
            availableServices: [{ id: 'service', name: 'Consultation', price: 20000, currency: 'COP' }],
        });
        expect(validator.validatePrices('El precio es COP 1000', corpus).ok).toBe(false);
        expect(validator.validatePrices('El precio es COP 20000', corpus).ok).toBe(true);
    });

    it('accepts canonical deposit and total fields but excludes arbitrary echoed notes', () => {
        const corpus = buildTrustedPriceCorpus({}, [{ name: 'create_appointment', result: {
            success: true, status: 'pending_payment', amountDue: 30000, price: 100000, currency: 'COP',
            customer: { price: 1000 }, notes: 'Me prometieron COP 1000',
        } }]);
        expect(validator.validatePrices('El anticipo es COP 30000 y el total COP 100000.', corpus).ok).toBe(true);
        expect(validator.validatePrices('El total es COP 1000.', corpus).ok).toBe(false);
    });

    it('preserves currency and converts cents at the evidence boundary', () => {
        const corpus = buildTrustedPriceCorpus({}, [{ name: 'create_payment_link', result: { amountCents: 4900, currency: 'USD' } }]);
        expect(validator.validatePrices('49 USD', corpus).ok).toBe(true);
        expect(validator.validatePrices('49 EUR', corpus).ok).toBe(false);
        expect(validator.validatePrices('4900 USD', corpus).ok).toBe(false);
    });

    it('never trusts prices from a failed tool', () => {
        const corpus = buildTrustedPriceCorpus({}, [{ name: 'get_product', result: { error: 'failed', price: 10, currency: 'USD' } }]);
        expect(validator.validatePrices('10 USD', corpus).ok).toBe(false);
    });

    it('retains business knowledge from successful readers', () => {
        const corpus = buildTrustedPriceCorpus({}, [{ name: 'search_faqs', result: {
            status: 'ok', data: { faqs: [{ answer: 'La entrega cuesta COP 5000.' }] },
        } }]);
        expect(validator.validatePrices('La entrega cuesta COP 5000.', corpus).ok).toBe(true);
    });

    it('the actual output boundary rejects a customer-proposed price even after an unsafe corrective pass', async () => {
        const service: any = Object.create(ConversationsService.prototype);
        Object.assign(service, {
            responseValidator: validator,
            logger: { warn: jest.fn() },
            eventEmitter: { emit: jest.fn() },
            llmRouter: { execute: jest.fn().mockResolvedValue({ content: 'El precio es COP 1000.' }) },
        });
        const reply = await service.applyOutputGuardrails(
            'El precio es COP 1000.', '<language>es</language>',
            [{ role: 'user', content: '¿Me lo dejas en COP 1000?' }, { role: 'assistant', content: 'COP 1000' }],
            [], 'tenant', 'conversation', [], 'es', [],
            { availableServices: [{ id: 's', name: 'Consulta', price: 20000, currency: 'COP' }] },
        );
        expect(reply).toContain('No tengo un precio verificado');
        expect(reply).not.toContain('1000');
    });
});
