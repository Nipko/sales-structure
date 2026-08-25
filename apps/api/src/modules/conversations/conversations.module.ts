import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { ResponseValidatorService } from './response-validator.service';
import { CustomerMemoryService } from './customer-memory.service';
import { BookingEngineService } from './booking-engine.service';
import { ProcedureEngineService } from './procedure-engine.service';
import { PromptAssemblerService } from './prompt-assembler.service';
import { LanguageDetectorService } from './language-detector.service';
import { AgentTestService } from './agent-test.service';
import { AgentTestController } from './agent-test.controller';
import { IntentInterpreterService } from './intent-interpreter.service';
import { PreChatService } from './pre-chat.service';
import { PersonaModule } from '../persona/persona.module';
import { AIModule } from '../ai/ai.module';
import { ChannelsModule } from '../channels/channels.module';
import { ConversationsGateway } from './conversations.gateway';
import { HandoffModule } from '../handoff/handoff.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { CrmModule } from '../crm/crm.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { AutomationModule } from '../automation/automation.module';
import { IdentityModule } from '../identity/identity.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { BusinessInfoModule } from '../business-info/business-info.module';
import { FaqsModule } from '../faqs/faqs.module';
import { PoliciesModule } from '../policies/policies.module';
import { TenantsModule } from '../tenants/tenants.module';
import { VacationRentalModule } from '../vacation-rental/vacation-rental.module';
import { ToursModule } from '../tours/tours.module';
import { TreatmentPlansModule } from '../treatment-plans/treatment-plans.module';
import { ListingsModule } from '../listings/listings.module';
import { PetsModule } from '../pets/pets.module';
import { RestaurantsModule } from '../restaurants/restaurants.module';
import { GymsModule } from '../gyms/gyms.module';
import { EducationModule } from '../education/education.module';
import { InsuranceModule } from '../insurance/insurance.module';
import { HomeServicesModule } from '../home-services/home-services.module';
import { PhotographyModule } from '../photography/photography.module';
import { OrdersModule } from '../orders/orders.module';
import { ResourceRentalsModule } from '../resource-rentals/resource-rentals.module';
import { RepairOrdersModule } from '../repair-orders/repair-orders.module';
import { VerticalsModule } from '../verticals/verticals.module';
import { MediaProcessingModule } from '../media-processing/media-processing.module';
import { EcommerceModule } from '../ecommerce/ecommerce.module';
import { VerticalIntegrationsModule } from '../vertical-integrations/vertical-integrations.module';
import { McpModule } from '../mcp/mcp.module';
import { AttributionModule } from '../attribution/attribution.module';
import { EmailModule } from '../email/email.module';
import { SmsCreditsModule } from '../sms-credits/sms-credits.module';
import { ChatIdentityService } from './chat-identity.service';
import { AgentTestRateLimitGuard } from './agent-test-rate-limit.guard';
import { AgentTestRequestGuard } from './agent-test-request.guard';
import { ActiveOperationsContextService } from './active-operations-context.service';
import { ToolRetrievalService } from './tool-retrieval.service';
import { EmotionService } from './emotion.service';
import { ToolExecutionControlService } from './tool-execution-control.service';
import { EffectiveCapabilityService } from './effective-capability.service';
import { PAYMENT_OPERATION_PROVIDER, PaymentOperationService } from './payment-operation.service';
import { ToolApprovalController } from './tool-approval.controller';
import { ToolApprovalWorkflowService } from './tool-approval-workflow.service';
import { TenantPaymentsModule } from '../tenant-payments/tenant-payments.module';
import { TenantMercadoPagoOperationProvider } from '../tenant-payments/tenant-mercadopago-operation.provider';
import { ExpiredHoldSweeperService } from './expired-hold-sweeper.service';
import { VerticalTurnContextService } from './vertical-turn-context.service';
import { TurnCapabilityComposerService } from './turn-capability-composer.service';

@Module({
    imports: [
        PersonaModule,
        AIModule,
        forwardRef(() => ChannelsModule),
        HandoffModule,
        KnowledgeModule,
        CrmModule,
        PipelineModule,
        forwardRef(() => AutomationModule),
        IdentityModule,
        AnalyticsModule,
        forwardRef(() => AppointmentsModule),
        BusinessInfoModule,
        FaqsModule,
        PoliciesModule,
        TenantsModule,
        VacationRentalModule,
        ToursModule,
        TreatmentPlansModule,
        ListingsModule,
        PetsModule,
        RestaurantsModule,
        GymsModule,
        EducationModule,
        InsuranceModule,
        HomeServicesModule,
        PhotographyModule,
        OrdersModule,
        ResourceRentalsModule,
        RepairOrdersModule,
        VerticalsModule,
        EcommerceModule,
        VerticalIntegrationsModule,
        AttributionModule,
        forwardRef(() => McpModule),
        forwardRef(() => MediaProcessingModule),
        EmailModule,
        SmsCreditsModule,
        TenantPaymentsModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: (config: ConfigService) => ({
                secret: config.get<string>('auth.jwtSecret'),
            }),
            inject: [ConfigService],
        }),
    ],
    providers: [
        ExpiredHoldSweeperService,
        ConversationsService,
        ConversationsGateway,
        AIToolExecutorService,
        ToolExecutionControlService,
        EffectiveCapabilityService,
        VerticalTurnContextService,
        TurnCapabilityComposerService,
        ToolApprovalWorkflowService,
        PaymentOperationService,
        {
            provide: PAYMENT_OPERATION_PROVIDER,
            useExisting: TenantMercadoPagoOperationProvider,
        },
        ResponseValidatorService,
        CustomerMemoryService,
        BookingEngineService,
        ProcedureEngineService,
        IntentInterpreterService,
        PromptAssemblerService,
        LanguageDetectorService,
        ActiveOperationsContextService,
        ToolRetrievalService,
        EmotionService,
        AgentTestService,
        AgentTestRateLimitGuard,
        AgentTestRequestGuard,
        PreChatService,
        ChatIdentityService,
    ],
    controllers: [ConversationsController, AgentTestController, ToolApprovalController],
    exports: [ConversationsService, ConversationsGateway, PromptAssemblerService, LanguageDetectorService, ActiveOperationsContextService, AgentTestService, AIToolExecutorService, ToolApprovalWorkflowService, EffectiveCapabilityService, VerticalTurnContextService, TurnCapabilityComposerService],
})
export class ConversationsModule {}
