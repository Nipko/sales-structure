import { normalizeForIntent } from '@parallext/shared';
import { foldKeepingPunctuation } from '../conversations/appointment-transition';

/**
 * Whether a business-configured handoff keyword («alergia», «alérgico», «queja alimentaria») is MENTIONED
 * in a customer message as something the customer affirms, or only denied.
 *
 * Production QA 24-oct (F4300-30): the agent itself asked «¿quiere confirmar que no tiene alergias
 * alimentarias?», the customer answered «No tengo alergias, solo que esté bien cocido.» and the turn went
 * to a person as `custom_trigger:alergia`. A trigger is a topic the owner wants a person for when the
 * customer HAS it; a denial of it is the opposite. The matching itself is unchanged (folded substring):
 * this only decides that a present keyword is denied, in es/en/pt/fr:
 *  - a negator in the few words before it, in the same clause: «no tengo alergias», «sin alergias»,
 *    «ninguna alergia», «nada de alergias», «I don't have any allergies», «não sou alérgico»,
 *    «pas d'allergie», «je ne suis pas allergique», «aucune allergie»;
 *  - a negator right after it, when nothing affirms it: «alergias no», «allergies: none»;
 *  - when the agent's previous message asked about the topic, an answer that opens with a bare «no»
 *    and only echoes the word («No, alergias.»).
 * An affirmed mention still fires: «soy alérgico», «tengo alergia al maní», «my kid has a nut allergy»;
 * so does a denial followed by a contrast that affirms the topic again: «no tengo alergia al gluten pero
 * sí al maní», «no allergies except peanuts».
 */

/** Words that deny what follows them within a few words. Apostrophes are spaces, «n't» is «not» already. */
const NEGATORS = new Set([
    // es
    'no', 'sin', 'ni', 'nunca', 'jamas', 'tampoco', 'ningun', 'ninguna', 'ninguno', 'ningunas', 'ningunos', 'nada',
    // en
    'not', 'without', 'never', 'none', 'nor',
    // pt
    'nao', 'sem', 'nem', 'nenhum', 'nenhuma', 'nenhuns', 'nenhumas',
    // fr
    'pas', 'sans', 'aucun', 'aucune', 'jamais', 'ne', 'n',
]);

/**
 * The only words that may stand between a negator and the keyword for the negator to deny the keyword itself:
 * having / being it, pronouns, determiners, quantifiers, «tipo de». Any other word means the negator denies
 * something else: «no he RECIBIDO la garantía», «no sé SI soy alérgico», «no como maní PORQUE soy alérgico».
 */
const FILLER = new Set([
    // es
    'tengo', 'tiene', 'tienen', 'tenemos', 'tenia', 'soy', 'es', 'somos', 'son', 'estoy', 'esta', 'hay', 'he', 'ha', 'padezco', 'padece',
    'me', 'mi', 'mis', 'se', 'yo', 'un', 'una', 'uno', 'unos', 'unas', 'el', 'la', 'los', 'las', 'de', 'del', 'tipo', 'clase', 'muy', 'ya',
    // en
    'i', 'm', 's', 've', 're', 'we', 'it', 'my', 'do', 'does', 'did', 'have', 'has', 'had', 'am', 'is', 'are', 'was', 'were', 'any', 'a', 'an',
    'the', 'of', 'kind', 'type', 'sort', 'really', 'actually', 'got', 'there', 'very', 'suffer', 'from',
    // pt
    'eu', 'tenho', 'tem', 'temos', 'sou', 'e', 'estou', 'um', 'uma', 'o', 'os', 'as', 'do', 'da', 'meu', 'minha', 'muito', 'sofro',
    // fr
    'je', 'j', 'ai', 'suis', 'est', 'il', 'elle', 'y', 'une', 'd', 'du', 'des', 'le', 'les', 'l', 'genre', 'tres',
]);

/** A contrast marker after a denial: what follows may affirm the topic again. */
const CONTRAST = new Set(['pero', 'sino', 'but', 'mas', 'porem', 'contudo', 'mais', 'though', 'although', 'aunque']);
/** An exception after a denial («ninguna alergia salvo al maní»): the topic is affirmed for what follows. */
const EXCEPTION = new Set(['excepto', 'salvo', 'menos', 'except', 'besides', 'exceto', 'sauf', 'hormis']);
/** Inside a contrast clause, these re-affirm the denied topic («pero sí al maní», «but I am to peanuts»). */
const REAFFIRM = new Set(['si', 'sim', 'yes', 'oui', 'am', 'soy', 'sou', 'suis']);
/** A contrast clause that names the allergen object straight away («pero al maní», «but to peanuts»). */
const OBJECT_OPENERS = new Set(['al', 'ao', 'au', 'aux']);

/** Words that affirm a mention (the customer has / is it): an echo after a bare «no» is not an echo with these. */
const AFFIRMERS = new Set([
    'soy', 'es', 'tengo', 'tiene', 'tienen', 'tenemos', 'somos', 'mi', 'mis', 'su', 'sus',
    'am', 'is', 'are', 'have', 'has', 'my', 'our', 'his', 'her',
    'sou', 'tenho', 'tem', 'temos', 'meu', 'minha', 'meus', 'minhas',
    'suis', 'ai', 'est', 'mon', 'ma', 'mes',
    'si', 'sim', 'yes', 'oui',
]);

/** A reply that opens with a bare negative answer: «No», «No, ninguna», «Nope», «Não», «Non», «None». */
const OPENS_NEGATIVE = /^\s*(?:no|nope|nop|nah|nao|non|ninguna|ninguno|ningun|nada|none|nenhuma|nenhum|aucune|aucun|negativo)\b/;

const NEGATION_WINDOW = 4;

interface Token { word: string; start: number; end: number; clause: number }

/** Accent-folded, lower-cased words with the clause each belongs to (a clause ends at , . ; : ! ? ¿ ¡ and dashes). */
function tokenize(raw: unknown): Token[] {
    const folded = foldKeepingPunctuation(raw).replace(/n['’]t\b/g, ' not').replace(/['’]/g, ' ');
    const tokens: Token[] = [];
    let clause = 0;
    const re = /[\p{L}\p{N}]+|[,.;:!?¿¡()\n]|\s[-–—]\s/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(folded))) {
        if (!/[\p{L}\p{N}]/u.test(m[0])) { clause++; continue; }
        tokens.push({ word: m[0], start: m.index, end: m.index + m[0].length, clause });
    }
    return tokens;
}

/** The keyword's own words, folded the same way. */
function needleWords(trigger: string): string[] {
    return tokenize(trigger).map(t => t.word);
}

/** Every place the keyword's words appear in sequence; the last word may be a prefix («alergia» in «alergias»). */
function mentions(tokens: Token[], words: string[]): Array<{ from: number; to: number }> {
    const found: Array<{ from: number; to: number }> = [];
    if (!words.length) return found;
    for (let i = 0; i + words.length <= tokens.length; i++) {
        const ok = words.every((w, k) => {
            const t = tokens[i + k].word;
            if (k > 0 && tokens[i + k].clause !== tokens[i].clause) return false;
            return k === words.length - 1 ? t.startsWith(w) : t === w;
        }) || (words.length === 1 && tokens[i].word.includes(words[0]));
        if (ok) found.push({ from: i, to: i + words.length - 1 });
    }
    return found;
}

/** A negator among the few words before the mention, in its clause, with only filler between them. */
function negatedBefore(tokens: Token[], from: number): boolean {
    for (let i = from - 1, seen = 0; i >= 0 && seen < NEGATION_WINDOW; i--, seen++) {
        const t = tokens[i];
        if (t.clause !== tokens[from].clause) return false;
        if (NEGATORS.has(t.word)) return true;
        if (!FILLER.has(t.word)) return false;
    }
    return false;
}

/** «alergias no», «allergies none», «alergia nenhuma»: denied right after, with nothing affirming it before. */
function negatedAfter(tokens: Token[], from: number, to: number): boolean {
    const next = tokens[to + 1];
    if (!next || next.clause !== tokens[to].clause || !NEGATORS.has(next.word)) return false;
    return !affirmedBefore(tokens, from);
}

function affirmedBefore(tokens: Token[], from: number): boolean {
    for (let i = from - 1, seen = 0; i >= 0 && seen < NEGATION_WINDOW; i--, seen++) {
        if (tokens[i].clause !== tokens[from].clause) return false;
        if (AFFIRMERS.has(tokens[i].word)) return true;
    }
    return false;
}

/** After a denied mention, a contrast or exception that affirms the topic again («pero sí al maní», «except peanuts»). */
function reaffirmedAfter(tokens: Token[], to: number): boolean {
    for (let i = to + 1; i < tokens.length; i++) {
        const w = tokens[i].word;
        // «al menos» / «a menos» is «at least» / «unless», not an exception.
        if (EXCEPTION.has(w) && !(w === 'menos' && ['al', 'a'].includes(tokens[i - 1]?.word))) return true;
        if (!CONTRAST.has(w)) continue;
        const rest = tokens.slice(i + 1).filter(t => t.clause === tokens[i].clause);
        if (!rest.length) continue;
        if (OBJECT_OPENERS.has(rest[0].word) && !NEGATORS.has(rest[1]?.word ?? '')) return true;
        if (rest.slice(0, NEGATION_WINDOW).some(t => REAFFIRM.has(t.word))
            && !rest.slice(0, NEGATION_WINDOW).some(t => NEGATORS.has(t.word))) return true;
    }
    return false;
}

/** Whether `outbound` (the agent's previous message) asked the customer about the keyword's topic. */
export function outboundAskedAbout(outbound: unknown, trigger: string): boolean {
    const text = foldKeepingPunctuation(outbound);
    if (!text.includes('?')) return false;
    const stems = needleWords(trigger).map(w => (w.length > 6 ? w.slice(0, 5) : w));
    return stems.length > 0 && stems.every(s => text.includes(s));
}

export interface TriggerContext {
    /** The agent's last message before this one, when the caller has it. */
    previousOutbound?: string | null;
}

/**
 * Whether the keyword, present in the message, is only denied there (so it must not hand off). False when it
 * is absent, when any mention of it is affirmed, or when the message could not be read word by word.
 */
export function isDeniedTriggerMention(raw: unknown, trigger: string, context: TriggerContext = {}): boolean {
    const words = needleWords(trigger);
    if (!words.length) return false;
    const tokens = tokenize(raw);
    const found = mentions(tokens, words);
    if (!found.length) return false;
    const answersOwnQuestion = !!context.previousOutbound
        && OPENS_NEGATIVE.test(foldKeepingPunctuation(raw))
        && outboundAskedAbout(context.previousOutbound, trigger);
    return found.every(({ from, to }) => {
        const denied = negatedBefore(tokens, from) || negatedAfter(tokens, from, to)
            || (answersOwnQuestion && !affirmedBefore(tokens, from));
        return denied && !reaffirmedAfter(tokens, to);
    });
}

/**
 * The one rule every reader of the tenant's handoff keywords applies: the folded keyword is in the folded
 * message (as before) AND it is not only denied there.
 */
export function customTriggerFires(raw: unknown, trigger: string, context: TriggerContext = {}): boolean {
    const needle = normalizeForIntent(trigger);
    if (!needle || !normalizeForIntent(raw).includes(needle)) return false;
    return !isDeniedTriggerMention(raw, trigger, context);
}

/**
 * Whether deciding the message's keywords could depend on the agent's previous message: it opens with a bare
 * negative answer and mentions a keyword that is not already denied. Lets a caller skip loading that message.
 */
export function triggerDecisionNeedsPreviousOutbound(raw: unknown, triggers: readonly string[]): boolean {
    if (!OPENS_NEGATIVE.test(foldKeepingPunctuation(raw))) return false;
    return triggers.some(trigger => customTriggerFires(raw, trigger));
}
