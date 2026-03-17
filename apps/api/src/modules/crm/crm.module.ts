import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { LeadsRepository } from './repositories/leads.repository';
import { OpportunitiesRepository } from './repositories/opportunities.repository';
import { CatalogRepository } from './repositories/catalog.repository';
import { NotesService } from './services/notes/notes.service';
import { TasksService } from './services/tasks/tasks.service';
import { ActivityService } from './services/activity/activity.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
    imports: [PrismaModule, RedisModule],
    controllers: [CrmController],
    providers: [
        NotesService, 
        TasksService, 
        ActivityService,
        LeadsRepository,
        OpportunitiesRepository,
        CatalogRepository
    ],
    exports: [
        NotesService, 
        TasksService, 
        ActivityService,
        LeadsRepository,
        OpportunitiesRepository,
        CatalogRepository
    ],
})
export class CrmModule {}
