import { ConversationsService } from './conversations.service';
import { catalogNamesOfTurn, languageMismatch, ownLanguageText, replyLanguageOf, rewritePreserves } from './reply-language';
import { BY_LANGUAGE, CATALOG_NAMES, ES, PT } from './__fixtures__/reply-language-corpus';

/**
 * The reply-language guard must be quiet on correct replies and loud on wrong-language ones. Measured on a corpus
 * of realistic replies per language (formal Spanish «le», English product names, URLs, prices included): an
 * earlier word list fired on ~20% of normal Spanish replies and a rewrite could translate product names.
 */
const LANGS = ['es', 'pt', 'en', 'fr'] as const;

describe('reply-language guard on a corpus of correct replies', () => {
    it('has at least 40 replies per language, all long enough for the guard (8+ words)', () => {
        for (const lang of LANGS) {
            expect(BY_LANGUAGE[lang].length).toBeGreaterThanOrEqual(40);
            for (const reply of BY_LANGUAGE[lang]) expect([reply, reply.trim().split(/\s+/).length >= 8]).toEqual([reply, true]);
        }
    });

    it.each(LANGS)('fires on 0 of the correct %s replies (catalog names known to the turn)', lang => {
        const fired = BY_LANGUAGE[lang].filter(reply => languageMismatch(reply, lang, CATALOG_NAMES) !== null);
        expect(fired).toEqual([]);
    });

    it.each(LANGS)('fires on 0 of the correct %s replies even when the catalog names are NOT known', lang => {
        const fired = BY_LANGUAGE[lang].filter(reply => languageMismatch(reply, lang) !== null);
        expect(fired).toEqual([]);
    });

    it('fires on (at least 99% of) the replies written in another language, naming that language', () => {
        let total = 0;
        const missed: string[] = [];
        for (const turn of LANGS) {
            for (const written of LANGS) {
                if (written === turn) continue;
                for (const reply of BY_LANGUAGE[written]) {
                    total++;
                    if (languageMismatch(reply, turn, CATALOG_NAMES) !== written) missed.push(`${turn}<-${written}: ${reply}`);
                }
            }
        }
        const correct = LANGS.reduce((sum, lang) => sum + BY_LANGUAGE[lang].length, 0);
        const falsePositives = LANGS.reduce((sum, lang) => sum + BY_LANGUAGE[lang].filter(r => languageMismatch(r, lang, CATALOG_NAMES) !== null).length, 0);
        process.stdout.write(`[reply-language] correct replies: ${correct}, false positives: ${falsePositives} (${(100 * falsePositives / correct).toFixed(1)}%); `
            + `wrong-language replies: ${total}, caught: ${total - missed.length} (${(100 * (total - missed.length) / total).toFixed(1)}%)\n`);
        // A miss only means no rewrite (the status quo); the bar is high on purpose. At most 1% of the wrong-language replies slip through.
        expect(missed.length / total).toBeLessThanOrEqual(0.01);
    });
});

describe('weak evidence leaves the language undecided', () => {
    it.each([
        'Claro, reembolso sera rapido, dias habiles despues de aprobado',
        'Le informo que la tienda queda en el centro comercial, local 215, segundo piso.',
    ])('%s', text => {
        expect(replyLanguageOf(text, [])).toBeNull();
    });
});

describe('what is not the reply\'s own language is ignored', () => {
    it('English product names, URLs, e-mails and quoted text do not count', () => {
        const text = 'Le recomiendo el Case for iPhone 15 with MagSafe, vea https://shop.example.com/the-best-case-for-the-gym o escriba a help@the-store.com sobre "Noise Cancelling with ANC".';
        expect(ownLanguageText(text, ['Case for iPhone 15 with MagSafe'])).not.toMatch(/MagSafe|https|help@|Noise/);
        expect(replyLanguageOf(text, ['Case for iPhone 15 with MagSafe'])).not.toBe('en');
    });

    it('the formal "le" is Spanish, not French', () => {
        for (const reply of ES.filter(r => /\ble\b/i.test(r))) expect(replyLanguageOf(reply, CATALOG_NAMES)).not.toBe('fr');
    });

    it('catalogNamesOfTurn reads names from the turn context and from tool results', () => {
        const names = catalogNamesOfTurn(
            { catalog: [{ title: 'Smart Watch Series 9' }], availableServices: [{ name: 'Corte y estilo' }], bookingState: { service: { name: 'Color y tratamiento' } } },
            [{ name: 'get_product', result: { id: 'x', name: 'Wireless Charger Stand 15W', nested: [{ title: 'Case for iPhone 15 with MagSafe' }] } }],
        );
        expect(names).toEqual(expect.arrayContaining(['Smart Watch Series 9', 'Corte y estilo', 'Color y tratamiento', 'Wireless Charger Stand 15W', 'Case for iPhone 15 with MagSafe']));
    });
});

describe('rewritePreserves: a translation may not change what the reply says', () => {
    const original = 'Le recomiendo el Case for iPhone 15 with MagSafe: cuesta $89.900 COP y puede verlo en https://tienda.ejemplo.com/p/case-15, entrega el 12/10 a las 16:00.';
    const names = ['Case for iPhone 15 with MagSafe'];

    it('accepts a rewrite with the same names, figures and URLs', () => {
        expect(rewritePreserves(original, 'Recomendo o Case for iPhone 15 with MagSafe: custa $89.900 COP e pode vê-lo em https://tienda.ejemplo.com/p/case-15, entrega em 12/10 às 16:00.', names)).toBe(true);
    });
    it.each([
        ['a translated product name', 'Recomendo a Capa para iPhone 15 com MagSafe: custa $89.900 COP e pode vê-la em https://tienda.ejemplo.com/p/case-15, entrega em 12/10 às 16:00.'],
        ['a changed price', 'Recomendo o Case for iPhone 15 with MagSafe: custa $98.900 COP e pode vê-lo em https://tienda.ejemplo.com/p/case-15, entrega em 12/10 às 16:00.'],
        ['a lost URL', 'Recomendo o Case for iPhone 15 with MagSafe: custa $89.900 COP, entrega em 12/10 às 16:00.'],
        ['a changed hour', 'Recomendo o Case for iPhone 15 with MagSafe: custa $89.900 COP e pode vê-lo em https://tienda.ejemplo.com/p/case-15, entrega em 12/10 às 17:00.'],
    ])('rejects %s', (_label, rewrite) => {
        expect(rewritePreserves(original, rewrite, names)).toBe(false);
    });
});

describe('applyOutputGuardrails with the corpus', () => {
    const build = (rewrite: string) => {
        const service: any = Object.create(ConversationsService.prototype);
        const execute = jest.fn(async () => ({ content: rewrite }));
        Object.assign(service, {
            logger: { warn: jest.fn() }, eventEmitter: { emit: jest.fn() },
            responseValidator: { validatePrices: jest.fn(() => ({ ok: true, hallucinatedPrices: [] })) },
            recordAgentSignal: jest.fn(), llmRouter: { execute },
        });
        return { service, execute };
    };
    /** Calls whose last message asks for the language rewrite (other guardrails may call the model for other reasons). */
    const rewriteCalls = (execute: jest.Mock) => (execute.mock.calls as any[][]).filter(call => /Rewrite it in|Reescríbela en|Reescreva-a em|Réécrivez-la en/.test(String(call[0]?.messages?.slice(-1)[0]?.content ?? '')));
    const run = (service: any, text: string, lang: string, context: any = {}, tools: any[] = []) =>
        service.applyOutputGuardrails(text, 'sys', [], [], 'tenant', 'conv', tools, lang, [], context);

    it('never calls the model for a correct reply of the turn language', async () => {
        const { service, execute } = build('x');
        for (const lang of LANGS) {
            for (const reply of BY_LANGUAGE[lang]) {
                await run(service, reply, lang, { catalog: CATALOG_NAMES.map(title => ({ id: title, title })) });
            }
        }
        expect(rewriteCalls(execute)).toHaveLength(0);
    });

    it('keeps the original when the rewrite translates a catalog product name', async () => {
        const original = PT[0];
        const { service, execute } = build('Con gusto. La Funda para iPhone 15 con MagSafe cuesta R$ 89,90 y tenemos unidades disponibles en stock.');
        expect(await run(service, original, 'es', { catalog: [{ id: '1', title: 'Case for iPhone 15 with MagSafe' }] })).toBe(original);
        expect(rewriteCalls(execute)).toHaveLength(1);
    });

    it('accepts a rewrite that keeps every name, figure and URL', async () => {
        const original = 'Com prazer. O Case for iPhone 15 with MagSafe custa R$ 89,90 e temos unidades disponíveis em estoque.';
        const rewrite = 'Con gusto. El Case for iPhone 15 with MagSafe cuesta R$ 89,90 y tenemos unidades disponibles en stock.';
        const { service } = build(rewrite);
        expect(await run(service, original, 'es', { catalog: [{ id: '1', title: 'Case for iPhone 15 with MagSafe' }] })).toBe(rewrite);
    });
});
