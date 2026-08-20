import { Injectable, Logger } from '@nestjs/common';
import {
    authorizesEffect,
    normalizeCustomerIntent,
} from '../../common/conversation/intent-normalizer';
import { LLMRouterService } from '../ai/router/llm-router.service';

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
    ): Promise<InterpretedIntent> {
        // First try deterministic extraction (fast, no LLM cost)
        const deterministicResult = this.deterministicExtract(
            userText, currentBookingStep, availableServices, todayDate, upcomingDays, operatingCountry,
        );
        if (deterministicResult) {
            this.logger.log(`[Interpret] Deterministic: intent=${deterministicResult.intent} service=${deterministicResult.serviceMentioned || '-'} date=${deterministicResult.dateMentioned || '-'}`);
            return deterministicResult;
        }

        // If deterministic can't handle it, use LLM for complex interpretation
        try {
            return await this.llmInterpret(userText, currentBookingStep, availableServices, todayDate, upcomingDays, tenantId);
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
    ): InterpretedIntent | null {
        const t = text.toLowerCase().trim();
        const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const tNorm = norm(text);

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
        const normalizedIntent = normalizeCustomerIntent(t, {
            country: operatingCountry,
            answeringExplicitQuestion: true,
        });
        if (authorizesEffect(normalizedIntent, 'transactional', { answeringExplicitQuestion: true })) {
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

        // ── Detect greeting (only if short and NOT a confirmation) ──
        if (!base.isConfirmation && /^(hola|hi|hey|hello|buenos? d[ií]as?|buenas? tardes?|buenas? noches?|buen d[ií]a|oi|olá|bonjour|salut)\b/i.test(t) && t.length < 30) {
            base.intent = 'greet';
            return base;
        }

        // ── Detect farewell (only if NOT a confirmation) ──
        if (!base.isConfirmation && /^(gracias|chao|adios|bye|hasta luego|nos vemos|thank|merci|obrigado)\b/i.test(t)) {
            base.intent = 'farewell';
            return base;
        }

        // ── Detect service list request ──
        if (/\b(servicios|services|que ofrec|que tienen|opciones|catalogo|serviços|que hay)\b/i.test(t)) {
            base.intent = 'ask_services';
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
        if (/\b(hoy|today|hoje|aujourd)/i.test(t)) base.dateMentioned = todayDate;
        else if (/\b(mañana|manana|tomorrow|amanhã|demain)\b/i.test(t)) {
            const d = new Date(todayDate); d.setDate(d.getDate() + 1);
            base.dateMentioned = d.toISOString().split('T')[0];
        } else {
            // Month names (es/pt/fr/en) — matched accent-insensitively against tNorm.
            const months: Record<string, number> = {
                // es
                enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
                // pt
                janeiro: 1, fevereiro: 2, marco: 3, maio: 5, junho: 6, julho: 7, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
                // fr
                janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, decembre: 12,
                // en
                january: 1, february: 2, march: 3, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
            };
            for (const [name, num] of Object.entries(months)) {
                // day-before-month ("10 de enero", "10 janvier") or month-before-day ("january 10")
                const m = tNorm.match(new RegExp(`(\\d{1,2})\\s*(?:de\\s+|of\\s+)?${name}\\b`, 'i'))
                    || tNorm.match(new RegExp(`\\b${name}\\s+(\\d{1,2})\\b`, 'i'));
                if (m) {
                    const day = parseInt(m[1]);
                    if (day < 1 || day > 31) break; // invalid day → ignore
                    let y = new Date(todayDate).getFullYear();
                    let candidate = `${y}-${String(num).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    // If the date already passed this year, roll over to next year
                    // ("10 de enero" said in June means next January, not the past).
                    if (candidate < todayDate) {
                        y += 1;
                        candidate = `${y}-${String(num).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    }
                    // Validate it's a real calendar date (rejects e.g. "31 de febrero").
                    const parsed = new Date(`${candidate}T12:00:00`);
                    if (!isNaN(parsed.getTime()) && parsed.getMonth() + 1 === num && parsed.getDate() === day) {
                        base.dateMentioned = candidate;
                    }
                    break;
                }
            }
            // Day names (es/pt/fr/en) — matched accent-insensitively against tNorm.
            const days: Record<string, number> = {
                // es
                domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
                // pt
                segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5,
                // fr
                dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
                // en
                sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
            };
            for (const [name, num] of Object.entries(days)) {
                if (tNorm.includes(name)) {
                    const match = upcoming.find(d => new Date(d.date).getDay() === num);
                    if (match) base.dateMentioned = match.date;
                    break;
                }
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
            const hourMatch = t.match(/(?:a las |las |às |as |at |à )(\d{1,2})(?:[:h]\s*(\d{2}))?\s*(am|pm|de la tarde|de la noche|de la mañana|de la manana|de la madrugada|tarde|noche|mañana|manana|madrugada|da tarde|da noite|da manha|du soir|du matin|de l'apres-midi|in the afternoon|in the evening|in the morning|a\.?m|p\.?m|h|hs|hrs?)?/i);
            if (hourMatch) {
                let h = parseInt(hourMatch[1]);
                const min = hourMatch[2] || '00';
                const q = (hourMatch[3] || '').toLowerCase();
                const isPm = q.startsWith('pm') || q === 'p.m' || q.includes('tarde') || q.includes('noche') || q.includes('noite') || q.includes('soir') || q.includes('afternoon') || q.includes('evening') || q.includes('apres');
                const isAm = q.startsWith('am') || q === 'a.m' || q.includes('mañana') || q.includes('manana') || q.includes('madrugada') || q.includes('manha') || q.includes('matin') || q.includes('morning');
                if (isPm && h < 12) h += 12;
                else if (isAm && h === 12) h = 0;
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
        if (step === 'ask_name' && !base.isConfirmation && !base.isNegation) {
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


        // ── If we detected something useful, return ──
        if (base.intent !== 'unknown' || base.serviceMentioned || base.dateMentioned || base.timeMentioned || base.emailProvided || base.nameProvided) {
            if (base.intent === 'unknown') {
                if (base.dateMentioned || base.timeMentioned) base.intent = 'ask_availability';
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
            return this.sanitizeLlmIntent(JSON.parse(cleaned), userText, todayDate);
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
    private sanitizeLlmIntent(parsed: any, userText: string, todayDate: string): InterpretedIntent {
        const out = this.fallbackIntent(userText);
        if (!parsed || typeof parsed !== 'object') return out;

        const VALID = ['greet', 'ask_services', 'select_service', 'ask_availability', 'select_time', 'provide_info', 'confirm', 'cancel', 'general_question', 'farewell', 'unknown'];
        if (typeof parsed.intent === 'string' && VALID.includes(parsed.intent)) out.intent = parsed.intent as any;
        if (typeof parsed.serviceMentioned === 'string' && parsed.serviceMentioned.trim()) out.serviceMentioned = parsed.serviceMentioned.trim();

        const d = parsed.dateMentioned;
        if (typeof d === 'string') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
                out.dateMentioned = d;
            } else if (/^(today|hoy|hoje|aujourd)/i.test(d)) {
                out.dateMentioned = todayDate;
            } else if (/^(tomorrow|mañana|manana|amanh|demain)/i.test(d)) {
                const x = new Date(`${todayDate}T12:00:00`);
                x.setDate(x.getDate() + 1);
                out.dateMentioned = x.toISOString().slice(0, 10);
            }
        }
        if (typeof parsed.timeMentioned === 'string' && /^\d{1,2}:\d{2}$/.test(parsed.timeMentioned)) {
            out.timeMentioned = parsed.timeMentioned;
        }
        out.isConfirmation = parsed.isConfirmation === true;
        out.isNegation = parsed.isNegation === true;
        if (typeof parsed.nameProvided === 'string' && parsed.nameProvided.trim()) out.nameProvided = parsed.nameProvided.trim();
        if (typeof parsed.emailProvided === 'string' && /\S+@\S+\.\S+/.test(parsed.emailProvided)) out.emailProvided = parsed.emailProvided.trim();
        if (typeof parsed.questionTopic === 'string') out.questionTopic = parsed.questionTopic;
        if (typeof parsed.language === 'string') out.language = parsed.language;
        return out;
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
