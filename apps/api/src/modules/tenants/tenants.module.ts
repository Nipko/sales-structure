import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { PlatformStatusController } from './platform-status.controller';
import { AIModule } from '../ai/ai.module';
import { PersonaModule } from '../persona/persona.module';
import { BusinessInfoModule } from '../business-info/business-info.module';
import { VerticalsModule } from '../verticals/verticals.module';
import { InvitationsModule } from '../invitations/invitations.module';

@Module({
    imports: [
        BullModule.registerQueue(
            { name: 'outbound-messages' },
            { name: 'broadcast-messages' },
            { name: 'automation-jobs' },
            { name: 'nurturing' },
            { name: 'conversation-snooze' },
        ),
        AIModule,
        forwardRef(() => PersonaModule),
        forwardRef(() => BusinessInfoModule),
        VerticalsModule,
        InvitationsModule,
    ],
    controllers: [TenantsController, PlatformStatusController],
    providers: [TenantsService],
    exports: [TenantsService],
})
export class TenantsModule { }
