import { readFileSync } from 'fs';
import { resolve } from 'path';
import { LanguageDetectorService } from './language-detector.service';
import { allergenHonestText } from './allergen-claim';
import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';

/**
 * After #194 (F4300-26), a celiac customer writing in Portuguese — «o prato Spark é sem glúten? sou celíaca» — got the
 * deterministic allergen text in SPANISH. The guard takes the turn language (`userLanguage`), the same one the prompt
 * and the reply-language guard use; it was «es» because the detector, with «es» stored, found no Portuguese predicate in
 * the message (a name, «Spark», keeps the current-message rule out, and «é» / «sou» / «sem» counted for nothing), and a
 * live turn read no recent customer messages. Every fixed text of applyOutputGuardrails takes that same `lang`.
 */
const MESSAGE = 'o prato Spark é sem glúten? sou celíaca';
const detector = new LanguageDetectorService();

describe('the turn language of the production message', () => {
    it.each([['es'], ['en'], [null]])('is Portuguese whatever the stored language (%s)', stored => {
        expect(detector.detect(MESSAGE, stored || 'es-CO', stored)).toBe('pt');
    });

    it('the Spanish and English versions keep theirs', () => {
        expect(detector.detect('el plato Spark es sin gluten? soy celíaca', 'es', 'es')).toBe('es');
        expect(detector.detect("is the Spark dish gluten free? I'm celiac", 'es', 'es')).toBe('en');
    });

    it('a stored language that lagged gives way to the recent Portuguese messages (the evidence a live turn now loads)', () => {
        expect(detector.detect('Spark QA Plato?', 'es', 'es', { recentCustomerMessages: ['vocês têm opções sem glúten?'] })).toBe('pt');
    });
});

describe('F4300-26 follow-up: the fixed allergen text is in the customer language', () => {
    const SPARK = { id: '11111111-1111-4111-8111-111111111111', name: 'Spark QA Plato', price: 13500, currency: 'COP', tags: [], allergens: 'not_informed' };
    const answer = (content: string, toolCalls?: any[]) => ({ content, ...(toolCalls ? { toolCalls } : {}), model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 });

    function restaurant(reply: string) {
        const f = agentTurnFixture();
        f.personaService.getAgent.mockResolvedValue({ version: 5, config_json: { language: 'es', industry: 'restaurantes', rag: { enabled: false }, llm: {} } });
        publishTools(f, ['get_menu', 'place_order', 'search_faqs']);
        f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) => (name === 'search_faqs' ? { faqs: [] } : { count: 1, items: [SPARK] }));
        f.llmRouter.execute.mockImplementation(async (request: any) => {
            if (!['conversation', 'tool_calling'].includes(request.task)) return answer('{}');
            const read = (request.messages ?? []).some((m: any) => m?.role === 'tool' && String(m.content).includes('Spark QA Plato'));
            if ((request.tools?.length ?? 0) > 0 && !read) return answer('', [{ id: 'call-menu', function: { name: 'get_menu', arguments: '{}' } }]);
            return answer(reply);
        });
        let id: string | undefined;
        const turn = async (message: string) => {
            const result = await f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message, channelType: 'telegram', runtimeSessionId: id }, { agentSnapshot: undefined });
            id = result.debug.runtimeSessionId;
            return result;
        };
        const storeLanguage = (language: string) => { (f.service as any).sessions.sessions.get(id).session.metadata.detectedLanguage = language; };
        return { turn, storeLanguage };
    }

    it('regression: «o prato Spark é sem glúten? sou celíaca» in a conversation stored as Spanish gets the Portuguese text', async () => {
        const h = restaurant('Sim, o prato Spark é sem glúten, então você pode pedir com tranquilidade.');
        await h.turn('hola');
        h.storeLanguage('es');
        const r = await h.turn(MESSAGE);
        expect(r.debug.runtimeError).toBeUndefined();
        expect(r.reply).not.toMatch(/é sem glúten, então/);
        expect(r.reply).toContain(allergenHonestText('not_informed', 'pt', false).split('.')[0]);
        expect(r.reply).not.toMatch(/El negocio no ha registrado/);
    });

    it('every fixed replacement of applyOutputGuardrails reads the one turn language it is given', () => {
        const src = readFileSync(resolve(__dirname, 'conversations.service.ts'), 'utf8');
        const start = src.indexOf('private async applyOutputGuardrails(');
        const body = src.slice(start, src.indexOf('\n    private ', start + 10));
        // No replacement re-detects or reads the tenant/conversation language on its own.
        expect(body).not.toMatch(/languageDetector|config\.language|detectedLanguage/);
        expect(body).toContain('lang, canOfferPerson: humanOfferAvailable');
        // The live turn reads recent customer messages when the message alone disagrees with the stored language.
        expect(src).toContain('languageContext.recentCustomerMessages = await this.recentCustomerTexts(schemaName, conversation.id, inboundMessageId);');
        expect(src).toContain('const recentCustomerMessages = await this.recentCustomerTexts(schemaName, conversation?.id, inboundMessageId);');
    });
});
