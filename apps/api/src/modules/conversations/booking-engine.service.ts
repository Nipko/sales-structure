import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
const MESSAGES: Record<string, Record<string, string>> = {
    es: {
        serviceSelected: '{service} seleccionado. ¿Qué fecha te queda bien?',
        switchedService: 'Cambiamos a {service}. ¿Qué fecha te queda bien?',
        cancelled: '¡Sin problema! ¿Hay algo más en lo que pueda ayudarte?',
        servicesHeader: 'Estos son nuestros servicios:',
        servicesFooter: '¿Cuál te interesa?',
        slotsAvailable: 'Horarios disponibles para {service} el {date}: {slots}. ¿Cuál horario prefieres?',
        noAvailability: 'No hay disponibilidad el {date}. ¿Te gustaría probar otra fecha?',
        slotUnavailable: 'El horario de las {time} no está disponible. Horarios disponibles: {slots}. ¿Cuál te funciona?',
        askName: '{time} seleccionado para {service}. ¿Cuál es tu nombre completo?',
        askEmail: '¡Gracias {name}! Necesito tu correo electrónico para la invitación del calendario.',
        confirmPrompt: 'Por favor confirma:\n{summary}\n¿Lo agendo?',
        confirmButton: '¿Confirmar cita?\n\n{summary}',
        btnConfirm: 'Confirmar',
        btnCancel: 'Cancelar',
        booked: '¡Cita confirmada!\nServicio: {service}\nFecha: {date} a las {time}\nNombre: {name}\nInvitación enviada a: {email}\n¿Algo más?',
        bookingError: 'Error al crear la cita: {error}. ¿Probamos otro horario?',
        askDate: '¿Qué fecha te gustaría para {service}?',
        whichTime: '¿Cuál horario? {slots}',
        whichName: '¿Cuál es tu nombre completo?',
        whichEmail: '¿Cuál es tu correo electrónico?',
        minutes: 'minutos',
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
    },
};

/** Get message in the given language, with variable substitution */
function msg(lang: string, key: string, vars: Record<string, string> = {}): string {
    const langCode = (lang || 'es').substring(0, 2).toLowerCase();
    const msgs = MESSAGES[langCode] || MESSAGES['es'];
    let text = msgs[key] || MESSAGES['es'][key] || key;
    for (const [k, v] of Object.entries(vars)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
    return text;
}

export interface BookingState {
    step: 'idle' | 'show_services' | 'ask_date' | 'show_slots' | 'ask_name' | 'ask_email' | 'confirm' | 'booked';
    services?: Array<{ id: string; name: string; durationMinutes: number; price: number; currency: string }>;
    serviceId?: string;
    serviceName?: string;
    date?: string;
    slots?: Array<{ time: string; endTime: string }>;
    time?: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
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
}

@Injectable()
export class BookingEngineService {
    private readonly logger = new Logger(BookingEngineService.name);

    constructor(
        private prisma: PrismaService,
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
    ): Promise<EngineResult> {
        const state = { ...currentState };
        const L = language; // shorthand for msg() calls

        // ── Pre-load services ──
        if (!state.services?.length) {
            try {
                const result = await this.toolExecutor.execute(schemaName, tenantId, contactId, 'list_services', {});
                if (result?.services?.length) state.services = result.services;
            } catch {}
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
        if (intent.dateMentioned) state.date = intent.dateMentioned;
        if (intent.timeMentioned && state.slots?.length) {
            const slot = state.slots.find(s => s.time === intent.timeMentioned);
            if (slot) {
                state.time = slot.time;
            } else {
                // Time mentioned but NOT available — flag it so we can inform the customer
                (state as any)._requestedUnavailableTime = intent.timeMentioned;
            }
        }
        this.logger.log(`[Decide] State after intent: step=${state.step} svc=${state.serviceName || '-'} date=${state.date || '-'} time=${state.time || '-'} slots=${state.slots?.length || 0}`);
        if (intent.nameProvided) state.customerName = intent.nameProvided;
        if (intent.emailProvided) state.customerEmail = intent.emailProvided;

        // ── Auto-select single service ──
        if (!state.serviceId && state.services?.length === 1 && (intent.isConfirmation || intent.intent === 'ask_availability')) {
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
        if ((state as any)._requestedUnavailableTime && state.step === 'show_slots' && state.slots?.length) {
            const requested = (state as any)._requestedUnavailableTime;
            delete (state as any)._requestedUnavailableTime;
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
        const svcList = (state.services || []).map((s, i) =>
            `${i + 1}. ${s.name} (${s.durationMinutes} ${msg(lang, 'minutes')}) - ${s.price.toLocaleString()} ${s.currency}`
        ).join('\n');
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
        // All info collected → confirmation
        state.step = 'confirm';
        const summary = `${state.serviceName} on ${state.date} at ${state.time}\nName: ${state.customerName}\nEmail: ${state.customerEmail}`;
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

        // ── Duplicate check — prevent double booking ──
        try {
            const startAt = `${state.date} ${state.time}`;
            const existing: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id FROM "${schema}".appointments WHERE contact_id = $1::uuid AND service_id = $2::uuid AND start_at = $3::timestamp AND status NOT IN ('cancelled') LIMIT 1`,
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
            this.logger.warn(`[Decide] Duplicate check failed (non-blocking): ${err.message}`);
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
