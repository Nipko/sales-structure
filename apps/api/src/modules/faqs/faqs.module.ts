import { Module } from '@nestjs/common';
import { FaqsService } from './faqs.service';
import { FaqsController } from './faqs.controller';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
    imports: [TenantsModule],
    controllers: [FaqsController],
    providers: [FaqsService],
    exports: [FaqsService],
})
export class FaqsModule {}
