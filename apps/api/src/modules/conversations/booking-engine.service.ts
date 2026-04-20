import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AIToolExecutorService } from './ai-tool-executor.service';

/**
 * Deterministic Booking Engine.
 *
 * Controls the ENTIRE appointment booking flow without relying on LLM decisions.
 * All response templates are in ENGLISH — the LLM adapts them to the customer's
 * language and regional tone (Colombian Spanish, Mexican Spanish, Brazilian
 * Portuguese, French, etc.) based on the persona configuration.
 *
 * Intent detection keywords support: Spanish, English, Portuguese, French.
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
}

interface EngineResult {
    /** Response template in English — LLM will adapt to customer's language */
    response: string;
    /** Updated booking state to persist */
    state: BookingState;
    /** Whether the booking engine handled this message */
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
        const state = { ...currentState };

        // ── Load services if needed ──
        if (!state.services?.length) {
            const result = await this.toolExecutor.execute(schemaName, tenantId, contactId, 'list_services', {});
            if (result?.services?.length) {
                state.services = result.services;
                this.logger.log(`[BookingEngine] Loaded ${result.services.length} services`);
            }
        }

        // ── Parse user message ──
        const wantsServices = this.detectServiceListIntent(text);
        const wantsBooking = this.detectBookingIntent(text);
        const mentionedService = state.services ? this.matchService(text, state.services) : null;
        const mentionedDate = this.extractDate(text, todayDate);
        const mentionedTime = state.slots ? this.matchTime(text, state.slots) : null;
        const isConfirm = this.isConfirmation(text);
        const mentionedName = this.extractName(text, state);
        const mentionedEmail = this.extractEmail(text);

        // ── Update state with new data ──
        if (mentionedService && !state.serviceId) {
            state.serviceId = mentionedService.id;
            state.serviceName = mentionedService.name;
        }
        if (mentionedDate) state.date = mentionedDate;
        if (mentionedTime) state.time = mentionedTime;
        if (mentionedName) state.customerName = mentionedName;
        if (mentionedEmail) state.customerEmail = mentionedEmail;
        if (customerProfile.name && !state.customerName) state.customerName = customerProfile.name;
        if (customerProfile.email && !state.customerEmail) state.customerEmail = customerProfile.email;
        if (customerProfile.phone && !state.customerPhone) state.customerPhone = customerProfile.phone;

        this.logger.log(`[BookingEngine] Parse: service=${mentionedService?.name || '-'} date=${mentionedDate || '-'} time=${mentionedTime || '-'} confirm=${isConfirm}`);

        // ── Show services ──
        if (wantsServices && state.services?.length) {
            state.step = 'show_services';
            const serviceList = state.services.map((s, i) =>
                `${i + 1}. ${s.name} (${s.duration} min) - ${s.price.toLocaleString()} ${s.currency}`
            ).join('\n');
            return {
                response: `[SERVICES_LIST]\nThese are our available services:\n${serviceList}\n\nWhich one interests you?`,
                state, handled: true,
            };
        }

        // ── Have service + date → get availability ──
        if (state.serviceId && state.date && (!state.slots || state.slots.length === 0)) {
            this.logger.log(`[BookingEngine] Checking availability: ${state.serviceName} on ${state.date}`);
            const result = await this.toolExecutor.execute(schemaName, tenantId, contactId, 'check_availability', {
                date: state.date, serviceId: state.serviceId,
            });

            if (result?.available && result.slots?.length) {
                state.slots = result.slots.slice(0, 5);
                state.step = 'show_slots';
                const slotList = (state.slots || []).map(s => `${s.time} - ${s.endTime}`).join(', ');
                return {
                    response: `[SHOW_SLOTS]\nFor ${state.serviceName} on ${state.date}, these times are available: ${slotList}. Which one do you prefer?`,
                    state, handled: true,
                };
            } else {
                state.date = undefined;
                state.step = 'ask_date';
                return {
                    response: `[NO_AVAILABILITY]\nThere is no availability for ${state.date}. Would you like to try a different date?`,
                    state, handled: true,
                };
            }
        }

        // ── Have service + date + time → collect info or confirm ──
        if (state.serviceId && state.date && state.time) {
            if (!state.customerName) {
                state.step = 'ask_info';
                return {
                    response: `[ASK_NAME]\n${state.serviceName} on ${state.date} at ${state.time}. What is your full name?`,
                    state, handled: true,
                };
            }
            if (!state.customerEmail) {
                state.step = 'ask_info';
                return {
                    response: `[ASK_EMAIL]\nThank you ${state.customerName}. I need your email address to send you the calendar invitation.`,
                    state, handled: true,
                };
            }

            // All info collected → confirm or book
            if (isConfirm || state.step === 'confirm') {
                this.logger.log(`[BookingEngine] Creating appointment: ${state.serviceName} ${state.date} ${state.time} for ${state.customerName}`);
                const result = await this.toolExecutor.execute(schemaName, tenantId, contactId, 'create_appointment', {
                    serviceId: state.serviceId, date: state.date, time: state.time,
                    customerName: state.customerName, customerEmail: state.customerEmail,
                    customerPhone: state.customerPhone,
                });

                if (result?.success) {
                    state.step = 'booked';
                    return {
                        response: `[BOOKED]\nYour appointment is confirmed!\nService: ${state.serviceName}\nDate: ${state.date} at ${state.time}\nName: ${state.customerName}\nA calendar invitation will be sent to ${state.customerEmail}.\nIs there anything else I can help you with?`,
                        state, handled: true,
                    };
                } else {
                    return {
                        response: `[BOOKING_ERROR]\nThere was a problem creating the appointment: ${result?.error || 'Unknown error'}. Would you like to try a different time?`,
                        state, handled: true,
                    };
                }
            }

            // Show confirmation summary
            state.step = 'confirm';
            return {
                response: `[CONFIRM]\nPlease confirm the booking details:\nService: ${state.serviceName}\nDate: ${state.date} at ${state.time}\nName: ${state.customerName}\nEmail: ${state.customerEmail}\nShall I confirm this reservation?`,
                state, handled: true,
            };
        }

        // ── Have service but no date ──
        if (state.serviceId && !state.date) {
            state.step = 'ask_date';
            return {
                response: `[ASK_DATE]\n${state.serviceName}, great choice. What date would you like to schedule?`,
                state, handled: true,
            };
        }

        // ── Booking intent without specific service ──
        if (wantsBooking && state.services?.length && !state.serviceId) {
            state.step = 'show_services';
            const serviceList = state.services.map((s, i) =>
                `${i + 1}. ${s.name} (${s.duration} min) - ${s.price.toLocaleString()} ${s.currency}`
            ).join('\n');
            return {
                response: `[BOOKING_START]\nI'd be happy to help you schedule. Here are our services:\n${serviceList}\n\nWhich one would you like?`,
                state, handled: true,
            };
        }

        // ── Not booking-related ──
        return { response: '', state, handled: false };
    }

    // ── Multi-language intent detection ──

    private detectBookingIntent(text: string): boolean {
        const keywords = [
            // Spanish
            'agendar', 'agenda', 'cita', 'reservar', 'reserva', 'turno', 'programar', 'disponib', 'horario',
            // English
            'book', 'appointment', 'schedule', 'available', 'slot',
            // Portuguese
            'agendar', 'consulta', 'marcar', 'horário', 'horario', 'disponível', 'disponivel',
            // French
            'rendez-vous', 'réserver', 'reserver', 'disponible', 'créneau', 'creneau',
        ];
        return keywords.some(k => text.includes(k));
    }

    private detectServiceListIntent(text: string): boolean {
        const patterns = [
            // Spanish
            'servicios', 'que ofrecen', 'que tienen', 'que ofreces', 'que tienes', 'catalogo', 'opciones',
            // English
            'services', 'what do you offer', 'options', 'catalog', 'what do you have',
            // Portuguese
            'serviços', 'servicos', 'o que oferecem', 'o que vocês', 'o que voces', 'opcões', 'opcoes',
            // French
            'services', 'que proposez', 'offrez', 'options', 'catalogue',
        ];
        return patterns.some(p => text.includes(p));
    }

    private matchService(text: string, services: Array<{ id: string; name: string }>): { id: string; name: string } | null {
        // Exact name match
        for (const svc of services) {
            if (text.includes(svc.name.toLowerCase())) return svc;
        }
        // Word overlap (50%+ of significant words match)
        let best: { svc: typeof services[0]; score: number } | null = null;
        for (const svc of services) {
            const words = svc.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
            const matched = words.filter(w => text.includes(w));
            const score = words.length > 0 ? matched.length / words.length : 0;
            if (score >= 0.5 && (!best || score > best.score)) {
                best = { svc, score };
            }
        }
        return best?.svc || null;
    }

    private extractDate(text: string, todayDate: string): string | null {
        // Today: es/en/pt/fr
        if (/\b(hoy|today|hoje|aujourd'hui|aujourd)\b/.test(text)) return todayDate;

        // Tomorrow
        if (/\b(mañana|manana|tomorrow|amanhã|amanha|demain)\b/.test(text)) {
            const d = new Date(todayDate); d.setDate(d.getDate() + 1);
            return d.toISOString().split('T')[0];
        }

        // ISO date: 2026-04-20
        const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return iso[0];

        // Slash date: 20/04, 20/04/2026
        const slash = text.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?/);
        if (slash) {
            const day = parseInt(slash[1]); const month = parseInt(slash[2]);
            const year = slash[3] ? parseInt(slash[3]) : new Date(todayDate).getFullYear();
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }

        // Month names (es/en/pt/fr)
        const months: Record<string, number> = {
            enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
            julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
            january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
            july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
            janeiro: 1, fevereiro: 2, março: 3, marco: 3, maio: 5, junho: 6,
            julho: 7, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
            janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
            juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12,
        };
        for (const [name, num] of Object.entries(months)) {
            const p1 = new RegExp(`(\\d{1,2})\\s*(?:de\\s+)?${name}`, 'i');
            const p2 = new RegExp(`${name}\\s*(\\d{1,2})`, 'i');
            const m = text.match(p1) || text.match(p2);
            if (m) {
                const year = new Date(todayDate).getFullYear();
                return `${year}-${String(num).padStart(2, '0')}-${String(parseInt(m[1])).padStart(2, '0')}`;
            }
        }

        // Day names (es/en/pt/fr) → next occurrence
        const days: Record<string, number> = {
            domingo: 0, lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6,
            sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
            dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
        };
        for (const [name, num] of Object.entries(days)) {
            if (text.includes(name)) {
                const today = new Date(todayDate);
                let diff = num - today.getDay();
                if (diff <= 0) diff += 7;
                const target = new Date(today); target.setDate(target.getDate() + diff);
                return target.toISOString().split('T')[0];
            }
        }

        return null;
    }

    private matchTime(text: string, slots: Array<{ time: string; endTime: string }>): string | null {
        // "9:30", "09:30", "9.30"
        const exact = text.match(/(\d{1,2})[:\.](\d{2})/);
        if (exact) {
            const t = `${String(parseInt(exact[1])).padStart(2, '0')}:${exact[2]}`;
            if (slots.find(s => s.time === t)) return t;
        }
        // "a las 10", "at 10", "às 10", "10am"
        const hour = text.match(/(?:a las |at |às |as )?(\d{1,2})\s*(?:am|de la|da manhã|du matin)?/i);
        if (hour) {
            const t = `${String(parseInt(hour[1])).padStart(2, '0')}:00`;
            if (slots.find(s => s.time === t)) return t;
        }
        return null;
    }

    private isConfirmation(text: string): boolean {
        const words = [
            // Spanish
            'si', 'sí', 'confirmo', 'dale', 'listo', 'perfecto', 'de acuerdo', 'claro', 'por supuesto', 'correcto',
            // English
            'yes', 'ok', 'confirm', 'sure', 'absolutely', 'go ahead', 'correct', 'right',
            // Portuguese
            'sim', 'confirmo', 'pode', 'perfeito', 'com certeza', 'claro', 'certo',
            // French
            'oui', 'confirme', 'parfait', "d'accord", 'bien sûr', 'bien sur', 'correct',
        ];
        return words.some(w => text === w || text.startsWith(w + ' ') || text.startsWith(w + ',') || text.startsWith(w + '.'));
    }

    private extractName(text: string, state: BookingState): string | null {
        if (state.step !== 'ask_info' || state.customerName) return null;
        const cleaned = text.replace(/[.,!?]/g, '').trim();
        const words = cleaned.split(/\s+/);
        const skipWords = /^(si|sí|no|ok|hola|hi|quiero|necesito|para|yes|oui|sim|olá|ola|bonjour|obrigado|gracias|thanks|merci)$/i;
        if (words.length >= 2 && words.length <= 5 && !cleaned.match(/\d/) && !skipWords.test(words[0])) {
            return cleaned.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        }
        return null;
    }

    private extractEmail(text: string): string | null {
        const m = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
        return m ? m[0] : null;
    }
}
