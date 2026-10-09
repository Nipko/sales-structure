/**
 * «Mañana es domingo», said on a Friday. The prompt carries the calendar (`upcoming_days`: today, tomorrow, the next days with
 * their weekday), yet a model reasoning from «we close on Sundays» or from the closing hour states the wrong weekday. A reply
 * that says what weekday TODAY / TOMORROW / THE DAY AFTER is, and contradicts that calendar, gets the weekday corrected.
 *
 * Deliberately narrow (the frame «hoy|mañana|pasado mañana + es + <weekday>» and its en/pt/fr equivalents): it changes one word
 * of a sentence the model wrote, only when the calendar the model was given says otherwise, and does nothing without one.
 */
export interface CalendarDay { date: string; weekday: string; label?: string }

const WEEKDAYS: Record<string, string[]> = {
    // Sunday first (Date#getUTCDay order), the words as the language writes them.
    es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
    en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    pt: ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'],
    fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
};
const EN_INDEX: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Patterns: [language, regex with groups (offset word)(weekday word), offset resolver]. */
const FRAMES: Array<{ lang: string; re: RegExp; offset: (word: string) => number | null }> = [
    { lang: 'es', re: /\b(hoy|ma[nñ]ana|pasado ma[nñ]ana)(\s+(?:es|ser[aá])\s+(?:el\s+)?)(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\b/gi,
        offset: word => ({ hoy: 0, manana: 1, 'pasado manana': 2 } as Record<string, number>)[fold(word)] ?? null },
    { lang: 'en', re: /\b(today|tomorrow)(\s+is\s+)(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi,
        offset: word => ({ today: 0, tomorrow: 1 } as Record<string, number>)[word.toLowerCase()] ?? null },
    { lang: 'pt', re: /\b(hoje|amanh[ãa]|depois de amanh[ãa])(\s+(?:é|e|ser[aá])\s+)(domingo|segunda(?:-feira)?|ter[cç]a(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|s[aá]bado)\b/gi,
        offset: word => ({ hoje: 0, amanha: 1, 'depois de amanha': 2 } as Record<string, number>)[fold(word)] ?? null },
    { lang: 'fr', re: /\b(aujourd['’]hui|demain|apr[eè]s-demain)(\s+(?:c['’]est|sera)\s+(?:le\s+)?)(dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)\b/gi,
        offset: word => ({ "aujourd'hui": 0, demain: 1, 'apres-demain': 2 } as Record<string, number>)[fold(word).replace('’', "'")] ?? null },
];

function weekdayIndexOf(day: CalendarDay): number | null {
    const byName = EN_INDEX[String(day.weekday || '').toLowerCase()];
    if (byName !== undefined) return byName;
    const [y, m, d] = String(day.date || '').split('-').map(Number);
    return y && m && d ? new Date(Date.UTC(y, m - 1, d)).getUTCDay() : null;
}

const DAY_WORDS = '(?:domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi|sunday|monday|tuesday|wednesday|thursday|friday|saturday|segunda|ter[cç]a|quarta|quinta|sexta)';
/** «mañana» / «amanhã» used as the MORNING, not as tomorrow: «por la mañana», «el turno de la mañana», «cada mañana», «esta mañana». */
const MORNING_BEFORE = /(?:\b(?:la|las|de la|de|en la|por la|cada|esta|toda la|every|this|each)\s+)$/i;
/** A weekday RANGE or LIST right after the stated day: «lunes a viernes», «martes y jueves», «Monday to Friday», «de segunda a sexta». */
const RANGE_AFTER = new RegExp('^(?:\\s*(?:-|–)\\s*|\\s+(?:a|al|hasta|y|e|o|to|through|and|or|à|au|et|ou|ao|até)\\s+(?:el\\s+|le\\s+|o\\s+|the\\s+)?)' + DAY_WORDS, 'i');
/** A conditional or hypothetical clause: «si mañana es lunes festivo…», «if tomorrow is Monday…». */
const CONDITIONAL: Record<string, RegExp> = {
    es: /\b(?:si|cuando|aunque)\b/i, en: /\b(?:if|whether|when|even if)\b/i, pt: /\b(?:se|quando|embora)\b/i, fr: /\b(?:si|quand|m[eê]me si)\b/i,
};
/** The same sentence says the business is open or closed: the model's weekday is part of an opening-hours claim it reasoned about, so it is left to the model. */
const OPENING_CLAIM = /\b(?:cerrad[oa]s?|cerramos|cierran|abierto|abiertos|abrimos|abren|atendemos|closed|open|opening|fechad[oa]s?|aberto|abertos|abrimos|ferm[eé]e?s?|ouvert|ouverts)\b/i;

/** The sentence of `whole` that holds the match, from its start to its end punctuation. */
function sentenceAround(whole: string, index: number, length: number): { before: string; after: string; sentence: string } {
    const start = Math.max(whole.lastIndexOf('.', index - 1), whole.lastIndexOf('!', index - 1), whole.lastIndexOf('?', index - 1), whole.lastIndexOf('\n', index - 1)) + 1;
    const tail = whole.slice(index + length);
    const endAt = tail.search(/[.!?\n]/);
    const end = endAt < 0 ? whole.length : index + length + endAt;
    return { before: whole.slice(start, index), after: whole.slice(index + length, end), sentence: whole.slice(start, end) };
}

function sameCase(model: string, word: string): string {
    return model[0] === model[0]?.toUpperCase() && model[0] !== model[0]?.toLowerCase() ? word[0].toUpperCase() + word.slice(1) : word;
}

export function correctRelativeWeekdays(reply: string, upcomingDays: readonly CalendarDay[] | undefined): string {
    if (!reply || !upcomingDays?.length) return reply;
    let out = reply;
    for (const frame of FRAMES) {
        out = out.replace(frame.re, (match, offsetWord: string, joiner: string, stated: string, at: number, whole: string) => {
            const offset = frame.offset(offsetWord);
            // Only the plain statement «mañana es <día>» is corrected. «Por la mañana es martes y jueves», «el turno de la mañana es el
            // lunes», «la clase de mañana es lunes a viernes», «si mañana es lunes festivo…» and «mañana es domingo y está cerrado» are
            // not a claim about which weekday tomorrow is, or are one the model reasoned about: they are left as they are.
            const around = sentenceAround(whole, at, match.length);
            if (offset === 1 && MORNING_BEFORE.test(around.before)) return match;
            if (RANGE_AFTER.test(around.after) || CONDITIONAL[frame.lang].test(around.before) || OPENING_CLAIM.test(around.sentence)) return match;
            const day = offset === null ? undefined : upcomingDays[offset];
            const actual = day ? weekdayIndexOf(day) : null;
            if (actual === null || actual === undefined) return match;
            const names = WEEKDAYS[frame.lang];
            const statedIndex = names.findIndex(name => fold(name).replace(/-feira$/, '') === fold(stated).replace(/-feira$/, ''));
            if (statedIndex === actual) return match;
            const correct = names[actual];
            return `${offsetWord}${joiner}${sameCase(stated, correct)}`;
        });
    }
    return out;
}
