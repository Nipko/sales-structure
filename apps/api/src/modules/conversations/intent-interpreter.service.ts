import { Injectable, Logger } from '@nestjs/common';
import {
    authorizesEffect,
    isInformationSeekingMessage,
    isPauseMessage,
    normalizeCustomerIntent,
} from '../../common/conversation/intent-normalizer';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { BusinessWindowResolver, disambiguateBareHour } from './business-window';
import { isInformationalDetour } from './informational-detour';
import { nextWeekdayDate, readDateReference, relativeDayIso, weekdayMentions } from './date-reference';

/**
 * INTERPRET phase — extracts structured intent from user messages.
 *
 * Uses a SMALL LLM call with forced JSON output. No tools, no personality,
 * no conversation history. Just: "What does this message mean?"
 *
 * This is the first phase of the 3-phase pipeline:
 *   INTERPRET → DECIDE → EXPRESS
 */

export interface InterpretedIntent {
    /** Primary intent: greet, ask_services, select_service, ask_availability, select_time, provide_info, confirm, cancel, general_question, farewell, unknown */
    intent: string;
    /** Service name mentioned (null if none) */
    serviceMentioned: string | null;
    /** Date mentioned in YYYY-MM-DD or relative like "today", "tomorrow" (null if none) */
    dateMentioned: string | null;
    /** Time mentioned like "10:30" or "2pm" (null if none) */
    timeMentioned: string | null;
    /** Is this a confirmation? (si, ok, dale, yes, etc.) */
    isConfirmation: boolean;
    /** Is this a negation/cancel? */
    isNegation: boolean;
    /** Name provided (null if none) */
    nameProvided: string | null;
    /** Email provided (null if none) */
    emailProvided: string | null;
    /** The general question/topic if intent is general_question */
    questionTopic: string | null;
    /** Detected language code */
    language: string;
    /** The weekday and the day of the month the customer wrote disagree («viernes 17 de octubre» when the 17th is a Saturday): no date is chosen, the caller asks. */
    dateWeekdayConflict?: boolean;
    /** Which day of the month and which weekday disagreed (for the question). */
    dateConflictDetail?: { date: string; weekday: number };
    /** Two different dates in one message («el 16 de octubre o el 17 de octubre»): none is chosen, the caller asks. */
    dateAmbiguous?: boolean;
    /** A day with no year that already passed this year, and next year's is far away: the caller asks «¿Se refiere al ... de <next year>?» instead of assuming it. */
    dateYearQuestion?: { thisYear: string; nextYear: string };
}

@Injectable()
export class IntentInterpreterService {
    private readonly logger = new Logger(IntentInterpreterService.name);

    constructor(private llmRouter: LLMRouterService) {}

    /**
     * Extract structured intent from a user message.
     * Uses forced JSON output — no tools, no personality.
     */
    async interpret(
        userText: string,
        currentBookingStep: string,
        availableServices: string[],
        todayDate: string,
        upcomingDays: Array<{ date: string; weekday: string; label?: string }>,
        tenantId?: string,
        /**
         * Operating country for the country pack. Passed per call, never stored:
         * this service is a singleton shared by every tenant, and holding one
         * tenant's country on `this` would leak it into the next tenant's turn.
         */
        operatingCountry?: string | null,
        acceptedReferents?: readonly string[],
        /** Business hours per date; without them an unqualified hour is never reinterpreted. */
        businessWindowFor?: BusinessWindowResolver,
    ): Promise<InterpretedIntent> {
        const interpreted = await this.interpretMessage(
            userText, currentBookingStep, availableServices, todayDate, upcomingDays, tenantId, operatingCountry, acceptedReferents,
            businessWindowFor,
        );
        // Mid-mission, "¿cuánto cuesta el corte?" names a service and "¿a qué hora
        // abren?" resembles an availability request, so the extractors label them
        // select_service / ask_availability and the booking flow takes them as its
        // own. They are questions about the business: label them as such
        // (`ask_services` is already the right label and stays). At idle the label
        // stays as extracted (service list, flow start); the engine itself declines a
        // pure question about a named service ("¿cuánto dura X?") so it opens no
        // mission, but a request to book, or a date or time, always starts the flow.
        const missionOpen = currentBookingStep !== 'idle' && currentBookingStep !== 'booked';
        if (missionOpen && isInformationalDetour(userText, interpreted, currentBookingStep)
            && ['ask_availability', 'select_service', 'select_time', 'provide_info', 'unknown'].includes(interpreted.intent)) {
            return { ...interpreted, intent: 'general_question', isConfirmation: false, questionTopic: userText };
        }
        return interpreted;
    }

    private async interpretMessage(
        userText: string,
        currentBookingStep: string,
        availableServices: string[],
        todayDate: string,
        upcomingDays: Array<{ date: string; weekday: string; label?: string }>,
        tenantId?: string,
        operatingCountry?: string | null,
        acceptedReferents?: readonly string[],
        businessWindowFor?: BusinessWindowResolver,
    ): Promise<InterpretedIntent> {
        // First try deterministic extraction (fast, no LLM cost)
        const deterministicResult = this.deterministicExtract(
            userText, currentBookingStep, availableServices, todayDate, upcomingDays, operatingCountry, acceptedReferents,
            businessWindowFor,
        );
        if (deterministicResult) {
            this.logger.log(`[Interpret] Deterministic: intent=${deterministicResult.intent} service=${deterministicResult.serviceMentioned || '-'} date=${deterministicResult.dateMentioned || '-'}`);
            return deterministicResult;
        }

        // If deterministic can't handle it, use LLM for complex interpretation
        try {
            return await this.llmInterpret(userText, currentBookingStep, availableServices, todayDate, upcomingDays, tenantId, operatingCountry, acceptedReferents);
        } catch (e: any) {
            this.logger.warn(`[Interpret] LLM interpretation failed: ${e.message}`);
            return this.fallbackIntent(userText);
        }
    }

    /**
     * Fast deterministic extraction — handles 80% of messages without LLM.
     * Returns null if the message needs LLM interpretation.
     */
    private deterministicExtract(
        text: string,
        step: string,
        services: string[],
        todayDate: string,
        upcoming: Array<{ date: string; weekday: string; label?: string }>,
        operatingCountry?: string | null,
        acceptedReferents?: readonly string[],
        businessWindowFor?: BusinessWindowResolver,
    ): InterpretedIntent | null {
        const t = text.toLowerCase().trim();
        const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const tNorm = norm(text);
        const informationSeeking = isInformationSeekingMessage(text);

        // Base result
        const base: InterpretedIntent = {
            intent: 'unknown',
            serviceMentioned: null,
            dateMentioned: null,
            timeMentioned: null,
            isConfirmation: false,
            isNegation: false,
            nameProvided: null,
            emailProvided: null,
            questionTopic: null,
            language: 'es',
        };

        // ── Detect email ──
        const emailMatch = t.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
        if (emailMatch) base.emailProvided = emailMatch[0];

        // ── Detect confirmation / negation / cancellation ──
        //
        // This used to be its own regex, and it was the WIDEST of four
        // disagreeing lists: it accepted `listo`, `correcto`, `va`, `eso` and
        // `exacto`, which the central guard did not. A customer typing `listo`
        // made this interpreter set `isConfirmation`, the booking engine called
        // `createBooking(..., 'text_confirmation')`, and the guard then re-read
        // the same word, returned `unclear` and escalated. The customer said yes
        // and got handed to a human.
        //
        // Booking a slot is `transactional`, not `high_impact`: a contextual yes
        // is how people actually confirm an appointment. The same word still
        // cannot authorise a charge, because that path asks with a stricter
        // effect against this very classifier.
        const normalizedIntent = normalizeCustomerIntent(text, {
            country: operatingCountry,
            acceptedReferents,
            answeringExplicitQuestion: step !== 'idle' && step !== 'booked',
        });
        if (authorizesEffect(normalizedIntent, 'transactional', { answeringExplicitQuestion: step !== 'idle' && step !== 'booked' })) {
            base.isConfirmation = true;
            base.intent = 'confirm';
        }

        // Cancellation can appear AFTER an affirmative ("sí, mejor no", "sí,
        // cancela"), which the old confirmation regex matched and booked. The
        // shared classifier already resolves cancel before affirm, so this only
        // has to honour the verdict.
        if (normalizedIntent.intent === 'cancel'
            || normalizedIntent.intent === 'reject'
            || normalizedIntent.intent === 'opt_out') {
            base.isNegation = true;
            base.isConfirmation = false;
            base.intent = 'cancel';
            return base;
        }

        if (isPauseMessage(text)) {
            return { ...base, intent: 'general_question', questionTopic: text };
        }

        // ── Detect greeting (only if short and NOT a confirmation) ──
        if (!base.isConfirmation && /^(hola|hi|hey|hello|buenos? d[ií]as?|buenas? tardes?|buenas? noches?|buen d[ií]a|oi|olá|bonjour|salut)[.!¡\s]*$/i.test(t)) {
            base.intent = 'greet';
            return base;
        }

        // ── Detect farewell (only if NOT a confirmation) ──
        if (!base.isConfirmation && /^(muchas gracias|gracias|chao|adios|adiós|bye|hasta luego|nos vemos|thanks|thank you|merci|obrigado|obrigada)[.!¡\s]*$/i.test(t)) {
            base.intent = 'farewell';
            return base;
        }

        // ── Detect service list request ──
        if (/\b(servicios|services|que ofrec|que tienen|opciones|catalogo|servicos|que hay)\b/i.test(tNorm)) {
            base.intent = 'ask_services';
            base.questionTopic = informationSeeking ? text : null;
            return base;
        }

        // ── Match service by NUMBER ("el 1", "la 2", "opcion 1", "la primera") ──
        if (step === 'show_services' && services.length > 0) {
            // Numeric: "el 1", "la 2", "opcion 3", "numero 1", "el numero 2"
            const numMatch = tNorm.match(/(?:el|la|opcion|numero|el numero|la opcion|quiero el|quiero la)\s*(\d+)/);
            if (numMatch) {
                const idx = parseInt(numMatch[1]) - 1; // 1-based to 0-based
                if (idx >= 0 && idx < services.length) {
                    base.serviceMentioned = services[idx];
                    base.intent = 'select_service';
                }
            }
            // Just a bare number: "1", "2"
            if (!base.serviceMentioned && /^\d+$/.test(t.trim())) {
                const idx = parseInt(t.trim()) - 1;
                if (idx >= 0 && idx < services.length) {
                    base.serviceMentioned = services[idx];
                    base.intent = 'select_service';
                }
            }
            // Ordinals: "la primera", "el primero", "la segunda", "el segundo"
            if (!base.serviceMentioned) {
                const ordinals: Record<string, number> = {
                    primer: 0, primero: 0, primera: 0,
                    segund: 1, segundo: 1, segunda: 1,
                    tercer: 2, tercero: 2, tercera: 2,
                    cuart: 3, cuarto: 3, cuarta: 3,
                    quint: 4, quinto: 4, quinta: 4,
                };
                for (const [word, idx] of Object.entries(ordinals)) {
                    if (tNorm.includes(word) && idx < services.length) {
                        base.serviceMentioned = services[idx];
                        base.intent = 'select_service';
                        break;
                    }
                }
            }
        }

        // ── Match service by name ──
        // Two passes so the FIRST loose word-overlap can't beat a more specific
        // service: e.g. "consulta especializada" must win over "consulta general"
        // for "quiero consulta especializada".
        // Skip entirely while collecting name/email or at confirm: a surname like
        // "Cortés" (stem of "corte") would otherwise reset the booking and switch
        // service. A real change of service is handled by the intent interpreter
        // on a fresh turn outside these steps.
        const collectingPersonalInfo = step === 'ask_name' || step === 'ask_email' || step === 'confirm';
        if (!base.serviceMentioned && !collectingPersonalInfo) {
            // Pass 1: full service name appears in the text — pick the LONGEST
            // (most specific) such match across all services.
            let bestExact: string | null = null;
            for (const svc of services) {
                if (tNorm.includes(norm(svc))) {
                    if (!bestExact || norm(svc).length > norm(bestExact).length) bestExact = svc;
                }
            }
            if (bestExact) {
                base.serviceMentioned = bestExact;
                base.intent = 'select_service';
            } else {
                // Pass 2: fuzzy — score every service by reverse-substring (a user
                // word inside the service name) and stem overlap, and pick the
                // highest-scoring one, not the first that overlaps at all.
                const userWords = tNorm.split(/\s+/).filter(w => w.length > 4);
                let best: { svc: string; score: number } | null = null;
                for (const svc of services) {
                    const svcNorm = norm(svc);
                    const svcWords = svcNorm.split(/\s+/).filter(w => w.length > 4);
                    let score = 0;
                    for (const w of userWords) {
                        if (svcNorm.includes(w)) {
                            score += 2; // reverse substring — strong signal
                        } else if (svcWords.some(sw => {
                            const stemLen = Math.min(5, Math.min(w.length, sw.length));
                            return w.substring(0, stemLen) === sw.substring(0, stemLen);
                        })) {
                            score += 1; // stem overlap — weaker signal
                        }
                    }
                    if (score > 0 && (!best || score > best.score)) best = { svc, score };
                }
                if (best) {
                    base.serviceMentioned = best.svc;
                    base.intent = 'select_service';
                }
            }
        }

        // ── Confirmation with single service at show_services ──
        if (base.isConfirmation && !base.serviceMentioned && step === 'show_services' && services.length === 1) {
            base.serviceMentioned = services[0];
            base.intent = 'select_service';
        }

        // ── Detect date ──
        //
        // ONE reader (date-reference.ts) shared with the reschedule engine, in this order of authority:
        //   1. an explicit day («16 de octubre [de 2026]», «el viernes 17», «el 16») - it beat «hoy / mañana» and the weekday
        //      in no case before: «el viernes 16 de octubre por la mañana» booked Saturday (the «mañana» of the morning read as tomorrow);
        //   2. today / the day after tomorrow / tomorrow («por la mañana» is the morning, not tomorrow);
        //   3. a weekday: the NEXT one, never today unless the customer says «hoy» («el viernes» said on a Friday is next Friday).
        // What cannot be resolved is not guessed: a weekday that disagrees with the day of the month, two different dates, and a
        // year-less day that already passed this year (far from next year's) are reported for the engine to ASK about.
        const reading = readDateReference(tNorm, todayDate, { lenientPortuguese: true });
        if (reading.kind === 'date' && reading.via === 'explicit') base.dateMentioned = reading.date;
        else if (reading.kind === 'past' && reading.thisYear && reading.nextYearDate) base.dateYearQuestion = { thisYear: reading.date, nextYear: reading.nextYearDate };
        else if (reading.kind === 'past') base.dateMentioned = reading.date;
        else if (reading.kind === 'conflict') { base.dateWeekdayConflict = true; base.dateConflictDetail = { date: reading.date, weekday: reading.saidWeekday }; }
        else if (reading.kind === 'ambiguous' && reading.of === 'dates') base.dateAmbiguous = true;
        else {
            const relative = relativeDayIso(tNorm, todayDate);
            if (relative) base.dateMentioned = relative;
            else if (reading.kind === 'date') base.dateMentioned = reading.date;
            else if (reading.kind === 'ambiguous') {
                // «el jueves o el martes»: the first one said (the weekdays are not contradictory, only alternatives).
                const first = weekdayMentions(tNorm, true).filter(day => !day.selector)[0];
                if (first) base.dateMentioned = nextWeekdayDate(first.weekday, todayDate, false);
            }
        }

        // ── Detect time ──
        // (?!\d) so a LatAm thousands separator like "30.000" (pesos) is NOT
        // parsed as 30:00 — the third digit after the dot rejects the match.
        const timeMatch = t.match(/(\d{1,2})[:.](\d{2})(?!\d)/);
        if (timeMatch) {
            base.timeMentioned = `${String(parseInt(timeMatch[1])).padStart(2, '0')}:${timeMatch[2]}`;
        } else {
            // Capture the full period qualifier — "de la tarde/noche" never started
            // with 'p', so "a las 3 de la tarde" was parsed as 03:00 instead of 15:00.
            // Prefixes for es/pt/fr/en ("a las", "às", "at", "à") + multilingual
            // period qualifiers, so "amanhã às 15h" / "at 3 pm" / "à 15h" parse.
            const hourMatch = t.match(/(?:a las |las |às |as |at |à )(\d{1,2})(?:[:h]\s*(\d{2}))?\s*(am|pm|de la tarde|de la noche|de la mañana|de la manana|de la madrugada|tarde|noche|mañana|manana|madrugada|da tarde|da noite|da manha|du soir|du matin|de l'apres-midi|in the afternoon|in the evening|in the morning|a\.?m|p\.?m|h|hs|hrs?)?(?![a-zñ])/i);
            // The trailing (?![a-zñ]) keeps the "h" of "hay" in "a las 4 hay espacio" from being read as an hour marker.
            if (hourMatch) {
                let h = parseInt(hourMatch[1]);
                const min = hourMatch[2] || '00';
                const q = (hourMatch[3] || '').toLowerCase();
                const isPm = q.startsWith('pm') || q === 'p.m' || q.includes('tarde') || q.includes('noche') || q.includes('noite') || q.includes('soir') || q.includes('afternoon') || q.includes('evening') || q.includes('apres');
                const isAm = q.startsWith('am') || q === 'a.m' || q.includes('mañana') || q.includes('manana') || q.includes('madrugada') || q.includes('manha') || q.includes('matin') || q.includes('morning');
                if (isPm && h < 12) h += 12;
                else if (isAm && h === 12) h = 0;
                // "a las 4" with no am/pm and no 24h marker: when 04:00 is outside the
                // business hours and 16:00 is inside, the customer means the afternoon.
                // Unknown hours: assume nothing.
                else if (!q && businessWindowFor) {
                    h = disambiguateBareHour(h, parseInt(min), businessWindowFor(base.dateMentioned || todayDate));
                }
                base.timeMentioned = `${String(h).padStart(2, '0')}:${min}`;
            } else {
                // Bare "15h" / "15hs" / "15hrs" (common in pt/fr) without a prefix.
                const hMatch = t.match(/\b(\d{1,2})\s*h\s*(\d{2})?(?:s|rs?)?\b/i);
                if (hMatch) {
                    const h = parseInt(hMatch[1]);
                    const min = hMatch[2] || '00';
                    if (h >= 0 && h <= 23) base.timeMentioned = `${String(h).padStart(2, '0')}:${min}`;
                }
            }
        }

        // ── Noon / midnight shortcuts (es/pt/fr/en) ──
        if (!base.timeMentioned) {
            if (/\b(mediod[ií]a|meio[-\s]?dia|midi|noon)\b/i.test(t)) base.timeMentioned = '12:00';
            else if (/\b(medianoche|meia[-\s]?noite|minuit|midnight)\b/i.test(t)) base.timeMentioned = '00:00';
        }

        // ── Detect booking intent ──
        if (/\b(agendar|cita|reservar|turno|programar|disponib|book|appointment|schedule)\b/i.test(t)) {
            if (!base.intent || base.intent === 'unknown') base.intent = 'ask_availability';
        }

        // ── Bug #8: Detect name (only when step is ask_name) ──
        // Strengthened to reject: intent words, date/time words, single chars, confirmations.
        if (step === 'ask_name' && !base.isConfirmation && !base.isNegation && !informationSeeking) {
            const cleaned = text.replace(/[.,!?¿¡]/g, '').trim();
            const words = cleaned.split(/\s+/);
            // Extended blocklist: greetings, confirmations, dates, times, intents, pronouns
            const skipPattern = /^(si|sí|no|ok|hola|quiero|para|yes|gracias|el|la|los|las|un|una|de|del|me|mi|yo|tu|ya|con|por|que|qué|como|cómo|cuándo|cuando|donde|dónde|mañana|manana|hoy|today|tomorrow|lunes|martes|miercoles|jueves|viernes|sabado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|am|pm|este|esta|ese|esa|los|las|hay|ver|quiero|necesito|puedo|puede|quisiera|agenda|cita|turno|reservar|agendar|book|appointment)$/i;
            const firstWordBlocked = skipPattern.test(words[0]);
            // Reject if: first word is blocked, contains digits, or is a single char
            const isValidName =
                words.length >= 1 &&
                words.length <= 5 &&
                !/\d/.test(cleaned) &&
                !firstWordBlocked &&
                cleaned.length >= 2 &&
                // Single-word names must be at least 3 chars (avoids "ok", "si", etc.)
                !(words.length === 1 && cleaned.length < 3);
            if (isValidName) {
                base.nameProvided = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
                base.intent = 'provide_info';
            }
        }


        if (base.timeMentioned && !this.validTime(base.timeMentioned)) base.timeMentioned = null;
        if (informationSeeking) {
            base.isConfirmation = false;
            base.questionTopic = text;
            if (base.intent === 'unknown' || step === 'confirm' || step === 'ask_name' || step === 'ask_email') {
                base.intent = 'general_question';
            }
        }

        // ── If we detected something useful, return ──
        const dateToAskAbout = !!(base.dateWeekdayConflict || base.dateAmbiguous || base.dateYearQuestion);
        if (base.intent !== 'unknown' || base.serviceMentioned || base.dateMentioned || base.timeMentioned || base.emailProvided || base.nameProvided || dateToAskAbout) {
            if (base.intent === 'unknown') {
                if (base.dateMentioned || base.timeMentioned || dateToAskAbout) base.intent = 'ask_availability';
                else if (base.emailProvided) base.intent = 'provide_info';
            }
            return base;
        }

        // Can't determine deterministically — return null for LLM
        return null;
    }

    /**
     * LLM-based interpretation for complex messages.
     * Short prompt, forced JSON, no tools.
     */
    private async llmInterpret(
        userText: string,
        step: string,
        services: string[],
        todayDate: string,
        upcoming: Array<{ date: string; weekday: string; label?: string }>,
        tenantId?: string,
        operatingCountry?: string | null,
        acceptedReferents?: readonly string[],
    ): Promise<InterpretedIntent> {
        const prompt = `Extract the intent from this customer message. Today is ${todayDate}.
Available services: ${services.join(', ') || 'none loaded'}.
Current booking step: ${step}.

Respond ONLY with valid JSON matching this schema:
{
  "intent": "greet|ask_services|select_service|ask_availability|select_time|provide_info|confirm|cancel|general_question|farewell|unknown",
  "serviceMentioned": "service name or null",
  "dateMentioned": "YYYY-MM-DD or null",
  "timeMentioned": "HH:MM or null",
  "isConfirmation": true/false,
  "isNegation": true/false,
  "nameProvided": "name or null",
  "emailProvided": "email or null",
  "questionTopic": "topic or null",
  "language": "es|en|pt|fr"
}`;

        const response = await this.llmRouter.execute({
            model: 'grok-4-1-fast-non-reasoning',
            messages: [{ role: 'user', content: `${prompt}\n\nMessage: "${userText}"` }],
            systemPrompt: 'You extract structured data from messages. Return ONLY JSON, nothing else.',
            temperature: 0,
            tenantId,
        });

        try {
            const cleaned = (response.content || '').replace(/```json?\n?/g, '').replace(/```/g, '').trim();
            return this.sanitizeLlmIntent(JSON.parse(cleaned), userText, todayDate, step, operatingCountry, acceptedReferents);
        } catch {
            this.logger.warn(`[Interpret] Failed to parse LLM JSON: ${response.content}`);
            return this.fallbackIntent(userText);
        }
    }

    /**
     * Validate/coerce the LLM's JSON so malformed or relative values never reach
     * the booking engine / SQL: dateMentioned must be ISO (relative words mapped),
     * timeMentioned must be HH:MM, booleans/strings coerced, unknown intents dropped.
     */
    private sanitizeLlmIntent(parsed: any, userText: string, todayDate: string, step = 'idle', operatingCountry?: string | null, acceptedReferents?: readonly string[]): InterpretedIntent {
        const out = this.fallbackIntent(userText);
        if (!parsed || typeof parsed !== 'object') return out;

        const VALID = ['greet', 'ask_services', 'select_service', 'ask_availability', 'select_time', 'provide_info', 'confirm', 'cancel', 'general_question', 'farewell', 'unknown'];
        if (typeof parsed.intent === 'string' && VALID.includes(parsed.intent)) out.intent = parsed.intent as any;
        if (typeof parsed.serviceMentioned === 'string' && parsed.serviceMentioned.trim()) out.serviceMentioned = parsed.serviceMentioned.trim();

        const d = parsed.dateMentioned;
        if (typeof d === 'string') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(d) && this.validDate(d)) {
                out.dateMentioned = d;
            } else if (/^(today|hoy|hoje|aujourd)/i.test(d)) {
                out.dateMentioned = todayDate;
            } else if (/^(tomorrow|mañana|manana|amanh|demain)/i.test(d)) {
                const x = new Date(`${todayDate}T00:00:00.000Z`);
                x.setUTCDate(x.getUTCDate() + 1);
                out.dateMentioned = x.toISOString().slice(0, 10);
            }
        }
        if (typeof parsed.timeMentioned === 'string' && this.validTime(parsed.timeMentioned)) {
            out.timeMentioned = parsed.timeMentioned.padStart(5, '0');
        }
        const normalized = normalizeCustomerIntent(userText, { country: operatingCountry, acceptedReferents });
        out.isConfirmation = authorizesEffect(normalized, 'transactional', { answeringExplicitQuestion: step !== 'idle' && step !== 'booked' });
        out.isNegation = ['reject', 'cancel', 'opt_out'].includes(normalized.intent);
        if (out.intent === 'confirm' && !out.isConfirmation) out.intent = 'unknown';
        if (out.intent === 'cancel' && !out.isNegation) out.intent = 'unknown';
        if (typeof parsed.nameProvided === 'string' && parsed.nameProvided.trim()) out.nameProvided = parsed.nameProvided.trim();
        if (typeof parsed.emailProvided === 'string' && /\S+@\S+\.\S+/.test(parsed.emailProvided)) out.emailProvided = parsed.emailProvided.trim();
        if (typeof parsed.questionTopic === 'string') out.questionTopic = parsed.questionTopic;
        if (['es', 'en', 'pt', 'fr'].includes(parsed.language)) out.language = parsed.language;
        if (isInformationSeekingMessage(userText) || isPauseMessage(userText)) {
            out.intent = 'general_question';
            out.questionTopic = userText;
            out.nameProvided = null;
            out.isConfirmation = false;
            out.isNegation = false;
        }
        return out;
    }

    private validTime(value: string): boolean {
        if (!/^\d{1,2}:\d{2}$/.test(value)) return false;
        const [hour, minute] = value.split(':').map(Number);
        return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
    }

    private validDate(value: string): boolean {
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }

    private fallbackIntent(userText: string): InterpretedIntent {
        return {
            intent: 'unknown',
            serviceMentioned: null,
            dateMentioned: null,
            timeMentioned: null,
            isConfirmation: false,
            isNegation: false,
            nameProvided: null,
            emailProvided: null,
            questionTopic: userText,
            language: 'es',
        };
    }
}
