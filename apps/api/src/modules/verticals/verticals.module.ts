import { Module, forwardRef } from '@nestjs/common';
import { VerticalsService } from './verticals.service';
import { VerticalReadinessService } from './vertical-readiness.service';
import { VerticalsController } from './verticals.controller';
import { StaffSchedulingService } from './staff-scheduling.service';
import { StaffSchedulingController } from './staff-scheduling.controller';
import { VehicleInventoryService } from './vehicle-inventory.service';
import { VehicleInventoryController } from './vehicle-inventory.controller';
import { ServiceRequestListener } from './service-request.listener';
import { OperatingCurrencyService } from './operating-currency.service';
import { TemporalCapacityContractService } from './temporal-capacity-contract.service';
import { StaffOperationsModelService } from './staff-operations-model.service';
import { VerticalMigrationService } from './vertical-migration.service';
import { TenantsModule } from '../tenants/tenants.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { EmailTemplatesModule } from '../email-templates/email-templates.module';
import { VerticalAuditController } from './vertical-audit.controller';
import { VerticalTaxonomyInventoryService } from './vertical-taxonomy-inventory.service';
import { VerticalIntegrationsModule } from '../vertical-integrations/vertical-integrations.module';
import { AppointmentCommandsModule } from '../appointments/appointment-commands.module';
import { AIModule } from '../ai/ai.module';
import { OtroRecipeService } from './otro-recipe.service';

@Module({
    // TenantsModule aporta el resolutor regional: el perfil efectivo tiene que
    // decir en qué mercado opera el tenant, no solo qué vertical eligió.
    imports: [
        PrismaModule,
        RedisModule,
        // La confirmación de visita al cliente que gobierna
        // `tools.homeServices.emailConfirmations` se renderiza desde la
        // plantilla `homeservice_booking_confirmation` del propio tenant.
        EmailTemplatesModule,
        VerticalIntegrationsModule,
        forwardRef(() => TenantsModule),
        AppointmentCommandsModule,
        // D9: la receta de un negocio que no encaja en las 18 industrias la
        // escribe el modelo. AIModule no es global y solo importa SettingsModule,
        // asi que no hay ciclo que envolver en forwardRef.
        AIModule,
    ],
    controllers: [
        VerticalsController,
        VerticalAuditController,
        StaffSchedulingController,
        VehicleInventoryController,
    ],
    providers: [
        VerticalsService,
        VerticalReadinessService,
        StaffSchedulingService,
        StaffOperationsModelService,
        VehicleInventoryService,
        OperatingCurrencyService,
        TemporalCapacityContractService,
        VerticalMigrationService,
        VerticalTaxonomyInventoryService,
        OtroRecipeService,
        ServiceRequestListener,
    ],
    exports: [
        VerticalsService,
        VerticalReadinessService,
        StaffSchedulingService,
        StaffOperationsModelService,
        VehicleInventoryService,
        OperatingCurrencyService,
        TemporalCapacityContractService,
        VerticalMigrationService,
        VerticalTaxonomyInventoryService,
        OtroRecipeService,
    ],
})
export class VerticalsModule {}
