import { Module } from '@nestjs/common';
import { GymsService } from './gyms.service';
import { GymsController } from './gyms.controller';

import { EmailTemplatesModule } from '../email-templates/email-templates.module';

@Module({
    // The class confirmation `tools.gyms.emailConfirmations` governs.
    imports: [EmailTemplatesModule],
    controllers: [GymsController],
    providers: [GymsService],
    exports: [GymsService],
})
export class GymsModule {}
