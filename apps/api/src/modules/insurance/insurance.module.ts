import { Module } from '@nestjs/common';
import { InsuranceService } from './insurance.service';
import { InsuranceController } from './insurance.controller';

@Module({
    controllers: [InsuranceController],
    providers: [InsuranceService],
    exports: [InsuranceService],
})
export class InsuranceModule {}
