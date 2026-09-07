import { forwardRef, Module } from '@nestjs/common';
import { PersonaService } from './persona.service';
import { PersonaController } from './persona.controller';
import { TenantsModule } from '../tenants/tenants.module';
import { AgentDraftService } from './agent-draft.service';
import { AgentDraftController } from './agent-draft.controller';

@Module({
    imports: [forwardRef(() => TenantsModule)],
    controllers: [PersonaController, AgentDraftController],
    providers: [PersonaService, AgentDraftService],
    exports: [PersonaService, AgentDraftService],
})
export class PersonaModule { }
