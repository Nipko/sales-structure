import { Module } from '@nestjs/common';
import { InsuranceService } from './insurance.service';
import { InsuranceController } from './insurance.controller';

import { EmailTemplatesModule } from '../email-templates/email-templates.module';

@Module({
    // The quote receipt `tools.insurance.emailConfirmations` governs.
    imports: [EmailTemplatesModule],
    controllers: [InsuranceController],
    providers: [InsuranceService],
    exports: [InsuranceService],
})
export class InsuranceModule {}
