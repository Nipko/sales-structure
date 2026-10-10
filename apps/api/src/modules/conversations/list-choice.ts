import { foldKeepingPunctuation } from './appointment-transition';

/**
 * «El 2» after the assistant offered a list of times in prose.
 *
 * The booking engine reads a bare «el 2» as the second option of the list IT showed (its step is `show_slots`, and the date reader
 * is told not to read a bare number as a day of the month there). When the times were listed by the model instead («9:00, 9:30,
 * 10:00, 10:30, 11:00 y 11:30. ¿Cuál le gustaría reservar?») no engine state says so, and the model read «el 2» as 2:00 p.m. and
 * answered that it was not available (production 2026-10-09, Salón QA Citas).
 *
 * The words themselves settle it when they can: a message that is ONLY a number, right after a reply that offered several times,
 * picks the option at that position — unless that number is itself one of the hours offered (then it is the time, or at least it
 * is ambiguous, and the model asks). The customer's message is stored as written; only what the model is shown is the option.
 */
const BARE_NUMBER = /^\s*(?:(?:el|la|opcion|la opcion|numero|el numero|n|no|num)\.?\s*)?#?\s*(\d{1,2})\s*[.!]?\s*$/;
const OFFER_CUE = /\b(?:cual|cuales|horario|horarios|disponible|disponibles|opcion|opciones|elegir|elige|prefiere|prefieres|reservar|agendar|which|available|options?|choose|quel|quelle|disponibles?|horaires?|escolher|qual|hor[aá]rios?)\b/;
// A time or a range («09:30 - 10:15»): a range is ONE option, named by where it starts.
const TIME = /\b(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s?m\.?)?(?:\s*(?:-|–|—|a|hasta|to|ate)\s*\d{1,2}:\d{2}(?:\s*[ap]\.?\s?m\.?)?)?/g;

export interface ListChoice { index: number; time: string }

export function resolveListChoice(userText: unknown, previousReply: unknown): ListChoice | null {
    const typed = foldKeepingPunctuation(userText).trim();
    const picked = BARE_NUMBER.exec(typed);
    if (!picked || typeof previousReply !== 'string' || !previousReply) return null;
    const number = Number(picked[1]);
    const reply = foldKeepingPunctuation(previousReply);
    // The reply must END asking the customer to choose («¿Cuál le gustaría reservar?»): a list of times followed by another question
    // («…¿para cuántas personas?») makes a bare «2» the answer to THAT question.
    const closing = reply.split(/(?<=[.?!])\s+/).map(part => part.trim()).filter(Boolean).pop() ?? '';
    if (!OFFER_CUE.test(closing)) return null;
    const offered = [...reply.matchAll(TIME)].map(match => ({
        text: `${Number(match[1])}:${match[2]}${match[3] ? ` ${match[3]}. m.` : ''}`, hour: Number(match[1]) % 12, period: match[3],
    }));
    // Only a list of DISTINCT starts is a list of options.
    const distinct = offered.filter((item, at) => offered.findIndex(other => other.text === item.text) === at);
    if (distinct.length < 2 || number < 1 || number > distinct.length) return null;
    // «el 2» when 2:00 / 14:00 is one of the times offered is the time itself (or cannot be told apart): left to the model.
    if (distinct.some(item => item.hour === number % 12)) return null;
    return { index: number, time: distinct[number - 1].text };
}
