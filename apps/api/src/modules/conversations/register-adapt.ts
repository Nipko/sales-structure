/**
 * The persona greeting is written once, at onboarding, in the register of the template («Soy Luna, tu asistente de belleza. ¿Te
 * gustaría agendar?»). The model repeats it almost word for word on the first message, so a tenant that addresses its customers as
 * «usted» was greeting them with «tú». The prompt says «keep ONE register» and the model copies the example instead.
 *
 * `toUsted` rewrites a SHORT, owner-written text (a greeting, a fallback line) from tuteo to usted with a closed set of forms. It is
 * not a translator: anything it does not recognise is left as written, which is the safe direction.
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

const matchCase = (source: string, replacement: string): string =>
    source[0] !== source[0].toLowerCase() ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;

export function toUsted(text: string): string {
    if (!text) return text;
    const L = '\\p{L}';
    let out = text;
    // «tú» (pronoun) → «usted»; «contigo» → «con usted».
    out = out.replace(/(?<![\p{L}])[Tt]ú(?![\p{L}])/gu, match => matchCase(match, 'usted'));
    out = out.replace(/(?<![\p{L}])[Cc]ontigo(?![\p{L}])/gu, match => matchCase(match, 'con usted'));
    // «tu / tus» (possessive, no accent) → «su / sus»; «ti» is left alone.
    out = out.replace(/(?<![\p{L}])([Tt])us?(?![\p{L}])/gu, (match, initial: string) => `${initial === 'T' ? 'S' : 's'}u${match.endsWith('s') ? 's' : ''}`);
    // Imperatives with and without the enclitic «me / nos».
    out = out.replace(new RegExp(`(?<![${L}])(${Object.keys(IMPERATIVES).join('|')})(?![${L}])`, 'giu'),
        match => matchCase(match, IMPERATIVES[match.toLowerCase()] ?? match));
    // Second-person verbs → third person.
    out = out.replace(new RegExp(`(?<![${L}])(${Object.keys(VERBS).join('|')})(?![${L}])`, 'giu'),
        match => matchCase(match, VERBS[match.toLowerCase()] ?? match));
    // Infinitive + «te» («ayudarte», «verte», «contactarte») → «ayudarle»; a noun like «parte» or «corte» has fewer than three letters before.
    out = out.replace(/(?<![\p{L}])(\p{L}{3,}(?:ar|er|ir))te(?![\p{L}])/gu, (_m, stem: string) => `${stem}le`);
    // «te» (pronoun, no accent) → «le»: «¿Te gustaría…?», «te cuento», «te ayudo».
    out = out.replace(/(?<![\p{L}])([Tt])e(?![\p{L}])/gu, (_m, initial: string) => (initial === 'T' ? 'Le' : 'le'));
    return out;
}
