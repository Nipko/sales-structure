import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AIToolExecutorService } from './ai-tool-executor.service';

/**
 * Deterministic Booking Engine with Interactive Message support.
 *
 * When the channel supports interactive messages (WhatsApp, Telegram),
 * sends structured list/button messages for reliable data collection.
 * For text-only channels (SMS), falls back to numbered options.
 *
 * The LLM is NEVER used for booking flow decisions.
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

/** What kind of response to send */
export interface EngineResult {
    /** If true, the engine handled this — send the interactive or text response directly, don't call the LLM */
    handled: boolean;
    /** Updated state to persist */
    state: BookingState;
    /** Plain text response (for LLM polishing or text-only channels) */
    text?: string;
    /** Interactive list message (WhatsApp) */
    listMessage?: {
        body: string;
        buttonText: string;
        sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>;
    };
    /** Interactive button message (WhatsApp) */
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

    async process(
        schemaName: string,
        tenantId: string,
        contactId: string,
        userText: string,
        currentState: BookingState,
        customerProfile: { name?: string; email?: string; phone?: string },
        todayDate: string,
    ): Promise<EngineResult> {
        const text = userText.toLowerCase().trim();
        const state = { ...currentState };

        // ── Pre-load services ──
        if (!state.services?.length) {
            try {
                const result = await this.toolExecutor.execute(schemaName, tenantId, contactId, 'list_services', {});
                if (result?.services?.length) state.services = result.services;
            } catch {}
        }

        // ── Check if this is an interactive reply (button/list selection) ──
        const isInteractiveReply = text.startsWith('svc_') || text.startsWith('slot_') || text === 'confirm_yes' || text === 'confirm_no';

        // ── HANDLE INTERACTIVE REPLIES (from button/list clicks) ──
        if (isInteractiveReply) {
            // Service selection
            if (text.startsWith('svc_') && state.services?.length) {
                const svc = state.services.find(s => s.id === text.replace('svc_', ''));
                if (svc) {
                    state.serviceId = svc.id;
                    state.serviceName = svc.name;
                    state.step = 'ask_date';
                    return {
                        handled: true, state,
                        text: `${svc.name}, great choice! What date would you like? You can say "today", "tomorrow", or a specific date.`,
                    };
                }
            }

            // Time slot selection
            if (text.startsWith('slot_') && state.slots?.length) {
                const time = text.replace('slot_', '');
                const slot = state.slots.find(s => s.time === time);
                if (slot) {
                    state.time = slot.time;
                    if (!state.customerName) {
                        state.step = 'ask_name';
                        return { handled: true, state, text: `${state.time}, perfect! What is your full name?` };
                    }
                    if (!state.customerEmail) {
                        state.step = 'ask_email';
                        return { handled: true, state, text: `Thanks ${state.customerName}! I need your email to send the calendar invitation.` };
                    }
                    // All data collected — show confirmation
                    return this.buildConfirmation(state);
                }
            }

            // Confirmation
            if (text === 'confirm_yes') {
                return this.createBooking(schemaName, tenantId, contactId, state);
            }
            if (text === 'confirm_no') {
                state.step = 'idle';
                state.serviceId = undefined; state.serviceName = undefined;
                state.date = undefined; state.slots = undefined; state.time = undefined;
                return { handled: true, state, text: 'No problem! Would you like to try a different time or service?' };
            }
        }

        // ── DETECT INTENT FROM FREE TEXT ──
        const wantsServices = this.detectServiceListIntent(text);
        const wantsBooking = this.detectBookingIntent(text);
        const matchedService = state.services ? this.matchService(text, state.services) : null;
        const detectedDate = this.extractDate(text, todayDate);
        const detectedEmail = this.extractEmail(text);
        const isConfirm = this.isConfirmation(text);

        // Update state with detected data
        if (matchedService && !state.serviceId) {
            state.serviceId = matchedService.id;
            state.serviceName = matchedService.name;
        }
        if (detectedDate) state.date = detectedDate;
        if (detectedEmail) state.customerEmail = detectedEmail;
        if (customerProfile.name && !state.customerName) state.customerName = customerProfile.name;
        if (customerProfile.email && !state.customerEmail) state.customerEmail = customerProfile.email;
        if (customerProfile.phone && !state.customerPhone) state.customerPhone = customerProfile.phone;

        // Extract name if we're in ask_name step
        if (state.step === 'ask_name' && !state.customerName && !isConfirm && !wantsBooking && !wantsServices) {
            const possibleName = this.extractName(text);
            if (possibleName) {
                state.customerName = possibleName;
                if (!state.customerEmail) {
                    state.step = 'ask_email';
                    return { handled: true, state, text: `Thanks ${state.customerName}! I need your email to send the calendar invitation.` };
                }
                return this.buildConfirmation(state);
            }
        }

        // Extract email if we're in ask_email step
        if (state.step === 'ask_email' && detectedEmail) {
            return this.buildConfirmation(state);
        }

        this.logger.log(`[BookingEngine] svc=${matchedService?.name || '-'} date=${detectedDate || '-'} step=${state.step}`);

        // ── SHOW SERVICES (interactive list) ──
        if ((wantsServices || (wantsBooking && !state.serviceId)) && state.services?.length) {
            state.step = 'show_services';
            return {
                handled: true, state,
                text: `Here are our services:\n${state.services.map((s, i) => `${i + 1}. ${s.name} (${s.durationMinutes}min - ${s.price.toLocaleString()} ${s.currency})`).join('\n')}\n\nWhich one interests you?`,
                listMessage: {
                    body: 'Here are our available services. Tap to select:',
                    buttonText: 'View services',
                    sections: [{
                        title: 'Services',
                        rows: state.services.map(s => ({
                            id: `svc_${s.id}`,
                            title: s.name.slice(0, 24),
                            description: `${s.durationMinutes}min - ${s.price.toLocaleString()} ${s.currency}`.slice(0, 72),
                        })),
                    }],
                },
            };
        }

        // ── SERVICE SELECTED + DATE DETECTED → GET AVAILABILITY ──
        if (state.serviceId && state.date && (!state.slots || state.slots.length === 0)) {
            this.logger.log(`[BookingEngine] Checking availability: ${state.serviceName} on ${state.date}`);
            const result = await this.toolExecutor.execute(schemaName, tenantId, contactId, 'check_availability', {
                date: state.date, serviceId: state.serviceId,
            });

            if (result?.available && result.slots?.length) {
                state.slots = result.slots.slice(0, 10); // WhatsApp list max 10
                state.step = 'show_slots';
                const slotList = (state.slots ?? []).map(s => `${s.time}-${s.endTime}`).join(', ');
                return {
                    handled: true, state,
                    text: `For ${state.serviceName} on ${state.date}: ${slotList}. Which time do you prefer?`,
                    listMessage: {
                        body: `Available times for ${state.serviceName} on ${state.date}:`,
                        buttonText: 'See times',
                        sections: [{
                            title: 'Available',
                            rows: (state.slots || []).map(s => ({
                                id: `slot_${s.time}`,
                                title: `${s.time} - ${s.endTime}`,
                            })),
                        }],
                    },
                };
            } else {
                state.date = undefined;
                state.step = 'ask_date';
                return { handled: true, state, text: 'No availability for that date. Would you like to try a different day?' };
            }
        }

        // ── SERVICE SELECTED BUT NO DATE ──
        if (state.serviceId && !state.date) {
            state.step = 'ask_date';
            return { handled: true, state, text: `${state.serviceName}, great choice! What date works for you?` };
        }

        // ── HAS TIME BUT MISSING INFO ──
        if (state.serviceId && state.date && state.time) {
            if (!state.customerName) {
                state.step = 'ask_name';
                return { handled: true, state, text: `${state.time}, perfect! What is your full name?` };
            }
            if (!state.customerEmail) {
                state.step = 'ask_email';
                return { handled: true, state, text: `Thanks ${state.customerName}! I need your email for the calendar invitation.` };
            }
            if (isConfirm) {
                return this.createBooking(schemaName, tenantId, contactId, state);
            }
            return this.buildConfirmation(state);
        }

        // ── SLOT SELECTED FROM TEXT (not interactive) ──
        if (state.step === 'show_slots' && state.slots?.length) {
            const matchedTime = this.matchTime(text, state.slots);
            if (matchedTime) {
                state.time = matchedTime;
                if (!state.customerName) {
                    state.step = 'ask_name';
                    return { handled: true, state, text: `${state.time}, perfect! What is your full name?` };
                }
                if (!state.customerEmail) {
                    state.step = 'ask_email';
                    return { handled: true, state, text: `Thanks ${state.customerName}! I need your email for the calendar invitation.` };
                }
                return this.buildConfirmation(state);
            }
        }

        // ── Not booking-related → let LLM handle ──
        return { handled: false, state, text: '' };
    }

    // ── Build confirmation with buttons ──
    private buildConfirmation(state: BookingState): EngineResult {
        state.step = 'confirm';
        const summary = `Service: ${state.serviceName}\nDate: ${state.date} at ${state.time}\nName: ${state.customerName}\nEmail: ${state.customerEmail}`;
        return {
            handled: true, state,
            text: `Please confirm your booking:\n${summary}\n\nShall I confirm?`,
            buttonMessage: {
                body: `Confirm your booking?\n\n${summary}`,
                buttons: [
                    { id: 'confirm_yes', title: 'Confirm' },
                    { id: 'confirm_no', title: 'Cancel' },
                ],
            },
        };
    }

    // ── Create the actual booking ──
    private async createBooking(schemaName: string, tenantId: string, contactId: string, state: BookingState): Promise<EngineResult> {
        this.logger.log(`[BookingEngine] CREATING: ${state.serviceName} ${state.date} ${state.time} for ${state.customerName}`);
        const result = await this.toolExecutor.execute(schemaName, tenantId, contactId, 'create_appointment', {
            serviceId: state.serviceId, date: state.date, time: state.time,
            customerName: state.customerName, customerEmail: state.customerEmail, customerPhone: state.customerPhone,
        });
        if (result?.success) {
            state.step = 'booked';
            return {
                handled: true, state,
                text: `Your appointment is confirmed!\n\nService: ${state.serviceName}\nDate: ${state.date} at ${state.time}\nName: ${state.customerName}\n\nA calendar invitation will be sent to ${state.customerEmail}.\n\nAnything else I can help with?`,
            };
        }
        return { handled: true, state, text: `There was an issue: ${result?.error || 'Unknown error'}. Try a different time?` };
    }

    // ── Intent detection (multi-language) ──
    private detectBookingIntent(text: string): boolean {
        return /\b(agendar|cita|reservar|turno|programar|disponib|horario|book|appointment|schedule|available|agendar|consulta|marcar|rendez-vous|réserver)\b/i.test(text);
    }

    private detectServiceListIntent(text: string): boolean {
        return /\b(servicios|services|que ofrecen|que tienen|que ofreces|que tienes|opciones|serviços|servicos|catalogue|catalogo)\b/i.test(text);
    }

    private matchService(text: string, services: Array<{ id: string; name: string }>): typeof services[0] | null {
        // Normalize accents for comparison
        const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const normText = norm(text);
        for (const svc of services) {
            if (normText.includes(norm(svc.name))) return svc;
        }
        // Word overlap (50%+)
        let best: { svc: typeof services[0]; score: number } | null = null;
        for (const svc of services) {
            const words = norm(svc.name).split(/\s+/).filter(w => w.length > 3);
            const matched = words.filter(w => normText.includes(w));
            const score = words.length > 0 ? matched.length / words.length : 0;
            if (score >= 0.5 && (!best || score > best.score)) best = { svc, score };
        }
        return best?.svc || null;
    }

    private extractDate(text: string, todayDate: string): string | null {
        if (/\b(hoy|today|hoje|aujourd)/i.test(text)) return todayDate;
        if (/\b(mañana|manana|tomorrow|amanhã|amanha|demain)\b/i.test(text)) {
            const d = new Date(todayDate); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0];
        }
        const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/); if (iso) return iso[0];
        const months: Record<string, number> = {
            enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
            january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
        };
        for (const [name, num] of Object.entries(months)) {
            const m = text.match(new RegExp(`(\\d{1,2})\\s*(?:de\\s+)?${name}`, 'i')) || text.match(new RegExp(`${name}\\s*(\\d{1,2})`, 'i'));
            if (m) { const y = new Date(todayDate).getFullYear(); return `${y}-${String(num).padStart(2, '0')}-${String(parseInt(m[1])).padStart(2, '0')}`; }
        }
        const days: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
        for (const [name, num] of Object.entries(days)) {
            if (text.includes(name)) {
                const today = new Date(todayDate); let diff = num - today.getDay(); if (diff <= 0) diff += 7;
                const t = new Date(today); t.setDate(t.getDate() + diff); return t.toISOString().split('T')[0];
            }
        }
        return null;
    }

    private matchTime(text: string, slots: Array<{ time: string; endTime: string }>): string | null {
        const m = text.match(/(\d{1,2})[:\.](\d{2})/);
        if (m) { const t = `${String(parseInt(m[1])).padStart(2, '0')}:${m[2]}`; if (slots.find(s => s.time === t)) return t; }
        const h = text.match(/(?:a las |at |las )?(\d{1,2})\s*(?:am|de la)?/i);
        if (h) { const t = `${String(parseInt(h[1])).padStart(2, '0')}:00`; if (slots.find(s => s.time === t)) return t; }
        return null;
    }

    private isConfirmation(text: string): boolean {
        return /^(si|sí|yes|ok|confirmo|dale|listo|perfecto|confirm|sure|oui|sim|claro|correcto|de acuerdo)\b/i.test(text);
    }

    private extractName(text: string): string | null {
        const c = text.replace(/[.,!?]/g, '').trim();
        const w = c.split(/\s+/);
        if (w.length >= 2 && w.length <= 5 && !/\d/.test(c) && !/^(si|no|ok|hola|quiero|para|yes|oui|sim)\b/i.test(c)) {
            return w.map(x => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase()).join(' ');
        }
        return null;
    }

    private extractEmail(text: string): string | null {
        const m = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
        return m ? m[0] : null;
    }
}
