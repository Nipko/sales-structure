import { Module } from '@nestjs/common';
import { ResourceRentalsController } from './resource-rentals.controller';
import { ResourceRentalsService } from './resource-rentals.service';

import { EmailTemplatesModule } from '../email-templates/email-templates.module';

@Module({
    // The rental and boarding receipts that
    // `tools.vehicleRentals` / `tools.petBoarding` `.emailConfirmations` govern.
    imports: [EmailTemplatesModule],
    controllers: [ResourceRentalsController],
    providers: [ResourceRentalsService],
    exports: [ResourceRentalsService],
})
export class ResourceRentalsModule {}
