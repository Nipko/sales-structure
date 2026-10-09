/**
 * The persona greeting is written once, at onboarding, in the register of the template («Soy Luna, tu asistente de belleza. ¿Te
 * gustaría agendar?»). The model repeats it almost word for word on the first message, so a tenant that addresses its customers as
 * «usted» was greeting them with «tú». The prompt says «keep ONE register» and the model copies the example instead.
 *
 * `toUsted` rewrites a SHORT, owner-written text (a greeting, a fallback line) from tuteo to usted with a closed set of forms. It is
 * not a translator: anything it does not recognise is left as written, which is the safe direction. In particular it never touches
 *   - the names it is told to protect (the business and the persona: «Tu Look», «Tus Uñas Spa», «Contraparte»);
 *   - a capitalised word in the middle of a sentence (a name: «Bienvenido a Tu Look»);
 *   - a noun that merely ends like an infinitive + «te» (parte, corte, Baluarte): the «-arte / -erte / -irte» rule is a closed list.
 */

const IMPERATIVES: Record<string, string> = {
    cuéntame: 'cuénteme', cuéntanos: 'cuéntenos', dime: 'dígame', dinos: 'díganos', avísame: 'avíseme', escríbeme: 'escríbame',
    pregúntame: 'pregúnteme', háblame: 'hábleme', indícame: 'indíqueme', ayúdame: 'ayúdeme', mándame: 'mándeme',
    escríbenos: 'escríbanos', pregúntanos: 'pregúntenos', llámanos: 'llámenos', visítanos: 'visítenos',
};

const VERBS: Record<string, string> = {
    puedes: 'puede', quieres: 'quiere', necesitas: 'necesita', buscas: 'busca', estás: 'está', tienes: 'tiene', prefieres: 'prefiere',
    deseas: 'desea', haces: 'hace', vas: 'va', sabes: 'sabe', piensas: 'piensa', hablas: 'habla', usas: 'usa', requieres: 'requiere',
    eres: 'es', andas: 'anda', pides: 'pide', dices: 'dice', conoces: 'conoce', gustas: 'gusta', trabajas: 'trabaja', decides: 'decide',
};

/** Infinitives of a greeting that take «te»: «ayudarte» → «ayudarle». A closed list: «parte», «corte», «Baluarte» are nouns. */
const ENCLITIC_INFINITIVES = [
    'ayudar', 'atender', 'asesorar', 'acompañar', 'orientar', 'guiar', 'contactar', 'informar', 'recomendar', 'presentar', 'mostrar',
    'ofrecer', 'servir', 'escuchar', 'conocer', 'saludar', 'esperar', 'cuidar', 'agendar', 'responder', 'buscar', 'llamar', 'escribir',
    'enseñar', 'reservar', 'mantener', 'entender', 'apoyar', 'resolver', 'contar', 'preguntar', 'avisar', 'confirmar', 'enviar',
    'mandar', 'compartir', 'facilitar', 'aconsejar', 'sugerir', 'proponer', 'ver', 'dar', 'decir', 'hacer', 'tener',
];

const matchCase = (source: string, replacement: string): string =>
    source[0] !== source[0].toLowerCase() ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;

/** Is the word at `index` the first of a sentence (start of the text, or after . ! ? : or a line break, ignoring quotes and emoji)? */
function startsSentence(text: string, index: number): boolean {
    const before = text.slice(0, index).replace(/[\s"'«(¡¿*_~\-–—]+$/u, '');
    // An emoji closes the clause before it («… Spa 💅 Dime qué necesitas»).
    return before === '' || /[.!?:\n]$/.test(before) || /\p{Extended_Pictographic}️?$/u.test(before);
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MARK = '';

export function toUsted(text: string, protectedNames: readonly string[] = []): string {
    if (!text) return text;
    // The business and the persona keep their names whatever they look like.
    const names = [...new Set(protectedNames.map(name => String(name ?? '').trim()).filter(name => name.length >= 2))].sort((a, b) => b.length - a.length);
    const parked: string[] = [];
    let out = text;
    if (names.length) {
        out = out.replace(new RegExp(names.map(escapeRegExp).join('|'), 'giu'), span => `${MARK}${parked.push(span) - 1}${MARK}`);
    }
    // A word is rewritten when it is lower case, or when it is capitalised because it opens a sentence. A capitalised word in the
    // middle of a sentence is a name («Bienvenido a Tu Look»).
    const swap = (re: RegExp, replacement: (match: string) => string | null) => {
        out = out.replace(re, (match: string, ...rest: any[]) => {
            const offset = rest[rest.length - 2] as number;
            const whole = rest[rest.length - 1] as string;
            if (match[0] !== match[0].toLowerCase() && !startsSentence(whole, offset)) return match;
            return replacement(match) ?? match;
        });
    };
    const L = '\\p{L}';
    swap(/(?<![\p{L}])tú(?![\p{L}])/giu, match => matchCase(match, 'usted'));
    swap(/(?<![\p{L}])contigo(?![\p{L}])/giu, match => matchCase(match, 'con usted'));
    swap(/(?<![\p{L}])tus?(?![\p{L}])/giu, match => matchCase(match, match.toLowerCase().endsWith('s') ? 'sus' : 'su'));
    swap(new RegExp(`(?<![${L}])(?:${Object.keys(IMPERATIVES).join('|')})(?![${L}])`, 'giu'), match => (IMPERATIVES[match.toLowerCase()] ? matchCase(match, IMPERATIVES[match.toLowerCase()]) : null));
    swap(new RegExp(`(?<![${L}])(?:${Object.keys(VERBS).join('|')})(?![${L}])`, 'giu'), match => (VERBS[match.toLowerCase()] ? matchCase(match, VERBS[match.toLowerCase()]) : null));
    swap(new RegExp(`(?<![${L}])(?:${ENCLITIC_INFINITIVES.join('|')})te(?![${L}])`, 'giu'), match => matchCase(match, `${match.slice(0, -2)}le`));
    swap(/(?<![\p{L}])te(?![\p{L}])/giu, match => matchCase(match, 'le'));
    if (parked.length) out = out.replace(new RegExp(`${MARK}(\\d+)${MARK}`, 'g'), (_m, index: string) => parked[Number(index)]);
    return out;
}
