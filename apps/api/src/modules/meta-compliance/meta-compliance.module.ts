import { Module } from '@nestjs/common';
import { MetaComplianceController } from './meta-compliance.controller';
import { MetaComplianceService } from './meta-compliance.service';
import { RedisModule } from '../redis/redis.module';
import { EmailModule } from '../email/email.module';

@Module({
    imports: [RedisModule, EmailModule],
    controllers: [MetaComplianceController],
    providers: [MetaComplianceService],
    exports: [MetaComplianceService],
})
export class MetaComplianceModule {}
