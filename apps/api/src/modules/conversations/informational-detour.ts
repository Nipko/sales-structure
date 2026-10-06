import { normalizeForIntent } from '@parallext/shared';
import { isInformationSeekingMessage } from '../../common/conversation/intent-normalizer';

/**
 * An informational question asked while a booking mission is open.
 *
 * The booking engine is a state machine for ONE task. Asking the opening hours,
 * a price, the service list, the address or a policy is not a step of that
 * task, and the engine has no tool to answer it: it used to re-prompt the
 * current step (`handled: true`, no tool call), so the customer got a waiting
 * phrase and the mission swallowed every informational question for days. Such
 * a message goes to the model with its tools (`search_faqs`, `list_services`,
 * `check_availability`) and the mission is kept untouched to be resumed later.
 *
 * Deliberately conservative in both directions:
 *  - "horario" alone is the engine's word for a free slot ("¿tienen horario
 *    mañana?", "el horario de las 10"): only an opening/closing verb or a
 *    qualifier ("de atención", "de apertura", "business hours") makes it a
 *    question about the business;
 *  - a booking datum riding with the question (a commitment verb, a leading
 *    "sí", a date next to a price question) stays with the engine, which must
 *    read it. The datum wins; the engine's next prompt continues the flow.
 */

const HOURS_TOPIC = /\b(?:horarios? (?:de|del) (?:atencion|apertura|cierre|funcionamiento|servicio|trabajo|local|salon|negocio|tienda|consultorio)|horas? de (?:atencion|apertura|cierre|servicio|trabajo)|(?:hasta|desde) que hora|a que hora (?:abren|abre|cierran|cierra|atienden|atiende|empiezan|empieza|comienzan|comienza|terminan|termina|salen|trabajan)|abren|abre|cierran|cierra|opening hours|business hours|working hours|opening times|are you open|do you open|when do you (?:open|close)|what time (?:do|does) (?:you|it|the \w+) (?:open|close)|horaires?|heures? d ouverture|a quelle heure (?:ouvrez|fermez)|ouvert|ouvrez|ouvrent|fermez|horario de funcionamento|horarios de funcionamento|a que horas (?:abrem|fecham|comecam|terminam)|abrem|fecham)\b/;
/**
 * "atienden los domingos": being open on a day. Only without a concrete time and
 * without "me": "¿me atienden mañana a las 3?" asks to be served, not the hours.
 */
const ATTEND_DAY = /\batienden? (?:los |el |la |las )?(?:hoy|manana|domingos?|sabados?|lunes|martes|miercoles|jueves|viernes|festivos?|feriados?)\b/;
const CLOCK_OR_ME = /\d|\bme\b|\ba las?\b/;

const PRICE_TOPIC =/\b(?:cuanto (?:cuesta|cuestan|vale|valen|cobran|cobra|sale|salen|es)|precios?|tarifas?|costos?|cuanto me (?:cobran|saldria)|how much|prices?|pricing|cost|quanto (?:custa|custam|cobram)|precos?|combien|prix|tarifs?|coute)\b/;
/** How long a service lasts is a fact about the business, not a request to book it. */
const DURATION_TOPIC = /\b(?:cuanto (?:dura|duran|demora|demoran|tarda|tardan|tiempo)|duracion|how long|combien de temps|quanto tempo)\b/;
const SERVICES_TOPIC = /\b(?:que servicios|cuales servicios|servicios (?:ofrecen|tienen|ofrece|tiene|disponibles)|que (?:ofrecen|tratamientos tienen|hacen|manejan)|catalogo|what services|which services|services do you|quels services|que servicos|quais servicos)\b/;
const LOCATION_TOPIC = /\b(?:donde (?:estan|queda|quedan|se ubican|se encuentran|es|puedo encontrar)|direccion|ubicacion|ubicados?|como llego|where are you|where is|your address|located|adresse|ou etes vous|onde fica|onde voces|endereco|localizacao)\b/;
const POLICY_TOPIC = /\b(?:politicas?|cancelacion(?:es)?|reembolsos?|devoluciones?|metodos? de pago|formas? de pago|aceptan (?:tarjeta|efectivo|transferencia)|garantias?|promociones?|descuentos?|parqueadero|estacionamiento|refund|cancellation policy|payment methods|promotions?|politique|remboursement|politica de)\b/;

/** "me puede decir…", "dime…": an information request without a question mark. */
const INFORMATION_IMPERATIVE = /\b(?:me (?:puede|podria|podrias|puedes|dice|dices|indica|indicas|informa|informas|cuenta|cuentas)|dime|digame|decime|quisiera saber|necesito saber|quiero saber|me gustaria saber|quiero (?:conocer|preguntar|consultar|averiguar)|necesito (?:conocer|preguntar|consultar|la direccion|el horario|los precios|informacion)|i would like to know|i d like to know|can you tell|could you tell|tell me|me diga)\b/;

const GREETING_LEAD = /^(?:hola|buenas|buenos dias|buen dia|buenas tardes|buenas noches|hi|hello|hey|ola|oi|bonjour|salut)[\s,.!]*/;
/** "a qué hora abren", "hasta qué hora atienden": an interrogative led by a preposition. */
const PREPOSITIONAL_QUESTION = /^(?:a|hasta|desde|de|en|para|por) (?:que|cual|cuales|cuanto|cuando|donde)\b/;

/** The customer is acting on the booking, not asking about the business. */
const BOOKING_COMMITMENT = /\b(?:agend\w*|reserv\w*|apartar|aparta|programar|programame|book|booking|schedule|confirm\w*|cancelar|cancela|cancelalo|cancel|quiero (?!saber|conocer|preguntar|consultar|averiguar|entender|decidir|ver\b)\w+|lo quiero|la quiero|necesito (?!saber|conocer|preguntar|consultar|decidir|ver\b|la direccion|el horario|los precios|informacion)\w+|me gustaria (?!saber|conocer|preguntar|consultar|ver\b)\w+|i want (?!to know|to ask|to see)\w+|i would like (?!to know|to ask|to see)\w+)\b/;
/** A leading yes accepts the previous prompt: the rest is a datum, even if phrased as a question. */
const AFFIRMATIVE_LEAD = /^(?:si|dale|claro|listo|vale|perfecto|yes|yeah|sim|oui)\b/;
/** "no" / "ok" answer too, but only a question after them is still a question. */
const WEAK_LEAD = /^(?:ok|okay|no)\b/;

export interface InterpretedHint {
    dateMentioned?: string | null;
    serviceMentioned?: string | null;
    timeMentioned?: string | null;
}

/** Which kind of business question this is, or null when it is not one. */
function informationalTopic(raw: unknown): 'hours' | 'other' | null {
    const text = normalizeForIntent(raw);
    if (!text) return null;
    if (BOOKING_COMMITMENT.test(text)) return null;
    const unGreeted = text.replace(GREETING_LEAD, '');
    if (AFFIRMATIVE_LEAD.test(unGreeted)) return null;
    const asks = (value: string) => isInformationSeekingMessage(value) || PREPOSITIONAL_QUESTION.test(value);
    if (WEAK_LEAD.test(unGreeted)) {
        const rest = unGreeted.replace(WEAK_LEAD, '').replace(/^[\s,.!;]+(?:y\s+)?/, '');
        if (!asks(rest) && !INFORMATION_IMPERATIVE.test(rest)) return null;
    }
    const asksSomething = isInformationSeekingMessage(raw) || asks(unGreeted) || INFORMATION_IMPERATIVE.test(text);
    if (!asksSomething) return null;
    if (HOURS_TOPIC.test(text) || (ATTEND_DAY.test(text) && !CLOCK_OR_ME.test(text))) return 'hours';
    if (PRICE_TOPIC.test(text) || DURATION_TOPIC.test(text) || SERVICES_TOPIC.test(text) || LOCATION_TOPIC.test(text) || POLICY_TOPIC.test(text)) return 'other';
    return null;
}

/** The message asks how long something lasts. */
export function asksDuration(raw: unknown): boolean {
    return DURATION_TOPIC.test(normalizeForIntent(raw));
}

/**
 * The message reads as a question rather than as a request or a datum. A heuristic on purpose: it
 * only decides whether a mission opened by this message is TENTATIVE (an interest, not yet a
 * booking), and a wrong guess costs at most a mission that expires unconfirmed.
 */
export function isQuestionLike(raw: unknown, interpreted?: InterpretedHint): boolean {
    const text = String(raw ?? '');
    return /[?¿]/.test(text) || isInformationSeekingMessage(text) || isInformationalDetour(text, interpreted);
}

/**
 * `step` is the open mission's step. While the customer is picking a service, the service they
 * name is the answer the engine must read; a duration question riding with it is left for the
 * model. (A time next to a question already stays with the engine, see below; the engine itself
 * keeps a slot pick that rides with a duration question.)
 */
export function isInformationalDetour(raw: unknown, interpreted?: InterpretedHint, step?: string): boolean {
    const topic = informationalTopic(raw);
    if (!topic) return false;
    // A date or time the interpreter extracted next to a price/service/policy question is
    // booking data the engine must keep. Opening hours mention weekdays by nature.
    if (topic === 'other' && (interpreted?.dateMentioned || interpreted?.timeMentioned)) return false;
    // A concrete time (or a professional/date asked together with it) is an
    // availability request the engine answers with its tool.
    if (topic === 'hours' && interpreted?.timeMentioned) return false;
    if (step === 'show_services' && interpreted?.serviceMentioned && asksDuration(raw)) return false;
    return true;
}
