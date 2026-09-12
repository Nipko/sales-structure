import { Module } from '@nestjs/common';
import { EducationService } from './education.service';
import { EducationController } from './education.controller';

import { EmailTemplatesModule } from '../email-templates/email-templates.module';

@Module({
    // The enrolment receipt `tools.education.emailConfirmations` governs.
    imports: [EmailTemplatesModule],
    controllers: [EducationController],
    providers: [EducationService],
    exports: [EducationService],
})
export class EducationModule {}
