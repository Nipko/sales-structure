import { Module } from '@nestjs/common';
import { PoliciesService } from './policies.service';
import { PoliciesController } from './policies.controller';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
    imports: [TenantsModule],
    controllers: [PoliciesController],
    providers: [PoliciesService],
    exports: [PoliciesService],
})
export class PoliciesModule {}
