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

function sameCase(model: string, word: string): string {
    return model[0] === model[0]?.toUpperCase() && model[0] !== model[0]?.toLowerCase() ? word[0].toUpperCase() + word.slice(1) : word;
}

export function correctRelativeWeekdays(reply: string, upcomingDays: readonly CalendarDay[] | undefined): string {
    if (!reply || !upcomingDays?.length) return reply;
    let out = reply;
    for (const frame of FRAMES) {
        out = out.replace(frame.re, (match, offsetWord: string, joiner: string, stated: string) => {
            const offset = frame.offset(offsetWord);
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
