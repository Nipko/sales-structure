import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { InterpretedIntent } from './intent-interpreter.service';

/**
 * DECIDE phase — pure deterministic booking flow.
 *
 * Receives structured intent from INTERPRET phase.
 * Makes ALL decisions: what to do, what tool to call, what to respond.
 * ZERO LLM calls. Pure code.
 *
 * Pipeline: INTERPRET → [DECIDE] → EXPRESS
 */

/** Booking engine messages in 4 languages */
const MESSAGES: Record<string, Record<string, string | string[]>> = {
    es: {
        serviceSelected: [
            '{service} seleccionado. ¿Qué fecha te queda bien?',
            '¡Excelente elección! Reservaremos {service}. ¿Qué día te gustaría agendar?',
            'Listo, he seleccionado {service} para ti. ¿Para qué fecha deseas la cita?',
            'Perfecto, agendaremos {service}. Cuéntame, ¿qué día te viene mejor?'
        ],
        switchedService: [
            'Cambiamos a {service}. ¿Qué fecha te queda bien?',
            'Entendido, cambiamos al servicio {service}. ¿Qué día prefieres para la cita?',
            'Listo, ahora estamos agendando {service}. ¿Qué fecha te gustaría?'
        ],
        cancelled: '¡Sin problema! ¿Hay algo más en lo que pueda ayudarte?',
        servicesHeader: 'Estos son nuestros servicios:',
        servicesFooter: '¿Cuál te interesa?',
        slotsAvailable: 'Horarios disponibles para {service} el {date}: {slots}. ¿Cuál horario prefieres?',
        noAvailability: [
            'No hay disponibilidad el {date}. ¿Te gustaría probar otra fecha?',
            'El {date} ya está completamente lleno. ¿Qué tal si intentamos con otro día?',
            'Lamentablemente no tenemos horarios libres el {date}. ¿Te sirve alguna otra fecha?',
            'Disculpa, no encontré espacios el {date}. ¿Qué otro día te gustaría intentar?'
        ],
        slotUnavailable: 'El horario de las {time} no está disponible. Horarios disponibles: {slots}. ¿Cuál te funciona?',
        askName: '{time} seleccionado para {service}. ¿Cuál es tu nombre completo?',
        askEmail: '¡Gracias {name}! Necesito tu correo electrónico para la invitación del calendario.',
        confirmPrompt: 'Por favor confirma:\n{summary}\n¿Lo agendo?',
        confirmButton: '¿Confirmar cita?\n\n{summary}',
        btnConfirm: 'Confirmar',
        btnCancel: 'Cancelar',
        booked: '¡Cita confirmada!\nServicio: {service}\nFecha: {date} a las {time}\nNombre: {name}\nInvitación enviada a: {email}\n¿Algo más?',
        bookingError: 'Error al crear la cita: {error}. ¿Probamos otro horario?',
        askDate: [
            '¿Qué fecha te gustaría para {service}?',
            '¿Para qué día quieres programar {service}?',
            '¿Qué fecha tienes disponible en tu agenda para {service}?',
            'Dime qué día te queda mejor para {service} y revisamos horarios.'
        ],
        whichTime: '¿Cuál horario? {slots}',
        whichName: '¿Cuál es tu nombre completo?',
        whichEmail: '¿Cuál es tu correo electrónico?',
        minutes: 'minutos',
        flexibleTime: 'horario libre',
        flowHeader: 'Agenda tu cita',
        flowBody: 'Toca el botón para elegir servicio, fecha y hora en un solo paso.',
        flowCta: 'Agendar',
    },
    en: {
        serviceSelected: '{service} selected. What date works for you?',
        switchedService: 'Switched to {service}. What date works for you?',
        cancelled: 'No problem! Is there anything else I can help you with?',
        servicesHeader: 'These are our services:',
        servicesFooter: 'Which one interests you?',
        slotsAvailable: 'Available times for {service} on {date}: {slots}. Which time do you prefer?',
        noAvailability: 'No availability on {date}. Would you like to try another date?',
        slotUnavailable: 'The {time} slot is not available. Available times: {slots}. Which one works for you?',
        askName: '{time} selected for {service}. What is your full name?',
        askEmail: 'Thanks {name}! I need your email for the calendar invitation.',
        confirmPrompt: 'Please confirm:\n{summary}\nShall I book this?',
        confirmButton: 'Confirm booking?\n\n{summary}',
        btnConfirm: 'Confirm',
        btnCancel: 'Cancel',
        booked: 'Appointment confirmed!\nService: {service}\nDate: {date} at {time}\nName: {name}\nCalendar invite sent to: {email}\nAnything else?',
        bookingError: 'Issue creating appointment: {error}. Try another time?',
        askDate: 'What date would you like for {service}?',
        whichTime: 'Which time? {slots}',
        whichName: 'What is your full name?',
        whichEmail: 'What is your email address?',
        minutes: 'minutes',
        flexibleTime: 'flexible time',
        flowHeader: 'Book your appointment',
        flowBody: 'Tap the button to pick a service, date and time in one step.',
        flowCta: 'Book',
    },
    pt: {
        serviceSelected: '{service} selecionado. Qual data funciona para você?',
        switchedService: 'Mudamos para {service}. Qual data funciona para você?',
        cancelled: 'Sem problema! Posso ajudar com mais alguma coisa?',
        servicesHeader: 'Estes são nossos serviços:',
        servicesFooter: 'Qual te interessa?',
        slotsAvailable: 'Horários disponíveis para {service} em {date}: {slots}. Qual horário prefere?',
        noAvailability: 'Sem disponibilidade em {date}. Gostaria de tentar outra data?',
        slotUnavailable: 'O horário das {time} não está disponível. Horários disponíveis: {slots}. Qual funciona para você?',
        askName: '{time} selecionado para {service}. Qual é seu nome completo?',
        askEmail: 'Obrigado {name}! Preciso do seu e-mail para o convite do calendário.',
        confirmPrompt: 'Por favor confirme:\n{summary}\nAgendar?',
        confirmButton: 'Confirmar agendamento?\n\n{summary}',
        btnConfirm: 'Confirmar',
        btnCancel: 'Cancelar',
        booked: 'Agendamento confirmado!\nServiço: {service}\nData: {date} às {time}\nNome: {name}\nConvite enviado para: {email}\nMais alguma coisa?',
        bookingError: 'Erro ao criar agendamento: {error}. Tentar outro horário?',
        askDate: 'Qual data gostaria para {service}?',
        whichTime: 'Qual horário? {slots}',
        whichName: 'Qual é seu nome completo?',
        whichEmail: 'Qual é seu e-mail?',
        minutes: 'minutos',
        flexibleTime: 'horário livre',
        flowHeader: 'Agende seu horário',
        flowBody: 'Toque no botão para escolher serviço, data e horário em um só passo.',
        flowCta: 'Agendar',
    },
    fr: {
        serviceSelected: '{service} sélectionné. Quelle date vous convient ?',
        switchedService: 'Changé pour {service}. Quelle date vous convient ?',
        cancelled: 'Pas de problème ! Puis-je vous aider avec autre chose ?',
        servicesHeader: 'Voici nos services :',
        servicesFooter: 'Lequel vous intéresse ?',
        slotsAvailable: 'Créneaux disponibles pour {service} le {date} : {slots}. Quel horaire préférez-vous ?',
        noAvailability: 'Pas de disponibilité le {date}. Souhaitez-vous essayer une autre date ?',
        slotUnavailable: 'Le créneau de {time} n\'est pas disponible. Créneaux disponibles : {slots}. Lequel vous convient ?',
        askName: '{time} sélectionné pour {service}. Quel est votre nom complet ?',
        askEmail: 'Merci {name} ! J\'ai besoin de votre e-mail pour l\'invitation du calendrier.',
        confirmPrompt: 'Veuillez confirmer :\n{summary}\nJe réserve ?',
        confirmButton: 'Confirmer le rendez-vous ?\n\n{summary}',
        btnConfirm: 'Confirmer',
        btnCancel: 'Annuler',
        booked: 'Rendez-vous confirmé !\nService : {service}\nDate : {date} à {time}\nNom : {name}\nInvitation envoyée à : {email}\nAutre chose ?',
        bookingError: 'Erreur lors de la création : {error}. Essayer un autre horaire ?',
        askDate: 'Quelle date souhaitez-vous pour {service} ?',
        whichTime: 'Quel horaire ? {slots}',
        whichName: 'Quel est votre nom complet ?',
        whichEmail: 'Quel est votre e-mail ?',
        minutes: 'minutes',
        flexibleTime: 'horaire libre',
        flowHeader: 'Réservez votre rendez-vous',
        flowBody: 'Touchez le bouton pour choisir service, date et heure en une étape.',
        flowCta: 'Réserver',
    },
};

/** Get message in the given language, with variable substitution */
function msg(lang: string, key: string, vars: Record<string, string> = {}): string {
    const langCode = (lang || 'es').substring(0, 2).toLowerCase();
    const msgs = MESSAGES[langCode] || MESSAGES['es'];
    const val = msgs[key] || MESSAGES['es'][key] || key;
    
    let text = '';
    if (Array.isArray(val)) {
        const idx = Math.floor(Math.random() * val.length);
        text = val[idx];
    } else {
        text = val;
    }

    for (const [k, v] of Object.entries(vars)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
    return text;
}

export interface BookingState {
    step: 'idle' | 'show_services' | 'ask_date' | 'show_slots' | 'ask_name' | 'ask_email' | 'confirm' | 'booked' | 'waiting_flow';
    services?: Array<{ id: string; name: string; durationMinutes: number; durationMinutesMax?: number; durationType?: string; price: number; currency: string }>;
    serviceId?: string;
    serviceName?: string;
    date?: string;
    slots?: Array<{ time: string; endTime: string }>;
    time?: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    /** ISO timestamp set when a WhatsApp Flow was sent; used to expire stale Flows (>1h). */
    flowStartedAt?: string;
}

export interface EngineResult {
    handled: boolean;
    state: BookingState;
    text?: string;
    listMessage?: {
        body: string;
        buttonText: string;
        sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>;
    };
    buttonMessage?: {
        body: string;
        buttons: Array<{ id: string; title: string }>;
    };
    /**
     * Opt-in WhatsApp Flow to send instead of the text flow (one-step booking form).
     * Additive: `text` is ALWAYS populated too, so a disabled flag / non-WhatsApp
     * channel / send failure degrades to the text flow without any extra branching.
     */
    flowMessage?: {
        headerText?: string;
        body: string;
        footerText?: string;
        flowCta?: string;
        initialScreen?: string;
        initialData?: Record<string, unknown>;
    };
}

@Injectable()
export class BookingEngineService {
    private readonly logger = new Logger(BookingEngineService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private toolExecutor: AIToolExecutorService,
    ) {}

    /**
     * Process using INTERPRETED intent (not raw text).
     */
    async process(
        schemaName: string,
        tenantId: string,
        contactId: string,
        intent: InterpretedIntent,
        rawText: string,
        currentState: BookingState,
        customerProfile: { name?: string; email?: string; phone?: string },
        todayDate: string,
        language: string = 'es',
        // Opt-in WhatsApp Flows: the caller decides capability (flag ON + flowId set +
        // channel is WhatsApp). The engine stays pure (doesn't read tenant.settings),
        // same principle as `language`. `flowData` carries the parsed nfm_reply fields.
        flowCapable: boolean = false,
        flowData?: Record<string, unknown>,
    ): Promise<EngineResult> {
        const state = { ...currentState };
        const L = language; // shorthand for msg() calls
        // Per-turn signal (NOT persisted): set when the user asks for a time with
        // no nearby available slot, consumed later this same turn. Previously this
        // lived on `state` and leaked into Redis/PG, firing a stale "time
        // unavailable" message on later turns.
        let requestedUnavailableTime: string | undefined;

        // ── Reload services fresh on EVERY process() call ──────────────────────────────────
        // We ALWAYS overwrite state.services from the tenantId-scoped cache or DB.
        // We never trust state.services from the persisted conversation state because
        // it could be hours old (created before the admin deactivated/edited a service).
        // The booking:services:{tenantId} cache has a 5min TTL and is invalidated
        // immediately when any service is created/updated/deleted from the panel.
        const cacheKey = `booking:services:${tenantId}`;
        try {
            const cached = await this.redis.get(cacheKey);
            if (cached) {
                state.services = JSON.parse(cached);
                this.logger.debug(`[Engine] Services loaded from cache (${state.services?.length ?? 0} active)`);
            } else {
                const result = await this.toolExecutor.execute(schemaName, tenantId, contactId, 'list_services', {});
                if (result?.services?.length) {
                    state.services = result.services;
                    await this.redis.set(cacheKey, JSON.stringify(result.services), 300); // 5 min TTL
                } else {
                    state.services = [];
                }
                this.logger.debug(`[Engine] Services reloaded from DB (${state.services?.length ?? 0} active)`);
            }
        } catch (err: any) {
            this.logger.warn(`[Engine] Failed to reload services (non-fatal): ${err.message}`);
            // Keep previous state.services as last resort — better than crashing
        }

        // ── Incoming WhatsApp Flow completion (opt-in) ──
        // The customer submitted the one-step Flow form; its fields arrived parsed in
        // `flowData`. Hydrate the state and reuse the SAME createBooking() path as the
        // text flow (the double-booking guard is included there). Missing/expired/
        // malformed data abandons the Flow and resumes the text flow gracefully.
        let flowJustAbandoned = false;
        if (state.step === 'waiting_flow') {
            const expired = !!state.flowStartedAt
                && (Date.now() - Date.parse(state.flowStartedAt)) > 3_600_000;
            if (rawText === '__flow_response__' && flowData && !expired) {
                const pick = (...keys: string[]): string => {
                    for (const k of keys) {
                        const v = (flowData as any)[k];
                        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
                    }
                    return '';
                };
                const svcId = pick('service_id', 'serviceId', 'service');
                const svc = state.services?.find(s => s.id === svcId);
                state.serviceId = svc?.id || svcId || state.serviceId;
                state.serviceName = svc?.name || pick('service_name', 'serviceName') || state.serviceName;
                state.date = pick('date', 'booking_date', 'appointment_date');
                state.time = pick('time', 'booking_time', 'appointment_time');
                state.customerName = pick('customer_name', 'name', 'full_name') || customerProfile.name || '';
                state.customerEmail = pick('customer_email', 'email') || customerProfile.email || '';
                state.customerPhone = customerProfile.phone;
                const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(state.date || '');
                const timeOk = /^\d{2}:\d{2}$/.test(state.time || '');
                // Require: a service that resolves to a REAL one (svc), valid date/time
                // FORMAT, a non-past date, and contact info. A stale/unknown service_id
                // would otherwise reach createBooking and yield a hard "service not found".
                if (svc && dateOk && timeOk && (state.date as string) >= todayDate && state.customerName && state.customerEmail) {
                    // The static Flow's date/time pickers are UNCONSTRAINED, so re-validate
                    // the chosen slot against REAL availability (business hours, blocked
                    // dates, staff schedule) — the same guard the text flow applies at
                    // show_slots. Without this, a closed/out-of-hours slot books blindly.
                    const avail = await this.toolExecutor.execute(schemaName, tenantId, contactId, 'check_availability', {
                        date: state.date, serviceId: state.serviceId,
                    });
                    const realSlots: Array<{ time: string; endTime: string }> = (avail?.available && avail.slots?.length) ? avail.slots : [];
                    if (realSlots.some(s => s.time === state.time)) {
                        state.step = 'confirm';
                        state.flowStartedAt = undefined;
                        return this.createBooking(schemaName, tenantId, contactId, state, L);
                    }
                    // The picked slot isn't actually bookable → show the real availability
                    // in text so the customer chooses a valid one (or is asked for a new date).
                    this.logger.warn(`[Engine] Flow slot ${state.date} ${state.time} not available — showing real slots`);
                    state.flowStartedAt = undefined;
                    return this.checkAvailability(schemaName, tenantId, contactId, state, L);
                }
                // Flow returned incomplete/invalid/past/unknown-service data → restart in text.
                this.logger.warn('[Engine] Flow response incomplete/invalid — falling back to text flow');
                Object.assign(state, { step: 'idle', flowStartedAt: undefined });
                return this.showServices(state, L);
            }
            // The sentinel arrived but the Flow expired (>1h) → recover in text rather than
            // leaking '__flow_response__' to the LLM. If instead the user typed real text,
            // resume the text flow and don't re-offer the Flow this turn (avoid a loop).
            if (rawText === '__flow_response__') {
                Object.assign(state, { step: 'idle', flowStartedAt: undefined });
                return this.showServices(state, L);
            }
            Object.assign(state, { step: 'idle', flowStartedAt: undefined });
            flowJustAbandoned = true;
        }

        // Safety net: a Flow response whose booking state was already lost (both the
        // Redis and PG backups expired, >1h) skips the waiting_flow branch entirely;
        // recover in text instead of forwarding the raw sentinel to the LLM.
        if (rawText === '__flow_response__' && state.step !== 'waiting_flow') {
            Object.assign(state, { step: 'idle', flowStartedAt: undefined });
            return this.showServices(state, L);
        }

        // ── Re-booking after a completed booking ──
        // step='booked' is a terminal state; without this a fresh booking intent
        // would never be handled by the engine again (it returns handled:false
        // forever at the booked guard below). Reset to idle so the new flow runs
        // clean and the customer can book a second appointment.
        if (state.step === 'booked') {
            const wantsNewBooking = intent.intent === 'ask_availability'
                || intent.intent === 'select_service'
                || !!intent.serviceMentioned
                || !!intent.dateMentioned;
            if (wantsNewBooking) {
                Object.assign(state, { step: 'idle', serviceId: undefined, serviceName: undefined, date: undefined, slots: undefined, time: undefined });
                this.logger.log('[Decide] New booking intent after a completed booking — resetting to idle');
            }
        }

        // ── Opt-in WhatsApp Flow: offer the one-step form at the START of booking ──
        // Only when step is idle (booking start) so we never yank a customer out of an
        // in-progress text flow, and only on a real booking intent. `text` is populated
        // as the fallback body, so a send failure / disabled flag degrades to text.
        if (flowCapable && !flowJustAbandoned && state.step === 'idle' && state.services?.length) {
            const wantsBooking = intent.intent === 'ask_availability'
                || intent.intent === 'select_service'
                || !!intent.serviceMentioned
                || !!intent.dateMentioned;
            if (wantsBooking) {
                state.step = 'waiting_flow';
                state.flowStartedAt = new Date().toISOString();
                return {
                    handled: true,
                    state,
                    text: msg(L, 'flowBody'),
                    flowMessage: {
                        headerText: msg(L, 'flowHeader'),
                        body: msg(L, 'flowBody'),
                        flowCta: msg(L, 'flowCta'),
                        initialScreen: 'SERVICE_SELECTION',
                        initialData: {
                            available_services: state.services.map(s => ({
                                id: s.id,
                                name: s.name,
                                duration: String(s.durationMinutes ?? ''),
                                price: String(s.price ?? ''),
                                currency: s.currency ?? '',
                            })),
                            language: L,
                        },
                    },
                };
            }
        }

        // ── Numeric/ordinal service selection: "El 1", "el primero", "la segunda"... ──
        // Runs AFTER services are loaded. Overrides intent when the user picks by index.
        // This runs in the engine (not only in the intent interpreter) so it also covers
        // the case where the interpreter already ran with the OLD step before this refresh.
        if (state.services?.length && !intent.serviceMentioned && state.step === 'show_services') {
            const tNorm = rawText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
            // "El 1", "la 2", "opcion 3", "numero 1", "#2"
            const numMatch = tNorm.match(/(?:el|la|opcion|numero|el numero|la opcion|quiero el|quiero la|#)\s*(\d+)/);
            if (numMatch) {
                const idx = parseInt(numMatch[1]) - 1;
                if (idx >= 0 && idx < state.services.length) {
                    intent.serviceMentioned = state.services[idx].name;
                    intent.intent = 'select_service';
                }
            }
            // Bare number: "1", "2" — only in show_services step to avoid false positives
            if (!intent.serviceMentioned && (state.step === 'show_services') && /^\d+$/.test(tNorm)) {
                const idx = parseInt(tNorm) - 1;
                if (idx >= 0 && idx < state.services.length) {
                    intent.serviceMentioned = state.services[idx].name;
                    intent.intent = 'select_service';
                }
            }
            // Ordinals: "el primero", "la primera", "el segundo"...
            if (!intent.serviceMentioned) {
                const ordinals: Record<string, number> = {
                    primer: 0, primero: 0, primera: 0,
                    segund: 1, segundo: 1, segunda: 1,
                    tercer: 2, tercero: 2, tercera: 2,
                    cuart: 3, cuarto: 3, cuarta: 3,
                    quint: 4, quinto: 4, quinta: 4,
                };
                for (const [word, idx] of Object.entries(ordinals)) {
                    if (tNorm.includes(word) && idx < state.services.length) {
                        intent.serviceMentioned = state.services[idx].name;
                        intent.intent = 'select_service';
                        break;
                    }
                }
            }
        }

        // ── Numeric/ordinal SLOT selection at show_slots: "el 1", "la primera", "2" ──
        // Mirrors the service-index selection but maps to the offered time slots, so
        // picking "el primero" at show_slots no longer fell through to the service
        // matcher and reset the flow.
        if (state.step === 'show_slots' && state.slots?.length && !intent.timeMentioned) {
            const tNorm = rawText.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
            const ordinals: Record<string, number> = {
                primer: 0, primero: 0, primera: 0, segund: 1, segundo: 1, segunda: 1,
                tercer: 2, tercero: 2, tercera: 2, cuart: 3, cuarto: 3, cuarta: 3,
                quint: 4, quinto: 4, quinta: 4,
            };
            let slotIdx = -1;
            const numMatch = tNorm.match(/^(?:el|la|opcion|numero|#)?\s*(\d+)$/);
            if (numMatch) {
                slotIdx = parseInt(numMatch[1]) - 1;
            } else {
                for (const [word, idx] of Object.entries(ordinals)) {
                    if (tNorm.includes(word)) { slotIdx = idx; break; }
                }
            }
            if (slotIdx >= 0 && slotIdx < state.slots.length) {
                intent.timeMentioned = state.slots[slotIdx].time;
            }
        }

        // ── If selected service was disabled/deleted, reset booking flow ──
        if (state.serviceId && state.services?.length) {
            const stillExists = state.services.some(s => s.id === state.serviceId);
            if (!stillExists) {
                this.logger.warn(`[Decide] Selected service ${state.serviceId} no longer active — resetting booking`);
                state.serviceId = undefined;
                state.serviceName = undefined;
                state.date = undefined;
                state.slots = undefined;
                state.time = undefined;
                state.step = state.services.length ? 'show_services' : 'idle';
            }
        }

        // ── Apply customer profile ──
        if (customerProfile.name && !state.customerName) state.customerName = customerProfile.name;
        if (customerProfile.email && !state.customerEmail) state.customerEmail = customerProfile.email;
        if (customerProfile.phone && !state.customerPhone) state.customerPhone = customerProfile.phone;

        // ── Apply intent data to state ──
        if (intent.serviceMentioned && !state.serviceId && state.services?.length) {
            const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
            const matched = state.services.find(s => norm(s.name) === norm(intent.serviceMentioned!));
            const fuzzy = !matched ? state.services.find(s => {
                const words = norm(s.name).split(/\s+/).filter(w => w.length > 3);
                const hit = words.filter(w => norm(intent.serviceMentioned!).includes(w));
                return words.length > 0 && hit.length / words.length >= 0.5;
            }) : null;
            const svc = matched || fuzzy;
            if (svc) {
                state.serviceId = svc.id;
                state.serviceName = svc.name;
            }
        }
        if (intent.dateMentioned) {
            // Bug #4: Reject past dates — the agent should never book in the past.
            // If the extracted date is before today, reset it so the bot re-asks.
            if (intent.dateMentioned < todayDate) {
                this.logger.warn(`[Decide] dateMentioned=${intent.dateMentioned} is in the past (today=${todayDate}) — ignoring`);
                // Clear state values so they don't persist
                state.date = undefined;
                state.slots = undefined;
                state.time = undefined;
                state.step = 'ask_date';

                // Friendly past-date feedback, localized (deterministic layer).
                const PD: Record<string, (d: string) => string> = {
                    es: d => `Disculpa, el ${d} ya pasó. 🗓️ ¿Qué otra fecha futura te gustaría seleccionar?`,
                    en: d => `Sorry, ${d} has already passed. 🗓️ What other future date works for you?`,
                    pt: d => `Desculpa, ${d} já passou. 🗓️ Que outra data futura você prefere?`,
                    fr: d => `Désolé, ${d} est déjà passé. 🗓️ Quelle autre date future préférez-vous ?`,
                };
                const text = (PD[(language || 'es').slice(0, 2)] || PD.es)(intent.dateMentioned);
                return { handled: true, state, text };
            } else {
                // Date changed → clear slots so availability is re-checked
                if (state.date && state.date !== intent.dateMentioned) {
                    state.slots = undefined;
                    state.time = undefined;
                }
                state.date = intent.dateMentioned;
            }
        }
        if (intent.timeMentioned && state.slots?.length) {
            // Bug #3: Tolerant time matching — accept the closest available slot within ±30 min.
            // Exact match first, then find nearest.
            const toMinutes = (t: string) => {
                const [h, m] = t.split(':').map(Number);
                return h * 60 + m;
            };
            const requestedMin = toMinutes(intent.timeMentioned);
            const exactSlot = state.slots.find(s => s.time === intent.timeMentioned);
            if (exactSlot) {
                state.time = exactSlot.time;
            } else {
                // Find closest slot within ±30 minutes
                let closest: { time: string; endTime: string } | undefined;
                let closestDiff = Infinity;
                for (const s of state.slots) {
                    const diff = Math.abs(toMinutes(s.time) - requestedMin);
                    if (diff < closestDiff && diff <= 30) {
                        closestDiff = diff;
                        closest = s;
                    }
                }
                if (closest) {
                    this.logger.log(`[Decide] Closest slot to ${intent.timeMentioned} is ${closest.time} (diff=${closestDiff}min)`);
                    state.time = closest.time;
                } else {
                    // Time mentioned but NOT within range of available slots — flag it
                    requestedUnavailableTime = intent.timeMentioned;
                }
            }
        }
        this.logger.log(`[Decide] State after intent: step=${state.step} svc=${state.serviceName || '-'} date=${state.date || '-'} time=${state.time || '-'} slots=${state.slots?.length || 0}`);
        if (intent.nameProvided) state.customerName = intent.nameProvided;
        if (intent.emailProvided) state.customerEmail = intent.emailProvided;

        // ── Auto-select single service ──
        const hasDateOrTime = !!(intent.dateMentioned || intent.timeMentioned);
        // A bare confirmation ("sí") only triggers booking when a flow is already
        // in progress — otherwise answering "sí" to an unrelated LLM question would
        // start a booking for single-service tenants.
        const confirmInFlow = intent.isConfirmation && state.step !== 'idle' && state.step !== 'booked';
        const isBookingTrigger = confirmInFlow || intent.intent === 'select_service' || (intent.intent === 'ask_availability' && hasDateOrTime);
        if (!state.serviceId && state.services?.length === 1 && isBookingTrigger) {
            state.serviceId = state.services[0].id;
            state.serviceName = state.services[0].name;
            this.logger.log(`[Decide] Auto-selected single service: ${state.serviceName}`);
        }

        this.logger.log(`[Decide] intent=${intent.intent} svc=${state.serviceName || '-'} date=${state.date || '-'} step=${state.step}`);

        // ── HANDLE INTERACTIVE REPLIES (svc_, slot_, confirm_) ──
        if (rawText.startsWith('svc_') && state.services?.length) {
            const svc = state.services.find(s => s.id === rawText.replace('svc_', ''));
            if (svc) {
                state.serviceId = svc.id; state.serviceName = svc.name; state.step = 'ask_date';
                return { handled: true, state, text: msg(L, 'serviceSelected', { service: svc.name }) };
            }
        }
        if (rawText.startsWith('slot_') && state.slots?.length) {
            const time = rawText.replace('slot_', '');
            const slot = state.slots.find(s => s.time === time);
            if (slot) { state.time = slot.time; return this.collectMissingInfo(state, L); }
        }
        if (rawText === 'confirm_yes') return this.createBooking(schemaName, tenantId, contactId, state, L);
        if (rawText === 'confirm_no') {
            Object.assign(state, { step: 'idle', serviceId: undefined, serviceName: undefined, date: undefined, slots: undefined, time: undefined });
            return { handled: true, state, text: msg(L, 'cancelled') };
        }

        // ═══════════════════════════════════════════════════
        // STATE MACHINE — deterministic transitions
        // ═══════════════════════════════════════════════════

        // ── Already booked — don't re-process ──
        if (state.step === 'booked') {
            return { handled: false, state }; // Let LLM handle any follow-up naturally
        }

        // ── CHANGE OF OPINION: user mentions a DIFFERENT service mid-flow ──
        if (intent.serviceMentioned && state.serviceId && state.serviceName) {
            const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
            if (norm(intent.serviceMentioned) !== norm(state.serviceName)) {
                // User changed their mind — reset and apply new service
                const newSvc = state.services?.find(s => norm(s.name).includes(norm(intent.serviceMentioned!)));
                if (newSvc) {
                    state.serviceId = newSvc.id; state.serviceName = newSvc.name;
                    state.date = undefined; state.slots = undefined; state.time = undefined;
                    state.step = 'ask_date';
                    this.logger.log(`[Decide] Changed service to: ${newSvc.name}`);
                    return { handled: true, state, text: msg(L, 'switchedService', { service: newSvc.name }) };
                }
            }
        }

        // ── GENERAL QUESTION mid-booking: let LLM answer BUT keep booking state ──
        if (intent.intent === 'general_question' && state.step !== 'idle') {
            // Don't handle — let LLM answer the general question.
            // But DON'T reset the booking state. Next message will resume the flow.
            this.logger.log(`[Decide] General question mid-booking, letting LLM handle (booking state preserved: ${state.step})`);
            return { handled: false, state };
        }

        // ── GREET mid-booking: don't reset, just acknowledge ──
        if (intent.intent === 'greet' && state.step !== 'idle') {
            return this.repromptCurrentStep(state, L);
        }

        // ── CANCEL: user wants to abort booking ──
        if (intent.intent === 'cancel' && state.step !== 'idle') {
            Object.assign(state, { step: 'idle', serviceId: undefined, serviceName: undefined, date: undefined, slots: undefined, time: undefined });
            return { handled: true, state, text: msg(L, 'cancelled') };
        }

        // ── INTENT: ask_services — but only if no service already selected ──
        if (intent.intent === 'ask_services' && !state.serviceId && state.services?.length) {
            return this.showServices(state, L);
        }

        // ── Have service + date → check availability ──
        if (state.serviceId && state.date && (!state.slots || !state.slots.length)) {
            return this.checkAvailability(schemaName, tenantId, contactId, state, L);
        }

        // ── Have service + date + time → collect info or confirm ──
        if (state.serviceId && state.date && state.time) {
            if (intent.isConfirmation && state.customerName && state.customerEmail) {
                return this.createBooking(schemaName, tenantId, contactId, state, L);
            }
            return this.collectMissingInfo(state, L);
        }

        // ── Have service but no date ──
        if (state.serviceId && !state.date) {
            state.step = 'ask_date';
            return { handled: true, state, text: msg(L, 'serviceSelected', { service: state.serviceName || '' }) };
        }

        // ── User asked for a specific time that's NOT available ──
        if (requestedUnavailableTime && state.step === 'show_slots' && state.slots?.length) {
            const requested = requestedUnavailableTime;
            const available = (state.slots ?? []).map(s => `${s.time}-${s.endTime}`).join(', ');
            return {
                handled: true, state,
                text: msg(L, 'slotUnavailable', { time: requested, slots: available }),
            };
        }

        // ── Booking intent without service → show services ──
        if ((intent.intent === 'ask_availability' || intent.intent === 'select_service') && !state.serviceId && state.services?.length) {
            return this.showServices(state, L);
        }

        // ── Mid-flow protection: if we're in a booking step, re-prompt ──
        if (state.step !== 'idle') {
            return this.repromptCurrentStep(state, L);
        }

        // ── Not booking-related ──
        return { handled: false, state };
    }

    // ── Show services ──
    private showServices(state: BookingState, lang: string): EngineResult {
        state.step = 'show_services';
        const svcList = (state.services || []).map((s, i) => {
            let durLabel = '';
            const dtype = s.durationType || 'fixed';
            if (dtype === 'open') {
                durLabel = ` (${msg(lang, 'flexibleTime')})`;
            } else if (dtype === 'flexible' && s.durationMinutesMax) {
                durLabel = ` (${s.durationMinutes}-${s.durationMinutesMax} ${msg(lang, 'minutes')})`;
            } else if (s.durationMinutes > 0) {
                durLabel = ` (${s.durationMinutes} ${msg(lang, 'minutes')})`;
            }
            const priceLabel = s.price > 0
                ? ` - ${s.price.toLocaleString('es-CO')} ${s.currency}`
                : '';
            return `${i + 1}. ${s.name}${durLabel}${priceLabel}`;
        }).join('\n');
        return {
            handled: true, state,
            text: `${msg(lang, 'servicesHeader')}\n${svcList}\n${msg(lang, 'servicesFooter')}`,
        };
    }

    // ── Check availability ──
    private async checkAvailability(schema: string, tenantId: string, contactId: string, state: BookingState, lang: string): Promise<EngineResult> {
        this.logger.log(`[Decide] Checking availability: ${state.serviceName} on ${state.date}`);
        const result = await this.toolExecutor.execute(schema, tenantId, contactId, 'check_availability', {
            date: state.date, serviceId: state.serviceId,
        });

        if (result?.available && result.slots?.length) {
            state.slots = result.slots.slice(0, 6);
            state.step = 'show_slots';
            const slotList = (state.slots ?? []).map(s => `${s.time} - ${s.endTime}`).join(', ');
            return {
                handled: true, state,
                text: msg(lang, 'slotsAvailable', { service: state.serviceName || '', date: state.date || '', slots: slotList }),
            };
        }

        const noDate = state.date;
        state.date = undefined; state.step = 'ask_date';
        return { handled: true, state, text: msg(lang, 'noAvailability', { date: noDate || '' }) };
    }

    // ── Collect missing info or show confirmation ──
    private collectMissingInfo(state: BookingState, lang: string): EngineResult {
        if (!state.customerName) {
            state.step = 'ask_name';
            return { handled: true, state, text: msg(lang, 'askName', { time: state.time || '', service: state.serviceName || '' }) };
        }
        if (!state.customerEmail) {
            state.step = 'ask_email';
            return { handled: true, state, text: msg(lang, 'askEmail', { name: state.customerName }) };
        }
        // All info collected → confirmation. Localized labels so the summary doesn't
        // mix English ("on"/"at"/"Name") into an otherwise translated prompt.
        const SL: Record<string, { on: string; at: string; name: string; email: string }> = {
            es: { on: 'el', at: 'a las', name: 'Nombre', email: 'Email' },
            en: { on: 'on', at: 'at', name: 'Name', email: 'Email' },
            pt: { on: 'em', at: 'às', name: 'Nome', email: 'Email' },
            fr: { on: 'le', at: 'à', name: 'Nom', email: 'Email' },
        };
        const sl = SL[(lang || 'es').slice(0, 2)] || SL.es;
        state.step = 'confirm';
        const summary = `${state.serviceName} ${sl.on} ${state.date} ${sl.at} ${state.time}\n${sl.name}: ${state.customerName}\n${sl.email}: ${state.customerEmail}`;
        return {
            handled: true, state,
            text: msg(lang, 'confirmPrompt', { summary }),
            buttonMessage: {
                body: msg(lang, 'confirmButton', { summary }),
                buttons: [
                    { id: 'confirm_yes', title: msg(lang, 'btnConfirm') },
                    { id: 'confirm_no', title: msg(lang, 'btnCancel') },
                ],
            },
        };
    }

    // ── Create booking ──
    private async createBooking(schema: string, tenantId: string, contactId: string, state: BookingState, lang: string): Promise<EngineResult> {
        this.logger.log(`[Decide] BOOKING: ${state.serviceName} ${state.date} ${state.time} for ${state.customerName}`);

        // Bug #5: Normalize startAt to ISO 8601 to avoid timezone-sensitive timestamp comparison.
        // Using AT TIME ZONE ensures the DB compares in tenant-local time regardless of server TZ.
        try {
            const startAt = `${state.date}T${state.time}:00`;
            const existing: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id FROM "${schema}".appointments
                 WHERE contact_id = $1::uuid
                   AND service_id = $2::uuid
                   AND start_at = $3::timestamptz
                   AND status NOT IN ('cancelled') LIMIT 1`,
                contactId, state.serviceId, startAt,
            );
            if (existing?.length) {
                this.logger.warn(`[Decide] Duplicate booking prevented — appointment ${existing[0].id} already exists`);
                state.step = 'booked';
                return {
                    handled: true, state,
                    text: msg(lang, 'booked', { service: state.serviceName || '', date: state.date || '', time: state.time || '', name: state.customerName || '', email: state.customerEmail || '' }),
                };
            }
        } catch (err) {
            this.logger.warn(`[Decide] Duplicate check failed (non-blocking): ${(err as any).message}`);
        }

        const result = await this.toolExecutor.execute(schema, tenantId, contactId, 'create_appointment', {
            serviceId: state.serviceId, date: state.date, time: state.time,
            customerName: state.customerName, customerEmail: state.customerEmail, customerPhone: state.customerPhone,
        });
        if (result?.success) {
            state.step = 'booked';
            return {
                handled: true, state,
                text: msg(lang, 'booked', { service: state.serviceName || '', date: state.date || '', time: state.time || '', name: state.customerName || '', email: state.customerEmail || '' }),
            };
        }
        return { handled: true, state, text: msg(lang, 'bookingError', { error: result?.error || 'Unknown' }) };
    }

    // ── Re-prompt current step (mid-flow protection) ──
    private repromptCurrentStep(state: BookingState, lang: string): EngineResult {
        switch (state.step) {
            case 'show_services':
                return this.showServices(state, lang);
            case 'ask_date':
                return { handled: true, state, text: msg(lang, 'askDate', { service: state.serviceName || '' }) };
            case 'show_slots':
                return { handled: true, state, text: msg(lang, 'whichTime', { slots: (state.slots ?? []).map(s => s.time).join(', ') }) };
            case 'ask_name':
                return { handled: true, state, text: msg(lang, 'whichName') };
            case 'ask_email':
                return { handled: true, state, text: msg(lang, 'whichEmail') };
            case 'confirm':
                return this.collectMissingInfo(state, lang);
            default:
                return { handled: false, state };
        }
    }
}
