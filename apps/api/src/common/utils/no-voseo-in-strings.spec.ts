import { readdirSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';
import * as ts from 'typescript';

/**
 * The API talks to owners and to their customers in Latin-American Spanish with
 * «tú». Voseo («Actualizá tu plan», «podés», «fijate») kept coming back one
 * literal at a time — an error message here, a seeded FAQ there, a prompt that
 * nudged the model into answering «¿Querés que te agende?» — and every sweep
 * missed the next one because nothing refused it.
 *
 * This refuses it. It reads every string literal and template chunk under
 * `apps/api/src` (not comments, not specs, not `__fixtures__`) and fails on a
 * voseo form. Literals under an `en`/`pt`/`fr` key are skipped: they are not
 * Spanish, and Portuguese «analisá-lo» or French «confirmé» are not voseo.
 *
 * How a word is judged:
 *  - `VOSEO_FORMS` lists forms that are voseo on their own: the -er/-ir
 *    imperatives in «-é» (volvé, ofrecé) that a suffix rule cannot tell apart
 *    from «dejé»; the -rar imperatives (prepará, esperá) that look like a
 *    future; «sos»; and the imperative + pronoun forms in voseo spelling
 *    (decime → dime, contame → cuéntame, fijate → fíjate, configurala →
 *    configúrala).
 *  - Otherwise a word ending in stressed «-á», «-í», «-ás», «-és» or «-ís» is
 *    voseo (actualizá, elegí, cancelás, tenés, preferís) unless it is a future
 *    (podrá, enviará, verás) or listed in `NOT_VOSEO` (está, aquí, después,
 *    país, recibí…).
 *
 * If this fails on a word that is NOT voseo — a new future tense, a first-person
 * past like «recibí», a place name — add it to `NOT_VOSEO`. If it fails on text
 * that is legitimately somebody else's register — a keyword list that has to
 * recognise what an Argentine customer types, a corpus of tenant-written text —
 * add the file and the word to `ALLOWED`, with the reason. Never allow a message
 * the platform itself sends.
 */

const SRC = join(__dirname, '..', '..');

const VOSEO_FORMS = new Set([
    // «ser». Not «vos»: it is also French («vos données») and the name of an
    // address form the agent is told about (`AddressForm` 'vos').
    'sos',
    // Present tense whose tú form is not an accent away.
    'podés', 'tenés', 'querés', 'sabés', 'hacés', 'ponés', 'volvés', 'ofrecés', 'creés', 'leés',
    'podes', 'tenes', 'queres',
    // -er/-ir imperatives in -é (a suffix rule would also catch «dejé», «encontré»).
    'volvé', 'devolvé', 'ofrecé', 'traé', 'hacé', 'poné', 'tené', 'leé', 'respondé', 'escogé',
    'aprendé', 'vendé', 'resolvé', 'atendé', 'entendé', 'recogé', 'prendé', 'suspendé', 'corré',
    'protegé', 'comprendé', 'mové', 'sabé',
    // -rar imperatives and presents, which a suffix rule would read as futures.
    'prepará', 'declará', 'esperá', 'generá', 'mirá', 'compará', 'separá', 'aclará', 'operá',
    'recuperá', 'considerá', 'retirá', 'borrá', 'cerrá', 'cobrá', 'celebrá', 'ingresá',
    'preparás', 'declarás', 'esperás', 'generás', 'mirás', 'comparás', 'separás', 'operás',
    'considerás', 'cobrás', 'borrás', 'cerrás', 'recuperás',
    // Imperative + pronoun, voseo spelling.
    'fijate', 'pegalo', 'pegala', 'asegurate', 'acordate', 'contame', 'contanos', 'decime', 'decinos',
    'decile', 'decilo', 'pedile', 'pedime', 'pedilo', 'escribime', 'escribinos', 'escribile', 'escribilo',
    'revisalo', 'revisala', 'probalo', 'probala', 'conectalo', 'conectala', 'reconectalo', 'reconectala',
    'explicame', 'explicale', 'familiarizate', 'presentate', 'avisame', 'avisale', 'mandame', 'mandalo',
    'mandale', 'pasame', 'pasalo', 'pasale', 'preguntale', 'ofrecele', 'recordale', 'contale', 'hacelo',
    'ponelo', 'tenelo', 'llamame', 'llamalo', 'quedate', 'olvidate', 'animate', 'sentite', 'movete',
    'ponete', 'decímelo', 'mandámelo', 'pasámelo', 'configurala', 'configuralo', 'creala', 'crealo',
    'respondenos', 'activala', 'activalo', 'completalo', 'completala', 'agregalo', 'agregala', 'guardalo',
    'guardala', 'cargalo', 'cargala', 'actualizalo', 'actualizala', 'eliminalo', 'cambialo', 'usalo',
    'dejalo', 'confirmalo', 'confirmala', 'verificalo', 'publicalo', 'publicala', 'envialo', 'enviala',
    'intentalo', 'buscalo', 'elegilo', 'elegila', 'escribila', 'mandala',
    // Not listed on purpose: «contactanos», «avisanos», «escribenos». For an -ar
    // verb the voseo spelling is the tú one without its accent, and the stock
    // e-mails that are written without accents («anticipacion», «Proximo») use
    // them as tú.
]);

/** Words that end like voseo and are not. */
const NOT_VOSEO = new Set([
    'está', 'estás', 'estés', 'acá', 'allá', 'ahí', 'allí', 'aquí', 'así', 'sí', 'quizá', 'quizás', 'más',
    'además', 'atrás', 'detrás', 'jamás', 'demás', 'compás', 'mamá', 'papá', 'sofá', 'ojalá',
    'bogotá', 'panamá', 'canadá', 'país', 'maíz', 'raíz', 'anís', 'parís', 'luís', 'después',
    'través', 'interés', 'inglés', 'francés', 'portugués', 'holandés', 'japonés', 'cortés',
    'estrés', 'veintitrés', 'revés', 'andrés', 'tomás', 'nicolás',
    // First-person past («yo recibí»), which is also how the agent speaks.
    'recibí', 'entendí', 'asistí', 'comí', 'viví', 'leí', 'creí', 'decidí', 'respondí',
    // Portuguese greeting in a literal that is not under a `pt` key.
    'olá',
]);

/** Futures: «podrá», «enviará», «verás», «tendrá», «querrá», «sabrá», «hará», «dirá». */
function isFuture(word: string): boolean {
    return /(?:[aei]r|dr|br|rr)(?:á|ás)$/.test(word);
}

function isVoseo(token: string): boolean {
    const word = token.toLowerCase();
    if (word === 'sos' && token === 'SOS') return false;
    if (VOSEO_FORMS.has(word)) return true;
    if (NOT_VOSEO.has(word) || word.length < 3 || isFuture(word)) return false;
    return /(?:á|í|ás|és|ís)$/.test(word);
}

/** Text that is legitimately in another register, by file and word. */
const ALLOWED: Array<{ file: string; words: string[]; why: string }> = [
    {
        file: 'modules/knowledge/evaluation/retrieval-dataset.ts',
        words: ['cancelás', 'pagás', 'llevás', 'ouvrés'],
        why: 'Tenant-written knowledge chunks for the retrieval benchmark: a tenant writes in its own '
            + 'register, and rewording a chunk moves the lexical scores the benchmark is calibrated on. '
            + '«ouvrés» is French («jours ouvrés») in a chunk that is not under an `fr` key.',
    },
    {
        file: 'modules/conversations/emotion.service.ts',
        words: ['explicame'],
        why: 'Confusion keywords a CUSTOMER types, listed next to the tú spelling on purpose.',
    },
];

const LOCALE_KEYS = new Set(['en', 'pt', 'fr']);

function propertyKey(node: ts.PropertyAssignment): string | null {
    const name = node.name;
    return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
}

const WORD = /[A-Za-zÁÉÍÓÚáéíóúÑñÜü]+/g;

/** Voseo words in the Spanish string literals of one source file. */
function voseoInSource(text: string, file = 'probe.ts'): string[] {
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const hits: string[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isPropertyAssignment(node) && LOCALE_KEYS.has(propertyKey(node) ?? '')) return;
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
            || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
            for (const match of node.text.matchAll(WORD)) {
                // Portuguese enclisis («analisá-lo», «confirmá-la») is not voseo.
                if (node.text[match.index! + match[0].length] === '-') continue;
                if (isVoseo(match[0])) {
                    const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
                    hits.push(`${file}:${line} «${match[0]}»`);
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(ast);
    return hits;
}

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return entry.name === '__fixtures__' ? [] : sourceFiles(path);
        return path.endsWith('.ts') && !path.endsWith('.spec.ts') && !path.endsWith('.d.ts') ? [path] : [];
    });
}

describe('no voseo in the strings the API sends', () => {
    it('catches the forms that kept coming back, and leaves tú, futures and other languages alone', () => {
        const probe = (literal: string) => voseoInSource(`const m = ${JSON.stringify(literal)};`);
        for (const voseo of [
            'Tu plan no incluye esto. Actualizá tu plan.',
            'Actualizá tu plan o desconectá otra para conectar una nueva.',
            'Revisá los datos.', 'Si tenés dudas, escribinos.', '¿Querés que te agende?',
            'Podés ignorar este correo.', 'Elegí otro plan.', 'Volvé a intentarlo.',
            'Pegalo acá y fijate que esté completo.', 'Decime qué idioma preferís.',
            'Esperá un momento.', 'Sos un asistente.', 'Pedile al cliente el código.',
        ]) expect({ voseo, caught: probe(voseo).length > 0 }).toEqual({ voseo, caught: true });
        expect(probe('Actualizá tu plan.')).toHaveLength(1);
        expect(probe('Si tenés dudas, escribinos.')).toHaveLength(2);
        expect(probe('Pegalo acá y fijate que esté completo.')).toHaveLength(2);
        expect(probe('Decime qué idioma preferís.')).toHaveLength(2);
        expect(probe('Esperá un momento.')).toHaveLength(1);
        expect(probe('Sos un asistente.')).toHaveLength(1);

        for (const tu of [
            'Tu plan no incluye esto. Actualiza tu plan.', 'Revisa los datos.', 'Si tienes dudas, escríbenos.',
            '¿Quieres que te agende?', 'Puedes ignorar este correo.', 'Pégalo aquí y fíjate que esté completo.',
            'Dime qué idioma prefieres.', 'Espera un momento.', 'Eres un asistente.',
            'El equipo te contactará y podrá confirmarlo. Verás el cambio después.',
            'Recibí tu mensaje, pero no entendí la foto. Así está en el país.', 'Código SOS enviado.',
        ]) expect({ tu, hits: probe(tu) }).toEqual({ tu, hits: [] });

        // Other languages are skipped by key, and Portuguese enclisis by the hyphen.
        expect(voseoInSource(`const m = { es: 'Revisa', pt: 'Olá, já está', fr: 'Été confirmé' };`)).toEqual([]);
        expect(voseoInSource(`const m = { pt: { nested: 'Actualizá' } };`)).toEqual([]);
        expect(voseoInSource(`const m = 'Não consegui analisá-la agora.';`)).toEqual([]);
        // Comments are not strings.
        expect(voseoInSource(`// Actualizá tu plan\nconst m = 'Actualiza tu plan';`)).toEqual([]);
        // Template literals are read chunk by chunk.
        expect(voseoInSource('const m = `Tu plan ${plan} permite ${max}. Actualizá tu plan.`;')).toHaveLength(1);
    });

    it('finds none in apps/api/src', () => {
        const allowed = new Map(ALLOWED.map(entry => [entry.file, new Set(entry.words)]));
        const hits: string[] = [];
        for (const path of sourceFiles(SRC)) {
            const file = relative(SRC, path).split(sep).join('/');
            const words = allowed.get(file);
            for (const hit of voseoInSource(readFileSync(path, 'utf8'), file)) {
                const word = /«(.+)»$/.exec(hit)![1].toLowerCase();
                if (!words?.has(word)) hits.push(hit);
            }
        }
        expect(hits).toEqual([]);
    });

    it('keeps every allowance earning its place', () => {
        // An allowance whose word is gone would silently allow the next one.
        for (const entry of ALLOWED) {
            const found = voseoInSource(readFileSync(join(SRC, entry.file), 'utf8'), entry.file)
                .map(hit => /«(.+)»$/.exec(hit)![1].toLowerCase());
            for (const word of entry.words) expect({ file: entry.file, word, present: found.includes(word) })
                .toEqual({ file: entry.file, word, present: true });
        }
    });
});
