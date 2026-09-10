import { forwardRef, Module } from '@nestjs/common';
import { PersonaService } from './persona.service';
import { PersonaController } from './persona.controller';
import { TenantsModule } from '../tenants/tenants.module';
import { AgentDraftService } from './agent-draft.service';
import { AgentDraftController } from './agent-draft.controller';
import { AgentPublicationService } from './agent-publication.service';
import { AgentPublicationController } from './agent-publication.controller';
import { EvaluationRevisionModule } from '../evaluation-revision/evaluation-revision.module';

@Module({
    // EvaluationRevisionModule and not ConversationsModule: publication needs the
    // manifest check, and ConversationsModule already imports this one.
    imports: [forwardRef(() => TenantsModule), EvaluationRevisionModule],
    controllers: [PersonaController, AgentDraftController, AgentPublicationController],
    providers: [PersonaService, AgentDraftService, AgentPublicationService],
    exports: [PersonaService, AgentDraftService, AgentPublicationService],
})
export class PersonaModule { }
