import {
    buildOperationClassifierRequest,
    buildOperationShadowTrace,
    OPERATION_CONFIDENCE_THRESHOLD,
    OperationClassifierService,
    parseOperationClassifierOutput,
    type OperationShadowVerdict,
} from './operation-classifier.service';
import { operationsForPublishedTools } from '@parallext/shared';

const REAL_ESTATE = ['search_faqs', 'search_listings', 'get_listing_details', 'send_listing_image'];
const HOTEL = ['search_faqs', 'list_properties', 'get_property_details', 'check_property_availability', 'create_property_booking'];
const RESTAURANT = ['search_faqs', 'get_menu', 'get_promotions', 'place_order', 'list_my_orders', 'check_order_status'];
const STORE = ['search_faqs', 'search_products', 'get_product', 'check_stock'];

const reply = (content: string, model = 'gpt-4o-mini') => ({ content, routingDecision: { selectedModel: { id: model } } });

describe('parseOperationClassifierOutput', () => {
    const candidates = ['listing_info', 'find_listing', 'ask_question'];

    it('accepts a candidate with enough confidence', () => {
        expect(parseOperationClassifierOutput('{"operationKey":"listing_info","confidence":0.92}', candidates))
            .toEqual({ operationKey: 'listing_info', confidence: 0.92, fallback: null });
    });

    it('tolerates code fences, surrounding prose, extra keys and a numeric string', () => {
        expect(parseOperationClassifierOutput('Sure:\n```json\n{"operationKey":"find_listing","confidence":"0.8","reason":"x"}\n```', candidates))
            .toEqual({ operationKey: 'find_listing', confidence: 0.8, fallback: null });
    });

    it.each([
        ['not json', 'no braces here'],
        ['broken json', '{"operationKey": "listing_info", '],
        ['missing confidence', '{"operationKey":"listing_info"}'],
        ['confidence out of range', '{"operationKey":"listing_info","confidence":7}'],
        ['empty key', '{"operationKey":"","confidence":0.9}'],
        ['a non-numeric confidence', '{"operationKey":"listing_info","confidence":"high"}'],
    ])('%s is invalid_output, never an exception', (_label, raw) => {
        expect(parseOperationClassifierOutput(raw, candidates)).toEqual({ operationKey: 'none', confidence: 0, fallback: 'invalid_output' });
    });

    it('non-string content is invalid_output', () => {
        expect(parseOperationClassifierOutput(undefined, candidates).fallback).toBe('invalid_output');
        expect(parseOperationClassifierOutput({ operationKey: 'listing_info' }, candidates).fallback).toBe('invalid_output');
    });

    it('an operation this business does not publish is unknown_operation', () => {
        expect(parseOperationClassifierOutput('{"operationKey":"menu_info","confidence":0.99}', candidates))
            .toEqual({ operationKey: 'menu_info', confidence: 0.99, fallback: 'unknown_operation' });
    });

    it('none and low confidence are fallbacks that keep the label for the error analysis', () => {
        expect(parseOperationClassifierOutput('{"operationKey":"none","confidence":0.9}', candidates).fallback).toBe('none');
        const low = parseOperationClassifierOutput(`{"operationKey":"listing_info","confidence":${OPERATION_CONFIDENCE_THRESHOLD - 0.01}}`, candidates);
        expect(low).toMatchObject({ operationKey: 'listing_info', fallback: 'low_confidence' });
    });
});

describe('buildOperationClassifierRequest', () => {
    it('is a cheap strict-JSON classify call over the turn\'s own operations only', () => {
        const candidates = operationsForPublishedTools(REAL_ESTATE);
        const request = buildOperationClassifierRequest(candidates, 'How much is the apartment you have for sale?', 'We have one apartment for sale in Chapinero.');
        expect(request).toMatchObject({ task: 'classify', temperature: 0, jsonMode: true });
        expect(request.maxTokens).toBeLessThanOrEqual(200);
        expect(request.systemPrompt).toContain('- listing_info:');
        expect(request.systemPrompt).toContain('- none:');
        expect(request.systemPrompt).not.toContain('menu_info');
        expect(request.systemPrompt).not.toContain('property_info');
        expect(request.messages[0].content).toContain('Previous business reply');
        expect(request.messages[0].content).toContain('How much is the apartment');
    });

    it('offers each QA vertical the operation its price question needed', () => {
        const keys = (tools: string[]) => operationsForPublishedTools(tools).map(op => op.key);
        expect(keys(REAL_ESTATE)).toContain('listing_info');
        expect(keys(HOTEL)).toEqual(expect.arrayContaining(['property_info', 'book_stay']));
        expect(keys(RESTAURANT)).toEqual(expect.arrayContaining(['menu_info', 'check_my_orders', 'track_food_order', 'place_food_order']));
        expect(keys(STORE)).toEqual(expect.arrayContaining(['product_info', 'browse_catalog']));
    });
});

describe('OperationClassifierService.classify', () => {
    const service = new OperationClassifierService();

    it('returns the validated verdict with the model that produced it', async () => {
        const complete = jest.fn().mockResolvedValue(reply('{"operationKey":"property_info","confidence":0.88}'));
        const verdict = await service.classify({ text: 'quel est le prix de la nuit ?', publishedTools: HOTEL }, { complete });
        expect(verdict).toMatchObject({ operationKey: 'property_info', confidence: 0.88, fallback: null, model: 'gpt-4o-mini' });
        expect(verdict.candidates).toContain('property_info');
        expect(complete).toHaveBeenCalledTimes(1);
        expect(complete.mock.calls[0][0].task).toBe('classify');
    });

    it('a provider error is a fallback, not an exception', async () => {
        const warn = jest.fn();
        const verdict = await service.classify({ text: 'hola', publishedTools: STORE }, { complete: jest.fn().mockRejectedValue(new Error('all providers down')), warn });
        expect(verdict).toMatchObject({ operationKey: 'none', fallback: 'error' });
        expect(warn).toHaveBeenCalled();
    });

    it('a slow classifier is cut at its timeout', async () => {
        const never = jest.fn(() => new Promise<any>(() => {}));
        const verdict = await service.classify({ text: 'hola', publishedTools: STORE }, { complete: never, timeoutMs: 10 });
        expect(verdict).toMatchObject({ operationKey: 'none', fallback: 'timeout' });
    });

    it('garbage output is invalid_output', async () => {
        const verdict = await service.classify({ text: 'hola', publishedTools: STORE }, { complete: jest.fn().mockResolvedValue(reply('I think it is a product question')) });
        expect(verdict.fallback).toBe('invalid_output');
    });

    it('without any catalogue operation published it does not call the model', async () => {
        const complete = jest.fn();
        const verdict = await service.classify({ text: 'hola', publishedTools: ['handoff_to_human'] }, { complete });
        expect(verdict.fallback).toBe('no_candidates');
        expect(complete).not.toHaveBeenCalled();
    });
});

describe('buildOperationShadowTrace', () => {
    const verdict = (operationKey: string, fallback: OperationShadowVerdict['fallback'] = null): OperationShadowVerdict => ({
        version: 1, operationKey, confidence: 0.9, fallback, candidates: [operationKey], latencyMs: 12, model: 'gpt-4o-mini',
    });

    it('records the QA gap: a listing price question where only the automatic FAQ ran', () => {
        const trace = buildOperationShadowTrace(verdict('listing_info'), {
            calledTools: [], autoReadTools: ['search_faqs'], projectedContexts: [], publishedTools: REAL_ESTATE, domainCues: ['listings'],
        });
        expect(trace).toMatchObject({
            operationKey: 'listing_info',
            requiredReads: [
                { tool: 'search_listings', status: 'missing', projection: 'planned' },
                { tool: 'get_listing_details', status: 'missing', projection: 'planned' },
            ],
            requiredReadsSatisfied: false,
            // The PR5 gap: a deterministic listing projection would have covered it.
            missingProjectable: true,
            domainCues: ['listings'],
        });
        expect(trace.factKinds).toEqual(expect.arrayContaining(['price', 'area']));
    });

    it('a read the model called, or the runtime read, satisfies the operation', () => {
        const trace = buildOperationShadowTrace(verdict('track_food_order'), {
            calledTools: ['check_order_status'], autoReadTools: ['list_my_orders'], projectedContexts: [], publishedTools: RESTAURANT,
        });
        expect(trace.requiredReads).toEqual([{ tool: 'list_my_orders', status: 'auto' }, { tool: 'check_order_status', status: 'called' }]);
        expect(trace.requiredReadsSatisfied).toBe(true);
    });

    it('a named product projected into the turn catalogue counts as read', () => {
        const trace = buildOperationShadowTrace(verdict('product_info'), {
            calledTools: [], autoReadTools: [], projectedContexts: ['turn_catalog'], publishedTools: STORE,
        });
        expect(trace.requiredReads).toEqual([
            { tool: 'search_products', status: 'projected', projection: 'live' },
            { tool: 'get_product', status: 'projected', projection: 'live' },
        ]);
        expect(trace.requiredReadsSatisfied).toBe(true);
        expect(trace.missingProjectable).toBe(false);
    });

    it('the salon\'s <available_services> satisfies a service price question', () => {
        const trace = buildOperationShadowTrace(verdict('service_info'), {
            calledTools: [], autoReadTools: [], projectedContexts: ['available_services'], publishedTools: ['list_services'],
        });
        expect(trace.requiredReads).toEqual([{ tool: 'list_services', status: 'projected', projection: 'live' }]);
    });

    it('a menu projection is only planned: the catalogue context alone does not satisfy it yet', () => {
        const trace = buildOperationShadowTrace(verdict('menu_info'), {
            calledTools: [], autoReadTools: [], projectedContexts: ['turn_catalog'], publishedTools: RESTAURANT,
        });
        expect(trace.requiredReads).toEqual([{ tool: 'get_menu', status: 'missing', projection: 'planned' }]);
        expect(trace.missingProjectable).toBe(true);
    });

    it('an unpublished read is told apart from a skipped one', () => {
        const trace = buildOperationShadowTrace(verdict('property_info'), {
            calledTools: [], autoReadTools: [], projectedContexts: [], publishedTools: ['list_properties'],
        });
        expect(trace.requiredReads).toEqual([
            { tool: 'list_properties', status: 'missing', projection: 'planned' },
            { tool: 'get_property_details', status: 'unpublished', projection: 'planned' },
        ]);
    });

    it('a fallback carries no required reads', () => {
        const trace = buildOperationShadowTrace(verdict('none', 'none'), { calledTools: [], autoReadTools: [], projectedContexts: [], publishedTools: STORE });
        expect(trace).toMatchObject({ operationKey: 'none', fallback: 'none', requiredReads: [], requiredReadsSatisfied: null });
    });
});
