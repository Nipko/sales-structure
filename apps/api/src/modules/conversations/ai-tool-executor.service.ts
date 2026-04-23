import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarIntegrationService } from '../appointments/calendar-integration.service';
import { FaqsService } from '../faqs/faqs.service';
import { PoliciesService } from '../policies/policies.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import type { PolicyType } from '@parallext/shared';

/**
 * Executes AI tool calls against the appropriate services.
 * Called from ConversationsService when the LLM returns tool_calls.
 */
@Injectable()
export class AIToolExecutorService {
    private readonly logger = new Logger(AIToolExecutorService.name);

    constructor(
        private prisma: PrismaService,
        private eventEmitter: EventEmitter2,
        private calendarIntegration: CalendarIntegrationService,
        private faqsService: FaqsService,
        private policiesService: PoliciesService,
        private knowledgeService: KnowledgeService,
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

                case 'search_products':
                    return this.searchProducts(schemaName, args.query, args.limit, args.category);

                case 'get_product':
                    return this.getProduct(schemaName, args.productId);

                case 'check_stock':
                    return this.checkStock(schemaName, args.productId);

                case 'search_faqs':
                    return this.searchFaqs(tenantId, args.query, args.limit);

                case 'get_policy':
                    return this.getPolicy(tenantId, args.type as PolicyType);

                case 'search_knowledge_base':
                    return this.searchKnowledgeBase(tenantId, args.query, args.limit);

                case 'list_customer_orders':
                    return this.listCustomerOrders(schemaName, contactId, args.limit, args.status);

                case 'list_active_offers':
                    return this.listActiveOffers(schemaName, args.limit);

                case 'get_customer_context':
                    return this.getCustomerContext(schemaName, contactId);

                default:
                    return { error: `Unknown tool: ${toolName}` };
            }
        } catch (error: any) {
            this.logger.error(`[Tool] ${toolName} failed: ${error.message}`);
            return { error: error.message };
        }
    }

    // ── Catalog + Inventory tools ─────────────────────────────

    /**
     * Search products by natural-language query. Hits the `products` table in
     * the tenant schema. Falls back to courses if products table is empty.
     */
    private async searchProducts(schema: string, query: string, limit = 5, category?: string): Promise<any> {
        const q = `%${query}%`;
        const conds: string[] = [];
        const params: any[] = [];
        conds.push(`(name ILIKE $${params.length + 1} OR description ILIKE $${params.length + 1} OR category ILIKE $${params.length + 1})`);
        params.push(q);
        if (category) {
            conds.push(`category = $${params.length + 1}`);
            params.push(category);
        }
        conds.push(`is_available = true`);
        params.push(limit);
        const sql = `SELECT id, name, description, category, price, currency, stock, is_available, images
                     FROM "${schema}".products
                     WHERE ${conds.slice(0, -1).join(' AND ')}
                     ORDER BY name ASC
                     LIMIT $${params.length}`;
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(sql, ...params);
            if (rows.length > 0) {
                return {
                    products: rows.map(p => ({
                        id: p.id,
                        name: p.name,
                        description: p.description,
                        category: p.category,
                        price: Number(p.price || 0),
                        currency: p.currency || 'COP',
                        stock: p.stock ?? null,
                        isAvailable: !!p.is_available,
                    })),
                };
            }
        } catch (e: any) {
            this.logger.warn(`[Tool] search_products products table missing or empty: ${e.message}`);
        }
        // Fallback: search courses
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id, name, description, price, currency, duration_hours, modality
                 FROM "${schema}".courses
                 WHERE is_active = true AND (name ILIKE $1 OR description ILIKE $1)
                 ORDER BY name ASC LIMIT $2`,
                q, limit,
            );
            return {
                products: rows.map(c => ({
                    id: c.id,
                    name: c.name,
                    description: c.description,
                    category: 'course',
                    price: Number(c.price || 0),
                    currency: c.currency || 'COP',
                    durationHours: c.duration_hours,
                    modality: c.modality,
                    isAvailable: true,
                })),
            };
        } catch {
            return { products: [] };
        }
    }

    private async getProduct(schema: string, productIdOrName: string): Promise<any> {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productIdOrName);
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                isUuid
                    ? `SELECT id, name, description, category, price, currency, stock, is_available, images, metadata FROM "${schema}".products WHERE id = $1::uuid LIMIT 1`
                    : `SELECT id, name, description, category, price, currency, stock, is_available, images, metadata FROM "${schema}".products WHERE name ILIKE $1 LIMIT 1`,
                productIdOrName,
            );
            if (rows.length > 0) {
                const p = rows[0];
                return {
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    category: p.category,
                    price: Number(p.price || 0),
                    currency: p.currency || 'COP',
                    stock: p.stock ?? null,
                    isAvailable: !!p.is_available,
                    images: Array.isArray(p.images) ? p.images : [],
                };
            }
        } catch (e: any) {
            this.logger.warn(`[Tool] get_product products lookup failed: ${e.message}`);
        }
        return { error: 'Product not found' };
    }

    private async checkStock(schema: string, productIdOrName: string): Promise<any> {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productIdOrName);
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                isUuid
                    ? `SELECT id, name, stock, is_available FROM "${schema}".products WHERE id = $1::uuid LIMIT 1`
                    : `SELECT id, name, stock, is_available FROM "${schema}".products WHERE name ILIKE $1 LIMIT 1`,
                productIdOrName,
            );
            if (rows.length > 0) {
                const p = rows[0];
                return {
                    id: p.id,
                    name: p.name,
                    stock: p.stock ?? null,
                    inStock: p.stock == null ? p.is_available : Number(p.stock) > 0,
                };
            }
        } catch (e: any) {
            this.logger.warn(`[Tool] check_stock failed: ${e.message}`);
        }
        return { error: 'Product not found' };
    }

    // ── Knowledge tools ──────────────────────────────────────

    private async searchFaqs(tenantId: string, query: string, limit = 3): Promise<any> {
        const faqs = await this.faqsService.search(tenantId, query, limit);
        // Fire-and-forget: track views
        for (const f of faqs) this.faqsService.incrementViews(tenantId, f.id);
        return {
            faqs: faqs.map(f => ({
                id: f.id,
                question: f.question,
                answer: f.answer,
                category: f.category,
            })),
        };
    }

    private async getPolicy(tenantId: string, type: PolicyType): Promise<any> {
        const policy = await this.policiesService.getActive(tenantId, type);
        if (!policy) return { error: `No ${type} policy is configured for this business.` };
        return {
            type: policy.type,
            title: policy.title,
            content: policy.content,
            version: policy.version,
        };
    }

    // ── Orders / Offers / CRM tools ─────────────────────────────

    /**
     * List recent orders for the current contact. No contactId param — it's
     * already resolved from the conversation. Returns a compact view.
     */
    private async listCustomerOrders(schema: string, contactId: string, limit = 5, status?: string): Promise<any> {
        if (!contactId) return { orders: [], error: 'No contact resolved for this conversation.' };
        try {
            const conds: string[] = ['contact_id = $1::uuid'];
            const params: any[] = [contactId];
            if (status) {
                conds.push(`status = $${params.length + 1}`);
                params.push(status);
            }
            params.push(limit);
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id, status, total_amount, currency, payment_status, items, created_at
                 FROM "${schema}".orders
                 WHERE ${conds.join(' AND ')}
                 ORDER BY created_at DESC
                 LIMIT $${params.length}`,
                ...params,
            );
            return {
                orders: rows.map(o => ({
                    id: o.id,
                    status: o.status,
                    paymentStatus: o.payment_status,
                    totalAmount: Number(o.total_amount || 0),
                    currency: o.currency,
                    items: Array.isArray(o.items) ? o.items : [],
                    createdAt: o.created_at,
                })),
            };
        } catch (e: any) {
            this.logger.warn(`[Tool] list_customer_orders failed: ${e.message}`);
            return { orders: [] };
        }
    }

    /**
     * Active commercial offers. Filters by active=true and NOW() between
     * valid_from and valid_to (nulls treated as open-ended).
     */
    private async listActiveOffers(schema: string, limit = 5): Promise<any> {
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT o.id, o.offer_type, o.title, o.conditions_json, o.valid_from, o.valid_to,
                        c.name AS course_name
                 FROM "${schema}".commercial_offers o
                 LEFT JOIN "${schema}".courses c ON c.id = o.course_id
                 WHERE o.active = true
                   AND (o.valid_from IS NULL OR o.valid_from <= NOW())
                   AND (o.valid_to IS NULL OR o.valid_to >= NOW())
                 ORDER BY o.valid_from DESC NULLS LAST
                 LIMIT $1`,
                limit,
            );
            return {
                offers: rows.map(o => ({
                    id: o.id,
                    type: o.offer_type,
                    title: o.title,
                    conditions: o.conditions_json,
                    appliesTo: o.course_name ?? null,
                    validFrom: o.valid_from,
                    validTo: o.valid_to,
                })),
            };
        } catch (e: any) {
            this.logger.warn(`[Tool] list_active_offers failed: ${e.message}`);
            return { offers: [] };
        }
    }

    /**
     * CRM context: lead score, stage, tags, opportunity count, last seen.
     * Gracefully handles missing tables — a tenant without the leads table
     * still gets a basic contact profile.
     */
    private async getCustomerContext(schema: string, contactId: string): Promise<any> {
        if (!contactId) return { error: 'No contact resolved for this conversation.' };

        let contact: any = null;
        try {
            const cRows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id, name, email, phone, tags, first_contact_at, last_contact_at, metadata
                 FROM "${schema}".contacts WHERE id = $1::uuid LIMIT 1`,
                contactId,
            );
            contact = cRows[0] || null;
        } catch (e: any) {
            this.logger.warn(`[Tool] get_customer_context contacts lookup failed: ${e.message}`);
        }

        let lead: any = null;
        try {
            const lRows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id, stage, score, first_name, last_name, created_at
                 FROM "${schema}".leads WHERE contact_id = $1::uuid ORDER BY created_at DESC LIMIT 1`,
                contactId,
            );
            lead = lRows[0] || null;
        } catch {}

        let opportunitiesCount = 0;
        try {
            const oRows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT COUNT(*)::int AS cnt FROM "${schema}".opportunities WHERE contact_id = $1::uuid`,
                contactId,
            );
            opportunitiesCount = Number(oRows[0]?.cnt || 0);
        } catch {}

        return {
            contact: contact ? {
                id: contact.id,
                name: contact.name,
                email: contact.email,
                phone: contact.phone,
                tags: Array.isArray(contact.tags) ? contact.tags : [],
                firstContactAt: contact.first_contact_at,
                lastContactAt: contact.last_contact_at,
            } : null,
            lead: lead ? {
                stage: lead.stage,
                score: lead.score,
                firstName: lead.first_name,
                lastName: lead.last_name,
            } : null,
            opportunitiesCount,
        };
    }

    // ── Knowledge tools ─────────────────────────────

    private async searchKnowledgeBase(tenantId: string, query: string, limit = 5): Promise<any> {
        try {
            const hasKnowledge = await this.knowledgeService.tenantHasKnowledge(tenantId);
            if (!hasKnowledge) return { chunks: [] };
            const results = await this.knowledgeService.searchRelevant(tenantId, query, limit);
            return {
                chunks: (results || []).map((r: any) => ({
                    id: r.id ?? r.document_id,
                    title: r.title,
                    content: r.chunk_text,
                    score: typeof r.score === 'number' ? r.score : (typeof r.similarity === 'number' ? r.similarity : undefined),
                })),
            };
        } catch (e: any) {
            this.logger.warn(`[Tool] search_knowledge_base failed: ${e.message}`);
            return { chunks: [] };
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

    /** Resolve tenant timezone from persona_config or default */
    private async getTenantTimezone(schema: string): Promise<string> {
        try {
            const rows = await this.prisma.$queryRawUnsafe(
                `SELECT config_json->'hours'->>'timezone' as tz FROM "${schema}".persona_config WHERE is_active = true LIMIT 1`,
            ) as any[];
            return rows[0]?.tz || 'America/Bogota';
        } catch {
            return 'America/Bogota';
        }
    }

    private async checkAvailability(schema: string, date: string, serviceId: string, staffId?: string): Promise<any> {
        // Resolve serviceId — LLM may pass name instead of UUID
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(serviceId);
        let resolvedServiceId = serviceId;

        if (!isUUID) {
            // LLM passed service name — look it up by name (case-insensitive fuzzy match)
            this.logger.warn(`[Tool] serviceId "${serviceId}" is not a UUID — resolving by name`);
            const nameMatch: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id FROM "${schema}".services WHERE is_active = true AND LOWER(name) LIKE $1 LIMIT 1`,
                `%${serviceId.toLowerCase()}%`,
            );
            if (!nameMatch.length) return { error: `Service "${serviceId}" not found. Call list_services to get valid service IDs.` };
            resolvedServiceId = nameMatch[0].id;
            this.logger.log(`[Tool] Resolved service name "${serviceId}" → UUID ${resolvedServiceId}`);
        }

        // Get service duration
        const svcRows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT duration_minutes, buffer_minutes FROM "${schema}".services WHERE id = $1::uuid`,
            resolvedServiceId,
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
            if (googleBusy.length > 0) {
                this.logger.log(`[Tool] Calendar busy times for ${date}: ${JSON.stringify(googleBusy)}`);
            } else {
                this.logger.log(`[Tool] No calendar busy times found for ${date} (calendar may not be connected or no events)`);
            }
        } catch (e: any) {
            this.logger.warn(`[Tool] Calendar busy check failed: ${e.message}`);
        }

        // Get tenant timezone for calendar comparison
        const tenantTz = await this.getTenantTimezone(schema);

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

                // Check conflicts — use simple time comparison (minutes since midnight)
                // to avoid timezone issues. Both slot times and busy times are
                // converted to minutes-of-day for comparison.
                const slotStartMinOfDay = min;
                const slotEndMinOfDay = min + duration;

                const hasConflict = existing.some(apt => {
                    if (slot.user_id && apt.assigned_to && slot.user_id !== apt.assigned_to) return false;
                    const aptStart = new Date(apt.start_at);
                    const aptEnd = new Date(apt.end_at);
                    // Compare using full datetime for DB appointments (stored in tenant TZ)
                    const slotStart = new Date(`${date}T${timeStr}:00`);
                    const slotEnd = new Date(`${date}T${endTimeStr}:00`);
                    return slotStart < aptEnd && slotEnd > aptStart;
                });

                // Check conflicts with external calendar (Google/Microsoft) busy times.
                // Google Calendar returns times in UTC/ISO format, so we extract
                // hours:minutes and compare as minutes-of-day in local time.
                const calendarConflict = googleBusy.some(busy => {
                    // Parse busy times — could be UTC ("Z") or offset ("+05:00")
                    const busyStartDate = new Date(busy.start);
                    const busyEndDate = new Date(busy.end);
                    // Get hours/minutes in tenant timezone (America/Bogota etc.)
                    // We use the date's local representation for comparison
                    const busyStartLocal = busyStartDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tenantTz });
                    const busyEndLocal = busyEndDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tenantTz });
                    const [bsH, bsM] = busyStartLocal.split(':').map(Number);
                    const [beH, beM] = busyEndLocal.split(':').map(Number);
                    const busyStartMin = bsH * 60 + bsM;
                    const busyEndMin = beH * 60 + beM;
                    return slotStartMinOfDay < busyEndMin && slotEndMinOfDay > busyStartMin;
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
        // Resolve serviceId — LLM may pass name instead of UUID
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.serviceId);
        if (!isUUID) {
            const nameMatch: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id FROM "${schema}".services WHERE is_active = true AND LOWER(name) LIKE $1 LIMIT 1`,
                `%${args.serviceId.toLowerCase()}%`,
            );
            if (!nameMatch.length) return { error: `Service "${args.serviceId}" not found` };
            args.serviceId = nameMatch[0].id;
        }

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

        // Emit event so notifications (WhatsApp confirmation, email, calendar) are triggered
        this.eventEmitter.emit('appointment.created', {
            schemaName: schema,
            appointment: {
                id: apt.id,
                contactId: contactId,
                serviceName: svc.name,
                startAt: startAt,
                endAt: endAt,
                status: 'confirmed',
                customerName: args.customerName,
                customerEmail: args.customerEmail,
                customerPhone: args.customerPhone,
            },
        });

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
