import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { PlatformCommunicationsController } from './platform-communications.controller';
import { PlatformCommunicationsService } from './platform-communications.service';
import { PlatformCommunicationsProcessor } from './platform-communications.processor';

@Module({
    imports: [PrismaModule, EmailModule],
    controllers: [PlatformCommunicationsController],
    providers: [PlatformCommunicationsService, PlatformCommunicationsProcessor],
})
export class PlatformCommunicationsModule {}
