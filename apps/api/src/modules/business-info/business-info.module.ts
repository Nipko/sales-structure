import { forwardRef, Module } from '@nestjs/common';
import { BusinessInfoService } from './business-info.service';
import { BusinessInfoController } from './business-info.controller';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
    imports: [forwardRef(() => TenantsModule)],
    controllers: [BusinessInfoController],
    providers: [BusinessInfoService],
    exports: [BusinessInfoService],
})
export class BusinessInfoModule {}
