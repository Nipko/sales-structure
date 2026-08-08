import { Module } from '@nestjs/common';
import { VerticalsService } from './verticals.service';
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
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { EmailModule } from '../email/email.module';

@Module({
    imports: [PrismaModule, RedisModule, EmailModule],
    controllers: [VerticalsController, StaffSchedulingController, VehicleInventoryController],
    providers: [
        VerticalsService,
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
        StaffSchedulingService,
        StaffOperationsModelService,
        VehicleInventoryService,
        OperatingCurrencyService,
        TemporalCapacityContractService,
        VerticalMigrationService,
    ],
})
export class VerticalsModule {}
