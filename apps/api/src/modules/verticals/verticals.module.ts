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
import { EmailModule } from '../email/email.module';

@Module({
    // TenantsModule aporta el resolutor regional: el perfil efectivo tiene que
    // decir en qué mercado opera el tenant, no solo qué vertical eligió.
    imports: [PrismaModule, RedisModule, EmailModule, forwardRef(() => TenantsModule)],
    controllers: [VerticalsController, StaffSchedulingController, VehicleInventoryController],
    providers: [
        VerticalsService,
        VerticalReadinessService,
        StaffSchedulingService,
        StaffOperationsModelService,
        VehicleInventoryService,
        OperatingCurrencyService,
        TemporalCapacityContractService,
        VerticalMigrationService,
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
    ],
})
export class VerticalsModule {}
