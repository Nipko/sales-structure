import { Module } from '@nestjs/common';
import { RestaurantsService } from './restaurants.service';
import { RestaurantsController } from './restaurants.controller';
import { EmailTemplatesModule } from '../email-templates/email-templates.module';

@Module({
    // The food-order receipt `tools.restaurants.emailConfirmations` governs.
    imports: [EmailTemplatesModule],
    controllers: [RestaurantsController],
    providers: [RestaurantsService],
    exports: [RestaurantsService],
})
export class RestaurantsModule {}
