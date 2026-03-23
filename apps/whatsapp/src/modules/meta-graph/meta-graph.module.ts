import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MetaGraphService } from './meta-graph.service';

@Module({
  imports: [HttpModule],
  providers: [MetaGraphService],
  exports: [MetaGraphService],
})
export class MetaGraphModule {}
