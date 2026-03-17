import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { ContactsService } from './services/contacts/contacts.service';
import { NotesService } from './services/notes/notes.service';
import { TasksService } from './services/tasks/tasks.service';
import { ActivityService } from './services/activity/activity.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
    imports: [PrismaModule, RedisModule],
    controllers: [CrmController],
    providers: [ContactsService, NotesService, TasksService, ActivityService],
    exports: [ContactsService, NotesService, TasksService, ActivityService],
})
export class CrmModule {}
