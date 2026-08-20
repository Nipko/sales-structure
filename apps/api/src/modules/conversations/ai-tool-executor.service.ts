import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CalendarIntegrationService } from '../appointments/calendar-integration.service';
import { CalendarSyncOutboxService } from '../appointments/calendar-sync-outbox.service';
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
import { PhotographyService } from '../photography/photography.service';
import { OrdersService } from '../orders/orders.service';
import { VehicleInventoryService } from '../verticals/vehicle-inventory.service';
import { ResourceRentalsService } from '../resource-rentals/resource-rentals.service';
import { EcommerceService } from '../ecommerce/ecommerce.service';
import { VerticalIntegrationsService } from '../vertical-integrations/vertical-integrations.service';
import { McpClientService } from '../mcp/mcp-client.service';
import { TOOL_READ_ERROR_CODES, type PolicyType } from '@parallext/shared';
import {
    readEmpty,
    readFailed,
    readNotConfigured,
    readOk,
    readProviderDown,
    readUnauthorized,
} from '../../common/contracts/tool-read-result.util';
import { absoluteMediaUrl } from '../../common/utils/media-url.util';
import { ChatIdentityService } from './chat-identity.service';
import type { ServiceExecutionContext } from '../../common/types/execution-context';
import { persistenceDisabled } from '../../common/types/execution-context';
import {
    agentTestBlockedToolResult,
    canEvalExecuteWriter,
    isAgentTestSafeToolName,
} from './agent-test-tool-policy';
import { isRegisteredStaticTool } from './tool-policy-registry';
import {
    ToolExecutionControlService,
    type ToolExecutionControlDecision,
} from './tool-execution-control.service';
import { PaymentOperationService, type PreparedPaymentLink } from './payment-operation.service';
import { TemporalCapacityContractService } from '../verticals/temporal-capacity-contract.service';
import { assertActiveTenantUser } from '../appointments/tenant-user-scope.util';
import {
    AppointmentServiceUnavailableError,
    AppointmentSlotConflictError,
    dayOfWeekForLocalDate,
    lockAndAssertAppointmentCapacity,
    wallClockEpoch,
} from '../appointments/appointment-capacity.util';
import { requireTenantContact } from '../../common/utils/tenant-contact.util';
import { resolveNativeEvidenceOpportunity } from '../../common/utils/native-evidence-opportunity.util';
import {
    describePaymentPolicy,
    resolvePaymentPolicy,
} from '../../common/utils/payment-policy.util';

/**
 * Executes AI tool calls against the appropriate services.
 * Called from ConversationsService when the LLM returns tool_calls.
 */
@Injectable()
export class AIToolExecutorService {
    private readonly logger = new Logger(AIToolExecutorService.name);
    private readonly temporalContracts = new TemporalCapacityContractService();

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
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
        private chatIdentity: ChatIdentityService,
        private homeServicesService: HomeServicesService,
        private ecommerceService: EcommerceService,
        private verticalIntegrations: VerticalIntegrationsService,
        private mcpClient: McpClientService,
        private readonly toolExecutionControl: ToolExecutionControlService,
        private readonly paymentOperations: PaymentOperationService,
        private readonly photographyService: PhotographyService,
        // Optional like the control services above: the seven specs that build
        // this executor by hand pass positional stubs, and a handler that guards
        // its own wiring is better than breaking every one of them. Both are
        // real providers in ConversationsModule, so production always has them.
        private readonly ordersService?: OrdersService,
        private readonly vehicleInventory?: VehicleInventoryService,
        private readonly resourceRentals?: ResourceRentalsService,
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
        // channelType viaja por OPTS y no por args a proposito: args lo arma el
        // LLM, asi que si el canal viniera por ahi el modelo podria decir que la
        // conversacion es por email para que el codigo salga por email — o sea,
        // por el mismo canal que estamos tratando de verificar.
        opts?: {
            evalMode?: boolean;
            channelType?: string;
            readOnly?: boolean;
            executionContext?: ServiceExecutionContext;
            /** Trusted caller key; it is always rebound to tenant/tool/args. */
            idempotencyKey?: string;
            /** Server-origin evidence; never populated from LLM arguments. */
            authorityEvidence?: {
                kind: 'booking_engine_confirmation';
                source: 'confirm_yes' | 'flow_response' | 'text_confirmation';
            };
            /**
             * Tenant discount ceiling (`upsell.maxDiscountPercent`). Comes from
             * the persona config, never from the model: the prompt-only version
             * was advice the model could ignore.
             */
            maxDiscountPercent?: number;
            /**
             * Operating country. Regulated knowledge of another jurisdiction is
             * excluded rather than down-ranked — an answer about the wrong
             * country's rules is wrong even when it is fluent and cited.
             */
            jurisdiction?: string | null;
        },
    ): Promise<any> {
        this.logger.log(`[Tool] Executing: ${toolName}`);

        let controlDecision: ToolExecutionControlDecision | undefined;
        let preparedPaymentLink: PreparedPaymentLink | undefined;
        try {
            // Static tools must have a reviewed policy entry before they can
            // reach a handler. Dynamic MCP names use their separate opaque
            // boundary below; every other unknown name fails closed here.
            if (!toolName.startsWith('mcp__') && !isRegisteredStaticTool(toolName)) {
                return { error: 'unknown_tool', tool: toolName };
            }

            // Persistence-disabled execution is a capability boundary, not a
            // hint. A future caller cannot reach a writer by skipping the
            // AgentTestService advertisement filter.
            //
            // The one exception is the evaluation gate, and it is not a loophole:
            // the tool must be one of the audited writers AND the run must be
            // bound to the eval sandbox contact, whose rows the gate deletes
            // afterwards. Without it the gate could never verify that a booking
            // actually happened — which is the only thing it exists to check.
            const evalWriterAllowed = opts?.evalMode === true
                && canEvalExecuteWriter(toolName, contactId);
            if (persistenceDisabled(opts?.executionContext)
                && !isAgentTestSafeToolName(toolName)
                && !evalWriterAllowed) {
                return agentTestBlockedToolResult(toolName);
            }

            // DEC-08/09: one authority boundary for every runtime tool. It runs
            // before MCP routing and before the static handler switch; handlers
            // keep their domain-level transaction/CAS protections.
            if (!this.toolExecutionControl || !this.paymentOperations) {
                return {
                    error: 'tool_control_wiring_unavailable',
                    message: 'Los controles de ejecución no están disponibles. La acción no puede continuar.',
                    shouldHandoff: true,
                };
            }
            if (toolName === 'create_payment_link') {
                const preparation = await this.paymentOperations.preparePaymentLink(
                    tenantId,
                    contactId,
                    args,
                );
                if (!preparation.ok) return preparation.result;
                preparedPaymentLink = preparation.payable;
                // The central confirmation/idempotency hash must bind only the
                // server-resolved snapshot, never money or text supplied by the
                // model in the original tool arguments.
                args = {
                    paymentIntentId: preparedPaymentLink.paymentIntentId,
                    payableReference: preparedPaymentLink.canonicalReference,
                    amountCents: preparedPaymentLink.amountCents,
                    currency: preparedPaymentLink.currency,
                    description: preparedPaymentLink.description,
                    paymentStatus: preparedPaymentLink.paymentStatus,
                };
            }
            // Precondiciones ANTES de desafiar al cliente.
            //
            // El desafio de confirmacion congela los args tal como los mando el
            // modelo y recien los ejecuta cuando el cliente dice que si. Sin
            // esto, un propertyId inventado —bien formado pero inexistente—
            // pasaba el desafio entero: al huesped se le preguntaba "confirmas
            // la reserva?", decia que si, y RECIEN AHI el sistema descubria que
            // el alojamiento no existe. Confirmo dos veces algo que nunca pudo
            // ocurrir. Es el mismo patron que ya usa create_payment_link arriba.
            const precondition = await this.assertWritePreconditions(schemaName, toolName, args);
            if (precondition) return precondition;

            // An external MCP tool carries no policy of its own, so the guard
            // needs the reviewed approval record. Resolved here because this is
            // the only place that already holds the MCP client; an unresolved
            // approval stays null and the guard refuses.
            const mcpApproval = toolName.startsWith('mcp__') && this.mcpClient?.getApproval
                ? await this.mcpClient.getApproval(tenantId, toolName).catch(() => null)
                : null;

            controlDecision = await this.toolExecutionControl.preflight({
                schemaName,
                tenantId,
                contactId,
                toolName,
                args,
                conversationId,
                channelType: opts?.channelType,
                idempotencyKey: opts?.idempotencyKey,
                mcpApproval,
                // The audited eval writer runs the FULL guard — ledger,
                // confirmation, idempotency — because that machinery is exactly
                // what the gate needs to exercise. Read-only execution would
                // short-circuit it and verify nothing.
                readOnlyExecution: persistenceDisabled(opts?.executionContext) && !evalWriterAllowed,
                authorityEvidence: opts?.authorityEvidence,
            });
            if (!controlDecision.allowed) {
                if (preparedPaymentLink
                    && controlDecision.result?.error === 'confirmation_required') {
                    return this.paymentOperations.confirmationRequiredResult(
                        preparedPaymentLink,
                        controlDecision.result,
                    );
                }
                return controlDecision.result;
            }

            const executeHandler = async (): Promise<any> => {

            // External MCP tools (T3.20) — namespaced mcp__{server}__{tool}.
            if (toolName.startsWith('mcp__')) {
                return this.mcpClient.callRemoteTool(tenantId, toolName, args);
            }

            switch (toolName) {
                case 'list_services':
                    return this.listServices(schemaName);

                case 'check_availability':
                    return this.checkAvailability(schemaName, args.date, args.serviceId, args.staffId);

                case 'create_appointment':
                    return this.createAppointment(schemaName, tenantId, contactId, args as any, conversationId, opts?.evalMode);

                case 'cancel_appointment':
                    return this.cancelAppointment(schemaName, contactId, args.appointmentId, args.reason);

                case 'reschedule_appointment':
                    return this.rescheduleAppointment(schemaName, contactId, args.appointmentId, args.newDate, args.newTime, args.reason);

                case 'get_appointment_details':
                    return this.getAppointmentDetails(schemaName, contactId, args.appointmentId);

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

                case 'send_product_image':
                    return this.sendProductImage(schemaName, args.productId);

                case 'send_property_image':
                    return this.sendPropertyImage(schemaName, args.propertyId);

                case 'send_listing_image':
                    return this.sendListingImage(schemaName, args.listingId);

                case 'send_portfolio':
                    return this.sendPortfolioTool(schemaName, tenantId, args);

                case 'search_vehicles':
                    return this.searchVehicles(schemaName, args);

                case 'get_vehicle_details':
                    return this.getVehicleDetails(schemaName, args.vehicleId);

                case 'send_vehicle_image':
                    return this.sendVehicleImage(schemaName, args.vehicleId);

                case 'schedule_test_drive':
                    return this.scheduleTestDrive(tenantId, args);

                case 'place_catalog_order':
                    return this.placeCatalogOrder(tenantId, schemaName, contactId, conversationId, args);

                case 'search_faqs':
                    return this.searchFaqs(tenantId, args.query, args.limit, opts?.executionContext);

                case 'get_policy':
                    return this.getPolicy(tenantId, args.type as PolicyType, opts?.executionContext);

                case 'search_knowledge_base':
                    return this.searchKnowledgeBase(
                        tenantId, args.query, args.limit, opts?.executionContext, opts?.jurisdiction,
                    );

                case 'list_customer_orders':
                    return this.listCustomerOrders(schemaName, contactId, args.limit, args.status);

                case 'list_active_offers':
                    return this.listActiveOffers(schemaName, args.limit);

                case 'get_customer_context':
                    return this.getCustomerContext(schemaName, contactId);

                // ── E-commerce dual-skillset tools (T2.17) ──────────
                case 'recommend_products':
                    return this.recommendProducts(
                        schemaName,
                        args.search,
                        args.maxPrice,
                        args.category,
                        opts?.readOnly === true || persistenceDisabled(opts?.executionContext),
                    );

                case 'get_order_status':
                    return this.getOrderStatus(schemaName, contactId, args.orderId);

                case 'apply_discount':
                    if (!controlDecision?.allowed || !controlDecision.ledgerId) {
                        return this.moneyLedgerUnavailable();
                    }
                    return this.paymentOperations.applyDiscount(
                        schemaName,
                        tenantId,
                        contactId,
                        controlDecision.ledgerId,
                        args,
                        opts?.maxDiscountPercent,
                    );

                case 'create_payment_link':
                    if (!controlDecision?.allowed || !controlDecision.ledgerId || !preparedPaymentLink) {
                        return this.moneyLedgerUnavailable();
                    }
                    return this.paymentOperations.createPaymentLink(
                        schemaName,
                        tenantId,
                        contactId,
                        controlDecision.ledgerId,
                        preparedPaymentLink,
                    );

                case 'get_payment_status':
                    return this.paymentOperations.getPaymentStatus(
                        tenantId,
                        contactId,
                        args,
                    );

                case 'refund_payment':
                    if (!controlDecision?.allowed || !controlDecision.ledgerId) {
                        return this.moneyLedgerUnavailable();
                    }
                    return this.paymentOperations.refundPayment(
                        schemaName,
                        tenantId,
                        contactId,
                        controlDecision.ledgerId,
                        args,
                    );

                // ── Vertical integrations (T3.19): Toast / Mindbody / Cliniko ──
                case 'get_restaurant_menu':
                    return this.verticalIntegrations.getMenuForAI(tenantId, schemaName);

                case 'get_fitness_schedule':
                    return this.verticalIntegrations.getScheduleForAI(tenantId, schemaName);

                case 'list_clinic_services':
                    return this.verticalIntegrations.getClinicServicesForAI(tenantId, schemaName);

                case 'check_clinic_availability':
                    return this.verticalIntegrations.checkClinikoAvailability(tenantId, args.appointmentTypeId, args.from, args.to);

                // ── Vacation Rental tools ───────────────────────────
                case 'list_properties':
                    return this.listProperties(schemaName, args.guests, args.checkIn, args.checkOut, tenantId);

                case 'check_property_availability':
                    return this.checkPropertyAvailability(schemaName, args.propertyId, args.checkIn, args.checkOut, args.guests, tenantId);

                case 'get_property_details':
                    return this.getPropertyDetails(schemaName, args.propertyId);

                case 'get_check_in_instructions':
                    return this.getCheckInInstructions(schemaName, contactId, args.propertyId);

                case 'create_property_booking':
                    return this.createPropertyBooking(schemaName, contactId, args as any, conversationId, tenantId);

                case 'cancel_property_booking':
                    return this.cancelPropertyBooking(schemaName, contactId, args.bookingId, args.reason);

                case 'list_my_property_bookings':
                    return this.listMyPropertyBookings(schemaName, contactId);

                // ── Tours / Travel Packages tools ──────────────────
                case 'search_packages':
                    return this.searchPackages(schemaName, args);

                case 'get_package_details':
                    return this.getPackageDetails(schemaName, args.packageId);

                case 'check_package_availability':
                    return this.checkPackageAvailabilityTool(schemaName, args.packageId, args.date, args.partySize);

                case 'create_tour_booking':
                    return this.createTourBooking(schemaName, contactId, args, conversationId);

                case 'cancel_tour_booking':
                    return this.cancelTourBooking(schemaName, contactId, args.bookingId, args.reason);

                case 'list_my_tour_bookings':
                    return this.listMyTourBookings(schemaName, contactId);

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
                    return this.getVaccinationStatus(schemaName, contactId, args.petId);

                case 'triage_pet_emergency':
                    return this.triagePetEmergency({ symptoms: args.symptoms || '' });

                case 'update_pet':
                    return this.updatePetTool(schemaName, contactId, args);

                // ── Restaurants tools ─────────────────────────────
                case 'get_menu':
                    return this.getMenu(schemaName, args);

                case 'get_promotions':
                    return this.getPromotions(schemaName);

                case 'place_order':
                    return this.placeOrder(schemaName, contactId, conversationId, args);

                case 'cancel_order':
                    return this.cancelOrder(schemaName, contactId, args.orderId, args.reason);

                case 'check_order_status':
                    return this.checkOrderStatus(schemaName, contactId, args.orderId);

                case 'list_my_orders':
                    return this.listMyOrders(schemaName, contactId, args.limit);

                // ── Gyms tools ────────────────────────────────────
                case 'get_membership_plans':
                    return this.getMembershipPlans(schemaName);

                case 'get_class_schedule':
                    return this.getClassSchedule(schemaName, args);

                case 'get_my_membership':
                    return this.getMyMembership(schemaName, contactId);

                case 'book_class':
                    return this.bookClassTool(schemaName, contactId, args);

                case 'freeze_membership':
                    return this.freezeMembershipTool(schemaName, contactId, args);

                case 'cancel_class_booking':
                    return this.cancelClassBooking(schemaName, contactId, args.bookingId);

                // ── Education tools ───────────────────────────────
                case 'get_courses':
                    return this.getCoursesTool(schemaName, args);

                case 'get_course_schedule':
                    return this.getCourseScheduleTool(schemaName, args);

                case 'enroll_student':
                    return this.enrollStudentTool(schemaName, contactId, args);

                case 'get_placement_test_link':
                    return this.getPlacementTestLinkTool(schemaName, contactId, args);

                case 'cancel_enrollment':
                    return this.cancelEnrollment(schemaName, contactId, args.enrollmentId, args.reason);

                case 'list_my_enrollments':
                    return this.listMyEnrollments(schemaName, contactId);

                // ── Insurance tools ───────────────────────────────
                case 'get_insurance_plans':
                    return this.getInsurancePlansTool(schemaName, args);

                case 'calculate_quote':
                    return this.calculateInsuranceQuoteTool(schemaName, contactId, args);

                // Paso previo obligatorio: una póliza devuelve titular, prima y
                // vigencias. La guarda de propiedad (ownsPolicy) ata el dato al
                // contacto de la conversación, pero quien controle ese número
                // sigue pudiendo leerlo. El código por un canal distinto es lo
                // que convierte la identidad de declarada en verificada.
                case 'check_policy_status': {
                    const gate = await this.requireVerifiedIdentity(tenantId, schemaName, contactId, conversationId, opts?.channelType);
                    if (gate) return gate;
                    return this.checkPolicyStatusTool(schemaName, contactId, args);
                }

                case 'request_identity_code':
                    return this.requestIdentityCodeTool(tenantId, schemaName, contactId, conversationId, opts?.channelType);

                case 'verify_identity_code':
                    return this.verifyIdentityCodeTool(conversationId, args?.code);

                case 'file_claim': {
                    const gate = await this.requireVerifiedIdentity(tenantId, schemaName, contactId, conversationId, opts?.channelType);
                    if (gate) return gate;
                    return this.fileInsuranceClaimTool(schemaName, contactId, args);
                }

                case 'list_my_claims': {
                    const gate = await this.requireVerifiedIdentity(tenantId, schemaName, contactId, conversationId, opts?.channelType);
                    if (gate) return gate;
                    return this.listMyClaimsTool(schemaName, contactId, args.policyNumber);
                }

                case 'cancel_quote':
                    return this.cancelQuoteTool(schemaName, contactId, args.quoteId);

                // ── Tier 3 tools — home services ──────────────────
                case 'create_service_request':
                    return this.createServiceRequestTool(schemaName, contactId, conversationId, args);

                case 'check_request_status':
                    return this.checkServiceRequestStatusTool(schemaName, contactId, args);

                case 'list_my_requests':
                    return this.listMyServiceRequestsTool(schemaName, contactId, args?.onlyOpen !== false);

                case 'cancel_service_request':
                    return this.cancelServiceRequest(schemaName, contactId, args.requestId, args.reason);

                // ── Tier 3 tools — pet services & photography ─────
                // These use the existing services + appointments engine
                // for actual booking; the AI tool simply reads the
                // tenant's configured services list.
                case 'list_pet_services':
                case 'list_photo_packages':
                    return this.listConfiguredServicesTool(schemaName);

                // Dos verticales distintas: la guardería reserva un RANGO contra
                // la capacidad del servicio; el estudio de fotos reserva un DÍA
                // entero. Compartían handler y por eso ninguna funcionaba bien.
                case 'check_daycare_availability':
                    return this.checkDaycareAvailabilityTool(schemaName, args);

                // ── Resource rentals (vehículo / guardería-hotel) ────
                case 'check_vehicle_rental_availability':
                    return this.checkVehicleRentalAvailability(schemaName, args);

                case 'create_vehicle_rental':
                    return this.createVehicleRental(schemaName, contactId, args);

                case 'list_my_vehicle_rentals':
                    return this.listMyResourceRentals(schemaName, contactId, 'vehicle_rental');

                case 'get_vehicle_rental':
                    return this.getResourceRental(schemaName, contactId, args.rentalId, 'vehicle_rental');

                case 'cancel_vehicle_rental':
                    return this.cancelResourceRental(schemaName, contactId, args.rentalId, 'vehicle_rental', args.reason);

                case 'create_pet_boarding':
                    return this.createPetBoarding(schemaName, contactId, args);

                case 'list_my_pet_boardings':
                    return this.listMyResourceRentals(schemaName, contactId, 'pet_boarding');

                case 'get_pet_boarding':
                    return this.getResourceRental(schemaName, contactId, args.boardingId, 'pet_boarding');

                case 'cancel_pet_boarding':
                    return this.cancelResourceRental(schemaName, contactId, args.boardingId, 'pet_boarding', args.reason);

                case 'check_date_availability':
                    return this.checkDateAvailabilityTool(schemaName, args);

                case 'request_photo_quote':
                    return this.requestPhotoQuoteTool(schemaName, contactId, conversationId, args);

                case 'cancel_photo_session':
                    return this.cancelPhotoSession(schemaName, contactId, args.sessionId, args.reason);

                case 'get_case_status':
                    return this.getCaseStatusTool(schemaName, contactId);

                default:
                    return { error: `Unknown tool: ${toolName}` };
            }
            };

            const result = await executeHandler();
            if (this.toolExecutionControl && controlDecision) {
                // A handler result is not acknowledged until the central ledger
                // commits it. A commit failure therefore fails closed.
                await this.toolExecutionControl.complete(schemaName, controlDecision, result || {});
            }
            return result;
        } catch (error: any) {
            if (this.toolExecutionControl) {
                await this.toolExecutionControl
                    .fail(schemaName, controlDecision, 'tool_execution_failed')
                    .catch(() => undefined);
            }
            // Log the technical detail internally, but return a GENERIC error to the
            // LLM — error.message can carry schema names and raw SQL fragments from
            // the DB driver that could otherwise be surfaced to the customer.
            this.logger.error(`[Tool] ${toolName} failed: ${error.message}`);
            return { error: 'tool_failed', message: 'No se pudo completar esta acción en este momento.' };
        }
    }

    // ── Catalog + Inventory tools ─────────────────────────────

    /**
     * Search products by natural-language query. Hits the `products` table in
     * the tenant schema.
     *
     * Two defects used to live here. The availability predicate was built and
     * then dropped by a `conds.slice(0, -1)`, so the agent offered products the
     * tenant had switched off. And an empty product table fell through to a
     * `courses` lookup, which handed a pharmacy or a parts store a list of
     * classes. A catalog search now answers about the catalog, or says nothing
     * matched — and a query that throws says so instead of returning zero rows.
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
                     WHERE ${conds.join(' AND ')}
                     ORDER BY name ASC
                     LIMIT $${params.length}`;
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(sql, ...params);
            return readOk({
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
            });
        } catch (e: any) {
            this.logger.warn(`[Tool] search_products failed: ${e.message}`);
            return readFailed(TOOL_READ_ERROR_CODES.READ_FAILED, {
                message: 'No pude consultar el catálogo en este momento.',
            });
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

    /**
     * Resolve a product's real catalog image and signal the conversation pipeline
     * to send it as a media message. The URL comes from the DB (never the LLM), so
     * the model can't make us send an arbitrary/hallucinated link.
     */
    private async sendProductImage(schema: string, productIdOrName: string): Promise<any> {
        const product = await this.getProduct(schema, productIdOrName);
        if (product?.error) return { error: product.error };
        const media = this.toMediaSet(product.images, product.name || undefined);
        if (!media.length) {
            return { error: 'Ese producto no tiene una imagen disponible.' };
        }
        // `_mediaToSend` is consumed by ConversationsService (which has the channel
        // routing) and stripped before the result reaches the LLM.
        return { success: true, productName: product.name, count: media.length, _mediaToSend: media };
    }

    /** Send a vacation-rental property's real photo (URL from the DB, never the LLM). */
    private async sendPropertyImage(schema: string, propertyId: string): Promise<any> {
        try {
            const p = await this.propertiesService.getById(schema, propertyId);
            if (!p) return { error: 'Property not found' };
            const media = this.toMediaSet(p.images, p.name || undefined);
            if (!media.length) {
                return { error: 'Esa propiedad no tiene una imagen disponible.' };
            }
            return { success: true, propertyName: p.name, count: media.length, _mediaToSend: media };
        } catch (e: any) {
            this.logger.warn(`[Tool] send_property_image failed: ${e.message}`);
            // Un id inválido lo puede arreglar el propio modelo, pero solo si el
            // error le dice qué se espera y de dónde sacarlo: "no se pudo" lo
            // deja repitiendo el mismo slug.
            if (e instanceof BadRequestException) {
                return {
                    error: 'invalid_property_id',
                    message: 'propertyId debe ser el UUID de la propiedad, no su nombre. Llamá list_properties para obtenerlo y reintentá.',
                };
            }
            return { error: 'No se pudo enviar la imagen de la propiedad.' };
        }
    }

    /**
     * Manda el portafolio del estudio: las fotos que el dueño subió al banco de
     * medios y etiquetó como portafolio.
     *
     * "¿Tienen fotos de trabajos anteriores?" es la pregunta que decide la venta
     * en fotografía, y hasta acá el agente solo podía describirlas con palabras.
     * Las URLs salen de la base, nunca del LLM, igual que en las otras tools de
     * imagen: el modelo no puede hacernos enviar un link arbitrario.
     *
     * Se aceptan varias etiquetas porque el dueño no sabe cuál usamos: si busca
     * por categoría ("bodas") y no hay nada, cae al portafolio general en vez de
     * responder que no tiene fotos teniéndolas.
     */
    private async sendPortfolioTool(
        schema: string,
        tenantId: string,
        args: any,
    ): Promise<any> {
        const MAX = 4; // más que esto es spam en WhatsApp, no un portafolio
        const wanted = String(args?.category || '').trim().toLowerCase();
        const tags = wanted
            ? [wanted, 'portafolio', 'portfolio']
            : ['portafolio', 'portfolio'];

        try {
            for (const tag of tags) {
                const rows: any[] = await this.prisma.executeInTenantSchema(
                    schema,
                    `SELECT file_name, label, description
                       FROM media_files
                      WHERE $1 = ANY(tags)
                        AND mime_type LIKE 'image/%'
                      ORDER BY created_at DESC
                      LIMIT ${MAX}`,
                    [tag],
                );
                if (!rows?.length) continue;

                const media = rows
                    .map(r => ({
                        url: absoluteMediaUrl(`/api/v1/media/file/${tenantId}/${r.file_name}`),
                        caption: r.label || r.description || undefined,
                    }))
                    .filter(m => !!m.url);

                if (!media.length) continue;
                return {
                    success: true,
                    count: media.length,
                    matchedTag: tag,
                    // El LLM ve el conteo pero no las URLs: no tiene por qué
                    // repetirlas en el texto, las manda el pipeline.
                    _mediaToSend: media,
                };
            }

            // Decir "no tengo portafolio cargado" es peor que ofrecer la salida
            // real: alguien del equipo sí puede mandarlo.
            return {
                error: 'no_portfolio',
                message: 'Todavía no hay fotos cargadas como portafolio. Ofrece coordinar con el equipo para enviarlas.',
            };
        } catch (e: any) {
            this.logger.warn(`[Tool] send_portfolio failed: ${e.message}`);
            return { error: 'No se pudo enviar el portafolio en este momento.' };
        }
    }


    /**
     * De la lista cruda de imagenes de una entidad a hasta N medias validas.
     *
     * Mandar UNA sola foto de un inmueble, un auto o un alojamiento es la
     * diferencia entre mostrar el producto y mostrar una miniatura: el cliente
     * decide con la fachada Y la cocina Y el baño. Ahora que el pipeline acepta
     * lista (send_portfolio), estas tres tools pueden mandar el carrusel.
     *
     * El tope es 3 y no mas: en WhatsApp cada imagen es un mensaje aparte, y
     * seis notificaciones seguidas se leen como spam, no como catalogo.
     *
     * Las relativas se absolutizan en vez de descartarse: MediaService guarda
     * lo que sube el dueño como ruta (`/api/v1/media/file/...`), asi que
     * filtrar por `^https?://` dejaba en cero el set de TODO tenant que carga
     * sus fotos por el panel — y el llamador devuelve un `error` plano, sin
     * warning, asi que la foto simplemente nunca llegaba y nadie se enteraba.
     * Lo que no es ni URL http(s) ni ruta local enraizada (`data:`,
     * `javascript:`, protocol-relative) sigue afuera: esta URL se le entrega
     * tal cual a Meta/Telegram.
     */
    private toMediaSet(images: unknown, caption?: string, max = 3): Array<{ url: string; caption?: string }> {
        if (!Array.isArray(images)) return [];
        const urls: string[] = [];
        for (const raw of images) {
            if (urls.length >= max) break;
            if (typeof raw !== 'string') continue;
            const value = raw.trim();
            const isAbsolute = /^https?:\/\//i.test(value);
            const isLocalPath = value.startsWith('/') && !value.startsWith('//');
            if (!isAbsolute && !isLocalPath) continue;
            const resolved = absoluteMediaUrl(value);
            if (resolved) urls.push(resolved);
        }
        // Solo la primera lleva epígrafe: repetir el nombre en cada foto
        // llena la pantalla del cliente con el mismo texto tres veces.
        return urls.map((url, i) => ({ url, caption: i === 0 ? caption : undefined }));
    }

    /** Send a real-estate listing's real photos (URLs from the DB, never the LLM). */
    private async sendListingImage(schema: string, listingId: string): Promise<any> {
        try {
            const l = await this.listingsService.getById(schema, listingId);
            if (!l) return { error: 'listing_not_found' };
            const media = this.toMediaSet(l.images, l.name || undefined);
            if (!media.length) {
                return { error: 'Ese inmueble no tiene una imagen disponible.' };
            }
            return { success: true, listingName: l.name, count: media.length, _mediaToSend: media };
        } catch (e: any) {
            this.logger.warn(`[Tool] send_listing_image failed: ${e.message}`);
            if (e instanceof BadRequestException) {
                return {
                    error: 'invalid_listing_id',
                    message: 'listingId debe ser el UUID del inmueble, no su nombre. Llamá search_listings para obtenerlo y reintentá.',
                };
            }
            return { error: 'No se pudo enviar la imagen del inmueble.' };
        }
    }

    /** Search the vehicle inventory (query-directa, no VerticalsModule DI). */
    private async searchVehicles(schema: string, args: any): Promise<any> {
        try {
            const conditions: string[] = [`status = 'available'`];
            const params: any[] = [];
            let idx = 1;
            if (args?.make) { conditions.push(`make ILIKE $${idx++}`); params.push(`%${args.make}%`); }
            // budgetMax is given in the major currency unit; vehicles.price_cents is in cents.
            // Guard against a non-numeric value from the LLM (NaN would throw at the DB).
            const budgetMax = Number(args?.budgetMax);
            if (Number.isFinite(budgetMax) && budgetMax > 0) { conditions.push(`price_cents <= $${idx++}`); params.push(Math.round(budgetMax * 100)); }
            if (args?.category) { conditions.push(`category = $${idx++}`); params.push(args.category); }
            if (args?.fuelType) { conditions.push(`fuel_type = $${idx++}`); params.push(args.fuelType); }
            if (args?.condition) { conditions.push(`condition = $${idx++}`); params.push(args.condition); }
            const year = Number(args?.year);
            if (Number.isFinite(year) && year > 0) { conditions.push(`year >= $${idx++}`); params.push(Math.round(year)); }

            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id, make, model, year, trim_level, color, fuel_type, transmission,
                        mileage_km, condition, price_cents, currency, category, photos[1] AS photo
                 FROM "${schema}".vehicles
                 WHERE ${conditions.join(' AND ')}
                 ORDER BY is_featured DESC, price_cents ASC
                 LIMIT 10`,
                ...params,
            );
            const vehicles = rows.map((r: any) => {
                const { price_cents, ...rest } = r;
                return { ...rest, price: Number(price_cents) / 100 };
            });
            return { count: vehicles.length, vehicles };
        } catch (e: any) {
            this.logger.warn(`[Tool] search_vehicles failed: ${e.message}`);
            return { error: 'No se pudo buscar vehículos en este momento.' };
        }
    }

    /** Full details of one vehicle (query-directa). */
    /**
     * Books a test drive — the dealership's actual sale step.
     *
     * `scheduleTestDrive` has existed in the vehicle service for months, with its
     * own slot-conflict check, and was never exposed to the agent. So automotive
     * tenants had an agent that could search, describe and photograph a car and
     * then had nothing to close with: it said "te agendo la prueba" and nothing
     * was recorded anywhere.
     */
    private static readonly UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    private async scheduleTestDrive(tenantId: string, args: any): Promise<any> {
        const UUID_RE = AIToolExecutorService.UUID_PATTERN;
        if (!this.vehicleInventory) {
            return { error: 'test_drive_unavailable', message: 'La agenda de pruebas de manejo no está disponible.' };
        }
        const vehicleId = String(args?.vehicleId || '');
        if (!UUID_RE.test(vehicleId)) return { error: 'vehicle_not_found' };
        const contactName = String(args?.contactName || '').trim();
        if (!contactName) return { error: 'contact_name_required', message: 'Falta el nombre de quien va a manejar.' };
        const scheduledDate = String(args?.scheduledDate || '').trim();
        const scheduledTime = String(args?.scheduledTime || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return { error: 'invalid_date', message: 'La fecha debe ser YYYY-MM-DD.' };
        if (!/^\d{2}:\d{2}$/.test(scheduledTime)) return { error: 'invalid_time', message: 'La hora debe ser HH:MM.' };
        try {
            const drive = await this.vehicleInventory.scheduleTestDrive(tenantId, {
                vehicleId,
                contactName,
                contactPhone: args?.contactPhone ? String(args.contactPhone) : undefined,
                scheduledDate,
                scheduledTime,
                notes: args?.notes ? String(args.notes).slice(0, 500) : undefined,
            });
            return {
                success: true,
                testDrive: {
                    id: drive?.id,
                    vehicleId,
                    date: scheduledDate,
                    time: scheduledTime,
                    status: drive?.status || 'scheduled',
                },
            };
        } catch (e: any) {
            // A taken slot is a normal outcome, not a failure to hide: the agent
            // must offer another time instead of claiming the drive is booked.
            this.logger.warn(`[Tool] schedule_test_drive failed: ${e.message}`);
            return { error: 'slot_unavailable', message: e?.message || 'Ese horario ya está tomado.' };
        }
    }

    /**
     * Creates a real order from catalog products.
     *
     * `place_order` belongs to the restaurant toolset, so a retail tenant had a
     * catalog it could search, price and photograph — and no way to sell from it.
     * The agent answered "listo, tu pedido quedó registrado" and no order existed.
     *
     * Prices are never taken from the model: only productId and quantity cross
     * the boundary, and the server prices the line from the catalog.
     */
    private async placeCatalogOrder(
        tenantId: string,
        schema: string,
        contactId: string,
        conversationId: string | undefined,
        args: any,
    ): Promise<any> {
        const UUID_RE = AIToolExecutorService.UUID_PATTERN;
        if (!this.ordersService) {
            return { error: 'orders_unavailable', message: 'La toma de pedidos no está disponible.' };
        }
        const rawItems = Array.isArray(args?.items) ? args.items : [];
        if (!rawItems.length) return { error: 'items_required', message: 'Falta qué productos quiere el cliente.' };
        if (rawItems.length > 50) return { error: 'too_many_items' };

        const items: Array<{ productId: string; productName: string; quantity: number; unitPrice: number; currency?: string }> = [];
        for (const raw of rawItems) {
            const productId = String(raw?.productId || '');
            const quantity = Math.floor(Number(raw?.quantity));
            if (!UUID_RE.test(productId)) return { error: 'product_not_found', productId };
            if (!Number.isFinite(quantity) || quantity < 1) return { error: 'invalid_quantity', productId };
            // `is_active` never existed on this table: the column is
            // `is_available`. Every call threw before reaching OrdersService, so
            // eight catalog-selling profiles could search and price a product and
            // never record a single order.
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id, name, price, currency, stock, is_available FROM "${schema}".products
                  WHERE id = $1::uuid LIMIT 1`,
                productId,
            );
            const product = rows?.[0];
            if (!product) return { error: 'product_not_found', productId };
            if (product.is_available === false) {
                return { error: 'product_unavailable', productId, productName: product.name };
            }
            // Stock NULL means the tenant does not track units for this product.
            // Only an explicit number can be short.
            if (product.stock !== null && product.stock !== undefined && Number(product.stock) < quantity) {
                return {
                    error: 'insufficient_stock',
                    productId,
                    productName: product.name,
                    available: Number(product.stock),
                    requested: quantity,
                };
            }
            items.push({
                productId,
                productName: product.name,
                quantity,
                unitPrice: Number(product.price || 0),
                currency: product.currency || undefined,
            });
        }

        try {
            const order = await this.ordersService.createOrder(tenantId, {
                contactId: UUID_RE.test(contactId) ? contactId : null,
                conversationId: conversationId && UUID_RE.test(conversationId) ? conversationId : null,
                status: 'pending',
                notes: args?.notes ? String(args.notes).slice(0, 1000) : undefined,
                items,
            });
            const total = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
            return {
                success: true,
                order: {
                    id: order?.id,
                    status: 'pending',
                    itemCount: items.length,
                    total,
                    currency: items[0]?.currency,
                    payableReference: this.payableReference('order', String(order?.id), 'pending', 'pending'),
                },
            };
        } catch (e: any) {
            this.logger.warn(`[Tool] place_catalog_order failed: ${e.message}`);
            return { error: 'order_failed', message: e?.message || 'No se pudo registrar el pedido.' };
        }
    }

    private async getVehicleDetails(schema: string, vehicleId: string): Promise<any> {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vehicleId || '')) {
            return { error: 'vehicle_not_found' };
        }
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id, make, model, year, trim_level, color, fuel_type, transmission,
                        mileage_km, condition, price_cents, currency, category, features,
                        description, location, status
                 FROM "${schema}".vehicles WHERE id = $1::uuid LIMIT 1`,
                vehicleId,
            );
            if (!rows.length) return { error: 'vehicle_not_found' };
            const { price_cents, ...rest } = rows[0];
            return { ...rest, price: Number(price_cents) / 100 };
        } catch (e: any) {
            this.logger.warn(`[Tool] get_vehicle_details failed: ${e.message}`);
            return { error: 'No se pudieron obtener los detalles del vehículo.' };
        }
    }

    /** Send a vehicle's real photo (URL from the DB, never the LLM). photos is TEXT[]. */
    private async sendVehicleImage(schema: string, vehicleId: string): Promise<any> {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vehicleId || '')) {
            return { error: 'vehicle_not_found' };
        }
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id, make, model, year, photos FROM "${schema}".vehicles WHERE id = $1::uuid LIMIT 1`,
                vehicleId,
            );
            if (!rows.length) return { error: 'vehicle_not_found' };
            const v = rows[0];
            const caption = `${v.year ?? ''} ${v.make ?? ''} ${v.model ?? ''}`.trim() || undefined;
            // Las fotos del inventario tambien pueden venir del banco de medios,
            // o sea relativas: se normalizan igual que las de las otras tools.
            // Sigue yendo UNA sola foto (el auto se muestra de a uno).
            const [photo] = this.toMediaSet(v.photos, caption, 1);
            if (!photo) {
                return { error: 'Ese vehículo no tiene una imagen disponible.' };
            }
            return { success: true, vehicle: caption, _mediaToSend: photo };
        } catch (e: any) {
            this.logger.warn(`[Tool] send_vehicle_image failed: ${e.message}`);
            return { error: 'No se pudo enviar la imagen del vehículo.' };
        }
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
                return readOk({
                    id: p.id,
                    name: p.name,
                    stock: p.stock ?? null,
                    inStock: p.stock == null ? p.is_available : Number(p.stock) > 0,
                });
            }
        } catch (e: any) {
            // The catch used to fall through to "Product not found", so a broken
            // query told the customer the product does not exist. Losing a sale
            // to an outage is bad; telling the customer we do not sell the thing
            // is worse, because they leave and do not come back.
            this.logger.warn(`[Tool] check_stock failed: ${e.message}`);
            return readFailed(TOOL_READ_ERROR_CODES.READ_FAILED, {
                message: 'No pude consultar el inventario en este momento.',
            });
        }
        return readEmpty({ product: null }, { message: 'No encontré ese producto en el catálogo.' });
    }

    // ── Knowledge tools ──────────────────────────────────────

    private async searchFaqs(
        tenantId: string,
        query: string,
        limit = 3,
        executionContext?: ServiceExecutionContext,
    ): Promise<any> {
        const faqs = await this.faqsService.search(tenantId, query, limit, executionContext);
        // View counts are analytics writes, so introspection skips them.
        if (!persistenceDisabled(executionContext)) {
            for (const f of faqs) this.faqsService.incrementViews(tenantId, f.id);
        }
        return {
            faqs: faqs.map(f => ({
                id: f.id,
                question: f.question,
                answer: f.answer,
                category: f.category,
            })),
        };
    }

    private async getPolicy(
        tenantId: string,
        type: PolicyType,
        executionContext?: ServiceExecutionContext,
    ): Promise<any> {
        const policy = await this.policiesService.getActive(tenantId, type, executionContext);
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
        if (!contactId) {
            return readUnauthorized({ message: 'Necesito identificar al cliente para ver sus pedidos.' });
        }
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
            return readOk({
                orders: rows.map(o => ({
                    id: o.id,
                    status: o.status,
                    paymentStatus: o.payment_status,
                    payableReference: this.payableReference('order', o.id, o.payment_status, o.status),
                    totalAmount: Number(o.total_amount || 0),
                    currency: o.currency,
                    items: Array.isArray(o.items) ? o.items : [],
                    createdAt: o.created_at,
                })),
            });
        } catch (e: any) {
            // `{orders: []}` after an exception had neither `error` nor
            // `success: false`, so the outcome guard read it as a successful
            // read and the agent said "no tenés pedidos" about a query that
            // threw. This is the canonical case for the read contract.
            this.logger.warn(`[Tool] list_customer_orders failed: ${e.message}`);
            return readFailed(TOOL_READ_ERROR_CODES.READ_FAILED, {
                message: 'No pude consultar los pedidos en este momento.',
            });
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
            return readOk({
                offers: rows.map(o => ({
                    id: o.id,
                    type: o.offer_type,
                    title: o.title,
                    conditions: o.conditions_json,
                    appliesTo: o.course_name ?? null,
                    validFrom: o.valid_from,
                    validTo: o.valid_to,
                })),
            });
        } catch (e: any) {
            this.logger.warn(`[Tool] list_active_offers failed: ${e.message}`);
            return readFailed(TOOL_READ_ERROR_CODES.READ_FAILED, {
                message: 'No pude consultar las promociones en este momento.',
            });
        }
    }

    /**
     * CRM context: lead score, stage, tags, opportunity count, last seen.
     * Gracefully handles missing tables — a tenant without the leads table
     * still gets a basic contact profile.
     */
    private async getCustomerContext(schema: string, contactId: string): Promise<any> {
        if (!contactId) {
            return readUnauthorized({ message: 'No tengo identificado al cliente de esta conversación.' });
        }

        // The contact row is the spine of this answer. When its query fails the
        // whole result used to degrade to `{contact: null, lead: null,
        // opportunitiesCount: 0}` with no error at all — a total database
        // outage read as "brand-new customer", and the agent greeted a
        // ten-year client as a stranger.
        let contact: any = null;
        try {
            const cRows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id, name, tags, first_contact_at, last_contact_at
                 FROM "${schema}".contacts WHERE id = $1::uuid LIMIT 1`,
                contactId,
            );
            contact = cRows[0] || null;
        } catch (e: any) {
            this.logger.warn(`[Tool] get_customer_context contacts lookup failed: ${e.message}`);
            return readFailed(TOOL_READ_ERROR_CODES.READ_FAILED, {
                message: 'No pude consultar la ficha del cliente en este momento.',
            });
        }

        // Leads and opportunities are genuinely optional — a tenant may not use
        // the CRM at all — but "we could not read them" and "there are none"
        // are still different answers, so the degradation is reported instead
        // of being indistinguishable from an empty pipeline.
        const partial: string[] = [];

        let lead: any = null;
        try {
            const lRows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id, stage, score, first_name, last_name, created_at
                 FROM "${schema}".leads WHERE contact_id = $1::uuid ORDER BY created_at DESC LIMIT 1`,
                contactId,
            );
            lead = lRows[0] || null;
        } catch { partial.push('lead'); }

        let opportunitiesCount: number | null = 0;
        try {
            const oRows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT COUNT(*)::int AS cnt FROM "${schema}".opportunities WHERE contact_id = $1::uuid`,
                contactId,
            );
            opportunitiesCount = Number(oRows[0]?.cnt || 0);
        } catch {
            partial.push('opportunities');
            opportunitiesCount = null;
        }

        return readOk({
            unreadable: partial.length ? partial : undefined,
            contact: contact ? {
                id: contact.id,
                name: contact.name,
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
        }, {
            health: partial.length ? 'degraded' : 'healthy',
        });
    }

    // ── E-commerce dual-skillset tools (T2.17) ──────────

    /**
     * Recommend products from the connected store catalog (ecommerce_products).
     * Falls back to the internal catalog `products` table if the store catalog
     * is empty/unavailable. Returns ONLY real products so the agent never invents.
     */
    private async recommendProducts(
        schema: string,
        search?: string,
        maxPrice?: number,
        category?: string,
        readOnly = false,
    ): Promise<any> {
        try {
            const rows = await this.ecommerceService.searchProductsForAI(schema, {
                search: search || undefined,
                maxPrice: typeof maxPrice === 'number' ? Math.round(maxPrice * 100) : undefined,
                category: category || undefined,
            }, { createTablesIfMissing: !readOnly });
            if (rows && rows.length > 0) {
                return {
                    products: rows.map((p: any) => ({
                        id: p.external_id,
                        title: p.title,
                        price: p.price_cents != null ? Number(p.price_cents) / 100 : null,
                        currency: p.currency || 'USD',
                        inStock: (p.inventory_quantity ?? 0) > 0,
                        handle: p.handle,
                    })),
                    source: 'store',
                };
            }
        } catch (e: any) {
            this.logger.warn(`[Tool] recommend_products store catalog unavailable: ${e.message}`);
        }
        // Fallback to the internal catalog so the agent still grounds recommendations.
        const fallback = await this.searchProducts(schema, search || '', 5, category);
        return { ...fallback, source: 'catalog' };
    }

    /**
     * Order status for the current customer. Specific order when orderId given,
     * otherwise the most recent order. Read-only.
     */
    private async getOrderStatus(schema: string, contactId: string, orderId?: string): Promise<any> {
        if (!contactId) return { error: 'No contact resolved for this conversation.' };
        try {
            const isUuid = orderId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
            const sql = isUuid
                ? `SELECT id, status, total_amount, currency, payment_status, items, created_at
                   FROM "${schema}".orders WHERE id = $1::uuid AND contact_id = $2::uuid LIMIT 1`
                : `SELECT id, status, total_amount, currency, payment_status, items, created_at
                   FROM "${schema}".orders WHERE contact_id = $1::uuid ORDER BY created_at DESC LIMIT 1`;
            const params = isUuid ? [orderId, contactId] : [contactId];
            const rows: any[] = await this.prisma.$queryRawUnsafe(sql, ...params);
            if (!rows.length) return { found: false };
            const o = rows[0];
            return {
                found: true,
                order: {
                    id: o.id,
                    status: o.status,
                    paymentStatus: o.payment_status,
                    payableReference: this.payableReference('order', o.id, o.payment_status, o.status),
                    totalAmount: Number(o.total_amount || 0),
                    currency: o.currency,
                    items: Array.isArray(o.items) ? o.items : [],
                    createdAt: o.created_at,
                },
            };
        } catch (e: any) {
            this.logger.warn(`[Tool] get_order_status failed: ${e.message}`);
            return { found: false };
        }
    }

    private moneyLedgerUnavailable(): Record<string, unknown> {
        return {
            error: 'payment_ledger_unavailable',
            shouldHandoff: true,
            message: 'No se pudo reservar una operación monetaria segura. Escala la solicitud y no anuncies éxito.',
        };
    }

    /**
     * Produce only the opaque reference understood by TenantPaymentsService.
     * The amount, currency and concept deliberately never travel through this
     * value: the payment backend resolves those from the contact-owned row.
     */
    private payableReference(
        kind: 'order' | 'tour' | 'food' | 'enrollment' | 'property',
        entityId: unknown,
        paymentStatus: unknown,
        resourceStatus?: unknown,
    ): string | null {
        const id = String(entityId || '').trim().toLowerCase();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
            return null;
        }

        // Fail closed on unknown/terminal states. `partial` is intentionally
        // excluded until the canonical resolver charges only the remaining
        // balance instead of the full enrollment price.
        const normalizedPaymentStatus = String(paymentStatus || '').trim().toLowerCase();
        if (!['pending', 'failed'].includes(normalizedPaymentStatus)) return null;

        const normalizedResourceStatus = String(resourceStatus || '').trim().toLowerCase();
        const rejectedByKind: Record<typeof kind, string[]> = {
            order: ['cancelled', 'refunded', 'paid'],
            tour: ['cancelled', 'refunded'],
            food: ['cancelled', 'refunded'],
            enrollment: ['cancelled', 'dropped', 'refunded'],
            property: ['cancelled', 'refunded'],
        };
        if (rejectedByKind[kind].includes(normalizedResourceStatus)) return null;

        return `${kind}:${id}`;
    }

    // ── Knowledge tools ─────────────────────────────

    private async searchKnowledgeBase(
        tenantId: string,
        query: string,
        limit = 5,
        executionContext?: ServiceExecutionContext,
        /** Operating country, so regulated sources of other countries stay out. */
        jurisdiction?: string | null,
    ): Promise<any> {
        try {
            const hasKnowledge = await this.knowledgeService.tenantHasKnowledge(tenantId, executionContext);
            // "El negocio no cargó base de conocimiento" y "la búsqueda no
            // encontró nada" son respuestas distintas, y ninguna de las dos es
            // "la consulta falló".
            if (!hasKnowledge) {
                return readEmpty({ chunks: [] }, {
                    message: 'Este negocio todavía no cargó base de conocimiento.',
                });
            }
            const results = await this.knowledgeService.searchRelevant(
                tenantId,
                query,
                limit,
                { executionContext, jurisdiction },
            );
            return readOk({
                chunks: (results || []).map((r: any) => ({
                    id: r.id ?? r.document_id,
                    title: r.title,
                    content: r.chunk_text,
                    score: typeof r.score === 'number' ? r.score : (typeof r.similarity === 'number' ? r.similarity : undefined),
                })),
            });
        } catch (e: any) {
            // Un RAG caído devolvía `{chunks: []}`, indistinguible de "no hay
            // nada sobre eso" — así el agente contestaba de memoria sobre una
            // política que no pudo leer.
            this.logger.warn(`[Tool] search_knowledge_base failed: ${e.message}`);
            return readFailed(TOOL_READ_ERROR_CODES.READ_FAILED, {
                message: 'No pude consultar la base de conocimiento en este momento.',
            });
        }
    }

    private async listServices(schema: string): Promise<any> {
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT id, name, description, duration_minutes, buffer_minutes, price, currency, is_active, duration_type, duration_minutes_max,
                    payment_policy, deposit_percent, deposit_amount
             FROM "${schema}".services WHERE is_active = true AND (is_public IS NULL OR is_public = true)
             ORDER BY sort_order, name`,
        );

        return {
            services: rows.map(s => {
                // La política de pago viaja con el servicio, no después.
                //
                // En alojamiento el agente ya la recibía al consultar
                // disponibilidad; en citas no la veía en ningún lado y se
                // enteraba de que había que cobrar DESPUÉS de crear la cita —
                // justo el orden invertido que este trabajo vino a arreglar.
                const policy = resolvePaymentPolicy(s, s.price);
                return {
                    id: s.id,
                    name: s.name,
                    description: s.description,
                    durationMinutes: s.duration_minutes,
                    durationMinutesMax: s.duration_minutes_max || null,
                    durationType: s.duration_type || 'fixed',
                    price: Number(s.price || 0),
                    currency: s.currency || 'COP',
                    // Los flags dicen QUÉ pasa; la nota dice CÓMO proceder.
                    requiresPaymentToConfirm: policy.requiresPayment,
                    amountDueToConfirm: policy.dueAmount,
                    paymentChoice: policy.customerChooses ? 'deposit_or_full' : undefined,
                    paymentNote: describePaymentPolicy(policy),
                };
            }),
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
        const resolvedStaffId = staffId
            ? await assertActiveTenantUser(this.prisma, schema, staffId)
            : undefined;
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

        // Get service duration + capacity. max_concurrent modela cuántas reservas
        // simultáneas admite el servicio (4 sillas de peluquería, 3 consultorios,
        // 10 mesas): la ruta pública ya lo respeta y la de chat lo ignoraba, así
        // que un salón con 4 estilistas rechazaba al segundo cliente de las 15:00.
        const svcRows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT duration_minutes, buffer_minutes, duration_type, duration_minutes_max, max_concurrent FROM "${schema}".services WHERE id = $1::uuid`,
            resolvedServiceId,
        );
        if (!svcRows.length) return { error: 'Service not found' };

        const maxConcurrent = Math.max(1, Number(svcRows[0].max_concurrent) || 1);

        const durationType = svcRows[0].duration_type || 'fixed';

        // `open` is not an appointment duration. It must be migrated to the
        // explicit nightly/day-capacity/session/resource model before booking.
        if (durationType === 'open') {
            return {
                available: false,
                error: 'temporal_contract_required',
                message: 'This service has an ambiguous open duration. Configure its explicit temporal/capacity model before offering availability.',
                slots: [],
            };
        }

        // For flexible services, use max duration for calendar blocking
        const duration = durationType === 'flexible' && svcRows[0].duration_minutes_max
            ? svcRows[0].duration_minutes_max
            : (svcRows[0].duration_minutes || 30);
        const buffer = svcRows[0].buffer_minutes || 0;
        // Total block time = service duration + post-buffer
        const totalBlock = duration + buffer;

        // Get availability slots for the day
        const dayOfWeek = dayOfWeekForLocalDate(date);

        let staffFilter = '';
        const params: any[] = [dayOfWeek, schema];
        if (resolvedStaffId) {
            staffFilter = ' AND availability.user_id = $3::uuid';
            params.push(resolvedStaffId);
        }

        const slots: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT availability.user_id, availability.start_time::text, availability.end_time::text
             FROM "${schema}".availability_slots availability
             JOIN public.users staff_user
               ON staff_user.id = availability.user_id
              AND staff_user.is_active = true
             JOIN public.tenants tenant_owner
               ON tenant_owner.id = staff_user.tenant_id
              AND tenant_owner.schema_name = $2
              AND tenant_owner.is_active = true
             WHERE availability.day_of_week = $1
               AND availability.is_active = true${staffFilter}`,
            ...params,
        );

        if (!slots.length) {
            return this.buildNoSlotsResult(schema);
        }

        // blocked_dates: feriados y vacaciones que el dueño bloqueó en el panel. La
        // ruta del dashboard los respeta (appointments.service.ts:598) y la de chat
        // no, así que el bot vendía turnos el 25 de diciembre. user_id NULL = el
        // negocio entero cerrado ese día.
        const blockedRows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT user_id FROM "${schema}".blocked_dates WHERE blocked_date = $1::date`,
            date,
        ).catch(() => []);
        if (blockedRows.length) {
            const closedForAll = blockedRows.some(b => !b.user_id);
            if (closedForAll) return this.buildNoSlotsResult(schema);
            const blockedUserIds = new Set(blockedRows.map(b => b.user_id));
            const open = slots.filter((s: any) => !s.user_id || !blockedUserIds.has(s.user_id));
            if (!open.length) return this.buildNoSlotsResult(schema);
            slots.length = 0;
            slots.push(...open);
        }

        // Get existing appointments for that date. service_id entra al SELECT para
        // poder contar la ocupación POR SERVICIO (la capacidad es del servicio, no
        // del negocio: 4 sillas de corte no son 4 salas de depilación).
        const existing: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT assigned_to, service_id,
                    to_char(start_at, 'HH24:MI') as start_time,
                    to_char(end_at, 'HH24:MI') as end_time
             FROM "${schema}".appointments
             WHERE DATE(start_at) = $1::date AND status NOT IN ('cancelled')`,
            date,
        );

        // Check Google/Microsoft Calendar busy times
        let googleBusy: { start: string; end: string }[] = [];
        try {
            googleBusy = await this.calendarIntegration.getFreeBusyForDate(schema, date, {
                serviceId: resolvedServiceId,
                staffId: resolvedStaffId,
            });
            if (googleBusy.length > 0) {
                this.logger.log(`[Tool] Calendar busy times for ${date}: ${JSON.stringify(googleBusy)}`);
            } else {
                this.logger.log(`[Tool] No calendar busy times found for ${date} (calendar may not be connected or no events)`);
            }
        } catch (e: any) {
            this.logger.warn(`[Tool] Calendar busy check failed: ${e.message}`);
            return {
                available: false,
                error: 'calendar_availability_unverified',
                message: 'External calendar availability could not be verified. Do not offer or book a slot; offer a human handoff instead.',
                slots: [],
                shouldHandoff: true,
            };
        }

        // Generate available time slots
        const availableSlots: any[] = [];

        for (const slot of slots) {
            const [startH, startM] = slot.start_time.split(':').map(Number);
            const [endH, endM] = slot.end_time.split(':').map(Number);
            const slotStartMin = startH * 60 + startM;
            const slotEndMin = endH * 60 + endM;

            // Generate slots every 30 min (or service duration if shorter).
            // A slot must fit entirely within the window INCLUDING the post-service buffer.
            // Advance by min(30, duration+buffer) so slots don't overlap for long services.
            const stepMin = Math.min(30, totalBlock);
            for (let min = slotStartMin; min + totalBlock <= slotEndMin; min += stepMin) {
                const timeStr = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
                const endMin = min + duration;
                const endTimeStr = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

                // ── All conflict checks use minutes-of-day in TENANT timezone ──
                // This avoids the UTC vs local-time mismatch bug when the Node.js
                // process runs in UTC but the tenant is in a different offset.
                const slotStartMinOfDay = min;
                // Block includes buffer so an appointment ending at 09:30 + 5min buffer
                // blocks 09:30-09:35, not just 09:30-09:30.
                const slotBlockEndMinOfDay = min + totalBlock;

                // Solapamiento en minutos del día, reutilizado por las dos reglas.
                const overlaps = (apt: any) => {
                    const [asH, asM] = apt.start_time.split(':').map(Number);
                    const [aeH, aeM] = apt.end_time.split(':').map(Number);
                    return slotStartMinOfDay < (aeH * 60 + aeM) && slotBlockEndMinOfDay > (asH * 60 + asM);
                };

                // Regla 1 — conflicto de PERSONA: una cita ya asignada a este staff
                // bloquea su ventana. Con `assigned_to` NULL no se puede atribuir a
                // nadie, así que solo cuenta para la capacidad (regla 2).
                const hasConflict = existing.some(apt => {
                    if (!apt.assigned_to) return false;
                    if (slot.user_id && slot.user_id !== apt.assigned_to) return false;
                    return overlaps(apt);
                });

                // Regla 2 — CAPACIDAD del servicio: cuántas reservas simultáneas
                // admite. Antes cualquier cita sin staff (todas las del chat, que
                // nacen con assigned_to NULL) bloqueaba la franja para el negocio
                // entero; ahora bloquea recién al llegar a max_concurrent.
                const concurrentSameService = existing.filter(apt =>
                    apt.service_id === resolvedServiceId && overlaps(apt),
                ).length;
                if (concurrentSameService >= maxConcurrent) continue;

                // Check conflicts with external calendar (Google/Microsoft) busy times.
                const calendarConflict = googleBusy.some(busy => {
                    const busyStart = wallClockEpoch(busy.start);
                    const busyEnd = wallClockEpoch(busy.end);
                    const candidateStart = wallClockEpoch(`${date}T${timeStr}:00`);
                    const candidateEnd = candidateStart + totalBlock * 60_000;
                    return candidateStart < busyEnd && candidateEnd > busyStart;
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

        // Slot hold (D3): ofrecer sin reservar es race. Al mostrar slots, pre-reservar 2 min con NX
        // para que segundo cliente no vea mismo hueco libre y luego falle al crear.
        for (const s of availableSlots.slice(0, 6)) {
            const holdKey = `slot:hold:${resolvedServiceId}:${date}:${s.time}`;
            // Best-effort, no bloquea respuesta; NX evita pisar hold existente
            this.redis.acquireLockToken(holdKey, 120).catch(() => {});
        }

        // Get user names for the slots
        const userIds = [...new Set(availableSlots.map(s => s.userId).filter(Boolean))];
        let userNames: Record<string, string> = {};
        if (userIds.length > 0) {
            const users = await this.prisma.user.findMany({
                where: {
                    id: { in: userIds },
                    isActive: true,
                    tenant: { schemaName: schema, isActive: true },
                },
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

    /**
     * Result for "no availability slots matched this weekday", distinguishing the
     * tenant that never configured ANY hours from the one that simply doesn't work
     * that weekday. The first case is a misconfiguration that must surface: the
     * booking engine escalates to a human on `appointments_not_configured`, while a
     * plain `available: false` keeps the normal "try another date" flow.
     */
    private async buildNoSlotsResult(schema: string): Promise<any> {
        const [anyRow] = (await this.prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS cnt FROM "${schema}".availability_slots WHERE is_active = true`,
        )) as any[];
        if (Number(anyRow?.cnt || 0) === 0) {
            this.logger.warn(`[Tool] check_availability for schema=${schema} but no active availability_slots exist — misconfiguration`);
            return {
                available: false,
                error: 'appointments_not_configured',
                message: 'The scheduling system is not configured for this business yet. Tell the customer that automatic booking is not available right now and offer to escalate to a human agent.',
                slots: [],
            };
        }
        return { available: false, message: 'Not available on this day of the week. Suggest an alternative date.', slots: [] };
    }

    private async checkAvailabilityOpen(
        schema: string, date: string, svc: any, staffId?: string,
    ): Promise<any> {
        const dayOfWeek = dayOfWeekForLocalDate(date);
        let staffFilter = '';
        const params: any[] = [dayOfWeek];
        if (staffId) { staffFilter = ' AND user_id = $2::uuid'; params.push(staffId); }

        const slots: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT user_id, start_time::text, end_time::text FROM "${schema}".availability_slots
             WHERE day_of_week = $1 AND is_active = true${staffFilter}`,
            ...params,
        );

        if (!slots.length) {
            // Same distinction as the fixed-duration path: an open-duration service
            // (tourism, photography…) whose tenant never loaded any hours must surface
            // the misconfiguration, otherwise the booking engine loops "no availability"
            // forever and never escalates.
            return this.buildNoSlotsResult(schema);
        }

        // blocked_dates también acá: una pernocta o una sesión de día completo no
        // debería ofrecerse un feriado que el dueño cerró.
        const blockedOpen: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT user_id FROM "${schema}".blocked_dates WHERE blocked_date = $1::date`,
            date,
        ).catch(() => []);
        if (blockedOpen.length) {
            if (blockedOpen.some(b => !b.user_id)) return this.buildNoSlotsResult(schema);
            const blockedIds = new Set(blockedOpen.map(b => b.user_id));
            const open = slots.filter((s: any) => !s.user_id || !blockedIds.has(s.user_id));
            if (!open.length) return this.buildNoSlotsResult(schema);
            slots.length = 0;
            slots.push(...open);
        }

        // For open services, return the availability windows as "slots" (no specific times)
        const userIds = [...new Set(slots.map(s => s.user_id).filter(Boolean))];
        let userNames: Record<string, string> = {};
        if (userIds.length > 0) {
            const users = await this.prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, firstName: true, lastName: true },
            });
            userNames = Object.fromEntries(users.map((u: any) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
        }

        const availableWindows = slots.map(s => ({
            time: s.start_time.substring(0, 5),
            endTime: s.end_time.substring(0, 5),
            staffName: userNames[s.user_id] || undefined,
            staffId: s.user_id || undefined,
        }));

        return {
            available: true,
            date,
            durationType: 'open',
            message: 'This service has no fixed duration. The customer can choose any time within available hours.',
            slots: availableWindows,
        };
    }

    /**
     * Re-check for an overlapping appointment for the same resource just before
     * committing. Mirrors the overlap semantics of check_availability: a conflict
     * exists unless BOTH the new and the existing appointment have a *distinct*
     * assigned_to (i.e. null staff = single shared resource → conflicts with all).
     * `excludeId` skips the appointment being rescheduled.
     */
    private async findAppointmentConflict(
        schema: string, startAt: string, endAt: string,
        assignedTo: string | null, excludeId?: string,
        serviceId?: string | null,
    ): Promise<boolean> {
        // Debe usar la MISMA regla que checkAvailability o el turno se rompe a
        // mitad: la tool ofrece un horario y el create lo rechaza.
        // (1) Conflicto de persona: solo cuando la cita existente TIENE staff.
        if (assignedTo) {
            const params: any[] = [endAt, startAt, assignedTo];
            let excludeSql = '';
            if (excludeId) { excludeSql = ' AND id != $4::uuid'; params.push(excludeId); }
            const staffRows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id FROM "${schema}".appointments
                 WHERE status NOT IN ('cancelled')
                   AND start_at < $1::timestamp
                   AND end_at > $2::timestamp
                   AND assigned_to = $3::uuid
                   ${excludeSql}
                 LIMIT 1`,
                ...params,
            );
            if (staffRows.length > 0) return true;
        }

        // (2) Capacidad del servicio: bloquea recién al alcanzar max_concurrent.
        // Sin serviceId no hay capacidad que consultar → se cae al comportamiento
        // conservador de antes (cualquier solapamiento bloquea).
        if (!serviceId) {
            const params: any[] = [endAt, startAt, assignedTo || null];
            let excludeSql = '';
            if (excludeId) { excludeSql = ' AND id != $4::uuid'; params.push(excludeId); }
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id FROM "${schema}".appointments
                 WHERE status NOT IN ('cancelled')
                   AND start_at < $1::timestamp
                   AND end_at > $2::timestamp
                   AND ($3::uuid IS NULL OR assigned_to IS NULL OR assigned_to = $3::uuid)
                   ${excludeSql}
                 LIMIT 1`,
                ...params,
            );
            return rows.length > 0;
        }

        const capRows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT COALESCE(max_concurrent, 1) AS cap FROM "${schema}".services WHERE id = $1::uuid`,
            serviceId,
        );
        const cap = Math.max(1, Number(capRows?.[0]?.cap) || 1);

        const countParams: any[] = [endAt, startAt, serviceId];
        let excludeCount = '';
        if (excludeId) { excludeCount = ' AND id != $4::uuid'; countParams.push(excludeId); }
        const busy: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS n FROM "${schema}".appointments
             WHERE status NOT IN ('cancelled')
               AND start_at < $1::timestamp
               AND end_at > $2::timestamp
               AND service_id = $3::uuid
               ${excludeCount}`,
            ...countParams,
        );
        return Number(busy?.[0]?.n || 0) >= cap;
    }

    /**
     * Acquire a short-lived per-(resource,date) lock so the conflict re-check
     * and the INSERT/UPDATE are serialized against concurrent bookings. Held for
     * a couple of DB queries only (TTL 10s is a safety net, not the expected
     * hold time). Callers fail closed when ownership cannot be obtained: a
     * transient retry is safer than creating an overlapping reservation.
     */
    private async acquireSlotLock(
        schema: string,
        assignedTo: string | null,
        date: string,
    ): Promise<{ key: string; token: string } | null> {
        const lockKey = `lock:slot:${schema}:${assignedTo || 'any'}:${date}`;
        for (let i = 0; i < 5; i++) {
            const token = await this.redis.acquireLockToken(lockKey, 10);
            if (token) return { key: lockKey, token };
            if (i < 4) await new Promise(r => setTimeout(r, 200));
        }
        this.logger.warn(`[Tool] Slot lock ${lockKey} busy after retries — booking write rejected`);
        return null;
    }

    private async createAppointment(
        schema: string, tenantId: string, contactId: string,
        args: { serviceId: string; staffId?: string; date: string; time: string; customerName: string; customerPhone?: string; customerEmail?: string; notes?: string },
        conversationId?: string,
        evalMode?: boolean,
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

        // Get service (including modality + duration-model columns). Sin
        // duration_type en el SELECT, la rama 'open' de abajo era código muerto:
        // una pernocta de 1440 min computaba endAt con hora >= 24 → timestamp
        // inválido → tool_failed. El check de disponibilidad ya la aceptaba
        // (b9bd6332), pero la reserva en sí seguía rota.
        const svcRows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT id, name, duration_minutes, duration_type, duration_minutes_max, price, currency, location_type, location_address, meeting_link FROM "${schema}".services WHERE id = $1::uuid AND is_active = true`,
            args.serviceId,
        );
        if (!svcRows.length) return { error: 'Service not found' };

        const svc = svcRows[0];
        const startAt = `${args.date}T${args.time}:00`;
        const durType = svc.duration_type || 'fixed';
        if (durType === 'open') {
            return {
                error: 'temporal_contract_required',
                message: 'This service cannot be booked as a placeholder appointment. Configure nightly, day-capacity, session, or resource semantics first.',
            };
        }
        const effectiveDuration = Number(
            durType === 'flexible' && svc.duration_minutes_max
                ? svc.duration_minutes_max : svc.duration_minutes,
        );
        let endAt: string;
        try {
            const normalized = this.temporalContracts.normalize({
                kind: 'appointment',
                startsAtLocal: startAt,
                timezone: await this.getTenantTimezone(schema),
                durationMinutes: effectiveDuration,
            });
            if (normalized.kind !== 'appointment') throw new Error('wrong_temporal_kind');
            endAt = normalized.endsAtLocal;
        } catch {
            return {
                error: 'invalid_appointment_temporal_contract',
                message: 'The service duration or timezone is invalid. Correct configuration before creating an appointment.',
            };
        }

        // El objeto de la cita se resuelve ANTES del lock, no dentro: de él sale
        // el asesor sugerido, y el lock y el chequeo de conflicto se toman POR
        // profesional. Resolverlo después habría dejado a la visita inmobiliaria
        // compitiendo por el lock global mientras se le asignaba un asesor
        // concreto — el bloqueo entre visitas a propiedades distintas que este
        // cambio viene justamente a levantar.
        const subject = await this.resolveAppointmentSubject(schema, args);
        const staffCandidate = args.staffId || subject.suggestedStaffId || null;
        const assignedTo = staffCandidate
            ? await assertActiveTenantUser(this.prisma, schema, staffCandidate)
            : null;

        // Build the immutable calendar snapshot before the appointment INSERT.
        // The outbox reads the just-inserted row in the same transaction, so a
        // later best-effort UPDATE would permanently enqueue stale calendar data.
        const descriptionParts: string[] = [];
        descriptionParts.push(`Customer: ${args.customerName}`);
        if (args.customerEmail) descriptionParts.push(`Email: ${args.customerEmail}`);
        if (args.customerPhone) descriptionParts.push(`Phone: ${args.customerPhone}`);
        descriptionParts.push('');
        const priceStr = svc.price ? `${Number(svc.price).toLocaleString()} ${svc.currency || 'COP'}` : 'N/A';
        descriptionParts.push(`Service: ${svc.name} (${priceStr})`);
        descriptionParts.push(`Duration: ${svc.duration_minutes} min`);
        for (const label of subject.labels) descriptionParts.push(label);

        if (conversationId) {
            try {
                const msgs: any[] = await this.prisma.$queryRawUnsafe(
                    `SELECT direction, content_text FROM "${schema}".messages WHERE conversation_id = $1::uuid ORDER BY created_at DESC LIMIT 5`,
                    conversationId,
                );
                if (msgs.length > 0) {
                    descriptionParts.push('');
                    descriptionParts.push('Conversation context:');
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
        const isOnline = svc.location_type === 'online';
        const location = svc.location_type === 'in_person' && svc.location_address
            ? svc.location_address
            : null;
        const meetingUrl: string | undefined = svc.meeting_link || undefined;
        const appointmentMetadata = {
            ...(subject.metadata || {}),
            isOnline,
            ...(meetingUrl ? { meetingUrl } : {}),
        };

        // Double-booking guard: re-check availability and INSERT under a short
        // per-(staff,date) lock. check_availability runs earlier in the turn, but
        // without this there is a TOCTOU window where two concurrent customers
        // can both book the same slot. Both paths funnel through this INSERT.
        const slotLock = await this.acquireSlotLock(schema, assignedTo, args.date);
        if (!slotLock) {
            return {
                error: 'The booking slot is being updated by another request. Please check availability again and retry.',
                retryable: true,
            };
        }
        let rows: any[];
        try {
            const insertSql = `INSERT INTO appointments
                 (contact_id, opportunity_id, conversation_id, service_id, service_name, assigned_to, start_at, end_at, status,
                  customer_name, customer_phone, customer_email, location, notes, metadata)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::uuid, $7::timestamp, $8::timestamp, 'confirmed',
                         $9, $10, $11, $12, $13, $14::jsonb)
                 RETURNING id, service_name, start_at, end_at, status`;
            rows = await this.prisma.transactionInTenantSchema(schema, async (query) => {
                const canonicalContactId = await requireTenantContact(query, contactId);
                const opportunityId = await resolveNativeEvidenceOpportunity(query, {
                    contactId: canonicalContactId,
                    conversationId,
                });
                await lockAndAssertAppointmentCapacity(query, {
                    schemaName: schema,
                    serviceId: args.serviceId,
                    staffUserId: assignedTo,
                    startAt,
                    endAt,
                });
                const insertParams = [
                    canonicalContactId, opportunityId, conversationId || null,
                    args.serviceId, svc.name, assignedTo, startAt, endAt,
                    args.customerName, args.customerPhone || null, args.customerEmail || null,
                    location, description, JSON.stringify(appointmentMetadata),
                ];
                const inserted = await query<any[]>(insertSql, insertParams);
                if (!evalMode) {
                    await CalendarSyncOutboxService.enqueueWithTransaction(query, inserted[0].id, 'upsert');
                }
                return inserted;
            });
        } catch (error) {
            if (error instanceof AppointmentSlotConflictError) {
                this.logger.warn(`[Tool] Double-booking prevented: ${args.date} ${args.time} (staff=${assignedTo || 'any'})`);
                return { error: 'That time slot was just taken. Offer the customer another available time (call check_availability again).' };
            }
            if (error instanceof AppointmentServiceUnavailableError) {
                return { error: 'Service not found' };
            }
            throw error;
        } finally {
            await this.redis.releaseLockToken(slotLock.key, slotLock.token);
        }

        const apt = rows[0];
        this.logger.log(`[Tool] Appointment created: ${apt.id} for ${args.customerName}`);

        // Emit event so notifications (WhatsApp confirmation, email, calendar) are
        // triggered. In evalMode the INSERT above still happens (so verifyActions can
        // assert it) but NO outbound side-effect fires (no message/email/webhook/calendar).
        if (!evalMode) this.eventEmitter.emit('appointment.created', {
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
                // Without this the confirmation never shows the address: every
                // listener reads `appointment.location`, and this path — the one
                // the AI actually uses — used to leave it undefined.
                location,
                assignedTo,
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
            `SELECT id, contact_id, service_id, service_name, start_at, end_at, status
             FROM "${schema}".appointments WHERE id = $1::uuid`,
            appointmentId,
        );

        if (!rows.length) return { error: 'Appointment not found' };
        if (rows[0].contact_id !== contactId) return { error: 'You can only cancel your own appointments' };
        if (rows[0].status === 'cancelled') {
            return { success: true, alreadyCancelled: true, message: 'Appointment was already cancelled.', alternatives: [] };
        }

        const updated: any[] = await this.prisma.transactionInTenantSchema(
            schema,
            async (query) => {
                const changed = await query<any[]>(
                    `UPDATE appointments
                     SET status = 'cancelled', cancellation_reason = $1,
                         notes = COALESCE(notes, '') || $2, updated_at = NOW()
                     WHERE id = $3::uuid AND status <> 'cancelled'
                     RETURNING id`,
                    [
                        reason || null,
                        reason ? `\n[Cancelado: ${reason}]` : '\n[Cancelado por el cliente]',
                        appointmentId,
                    ],
                );
                if (changed.length) {
                    await CalendarSyncOutboxService.enqueueWithTransaction(query, appointmentId, 'delete');
                }
                return changed;
            },
        );
        // A concurrent retry may have won after our SELECT. Treat it as the same
        // successful cancellation, but do not repeat notes, events or messages.
        if (!updated.length) {
            return { success: true, alreadyCancelled: true, message: 'Appointment was already cancelled.', alternatives: [] };
        }

        this.eventEmitter.emit('appointment.cancelled', {
            schemaName: schema,
            appointment: {
                id: rows[0].id,
                contactId: rows[0].contact_id,
                serviceId: rows[0].service_id,
                serviceName: rows[0].service_name,
                startAt: rows[0].start_at,
                endAt: rows[0].end_at,
                status: 'cancelled',
            },
            reason,
        });

        // Recuperar la franja en el mismo turno.
        //
        // El cliente que cancela ya está en la conversación, ya eligió su
        // servicio y sigue queriendo el servicio: casi siempre lo que cambió es
        // el día. Cerrar con "listo, cancelada" lo devuelve a la calle y deja el
        // hueco sin llenar. Ofrecer tres horarios ahí mismo es el momento de
        // mayor probabilidad de re-reserva que tiene el negocio, y no cuesta una
        // conversación nueva.
        //
        // Se ofrece a partir del día SIGUIENTE a la cita cancelada: quien
        // cancela el turno de mañana rara vez quiere el de mañana.
        const alternatives: any[] = [];
        if (rows[0].service_id) {
            const from = new Date(rows[0].start_at);
            from.setDate(from.getDate() + 1);
            for (let i = 0; i < 5 && alternatives.length < 3; i++) {
                const probe = new Date(from);
                probe.setDate(probe.getDate() + i);
                const date = probe.toISOString().slice(0, 10);
                const avail = await this.checkAvailability(schema, date, rows[0].service_id)
                    .catch(() => null);
                for (const s of (avail?.slots || []).slice(0, 3 - alternatives.length)) {
                    alternatives.push({ date, time: s.time, staffName: s.staffName });
                }
            }
        }

        return {
            success: true,
            message: alternatives.length
                ? 'Appointment cancelled. Offer these alternative slots in the same reply — the customer already wanted this service, so re-booking now is far more likely than in a new conversation. Do NOT book any of them without explicit confirmation.'
                : 'Appointment cancelled.',
            alternatives,
        };
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
                message: 'Public booking is not enabled. Contact the team to enable it, or book through this chat.',
            };
        }
        const baseUrl = process.env.DASHBOARD_URL || 'https://admin.parallly-chat.cloud';
        const url = `${baseUrl}/book/${tenant.slug}`;
        return {
            enabled: true,
            url,
            message: `You can book your appointment here: ${url}`,
        };
    }

    // ── Vacation Rental tools ────────────────────────────────

    /**
     * List active properties, optionally filtering by guest capacity.
     */
    private async listProperties(schema: string, guests?: number, checkIn?: string, checkOut?: string, tenantId?: string): Promise<any> {
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
                // Validate the range ONCE, before the loop. It is a property of
                // the request, not of any listing: when it was only discovered
                // inside the per-property catch, the same exception repeated for
                // every property, the list came back empty and the agent told a
                // traveller "no availability" with the whole catalogue free.
                // The model corrects itself when handed a typed error.
                const rangeError = this.validateStayRange(checkIn, checkOut);
                if (rangeError) {
                    this.logger.warn(`[Tool] list_properties rejected date range: ${rangeError}`);
                    return { error: rangeError, checkIn, checkOut };
                }

                const available: any[] = [];
                let failures = 0;
                for (const prop of properties) {
                    try {
                        const avail = await this.propertiesService.checkAvailability(schema, prop.id, checkIn, checkOut, tenantId);
                        if (avail.available) {
                            available.push({ ...prop, totalPrice: avail.totalPrice, nights: avail.nights });
                        }
                    } catch (error: any) {
                        // A single listing failing is genuinely skippable; every
                        // listing failing is a systemic fault, and reporting it
                        // as "nothing available" would lose a real booking.
                        failures++;
                        this.logger.warn(
                            `[Tool] list_properties availability check failed for ${prop.id}: ${error.message}`,
                        );
                    }
                }
                if (failures === properties.length) {
                    return { error: 'availability_unavailable', checkIn, checkOut };
                }
                properties = available;
            }

            return { properties };
        } catch (e: any) {
            this.logger.warn(`[Tool] list_properties failed: ${e.message}`);
            // Never answer a catalogue failure with an empty catalogue: that
            // reads to the agent — and then to the customer — as "we have
            // nothing", which is a lost sale rather than a retryable error.
            return { error: 'catalog_unavailable' };
        }
    }

    /**
     * Shared, provider-independent sanity check for a stay range. Returns a
     * stable error code the model can act on, or null when the range is usable.
     */
    private validateStayRange(checkIn: string, checkOut: string): string | null {
        const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
        if (!isIsoDate(checkIn) || !isIsoDate(checkOut)) return 'invalid_date_format';

        const start = new Date(`${checkIn}T00:00:00Z`);
        const end = new Date(`${checkOut}T00:00:00Z`);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'invalid_date_format';
        // Same-day check-in/check-out is the single most common way this used to
        // blank the catalogue: a guest asking for "tonight" without a next day.
        if (end.getTime() <= start.getTime()) return 'checkout_must_be_after_checkin';
        return null;
    }

    /**
     * Check availability and pricing for a specific property + date range.
     */
    private async checkPropertyAvailability(
        schema: string, propertyId: string, checkIn: string, checkOut: string, guests?: number, tenantId?: string,
    ): Promise<any> {
        try {
            const avail = await this.propertiesService.checkAvailability(schema, propertyId, checkIn, checkOut, tenantId);

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

            // When the business runs its own channel manager, availability is a
            // mirror and the stay cannot be closed here. Saying so is the only
            // honest answer: the alternative is a booking the PMS never sees.
            if (avail.canBookDirectly === false) {
                return {
                    ...avail,
                    message: 'Este alojamiento se administra desde el channel manager del negocio. Podés informar disponibilidad, pero la reserva la confirma el equipo — no la des por hecha.',
                };
            }
            return avail;
        } catch (e: any) {
            this.logger.warn(`[Tool] check_property_availability failed: ${e.message}`);
            return readFailed(TOOL_READ_ERROR_CODES.READ_FAILED, {
                message: 'No pude consultar la disponibilidad de ese alojamiento en este momento.',
            });
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
    /**
     * Instrucciones de acceso — SOLO para quien tiene la reserva.
     *
     * Esto devuelve `check_in_instructions` (en la practica: donde esta la
     * llave, el codigo de la caja fuerte) y la direccion exacta. Antes bastaba
     * con nombrar un propertyId, y los ids son triviales de obtener:
     * list_properties devuelve el catalogo entero. Cualquiera podia navegar las
     * unidades y pedir el codigo de puerta de una casa que en ese momento esta
     * ocupada por otro huesped. No es una fuga de datos, es seguridad fisica.
     *
     * Se exige una reserva viva del propio contacto sobre esa propiedad. La
     * ventana llega hasta el check-out: el huesped necesita el codigo durante
     * toda su estadia, no solo el dia que llega.
     */
    /**
     * De qué objeto de negocio trata la cita: el inmueble que se visita, la
     * mascota que se atiende, el auto que se prueba.
     *
     * `appointments.metadata` existe desde siempre y la ruta del dashboard la
     * escribe; la ruta de CHAT —la que genera casi todas las citas— la omitía.
     * Sin esto, una inmobiliaria con 40 propiedades sabe que el martes a las 4
     * hay una visita y no cuál inmueble se muestra; una veterinaria no sabe qué
     * mascota viene; y un test drive no dice de qué auto. Es el dato que
     * después permite bloquear "esa propiedad a esa hora" y reportar
     * propiedad → visitas → negocio.
     *
     * El id se VALIDA contra su tabla antes de guardarse. Viene de un LLM: un
     * UUID alucinado que entra sin chequear no rompe nada visible hoy y
     * envenena en silencio todo el reporting de mañana. Si la tabla no existe
     * (las verticales son lazy) el id es necesariamente espurio y se descarta.
     */
    private async resolveAppointmentSubject(
        schema: string,
        args: any,
    ): Promise<{ metadata: Record<string, string>; labels: string[]; suggestedStaffId?: string }> {
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        // La etiqueta se resuelve en el mismo viaje que la validación: es lo que
        // después ve el asesor en su calendario, y un id crudo no le sirve.
        const candidates: Array<{ key: string; table: string; label: string; select: string; value: any }> = [
            { key: 'listingId', table: 'real_estate_listings', label: 'Inmueble', select: 'name', value: args.listingId },
            { key: 'petId', table: 'pets', label: 'Mascota', select: `name || ' (' || COALESCE(species, '') || ')'`, value: args.petId },
            { key: 'vehicleId', table: 'vehicles', label: 'Vehículo', select: `make || ' ' || model || ' ' || year::text`, value: args.vehicleId },
        ];

        const metadata: Record<string, string> = {};
        const labels: string[] = [];
        for (const c of candidates) {
            if (typeof c.value !== 'string' || !UUID_RE.test(c.value)) continue;
            const found: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT ${c.select} AS label FROM "${schema}".${c.table} WHERE id = $1::uuid LIMIT 1`,
                c.value,
            ).catch(() => [] as any[]);
            if (found.length) {
                metadata[c.key] = c.value;
                if (found[0].label) labels.push(`${c.label}: ${found[0].label}`);
            } else {
                this.logger.warn(`[Tool] create_appointment: ${c.key}=${c.value} no existe en ${c.table}; se descarta`);
            }
        }

        // Quién muestra el inmueble: dueño del listing → asesor de la zona → nadie.
        //
        // Sin esto TODA visita nacía con assigned_to NULL, y eso en inmobiliaria
        // no es solo un dato faltante: es lo que hacía que dos visitas a
        // propiedades DISTINTAS en el mismo horario se bloquearan entre sí, como
        // si la agencia entera fuera un único consultorio. Es la condición para
        // que H-1 y H-2 sirvan de algo en este rubro.
        //
        // `listing_zone_agents` y `resolveAgentForZone` estaban construidos
        // enteros —con endpoints y todo— y tenían CERO llamadores: el ruteo por
        // zonas existía y no ruteaba nada.
        let suggestedStaffId: string | undefined;
        if (metadata.listingId) {
            const listing = await this.listingsService.getById(schema, metadata.listingId).catch(() => null);
            if (listing?.assigned_agent_id) {
                suggestedStaffId = listing.assigned_agent_id;
            } else if (listing?.neighborhood) {
                suggestedStaffId = (await this.listingsService
                    .resolveAgentForZone(schema, listing.neighborhood, listing.city)
                    .catch(() => null)) || undefined;
            }
        }

        return { metadata, labels, suggestedStaffId };
    }

    private async getCheckInInstructions(schema: string, contactId: string, propertyId: string): Promise<any> {
        try {
            const p = await this.propertiesService.getById(schema, propertyId);
            if (!p) return { error: 'Property not found' };

            const booking: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT 1 FROM "${schema}".property_bookings
                 WHERE property_id = $1::uuid AND contact_id = $2::uuid
                   AND status NOT IN ('cancelled', 'rejected')
                   AND check_in <= CURRENT_DATE
                   AND check_out >= CURRENT_DATE
                 LIMIT 1`,
                propertyId, contactId,
            );
            if (!booking.length) {
                return {
                    error: 'This customer has no active booking for that property. Do NOT share the address or access instructions. Offer to check their reservation or connect them with a human agent.',
                };
            }

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
    /**
     * Lo que tiene que ser cierto para que valga la pena preguntarle al cliente.
     *
     * Devuelve null si se puede seguir, o el resultado de error si no. El mensaje
     * es para el cliente y por eso no nombra identificadores ni tablas: la
     * agente tiene `list_properties` para reencontrar el dato, y ahora tambien
     * el bloque <recent_actions> donde ese id figura.
     */
    private async assertWritePreconditions(
        schemaName: string, toolName: string, args: any,
    ): Promise<any | null> {
        if (toolName !== 'create_property_booking') return null;
        const propertyId = String(args?.propertyId || '').trim();
        try {
            const property = await this.propertiesService.getById(schemaName, propertyId);
            if (property) return null;
        } catch {
            // getById valida el formato y tira si no existe: ambos casos son
            // lo mismo aca — no hay alojamiento al que reservarle.
        }
        this.logger.warn(`[Tool] ${toolName} bloqueada antes de confirmar: propertyId "${propertyId.slice(0, 40)}" no existe`);
        return {
            error: 'unknown_property',
            message: 'No pude ubicar ese alojamiento. Verificá cuál es antes de continuar.',
            retryable: true,
        };
    }

    private async createPropertyBooking(
        schema: string, contactId: string,
        args: { propertyId: string; checkIn: string; checkOut: string; guestName: string; guestPhone?: string; guests?: number },
        conversationId?: string,
        tenantId?: string,
    ): Promise<any> {
        try {
            const booking = await this.propertiesService.createBooking(schema, args.propertyId, {
                tenantId: tenantId || null,
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
                // La estadía existe pero NO está confirmada: el dueño exige pago
                // y el cupo sigue a la venta. Va al tope del resultado porque de
                // acá salen la directiva del turno y el guardrail de reclamos —
                // sin esto el agente decía "quedó confirmada" sobre algo que
                // nadie pagó.
                awaitingPayment: (booking as any).awaitingPayment === true,
                amountDueToConfirm: (booking as any).amountDueToConfirm,
                paymentChoice: (booking as any).paymentChoice,
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
                    paymentStatus: booking.payment_status || 'pending',
                    // The stay is the vertical's core sale. Without a reference
                    // the agent could confirm the booking and then had no way to
                    // charge for it — the guest was told about payment and
                    // nothing could ever be issued.
                    payableReference: this.payableReference(
                        'property',
                        booking.id,
                        booking.payment_status || 'pending',
                        booking.status,
                    ),
                },
            };
        } catch (e: any) {
            const detail = typeof e?.response === 'object' && e.response ? e.response : {};
            // The business runs its own channel manager for this unit. That is
            // not a failure to hide behind a generic error: it is a real answer
            // the guest needs, and the turn must escalate instead of retrying.
            if (detail.error === 'channel_manager_owns_calendar') {
                return {
                    error: 'channel_manager_owns_calendar',
                    shouldHandoff: true,
                    provider: detail.provider ?? null,
                    asOf: detail.asOf ?? null,
                    stale: detail.stale === true,
                    message: 'Este alojamiento se administra desde el sistema del negocio. Decile al huésped que el equipo confirma la reserva y pasá la conversación — no la des por confirmada.',
                };
            }
            if (detail.error === 'duplicate_property_booking') {
                return {
                    error: 'duplicate_property_booking',
                    bookingId: detail.bookingId ?? null,
                    message: detail.message || 'Ese huésped ya tiene una reserva para esas fechas.',
                };
            }
            this.logger.warn(`[Tool] create_property_booking failed: ${e.message}`);
            return { error: 'booking_failed', message: 'No pude registrar la reserva en este momento.' };
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
                    paymentStatus: booking.payment_status || 'pending',
                    payableReference: this.payableReference(
                        'tour',
                        booking.id,
                        booking.payment_status || 'pending',
                        booking.status,
                    ),
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
                    message: 'No pets registered for this contact yet. Use register_pet to add one.',
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
                message: `Pet ${pet.name} registered successfully.`,
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async getVaccinationStatus(schemaName: string, contactId: string, petId: string): Promise<any> {
        try {
            const pet = await this.petsService.getById(schemaName, petId);
            // La historia clinica de una mascota es de su tutor. pets.contact_id
            // es NOT NULL, asi que aqui no hay caso ambiguo: o es tuya o no.
            // Mismo mensaje para "no existe" y "no es tuya" para no dejar un
            // oraculo de ids.
            if (!pet || pet.contact_id !== contactId) {
                return { error: 'No pet with that id belongs to this customer.' };
            }
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
            const withoutSchedule: any[] = [];
            for (const v of Object.values(lastByVaccine) as any[]) {
                if (!v.next_due_at) {
                    // Aplicada pero sin proxima fecha: no prueba nada sobre si esta
                    // al dia. Antes se descartaba en silencio.
                    withoutSchedule.push({ vaccineName: v.vaccine_name, lastApplied: v.applied_at });
                    continue;
                }
                const due = new Date(v.next_due_at);
                if (due < today) {
                    overdue.push({ vaccineName: v.vaccine_name, dueDate: v.next_due_at, lastApplied: v.applied_at });
                } else {
                    upcoming.push({ vaccineName: v.vaccine_name, dueDate: v.next_due_at, lastApplied: v.applied_at });
                }
            }

            // "Al dia" solo se afirma con evidencia.
            //
            // Antes era `overdue.length === 0`, y eso decia que SI a la mascota
            // que no tiene ni un solo registro de vacuna — justo la que mas
            // necesita venir. Es una afirmacion sanitaria hecha sobre la nada, y
            // salia por WhatsApp firmada por la clinica.
            //
            // Tampoco alcanza con tener vacunas cargadas: si ninguna tiene
            // proxima fecha, no hay con que comparar contra hoy.
            const hasEvidence = upcoming.length > 0 || overdue.length > 0;
            const status: 'up_to_date' | 'overdue' | 'unknown' =
                overdue.length > 0 ? 'overdue' : hasEvidence ? 'up_to_date' : 'unknown';

            return {
                petName: pet.name,
                totalVaccinations: vaccinations.length,
                upcoming: upcoming.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()),
                overdue,
                withoutSchedule,
                status,
                isUpToDate: status === 'up_to_date',
                // El LLM necesita que se le diga explicitamente que NO puede
                // rellenar el hueco: ante la duda, invita a la consulta.
                guidance: status === 'unknown'
                    ? (vaccinations.length === 0
                        ? 'There are NO vaccination records for this pet in the clinic system. Do NOT say the pet is up to date or overdue — say the clinic has no records on file and invite the owner to bring the vaccination card or book a check-up.'
                        : 'There are vaccination records but none has a next-due date, so it is IMPOSSIBLE to know whether the pet is up to date. Do NOT guess — offer to book a check-up so the vet can review the schedule.')
                    : undefined,
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
                recommendation: 'Immediate attention required — escalating to a veterinarian.',
                shouldHandoff: true,
            };
        }
        if (moderateSignals.some(s => text.includes(s))) {
            return {
                severity: 'non_urgent',
                recommendation: 'Symptoms that require a consultation. Offer to schedule an appointment within 24-48h.',
                shouldHandoff: false,
            };
        }
        return {
            severity: 'unclear',
            recommendation: 'Ask for more details about the symptoms (when it started, frequency, other signs) before deciding.',
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
                return { items: [], message: 'No items match those criteria. Suggest broadening the search.' };
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
                return { promotions: [], message: 'No active promotions at this time.' };
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

            // Price integrity: NEVER trust the unitPrice supplied by the LLM/customer.
            // Resolve the authoritative price from menu_items for every item. An item
            // without a valid, active+available menuItemId is rejected so a tampered
            // price can't slip through into the order total.
            const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            const validIds = [...new Set(
                args.items.map((it: any) => it.menuItemId).filter((id: any) => typeof id === 'string' && uuidRe.test(id)),
            )] as string[];
            const priceMap: Record<string, {
                price: number;
                name: string;
                currency: string;
                prepTimeMinutes?: number;
            }> = {};
            if (validIds.length) {
                const rows: any[] = await this.prisma.$queryRawUnsafe(
                    `SELECT id, name, price, currency, prep_time_minutes FROM "${schemaName}".menu_items
                     WHERE id = ANY($1::uuid[]) AND is_active = true AND is_available = true`,
                    validIds,
                );
                for (const r of rows) {
                    priceMap[r.id] = {
                        price: Number(r.price),
                        name: r.name,
                        currency: r.currency || 'COP',
                        prepTimeMinutes: r.prep_time_minutes == null
                            ? undefined
                            : Number(r.prep_time_minutes),
                    };
                }
            }

            const resolvedItems: Array<{
                menuItemId: string;
                name: string;
                quantity: number;
                unitPrice: number;
                currency: string;
                prepTimeMinutes?: number;
                specialInstructions?: string;
            }> = [];
            for (const it of args.items) {
                const menuItem = it.menuItemId ? priceMap[it.menuItemId] : undefined;
                if (!menuItem) {
                    return { error: `Item "${it.name || it.menuItemId || 'unknown'}" is not on the menu or is unavailable. Use the menu tools to get valid items before placing the order.` };
                }
                const qty = Math.max(1, Math.floor(Number(it.quantity) || 1));
                resolvedItems.push({
                    menuItemId: it.menuItemId,
                    name: menuItem.name,        // snapshot the real catalog name
                    quantity: qty,
                    unitPrice: menuItem.price,  // authoritative price — overrides the arg
                    currency: menuItem.currency,
                    prepTimeMinutes: menuItem.prepTimeMinutes,
                    specialInstructions: it.specialInstructions,
                });
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
                currency: resolvedItems[0].currency,
                items: resolvedItems,
                paymentMethod: args.paymentMethod,
                notes: args.notes,
            });

            return {
                orderId: order.id,
                status: order.status,
                paymentStatus: order.payment_status || 'pending',
                payableReference: this.payableReference(
                    'food',
                    order.id,
                    order.payment_status || 'pending',
                    order.status,
                ),
                total: Number(order.total || 0),
                currency: order.currency,
                itemsCount: (order.items || []).length,
                estimatedDelivery: order.estimated_delivery_minutes == null
                    ? null
                    : `${Number(order.estimated_delivery_minutes)} minutos`,
                estimatedDeliveryAt: order.estimated_delivery_at || null,
                message: `Order created successfully. Total: ${Number(order.total || 0).toLocaleString()} ${order.currency}`,
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    // ── Gyms tools ────────────────────────────────────────────────

    private async getMembershipPlans(schemaName: string): Promise<any> {
        try {
            const plans = await this.gymsService.listPlans(schemaName, false);
            if (!plans.length) return { plans: [], message: 'No plans available.' };
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
                return { classes: [], message: 'No classes scheduled in the requested range.' };
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
                return { isMember: false, message: 'Contact does not have an active membership. Offer get_membership_plans to sign up.' };
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

    private async bookClassTool(schemaName: string, contactId: string, args: any): Promise<any> {
        try {
            // IDOR guard: a customer can only book classes against their OWN membership.
            // Resolve the member from the current contact and ignore/reject any memberId
            // the LLM (or a malicious customer) may have supplied.
            const member = await this.gymsService.getMemberByContact(schemaName, contactId);
            if (!member) {
                return { error: 'The contact has no active membership. Offer get_membership_plans to sign up first.' };
            }
            if (args.memberId && args.memberId !== member.id) {
                return { error: 'You can only book classes for your own membership.' };
            }
            const booking = await this.gymsService.bookClass(schemaName, args.classId, member.id);
            // Clase llena: el socio queda EN ESPERA, no rechazado. El mensaje
            // tiene que decir las dos cosas que le importan — que todavía no
            // tiene lugar, y que no hay que hacer nada más si alguien cancela.
            if (booking.waitlisted) {
                return {
                    bookingId: booking.id,
                    status: booking.status,
                    waitlistPosition: booking.waitlistPosition,
                    creditsUsed: 0,
                    message: `The class is full. The member is now on the waitlist at position ${booking.waitlistPosition}. Tell them clearly they do NOT have a spot yet, that no credits were used, and that they will get it automatically if someone cancels — they do not need to do anything else.`,
                };
            }
            return {
                bookingId: booking.id,
                status: booking.status,
                creditsUsed: booking.credits_used,
                message: 'Class booking confirmed.',
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async freezeMembershipTool(schemaName: string, contactId: string, args: any): Promise<any> {
        try {
            // IDOR guard: only the contact's own membership can be frozen.
            const member = await this.gymsService.getMemberByContact(schemaName, contactId);
            if (!member) {
                return { error: 'The contact has no active membership to freeze.' };
            }
            if (args.memberId && args.memberId !== member.id) {
                return { error: 'You can only freeze your own membership.' };
            }
            const frozen = await this.gymsService.freezeMember(schemaName, member.id, args.days);
            return {
                memberId: frozen.id,
                status: frozen.status,
                frozenFrom: frozen.frozen_from,
                frozenUntil: frozen.frozen_until,
                message: `Membership frozen for ${args.days} days.`,
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
            if (!courses.length) return { courses: [], message: 'No courses match the criteria.' };
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
                return { cohorts: [], message: 'No open cohorts in the requested range. Suggest joining the waitlist.' };
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
                payableReference: this.payableReference(
                    'enrollment',
                    enrollment.id,
                    enrollment.payment_status,
                    enrollment.status,
                ),
                message: 'Enrollment registered. Payment pending to confirm the seat.',
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
                    ? `Take the test here: ${test.test_url}`
                    : 'Test URL pending — ask the academic team to upload it.',
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
            if (!plans.length) return { plans: [], message: 'No insurance plans match the criteria.' };
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
                disclaimer: 'This quote is a preliminary estimate. The final premium is subject to underwriting review.',
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    /**
     * Una poliza solo se le muestra a SU dueño.
     *
     * Antes bastaba con escribir un numero de poliza en el chat para recibir el
     * nombre completo del titular, su prima y sus fechas de pago. Los numeros de
     * poliza son correlativos en casi toda aseguradora: cualquiera podia
     * enumerarlos desde WhatsApp y cosechar datos personales de terceros.
     *
     * El mensaje de rechazo es IDENTICO para "no existe" y para "no es tuya" a
     * proposito: distinguirlos convierte la herramienta en un oraculo que
     * confirma que numeros de poliza son validos.
     *
     * Consecuencia asumida: una poliza cargada a mano sin contacto vinculado no
     * se puede consultar por chat. Por eso la emision desde el panel EXIGE
     * elegir el contacto — vincularlo es el camino normal, no el excepcional.
     */
    private ownsPolicy(policy: any, contactId: string): boolean {
        return !!policy?.contact_id && policy.contact_id === contactId;
    }

    // ── Verificación de identidad en dos pasos (D8 / H-21) ─────

    /**
     * Devuelve un resultado-directiva si HACE FALTA verificar, o `null` si ya
     * está verificado y la tool puede seguir.
     *
     * Cuando no hay ningún canal fuera de banda (contacto sin correo, y la
     * conversación es por SMS) NO se inventa una verificación ni se bloquea sin
     * salida: se escala a un humano, que es la respuesta honesta.
     */
    private async requireVerifiedIdentity(
        tenantId: string,
        schemaName: string,
        contactId: string,
        conversationId: string | undefined,
        channelType?: string,
    ): Promise<any | null> {
        if (!conversationId) {
            return {
                error: 'identity_context_required',
                message: 'Esta gestión sensible requiere una conversación vinculada y una verificación de identidad válida. No reveles información ni ejecutes la acción.',
                shouldHandoff: false,
            };
        }
        if (await this.chatIdentity.isVerified(conversationId, contactId)) return null;

        const started = await this.chatIdentity.startVerification(
            tenantId, schemaName, contactId, conversationId, channelType || '',
        );

        if (started.status === 'already_verified') return null;
        if (started.status === 'pending') {
            return {
                needsVerification: true,
                message: 'Ya hay una verificación en curso. No envíes otro código; pedile al cliente que espere el mensaje y comparta el código recibido.',
            };
        }
        if (started.status === 'no_channel') {
            return {
                error: 'identity_unverifiable',
                message: 'No hay forma de verificar la identidad de este cliente por otro canal. NO reveles información ni ejecutes gestiones sensibles de seguros: ofrecé pasarlo con un asesor humano.',
                shouldHandoff: true,
            };
        }
        return {
            needsVerification: true,
            sentVia: started.via,
            sentTo: started.hint,
            message: `Antes de dar información o ejecutar gestiones sensibles de seguros hay que verificar identidad. Se envió un código de 6 dígitos ${started.via === 'email' ? 'al correo' : 'por SMS'} ${started.hint}. Pedile al cliente ese código y llamá a verify_identity_code. NO reveles datos ni radiques siniestros hasta que la verificación sea exitosa.`,
        };
    }

    private async requestIdentityCodeTool(
        tenantId: string,
        schemaName: string,
        contactId: string,
        conversationId: string | undefined,
        channelType?: string,
    ): Promise<any> {
        if (!conversationId) return { error: 'no_conversation' };
        const res = await this.chatIdentity.startVerification(tenantId, schemaName, contactId, conversationId, channelType || '');
        if (res.status === 'already_verified') return { alreadyVerified: true };
        if (res.status === 'pending') return { pending: true, message: 'Ya hay una verificación en curso. No envíes otro código.' };
        if (res.status === 'no_channel') {
            return {
                error: 'identity_unverifiable',
                message: 'No hay correo ni otro canal donde mandar el código. Ofrecé pasarlo con un asesor humano.',
                shouldHandoff: true,
            };
        }
        return { sent: true, via: res.via, sentTo: res.hint };
    }

    private async verifyIdentityCodeTool(conversationId: string | undefined, code?: string): Promise<any> {
        if (!conversationId) return { error: 'no_conversation' };
        if (!code) return { error: 'missing_code', message: 'Pedile al cliente el código de 6 dígitos.' };
        const res = await this.chatIdentity.verifyCode(conversationId, String(code));
        if (res.ok) return { verified: true, message: 'Identidad verificada. Ya podés consultar los datos que pidió.' };
        const messages: Record<string, string> = {
            expired: 'El código venció o no se pidió ninguno. Ofrecé enviar uno nuevo con request_identity_code.',
            wrong: 'El código no coincide. Pedíselo de nuevo; le quedan intentos.',
            too_many: 'Demasiados intentos fallidos. NO sigas intentando: pasá la conversación a un asesor humano.',
        };
        return {
            verified: false,
            reason: res.reason,
            message: messages[res.reason || 'wrong'],
            shouldHandoff: res.reason === 'too_many',
        };
    }

    private async checkPolicyStatusTool(schemaName: string, contactId: string, args: any): Promise<any> {
        try {
            const policy = await this.insuranceService.getPolicyByNumber(schemaName, args.policyNumber);
            if (!policy || !this.ownsPolicy(policy, contactId)) {
                return {
                    error: 'No policy with that number is linked to this customer. Do not reveal whether the number exists. Ask the customer to confirm the number, and offer to connect them with a human agent to verify their identity.',
                    shouldHandoff: false,
                };
            }
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

    private async fileInsuranceClaimTool(schemaName: string, contactId: string, args: any): Promise<any> {
        try {
            const policy = await this.insuranceService.getPolicyByNumber(schemaName, args.policyNumber);
            // Mismo gate que la consulta, y aqui pesa mas: radicar un siniestro
            // contra la poliza de otro es fraude, no una fuga de datos.
            if (!policy || !this.ownsPolicy(policy, contactId)) {
                return {
                    error: 'No policy with that number is linked to this customer. Do not reveal whether the number exists. Offer to connect them with a human agent to verify their identity.',
                    shouldHandoff: false,
                };
            }
            if (policy.status !== 'active') {
                return { error: `Policy is in "${policy.status}" status. Cannot file a claim.` };
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
                message: `Claim filed with number ${claim.claim_number}. A human agent will review it shortly.`,
                shouldHandoff: true,
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    // ── Tier 3 — home services ─────────────────────────────────

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
            return {
                requestId: request.id,
                status: request.status,
                urgency: request.urgency,
                message: request.urgency === 'emergencia'
                    ? 'Request registered as EMERGENCY. A technician will be assigned immediately.'
                    : 'Service request registered. We will contact you to confirm date and time.',
                shouldHandoff: request.urgency === 'emergencia',
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    /**
     * Las solicitudes DEL CLIENTE, sin pedirle un id que no tiene.
     *
     * `check_request_status` exige el UUID de la solicitud, y ese id sólo
     * existe dentro del turno en que se creó: el cliente nunca lo vio. Así que
     * la pregunta más frecuente del rubro después de pedir el servicio —"¿ya
     * viene el técnico?"— no tenía forma de responderse, y terminaba en un
     * humano o en un "no encuentro tu solicitud".
     */
    private async listMyServiceRequestsTool(schema: string, contactId: string, onlyOpen: boolean): Promise<any> {
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id, service_type, urgency, status, address,
                        assigned_technician_name, scheduled_at, created_at
                 FROM "${schema}".service_requests
                 WHERE contact_id = $1::uuid
                   ${onlyOpen ? `AND status NOT IN ('completed', 'cancelled')` : ''}
                 ORDER BY created_at DESC LIMIT 10`,
                contactId,
            );
            return {
                requests: rows.map(r => ({
                    requestId: r.id,
                    serviceType: r.service_type,
                    urgency: r.urgency,
                    status: r.status,
                    address: r.address,
                    technicianName: r.assigned_technician_name,
                    scheduledAt: r.scheduled_at,
                    createdAt: r.created_at,
                })),
            };
        } catch (e: any) {
            // Sin la colección vacía: devolver `[]` junto al error hacía que el
            // modelo leyera "no hay nada" de una consulta que falló.
            return { error: 'read_failed', status: 'error' as const, retryable: true, message: e.message };
        }
    }

    // ── Servicios profesionales — estado del caso ───────────────

    /**
     * "¿Cómo va mi caso?" para un despacho (abogados, contadores, arquitectos,
     * consultores).
     *
     * El caso de esta vertical no es una tabla propia: es la oportunidad del
     * embudo, cuyo vocabulario ya está traducido (`transactionNoun: 'caso'`,
     * etapas Consulta → Evaluación → Propuesta → En proceso → Completado). Lo
     * que faltaba era una forma de que el cliente lo consultara.
     *
     * Igual que en servicios a domicilio, NO se le pide un id: el UUID de la
     * oportunidad solo existe puertas adentro y el cliente nunca lo vio. Se
     * resuelve por contacto → leads → opportunities, que es la misma cadena que
     * usa el tablero.
     *
     * Devuelve el NOMBRE de la etapa configurada por el tenant, no el slug: el
     * cliente tiene que leer "En proceso", no "en_proceso". Y nunca devuelve el
     * valor estimado ni las notas internas — es información del despacho, no del
     * cliente, y por este canal no se distingue quién está del otro lado más
     * allá del número.
     */
    private async getCaseStatusTool(schema: string, contactId: string): Promise<any> {
        try {
            const rows: any[] = await this.prisma.executeInTenantSchema(
                schema,
                `SELECT o.id,
                        o.stage,
                        o.created_at,
                        o.updated_at,
                        o.won_at,
                        o.lost_at,
                        ps.name        AS stage_name,
                        ps.is_terminal AS stage_is_terminal
                   FROM opportunities o
                   JOIN leads l ON l.id = o.lead_id
                   LEFT JOIN pipeline_stages ps ON ps.slug = o.stage
                  WHERE l.contact_id = $1::uuid
                  ORDER BY o.updated_at DESC
                  LIMIT 5`,
                [contactId],
            );

            if (!rows?.length) {
                // No inventar: que el agente ofrezca escalarlo a la persona a
                // cargo, que es lo que la FAQ del rubro ya promete.
                return {
                    cases: [],
                    message: 'No hay casos registrados a nombre de este contacto. Ofrece tomar los datos y avisar al profesional a cargo.',
                };
            }

            return {
                cases: rows.map(r => ({
                    // Un identificador que el cliente PUEDA leer y repetir por
                    // teléfono. El UUID completo no sirve para eso.
                    reference: String(r.id).slice(0, 8).toUpperCase(),
                    stage: r.stage_name || r.stage,
                    isClosed: r.stage_is_terminal === true || !!r.won_at || !!r.lost_at,
                    openedAt: r.created_at,
                    lastUpdate: r.updated_at,
                })),
            };
        } catch (e: any) {
            this.logger.warn(`[Tool] get_case_status failed: ${e.message}`);
            return { cases: [], error: 'No se pudo consultar el estado del caso.' };
        }
    }

    private async checkServiceRequestStatusTool(schemaName: string, contactId: string, args: any): Promise<any> {
        try {
            const request = await this.homeServicesService.getRequestById(schemaName, args.requestId);
            // cancel_service_request ya cruzaba contra el contacto; consultar el
            // estado no lo hacia, y devuelve a que hora va un tecnico a que
            // domicilio. Mismo mensaje para "no existe" y "no es tuya".
            if (!request || request.contact_id !== contactId) {
                return { error: 'No service request with that id belongs to this customer.' };
            }
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
     *
     * La consulta caída devolvía `{ error: <mensaje del driver> }` y el
     * catálogo vacío devolvía una lista vacía con un texto en inglés que el
     * modelo podía repetirle al cliente. Son dos hechos distintos —"todavía no
     * cargaron los paquetes" y "no pude leerlos"— y el contrato de lectura
     * existe para que no se confundan.
     */
    private async listConfiguredServicesTool(schemaName: string): Promise<any> {
        try {
            const services = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, name, description, duration_minutes, price, currency, category
                 FROM services WHERE is_active = true
                 ORDER BY category, name`,
            );
            if (!services?.length) {
                return readEmpty({ services: [], count: 0 }, {
                    message: 'El negocio todavía no cargó sus paquetes.',
                });
            }
            return readOk({
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
            });
        } catch (e: any) {
            this.logger.warn(`[Tool] list services failed: ${e.message}`);
            return readFailed(TOOL_READ_ERROR_CODES.READ_FAILED, {
                message: 'No pude consultar los paquetes en este momento.',
            });
        }
    }

    /**
     * Guardería / hotel de mascotas: ¿hay lugar del check-in al check-out?
     *
     * Esta lectura contaba la ocupación en `appointments` mientras la reserva
     * real se escribe en `resource_rentals`, que es donde viven los locks, el
     * solapamiento por mascota y la capacidad por noche, y lo que muestra
     * `/admin/resource-rentals`. Dos contadores distintos sobre el mismo cupo
     * significaban que el cliente podía escuchar "sí hay lugar" y recibir un
     * rechazo en el mismo turno.
     *
     * Ahora delega en `ResourceRentalsService.checkAvailability`, que ejecuta
     * las MISMAS consultas que el writer. Si alguna vez divergen es porque
     * alguien cambió una de las dos en ese servicio, no aquí.
     */
    private async checkDaycareAvailabilityTool(schemaName: string, args: any): Promise<any> {
        if (!this.resourceRentals) {
            return readNotConfigured('tenant_db', {
                message: 'La reserva de guardería no está disponible en este momento.',
            });
        }
        const checkIn = args?.checkIn || args?.date;
        if (!checkIn) return { error: 'checkIn is required' };
        // Estadía de un día si no dan salida. El rango es medio abierto: la
        // noche en que se va no ocupa cupo.
        const checkOut = args?.checkOut && args.checkOut !== checkIn
            ? args.checkOut
            : this.nextDayIso(checkIn);
        if (!checkOut) return { error: 'Invalid date range: checkOut must be after checkIn.' };

        // El servicio de alojamiento se resuelve por categoría, que es lo que
        // siembra el bootstrap (guarderia/hotel). El id explícito gana.
        let serviceId = typeof args?.serviceId === 'string' ? args.serviceId : null;
        if (!serviceId) {
            const svcRows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id FROM services
                 WHERE is_active = true AND category IN ('guarderia', 'hotel')
                 ORDER BY COALESCE(max_concurrent, 1) DESC, name ASC
                 LIMIT 1`,
            ).catch(() => null);
            if (!svcRows) {
                return readFailed(TOOL_READ_ERROR_CODES.READ_FAILED, {
                    message: 'No pude consultar la disponibilidad de la guardería en este momento.',
                });
            }
            serviceId = svcRows[0]?.id ?? null;
        }
        if (!serviceId) {
            return readEmpty({ available: false }, {
                message: 'This business has no daycare/boarding service configured yet. Do NOT promise availability — offer to connect the customer with the team.',
            });
        }

        try {
            const result = await this.resourceRentals.checkAvailability(schemaName, {
                type: 'pet_boarding',
                serviceId,
                startDate: checkIn,
                endDate: checkOut,
            });
            return readOk({
                serviceId,
                checkIn: result.startDate,
                checkOut: result.endDate,
                nights: result.nights,
                capacity: result.capacity ?? null,
                available: result.available,
                fullNight: result.fullNight ?? null,
                reason: result.reason ?? null,
                // petSize se recibe y NO se usa para decidir: el modelo de
                // capacidad no distingue tamaños. Decirlo evita que el agente
                // invente una respuesta sobre el perro grande.
                petSizeConsidered: false,
                message: result.available
                    ? `Space available for all ${result.nights} night(s).`
                    : `No space for the full range (${result.reason || 'no_capacity'}). Offer other dates. If the customer asks about pet size or special needs, say the team confirms that directly — you cannot check it.`,
            });
        } catch (e: any) {
            const status = e?.status ?? e?.getStatus?.();
            if (status === 400 || status === 404) {
                return { error: 'invalid_boarding_request', message: 'Revisá las fechas y el servicio antes de consultar el cupo.' };
            }
            this.logger.warn(`[Tool] check_daycare_availability failed: ${e.message}`);
            return readFailed(TOOL_READ_ERROR_CODES.READ_FAILED, {
                message: 'No pude consultar la disponibilidad de la guardería en este momento.',
            });
        }
    }

    // ── Resource rentals ─────────────────────────────────────
    //
    // Alquiler de vehículos y guardería/hotel de mascotas comparten un único
    // registro (`resource_rentals`) con locks, solapamiento y capacidad por
    // noche. Estos handlers son la única puerta conversacional a ese registro:
    // antes el motor existía, la web lo mostraba y el agente sólo podía
    // derivar a un humano.

    private async checkVehicleRentalAvailability(schemaName: string, args: any): Promise<any> {
        if (!this.resourceRentals) {
            return readNotConfigured('tenant_db', {
                message: 'El alquiler de vehículos no está disponible en este momento.',
            });
        }
        try {
            const result = await this.resourceRentals.checkAvailability(schemaName, {
                type: 'vehicle_rental',
                resourceId: args?.vehicleId,
                startDate: args?.startDate,
                endDate: args?.endDate,
            });
            return readOk({
                vehicleId: args?.vehicleId,
                startDate: result.startDate,
                endDate: result.endDate,
                days: result.nights,
                available: result.available,
                reason: result.reason ?? null,
                conflictStart: result.conflictStart ?? null,
                conflictEnd: result.conflictEnd ?? null,
                message: result.available
                    ? `Vehicle is free for those ${result.nights} day(s).`
                    : 'Vehicle is not free for that range. Offer other dates or another vehicle — do NOT promise it.',
            });
        } catch (e: any) {
            return this.rentalReadFailure(e, 'check_vehicle_rental_availability');
        }
    }

    private async createVehicleRental(schemaName: string, contactId: string, args: any): Promise<any> {
        if (!this.resourceRentals) {
            return { error: 'rentals_unavailable', message: 'El alquiler de vehículos no está disponible.' };
        }
        if (!AIToolExecutorService.UUID_PATTERN.test(contactId || '')) {
            return { error: 'contact_required', message: 'Necesito identificar al cliente antes de reservar.' };
        }
        const driverName = String(args?.driverName || '').trim();
        if (!driverName) {
            return { error: 'driver_required', message: 'Falta el nombre de quien va a conducir.' };
        }
        try {
            const rental = await this.resourceRentals.create(schemaName, {
                type: 'vehicle_rental',
                resourceId: args?.vehicleId,
                contactId,
                customerName: driverName.slice(0, 255),
                customerPhone: args?.driverPhone ? String(args.driverPhone).slice(0, 50) : undefined,
                startDate: args?.startDate,
                endDate: args?.endDate,
                notes: args?.notes ? String(args.notes).slice(0, 1000) : undefined,
            });
            return {
                success: true,
                rental: this.projectRental(rental),
                humanRoute: `/admin/resource-rentals?type=vehicle_rental&rentalId=${rental?.id}`,
            };
        } catch (e: any) {
            return this.rentalWriteFailure(e, 'create_vehicle_rental');
        }
    }

    private async createPetBoarding(schemaName: string, contactId: string, args: any): Promise<any> {
        if (!this.resourceRentals) {
            return { error: 'rentals_unavailable', message: 'La reserva de guardería no está disponible.' };
        }
        if (!AIToolExecutorService.UUID_PATTERN.test(contactId || '')) {
            return { error: 'contact_required', message: 'Necesito identificar al tutor antes de reservar.' };
        }
        try {
            const rental = await this.resourceRentals.create(schemaName, {
                type: 'pet_boarding',
                resourceId: args?.petId,
                serviceId: args?.serviceId,
                contactId,
                startDate: args?.startDate,
                endDate: args?.endDate,
                notes: args?.notes ? String(args.notes).slice(0, 1000) : undefined,
            });
            return {
                success: true,
                boarding: this.projectRental(rental),
                humanRoute: `/admin/resource-rentals?type=pet_boarding&rentalId=${rental?.id}`,
            };
        } catch (e: any) {
            return this.rentalWriteFailure(e, 'create_pet_boarding');
        }
    }

    private async listMyResourceRentals(
        schemaName: string,
        contactId: string,
        type: 'vehicle_rental' | 'pet_boarding',
    ): Promise<any> {
        if (!this.resourceRentals) {
            return readNotConfigured('tenant_db');
        }
        if (!AIToolExecutorService.UUID_PATTERN.test(contactId || '')) {
            return readUnauthorized({ message: 'Necesito identificar al cliente para ver sus reservas.' });
        }
        try {
            const rows = await this.resourceRentals.list(schemaName, {
                type,
                contactId,
                activeOnly: true,
                limit: 10,
            });
            const key = type === 'vehicle_rental' ? 'rentals' : 'boardings';
            return readOk({ [key]: rows.map(row => this.projectRental(row)) });
        } catch (e: any) {
            return this.rentalReadFailure(e, `list_my_${type}`);
        }
    }

    private async getResourceRental(
        schemaName: string,
        contactId: string,
        rentalId: string,
        type: 'vehicle_rental' | 'pet_boarding',
    ): Promise<any> {
        if (!this.resourceRentals) {
            return readNotConfigured('tenant_db');
        }
        if (!AIToolExecutorService.UUID_PATTERN.test(contactId || '')) {
            return readUnauthorized({ message: 'Necesito identificar al cliente para ver esa reserva.' });
        }
        try {
            const rental = await this.resourceRentals.getById(schemaName, rentalId);
            // Ownership y tipo se verifican antes de devolver nada: una reserva
            // de otro cliente no debe entrar al contexto del modelo ni siquiera
            // para descartarla después.
            if (!rental
                || rental.rental_type !== type
                || String(rental.contact_id || '').toLowerCase() !== String(contactId).toLowerCase()) {
                return readEmpty({ rental: null }, {
                    message: 'No encontré esa reserva a nombre de este cliente.',
                });
            }
            return readOk({ rental: this.projectRental(rental) });
        } catch (e: any) {
            return this.rentalReadFailure(e, 'get_resource_rental');
        }
    }

    private async cancelResourceRental(
        schemaName: string,
        contactId: string,
        rentalId: string,
        type: 'vehicle_rental' | 'pet_boarding',
        reason?: string,
    ): Promise<any> {
        if (!this.resourceRentals) {
            return { error: 'rentals_unavailable' };
        }
        if (!AIToolExecutorService.UUID_PATTERN.test(contactId || '')) {
            return { error: 'contact_required', message: 'Necesito identificar al cliente antes de cancelar.' };
        }
        try {
            const existing = await this.resourceRentals.getById(schemaName, rentalId);
            if (!existing || existing.rental_type !== type) {
                return { error: 'rental_not_found', message: 'No encontré esa reserva.' };
            }
            const cancelled = await this.resourceRentals.cancelForContact(
                schemaName, rentalId, contactId, reason,
            );
            return {
                success: true,
                rental: this.projectRental(cancelled),
                humanRoute: `/admin/resource-rentals?type=${type}&rentalId=${rentalId}`,
            };
        } catch (e: any) {
            return this.rentalWriteFailure(e, 'cancel_resource_rental');
        }
    }

    /** Canonical shape the model sees for any rental, whatever its type. */
    private projectRental(row: any): any {
        if (!row) return null;
        const startDate = String(row.start_date instanceof Date
            ? row.start_date.toISOString().slice(0, 10)
            : row.start_date || '').slice(0, 10);
        const endDate = String(row.end_date instanceof Date
            ? row.end_date.toISOString().slice(0, 10)
            : row.end_date || '').slice(0, 10);
        return {
            id: row.id,
            type: row.rental_type,
            status: row.status,
            startDate,
            endDate,
            resourceId: row.resource_id,
            resourceName: row.resource_name || row.pet_name || null,
            serviceName: row.service_name || null,
            notes: row.notes || null,
        };
    }

    /**
     * A rejected rental is not the same as a broken one.
     *
     * Conflicts (vehicle taken, no capacity, pet already boarded) are real
     * answers the agent must relay so the customer can pick other dates; only
     * an unexpected failure becomes an opaque error.
     */
    private rentalWriteFailure(e: any, toolName: string): any {
        const status = e?.status ?? e?.getStatus?.();
        const response = e?.response;
        const detail = typeof response === 'object' && response ? response : {};
        if (status === 409) {
            return {
                error: 'rental_conflict',
                conflictStart: detail.conflictStart ?? null,
                conflictEnd: detail.conflictEnd ?? null,
                fullNight: detail.fullNight ?? null,
                capacity: detail.capacity ?? null,
                message: 'Ese rango ya no está disponible. Ofrecé otras fechas — no confirmes la reserva.',
            };
        }
        if (status === 403) {
            return { error: 'not_your_rental', message: 'Esa reserva es de otro cliente.' };
        }
        if (status === 404) {
            return { error: 'rental_resource_not_found', message: 'No encontré ese recurso.' };
        }
        if (status === 400) {
            return { error: 'invalid_rental_request', message: 'Faltan datos o las fechas no son válidas.' };
        }
        this.logger.warn(`[Tool] ${toolName} failed: ${e?.message}`);
        return { error: 'rental_failed', message: 'No pude registrar la reserva en este momento.' };
    }

    private rentalReadFailure(e: any, toolName: string): any {
        const status = e?.status ?? e?.getStatus?.();
        if (status === 400 || status === 404) {
            return readEmpty({ available: false }, { message: 'No encontré ese recurso con esos datos.' });
        }
        this.logger.warn(`[Tool] ${toolName} failed: ${e?.message}`);
        return readFailed(TOOL_READ_ERROR_CODES.READ_FAILED, {
            message: 'No pude consultar la disponibilidad en este momento.',
        });
    }

    /** `YYYY-MM-DD` + 1 día, o null si la fecha no es válida. */
    private nextDayIso(date: string): string | null {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null;
        const parsed = new Date(`${date}T00:00:00.000Z`);
        if (Number.isNaN(parsed.getTime())) return null;
        parsed.setUTCDate(parsed.getUTCDate() + 1);
        return parsed.toISOString().slice(0, 10);
    }

    /**
     * Fotografía: ¿está libre esa fecha?
     *
     * Contaba sólo `appointments` y nunca miraba `photo_sessions` — la tabla
     * donde escribe `request_photo_quote`. Los dos caminos de reserva del rubro
     * no se veían entre sí, así que el bot podía confirmar un sábado que ya
     * tenía una boda tomada. La propia regla del agente dice que el doble
     * booking es catastrófico, y el producto lo permitía.
     */
    private async checkDateAvailabilityTool(schemaName: string, args: any): Promise<any> {
        try {
            const date = args.date || args.checkIn;
            if (!date) return { error: 'date is required' };

            const blocked = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT 1 FROM blocked_dates WHERE blocked_date = $1::date AND user_id IS NULL LIMIT 1`,
                [date],
            ).catch(() => [] as any[]);
            if (blocked.length) {
                return { date, available: false, message: 'That date is blocked by the studio. Offer another one.' };
            }

            const [appts, sessions] = await Promise.all([
                this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `SELECT COUNT(*)::int AS cnt FROM appointments
                     WHERE start_at::date = $1::date AND status IN ('confirmed', 'pending')`,
                    [date],
                ).catch(() => [{ cnt: 0 }]),
                this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `SELECT COUNT(*)::int AS cnt FROM photo_sessions
                     WHERE scheduled_at::date = $1::date AND status IN ('scheduled', 'in_progress')`,
                    [date],
                ).catch(() => [{ cnt: 0 }]),
            ]);

            const taken = Number(appts[0]?.cnt || 0) + Number(sessions[0]?.cnt || 0);
            // Una sesión de fotos ocupa al fotógrafo el día entero: una sola
            // basta para bloquear la fecha. El umbral de 5 que había era una
            // constante sin relación con el negocio.
            const available = taken === 0;

            return {
                date,
                taken,
                available,
                message: available
                    ? 'Date is free.'
                    : `The studio already has ${taken} booking(s) that day. Do NOT confirm it — offer nearby dates.`,
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
    // ── Appointment management handlers ─────────────────────────────

    private async rescheduleAppointment(
        schema: string, contactId: string, appointmentId: string,
        newDate: string, newTime: string, reason?: string,
    ): Promise<any> {
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT id, contact_id, service_id, service_name, start_at, end_at, status, assigned_to,
                    google_event_id, outlook_event_id
             FROM "${schema}".appointments WHERE id = $1::uuid`,
            appointmentId,
        );
        if (!rows.length) return { error: 'Appointment not found' };
        if (rows[0].contact_id !== contactId) return { error: 'You can only reschedule your own appointments' };
        if (rows[0].status === 'cancelled') return { error: 'Cannot reschedule a cancelled appointment' };

        const apt = rows[0];
        const svcRows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT duration_minutes FROM "${schema}".services WHERE id = $1::uuid`,
            apt.service_id,
        );
        const duration = Math.max(1, Number(svcRows[0]?.duration_minutes) || 30);

        if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(newTime)) {
            return { error: 'newDate must use YYYY-MM-DD and newTime must use HH:MM (24-hour)' };
        }
        const startBase = new Date(`${newDate}T${newTime}:00Z`);
        if (Number.isNaN(startBase.getTime()) || startBase.toISOString().slice(0, 16) !== `${newDate}T${newTime}`) {
            return { error: 'The requested date or time is not a valid calendar value' };
        }

        const newStartAt = `${newDate}T${newTime}:00`;
        const endBase = new Date(startBase.getTime() + duration * 60_000);
        const newEndAt = endBase.toISOString().slice(0, 19);

        const noteAppend = reason
            ? `\n[Rescheduled: ${reason}]`
            : '\n[Rescheduled by customer]';

        // Double-booking guard for the new slot (excludes the appointment itself),
        // mirroring createAppointment.
        const assignedTo = apt.assigned_to || null;
        const slotLock = await this.acquireSlotLock(schema, assignedTo, newDate);
        if (!slotLock) {
            return {
                error: 'The booking slot is being updated by another request. Please check availability again and retry.',
                retryable: true,
            };
        }
        let changed = false;
        try {
            if (await this.findAppointmentConflict(schema, newStartAt, newEndAt, assignedTo, appointmentId, apt.service_id)) {
                this.logger.warn(`[Tool] Reschedule conflict prevented: ${newDate} ${newTime} (staff=${assignedTo || 'any'})`);
                return { error: 'That new time slot is already taken. Offer the customer another available time (call check_availability).' };
            }
            const updated: any[] = await this.prisma.transactionInTenantSchema(
                schema,
                async (query) => {
                    const result = await query<any[]>(
                        `UPDATE appointments
                         SET start_at = $1::timestamp, end_at = $2::timestamp,
                             notes = COALESCE(notes, '') || $3,
                             updated_at = NOW()
                         WHERE id = $4::uuid
                           AND contact_id = $5::uuid
                           AND status <> 'cancelled'
                           AND start_at = $6::timestamp
                           AND end_at = $7::timestamp
                           AND (start_at IS DISTINCT FROM $1::timestamp OR end_at IS DISTINCT FROM $2::timestamp)
                         RETURNING id`,
                        [newStartAt, newEndAt, noteAppend, appointmentId, contactId,
                            apt.start_at, apt.end_at],
                    );
                    if (result.length) {
                        await CalendarSyncOutboxService.enqueueWithTransaction(query, appointmentId, 'upsert');
                    }
                    return result;
                },
            );
            changed = updated.length > 0;

            if (!changed) {
                const current: any[] = await this.prisma.$queryRawUnsafe(
                    `SELECT id FROM "${schema}".appointments
                     WHERE id = $1::uuid
                       AND contact_id = $2::uuid
                       AND status <> 'cancelled'
                       AND start_at = $3::timestamp
                       AND end_at = $4::timestamp
                     LIMIT 1`,
                    appointmentId, contactId, newStartAt, newEndAt,
                );
                if (!current.length) {
                    return { error: 'Appointment changed concurrently. Reload it before retrying.' };
                }
            }
        } finally {
            await this.redis.releaseLockToken(slotLock.key, slotLock.token);
        }

        // An exact retry observes the already-applied state but must not append
        // another note, recreate the provider event or emit a duplicate event.
        if (!changed) {
            return {
                success: true,
                alreadyRescheduled: true,
                message: 'Appointment was already rescheduled to this time',
                appointment: {
                    id: appointmentId,
                    service: apt.service_name,
                    date: newDate,
                    time: newTime,
                },
            };
        }

        this.eventEmitter.emit('appointment.rescheduled', {
            schemaName: schema,
            appointmentId,
            oldStartAt: apt.start_at,
            newStartAt,
            newEndAt,
        });

        return {
            success: true,
            message: 'Appointment rescheduled successfully',
            calendarSynced: false,
            calendarSyncState: 'pending',
            appointment: {
                id: appointmentId,
                service: apt.service_name,
                date: newDate,
                time: newTime,
            },
        };
    }

    private async getAppointmentDetails(schema: string, contactId: string, appointmentId: string): Promise<any> {
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT id, contact_id, service_name, start_at, end_at, status,
                    customer_name, customer_email, customer_phone, notes, metadata
             FROM "${schema}".appointments WHERE id = $1::uuid`,
            appointmentId,
        );
        if (!rows.length) return { error: 'Appointment not found' };
        if (rows[0].contact_id !== contactId) return { error: 'You can only view your own appointments' };

        const apt = rows[0];
        const metadata = apt.metadata || {};
        return {
            id: apt.id,
            service: apt.service_name,
            date: new Date(apt.start_at).toISOString().split('T')[0],
            time: new Date(apt.start_at).toTimeString().slice(0, 5),
            endTime: new Date(apt.end_at).toTimeString().slice(0, 5),
            status: apt.status,
            customerName: apt.customer_name,
            customerEmail: apt.customer_email,
            customerPhone: apt.customer_phone,
            notes: apt.notes,
            meetingUrl: metadata.meetingUrl || null,
        };
    }

    // ── Vacation Rental management handlers ──────────────────────────

    private async cancelPropertyBooking(schema: string, contactId: string, bookingId: string, reason?: string): Promise<any> {
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id, contact_id, status FROM "${schema}".property_bookings WHERE id = $1::uuid`,
                bookingId,
            );
            if (!rows.length) return { error: 'Property booking not found' };
            if (rows[0].contact_id !== contactId) return { error: 'You can only cancel your own bookings' };
            if (rows[0].status === 'cancelled') return { error: 'This booking is already cancelled' };

            await this.propertiesService.cancelBooking(schema, bookingId);

            if (reason) {
                await this.prisma.$queryRawUnsafe(
                    `UPDATE "${schema}".property_bookings SET notes = COALESCE(notes, '') || $1 WHERE id = $2::uuid`,
                    `\n[Cancelled: ${reason}]`, bookingId,
                );
            }

            return { success: true, message: 'Property booking cancelled successfully' };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async listMyPropertyBookings(schema: string, contactId: string): Promise<any> {
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT pb.id, pb.check_in, pb.check_out, pb.status, pb.total_price, pb.currency,
                        pb.guest_name, pb.payment_status, p.name AS property_name
                 FROM "${schema}".property_bookings pb
                 LEFT JOIN "${schema}".properties p ON p.id = pb.property_id
                 WHERE pb.contact_id = $1::uuid AND pb.status != 'cancelled'
                 ORDER BY pb.check_in DESC LIMIT 10`,
                contactId,
            );
            return {
                bookings: rows.map(r => ({
                    id: r.id,
                    propertyName: r.property_name,
                    checkIn: r.check_in,
                    checkOut: r.check_out,
                    status: r.status,
                    totalPrice: Number(r.total_price || 0),
                    currency: r.currency,
                    guestName: r.guest_name,
                    paymentStatus: r.payment_status || 'pending',
                    // Without this the guest could be told about their stay but
                    // never charged for it: the payment tool needs a reference.
                    payableReference: this.payableReference(
                        'property',
                        r.id,
                        r.payment_status || 'pending',
                        r.status,
                    ),
                })),
            };
        } catch (e: any) {
            // Sin la colección vacía: devolver `[]` junto al error hacía que el
            // modelo leyera "no hay nada" de una consulta que falló.
            return { error: 'read_failed', status: 'error' as const, retryable: true, message: e.message };
        }
    }

    // ── Tours management handlers ────────────────────────────────────

    private async cancelTourBooking(schema: string, contactId: string, bookingId: string, reason?: string): Promise<any> {
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id, contact_id, status FROM "${schema}".tour_bookings WHERE id = $1::uuid`,
                bookingId,
            );
            if (!rows.length) return { error: 'Tour booking not found' };
            if (rows[0].contact_id !== contactId) return { error: 'You can only cancel your own bookings' };
            if (rows[0].status === 'cancelled') return { error: 'This booking is already cancelled' };

            await this.toursService.cancelBooking(schema, bookingId);

            if (reason) {
                await this.prisma.$queryRawUnsafe(
                    `UPDATE "${schema}".tour_bookings SET special_requests = COALESCE(special_requests, '') || $1, updated_at = NOW() WHERE id = $2::uuid`,
                    `\n[Cancelled: ${reason}]`, bookingId,
                );
            }

            return { success: true, message: 'Tour booking cancelled successfully. Seats have been released.' };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async listMyTourBookings(schema: string, contactId: string): Promise<any> {
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT tb.id, tb.departure_date, tb.departure_time, tb.party_size,
                        tb.total_price, tb.currency, tb.status, tb.payment_status, tb.guest_name,
                        tp.name AS package_name
                 FROM "${schema}".tour_bookings tb
                 LEFT JOIN "${schema}".tour_packages tp ON tp.id = tb.package_id
                 WHERE tb.contact_id = $1::uuid AND tb.status != 'cancelled'
                 ORDER BY tb.departure_date DESC LIMIT 10`,
                contactId,
            );
            return {
                bookings: rows.map(r => ({
                    id: r.id,
                    packageName: r.package_name,
                    departureDate: r.departure_date,
                    departureTime: r.departure_time,
                    partySize: r.party_size,
                    totalPrice: Number(r.total_price || 0),
                    currency: r.currency,
                    status: r.status,
                    paymentStatus: r.payment_status,
                    payableReference: this.payableReference('tour', r.id, r.payment_status, r.status),
                    guestName: r.guest_name,
                })),
            };
        } catch (e: any) {
            // Sin la colección vacía: devolver `[]` junto al error hacía que el
            // modelo leyera "no hay nada" de una consulta que falló.
            return { error: 'read_failed', status: 'error' as const, retryable: true, message: e.message };
        }
    }

    // ── Restaurants management handlers ──────────────────────────────

    private async cancelOrder(schema: string, contactId: string, orderId: string, reason?: string): Promise<any> {
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id, contact_id, status FROM "${schema}".food_orders WHERE id = $1::uuid`,
                orderId,
            );
            if (!rows.length) return { error: 'Order not found' };
            if (rows[0].contact_id !== contactId) return { error: 'You can only cancel your own orders' };

            const cancellableStatuses = ['received', 'confirmed', 'pending'];
            if (!cancellableStatuses.includes(rows[0].status)) {
                return { error: `Cannot cancel an order in "${rows[0].status}" status. Only received or confirmed orders can be cancelled.` };
            }

            await this.restaurantsService.updateOrderStatus(schema, orderId, 'cancelled', { reason });

            if (reason) {
                await this.prisma.$queryRawUnsafe(
                    `UPDATE "${schema}".food_orders SET notes = COALESCE(notes, '') || $1, updated_at = NOW() WHERE id = $2::uuid`,
                    `\n[Cancelled: ${reason}]`, orderId,
                );
            }

            return { success: true, message: 'Order cancelled successfully' };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async checkOrderStatus(schema: string, contactId: string, orderId: string): Promise<any> {
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id, contact_id, status, order_type, total, currency,
                        payment_status, customer_name, delivery_address, estimated_delivery_at,
                        created_at, updated_at
                 FROM "${schema}".food_orders WHERE id = $1::uuid`,
                orderId,
            );
            if (!rows.length) return { error: 'Order not found' };
            if (rows[0].contact_id !== contactId) return { error: 'You can only view your own orders' };

            const items: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT name_snapshot, quantity, unit_price FROM "${schema}".food_order_items WHERE order_id = $1::uuid`,
                orderId,
            );

            const o = rows[0];
            return {
                id: o.id,
                status: o.status,
                paymentStatus: o.payment_status,
                payableReference: this.payableReference('food', o.id, o.payment_status, o.status),
                orderType: o.order_type,
                total: Number(o.total || 0),
                currency: o.currency,
                items: items.map(i => ({ name: i.name_snapshot, quantity: i.quantity, unitPrice: Number(i.unit_price || 0) })),
                customerName: o.customer_name,
                deliveryAddress: o.delivery_address,
                estimatedDeliveryAt: o.estimated_delivery_at || null,
                createdAt: o.created_at,
                updatedAt: o.updated_at,
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async listMyOrders(schema: string, contactId: string, limit = 5): Promise<any> {
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT fo.id, fo.status, fo.payment_status, fo.order_type, fo.total, fo.currency, fo.created_at,
                        (SELECT COUNT(*)::int FROM "${schema}".food_order_items WHERE order_id = fo.id) AS item_count
                 FROM "${schema}".food_orders fo
                 WHERE fo.contact_id = $1::uuid
                 ORDER BY fo.created_at DESC LIMIT $2`,
                contactId, Math.min(limit || 5, 20),
            );
            return {
                orders: rows.map(o => ({
                    id: o.id,
                    status: o.status,
                    paymentStatus: o.payment_status,
                    payableReference: this.payableReference('food', o.id, o.payment_status, o.status),
                    orderType: o.order_type,
                    total: Number(o.total || 0),
                    currency: o.currency,
                    itemCount: Number(o.item_count || 0),
                    createdAt: o.created_at,
                })),
            };
        } catch (e: any) {
            // Sin la colección vacía: devolver `[]` junto al error hacía que el
            // modelo leyera "no hay nada" de una consulta que falló.
            return { error: 'read_failed', status: 'error' as const, retryable: true, message: e.message };
        }
    }

    // ── Gyms management handlers ─────────────────────────────────────

    private async cancelClassBooking(schemaName: string, contactId: string, bookingId: string): Promise<any> {
        try {
            // IDOR guard: verify the booking belongs to this contact before cancelling
            // (same ownership pattern as cancelAppointment / cancelEnrollment).
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id, contact_id FROM "${schemaName}".class_bookings WHERE id = $1::uuid`,
                bookingId,
            );
            if (!rows.length) return { error: 'Booking not found' };
            if (rows[0].contact_id !== contactId) return { error: 'You can only cancel your own bookings.' };

            await this.gymsService.cancelBooking(schemaName, bookingId);
            return { success: true, message: 'Class booking cancelled. Credits have been restored.' };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    // ── Education management handlers ────────────────────────────────

    private async cancelEnrollment(schema: string, contactId: string, enrollmentId: string, reason?: string): Promise<any> {
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id, contact_id, status, cohort_id, notes FROM "${schema}".enrollments WHERE id = $1::uuid`,
                enrollmentId,
            );
            if (!rows.length) return { error: 'Enrollment not found' };
            if (rows[0].contact_id !== contactId) return { error: 'You can only cancel your own enrollments' };

            const cancellableStatuses = ['enrolled', 'active'];
            if (!cancellableStatuses.includes(rows[0].status)) {
                return { error: `Cannot cancel an enrollment in "${rows[0].status}" status.` };
            }

            // 'dropped', no 'cancelled': el vocabulario de la tabla es
            // enrolled|active|completed|dropped|refunded. 'cancelled' se escribia
            // igual (status esta mapeado) pero quedaba fuera de la paleta del
            // panel y como balde desconocido en las analiticas por vertical.
            //
            // Y el motivo va a `notes`: updateEnrollment mapea seis campos y
            // cancellationReason no es uno de ellos — se descartaba en silencio,
            // asi que la razon que daba el alumno se perdia siempre. No hay
            // columna cancellation_reason en la tabla; notes es su lugar.
            await this.educationService.updateEnrollment(schema, enrollmentId, {
                status: 'dropped',
                // Se ANEXA: updateEnrollment pisa la columna, y las notas del
                // profesor sobre el alumno no pueden desaparecer porque este
                // cancele.
                notes: `${rows[0].notes ? `${rows[0].notes}\n` : ''}[Cancelled by student]${reason ? ` ${reason}` : ''}`,
            });

            // Devolver el asiento: enrollStudent decrementa available_seats y marca
            // 'full' al llegar a 0, pero la cancelación nunca lo restauraba — el
            // mensaje decía "the seat has been released" y el cupo se perdía para
            // siempre (cohortes fantasma llenas). Espejo exacto del decremento,
            // incluida la vuelta de 'full' a 'open'. El guard de status de arriba
            // impide restaurar dos veces (una cancelada no es cancelable de nuevo).
            if (rows[0].cohort_id) {
                await this.prisma.$queryRawUnsafe(
                    `UPDATE "${schema}".course_cohorts
                     SET available_seats = available_seats + 1,
                         status = CASE WHEN status = 'full' THEN 'open' ELSE status END
                     WHERE id = $1::uuid`,
                    rows[0].cohort_id,
                );
            }

            return { success: true, message: 'Enrollment cancelled successfully. The seat has been released.' };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    private async listMyEnrollments(schema: string, contactId: string): Promise<any> {
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT e.id, e.status, e.payment_status, e.created_at,
                        c.name AS course_name, c.subject, c.level, c.modality,
                        co.starts_at, co.schedule
                 FROM "${schema}".enrollments e
                 LEFT JOIN "${schema}".course_cohorts co ON co.id = e.cohort_id
                 LEFT JOIN "${schema}".courses c ON c.id = co.course_id
                 WHERE e.contact_id = $1::uuid AND e.status NOT IN ('dropped', 'refunded')
                 ORDER BY e.created_at DESC LIMIT 10`,
                contactId,
            );
            return {
                enrollments: rows.map(r => ({
                    id: r.id,
                    courseName: r.course_name,
                    subject: r.subject,
                    level: r.level,
                    modality: r.modality,
                    startsAt: r.starts_at,
                    schedule: r.schedule,
                    status: r.status,
                    paymentStatus: r.payment_status,
                    payableReference: this.payableReference('enrollment', r.id, r.payment_status, r.status),
                })),
            };
        } catch (e: any) {
            // Sin la colección vacía: devolver `[]` junto al error hacía que el
            // modelo leyera "no hay nada" de una consulta que falló.
            return { error: 'read_failed', status: 'error' as const, retryable: true, message: e.message };
        }
    }

    // ── Insurance management handlers ────────────────────────────────

    private async listMyClaimsTool(schema: string, contactId: string, policyNumber?: string): Promise<any> {
        try {
            let sql = `SELECT c.id, c.claim_number, c.status, c.incident_type, c.incident_at,
                               c.claimed_amount, c.description, c.created_at,
                               p.policy_number
                        FROM "${schema}".insurance_claims c
                        JOIN "${schema}".insurance_policies p ON p.id = c.policy_id
                        WHERE p.contact_id = $1::uuid`;
            const params: any[] = [contactId];
            if (policyNumber) {
                sql += ` AND p.policy_number = $2`;
                params.push(policyNumber);
            }
            sql += ` ORDER BY c.created_at DESC LIMIT 10`;

            const rows: any[] = await this.prisma.$queryRawUnsafe(sql, ...params);
            return {
                claims: rows.map(r => ({
                    id: r.id,
                    claimNumber: r.claim_number,
                    policyNumber: r.policy_number,
                    status: r.status,
                    incidentType: r.incident_type,
                    incidentAt: r.incident_at,
                    claimedAmount: r.claimed_amount ? Number(r.claimed_amount) : null,
                    description: r.description,
                    createdAt: r.created_at,
                })),
            };
        } catch (e: any) {
            // Sin la colección vacía: devolver `[]` junto al error hacía que el
            // modelo leyera "no hay nada" de una consulta que falló.
            return { error: 'read_failed', status: 'error' as const, retryable: true, message: e.message };
        }
    }

    private async cancelQuoteTool(schema: string, contactId: string, quoteId: string): Promise<any> {
        try {
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id, contact_id, status FROM "${schema}".insurance_quotes WHERE id = $1::uuid`,
                quoteId,
            );
            if (!rows.length) return { error: 'Quote not found' };
            if (rows[0].contact_id !== contactId) return { error: 'You can only cancel your own quotes' };

            // Esta herramienta nunca funciono: pedia status 'pending' y createQuote
            // siempre escribe 'sent', asi que el 100% de las cancelaciones moria
            // en este if. Y si alguna hubiera pasado, el UPDATE tampoco habria
            // entrado: escribia 'cancelled', un valor que updateQuoteStatus
            // rechaza y que no existe en el vocabulario de la tabla
            // (draft | sent | accepted | rejected | expired).
            //
            // Se alinea al vocabulario real en vez de inventar un sexto estado:
            // un cliente que desiste es exactamente 'rejected', y ese valor si lo
            // entienden el panel y las analiticas por vertical (que agrupan por
            // status y habrian mostrado un balde desconocido).
            const cancellable = ['draft', 'sent'];
            if (!cancellable.includes(rows[0].status)) {
                // Una cotizacion 'accepted' ya se volvio poliza: eso se cancela
                // hablando con un humano, no borrando la cotizacion.
                return { error: `Cannot cancel a quote in "${rows[0].status}" status. Only quotes that are still open can be withdrawn.` };
            }

            await this.insuranceService.updateQuoteStatus(schema, quoteId, 'rejected');
            return { success: true, message: 'Quote withdrawn successfully' };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    // ── Home Services management handlers ────────────────────────────

    private async cancelServiceRequest(schema: string, contactId: string, requestId: string, reason?: string): Promise<any> {
        try {
            const request = await this.homeServicesService.getRequestById(schema, requestId);
            if (!request) return { error: 'Service request not found' };
            if (request.contact_id !== contactId) return { error: 'You can only cancel your own service requests' };

            const cancellableStatuses = ['pending', 'scheduled'];
            if (!cancellableStatuses.includes(request.status)) {
                return { error: `Cannot cancel a request in "${request.status}" status. Only pending or scheduled requests can be cancelled.` };
            }

            await this.homeServicesService.updateRequest(schema, requestId, {
                status: 'cancelled',
                notes: (request.notes || '') + (reason ? `\n[Cancelled: ${reason}]` : '\n[Cancelled by customer]'),
            });

            return { success: true, message: 'Service request cancelled successfully' };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    // ── Pets management handlers ─────────────────────────────────────

    private async updatePetTool(schema: string, contactId: string, args: any): Promise<any> {
        try {
            const pet = await this.petsService.getById(schema, args.petId);
            if (!pet) return { error: 'Pet not found' };
            if (pet.contact_id !== contactId) return { error: 'You can only update your own pets' };

            // Claves en camelCase: PetsService.update mapea camelCase→columna y
            // descarta lo que no reconoce. Con snake_case acá, weight_kg /
            // chronic_conditions / is_neutered se perdían EN SILENCIO mientras el
            // tool respondía "updated successfully" — y el peso es dato
            // dosis-crítico en veterinaria.
            const updateData: any = {};
            if (args.name !== undefined) updateData.name = args.name;
            if (args.weightKg !== undefined) updateData.weightKg = args.weightKg;
            if (args.allergies !== undefined) updateData.allergies = args.allergies;
            if (args.chronicConditions !== undefined) updateData.chronicConditions = args.chronicConditions;
            if (args.isNeutered !== undefined) updateData.isNeutered = args.isNeutered;
            if (args.color !== undefined) updateData.color = args.color;

            if (Object.keys(updateData).length === 0) {
                return { error: 'No fields provided to update' };
            }

            const updated = await this.petsService.update(schema, args.petId, updateData);
            return {
                success: true,
                message: `${updated.name || pet.name} updated successfully`,
                pet: {
                    id: updated.id,
                    name: updated.name,
                    species: updated.species,
                    breed: updated.breed,
                    weightKg: updated.weight_kg,
                },
            };
        } catch (e: any) {
            return { error: e.message };
        }
    }

    // ── Photography management handlers ──────────────────────────────

    private async cancelPhotoSession(schema: string, contactId: string, sessionId: string, reason?: string): Promise<any> {
        try {
            return this.prisma.transactionInTenantSchema(schema, async (query) => {
                const rows = await query<any[]>(
                    `SELECT id, contact_id, status, package_name
                       FROM photo_sessions
                      WHERE id = $1::uuid
                      FOR UPDATE`,
                    [sessionId],
                );
                if (!rows.length) return { error: 'Photo session not found' };
                if (rows[0].contact_id !== contactId) {
                    return { error: 'You can only cancel your own sessions' };
                }
                if (!['requested', 'scheduled'].includes(rows[0].status)) {
                    return { error: `Cannot cancel a session in "${rows[0].status}" status.` };
                }

                const updated = await query<any[]>(
                    `UPDATE photo_sessions
                        SET status = 'cancelled',
                            notes = COALESCE(notes, '') || $1,
                            updated_at = NOW()
                      WHERE id = $2::uuid
                        AND contact_id = $3::uuid
                        AND status IN ('requested', 'scheduled')
                      RETURNING id`,
                    [
                        reason ? `\n[Cancelled: ${reason}]` : '\n[Cancelled by customer]',
                        sessionId,
                        contactId,
                    ],
                );
                if (!updated.length) {
                    return { error: 'Photo session changed before it could be cancelled' };
                }
                return { success: true, message: 'Photo session cancelled successfully' };
            });
        } catch (e: any) {
            return { error: e.message };
        }
    }

    // ── Tier 3 — pet services & photography (read-only catalog) ─────

    private async requestPhotoQuoteTool(
        schemaName: string,
        contactId: string,
        conversationId: string | undefined,
        args: any,
    ): Promise<any> {
        try {
            if (!args?.date || !args?.customerName) {
                return {
                    error: 'invalid_photo_session_request',
                    received: false,
                    message: 'A date and customer name are required before registering the photography request.',
                };
            }

            const session = await this.photographyService.create(schemaName, {
                contactId,
                conversationId,
                sessionType: args.sessionType || 'other',
                packageName: args.packageName || null,
                clientName: args.customerName || null,
                clientPhone: args.customerPhone || null,
                scheduledAt: args.date || null,
                location: args.location || null,
                notes: args.specialRequests || null,
                status: 'requested',
            });
            const sessionId = session?.id;
            if (!sessionId) {
                this.logger.warn('Photo session insert returned no id');
                return {
                    error: 'photo_session_not_created',
                    received: false,
                    message: 'The photography request could not be registered. Do not promise follow-up; offer to connect the customer with the team.',
                };
            }
            return {
                received: true,
                sessionId,
                sessionType: args.sessionType || 'other',
                date: args.date,
                package: args.packageName,
                message: 'Session registered — the team will send a personalized proposal within the next few hours.',
            };
        } catch (e: any) {
            this.logger.warn(`Photo session insert failed: ${e.message}`);
            return {
                error: 'photo_session_not_created',
                received: false,
                message: 'The photography request could not be registered. Do not promise follow-up; offer to connect the customer with the team.',
            };
        }
    }
}
