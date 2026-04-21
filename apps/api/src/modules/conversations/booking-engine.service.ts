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
            if (slot) state.time = slot.time;
        }
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
                return { handled: true, state, text: `[ASK_DATE] ${svc.name} selected. What date works for you?` };
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
            return { handled: true, state, text: '[CANCELLED] No problem! Would you like to try something else?' };
        }

        // ═══════════════════════════════════════════════════
        // STATE MACHINE — deterministic transitions
        // ═══════════════════════════════════════════════════

        // ── INTENT: ask_services ──
        if (intent.intent === 'ask_services' && state.services?.length) {
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
            return { handled: true, state, text: `[ASK_DATE] ${state.serviceName} selected. What date works for you?` };
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

    // ── Show services (with interactive list) ──
    private showServices(state: BookingState): EngineResult {
        state.step = 'show_services';
        const svcList = (state.services || []).map((s, i) =>
            `${i + 1}. ${s.name} (${s.durationMinutes}min - ${s.price.toLocaleString()} ${s.currency})`
        ).join('\n');
        return {
            handled: true, state,
            text: `[SERVICES] Here are our services:\n${svcList}\nWhich one interests you?`,
            listMessage: state.services && state.services.length > 0 ? {
                body: 'Select a service:',
                buttonText: 'View services',
                sections: [{
                    title: 'Services',
                    rows: (state.services || []).map(s => ({
                        id: `svc_${s.id}`,
                        title: s.name.slice(0, 24),
                        description: `${s.durationMinutes}min - ${s.price.toLocaleString()} ${s.currency}`.slice(0, 72),
                    })),
                }],
            } : undefined,
        };
    }

    // ── Check availability ──
    private async checkAvailability(schema: string, tenantId: string, contactId: string, state: BookingState): Promise<EngineResult> {
        this.logger.log(`[Decide] Checking availability: ${state.serviceName} on ${state.date}`);
        const result = await this.toolExecutor.execute(schema, tenantId, contactId, 'check_availability', {
            date: state.date, serviceId: state.serviceId,
        });

        if (result?.available && result.slots?.length) {
            state.slots = result.slots.slice(0, 10);
            state.step = 'show_slots';
            const slotList = (state.slots ?? []).map(s => `${s.time}-${s.endTime}`).join(', ');
            return {
                handled: true, state,
                text: `[SLOTS] Available for ${state.serviceName} on ${state.date}: ${slotList}. Which time?`,
                listMessage: {
                    body: `Available for ${state.serviceName} on ${state.date}:`,
                    buttonText: 'See times',
                    sections: [{
                        title: 'Times',
                        rows: (state.slots ?? []).map(s => ({
                            id: `slot_${s.time}`,
                            title: `${s.time} - ${s.endTime}`,
                        })),
                    }],
                },
            };
        }

        state.date = undefined; state.step = 'ask_date';
        return { handled: true, state, text: `[NO_SLOTS] No availability on ${state.date}. Try another date?` };
    }

    // ── Collect missing info or show confirmation ──
    private collectMissingInfo(state: BookingState): EngineResult {
        if (!state.customerName) {
            state.step = 'ask_name';
            return { handled: true, state, text: `[ASK_NAME] ${state.time} selected for ${state.serviceName}. What is your full name?` };
        }
        if (!state.customerEmail) {
            state.step = 'ask_email';
            return { handled: true, state, text: `[ASK_EMAIL] Thanks ${state.customerName}! I need your email for the calendar invitation.` };
        }
        // All info collected → confirmation
        state.step = 'confirm';
        const summary = `${state.serviceName} on ${state.date} at ${state.time}\nName: ${state.customerName}\nEmail: ${state.customerEmail}`;
        return {
            handled: true, state,
            text: `[CONFIRM] Please confirm:\n${summary}\nShall I book this?`,
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
                text: `[BOOKED] Appointment confirmed!\nService: ${state.serviceName}\nDate: ${state.date} at ${state.time}\nName: ${state.customerName}\nCalendar invite sent to: ${state.customerEmail}\nAnything else?`,
            };
        }
        return { handled: true, state, text: `[ERROR] Issue creating appointment: ${result?.error || 'Unknown'}. Try another time?` };
    }

    // ── Re-prompt current step (mid-flow protection) ──
    private repromptCurrentStep(state: BookingState): EngineResult {
        switch (state.step) {
            case 'show_services':
                return this.showServices(state);
            case 'ask_date':
                return { handled: true, state, text: `[ASK_DATE] What date would you like for ${state.serviceName}?` };
            case 'show_slots':
                return { handled: true, state, text: `[ASK_SLOT] Which time? ${(state.slots ?? []).map(s => s.time).join(', ')}` };
            case 'ask_name':
                return { handled: true, state, text: `[ASK_NAME] What is your full name?` };
            case 'ask_email':
                return { handled: true, state, text: `[ASK_EMAIL] What is your email address?` };
            case 'confirm':
                return this.collectMissingInfo(state);
            default:
                return { handled: false, state };
        }
    }
}
