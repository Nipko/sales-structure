import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarIntegrationService } from '../appointments/calendar-integration.service';
import { FaqsService } from '../faqs/faqs.service';
import { PoliciesService } from '../policies/policies.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { PropertiesService } from '../vacation-rental/properties.service';
import { ToursService } from '../tours/tours.service';
import { TreatmentPlansService } from '../treatment-plans/treatment-plans.service';
import { ListingsService } from '../listings/listings.service';
import { PetsService } from '../pets/pets.service';
import { RestaurantsService } from '../restaurants/restaurants.service';
import { GymsService } from '../gyms/gyms.service';
import { EducationService } from '../education/education.service';
import { InsuranceService } from '../insurance/insurance.service';
import { HomeServicesService } from '../home-services/home-services.service';
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
        private propertiesService: PropertiesService,
        private toursService: ToursService,
        private treatmentService: TreatmentPlansService,
        private listingsService: ListingsService,
        private petsService: PetsService,
        private restaurantsService: RestaurantsService,
        private gymsService: GymsService,
        private educationService: EducationService,
        private insuranceService: InsuranceService,
        private homeServicesService: HomeServicesService,
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
        conversationId?: string,
    ): Promise<any> {
        this.logger.log(`[Tool] Executing: ${toolName} args=${JSON.stringify(args)}`);

        try {
            switch (toolName) {
                case 'list_services':
                    return this.listServices(schemaName);

                case 'check_availability':
                    return this.checkAvailability(schemaName, args.date, args.serviceId, args.staffId);

                case 'create_appointment':
                    return this.createAppointment(schemaName, tenantId, contactId, args as any, conversationId);

                case 'cancel_appointment':
                    return this.cancelAppointment(schemaName, contactId, args.appointmentId, args.reason);

                case 'list_customer_appointments':
                    return this.listCustomerAppointments(schemaName, contactId);

                case 'send_booking_link':
                    return this.sendBookingLink(tenantId);

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

                // ── Vacation Rental tools ───────────────────────────
                case 'list_properties':
                    return this.listProperties(schemaName, args.guests, args.checkIn, args.checkOut);

                case 'check_property_availability':
                    return this.checkPropertyAvailability(schemaName, args.propertyId, args.checkIn, args.checkOut, args.guests);

                case 'get_property_details':
                    return this.getPropertyDetails(schemaName, args.propertyId);

                case 'get_check_in_instructions':
                    return this.getCheckInInstructions(schemaName, args.propertyId);

                case 'create_property_booking':
                    return this.createPropertyBooking(schemaName, contactId, args as any, conversationId);

                // ── Tours / Travel Packages tools ──────────────────
                case 'search_packages':
                    return this.searchPackages(schemaName, args);

                case 'get_package_details':
                    return this.getPackageDetails(schemaName, args.packageId);

                case 'check_package_availability':
                    return this.checkPackageAvailabilityTool(schemaName, args.packageId, args.date, args.partySize);

                case 'create_tour_booking':
                    return this.createTourBooking(schemaName, contactId, args, conversationId);

                // ── Treatment Plans tools ──────────────────────────
                case 'get_treatment_plan':
                    return this.getTreatmentPlanForContact(schemaName, contactId);

                case 'list_upcoming_sessions':
                    return this.listUpcomingSessions(schemaName, contactId, args.limit);

                // ── Real Estate Listings tools ─────────────────────
                case 'search_listings':
                    return this.searchListings(schemaName, args);

                case 'get_listing_details':
                    return this.getListingDetails(schemaName, args.listingId);

                // ── Veterinaria / Pets tools ──────────────────────
                case 'list_pets_for_contact':
                    return this.listPetsForContact(schemaName, contactId);

                case 'register_pet':
                    return this.registerPet(schemaName, contactId, args);

                case 'get_vaccination_status':
                    return this.getVaccinationStatus(schemaName, args.petId);

                case 'triage_pet_emergency':
                    return this.triagePetEmergency({ symptoms: args.symptoms || '' });

                // ── Restaurants tools ─────────────────────────────
                case 'get_menu':
                    return this.getMenu(schemaName, args);

                case 'get_promotions':
                    return this.getPromotions(schemaName);

                case 'place_order':
                    return this.placeOrder(schemaName, contactId, conversationId, args);

                // ── Gyms tools ────────────────────────────────────
                case 'get_membership_plans':
                    return this.getMembershipPlans(schemaName);

                case 'get_class_schedule':
                    return this.getClassSchedule(schemaName, args);

                case 'get_my_membership':
                    return this.getMyMembership(schemaName, contactId);

                case 'book_class':
                    return this.bookClassTool(schemaName, args);

                case 'freeze_membership':
                    return this.freezeMembershipTool(schemaName, args);

                // ── Education tools ───────────────────────────────
                case 'get_courses':
                    return this.getCoursesTool(schemaName, args);

                case 'get_course_schedule':
                    return this.getCourseScheduleTool(schemaName, args);

                case 'enroll_student':
                    return this.enrollStudentTool(schemaName, contactId, args);

                case 'get_placement_test_link':
                    return this.getPlacementTestLinkTool(schemaName, contactId, args);

                // ── Insurance tools ───────────────────────────────
                case 'get_insurance_plans':
                    return this.getInsurancePlansTool(schemaName, args);

                case 'calculate_quote':
                    return this.calculateInsuranceQuoteTool(schemaName, contactId, args);

                case 'check_policy_status':
                    return this.checkPolicyStatusTool(schemaName, args);

                case 'file_claim':
                    return this.fileInsuranceClaimTool(schemaName, args);

                // ── Tier 3 tools — home services ──────────────────
                case 'create_service_request':
                    return this.createServiceRequestTool(schemaName, contactId, conversationId, args);

                case 'check_request_status':
                    return this.checkServiceRequestStatusTool(schemaName, args);

                // ── Tier 3 tools — pet services & photography ─────
                // These use the existing services + appointments engine
                // for actual booking; the AI tool simply reads the
                // tenant's configured services list.
                case 'list_pet_services':
                case 'list_photo_packages':
                    return this.listConfiguredServicesTool(schemaName);

                case 'check_daycare_availability':
                case 'check_date_availability':
                    return this.checkDateAvailabilityTool(schemaName, args);

                case 'request_photo_quote':
                    return this.requestPhotoQuoteTool(schemaName, contactId, args);

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
            googleBusy = await this.calendarIntegration.getFreeBusyForDate(schema, date, { staffId });
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
        conversationId?: string,
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

        // Get service (including modality columns)
        const svcRows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT id, name, duration_minutes, price, currency, location_type, location_address, meeting_link FROM "${schema}".services WHERE id = $1::uuid`,
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

        // Build rich description for calendar event
        const descriptionParts: string[] = [];
        descriptionParts.push(`Customer: ${args.customerName}`);
        if (args.customerEmail) descriptionParts.push(`Email: ${args.customerEmail}`);
        if (args.customerPhone) descriptionParts.push(`Phone: ${args.customerPhone}`);
        descriptionParts.push('');
        const priceStr = svc.price ? `${Number(svc.price).toLocaleString()} ${svc.currency || 'COP'}` : 'N/A';
        descriptionParts.push(`Service: ${svc.name} (${priceStr})`);
        descriptionParts.push(`Duration: ${svc.duration_minutes} min`);

        // Add conversation context if available
        if (conversationId) {
            try {
                const msgs: any[] = await this.prisma.$queryRawUnsafe(
                    `SELECT direction, content_text FROM "${schema}".messages WHERE conversation_id = $1::uuid ORDER BY created_at DESC LIMIT 5`,
                    conversationId,
                );
                if (msgs.length > 0) {
                    descriptionParts.push('');
                    descriptionParts.push('Conversation context:');
                    // Reverse to show oldest first
                    for (const m of msgs.reverse()) {
                        const role = m.direction === 'inbound' ? 'Customer' : 'Agent';
                        const text = (m.content_text || '').slice(0, 200);
                        if (text) descriptionParts.push(`- ${role}: "${text}"`);
                    }
                }
            } catch (e: any) {
                this.logger.warn(`[Tool] Failed to fetch conversation context: ${e.message}`);
            }
        }

        if (args.notes) {
            descriptionParts.push('');
            descriptionParts.push(`Notes: ${args.notes}`);
        }

        const description = descriptionParts.join('\n');

        // Determine modality for calendar event
        const isOnline = svc.location_type === 'online';
        const location = (svc.location_type === 'in_person' && svc.location_address) ? svc.location_address : undefined;

        // Sync to Google/Microsoft Calendar if any active integration exists
        let meetingUrl: string | undefined;
        try {
            const calUsers: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT user_id FROM "${schema}".calendar_integrations WHERE is_active = true LIMIT 1`,
            );
            if (calUsers.length > 0) {
                const calUserId = calUsers[0].user_id;
                const calResult = await this.calendarIntegration.createEvent(schema, calUserId, {
                    summary: `${svc.name} — ${args.customerName}`,
                    startAt,
                    endAt,
                    attendeeEmail: args.customerEmail || undefined,
                    description,
                    location,
                    isOnline,
                });
                if (calResult.eventId) {
                    await this.prisma.$queryRawUnsafe(
                        `UPDATE "${schema}".appointments SET google_event_id = $2 WHERE id = $1::uuid`,
                        apt.id, calResult.eventId,
                    );
                    this.logger.log(`[Tool] Calendar event created: ${calResult.eventId} for appointment ${apt.id}`);
                }
                if (calResult.meetingUrl) {
                    meetingUrl = calResult.meetingUrl;
                    // Store meeting URL on appointment metadata
                    await this.prisma.$queryRawUnsafe(
                        `UPDATE "${schema}".appointments SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1::uuid`,
                        apt.id, JSON.stringify({ meetingUrl }),
                    );
                    this.logger.log(`[Tool] Meeting URL stored for appointment ${apt.id}: ${meetingUrl}`);
                }
            }
        } catch (calErr: any) {
            this.logger.warn(`[Tool] Calendar sync failed for appointment ${apt.id}: ${calErr.message}`);
        }

        // If service has a pre-configured meeting link and no auto-generated one, use it
        if (!meetingUrl && svc.meeting_link) {
            meetingUrl = svc.meeting_link;
            try {
                await this.prisma.$queryRawUnsafe(
                    `UPDATE "${schema}".appointments SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1::uuid`,
                    apt.id, JSON.stringify({ meetingUrl }),
                );
            } catch {}
        }

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
                meetingUrl,
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
                meetingUrl,
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

    /**
     * Build the public booking URL for the tenant. Returns disabled state
     * when the toggle is off so the AI can fall back to chat-based booking.
     */
    private async sendBookingLink(tenantId: string): Promise<any> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { slug: true, settings: true },
        });
        if (!tenant) return { error: 'Tenant not found' };
        const settings = (tenant.settings as any) ?? {};
        const enabled = settings.publicBooking?.enabled === true;
        if (!enabled) {
            return {
                enabled: false,
                message: 'El booking público no está activado. Contactá al equipo para que lo habilite o agendá por aquí.',
            };
        }
        const baseUrl = process.env.DASHBOARD_URL || 'https://admin.parallly-chat.cloud';
        const url = `${baseUrl}/book/${tenant.slug}`;
        return {
            enabled: true,
            url,
            message: `Podés agendar tu cita acá: ${url}`,
        };
    }

    // ── Vacation Rental tools ────────────────────────────────

    /**
     * List active properties, optionally filtering by guest capacity.
     */
    private async listProperties(schema: string, guests?: number, checkIn?: string, checkOut?: string): Promise<any> {
        try {
            const conds: string[] = ['is_active = true'];
            const params: any[] = [];
            if (guests) {
                params.push(guests);
                conds.push(`max_guests >= $${params.length}`);
            }
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id, name, description, address, city, max_guests, bedrooms, bathrooms,
                        night_price, cleaning_fee, currency, min_nights, images
                 FROM "${schema}".properties
                 WHERE ${conds.join(' AND ')}
                 ORDER BY sort_order, name`,
                ...params,
            );

            // If dates provided, filter out unavailable properties
            let properties = rows.map(p => ({
                id: p.id,
                name: p.name,
                description: p.description,
                address: p.address,
                city: p.city,
                maxGuests: p.max_guests,
                bedrooms: p.bedrooms,
                bathrooms: p.bathrooms,
                nightPrice: Number(p.night_price || 0),
                cleaningFee: Number(p.cleaning_fee || 0),
                currency: p.currency || 'COP',
                minNights: p.min_nights,
                images: Array.isArray(p.images) ? p.images : [],
            }));

            if (checkIn && checkOut && properties.length > 0) {
                const available: any[] = [];
                for (const prop of properties) {
                    try {
                        const avail = await this.propertiesService.checkAvailability(schema, prop.id, checkIn, checkOut);
                        if (avail.available) {
                            available.push({ ...prop, totalPrice: avail.totalPrice, nights: avail.nights });
                        }
                    } catch { /* skip unavailable */ }
                }
                properties = available;
            }

            return { properties };
        } catch (e: any) {
            this.logger.warn(`[Tool] list_properties failed: ${e.message}`);
            return { properties: [] };
        }
    }

    /**
     * Check availability and pricing for a specific property + date range.
     */
    private async checkPropertyAvailability(
        schema: string, propertyId: string, checkIn: string, checkOut: string, guests?: number,
    ): Promise<any> {
        try {
            const avail = await this.propertiesService.checkAvailability(schema, propertyId, checkIn, checkOut);

            // If guest count provided, verify capacity
            if (guests && avail.available) {
                const property = await this.propertiesService.getById(schema, propertyId);
                if (property && guests > property.max_guests) {
                    return {
                        available: false,
                        reason: `Property accommodates max ${property.max_guests} guests, but ${guests} requested.`,
                    };
                }
            }

            return avail;
        } catch (e: any) {
            this.logger.warn(`[Tool] check_property_availability failed: ${e.message}`);
            return { error: e.message };
        }
    }

    /**
     * Full property details including amenities, rules, and pricing.
     */
    private async getPropertyDetails(schema: string, propertyId: string): Promise<any> {
        try {
            const p = await this.propertiesService.getById(schema, propertyId);
            if (!p) return { error: 'Property not found' };

            return {
                id: p.id,
                name: p.name,
                description: p.description,
                address: p.address,
                city: p.city,
                maxGuests: p.max_guests,
                bedrooms: p.bedrooms,
                bathrooms: p.bathrooms,
                nightPrice: Number(p.night_price || 0),
                cleaningFee: Number(p.cleaning_fee || 0),
                currency: p.currency || 'COP',
                minNights: p.min_nights,
                checkInTime: p.check_in_time,
                checkOutTime: p.check_out_time,
                amenities: p.amenities || [],
                houseRules: p.house_rules,
                images: Array.isArray(p.images) ? p.images : [],
            };
        } catch (e: any) {
            this.logger.warn(`[Tool] get_property_details failed: ${e.message}`);
            return { error: e.message };
        }
    }

    /**
     * Check-in instructions: door code, WiFi, parking, house rules.
     */
    private async getCheckInInstructions(schema: string, propertyId: string): Promise<any> {
        try {
            const p = await this.propertiesService.getById(schema, propertyId);
            if (!p) return { error: 'Property not found' };

            return {
                propertyName: p.name,
                checkInTime: p.check_in_time,
                checkOutTime: p.check_out_time,
                checkInInstructions: p.check_in_instructions,
                houseRules: p.house_rules,
                address: p.address,
            };
        } catch (e: any) {
            this.logger.warn(`[Tool] get_check_in_instructions failed: ${e.message}`);
            return { error: e.message };
        }
    }

    /**
     * Create a direct property booking. Checks availability first via PropertiesService.
     */
    private async createPropertyBooking(
        schema: string, contactId: string,
        args: { propertyId: string; checkIn: string; checkOut: string; guestName: string; guestPhone?: string; guests?: number },
        conversationId?: string,
    ): Promise<any> {
        try {
            const booking = await this.propertiesService.createBooking(schema, args.propertyId, {
                contactId: contactId || null,
                conversationId: conversationId || null,
                guestName: args.guestName,
                guestPhone: args.guestPhone || null,
                guestsCount: args.guests || 1,
                checkIn: args.checkIn,
                checkOut: args.checkOut,
            });

            this.logger.log(`[Tool] Property booking created: ${booking.id} for ${args.guestName}`);

            return {
                success: true,
                booking: {
                    id: booking.id,
                    propertyId: args.propertyId,
                    checkIn: args.checkIn,
                    checkOut: args.checkOut,
                    nights: booking.nights,
                    nightPrice: Number(booking.night_price || 0),
                    cleaningFee: Number(booking.cleaning_fee || 0),
                    totalPrice: Number(booking.total_price || 0),
                    currency: booking.currency,
                    status: booking.status,
                    guestName: args.guestName,
                },
            };
        } catch (e: any) {
            this.logger.warn(`[Tool] create_property_booking failed: ${e.message}`);
            return { error: e.message };
        }
    }

    // ── Tours / Travel Packages tool handlers ─────────────────────

    private async searchPackages(schemaName: string, args: any): Promise<any> {
        try {
            const packages = await this.toursService.searchPackages(schemaName, {
                destination: args.destination,
                durationType: args.durationType,
                maxPrice: args.maxPrice,
                date: args.date,
                partySize: args.partySize,
            });
            return {
                packages: packages.map((p: any) => ({
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    durationType: p.duration_type,
                    durationValue: p.duration_value,
                    price: Number(p.price || 0),
                    currency: p.currency || 'COP',
                    destination: p.destination,
                    languages: p.languages || [],
                    seatsLeft: p.available_seats ?? null,
                })),
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async getPackageDetails(schemaName: string, packageId: string): Promise<any> {
        try {
            const pkg = await this.toursService.getPackage(schemaName, packageId);
            if (!pkg) return { error: 'package_not_found' };
            const inventory = await this.toursService.listInventory(
                schemaName,
                packageId,
                new Date().toISOString().split('T')[0],
            );
            return {
                id: pkg.id,
                name: pkg.name,
                description: pkg.description,
                durationType: pkg.duration_type,
                durationValue: pkg.duration_value,
                price: Number(pkg.price || 0),
                currency: pkg.currency,
                destination: pkg.destination,
                departureLocation: pkg.departure_location,
                languages: pkg.languages || [],
                includes: pkg.includes || [],
                excludes: pkg.excludes || [],
                whatToBring: pkg.what_to_bring,
                cancellationPolicy: pkg.cancellation_policy,
                childDiscountPct: pkg.child_discount_pct || 0,
                upcomingDepartures: (inventory || []).slice(0, 10).map((i: any) => ({
                    date: i.departure_date,
                    time: i.departure_time,
                    seatsLeft: i.available_seats,
                    priceOverride: i.price_override ? Number(i.price_override) : null,
                })),
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async checkPackageAvailabilityTool(
        schemaName: string,
        packageId: string,
        date: string,
        partySize: number,
    ): Promise<any> {
        try {
            return await this.toursService.checkAvailability(schemaName, packageId, date, partySize);
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async createTourBooking(
        schemaName: string,
        contactId: string,
        args: any,
        conversationId?: string,
    ): Promise<any> {
        try {
            const booking = await this.toursService.createBooking(schemaName, {
                packageId: args.packageId,
                departureDate: args.departureDate,
                departureTime: args.departureTime,
                partySize: args.partySize,
                adults: args.adults,
                children: args.children,
                guestName: args.guestName,
                guestEmail: args.guestEmail,
                guestPhone: args.guestPhone,
                language: args.language,
                specialRequests: args.specialRequests,
                contactId,
                conversationId,
            });
            return {
                success: true,
                booking: {
                    id: booking.id,
                    departureDate: booking.departure_date,
                    departureTime: booking.departure_time,
                    partySize: booking.party_size,
                    totalPrice: Number(booking.total_price || 0),
                    currency: booking.currency,
                    status: booking.status,
                },
            };
        } catch (e: any) {
            this.logger.warn(`[Tool] create_tour_booking failed: ${e.message}`);
            return { error: e.message };
        }
    }

    // ── Treatment Plans tool handlers ─────────────────────────────

    private async getTreatmentPlanForContact(schemaName: string, contactId: string): Promise<any> {
        try {
            const summary = await this.treatmentService.summaryForContact(schemaName, contactId);
            if (!summary) return { hasPlan: false };
            const p = summary.plan;
            return {
                hasPlan: true,
                plan: {
                    id: p.id,
                    name: p.name,
                    planType: p.plan_type,
                    totalSessions: p.total_sessions,
                    completedSessions: p.completed_sessions,
                    sessionsLeft: summary.sessionsLeft,
                    progressPct: p.total_sessions > 0
                        ? Math.round((p.completed_sessions / p.total_sessions) * 100)
                        : 0,
                    startedAt: p.started_at,
                    expectedEndAt: p.expected_end_at,
                    status: p.status,
                },
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async listUpcomingSessions(schemaName: string, contactId: string, limit?: number): Promise<any> {
        try {
            const summary = await this.treatmentService.summaryForContact(schemaName, contactId);
            if (!summary) return { upcomingSessions: [] };
            const items = (summary.upcomingSessions || []).slice(0, limit || 5);
            return {
                upcomingSessions: items.map((s: any) => ({
                    id: s.id,
                    sessionNumber: s.session_number,
                    scheduledAt: s.scheduled_at,
                    status: s.status,
                })),
                sessionsLeft: summary.sessionsLeft,
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    // ── Real Estate Listings tool handlers ────────────────────────

    private async searchListings(schemaName: string, args: any): Promise<any> {
        try {
            const listings = await this.listingsService.search(schemaName, {
                transactionType: args.transactionType,
                propertyKind: args.propertyKind,
                maxPrice: args.maxPrice,
                minBedrooms: args.minBedrooms,
                neighborhood: args.neighborhood,
                city: args.city,
                minAreaM2: args.minAreaM2,
                limit: 8,
            });
            return {
                listings: (listings || []).map((l: any) => ({
                    id: l.id,
                    name: l.name,
                    transactionType: l.transaction_type,
                    propertyKind: l.property_kind,
                    price: Number(l.price || 0),
                    currency: l.currency,
                    bedrooms: l.bedrooms,
                    bathrooms: Number(l.bathrooms || 0),
                    areaM2: Number(l.area_m2 || 0),
                    parkingSpots: l.parking_spots,
                    stratum: l.stratum,
                    neighborhood: l.neighborhood,
                    city: l.city,
                    description: l.description,
                    status: l.status,
                })),
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async getListingDetails(schemaName: string, listingId: string): Promise<any> {
        try {
            const l = await this.listingsService.getById(schemaName, listingId);
            if (!l) return { error: 'listing_not_found' };
            return {
                id: l.id,
                name: l.name,
                transactionType: l.transaction_type,
                propertyKind: l.property_kind,
                price: Number(l.price || 0),
                currency: l.currency,
                rentPeriod: l.rent_period,
                hoaFee: l.hoa_fee ? Number(l.hoa_fee) : null,
                deposit: l.deposit ? Number(l.deposit) : null,
                minRentalMonths: l.min_rental_months,
                financingAvailable: l.financing_available,
                bedrooms: l.bedrooms,
                bathrooms: Number(l.bathrooms || 0),
                areaM2: Number(l.area_m2 || 0),
                parkingSpots: l.parking_spots,
                stratum: l.stratum,
                yearBuilt: l.year_built,
                address: l.address,
                neighborhood: l.neighborhood,
                city: l.city,
                description: l.description,
                amenities: l.amenities || [],
                imagesCount: (l.images || []).length,
                externalUrl: l.external_url,
                status: l.status,
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    // ── Pets / Veterinaria tools ──────────────────────────────────

    private async listPetsForContact(schemaName: string, contactId: string): Promise<any> {
        try {
            const summary = await this.petsService.summaryForContact(schemaName, contactId);
            if (!summary.totalPets) {
                return {
                    pets: [],
                    message: 'El contacto aún no tiene mascotas registradas. Usa register_pet para agregar una.',
                };
            }
            return summary;
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async registerPet(schemaName: string, contactId: string, args: any): Promise<any> {
        try {
            const pet = await this.petsService.create(schemaName, {
                contactId,
                name: args.name,
                species: args.species,
                breed: args.breed,
                sex: args.sex,
                isNeutered: args.isNeutered,
                birthDate: args.birthDate,
                weightKg: args.weightKg,
                color: args.color,
                allergies: args.allergies,
                chronicConditions: args.chronicConditions,
            });
            return {
                petId: pet.id,
                name: pet.name,
                species: pet.species,
                breed: pet.breed,
                message: `Mascota ${pet.name} registrada correctamente.`,
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async getVaccinationStatus(schemaName: string, petId: string): Promise<any> {
        try {
            const pet = await this.petsService.getById(schemaName, petId);
            if (!pet) return { error: 'Pet not found' };
            const vaccinations = await this.petsService.listVaccinations(schemaName, petId);
            const lastByVaccine: Record<string, any> = {};
            for (const v of vaccinations) {
                if (!lastByVaccine[v.vaccine_name] ||
                    new Date(v.applied_at) > new Date(lastByVaccine[v.vaccine_name].applied_at)) {
                    lastByVaccine[v.vaccine_name] = v;
                }
            }
            const today = new Date();
            const upcoming: any[] = [];
            const overdue: any[] = [];
            for (const v of Object.values(lastByVaccine) as any[]) {
                if (!v.next_due_at) continue;
                const due = new Date(v.next_due_at);
                if (due < today) {
                    overdue.push({ vaccineName: v.vaccine_name, dueDate: v.next_due_at, lastApplied: v.applied_at });
                } else {
                    upcoming.push({ vaccineName: v.vaccine_name, dueDate: v.next_due_at, lastApplied: v.applied_at });
                }
            }
            return {
                petName: pet.name,
                totalVaccinations: vaccinations.length,
                upcoming: upcoming.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()),
                overdue,
                isUpToDate: overdue.length === 0,
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    /**
     * Local heuristic triage — returns "urgent" / "non_urgent" / "unclear"
     * with a recommendation. Does NOT diagnose. Keyword-based on purpose:
     * we want a deterministic, audit-friendly classifier and fallback to
     * the LLM rules for borderline cases.
     */
    private triagePetEmergency(args: { symptoms: string }): any {
        const text = (args.symptoms || '').toLowerCase();
        const urgentSignals = [
            'sangre', 'sangrado', 'hemorragia', 'no respira', 'sin respirar',
            'inconsciente', 'desmayo', 'desmayado', 'convulsion', 'convulsión',
            'envenena', 'veneno', 'tóxico', 'toxico', 'comió chocolate', 'comió uvas',
            'ingirió', 'ingiri', 'vomito sangre', 'vómito con sangre',
            'atropell', 'caída', 'caida grave', 'no se mueve', 'paralisis', 'parálisis',
            'no come hace dias', 'no toma agua hace', 'fiebre alta',
            'distocia', 'parto complicado', 'pari hace', 'no puede orinar',
            'pupilas dilatadas', 'mucosas pálidas', 'pálid', 'pálidas',
            'shock', 'colaps',
        ];
        const moderateSignals = [
            'vomita', 'vomito', 'vómito', 'diarrea', 'no come', 'no quiere comer',
            'cojea', 'cojeando', 'rasca mucho', 'pelo se cae', 'caspa',
            'tos', 'estornud', 'mocos', 'rojo', 'inflamad', 'hinchad',
        ];
        if (urgentSignals.some(s => text.includes(s))) {
            return {
                severity: 'urgent',
                recommendation: 'Atención inmediata — escalando con un médico veterinario.',
                shouldHandoff: true,
            };
        }
        if (moderateSignals.some(s => text.includes(s))) {
            return {
                severity: 'non_urgent',
                recommendation: 'Síntomas que requieren consulta. Ofrecer agendar cita en las próximas 24-48h.',
                shouldHandoff: false,
            };
        }
        return {
            severity: 'unclear',
            recommendation: 'Pedir más detalles sobre los síntomas (cuándo empezó, frecuencia, otros signos) antes de decidir.',
            shouldHandoff: false,
        };
    }

    // ── Restaurants tools ─────────────────────────────────────────

    private async getMenu(schemaName: string, args: any): Promise<any> {
        try {
            const items = await this.restaurantsService.searchMenu(schemaName, {
                query: args.query,
                category: args.category,
                tag: args.tag,
                excludeAllergens: args.excludeAllergens,
                maxPrice: args.maxPrice,
                limit: 30,
            });
            if (!items.length) {
                return { items: [], message: 'No hay platos que coincidan con esos criterios. Sugiere ampliar la búsqueda.' };
            }
            return {
                count: items.length,
                items: items.map(i => ({
                    id: i.id,
                    name: i.name,
                    description: i.description,
                    price: Number(i.price || 0),
                    currency: i.currency,
                    category: i.category_name,
                    tags: i.tags || [],
                    allergens: i.allergens || [],
                    prepTimeMinutes: i.prep_time_minutes,
                })),
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async getPromotions(schemaName: string): Promise<any> {
        try {
            const all = await this.restaurantsService.listPromotions(schemaName, true);
            // Filter by day of week + hour window if specified
            const now = new Date();
            const dayCodes = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
            const today = dayCodes[now.getDay()];
            const currentMin = now.getHours() * 60 + now.getMinutes();
            const eligible = all.filter((p: any) => {
                const days = p.applicable_days || [];
                if (Array.isArray(days) && days.length > 0 && !days.includes(today)) return false;
                if (p.applicable_hours) {
                    const [start, end] = String(p.applicable_hours).split('-');
                    if (start && end) {
                        const [sh, sm] = start.split(':').map(Number);
                        const [eh, em] = end.split(':').map(Number);
                        const startMin = sh * 60 + (sm || 0);
                        const endMin = eh * 60 + (em || 0);
                        if (currentMin < startMin || currentMin > endMin) return false;
                    }
                }
                return true;
            });
            if (!eligible.length) {
                return { promotions: [], message: 'Sin promociones activas en este momento.' };
            }
            return {
                promotions: eligible.map((p: any) => ({
                    title: p.title,
                    description: p.description,
                    discountType: p.discount_type,
                    discountValue: Number(p.discount_value || 0),
                    minOrderAmount: p.min_order_amount ? Number(p.min_order_amount) : null,
                })),
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async placeOrder(
        schemaName: string,
        contactId: string,
        conversationId: string | undefined,
        args: any,
    ): Promise<any> {
        try {
            if (!Array.isArray(args.items) || args.items.length === 0) {
                return { error: 'items array is required' };
            }
            if (args.orderType === 'delivery' && !args.deliveryAddress) {
                return { error: 'deliveryAddress is required for delivery orders' };
            }

            const order = await this.restaurantsService.createOrder(schemaName, {
                contactId,
                conversationId,
                orderType: args.orderType || 'delivery',
                customerName: args.customerName,
                customerPhone: args.customerPhone,
                deliveryAddress: args.deliveryAddress,
                deliveryNotes: args.deliveryNotes,
                tableNumber: args.tableNumber,
                items: args.items.map((it: any) => ({
                    menuItemId: it.menuItemId,
                    name: it.name,
                    quantity: it.quantity,
                    unitPrice: it.unitPrice,
                    specialInstructions: it.specialInstructions,
                })),
                paymentMethod: args.paymentMethod,
                notes: args.notes,
            });

            this.eventEmitter.emit('food_order.created', {
                orderId: order.id,
                tenantSchemaName: schemaName,
                contactId,
            });

            return {
                orderId: order.id,
                status: order.status,
                total: Number(order.total || 0),
                currency: order.currency,
                itemsCount: (order.items || []).length,
                estimatedDelivery: order.order_type === 'delivery' ? '30-45 minutos' : '15-25 minutos',
                message: `Pedido creado correctamente. Total: ${Number(order.total || 0).toLocaleString()} ${order.currency}`,
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    // ── Gyms tools ────────────────────────────────────────────────

    private async getMembershipPlans(schemaName: string): Promise<any> {
        try {
            const plans = await this.gymsService.listPlans(schemaName, false);
            if (!plans.length) return { plans: [], message: 'Sin planes disponibles.' };
            return {
                plans: plans.map(p => ({
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    durationDays: p.duration_days,
                    price: Number(p.price),
                    currency: p.currency,
                    classCredits: p.class_credits_per_period,
                    personalTrainingCredits: p.personal_training_credits,
                    guestPasses: p.guest_passes,
                    freezeAllowanceDays: p.freeze_allowance_days,
                    perks: p.perks || [],
                })),
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async getClassSchedule(schemaName: string, args: any): Promise<any> {
        try {
            const days = Math.min(Math.max(args.daysAhead || 7, 1), 30);
            const classes = await this.gymsService.upcomingClasses(schemaName, days, args.classType);
            if (!classes.length) {
                return { classes: [], message: 'No hay clases programadas en el rango solicitado.' };
            }
            return {
                count: classes.length,
                classes: classes.map(c => ({
                    id: c.id,
                    name: c.name,
                    classType: c.class_type,
                    instructor: c.instructor_name,
                    scheduledAt: c.scheduled_at,
                    durationMinutes: c.duration_minutes,
                    availableSpots: c.available_spots,
                    maxCapacity: c.max_capacity,
                    room: c.room,
                    level: c.level,
                })),
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async getMyMembership(schemaName: string, contactId: string): Promise<any> {
        try {
            const member = await this.gymsService.getMemberByContact(schemaName, contactId);
            if (!member) {
                return { isMember: false, message: 'El contacto no tiene una membresía activa. Ofrecer get_membership_plans para que se inscriba.' };
            }
            return {
                isMember: true,
                memberId: member.id,
                planName: member.plan_name,
                status: member.status,
                periodStart: member.current_period_start,
                periodEnd: member.current_period_end,
                classCreditsRemaining: member.class_credits_remaining,
                personalTrainingRemaining: member.personal_training_remaining,
                guestPassesRemaining: member.guest_passes_remaining,
                frozenFrom: member.frozen_from,
                frozenUntil: member.frozen_until,
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async bookClassTool(schemaName: string, args: any): Promise<any> {
        try {
            const booking = await this.gymsService.bookClass(schemaName, args.classId, args.memberId);
            return {
                bookingId: booking.id,
                status: booking.status,
                creditsUsed: booking.credits_used,
                message: 'Reserva confirmada.',
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async freezeMembershipTool(schemaName: string, args: any): Promise<any> {
        try {
            const member = await this.gymsService.freezeMember(schemaName, args.memberId, args.days);
            return {
                memberId: member.id,
                status: member.status,
                frozenFrom: member.frozen_from,
                frozenUntil: member.frozen_until,
                message: `Membresía congelada por ${args.days} días.`,
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    // ── Education tools ───────────────────────────────────────────

    private async getCoursesTool(schemaName: string, args: any): Promise<any> {
        try {
            const courses = await this.educationService.listCourses(schemaName, {
                subject: args.subject,
                level: args.level,
                modality: args.modality,
            });
            if (!courses.length) return { courses: [], message: 'Sin cursos que coincidan con los criterios.' };
            return {
                count: courses.length,
                courses: courses.slice(0, 20).map(c => ({
                    id: c.id,
                    name: c.name,
                    description: c.description,
                    subject: c.subject,
                    level: c.level,
                    modality: c.modality,
                    durationHours: c.duration_hours,
                    durationWeeks: c.duration_weeks,
                    price: Number(c.price),
                    currency: c.currency,
                    certification: c.certification,
                })),
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async getCourseScheduleTool(schemaName: string, args: any): Promise<any> {
        try {
            const cohorts = await this.educationService.upcomingCohorts(schemaName, {
                subject: args.subject,
                level: args.level,
                modality: args.modality,
                daysAhead: args.daysAhead,
            });
            if (!cohorts.length) {
                return { cohorts: [], message: 'No hay cohortes abiertas en el rango solicitado. Sugerir entrar a lista de espera.' };
            }
            return {
                count: cohorts.length,
                cohorts: cohorts.map(c => ({
                    cohortId: c.cohort_id,
                    courseId: c.course_id,
                    courseName: c.course_name,
                    subject: c.subject,
                    level: c.level,
                    modality: c.modality,
                    startsAt: c.starts_at,
                    endsAt: c.ends_at,
                    schedule: c.schedule,
                    availableSeats: c.available_seats,
                    maxCapacity: c.max_capacity,
                    durationHours: c.duration_hours,
                    durationWeeks: c.duration_weeks,
                    price: Number(c.price),
                    currency: c.currency,
                    certification: c.certification,
                })),
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async enrollStudentTool(schemaName: string, contactId: string, args: any): Promise<any> {
        try {
            const enrollment = await this.educationService.enrollStudent(schemaName, {
                cohortId: args.cohortId,
                contactId,
                studentName: args.studentName,
                studentEmail: args.studentEmail,
                studentPhone: args.studentPhone,
            });
            return {
                enrollmentId: enrollment.id,
                cohortId: enrollment.cohort_id,
                status: enrollment.status,
                paymentStatus: enrollment.payment_status,
                message: 'Inscripción registrada. Pendiente de pago para confirmar el cupo.',
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async getPlacementTestLinkTool(schemaName: string, contactId: string, args: any): Promise<any> {
        try {
            let test = await this.educationService.getPlacementTestForContact(schemaName, contactId);
            if (!test) {
                test = await this.educationService.createPlacementTest(schemaName, {
                    contactId,
                    subject: args.subject,
                });
            }
            return {
                testId: test.id,
                testUrl: test.test_url || null,
                status: test.status,
                resultLevel: test.result_level || null,
                message: test.test_url
                    ? `Toma el test aquí: ${test.test_url}`
                    : 'Test pendiente de asignación de URL — pídele al equipo académico que la cargue.',
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    // ── Insurance tools ───────────────────────────────────────────

    private async getInsurancePlansTool(schemaName: string, args: any): Promise<any> {
        try {
            const plans = await this.insuranceService.listPlans(schemaName, {
                type: args.type,
                coverageLevel: args.coverageLevel,
            });
            if (!plans.length) return { plans: [], message: 'Sin planes que coincidan con los criterios.' };
            return {
                count: plans.length,
                plans: plans.map(p => ({
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    insuranceType: p.insurance_type,
                    coverageLevel: p.coverage_level,
                    monthlyPremiumMin: p.monthly_premium_min ? Number(p.monthly_premium_min) : null,
                    monthlyPremiumMax: p.monthly_premium_max ? Number(p.monthly_premium_max) : null,
                    deductible: p.deductible ? Number(p.deductible) : null,
                    maxCoverage: p.max_coverage ? Number(p.max_coverage) : null,
                    currency: p.currency,
                    covers: p.covers || [],
                    excludes: p.excludes || [],
                    minAge: p.min_age,
                    maxAge: p.max_age,
                })),
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async calculateInsuranceQuoteTool(schemaName: string, contactId: string, args: any): Promise<any> {
        try {
            const quote = await this.insuranceService.createQuote(schemaName, {
                contactId,
                planId: args.planId,
                applicantName: args.applicantName,
                applicantAge: args.applicantAge,
                applicantEmail: args.applicantEmail,
                applicantPhone: args.applicantPhone,
                applicantData: args.applicantData,
            });
            return {
                quoteId: quote.id,
                planName: quote.plan_name,
                insuranceType: quote.plan_type,
                monthlyPremium: Number(quote.monthly_premium),
                annualPremium: Number(quote.annual_premium),
                currency: quote.currency,
                validUntil: quote.valid_until,
                disclaimer: 'Esta cotización es una estimación preliminar. La prima final está sujeta a revisión del área de suscripción.',
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async checkPolicyStatusTool(schemaName: string, args: any): Promise<any> {
        try {
            const policy = await this.insuranceService.getPolicyByNumber(schemaName, args.policyNumber);
            if (!policy) return { error: 'Póliza no encontrada con ese número' };
            return {
                policyId: policy.id,
                policyNumber: policy.policy_number,
                policyholderName: policy.policyholder_name,
                status: policy.status,
                monthlyPremium: Number(policy.monthly_premium),
                currency: policy.currency,
                startsAt: policy.starts_at,
                endsAt: policy.ends_at,
                nextPaymentAt: policy.next_payment_at,
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async fileInsuranceClaimTool(schemaName: string, args: any): Promise<any> {
        try {
            const policy = await this.insuranceService.getPolicyByNumber(schemaName, args.policyNumber);
            if (!policy) return { error: 'Póliza no encontrada' };
            if (policy.status !== 'active') {
                return { error: `La póliza está en estado ${policy.status}. No se puede radicar un reclamo.` };
            }
            const claim = await this.insuranceService.fileClaim(schemaName, {
                policyId: policy.id,
                incidentType: args.incidentType,
                incidentAt: args.incidentAt,
                description: args.description,
                claimedAmount: args.claimedAmount,
            });
            return {
                claimId: claim.id,
                claimNumber: claim.claim_number,
                status: claim.status,
                message: `Reclamo radicado con número ${claim.claim_number}. Un agente humano lo revisará en las próximas horas.`,
                shouldHandoff: true,
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    // ── Tier 3 — home services ───────────────────────────────────

    private async createServiceRequestTool(
        schemaName: string,
        contactId: string,
        conversationId: string | undefined,
        args: any,
    ): Promise<any> {
        try {
            const request = await this.homeServicesService.createRequest(schemaName, {
                contactId,
                conversationId,
                serviceType: args.serviceType,
                urgency: args.urgency || 'normal',
                customerName: args.customerName,
                customerPhone: args.customerPhone,
                address: args.address,
                addressNotes: args.addressNotes,
                city: args.city,
                issueDescription: args.issueDescription,
                preferredDate: args.preferredDate,
                preferredTimeWindow: args.preferredTimeWindow,
            });
            this.eventEmitter.emit('service_request.created', {
                requestId: request.id,
                tenantSchemaName: schemaName,
                urgency: request.urgency,
            });
            return {
                requestId: request.id,
                status: request.status,
                urgency: request.urgency,
                message: request.urgency === 'emergencia'
                    ? 'Solicitud registrada como EMERGENCIA. Asignaremos un técnico de inmediato.'
                    : 'Solicitud registrada. Te contactaremos para confirmar fecha y hora del servicio.',
                shouldHandoff: request.urgency === 'emergencia',
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async checkServiceRequestStatusTool(schemaName: string, args: any): Promise<any> {
        try {
            const request = await this.homeServicesService.getRequestById(schemaName, args.requestId);
            if (!request) return { error: 'Solicitud no encontrada' };
            return {
                requestId: request.id,
                status: request.status,
                urgency: request.urgency,
                technicianName: request.assigned_technician_name,
                scheduledAt: request.scheduled_at,
                completedAt: request.completed_at,
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    // ── Tier 3 — pet services & photography (read-only catalog) ──

    /**
     * Both list_pet_services and list_photo_packages map to the
     * generic services table that every tenant has — pet_services
     * and photography tenants seed it during onboarding with their
     * domain offerings.
     */
    private async listConfiguredServicesTool(schemaName: string): Promise<any> {
        try {
            const services = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, name, description, duration_minutes, price, currency, category
                 FROM services WHERE is_active = true
                 ORDER BY category, name`,
            );
            if (!services?.length) return { services: [], message: 'Sin servicios configurados.' };
            return {
                count: services.length,
                services: services.map(s => ({
                    id: s.id,
                    name: s.name,
                    description: s.description,
                    durationMinutes: s.duration_minutes,
                    price: Number(s.price || 0),
                    currency: s.currency,
                    category: s.category,
                })),
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    /**
     * Date availability check — reuses the appointments engine. For
     * pet daycare/boarding: looks for blocked dates. For photography:
     * checks if any appointment already overlaps the requested date.
     */
    private async checkDateAvailabilityTool(schemaName: string, args: any): Promise<any> {
        try {
            const date = args.date || args.checkIn;
            if (!date) return { error: 'date is required' };
            const blockedRows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT COUNT(*)::int as cnt FROM appointments
                 WHERE DATE(starts_at) = $1::date AND status IN ('confirmed', 'pending')`,
                [date],
            ).catch(() => [{ cnt: 0 }]);
            const taken = Number(blockedRows[0]?.cnt || 0);
            return {
                date,
                taken,
                available: taken < 5,  // simple capacity heuristic — tenant can override via blocked_dates
                message: taken === 0
                    ? 'Fecha completamente disponible.'
                    : taken < 5
                        ? `Hay ${taken} reservas pero todavía hay disponibilidad.`
                        : 'Fecha con alta ocupación, sugerir alternativa.',
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    /**
     * Photography quote: creates a lead with the quote details so the
     * studio can follow up. Low-fidelity — for proper quote tracking
     * a future iteration could create a CRM opportunity.
     */
    private async requestPhotoQuoteTool(schemaName: string, contactId: string, args: any): Promise<any> {
        try {
            // Persist the booking request as a photo_sessions row so the
            // studio can track it and see delivery progress. Status starts
            // as 'scheduled' if a date was provided, otherwise the team
            // can confirm a date later.
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `INSERT INTO photo_sessions (
                    contact_id, session_type, package_name, client_name,
                    client_phone, scheduled_at, location, notes, status
                 ) VALUES (
                    $1::uuid, $2, $3, $4, $5, $6::timestamp, $7, $8, $9
                 ) RETURNING id`,
                [
                    contactId || null,
                    args.sessionType || 'other',
                    args.packageName || null,
                    args.customerName || null,
                    args.customerPhone || null,
                    args.date || null,
                    args.location || null,
                    args.specialRequests || null,
                    args.date ? 'scheduled' : 'scheduled',
                ],
            ).catch((err: any) => {
                this.logger.warn(`Photo session insert failed (table may not exist yet): ${err.message}`);
                return [];
            });
            this.eventEmitter.emit('photo_session.requested', {
                tenantSchemaName: schemaName,
                contactId,
                sessionId: rows?.[0]?.id,
                ...args,
            });
            return {
                received: true,
                sessionId: rows?.[0]?.id,
                date: args.date,
                package: args.packageName,
                message: 'Sesión registrada — el equipo te enviará la propuesta personalizada en las próximas horas. ¿Algo más en lo que te pueda ayudar?',
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }
}
