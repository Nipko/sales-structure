import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AssetsService } from './assets.service';
import { MetaGraphModule } from '../meta-graph/meta-graph.module';

@Module({
  imports: [
    MetaGraphModule,
    BullModule.registerQueue({ name: 'sync' }),
  ],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
