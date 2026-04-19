import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarIntegrationService } from '../appointments/calendar-integration.service';

/**
 * Executes AI tool calls against the appropriate services.
 * Called from ConversationsService when the LLM returns tool_calls.
 */
@Injectable()
export class AIToolExecutorService {
    private readonly logger = new Logger(AIToolExecutorService.name);

    constructor(
        private prisma: PrismaService,
        private calendarIntegration: CalendarIntegrationService,
    ) { }

    /**
     * Execute a single tool call and return the result.
     */
    async execute(
        schemaName: string,
        tenantId: string,
        contactId: string,
        toolName: string,
        args: Record<string, any>,
    ): Promise<any> {
        this.logger.log(`[Tool] Executing: ${toolName} args=${JSON.stringify(args)}`);

        try {
            switch (toolName) {
                case 'list_services':
                    return this.listServices(schemaName);

                case 'check_availability':
                    return this.checkAvailability(schemaName, args.date, args.serviceId, args.staffId);

                case 'create_appointment':
                    return this.createAppointment(schemaName, tenantId, contactId, args as any);

                case 'cancel_appointment':
                    return this.cancelAppointment(schemaName, contactId, args.appointmentId, args.reason);

                case 'list_customer_appointments':
                    return this.listCustomerAppointments(schemaName, contactId);

                default:
                    return { error: `Unknown tool: ${toolName}` };
            }
        } catch (error: any) {
            this.logger.error(`[Tool] ${toolName} failed: ${error.message}`);
            return { error: error.message };
        }
    }

    private async listServices(schema: string): Promise<any> {
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT id, name, description, duration_minutes, buffer_minutes, price, currency, is_active
             FROM "${schema}".services WHERE is_active = true AND (is_public IS NULL OR is_public = true)
             ORDER BY sort_order, name`,
        );

        return {
            services: rows.map(s => ({
                id: s.id,
                name: s.name,
                description: s.description,
                durationMinutes: s.duration_minutes,
                price: Number(s.price || 0),
                currency: s.currency || 'COP',
            })),
        };
    }

    private async checkAvailability(schema: string, date: string, serviceId: string, staffId?: string): Promise<any> {
        // Get service duration
        const svcRows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT duration_minutes, buffer_minutes FROM "${schema}".services WHERE id = $1::uuid`,
            serviceId,
        );
        if (!svcRows.length) return { error: 'Service not found' };

        const duration = svcRows[0].duration_minutes || 30;
        const buffer = svcRows[0].buffer_minutes || 0;

        // Get availability slots for the day
        const dayOfWeek = new Date(date + 'T12:00:00').getDay();

        let staffFilter = '';
        const params: any[] = [dayOfWeek];
        if (staffId) {
            staffFilter = ' AND user_id = $2::uuid';
            params.push(staffId);
        }

        const slots: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT user_id, start_time::text, end_time::text FROM "${schema}".availability_slots
             WHERE day_of_week = $1 AND is_active = true${staffFilter}`,
            ...params,
        );

        if (!slots.length) {
            // Distinguish "tenant never configured any hours" from "tenant does not
            // work this specific weekday". The first case is a misconfiguration that
            // must surface — otherwise the bot silently tells every customer there
            // is no availability and the tenant never finds out.
            const [anyRow] = (await this.prisma.$queryRawUnsafe(
                `SELECT COUNT(*)::int AS cnt FROM "${schema}".availability_slots WHERE is_active = true`,
            )) as any[];
            const hasAnySlots = Number(anyRow?.cnt || 0) > 0;
            if (!hasAnySlots) {
                this.logger.warn(`[Tool] check_availability for schema=${schema} but no active availability_slots exist — misconfiguration`);
                return {
                    available: false,
                    error: 'appointments_not_configured',
                    message: 'El sistema de agendamiento aún no está configurado en este negocio. Explícale al cliente que por ahora no puedes tomar turnos automáticamente y ofrécele escalar con un agente humano.',
                    slots: [],
                };
            }
            return { available: false, message: 'No atendemos ese día de la semana. Sugerí otra fecha al cliente.', slots: [] };
        }

        // Get existing appointments for that date
        const existing: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT assigned_to, start_at, end_at FROM "${schema}".appointments
             WHERE DATE(start_at) = $1::date AND status NOT IN ('cancelled')`,
            date,
        );

        // Check Google/Microsoft Calendar busy times
        let googleBusy: { start: string; end: string }[] = [];
        try {
            googleBusy = await this.calendarIntegration.getFreeBusyForDate(schema, date, staffId);
        } catch {
            // Calendar not connected or table doesn't exist — continue without
        }

        // Generate available time slots
        const availableSlots: any[] = [];

        for (const slot of slots) {
            const [startH, startM] = slot.start_time.split(':').map(Number);
            const [endH, endM] = slot.end_time.split(':').map(Number);
            const slotStartMin = startH * 60 + startM;
            const slotEndMin = endH * 60 + endM;

            // Generate slots every 30 min
            for (let min = slotStartMin; min + duration <= slotEndMin; min += 30) {
                const timeStr = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
                const endMin = min + duration;
                const endTimeStr = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

                // Check conflicts with existing appointments
                const slotStart = new Date(`${date}T${timeStr}:00`);
                const slotEnd = new Date(`${date}T${endTimeStr}:00`);

                const hasConflict = existing.some(apt => {
                    if (slot.user_id && apt.assigned_to && slot.user_id !== apt.assigned_to) return false;
                    const aptStart = new Date(apt.start_at);
                    const aptEnd = new Date(apt.end_at);
                    return slotStart < aptEnd && slotEnd > aptStart;
                });

                // Check conflicts with external calendar (Google/Microsoft) busy times
                const calendarConflict = googleBusy.some(busy => {
                    const busyStart = new Date(busy.start);
                    const busyEnd = new Date(busy.end);
                    return slotStart < busyEnd && slotEnd > busyStart;
                });

                if (!hasConflict && !calendarConflict) {
                    availableSlots.push({
                        time: timeStr,
                        endTime: endTimeStr,
                        userId: slot.user_id,
                    });
                }
            }
        }

        // Get user names for the slots
        const userIds = [...new Set(availableSlots.map(s => s.userId).filter(Boolean))];
        let userNames: Record<string, string> = {};
        if (userIds.length > 0) {
            const users = await this.prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, firstName: true, lastName: true },
            });
            userNames = Object.fromEntries(users.map((u: any) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
        }

        return {
            available: availableSlots.length > 0,
            date,
            slots: availableSlots.slice(0, 6).map(s => ({
                time: s.time,
                endTime: s.endTime,
                staffName: userNames[s.userId] || undefined,
                staffId: s.userId || undefined,
            })),
        };
    }

    private async createAppointment(
        schema: string, tenantId: string, contactId: string,
        args: { serviceId: string; staffId?: string; date: string; time: string; customerName: string; customerPhone?: string; customerEmail?: string; notes?: string },
    ): Promise<any> {
        // Get service
        const svcRows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT id, name, duration_minutes FROM "${schema}".services WHERE id = $1::uuid`,
            args.serviceId,
        );
        if (!svcRows.length) return { error: 'Service not found' };

        const svc = svcRows[0];
        const startAt = `${args.date}T${args.time}:00`;
        const endMinutes = parseInt(args.time.split(':')[0]) * 60 + parseInt(args.time.split(':')[1]) + svc.duration_minutes;
        const endAt = `${args.date}T${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}:00`;

        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `INSERT INTO "${schema}".appointments
             (contact_id, service_id, service_name, assigned_to, start_at, end_at, status, customer_name, customer_phone, customer_email, notes)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5::timestamp, $6::timestamp, 'confirmed', $7, $8, $9, $10)
             RETURNING id, service_name, start_at, end_at, status`,
            contactId, args.serviceId, svc.name,
            args.staffId || null,
            startAt, endAt,
            args.customerName, args.customerPhone || null, args.customerEmail || null, args.notes || null,
        );

        const apt = rows[0];
        this.logger.log(`[Tool] Appointment created: ${apt.id} for ${args.customerName}`);

        return {
            success: true,
            appointment: {
                id: apt.id,
                service: svc.name,
                date: args.date,
                time: args.time,
                status: 'confirmed',
                customerName: args.customerName,
            },
        };
    }

    private async cancelAppointment(schema: string, contactId: string, appointmentId: string, reason?: string): Promise<any> {
        // Verify ownership — only cancel if it belongs to this contact
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT id, contact_id, service_name, start_at FROM "${schema}".appointments WHERE id = $1::uuid`,
            appointmentId,
        );

        if (!rows.length) return { error: 'Appointment not found' };
        if (rows[0].contact_id !== contactId) return { error: 'You can only cancel your own appointments' };

        await this.prisma.$queryRawUnsafe(
            `UPDATE "${schema}".appointments SET status = 'cancelled', notes = COALESCE(notes, '') || $1, updated_at = NOW() WHERE id = $2::uuid`,
            reason ? `\n[Cancelado: ${reason}]` : '\n[Cancelado por el cliente]',
            appointmentId,
        );

        return { success: true, message: 'Appointment cancelled' };
    }

    private async listCustomerAppointments(schema: string, contactId: string): Promise<any> {
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT id, service_name, start_at, end_at, status, customer_name
             FROM "${schema}".appointments
             WHERE contact_id = $1::uuid AND status NOT IN ('cancelled') AND start_at >= NOW()
             ORDER BY start_at LIMIT 10`,
            contactId,
        );

        return {
            appointments: rows.map(r => ({
                id: r.id,
                service: r.service_name,
                date: new Date(r.start_at).toISOString().split('T')[0],
                time: new Date(r.start_at).toTimeString().slice(0, 5),
                status: r.status,
                customerName: r.customer_name,
            })),
        };
    }
}
