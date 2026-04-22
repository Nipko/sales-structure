import { Injectable, Logger } from '@nestjs/common';
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
    ): Promise<InterpretedIntent> {
        // First try deterministic extraction (fast, no LLM cost)
        const deterministicResult = this.deterministicExtract(userText, currentBookingStep, availableServices, todayDate, upcomingDays);
        if (deterministicResult) {
            this.logger.log(`[Interpret] Deterministic: intent=${deterministicResult.intent} service=${deterministicResult.serviceMentioned || '-'} date=${deterministicResult.dateMentioned || '-'}`);
            return deterministicResult;
        }

        // If deterministic can't handle it, use LLM for complex interpretation
        try {
            return await this.llmInterpret(userText, currentBookingStep, availableServices, todayDate, upcomingDays);
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

        // ── Detect confirmation (set flag but DON'T return yet — continue extracting) ──
        if (/^(si|sí|yes|ok|confirmo|dale|listo|perfecto|claro|correcto|de acuerdo|por supuesto|sure|oui|sim|va|vamos|eso|exacto)\b/i.test(t)) {
            base.isConfirmation = true;
            base.intent = 'confirm';
        }

        // ── Detect negation ──
        if (/^(no|nop|nope|cancel|cancelar|mejor no|nah)\b/i.test(t)) {
            base.isNegation = true;
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
        if (!base.serviceMentioned) {
            for (const svc of services) {
                if (tNorm.includes(norm(svc))) {
                    base.serviceMentioned = svc;
                    base.intent = 'select_service';
                    break;
                }
                // Word overlap
                const words = norm(svc).split(/\s+/).filter(w => w.length > 3);
                const matched = words.filter(w => tNorm.includes(w));
                if (words.length > 0 && matched.length / words.length >= 0.5) {
                    base.serviceMentioned = svc;
                    base.intent = 'select_service';
                    break;
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
            // Month names
            const months: Record<string, number> = {
                enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
                julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
            };
            for (const [name, num] of Object.entries(months)) {
                const m = t.match(new RegExp(`(\\d{1,2})\\s*(?:de\\s+)?${name}`, 'i'));
                if (m) {
                    const y = new Date(todayDate).getFullYear();
                    base.dateMentioned = `${y}-${String(num).padStart(2, '0')}-${String(parseInt(m[1])).padStart(2, '0')}`;
                    break;
                }
            }
            // Day names
            const days: Record<string, number> = {
                domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
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
        const timeMatch = t.match(/(\d{1,2})[:\.](\d{2})/);
        if (timeMatch) {
            base.timeMentioned = `${String(parseInt(timeMatch[1])).padStart(2, '0')}:${timeMatch[2]}`;
        } else {
            const hourMatch = t.match(/(?:a las |las )(\d{1,2})\s*(am|pm|de la)?/i);
            if (hourMatch) {
                let h = parseInt(hourMatch[1]);
                if (hourMatch[2]?.toLowerCase()?.startsWith('p') && h < 12) h += 12;
                base.timeMentioned = `${String(h).padStart(2, '0')}:00`;
            }
        }

        // ── Detect booking intent ──
        if (/\b(agendar|cita|reservar|turno|programar|disponib|book|appointment|schedule)\b/i.test(t)) {
            if (!base.intent || base.intent === 'unknown') base.intent = 'ask_availability';
        }

        // ── Detect name (only when step is ask_name) ──
        if (step === 'ask_name' && !base.isConfirmation && !base.isNegation) {
            const cleaned = text.replace(/[.,!?]/g, '').trim();
            const words = cleaned.split(/\s+/);
            const skip = /^(si|no|ok|hola|quiero|para|yes|gracias|el|la|los|las|un|una)\b/i;
            if (words.length >= 1 && words.length <= 5 && !/\d/.test(cleaned) && !skip.test(words[0])) {
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
        });

        try {
            const cleaned = (response.content || '').replace(/```json?\n?/g, '').replace(/```/g, '').trim();
            return JSON.parse(cleaned);
        } catch {
            this.logger.warn(`[Interpret] Failed to parse LLM JSON: ${response.content}`);
            return this.fallbackIntent(userText);
        }
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
