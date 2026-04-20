import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AIToolExecutorService } from './ai-tool-executor.service';

/**
 * Deterministic Booking Engine.
 *
 * Controls the ENTIRE appointment booking flow without relying on LLM decisions.
 * The LLM is only used to polish the final response text — it never decides
 * what step to take, what tool to call, or what data to collect.
 *
 * Flow:
 *   1. Parse user message for intent + data (regex/keywords)
 *   2. Update booking state deterministically
 *   3. Execute tools directly (check_availability, create_appointment)
 *   4. Build structured response with exact data
 *   5. Return response template for LLM to polish
 */

export interface BookingState {
    step: 'greeting' | 'show_services' | 'ask_date' | 'show_slots' | 'ask_info' | 'confirm' | 'booked' | 'idle';
    services?: Array<{ id: string; name: string; duration: number; price: number; currency: string }>;
    serviceId?: string;
    serviceName?: string;
    date?: string;
    slots?: Array<{ time: string; endTime: string }>;
    time?: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    lastAction?: string;
}

interface EngineResult {
    /** The response text (may contain placeholders for LLM to polish) */
    response: string;
    /** Updated booking state to persist */
    state: BookingState;
    /** Whether the booking engine handled this message (false = let LLM handle freely) */
    handled: boolean;
}

@Injectable()
export class BookingEngineService {
    private readonly logger = new Logger(BookingEngineService.name);

    constructor(
        private prisma: PrismaService,
        private toolExecutor: AIToolExecutorService,
    ) {}

    /**
     * Process a user message through the deterministic booking engine.
     * Returns a structured response if booking-related, or { handled: false } to let LLM handle.
     */
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
        let state = { ...currentState };

        // ── Load services if we don't have them ──
        if (!state.services?.length) {
            const result = await this.toolExecutor.execute(schemaName, tenantId, contactId, 'list_services', {});
            if (result?.services?.length) {
                state.services = result.services;
                this.logger.log(`[BookingEngine] Loaded ${result.services.length} services`);
            }
        }

        // ── Detect booking intent ──
        const wantsBooking = this.detectBookingIntent(text);
        const wantsServices = this.detectServiceListIntent(text);
        const mentionedService = state.services ? this.matchService(text, state.services) : null;
        const mentionedDate = this.extractDate(text, todayDate);
        const mentionedTime = state.slots ? this.matchTime(text, state.slots) : null;
        const isConfirmation = this.isConfirmation(text);
        const mentionedName = this.extractName(text, state);
        const mentionedEmail = this.extractEmail(text);

        this.logger.log(`[BookingEngine] Intent: booking=${wantsBooking} services=${wantsServices} service=${mentionedService?.name || '-'} date=${mentionedDate || '-'} time=${mentionedTime || '-'} confirm=${isConfirmation} name=${mentionedName || '-'} email=${mentionedEmail || '-'}`);

        // ── Update state with detected data ──
        if (mentionedService && !state.serviceId) {
            state.serviceId = mentionedService.id;
            state.serviceName = mentionedService.name;
        }
        if (mentionedDate && !state.date) {
            state.date = mentionedDate;
        }
        if (mentionedTime) {
            state.time = mentionedTime;
        }
        if (mentionedName) {
            state.customerName = mentionedName;
        }
        if (mentionedEmail) {
            state.customerEmail = mentionedEmail;
        }
        if (customerProfile.name && !state.customerName) {
            state.customerName = customerProfile.name;
        }
        if (customerProfile.email && !state.customerEmail) {
            state.customerEmail = customerProfile.email;
        }
        if (customerProfile.phone && !state.customerPhone) {
            state.customerPhone = customerProfile.phone;
        }

        // ── If user just wants to see services ──
        if (wantsServices && state.services?.length) {
            state.step = 'show_services';
            const serviceList = state.services.map((s, i) =>
                `${i + 1}. ${s.name} (${s.duration} min) - ${s.price.toLocaleString()} ${s.currency}`
            ).join('\n');
            return {
                response: `Estos son nuestros servicios:\n${serviceList}\n\n¿Cuál te interesa?`,
                state,
                handled: true,
            };
        }

        // ── State machine: deterministic transitions ──

        // Have service + date → get availability
        if (state.serviceId && state.date && (!state.slots || state.slots.length === 0)) {
            this.logger.log(`[BookingEngine] Calling check_availability for ${state.serviceName} on ${state.date}`);
            const result = await this.toolExecutor.execute(schemaName, tenantId, contactId, 'check_availability', {
                date: state.date,
                serviceId: state.serviceId,
            });

            if (result?.available && result.slots?.length) {
                state.slots = result.slots.slice(0, 5); // Max 5 slots
                state.step = 'show_slots';
                const slotList = (state.slots || []).map(s => `• ${s.time} - ${s.endTime}`).join('\n');
                return {
                    response: `Para ${state.serviceName} el ${state.date}, tenemos estos horarios:\n${slotList}\n\n¿Cuál prefieres?`,
                    state,
                    handled: true,
                };
            } else {
                const msg = result?.message || 'No hay disponibilidad para esa fecha.';
                state.date = undefined; // Reset date to try another
                state.step = 'ask_date';
                return {
                    response: `${msg} ¿Te gustaría probar otra fecha?`,
                    state,
                    handled: true,
                };
            }
        }

        // Have service + date + time → collect missing info or confirm
        if (state.serviceId && state.date && state.time) {
            // Need name?
            if (!state.customerName) {
                state.step = 'ask_info';
                return {
                    response: `Perfecto, ${state.serviceName} el ${state.date} a las ${state.time}. ¿Me puedes dar tu nombre completo?`,
                    state,
                    handled: true,
                };
            }
            // Need email?
            if (!state.customerEmail) {
                state.step = 'ask_info';
                return {
                    response: `Gracias ${state.customerName}. Necesito tu correo electrónico para enviarte la invitación al calendario.`,
                    state,
                    handled: true,
                };
            }
            // Have everything → confirm or book
            if (isConfirmation || state.step === 'confirm') {
                // BOOK IT
                this.logger.log(`[BookingEngine] Creating appointment: ${state.serviceName} ${state.date} ${state.time} for ${state.customerName}`);
                const result = await this.toolExecutor.execute(schemaName, tenantId, contactId, 'create_appointment', {
                    serviceId: state.serviceId,
                    date: state.date,
                    time: state.time,
                    customerName: state.customerName,
                    customerEmail: state.customerEmail,
                    customerPhone: state.customerPhone,
                });

                if (result?.success) {
                    state.step = 'booked';
                    return {
                        response: `¡Listo! Tu cita ha sido confirmada:\n\n📅 ${state.serviceName}\n📆 ${state.date} a las ${state.time}\n👤 ${state.customerName}\n📧 Recibirás una invitación en ${state.customerEmail}\n\n¿Hay algo más en lo que pueda ayudarte?`,
                        state,
                        handled: true,
                    };
                } else {
                    return {
                        response: `Hubo un problema al crear la cita: ${result?.error || 'Error desconocido'}. ¿Quieres intentar con otro horario?`,
                        state,
                        handled: true,
                    };
                }
            }

            // Ask for confirmation
            state.step = 'confirm';
            return {
                response: `Perfecto, confirmo los datos:\n\n📅 ${state.serviceName}\n📆 ${state.date} a las ${state.time}\n👤 ${state.customerName}\n📧 ${state.customerEmail}\n\n¿Confirmas la reserva?`,
                state,
                handled: true,
            };
        }

        // Have service but no date → ask for date
        if (state.serviceId && !state.date) {
            state.step = 'ask_date';
            return {
                response: `${state.serviceName}, excelente elección. ¿Para qué fecha te gustaría agendar?`,
                state,
                handled: true,
            };
        }

        // User mentioned a service in this message
        if (mentionedService && state.serviceId) {
            state.step = 'ask_date';
            return {
                response: `${state.serviceName}, excelente elección. ¿Para qué fecha te gustaría agendar?`,
                state,
                handled: true,
            };
        }

        // Generic booking intent without specific service
        if (wantsBooking && state.services?.length && !state.serviceId) {
            state.step = 'show_services';
            const serviceList = state.services.map((s, i) =>
                `${i + 1}. ${s.name} (${s.duration} min) - ${s.price.toLocaleString()} ${s.currency}`
            ).join('\n');
            return {
                response: `Con gusto te ayudo a agendar. Estos son nuestros servicios:\n${serviceList}\n\n¿Cuál te interesa?`,
                state,
                handled: true,
            };
        }

        // Not a booking-related message → let LLM handle freely
        return { response: '', state, handled: false };
    }

    // ── Intent detection (deterministic, no LLM) ──

    private detectBookingIntent(text: string): boolean {
        const keywords = [
            'agendar', 'agenda', 'cita', 'reservar', 'reserva', 'turno',
            'programar', 'book', 'appointment', 'schedule',
            'disponib', 'horario', 'hora',
        ];
        return keywords.some(k => text.includes(k));
    }

    private detectServiceListIntent(text: string): boolean {
        const patterns = [
            'servicios', 'services', 'que ofrecen', 'que tienen', 'que ofreces',
            'que tienes', 'catalogo', 'opciones', 'que hay',
        ];
        return patterns.some(p => text.includes(p));
    }

    private matchService(text: string, services: Array<{ id: string; name: string }>): { id: string; name: string } | null {
        // Exact match first
        for (const svc of services) {
            if (text.includes(svc.name.toLowerCase())) return svc;
        }
        // Word overlap match (at least 1 significant word matches)
        let bestMatch: { svc: typeof services[0]; score: number } | null = null;
        for (const svc of services) {
            const words = svc.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
            const matched = words.filter(w => text.includes(w));
            const score = words.length > 0 ? matched.length / words.length : 0;
            if (score >= 0.5 && (!bestMatch || score > bestMatch.score)) {
                bestMatch = { svc, score };
            }
        }
        return bestMatch?.svc || null;
    }

    private extractDate(text: string, todayDate: string): string | null {
        // "hoy" / "today"
        if (text.includes('hoy') || text.includes('today')) return todayDate;

        // "mañana" / "tomorrow"
        if (text.includes('mañana') || text.includes('manana') || text.includes('tomorrow')) {
            const d = new Date(todayDate);
            d.setDate(d.getDate() + 1);
            return d.toISOString().split('T')[0];
        }

        // Explicit date: "20 de abril", "abril 20", "20/04", "2026-04-20"
        const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) return isoMatch[0];

        const slashMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?/);
        if (slashMatch) {
            const day = parseInt(slashMatch[1]);
            const month = parseInt(slashMatch[2]);
            const year = slashMatch[3] ? parseInt(slashMatch[3]) : new Date(todayDate).getFullYear();
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }

        // "20 de abril", "abril 20"
        const months: Record<string, number> = {
            enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
            julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
            january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
            july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
        };
        for (const [monthName, monthNum] of Object.entries(months)) {
            const pattern1 = new RegExp(`(\\d{1,2})\\s*(?:de\\s+)?${monthName}`, 'i');
            const pattern2 = new RegExp(`${monthName}\\s*(\\d{1,2})`, 'i');
            const m1 = text.match(pattern1);
            const m2 = text.match(pattern2);
            const day = m1?.[1] || m2?.[1];
            if (day) {
                const year = new Date(todayDate).getFullYear();
                return `${year}-${String(monthNum).padStart(2, '0')}-${String(parseInt(day)).padStart(2, '0')}`;
            }
        }

        // "lunes", "martes", etc. → next occurrence
        const dayNames: Record<string, number> = {
            domingo: 0, lunes: 1, martes: 2, miercoles: 3, miércoles: 3,
            jueves: 4, viernes: 5, sabado: 6, sábado: 6,
            sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
            thursday: 4, friday: 5, saturday: 6,
        };
        for (const [dayName, dayNum] of Object.entries(dayNames)) {
            if (text.includes(dayName)) {
                const today = new Date(todayDate);
                const currentDay = today.getDay();
                let daysUntil = dayNum - currentDay;
                if (daysUntil <= 0) daysUntil += 7;
                const target = new Date(today);
                target.setDate(target.getDate() + daysUntil);
                return target.toISOString().split('T')[0];
            }
        }

        return null;
    }

    private matchTime(text: string, slots: Array<{ time: string; endTime: string }>): string | null {
        // Match "9:30", "09:30", "9.30", "a las 10", "10am", "10:00"
        const timeMatch = text.match(/(\d{1,2})[:\.](\d{2})/);
        if (timeMatch) {
            const hour = parseInt(timeMatch[1]);
            const min = parseInt(timeMatch[2]);
            const timeStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
            const matched = slots.find(s => s.time === timeStr);
            if (matched) return matched.time;
        }

        // Match "a las 10", "10am", "10 de la mañana"
        const hourMatch = text.match(/(?:a las |las )?(\d{1,2})\s*(?:am|de la mañana|de la manana)?/i);
        if (hourMatch) {
            const hour = parseInt(hourMatch[1]);
            const timeStr = `${String(hour).padStart(2, '0')}:00`;
            const matched = slots.find(s => s.time === timeStr);
            if (matched) return matched.time;
        }

        return null;
    }

    private isConfirmation(text: string): boolean {
        const confirmWords = ['si', 'sí', 'yes', 'ok', 'confirmo', 'dale', 'listo', 'perfecto', 'confirmar', 'de acuerdo', 'claro', 'por supuesto', 'correcto'];
        return confirmWords.some(w => text === w || text.startsWith(w + ' ') || text.startsWith(w + ',') || text.startsWith(w + '.'));
    }

    private extractName(text: string, state: BookingState): string | null {
        // Only try to extract name when we're in the ask_info step and don't have a name
        if (state.step !== 'ask_info' || state.customerName) return null;
        // If the text looks like a name (2-4 capitalized words, no numbers, no common words)
        const cleaned = text.replace(/[.,!?]/g, '').trim();
        const words = cleaned.split(/\s+/);
        if (words.length >= 2 && words.length <= 5 && !cleaned.match(/\d/) && !cleaned.match(/^(si|no|ok|hola|quiero|necesito|para)/i)) {
            return cleaned.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        }
        return null;
    }

    private extractEmail(text: string): string | null {
        const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
        return emailMatch ? emailMatch[0] : null;
    }
}
