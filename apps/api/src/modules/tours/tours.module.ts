import { Module } from '@nestjs/common';
import { ToursService } from './tours.service';
import { ToursController } from './tours.controller';
import { EmailTemplatesModule } from '../email-templates/email-templates.module';

@Module({
    imports: [EmailTemplatesModule],
    controllers: [ToursController],
    providers: [ToursService],
    exports: [ToursService],
})
export class ToursModule {}
