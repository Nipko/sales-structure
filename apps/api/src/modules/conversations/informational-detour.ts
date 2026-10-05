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
 *  - an explicit booking commitment ("quiero reservar", "agéndame", "confirmo")
 *    is never a detour, even when it also asks a price;
 *  - "horario" next to a clock time ("el horario de las 10:00") is a slot pick,
 *    not a question about opening hours.
 */

const HOURS_TOPIC = /\b(?:horarios?|horas? de (?:atencion|apertura|cierre|servicio|trabajo)|(?:hasta|desde) que hora|a que hora (?:abren|abre|cierran|cierra|atienden|atiende|empiezan|empieza|comienzan|comienza|terminan|termina|salen|trabajan|estan)|(?:abren|abre|cierran|cierra|atienden|atiende) (?:los |el |la |las |hoy|manana|domingos?|sabados?|lunes|martes|miercoles|jueves|viernes)|opening hours|business hours|working hours|(?:what|which) hours|what time (?:do|does|are|is) (?:you|it|the \w+) (?:open|close|opening|closing)|when do you (?:open|close)|horaires?|heures? d ouverture|a quelle heure|horario de funcionamento|horarios de funcionamento|a que horas (?:abrem|fecham|comecam|terminam))\b/;
const HOURS_ACTION = /\b(?:abren|abre|cierran|cierra|atienden|atiende|open|opens|close|closes|ouvert|ouvrez|fermez|abrem|fecham)\b/;
const PRICE_TOPIC = /\b(?:cuanto (?:cuesta|cuestan|vale|valen|cobran|cobra|sale|salen|es)|precios?|tarifas?|costos?|cuanto me (?:cobran|saldria)|how much|prices?|pricing|cost|quanto (?:custa|custam|cobram)|precos?|combien|prix|tarifs?|coute)\b/;
const SERVICES_TOPIC = /\b(?:que servicios|cuales servicios|servicios (?:ofrecen|tienen|ofrece|tiene|disponibles)|que (?:ofrecen|tratamientos tienen|hacen|manejan)|catalogo|what services|which services|services do you|quels services|que servicos|quais servicos)\b/;
const LOCATION_TOPIC = /\b(?:donde (?:estan|queda|quedan|se ubican|se encuentran|es|puedo encontrar)|direccion|ubicacion|ubicados?|como llego|where are you|where is|your address|located|adresse|ou etes vous|onde fica|onde voces|endereco|localizacao)\b/;
const POLICY_TOPIC = /\b(?:politicas?|cancelacion(?:es)?|reembolsos?|devoluciones?|metodos? de pago|formas? de pago|aceptan (?:tarjeta|efectivo|transferencia)|garantias?|promociones?|descuentos?|parqueadero|estacionamiento|refund|cancellation policy|payment methods|promotions?|politique|remboursement|politica de)\b/;

/** "me puede decir…", "dime…": an information request without a question mark. */
const INFORMATION_IMPERATIVE = /\b(?:me (?:puede|podria|podrias|puedes|dice|dices|indica|indicas|informa|informas|cuenta|cuentas)|dime|digame|decime|quisiera saber|necesito saber|quiero saber|can you tell|could you tell|tell me|me diga)\b/;

const GREETING_LEAD = /^(?:hola|buenas|buenos dias|buen dia|buenas tardes|buenas noches|hi|hello|hey|ola|oi|bonjour|salut)[\s,.!]*/;
/** "a qué hora abren", "hasta qué hora atienden": an interrogative led by a preposition. */
const PREPOSITIONAL_QUESTION = /^(?:a|hasta|desde|de|en|para|por) (?:que|cual|cuales|cuanto|cuando|donde)\b/;

/** The customer is acting on the booking, not asking about the business. */
const BOOKING_COMMITMENT = /\b(?:agend\w*|reserv\w*|apartar|aparta|programar|programame|book|booking|schedule|confirm\w*|quiero (?:una |la |mi |el )?(?:cita|turno)|necesito (?:una |la |mi |el )?(?:cita|turno))\b/;

export function isInformationalDetour(raw: unknown): boolean {
    const text = normalizeForIntent(raw);
    if (!text) return false;
    if (BOOKING_COMMITMENT.test(text)) return false;
    const unGreeted = text.replace(GREETING_LEAD, '');
    const asksSomething = isInformationSeekingMessage(raw) || isInformationSeekingMessage(unGreeted)
        || INFORMATION_IMPERATIVE.test(text) || PREPOSITIONAL_QUESTION.test(unGreeted);
    if (!asksSomething) return false;
    // "el horario de las 10:00", "horario 15:30": picking a slot, not asking hours.
    const hoursQuestion = HOURS_TOPIC.test(text) && (!/\d/.test(text) || HOURS_ACTION.test(text));
    return hoursQuestion
        || PRICE_TOPIC.test(text)
        || SERVICES_TOPIC.test(text)
        || LOCATION_TOPIC.test(text)
        || POLICY_TOPIC.test(text);
}
