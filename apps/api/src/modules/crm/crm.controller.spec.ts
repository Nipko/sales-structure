import { Test, TestingModule } from '@nestjs/testing';
import { CrmController } from './crm.controller';
import { LeadsRepository } from './repositories/leads.repository';
import { OpportunitiesRepository } from './repositories/opportunities.repository';
import { CatalogRepository } from './repositories/catalog.repository';
import { NotesService } from './services/notes/notes.service';
import { TasksService } from './services/tasks/tasks.service';
import { ActivityService } from './services/activity/activity.service';

describe('CrmController', () => {
  let controller: CrmController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CrmController],
      providers: [
        { provide: LeadsRepository, useValue: {} },
        { provide: OpportunitiesRepository, useValue: {} },
        { provide: CatalogRepository, useValue: {} },
        { provide: NotesService, useValue: {} },
        { provide: TasksService, useValue: {} },
        { provide: ActivityService, useValue: {} },
      ],
    }).compile();

    controller = module.get<CrmController>(CrmController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
