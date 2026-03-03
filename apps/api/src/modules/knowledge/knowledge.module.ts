import { Module } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
    imports: [TenantsModule],
    providers: [KnowledgeService],
    controllers: [KnowledgeController],
    exports: [KnowledgeService],
})
export class KnowledgeModule { }
