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
    ): Promise<EngineResult> {
        const state = { ...currentState };

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
                return { handled: true, state, text: `${svc.name} selected. What date works for you?` };
            }
        }
        if (rawText.startsWith('slot_') && state.slots?.length) {
            const time = rawText.replace('slot_', '');
            const slot = state.slots.find(s => s.time === time);
            if (slot) { state.time = slot.time; return this.collectMissingInfo(state); }
        }
        if (rawText === 'confirm_yes') return this.createBooking(schemaName, tenantId, contactId, state);
        if (rawText === 'confirm_no') {
            Object.assign(state, { step: 'idle', serviceId: undefined, serviceName: undefined, date: undefined, slots: undefined, time: undefined });
            return { handled: true, state, text: 'No problem! Would you like to try something else?' };
        }

        // ═══════════════════════════════════════════════════
        // STATE MACHINE — deterministic transitions
        // ═══════════════════════════════════════════════════

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
                    return { handled: true, state, text: `Switched to ${newSvc.name}. What date works for you?` };
                }
            }
        }

        // ── GENERAL QUESTION mid-booking: let LLM answer BUT keep booking state ──
        if (intent.intent === 'general_question' && state.step !== 'idle' && state.step !== 'booked') {
            // Don't handle — let LLM answer the general question.
            // But DON'T reset the booking state. Next message will resume the flow.
            this.logger.log(`[Decide] General question mid-booking, letting LLM handle (booking state preserved: ${state.step})`);
            return { handled: false, state };
        }

        // ── GREET mid-booking: don't reset, just acknowledge ──
        if (intent.intent === 'greet' && state.step !== 'idle' && state.step !== 'booked') {
            return this.repromptCurrentStep(state);
        }

        // ── CANCEL: user wants to abort booking ──
        if (intent.intent === 'cancel' && state.step !== 'idle' && state.step !== 'booked') {
            Object.assign(state, { step: 'idle', serviceId: undefined, serviceName: undefined, date: undefined, slots: undefined, time: undefined });
            return { handled: true, state, text: 'No problem! Is there anything else I can help you with?' };
        }

        // ── INTENT: ask_services — but only if no service already selected ──
        if (intent.intent === 'ask_services' && !state.serviceId && state.services?.length) {
            return this.showServices(state);
        }

        // ── Have service + date → check availability ──
        if (state.serviceId && state.date && (!state.slots || !state.slots.length)) {
            return this.checkAvailability(schemaName, tenantId, contactId, state);
        }

        // ── Have service + date + time → collect info or confirm ──
        if (state.serviceId && state.date && state.time) {
            if (intent.isConfirmation && state.customerName && state.customerEmail) {
                return this.createBooking(schemaName, tenantId, contactId, state);
            }
            return this.collectMissingInfo(state);
        }

        // ── Have service but no date ──
        if (state.serviceId && !state.date) {
            state.step = 'ask_date';
            return { handled: true, state, text: `${state.serviceName} selected. What date works for you?` };
        }

        // ── User asked for a specific time that's NOT available ──
        if ((state as any)._requestedUnavailableTime && state.step === 'show_slots' && state.slots?.length) {
            const requested = (state as any)._requestedUnavailableTime;
            delete (state as any)._requestedUnavailableTime;
            const available = (state.slots ?? []).map(s => `${s.time}-${s.endTime}`).join(', ');
            return {
                handled: true, state,
                text: `The ${requested} slot is not available. Available times: ${available}. Which one works for you?`,
            };
        }

        // ── Booking intent without service → show services ──
        if ((intent.intent === 'ask_availability' || intent.intent === 'select_service') && !state.serviceId && state.services?.length) {
            return this.showServices(state);
        }

        // ── Mid-flow protection: if we're in a booking step, re-prompt ──
        if (state.step !== 'idle' && state.step !== 'booked') {
            return this.repromptCurrentStep(state);
        }

        // ── Not booking-related ──
        return { handled: false, state };
    }

    // ── Show services ──
    private showServices(state: BookingState): EngineResult {
        state.step = 'show_services';
        const svcList = (state.services || []).map((s, i) =>
            `${i + 1}. ${s.name} (${s.durationMinutes} minutes) - ${s.price.toLocaleString()} ${s.currency}`
        ).join('\n');
        return {
            handled: true, state,
            text: `These are our services:\n${svcList}\nWhich one interests you?`,
        };
    }

    // ── Check availability ──
    private async checkAvailability(schema: string, tenantId: string, contactId: string, state: BookingState): Promise<EngineResult> {
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
                text: `Available times for ${state.serviceName} on ${state.date}: ${slotList}. Which time do you prefer?`,
            };
        }

        const noDate = state.date;
        state.date = undefined; state.step = 'ask_date';
        return { handled: true, state, text: `No availability on ${noDate}. Would you like to try another date?` };
    }

    // ── Collect missing info or show confirmation ──
    private collectMissingInfo(state: BookingState): EngineResult {
        if (!state.customerName) {
            state.step = 'ask_name';
            return { handled: true, state, text: `${state.time} selected for ${state.serviceName}. What is your full name?` };
        }
        if (!state.customerEmail) {
            state.step = 'ask_email';
            return { handled: true, state, text: `Thanks ${state.customerName}! I need your email for the calendar invitation.` };
        }
        // All info collected → confirmation
        state.step = 'confirm';
        const summary = `${state.serviceName} on ${state.date} at ${state.time}\nName: ${state.customerName}\nEmail: ${state.customerEmail}`;
        return {
            handled: true, state,
            text: `Please confirm:\n${summary}\nShall I book this?`,
            buttonMessage: {
                body: `Confirm booking?\n\n${summary}`,
                buttons: [
                    { id: 'confirm_yes', title: 'Confirm' },
                    { id: 'confirm_no', title: 'Cancel' },
                ],
            },
        };
    }

    // ── Create booking ──
    private async createBooking(schema: string, tenantId: string, contactId: string, state: BookingState): Promise<EngineResult> {
        this.logger.log(`[Decide] BOOKING: ${state.serviceName} ${state.date} ${state.time} for ${state.customerName}`);
        const result = await this.toolExecutor.execute(schema, tenantId, contactId, 'create_appointment', {
            serviceId: state.serviceId, date: state.date, time: state.time,
            customerName: state.customerName, customerEmail: state.customerEmail, customerPhone: state.customerPhone,
        });
        if (result?.success) {
            state.step = 'booked';
            return {
                handled: true, state,
                text: `Appointment confirmed!\nService: ${state.serviceName}\nDate: ${state.date} at ${state.time}\nName: ${state.customerName}\nCalendar invite sent to: ${state.customerEmail}\nAnything else?`,
            };
        }
        return { handled: true, state, text: `Issue creating appointment: ${result?.error || 'Unknown'}. Try another time?` };
    }

    // ── Re-prompt current step (mid-flow protection) ──
    private repromptCurrentStep(state: BookingState): EngineResult {
        switch (state.step) {
            case 'show_services':
                return this.showServices(state);
            case 'ask_date':
                return { handled: true, state, text: `What date would you like for ${state.serviceName}?` };
            case 'show_slots':
                return { handled: true, state, text: `Which time? ${(state.slots ?? []).map(s => s.time).join(', ')}` };
            case 'ask_name':
                return { handled: true, state, text: `What is your full name?` };
            case 'ask_email':
                return { handled: true, state, text: `What is your email address?` };
            case 'confirm':
                return this.collectMissingInfo(state);
            default:
                return { handled: false, state };
        }
    }
}
